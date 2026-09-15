import type {
  ActorRef, AuditAction, AuditEntityRef, AuditEvent, AuditEventSource,
  AuditModule, AuditOutcome, EventSource, PermissionKey,
} from "@/types";
import { sanitizeChanges, type RawFieldChange } from "@/lib/audit/redaction";
import { hoursFromNow } from "./time";

/**
 * Seeded ledger history.
 *
 * Mock data, like every other fixture in this repository: it exists so the
 * screens, the rules and the case workflow can be looked at against something.
 * It is partitioned by organization and it goes through the SAME sanitizer the
 * live write path uses — including the deliberately sensitive fields below,
 * which is how the redaction boundary can be proven rather than asserted.
 *
 * Read the shape, not the content. Nothing here describes anything that
 * happened to anybody.
 */

const actor = (
  membershipId: string,
  displayNameSnapshot: string,
  source: ActorRef["source"] = "web",
): ActorRef => ({
  userId: `usr_${membershipId}`,
  membershipId,
  displayNameSnapshot,
  source,
});

/* The seeded memberships. Sam is the signed-in fixture user; the rest are
 * colleagues, so that separation of duties has something to be proven with. */
export const SEED_ACTORS = {
  sam: actor("mem_northline_owner", "Sam Murtaza"),
  dana: actor("mem_nl_dana", "Dana Whitfield"),
  priya: actor("mem_nl_priya", "Priya Raman"),
  marcus: actor("mem_nl_marcus", "Marcus Hale"),
  system: actor("system", "Antcolos", "system"),
  samBaxter: actor("mem_baxter_owner", "Sam Murtaza"),
  owen: actor("mem_bx_owen", "Owen Reyes"),
  samMeridian: actor("mem_meridian_dispatcher", "Sam Murtaza"),
  lena: actor("mem_md_lena", "Lena Ortiz"),
} as const;

let seq = 0;
const nextEventId = () => `aev_seed_${(seq += 1).toString(36)}`;

interface SeedInput {
  organizationId: string;
  actor: ActorRef;
  module: AuditModule;
  action: AuditAction;
  sourceAction?: string;
  entity: AuditEntityRef;
  relatedEntities?: AuditEntityRef[];
  summary: string;
  hoursAgo: number;
  source?: AuditEventSource;
  channel?: EventSource;
  outcome?: AuditOutcome;
  changes?: RawFieldChange[];
  permissionContext?: { required: PermissionKey[]; missing?: PermissionKey[] };
  correlationId?: string;
  correctsEventId?: string;
  correctionReason?: string;
  id?: string;
}

function event(input: SeedInput): AuditEvent {
  const at = hoursFromNow(-input.hoursAgo);
  const summary = sanitizeChanges(input.changes ?? []);
  return {
    id: input.id ?? nextEventId(),
    organizationId: input.organizationId,
    actor: input.actor,
    membershipId: input.actor.membershipId,
    module: input.module,
    action: input.action,
    sourceAction: input.sourceAction,
    entity: input.entity,
    relatedEntities: input.relatedEntities,
    source: input.source ?? (input.actor.source === "system" ? "system" : "human"),
    channel: input.channel ?? (input.actor.source === "system" ? "system" : "web"),
    outcome: input.outcome ?? "succeeded",
    occurredAt: at,
    recordedAt: at,
    correlationId: input.correlationId ?? `cor_seed_${(seq += 1).toString(36)}`,
    requestId: `req_seed_${(seq += 1).toString(36)}`,
    summary: input.summary,
    changes: input.changes
      ? { changes: summary.changes, redactedCount: summary.redactedCount }
      : undefined,
    permissionContext: input.permissionContext,
    correctsEventId: input.correctsEventId,
    correctionReason: input.correctionReason,
  };
}

const ref = (
  kind: AuditEntityRef["kind"],
  id: string,
  label: string,
  href?: string,
): AuditEntityRef => ({ kind, id, label, href });

/* -------------------------------------------------------------------------- */
/* Northline — the carrier with a team, so every rule has something to read    */
/* -------------------------------------------------------------------------- */

function northline(): AuditEvent[] {
  const org = "org_northline";
  const events: AuditEvent[] = [];

  /* --- Ordinary access administration ----------------------------------- */
  events.push(event({
    organizationId: org, actor: SEED_ACTORS.sam, module: "access",
    action: "access.permission_granted", hoursAgo: 240,
    entity: ref("membership", "mem_nl_dana", "Dana Whitfield"),
    summary: "Granted Dana Whitfield the Dispatcher role",
    changes: [{ field: "templateIds", before: null, after: "Dispatcher" }],
  }));
  events.push(event({
    organizationId: org, actor: SEED_ACTORS.sam, module: "access",
    action: "access.permission_granted", hoursAgo: 238,
    entity: ref("membership", "mem_nl_priya", "Priya Raman"),
    summary: "Granted Priya Raman the Accountant role",
    changes: [{ field: "templateIds", before: null, after: "Accountant" }],
  }));
  events.push(event({
    organizationId: org, actor: SEED_ACTORS.sam, module: "access",
    action: "access.permission_granted", hoursAgo: 236,
    entity: ref("membership", "mem_nl_marcus", "Marcus Hale"),
    summary: "Granted Marcus Hale the Safety role",
    changes: [{ field: "templateIds", before: null, after: "Safety" }],
  }));

  /* --- A run of refusals. Rule: permission_denied_burst ------------------ */
  const refusals: Array<[string, string, PermissionKey[], number]> = [
    ["Tried to open a settlement", "stl_nl_0442", ["settlements:view"], 9],
    ["Tried to export the settlement register", "stl_nl_0442", ["settlements:export"], 8.5],
    ["Tried to change payout details", "party_nl_driver_ray", ["organization:manage"], 8.2],
    ["Tried to open the audit log", "org_northline", ["audit:view"], 7.9],
  ];
  for (const [summary, entityId, required, hoursAgo] of refusals) {
    events.push(event({
      organizationId: org, actor: SEED_ACTORS.dana, module: "access",
      action: "access.permission_denied", hoursAgo, outcome: "denied",
      entity: ref(
        entityId.startsWith("stl") ? "settlement" : entityId.startsWith("party") ? "party" : "organization",
        entityId,
        entityId.startsWith("stl") ? "Settlement NL-0442" : entityId.startsWith("party") ? "Ray Bell" : "Northline Freight",
      ),
      summary,
      permissionContext: { required, missing: required },
    }));
  }

  /* --- A cross-organization attempt. Rule: cross_organization_attempt ---- */
  events.push(event({
    organizationId: org, actor: SEED_ACTORS.dana, module: "access",
    action: "access.cross_organization_attempt", hoursAgo: 7.5, outcome: "denied",
    entity: ref("settlement", "stl_bx_0117", "A settlement belonging to another organization"),
    summary: "Requested a settlement that belongs to another organization",
    permissionContext: { required: ["settlements:view"] },
  }));

  /* --- Money routing. Rule: banking_details_changed ---------------------- *
   * The sensitive fields below are deliberate: they go through the sanitizer
   * like everything else, so what lands in the ledger is the FACT that the
   * account moved and nothing whatever about the account.                   */
  events.push(event({
    organizationId: org, actor: SEED_ACTORS.priya, module: "banking",
    action: "banking.payout_details_changed", hoursAgo: 30,
    entity: ref("party", "party_nl_driver_ray", "Ray Bell"),
    summary: "Changed Ray Bell's payout details",
    changes: [
      { field: "payout.method", before: "check", after: "ach" },
      { field: "payout.accountNumber", before: "OLD", after: "NEW" },
      { field: "payout.routingNumber", before: "OLD", after: "NEW" },
      { field: "payout.verified", before: true, after: false },
    ],
  }));

  /* --- Control records. Rule: control_record_changed --------------------- *
   * Done by Sam, the signed-in fixture user, ON PURPOSE: the case this
   * produces is one Sam may read and may not investigate, which is the only
   * honest way to show separation of duties working.                        */
  events.push(event({
    organizationId: org, actor: SEED_ACTORS.sam, module: "organization",
    action: "organization.signer_changed", hoursAgo: 26,
    entity: ref("organization", org, "Northline Freight"),
    summary: "Changed the authorized signer on the operating authority",
    changes: [
      { field: "signer.name", before: "Sam Murtaza", after: "Priya Raman" },
      { field: "signer.title", before: "Owner", after: "Controller" },
    ],
  }));

  /* --- Documents. Rule: repeated_rejection ------------------------------- */
  for (const [n, hoursAgo] of [[1, 54], [2, 40], [3, 28]] as const) {
    events.push(event({
      organizationId: org, actor: SEED_ACTORS.marcus, module: "documents",
      action: "documents.rejected", sourceAction: "document.rejected", hoursAgo,
      entity: ref("driver", "dp_ray", "Ray Bell", "/people/drivers/dp_ray"),
      relatedEntities: [ref("document", `doc_nl_med_${n}`, `Medical card, attempt ${n}`)],
      summary: `Rejected Ray Bell's medical card (attempt ${n}) — unreadable scan`,
      changes: [{ field: "reviewState", before: "pending", after: "rejected" }],
    }));
  }

  /* --- Duplicates. Rule: duplicate_record -------------------------------- */
  events.push(event({
    organizationId: org, actor: SEED_ACTORS.priya, module: "invoices",
    action: "invoices.record_changed", sourceAction: "note", hoursAgo: 20,
    entity: ref("invoice", "inv_nl_2291", "Invoice NL-2291", "/finance/invoices/inv_nl_2291"),
    summary: "Flagged Invoice NL-2291 as a possible duplicate of NL-2288",
    relatedEntities: [ref("invoice", "inv_nl_2288", "Invoice NL-2288")],
  }));
  events.push(event({
    organizationId: org, actor: SEED_ACTORS.system, module: "invoices",
    action: "invoices.record_changed", sourceAction: "duplicate_detected", hoursAgo: 19.5,
    source: "inferred",
    entity: ref("invoice", "inv_nl_2291", "Invoice NL-2291", "/finance/invoices/inv_nl_2291"),
    summary: "Invoice NL-2291 and NL-2288 carry the same load reference and amount",
    relatedEntities: [ref("invoice", "inv_nl_2288", "Invoice NL-2288")],
  }));

  /* --- Assignment churn. Rule: suspicious_relationship_change ------------ */
  for (const [driver, hoursAgo] of [["Ray Bell", 16], ["Dmitri Volkov", 14], ["Ray Bell", 12]] as const) {
    events.push(event({
      organizationId: org, actor: SEED_ACTORS.dana, module: "dispatch",
      action: "dispatch.assignment_changed", sourceAction: "assignment.changed", hoursAgo,
      entity: ref("truck", "trk_nl_118", "Truck NL-118", "/fleet/trucks/trk_nl_118"),
      summary: `Assigned ${driver} to Truck NL-118`,
      changes: [{ field: "assignment.driver", before: null, after: driver }],
    }));
  }

  /* --- One intent, several modules. The correlation id is the join. ------ */
  const correlationId = "cor_seed_relationship_end";
  events.push(event({
    organizationId: org, actor: SEED_ACTORS.sam, module: "organization",
    action: "organization.relationship_ended", hoursAgo: 96, correlationId,
    entity: ref("party", "party_bx", "Baxter Transit"),
    summary: "Ended the dispatch relationship with Baxter Transit",
  }));
  events.push(event({
    organizationId: org, actor: SEED_ACTORS.system, module: "documents",
    action: "documents.share_revoked", hoursAgo: 96, correlationId, source: "system",
    entity: ref("party", "party_bx", "Baxter Transit"),
    summary: "Revoked 4 document shares held by Baxter Transit. Nothing was deleted.",
  }));
  events.push(event({
    organizationId: org, actor: SEED_ACTORS.system, module: "compliance",
    action: "compliance.requirement_changed", sourceAction: "snapshot_taken",
    hoursAgo: 96, correlationId, source: "system",
    entity: ref("party", "party_bx", "Baxter Transit"),
    summary: "Snapshotted 11 compliance requirements as they stood. The history is kept.",
  }));

  /* --- A correction, appended. The original below is never touched. ------ */
  const originalId = "aev_seed_correction_target";
  events.push(event({
    id: originalId,
    organizationId: org, actor: SEED_ACTORS.priya, module: "fuel",
    action: "fuel.ledger_changed", sourceAction: "transaction.recorded", hoursAgo: 60,
    entity: ref("fuel_transaction", "fx_nl_8812", "Fuel purchase FX-8812", "/fuel/transactions/fx_nl_8812"),
    summary: "Recorded a fuel purchase of 118.4 gallons in Illinois",
    changes: [{ field: "gallons", before: null, after: 118.4 }],
  }));
  events.push(event({
    organizationId: org, actor: SEED_ACTORS.priya, module: "fuel",
    action: "audit.event_corrected", hoursAgo: 58,
    entity: ref("fuel_transaction", "fx_nl_8812", "Fuel purchase FX-8812", "/fuel/transactions/fx_nl_8812"),
    summary: "Correction: the purchase was 18.4 gallons, not 118.4",
    correctsEventId: originalId,
    correctionReason: "Typed with a leading 1. The receipt reads 18.4 gallons.",
    changes: [{ field: "gallons", before: 118.4, after: 18.4 }],
  }));

  return events;
}

/* -------------------------------------------------------------------------- */
/* The other workspaces — smaller, so isolation can be looked at              */
/* -------------------------------------------------------------------------- */

function baxter(): AuditEvent[] {
  const org = "org_baxter";
  return [
    event({
      organizationId: org, actor: SEED_ACTORS.samBaxter, module: "access",
      action: "access.permission_granted", hoursAgo: 200,
      entity: ref("membership", "mem_bx_owen", "Owen Reyes"),
      summary: "Granted Owen Reyes the Dispatcher role",
    }),
    event({
      organizationId: org, actor: SEED_ACTORS.owen, module: "organization",
      action: "organization.operating_authority_changed", hoursAgo: 34,
      entity: ref("organization", org, "Baxter Transit"),
      summary: "Updated the Operating Authority record",
      changes: [{ field: "authority.status", before: "pending", after: "active" }],
    }),
    event({
      organizationId: org, actor: SEED_ACTORS.owen, module: "settlements",
      action: "settlements.record_changed", sourceAction: "approved", hoursAgo: 12,
      entity: ref("settlement", "stl_bx_0117", "Settlement BX-0117"),
      summary: "Approved Settlement BX-0117",
    }),
  ];
}

function meridian(): AuditEvent[] {
  const org = "org_meridian";
  return [
    event({
      organizationId: org, actor: SEED_ACTORS.samMeridian, module: "documents",
      action: "documents.approved", hoursAgo: 48,
      entity: ref("document", "doc_md_w9", "W-9"),
      summary: "Approved a carrier's W-9",
    }),
    event({
      organizationId: org, actor: SEED_ACTORS.lena, module: "access",
      action: "access.permission_denied", hoursAgo: 6, outcome: "denied",
      entity: ref("organization", org, "Meridian Dispatch"),
      summary: "Tried to open the audit log",
      permissionContext: { required: ["audit:view"], missing: ["audit:view"] },
    }),
  ];
}

export function buildAuditSeed(): Record<string, AuditEvent[]> {
  seq = 0;
  return {
    org_northline: northline(),
    org_baxter: baxter(),
    org_meridian: meridian(),
    // Deliberately empty: a workspace with no history is a real state, and it
    // has to look like one rather than like a broken screen.
    org_summit: [],
    org_solo: [],
    org_cascade: [],
    org_stonebridge: [],
  };
}
