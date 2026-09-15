import type {
  AuditEntityRef, AuditEvent, ActorRef, IsoDateTime, PermissionKey,
  RiskSeverity, RiskSignalKind,
} from "@/types";
import { isHighValueAction, isPermissionSensitive } from "@/lib/audit/actions";

/**
 * ★ MOCK RULE EVALUATION — PURE ★
 *
 * In: audit events the caller may already see, plus typed observations
 * contributed by module adapters. Out: signal drafts.
 *
 * It reads. It never writes to the ledger, never mutates an event, and never
 * touches a module's canonical record. Everything it produces carries a STABLE
 * id derived from what prompted it, so re-running over the same ledger produces
 * the same signals rather than a growing pile of duplicates — which is what
 * lets a person dismiss one and have it stay dismissed.
 *
 * No scoring. No model. No outside data. See `rules.ts`.
 */

export interface RiskSignalDraft {
  readonly id: string;
  readonly ruleId: string;
  readonly kind: RiskSignalKind;
  readonly severity: RiskSeverity;
  readonly title: string;
  readonly rationale: string;
  readonly detectedAt: IsoDateTime;
  readonly entity: AuditEntityRef;
  readonly relatedEntities?: readonly AuditEntityRef[];
  readonly subjectActor?: ActorRef;
  readonly auditEventIds: readonly string[];
  readonly requires: readonly PermissionKey[];
}

/**
 * A typed fact a module contributes that the ledger alone cannot express —
 * "this equipment is out of service and is on a dispatched load".
 *
 * Modules on other branches contribute these through the centralized mock
 * adapters in `src/lib/api/mock/audit-sources.ts`. When those modules land, the
 * adapter is swapped and this interface does not change.
 */
export interface RiskObservation {
  readonly id: string;
  readonly ruleId: string;
  readonly kind: RiskSignalKind;
  readonly severity: RiskSeverity;
  readonly title: string;
  readonly rationale: string;
  readonly detectedAt: IsoDateTime;
  readonly entity: AuditEntityRef;
  readonly relatedEntities?: readonly AuditEntityRef[];
  readonly auditEventIds?: readonly string[];
  /** True while the contributing module is a placeholder on another branch. */
  readonly mockSource: boolean;
}

export interface RiskEvaluationInput {
  readonly organizationId: string;
  readonly events: readonly AuditEvent[];
  readonly observations?: readonly RiskObservation[];
  readonly now?: number;
}

const SIGNAL_PERMISSIONS: readonly PermissionKey[] = ["risk:view"];

/** Windows the timing rules use. Hand-picked, and deliberately generous. */
const HOUR = 3_600_000;
const DENIAL_WINDOW_MS = 6 * HOUR;
const CHURN_WINDOW_MS = 48 * HOUR;

const byTime = (a: AuditEvent, b: AuditEvent) =>
  new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();

const ms = (iso: IsoDateTime) => new Date(iso).getTime();

const latest = (events: readonly AuditEvent[]): IsoDateTime =>
  events.reduce((acc, e) => (ms(e.occurredAt) > ms(acc) ? e.occurredAt : acc), events[0].occurredAt);

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = out.get(k);
    if (bucket) bucket.push(item);
    else out.set(k, [item]);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Rule 1 — refused permission-sensitive actions                              */
/* -------------------------------------------------------------------------- */

function deniedActions(events: readonly AuditEvent[]): RiskSignalDraft[] {
  const denied = events.filter(
    (e) => (e.outcome === "denied" || e.outcome === "failed")
      && e.action !== "access.cross_organization_attempt",
  );
  if (!denied.length) return [];

  const out: RiskSignalDraft[] = [];
  for (const [membershipId, group] of groupBy(denied, (e) => e.membershipId)) {
    const sorted = [...group].sort(byTime);
    const recent = sorted.filter(
      (e) => ms(latest(sorted)) - ms(e.occurredAt) <= DENIAL_WINDOW_MS,
    );
    const sensitive = recent.filter((e) => isPermissionSensitive(e.action));
    // One refusal is worth recording only when the action itself is
    // permission-sensitive. A run of refusals is worth recording either way.
    if (!sensitive.length && recent.length < 3) continue;

    const subject = sorted[sorted.length - 1];
    const severity: RiskSeverity = recent.length >= 5 || sensitive.length >= 3
      ? "critical"
      : "high";

    out.push({
      id: `rsig_denied_${membershipId}`,
      ruleId: "rule.permission_denied_burst",
      kind: "unauthorized_action",
      severity,
      title: `${recent.length} refused action${recent.length === 1 ? "" : "s"} by ${subject.actor.displayNameSnapshot}`,
      rationale:
        `${recent.length} action${recent.length === 1 ? " was" : "s were"} refused for this membership within ` +
        `${Math.round(DENIAL_WINDOW_MS / HOUR)} hours, ${sensitive.length} of them permission-sensitive. ` +
        "The refusals are the evidence; the reason behind them is not something this rule can know.",
      detectedAt: latest(recent),
      entity: {
        kind: "membership",
        id: membershipId,
        label: subject.actor.displayNameSnapshot,
      },
      relatedEntities: recent.slice(0, 5).map((e) => e.entity),
      subjectActor: subject.actor,
      auditEventIds: recent.map((e) => e.id),
      requires: SIGNAL_PERMISSIONS,
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Rule 2 — cross-organization access                                         */
/* -------------------------------------------------------------------------- */

function crossOrganization(events: readonly AuditEvent[]): RiskSignalDraft[] {
  return events
    .filter((e) => e.action === "access.cross_organization_attempt")
    .map((event) => ({
      id: `rsig_xorg_${event.id}`,
      ruleId: "rule.cross_organization_attempt",
      kind: "cross_organization_access" as const,
      severity: "critical" as const,
      title: `Cross-organization access attempt by ${event.actor.displayNameSnapshot}`,
      rationale:
        "A record belonging to another organization was requested through this one and refused at the service seam. " +
        "A stale link produces the same event as anything else, so this is a prompt to look, not a finding.",
      detectedAt: event.occurredAt,
      entity: event.entity,
      relatedEntities: event.relatedEntities,
      subjectActor: event.actor,
      auditEventIds: [event.id],
      requires: SIGNAL_PERMISSIONS,
    }));
}

/* -------------------------------------------------------------------------- */
/* Rule 3 and 4 — control and money-routing records                           */
/* -------------------------------------------------------------------------- */

const CONTROL_ACTIONS = new Set([
  "organization.ownership_changed",
  "organization.operating_authority_changed",
  "organization.signer_changed",
]);

const BANKING_ACTIONS = new Set([
  "banking.details_changed",
  "banking.payout_details_changed",
]);

function sensitiveRecordChanges(events: readonly AuditEvent[]): RiskSignalDraft[] {
  const out: RiskSignalDraft[] = [];
  for (const event of events) {
    if (event.outcome !== "succeeded") continue;
    const banking = BANKING_ACTIONS.has(event.action);
    if (!banking && !CONTROL_ACTIONS.has(event.action)) continue;

    out.push({
      id: `rsig_sensitive_${event.id}`,
      ruleId: banking ? "rule.banking_details_changed" : "rule.control_record_changed",
      kind: "sensitive_record_change",
      severity: banking ? "critical" : "high",
      title: `${event.summary}`,
      rationale: banking
        ? "Money-routing details moved. The values are never in the ledger — only the fact that they changed, and who changed them. "
          + "Antcolos cannot check the new details against anything."
        : "Ownership, Operating Authority or the authorized signer moved. Every such change is flagged, including entirely legitimate ones.",
      detectedAt: event.occurredAt,
      entity: event.entity,
      relatedEntities: event.relatedEntities,
      subjectActor: event.actor,
      auditEventIds: [event.id],
      requires: SIGNAL_PERMISSIONS,
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Rule 5 — duplicates and conflicts                                          */
/* -------------------------------------------------------------------------- */

const DUPLICATE_HINTS = ["duplicate", "conflict", "superseded", "disagree"];

function duplicatesAndConflicts(events: readonly AuditEvent[]): RiskSignalDraft[] {
  const flagged = events.filter((e) => {
    const key = `${e.sourceAction ?? ""} ${e.summary}`.toLowerCase();
    return DUPLICATE_HINTS.some((hint) => key.includes(hint));
  });

  return [...groupBy(flagged, (e) => `${e.entity.kind}:${e.entity.id}`)].map(
    ([, group]) => {
      const sorted = [...group].sort(byTime);
      const last = sorted[sorted.length - 1];
      return {
        id: `rsig_dupe_${last.entity.kind}_${last.entity.id}`,
        ruleId: "rule.duplicate_record",
        kind: "duplicate_or_conflict" as const,
        severity: "medium" as const,
        title: `Possible duplicate or conflict on ${last.entity.label}`,
        rationale:
          `${sorted.length} ledger ${sorted.length === 1 ? "entry" : "entries"} about this record mention a duplicate, ` +
          "a conflict or a supersession. The rule matches the producing module's own wording; it compares no content.",
        detectedAt: latest(sorted),
        entity: last.entity,
        relatedEntities: last.relatedEntities,
        subjectActor: last.actor,
        auditEventIds: sorted.map((e) => e.id),
        requires: SIGNAL_PERMISSIONS,
      };
    },
  );
}

/* -------------------------------------------------------------------------- */
/* Rule 6 — relationship, contract, equipment and assignment churn            */
/* -------------------------------------------------------------------------- */

const CHURN_ACTIONS = new Set([
  "organization.relationship_started",
  "organization.relationship_ended",
  "dispatch.assignment_changed",
  "fleet.record_changed",
  "drivers.record_changed",
]);

function suspiciousChanges(events: readonly AuditEvent[]): RiskSignalDraft[] {
  const candidates = events.filter(
    (e) => CHURN_ACTIONS.has(e.action) && e.outcome === "succeeded",
  );
  const out: RiskSignalDraft[] = [];

  for (const [, group] of groupBy(candidates, (e) => `${e.entity.kind}:${e.entity.id}`)) {
    const sorted = [...group].sort(byTime);
    const window = sorted.filter(
      (e) => ms(latest(sorted)) - ms(e.occurredAt) <= CHURN_WINDOW_MS,
    );
    if (window.length < 3) continue;
    const last = window[window.length - 1];
    out.push({
      id: `rsig_churn_${last.entity.kind}_${last.entity.id}`,
      ruleId: "rule.suspicious_relationship_change",
      kind: "suspicious_change",
      severity: "medium",
      title: `${window.length} changes to ${last.entity.label} in ${Math.round(CHURN_WINDOW_MS / HOUR)} hours`,
      rationale:
        "A relationship, contract, equipment record or assignment changed several times in a short period. " +
        "Ordinary operational churn trips this rule; it reads timing and repetition, and nothing about intent.",
      detectedAt: latest(window),
      entity: last.entity,
      subjectActor: last.actor,
      auditEventIds: window.map((e) => e.id),
      requires: SIGNAL_PERMISSIONS,
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Rule 7 — repeated rejections and corrections                               */
/* -------------------------------------------------------------------------- */

const REJECTION_HINTS = ["rejected", "corrected", "correction", "reversed", "amended"];

function repeatedRejections(events: readonly AuditEvent[]): RiskSignalDraft[] {
  const flagged = events.filter((e) => {
    if (e.action === "documents.rejected") return true;
    const key = `${e.sourceAction ?? ""} ${e.summary}`.toLowerCase();
    return REJECTION_HINTS.some((hint) => key.includes(hint));
  });

  const out: RiskSignalDraft[] = [];
  // Grouped by what the rejections are ABOUT, not by who recorded them. The
  // reviewer who rejects three bad scans is doing their job; the subject those
  // three rejections are against is the thing worth reading back.
  for (const [, group] of groupBy(flagged, (e) => `${e.entity.kind}:${e.entity.id}`)) {
    if (group.length < 3) continue;
    const sorted = [...group].sort(byTime);
    const last = sorted[sorted.length - 1];
    out.push({
      id: `rsig_reject_${last.entity.kind}_${last.entity.id}`,
      ruleId: "rule.repeated_rejection",
      kind: "repeated_rejection",
      severity: "medium",
      title: `${sorted.length} rejections or corrections on ${last.entity.label}`,
      rationale:
        "Several uploads against this record were rejected, or it was corrected several times. " +
        "A person fighting a bad scanner and a person retrying until something passes look identical to this rule.",
      detectedAt: latest(sorted),
      entity: last.entity,
      relatedEntities: sorted.slice(0, 5).flatMap((e) => e.relatedEntities ?? []),
      subjectActor: last.actor,
      auditEventIds: sorted.map((e) => e.id),
      requires: SIGNAL_PERMISSIONS,
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* The evaluator                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Observations become signals as they are: the contributing module has already
 * decided what it is about, and re-deriving that here would put a second
 * opinion on top of a fact this module cannot check.
 */
function fromObservations(observations: readonly RiskObservation[]): RiskSignalDraft[] {
  return observations.map((o) => ({
    id: o.id,
    ruleId: o.ruleId,
    kind: o.kind,
    severity: o.severity,
    title: o.title,
    rationale: o.mockSource
      ? `${o.rationale} (Contributed by a mock adapter for a module that is not merged yet.)`
      : o.rationale,
    detectedAt: o.detectedAt,
    entity: o.entity,
    relatedEntities: o.relatedEntities,
    auditEventIds: o.auditEventIds ?? [],
    requires: SIGNAL_PERMISSIONS,
  }));
}

export function evaluateRiskRules(input: RiskEvaluationInput): RiskSignalDraft[] {
  const events = input.events.filter((e) => e.organizationId === input.organizationId);

  const drafts = [
    ...deniedActions(events),
    ...crossOrganization(events),
    ...sensitiveRecordChanges(events),
    ...duplicatesAndConflicts(events),
    ...suspiciousChanges(events),
    ...repeatedRejections(events),
    ...fromObservations(input.observations ?? []),
  ];

  // Stable ids are the contract, so a collision is a bug in a rule rather than
  // something to paper over by appending a counter.
  const seen = new Set<string>();
  const unique: RiskSignalDraft[] = [];
  for (const draft of drafts) {
    if (seen.has(draft.id)) continue;
    seen.add(draft.id);
    unique.push(draft);
  }
  return unique;
}

/** Exported for the tests that prove high-value actions always reach a rule. */
export function isHighValue(event: AuditEvent): boolean {
  return isHighValueAction(event.action);
}
