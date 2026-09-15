import type { IsoDateTime } from "./common";
import type { PermissionKey } from "./permission";
import type { ActorRef } from "./user";
import type { AuditEntityRef, AuditModule } from "./audit";

/**
 * ★ SIGNALS AND CASES ARE NOT AUDIT EVENTS ★
 *
 * Three concepts, kept apart on purpose, because collapsing any two of them
 * destroys the thing that makes an audit trail worth having:
 *
 *  - An **Audit Event** records WHAT HAPPENED. It is a fact. It is never
 *    edited, never deleted, and never carries an opinion.
 *  - A **Risk Signal** records that something MIGHT BE A CONCERN. It is a
 *    judgement produced by a rule, it points at the audit events that prompted
 *    it, and it can be wrong. Dismissing one never touches the events.
 *  - A **Risk Case** is the INVESTIGATION: who is looking at it, what they
 *    found, what they decided and when it ended. It groups signals; it does not
 *    absorb them.
 *
 * Every rule that produces a signal on this branch is a clearly labelled MOCK.
 * There is no fraud model, no scoring model, no outside monitoring and no
 * machine learning anywhere in this module, and no screen says otherwise.
 */

/* -------------------------------------------------------------------------- */
/* Severity                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Five bands, and `informational` is a real one: a rule that only ever speaks
 * when it is worried is a rule nobody can calibrate.
 */
export type RiskSeverity =
  | "informational"
  | "low"
  | "medium"
  | "high"
  | "critical";

export const RISK_SEVERITY_ORDER: Record<RiskSeverity, number> = {
  critical: 0, high: 1, medium: 2, low: 3, informational: 4,
};

export const RISK_SEVERITY_LABEL: Record<RiskSeverity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  informational: "Informational",
};

/** The two bands that mean a person has to look, not merely could. */
export const RISK_ATTENTION_SEVERITIES: readonly RiskSeverity[] = ["critical", "high"];

/* -------------------------------------------------------------------------- */
/* Rules                                                                       */
/* -------------------------------------------------------------------------- */

/** What a rule is looking for. One kind may have several rules behind it. */
export type RiskSignalKind =
  /** An action refused for want of permission, or attempted and refused. */
  | "unauthorized_action"
  /** Ownership, Operating Authority, signer, banking or payout details moved. */
  | "sensitive_record_change"
  /** Two records that should not both exist, or that disagree. */
  | "duplicate_or_conflict"
  /** A relationship, contract, equipment or assignment change that reads oddly. */
  | "suspicious_change"
  /** Repeated rejected uploads, or an unusual run of corrections. */
  | "repeated_rejection"
  /** A read or write aimed at another organization's records. */
  | "cross_organization_access"
  /** ELD, Maintenance, Insurance or Compliance state that cannot all be true. */
  | "critical_inconsistency";

export type RiskSignalStatus =
  /** Raised, and not yet part of a case. */
  | "new"
  /** Attached to a case. The case is now where the work happens. */
  | "linked"
  /** Judged not a concern. The audit events behind it are untouched. */
  | "dismissed";

/**
 * A rule definition. Declarative so the catalogue can be shown on screen —
 * including what it does NOT look at, which is the half that gets forgotten.
 */
export interface RiskRule {
  readonly id: string;
  readonly kind: RiskSignalKind;
  readonly label: string;
  /** What it flags, in the operator's language. */
  readonly description: string;
  readonly severity: RiskSeverity;
  /** Which modules' events it reads. It writes to none of them. */
  readonly reads: readonly AuditModule[];
  /**
   * Always true on this branch. A rule that cannot say it is a mock is a rule
   * somebody will eventually believe.
   */
  readonly mock: true;
  /** The honest limits of this rule, shown beside every signal it raises. */
  readonly limitations: string;
}

/* -------------------------------------------------------------------------- */
/* Signals                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A possible concern. Immutable except for its status and case link, both of
 * which are recorded as audit events when they change.
 */
export interface RiskSignal {
  readonly id: string;
  readonly organizationId: string;
  readonly ruleId: string;
  readonly kind: RiskSignalKind;
  readonly severity: RiskSeverity;
  readonly title: string;
  /** Why the rule spoke. Names the evidence; never asserts intent. */
  readonly rationale: string;
  readonly detectedAt: IsoDateTime;
  /** What it is about. */
  readonly entity: AuditEntityRef;
  readonly relatedEntities?: readonly AuditEntityRef[];
  /** The membership whose actions prompted it, when there is one. */
  readonly subjectActor?: ActorRef;
  /** The audit events this rests on. The events are NOT copied into it. */
  readonly auditEventIds: readonly string[];
  readonly status: RiskSignalStatus;
  /** Set once the signal is part of a case. */
  readonly caseId?: string;
  readonly dismissedAt?: IsoDateTime;
  readonly dismissedBy?: ActorRef;
  readonly dismissalReason?: string;
  /** Permission needed to see the signal at all. */
  readonly requires: readonly PermissionKey[];
  /** Always true here. Carried in the data so a screen cannot forget it. */
  readonly mock: true;
}

export interface RiskSignalFilters {
  search?: string;
  kind?: RiskSignalKind[];
  severity?: RiskSeverity[];
  status?: RiskSignalStatus[];
  ruleId?: string;
  entityId?: string;
  subjectMembershipId?: string;
  from?: IsoDateTime;
  to?: IsoDateTime;
}

/* -------------------------------------------------------------------------- */
/* Cases                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Seven states, and the three endings are deliberately different from each
 * other. "Resolved" means it was a problem and it was dealt with; "accepted
 * risk" means it was a problem and somebody senior decided to live with it;
 * "dismissed" means it was never a problem. Folding them into one would lose
 * the only three answers an auditor actually asks about.
 */
export type RiskCaseState =
  | "open"
  | "investigating"
  | "action_required"
  | "resolved"
  | "accepted_risk"
  | "dismissed"
  | "escalated";

export const RISK_CASE_OPEN_STATES: readonly RiskCaseState[] = [
  "open", "investigating", "action_required", "escalated",
];

export const RISK_CASE_CLOSED_STATES: readonly RiskCaseState[] = [
  "resolved", "accepted_risk", "dismissed",
];

export type RiskCaseTimelineAction =
  | "opened"
  | "signal_linked"
  | "signal_unlinked"
  | "assigned"
  | "unassigned"
  | "due_date_set"
  | "due_date_cleared"
  | "note_added"
  | "evidence_added"
  | "decision_recorded"
  | "state_changed"
  | "reopened";

/**
 * Append-only, exactly like the audit ledger. A correction is a new entry;
 * nothing here is ever edited or removed, and resolving a case does not erase
 * how it got there.
 */
export interface RiskCaseTimelineEntry {
  readonly id: string;
  readonly at: IsoDateTime;
  readonly actor: ActorRef;
  readonly action: RiskCaseTimelineAction;
  readonly note?: string;
  readonly fromState?: RiskCaseState;
  readonly toState?: RiskCaseState;
  /** The signal, evidence or membership the entry is about. */
  readonly relatedId?: string;
  /** The audit event this entry itself produced, so the two can be joined. */
  readonly auditEventId?: string;
}

export interface RiskCaseNote {
  readonly id: string;
  readonly at: IsoDateTime;
  readonly actor: ActorRef;
  readonly body: string;
}

/**
 * A pointer at evidence. Never a copy of it: a case references a document, an
 * audit event or a record by id, and the module that owns it stays the
 * authority on what it says.
 */
export interface RiskEvidenceRef {
  readonly id: string;
  readonly at: IsoDateTime;
  readonly addedBy: ActorRef;
  readonly kind: "audit_event" | "document" | "record" | "note";
  readonly ref: AuditEntityRef;
  readonly description: string;
}

export type RiskDecisionKind =
  | "no_action"
  | "corrective_action"
  | "policy_change"
  | "access_change"
  | "accepted_risk"
  | "escalated";

/**
 * A decision somebody took, recorded at the moment they took it. Separate from
 * the timeline because "what was decided, and by whom" is the first question
 * asked about a closed case and it should not have to be reconstructed.
 */
export interface RiskDecision {
  readonly id: string;
  readonly at: IsoDateTime;
  readonly actor: ActorRef;
  readonly kind: RiskDecisionKind;
  readonly rationale: string;
  /** The state the case moved to, when the decision moved it. */
  readonly resultingState?: RiskCaseState;
}

export interface RiskCase {
  readonly id: string;
  readonly organizationId: string;
  /** Human reference, unique within the organization. Never reused. */
  readonly reference: string;
  readonly title: string;
  readonly summary: string;
  /** Highest severity among the linked signals, recomputed when they change. */
  readonly severity: RiskSeverity;
  readonly state: RiskCaseState;
  readonly signalIds: readonly string[];
  /** Who is responsible. One membership, so nobody can be "the team". */
  readonly assigneeMembershipId?: string;
  readonly assigneeName?: string;
  readonly dueAt?: IsoDateTime;
  readonly notes: readonly RiskCaseNote[];
  readonly evidence: readonly RiskEvidenceRef[];
  readonly decisions: readonly RiskDecision[];
  /** Append-only. See RiskCaseTimelineEntry. */
  readonly timeline: readonly RiskCaseTimelineEntry[];
  readonly openedAt: IsoDateTime;
  readonly openedBy: ActorRef;
  readonly closedAt?: IsoDateTime;
  readonly resolutionNote?: string;
  /**
   * The memberships whose own actions are under investigation.
   *
   * This is what separation of duties is enforced against: a person in this
   * list cannot investigate, decide or close the case, however senior they are.
   */
  readonly subjectMembershipIds: readonly string[];
  /**
   * True when policy requires somebody other than the subject to review it.
   * Set by policy from severity, not by whoever opens the case.
   */
  readonly independentReviewRequired: boolean;
  readonly correlationIds: readonly string[];
  readonly mock: true;
}

/** List projection. Never carries the timeline, notes or evidence. */
export interface RiskCaseSummary {
  readonly id: string;
  readonly organizationId: string;
  readonly reference: string;
  readonly title: string;
  readonly severity: RiskSeverity;
  readonly state: RiskCaseState;
  readonly signalCount: number;
  readonly assigneeMembershipId?: string;
  readonly assigneeName?: string;
  readonly dueAt?: IsoDateTime;
  readonly openedAt: IsoDateTime;
  readonly closedAt?: IsoDateTime;
  readonly independentReviewRequired: boolean;
}

export interface RiskCaseFilters {
  search?: string;
  state?: RiskCaseState[];
  severity?: RiskSeverity[];
  /** "me" resolves to the caller's membership; "unassigned" matches no owner. */
  owner?: "all" | "me" | "unassigned";
  /** Only cases due within this many hours. */
  dueWithinHours?: number;
  overdue?: boolean;
  signalKind?: RiskSignalKind[];
  entityId?: string;
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                   */
/* -------------------------------------------------------------------------- */

export interface RiskDashboard {
  readonly organizationId: string;
  readonly generatedAt: IsoDateTime;
  /** Events in the ledger the caller may see, over the window. */
  readonly auditEventCount: number;
  readonly windowHours: number;
  readonly signalsBySeverity: Readonly<Record<RiskSeverity, number>>;
  readonly openSignalCount: number;
  readonly casesByState: Readonly<Record<RiskCaseState, number>>;
  readonly openCaseCount: number;
  readonly overdueCaseCount: number;
  /** Cases assigned to the caller that are open and high or critical. */
  readonly myAttentionCount: number;
  /** Denied or failed attempts in the window. The number nobody looks at. */
  readonly deniedActionCount: number;
  /** Always true here, and rendered on the dashboard itself. */
  readonly rulesAreMock: true;
}

/* -------------------------------------------------------------------------- */
/* Extension points                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The seams later work lands in. Every one is `available: false` and is
 * rendered as "not built" rather than as an empty count, because a screen
 * reading "0 fraud alerts" means Antcolos looked and found none, and Antcolos
 * has not looked and is connected to nothing that could.
 */
export type RiskExtensionKind =
  | "security_monitoring"
  | "fraud_detection"
  | "identity_verification"
  | "legal_hold"
  | "retention_policy"
  | "external_compliance";

export interface RiskExtensionPoint {
  readonly kind: RiskExtensionKind;
  readonly label: string;
  readonly description: string;
  /** False on this branch, for every entry, without exception. */
  readonly available: false;
  /** What it would read from the ledger when it lands. */
  readonly consumes: readonly AuditModule[];
  /** What it would add, so a later branch extends this instead of forking it. */
  readonly wouldAdd: string;
}

export const RISK_CASE_STATE_LABEL: Record<RiskCaseState, string> = {
  open: "Open",
  investigating: "Investigating",
  action_required: "Action required",
  resolved: "Resolved",
  accepted_risk: "Accepted risk",
  dismissed: "Dismissed",
  escalated: "Escalated",
};

export const RISK_SIGNAL_KIND_LABEL: Record<RiskSignalKind, string> = {
  unauthorized_action: "Unauthorized or refused action",
  sensitive_record_change: "Sensitive record changed",
  duplicate_or_conflict: "Duplicate or conflict",
  suspicious_change: "Change worth a look",
  repeated_rejection: "Repeated rejections or corrections",
  cross_organization_access: "Cross-organization access",
  critical_inconsistency: "Critical inconsistency",
};

export const RISK_DECISION_LABEL: Record<RiskDecisionKind, string> = {
  no_action: "No action needed",
  corrective_action: "Corrective action taken",
  policy_change: "Policy changed",
  access_change: "Access changed",
  accepted_risk: "Risk accepted",
  escalated: "Escalated",
};
