import type {
  ActorRef, AuditEntityRef, AuditEventSource, EventSource, PermissionKey,
} from "@/types";
import type { ModuleAuditFeed, ModuleAuditRecord } from "@/lib/audit/ingest";
import type { RiskObservation } from "@/lib/risk/evaluate";
import type { ServiceContext } from "../contracts/context";
import { mockComplianceService } from "./compliance";
import { mockFuelService } from "./fuel";
import { mockInvoicesService } from "./invoices";
import { mockSettlementsService } from "./settlements";
import { mockStore } from "./store";
import { hoursFromNow } from "./time";

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
/* The registry                                                                */
/* -------------------------------------------------------------------------- */

export const AUDIT_FEEDS: readonly ModuleAuditFeed<ServiceContext>[] = [
  loadsFeed,
  fuelFeed,
  complianceFeed,
  invoicesFeed,
  settlementsFeed,
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
