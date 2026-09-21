import type {
  ActorRef, AuditAction, AuditEntityRef, AuditEventSource, EventSource, PermissionKey,
} from "@/types";
import type { ModuleAuditFeed, ModuleAuditRecord } from "@/lib/audit/ingest";
import type { RiskObservation } from "@/lib/risk/evaluate";
import type { ServiceContext } from "../contracts/context";
import { mockComplianceService } from "./compliance";
import { mockFuelService } from "./fuel";
import { mockInvoicesService } from "./invoices";
import { mockSettlementsService } from "./settlements";
import { mockStore } from "./store";
import { packagesForOrganization, recipientLabel } from "./document-shares";
import { sessionLoadRef, trackingAuditForLedger } from "./tracking-registry";
import { dispatchAccessEventsFor } from "./truck-registry";
import { hoursFromNow } from "./time";
import { brokerPoliciesOwnedBy } from "./broker-policy-registry";

/**
 * ★ WHERE THE LEDGER READS FROM ★
 *
 * Each feed below reads ANOTHER MODULE'S OWN HISTORY and maps it into the
 * shared shape. It does not own that history, does not write to it, and does
 * not change what it says: the settlement audit trail, the invoice versions,
 * the fuel ledger, the compliance timeline and the load event stream remain the
 * canonical record of their own modules.
 *
 * That is the whole point of doing it this way. No module gains a second audit
 * log; the ledger gains a read-only projection of the one it already had, so
 * "who did what across everything" can be answered in one place.
 *
 * Projection is idempotent — `projectionId` derives a stable ledger id from the
 * producing module and its own entry id — so running this on every read appends
 * each entry exactly once, however many times it is read.
 *
 * Feeds for modules that are not merged yet are CENTRALIZED MOCK ADAPTERS,
 * marked `mock: true`, and the Sources panel says so on screen. There is no
 * second place a placeholder adapter may live.
 */

/* -------------------------------------------------------------------------- */
/* Shared mapping helpers                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The channel a thing arrived on is not the same question as who produced it.
 * A driver's Telegram message is a person on an integration; an OCR extraction
 * is the integration itself.
 */
function sourceFor(channel: EventSource | undefined, actor: ActorRef): AuditEventSource {
  if (actor.source === "system") return "system";
  switch (channel) {
    case "system": return "system";
    case "api": return "integration";
    case "ocr": return "integration";
    case "eld": return "integration";
    case "email": return "imported";
    default: return "human";
  }
}

/** `transaction.marked_duplicate` -> `Transaction marked duplicate`. */
function readable(key: string): string {
  const words = key.replace(/[._]/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function has(ctx: ServiceContext, ...keys: PermissionKey[]): boolean {
  return keys.every((k) => ctx.permissions.has(k));
}

const ref = (
  kind: AuditEntityRef["kind"],
  id: string,
  label: string,
  href?: string,
): AuditEntityRef => ({ kind, id, label, href });

/* -------------------------------------------------------------------------- */
/* Loads — the execution timeline                                              */
/* -------------------------------------------------------------------------- */

const loadsFeed: ModuleAuditFeed<ServiceContext> = {
  module: "loads",
  requires: ["loads:view"],
  mock: false,
  read(ctx) {
    if (!has(ctx, "loads:view")) return [];
    const org = mockStore.org(ctx.organizationId);
    return org.events.map((e): ModuleAuditRecord => {
      const load = org.loads.find((l) => l.id === e.loadId);
      return {
        entryId: e.id,
        recordId: e.loadId,
        action: "loads.timeline_appended",
        sourceAction: e.kind,
        occurredAt: e.occurredAt,
        actor: e.actor,
        entity: ref("load", e.loadId, load?.reference ?? e.loadId, `/loads/${e.loadId}`),
        summary: `${readable(e.kind)}${e.payload?.note ? ` — ${e.payload.note}` : ""}`,
        source: sourceFor(e.source, e.actor),
        channel: e.source,
        // The load timeline records both sides of a status-shaped change, and
        // those are exactly the fields worth carrying across.
        changes: e.payload?.previousValue !== undefined || e.payload?.newValue !== undefined
          ? [{
            field: "status",
            before: e.payload?.previousValue ?? null,
            after: e.payload?.newValue ?? null,
          }]
          : undefined,
      };
    });
  },
};

/* -------------------------------------------------------------------------- */
/* Fuel & IFTA                                                                 */
/* -------------------------------------------------------------------------- */

const fuelFeed: ModuleAuditFeed<ServiceContext> = {
  module: "fuel",
  requires: ["fuel:view"],
  mock: false,
  async read(ctx) {
    if (!has(ctx, "fuel:view")) return [];
    const entries = await mockFuelService.audit(ctx);
    return entries.map((e): ModuleAuditRecord => ({
      entryId: e.id,
      recordId: e.subject.id,
      action: "fuel.ledger_changed",
      sourceAction: e.kind,
      occurredAt: e.at,
      actor: e.actor,
      entity: ref(
        e.subject.kind === "transaction" ? "fuel_transaction"
          : e.subject.kind === "mileage" ? "mileage_record"
            : e.subject.kind === "period" ? "ifta_period" : "organization",
        e.subject.id,
        e.subject.label,
        e.subject.kind === "transaction" ? `/fuel/transactions/${e.subject.id}` : undefined,
      ),
      summary: e.summary,
      // The fuel ledger already keeps before/after as flat scalars. They still
      // go through the sanitizer on the way in, like everything else.
      changes: [
        ...Object.entries(e.before ?? {}).map(([field, before]) => ({
          field, before, after: (e.after ?? {})[field] ?? null,
        })),
        ...Object.entries(e.after ?? {})
          .filter(([field]) => !(field in (e.before ?? {})))
          .map(([field, after]) => ({ field, before: null, after })),
      ],
    }));
  },
};

/* -------------------------------------------------------------------------- */
/* Compliance                                                                  */
/* -------------------------------------------------------------------------- */

const complianceFeed: ModuleAuditFeed<ServiceContext> = {
  module: "compliance",
  requires: ["compliance:view"],
  mock: false,
  async read(ctx) {
    if (!has(ctx, "compliance:view")) return [];
    const requirements = await mockComplianceService.list(ctx, {});
    return requirements.flatMap((r) =>
      r.history.map((h): ModuleAuditRecord => ({
        entryId: h.id,
        recordId: r.id,
        action: "compliance.requirement_changed",
        sourceAction: h.action,
        occurredAt: h.at,
        actor: h.actor,
        entity: ref(
          "compliance_requirement",
          r.id,
          `${r.subject.label} — ${r.label}`,
          `/compliance/${r.id}`,
        ),
        summary: `${readable(h.action)}: ${r.label} for ${r.subject.label}`,
        changes: h.fromStatus || h.toStatus
          ? [{ field: "status", before: h.fromStatus ?? null, after: h.toStatus ?? null }]
          : undefined,
      })),
    );
  },
};

/* -------------------------------------------------------------------------- */
/* Invoices                                                                    */
/* -------------------------------------------------------------------------- */

const invoicesFeed: ModuleAuditFeed<ServiceContext> = {
  module: "invoices",
  requires: ["invoices:view"],
  mock: false,
  async read(ctx) {
    if (!has(ctx, "invoices:view")) return [];
    const page = await mockInvoicesService.list(ctx, undefined, undefined, { limit: 50 });
    return page.items.flatMap((invoice) =>
      invoice.audit.map((entry): ModuleAuditRecord => ({
        entryId: entry.id,
        recordId: invoice.id,
        action: "invoices.record_changed",
        sourceAction: entry.action,
        occurredAt: entry.at,
        actor: entry.actor,
        entity: ref(
          "invoice",
          invoice.id,
          invoice.number,
          `/finance/invoices/${invoice.id}`,
        ),
        summary: `${readable(entry.action)}${entry.note ? ` — ${entry.note}` : ""}`,
        changes: entry.fromStatus || entry.toStatus
          ? [{ field: "status", before: entry.fromStatus ?? null, after: entry.toStatus ?? null }]
          : undefined,
      })),
    );
  },
};

/* -------------------------------------------------------------------------- */
/* Settlements                                                                 */
/* -------------------------------------------------------------------------- */

/** The settlement audit trail is per-settlement, so the read is capped. */
const SETTLEMENT_AUDIT_CAP = 12;

const settlementsFeed: ModuleAuditFeed<ServiceContext> = {
  module: "settlements",
  requires: ["settlements:view"],
  mock: false,
  async read(ctx) {
    if (!has(ctx, "settlements:view")) return [];
    const page = await mockSettlementsService.list(ctx, undefined, undefined, {
      limit: SETTLEMENT_AUDIT_CAP,
    });
    const trails = await Promise.all(
      page.items.map(async (s) => ({
        settlement: s,
        entries: await mockSettlementsService.audit(ctx, s.id).catch(() => []),
      })),
    );
    return trails.flatMap(({ settlement, entries }) =>
      entries.map((entry): ModuleAuditRecord => ({
        entryId: entry.id,
        recordId: settlement.id,
        action: "settlements.record_changed",
        sourceAction: entry.action,
        occurredAt: entry.at,
        actor: entry.actor,
        entity: ref(
          "settlement",
          settlement.id,
          settlement.number,
          `/finance/settlements/${settlement.id}`,
        ),
        summary: entry.summary,
        changes: entry.fromStatus || entry.toStatus
          ? [{ field: "status", before: entry.fromStatus ?? null, after: entry.toStatus ?? null }]
          : undefined,
      })),
    );
  },
};

/* -------------------------------------------------------------------------- */
/* Load tracking and customer visibility                                       */
/* -------------------------------------------------------------------------- */

/**
 * The tracking module's own append-only history, projected.
 *
 * Tracking already keeps every link issued, opened, refused and withdrawn,
 * every visibility change, every update and every availability decision — with
 * the provenance that produced it. That history stays where it is and stays
 * canonical; this is the read-only second view, so "who shared what, with whom,
 * and when did they open it" is answerable from the one ledger alongside
 * everything else that happened that day.
 */
const trackingFeed: ModuleAuditFeed<ServiceContext> = {
  module: "dispatch",
  requires: ["tracking:view"],
  mock: false,
  read(ctx) {
    return trackingAuditForLedger(ctx).map((entry): ModuleAuditRecord => {
      const load = sessionLoadRef(ctx.organizationId, entry.subjectId);
      return {
        entryId: entry.id,
        // The load when the line is about a session, the subject itself
        // otherwise — a truck's availability decision belongs to the truck.
        recordId: load?.loadId ?? entry.subjectId,
        action: "dispatch.tracking_changed",
        sourceAction: entry.action,
        occurredAt: entry.at,
        actor: {
          userId: entry.actorMembershipId ? "usr_sam" : "system",
          membershipId: entry.actorMembershipId ?? "system",
          displayNameSnapshot: entry.actorName,
          source: entry.actorMembershipId ? "web" : "system",
        },
        entity: load
          ? ref("load", load.loadId, load.loadReference, `/dispatch/tracking/${load.loadId}`)
          : ref("truck", entry.subjectId, entry.subjectId),
        summary: entry.detail ? `${entry.summary} ${entry.detail}` : entry.summary,
        // A conclusion a machine reached is an integration's word; a person's
        // is a person's. The distinction the tracking module keeps survives the
        // projection rather than being flattened into "something changed".
        source: entry.actorMembershipId ? "human" : "integration",
        outcome: entry.action === "link_access_refused" ? "denied" : undefined,
      };
    });
  },
};

/* -------------------------------------------------------------------------- */
/* Documents — driver share packages                                           */
/* -------------------------------------------------------------------------- */

/** The share event's own kind, mapped onto the ledger's canonical actions. */
const SHARE_ACTION: Record<string, AuditAction> = {
  created: "documents.share_issued",
  delivery_queued: "documents.share_delivery_attempted",
  delivery_recorded: "documents.share_delivery_attempted",
  delivery_failed: "documents.share_delivery_failed",
  opened: "documents.share_opened",
  document_viewed: "documents.share_opened",
  access_refused: "documents.share_access_refused",
  revoked: "documents.share_revoked",
  expired: "documents.share_expired",
  review_recorded: "documents.share_review_recorded",
  refreshed: "documents.share_refreshed",
};

/**
 * What a driver shared with THIS organization, and what has happened to it.
 *
 * A projection, like every other feed: the share package keeps its own
 * append-only history and this maps it into the one ledger, idempotently, so
 * sharing gains no second log. Only packages addressed to the reading
 * organization are visible — another carrier's share is not this carrier's
 * history, and an external recipient has no organization to read as.
 */
const documentSharesFeed: ModuleAuditFeed<ServiceContext> = {
  module: "documents",
  requires: ["documents:view"],
  mock: false,
  read(ctx) {
    if (!has(ctx, "documents:view")) return [];
    return packagesForOrganization(ctx.organizationId).flatMap((pkg) =>
      pkg.events.map((e): ModuleAuditRecord => ({
        entryId: e.id,
        recordId: pkg.id,
        action: SHARE_ACTION[e.kind] ?? "documents.shared",
        sourceAction: e.kind,
        occurredAt: e.at,
        actor: {
          userId: "external",
          membershipId: ctx.membershipId,
          displayNameSnapshot: e.actorName ?? pkg.driverName,
          source: "web",
        },
        entity: ref(
          "document",
          pkg.id,
          `Documents shared by ${pkg.driverName}`,
          `/documents/shared/${pkg.id}`,
        ),
        summary: `${e.summary} — shared with ${recipientLabel(pkg)}`,
        source: "human",
        outcome: e.kind === "access_refused"
          ? "denied"
          : e.kind === "delivery_failed"
            ? "failed"
            : undefined,
      })),
    );
  },
};

/* -------------------------------------------------------------------------- */
/* The registry                                                                */
/* -------------------------------------------------------------------------- */


/* -------------------------------------------------------------------------- */
/* Fleet — dispatch delegation                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Granting and ending a dispatch arrangement, in the one ledger.
 *
 * ★ WHY THE ENTRY ID CARRIES THE ORGANIZATION ★
 * Every other feed reads records only its own organization can see, so no entry
 * id has ever been visible to two organizations at once. A dispatch grant is
 * the first fact BOTH sides may read — the carrier that issued it and the
 * provider that received it — and that breaks an assumption sitting in the
 * ledger: `projectionId` is `module + entryId` with no organization in it, and
 * `AuditLedger.has` checks a single index shared across every bucket. Two
 * organizations projecting the same entry id would therefore mean the FIRST
 * one to open its audit page got the row and the second silently got nothing,
 * with `find` then throwing `OrganizationScopeError` at whichever lost.
 *
 * So the entry id is qualified with the reading organization. Both rows exist,
 * order does not decide who sees what, and `projectionId` and every existing
 * feed stay exactly as they are. The two rows carry the same
 * `projection.recordId` — the grant — so they are provably two views of one
 * source record rather than two independent writes that could disagree.
 */
const fleetDispatchFeed: ModuleAuditFeed<ServiceContext> = {
  module: "fleet",
  requires: ["trucks:view"],
  mock: false,
  read(ctx) {
    if (!has(ctx, "trucks:view")) return [];
    return dispatchAccessEventsFor(ctx.organizationId).map(
      ({ event, grant }): ModuleAuditRecord => ({
        // Organization-qualified. See the note above.
        entryId: `${event.id}:${ctx.organizationId}`,
        recordId: grant.id,
        action: "fleet.record_changed",
        sourceAction: event.kind,
        occurredAt: event.at,
        actor: {
          userId: "system",
          membershipId: grant.endedByMembershipId ?? grant.grantedByMembershipId,
          displayNameSnapshot: event.actorName
            ?? grant.endedByName
            ?? grant.grantedByName,
          source: "web",
        },
        entity: ref(
          "truck",
          event.truckId,
          grant.unitLabel ? `Unit ${grant.unitLabel}` : event.truckId,
          `/fleet/trucks/${event.truckId}`,
        ),
        relatedEntities: [
          ref("organization", grant.dispatchOrganizationId, grant.dispatchOrganizationName),
        ],
        summary: event.summary,
        source: "human",
        outcome: "succeeded",
      }),
    );
  },
};

/* -------------------------------------------------------------------------- */
/* Directory — broker working policies                                         */
/* -------------------------------------------------------------------------- */

/**
 * Who decided this company would not work with that broker, and when.
 *
 * ★ A PROJECTION, NOT A SECOND LEDGER ★
 * The policy keeps its own append-only history, exactly as the settlement trail
 * and the fuel ledger keep theirs. This reads that history and joins it to
 * everything else that happened that day; it writes nothing back, and a policy
 * gains no audit log it did not already have. One history entry produces one
 * ledger row, forever, because `projectionId` derives the row id from the
 * entry's own id — which is what makes "an owner-approved exception writes
 * exactly one audit event" arithmetic rather than a promise.
 *
 * ★ WHAT NEVER TRAVELS ★
 * The private explanation. A policy's reason CATEGORY is on the summary so an
 * auditor can see what kind of decision this was; the sentence somebody wrote
 * about a broker stays on the policy, readable only by the organization that
 * owns it. The ledger is partitioned by organization anyway, but the summary is
 * written to be safe even where a redacted export is read by somebody else.
 */
const brokerPolicyFeed: ModuleAuditFeed<ServiceContext> = {
  module: "directory",
  requires: ["customers:view"],
  mock: false,
  read(ctx) {
    if (!has(ctx, "customers:view")) return [];
    const out: ModuleAuditRecord[] = [];
    for (const policy of brokerPoliciesOwnedBy(ctx.organizationId)) {
      for (const entry of policy.history) {
        out.push({
          entryId: entry.id,
          recordId: policy.policyId,
          action: "directory.party_changed",
          sourceAction: `broker_policy.${entry.kind}`,
          occurredAt: entry.at,
          actor: entry.actor,
          entity: ref(
            "party",
            policy.brokerPartyId,
            policy.brokerNameSnapshot,
            `/directory/${policy.brokerPartyId}`,
          ),
          relatedEntities: [
            ref("organization", policy.organizationId, policy.organizationNameSnapshot),
          ],
          // The action, the scope and the reason CATEGORY. Never the sentence.
          summary: entry.note,
          source: entry.actor.source === "system" ? "system" : "human",
          outcome: "succeeded",
        });
      }
    }
    return out;
  },
};

export const AUDIT_FEEDS: readonly ModuleAuditFeed<ServiceContext>[] = [
  loadsFeed,
  fuelFeed,
  complianceFeed,
  invoicesFeed,
  settlementsFeed,
  trackingFeed,
  documentSharesFeed,
  fleetDispatchFeed,
  brokerPolicyFeed,
];

/** Reads every feed the caller is entitled to. A feed that throws is skipped
 *  rather than allowed to withhold the rest of the ledger — and the Sources
 *  panel reports zero for it, which is visible rather than silent. */
export async function readAllFeeds(
  ctx: ServiceContext,
): Promise<{ module: string; records: ModuleAuditRecord[] }[]> {
  return Promise.all(
    AUDIT_FEEDS.map(async (feed) => {
      try {
        return { module: feed.module, records: await feed.read(ctx) };
      } catch {
        return { module: feed.module, records: [] };
      }
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Observations — the modules that are not merged yet                          */
/* -------------------------------------------------------------------------- */

/**
 * ★ CENTRALIZED MOCK ADAPTER ★
 *
 * Facts the ledger alone cannot express — "this equipment is out of service AND
 * on a dispatched load" — that would come from ELD, Maintenance, Insurance and
 * Compliance modules being read together. Those cross-module reads are not
 * wired on this branch, so they arrive here as labelled placeholders.
 *
 * `mockSource: true` travels with the data and is rendered on every signal
 * these produce. When the real modules land, this function is replaced and the
 * evaluator does not change.
 */
export function mockRiskObservations(ctx: ServiceContext): RiskObservation[] {
  if (ctx.organizationId !== "org_northline") return [];
  if (!ctx.permissions.has("compliance:view") && !ctx.permissions.has("fleet:view")) {
    return [];
  }

  return [
    {
      id: "rsig_obs_nl_oos_dispatched",
      ruleId: "rule.critical_inconsistency",
      kind: "critical_inconsistency",
      severity: "critical",
      title: "Truck NL-204 is out of service and on a dispatched load",
      rationale:
        "Maintenance has this unit out of service while Dispatch has it on a load that has not been delivered. "
        + "Both cannot be true. Antcolos is connected to no ELD and reads no logs; this compares what is recorded here.",
      detectedAt: hoursFromNow(-5),
      entity: ref("truck", "trk_nl_204", "Truck NL-204", "/fleet/trucks/trk_nl_204"),
      relatedEntities: [ref("load", "load_nl_8871", "Load NL-8871", "/loads/load_nl_8871")],
      mockSource: true,
    },
    {
      id: "rsig_obs_nl_policy_lapsed",
      ruleId: "rule.critical_inconsistency",
      kind: "critical_inconsistency",
      severity: "critical",
      title: "Cargo policy lapsed while a load is running under it",
      rationale:
        "The cargo policy recorded against this load expired before the load was delivered. "
        + "Antcolos is not connected to any insurer and cannot confirm the policy's real status.",
      detectedAt: hoursFromNow(-11),
      entity: ref("policy", "pol_nl_cargo", "Cargo policy", "/insurance/policies/pol_nl_cargo"),
      relatedEntities: [ref("load", "load_nl_8871", "Load NL-8871", "/loads/load_nl_8871")],
      mockSource: true,
    },
  ];
}
