import type { EventSource, IsoDateTime, Page, PageRequest } from "./common";
import type { PermissionKey } from "./permission";
import type { ActorRef } from "./user";

/**
 * ★ THE AUDIT LEDGER ★
 *
 * One append-only record of what happened, for the whole organization.
 *
 * Every module in Antcolos already keeps a history of its own — a settlement's
 * audit trail, an invoice's versions, the fuel ledger, a compliance
 * requirement's timeline, a load's event stream. Those stay exactly where they
 * are: they are the canonical record of their own module and this file does not
 * own them, replace them or write to them.
 *
 * What this adds is the ONE place an owner, a safety manager or an auditor can
 * ask "who did what, across everything, and when" without opening six screens.
 * Module histories are PROJECTED into it through typed adapters, and events
 * this module raises itself — a denied action, a cross-organization attempt —
 * are appended alongside them. There is no second audit log per module, and
 * there never will be.
 *
 * Three rules the type itself enforces:
 *  1. **Immutable.** Every field is `readonly`. There is no update method on
 *     the service, and no code path that rewrites or removes an event.
 *  2. **Corrections are appended.** A mistake produces a NEW event that points
 *     back at the one it corrects. Both stay on the record, forever.
 *  3. **Redacted at the boundary.** A change summary carries field names and
 *     safe values only. Passwords, tokens, full banking details and document
 *     contents never reach it — see `src/lib/audit/redaction.ts`.
 */

/* -------------------------------------------------------------------------- */
/* Where an event came from                                                    */
/* -------------------------------------------------------------------------- */

/**
 * WHO or WHAT produced the event. Deliberately not the same thing as the
 * channel it arrived on: a fuel import over the API is `imported` on `api`,
 * and a rule that concluded something from other events is `inferred`.
 *
 *  - `human`       a person did it, in a session, as a membership.
 *  - `system`      Antcolos itself did it — a scheduled sweep, a derivation.
 *  - `integration` an outside system did it through a connected integration.
 *  - `imported`    it came in as a batch or a file somebody handed us.
 *  - `inferred`    nobody reported it; Antcolos concluded it from other events.
 *
 * `inferred` is the one that must never be read as fact. A screen showing an
 * inferred event says so, because an inference presented as an observation is
 * how an audit trail starts lying.
 */
export type AuditEventSource =
  | "human"
  | "system"
  | "integration"
  | "imported"
  | "inferred";

/** Whether the attempt actually did anything. A refusal is still evidence. */
export type AuditOutcome = "succeeded" | "denied" | "failed";

/**
 * The producing module. Used for filtering and for saying, on screen, which
 * module's canonical record an ingested event was read from.
 */
export type AuditModule =
  | "access"
  | "organization"
  | "banking"
  | "directory"
  | "documents"
  | "loads"
  | "dispatch"
  | "fleet"
  | "drivers"
  | "fuel"
  | "compliance"
  | "maintenance"
  | "insurance"
  | "settlements"
  | "invoices"
  | "integrations"
  | "risk";

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * `module.action`. Coarse on purpose.
 *
 * A projected event ALSO keeps the producing module's own key in
 * `sourceAction` — `transaction.marked_duplicate`, say — so nothing is lost in
 * translation and the module stays the authority on its own vocabulary. This
 * union is the shared filter and grouping vocabulary on top of that, not a
 * replacement for it.
 */
export type AuditAction =
  /* Access, identity and permissions ------------------------------------- */
  | "access.signed_in"
  | "access.sign_in_failed"
  | "access.permission_granted"
  | "access.permission_revoked"
  | "access.role_changed"
  | "access.member_invited"
  | "access.member_joined"
  | "access.member_suspended"
  | "access.member_reinstated"
  | "access.scope_changed"
  | "access.permission_denied"
  | "access.cross_organization_attempt"
  | "access.export_performed"
  /* The organization itself ---------------------------------------------- */
  | "organization.settings_changed"
  | "organization.ownership_changed"
  | "organization.operating_authority_changed"
  | "organization.signer_changed"
  | "organization.relationship_started"
  | "organization.relationship_ended"
  /* Money-routing details. Separated from organization settings because the
     value of knowing one of these moved is not the same as the rest. -------- */
  | "banking.details_changed"
  | "banking.payout_details_changed"
  /* Documents ------------------------------------------------------------- */
  | "documents.uploaded"
  | "documents.replaced"
  | "documents.approved"
  | "documents.rejected"
  | "documents.shared"
  | "documents.share_revoked"
  | "documents.downloaded"
  /* Operational modules, projected from their own histories ---------------- */
  | "loads.timeline_appended"
  | "dispatch.assignment_changed"
  | "fleet.record_changed"
  | "drivers.record_changed"
  | "directory.party_changed"
  | "fuel.ledger_changed"
  | "compliance.requirement_changed"
  | "maintenance.record_changed"
  | "insurance.record_changed"
  | "settlements.record_changed"
  | "invoices.record_changed"
  | "integrations.connection_changed"
  /* This module's own work ------------------------------------------------ */
  | "risk.signal_raised"
  | "risk.signal_dismissed"
  | "risk.case_opened"
  | "risk.case_assigned"
  | "risk.case_state_changed"
  | "risk.case_note_added"
  | "risk.case_evidence_added"
  | "risk.case_decision_recorded"
  | "audit.event_corrected"
  | "audit.export_prepared";

/* -------------------------------------------------------------------------- */
/* What an event is about                                                      */
/* -------------------------------------------------------------------------- */

export type AuditEntityKind =
  | "organization"
  | "membership"
  | "invitation"
  | "permission_template"
  | "user"
  | "load"
  | "truck"
  | "trailer"
  | "driver"
  | "document"
  | "party"
  | "customer"
  | "settlement"
  | "invoice"
  | "fuel_transaction"
  | "mileage_record"
  | "ifta_period"
  | "compliance_requirement"
  | "maintenance_record"
  | "policy"
  | "claim"
  | "integration"
  | "risk_signal"
  | "risk_case"
  | "audit_event";

export interface AuditEntityRef {
  readonly kind: AuditEntityKind;
  readonly id: string;
  /** Snapshot label: still readable after the record is renamed or ended. */
  readonly label: string;
  /** Route to the record, when a screen for it exists on this branch. */
  readonly href?: string;
}

/* -------------------------------------------------------------------------- */
/* Safe change summaries                                                       */
/* -------------------------------------------------------------------------- */

/** The only value shapes an audit payload may carry. Nothing structured. */
export type AuditValue = string | number | boolean | null;

export type AuditRedactionReason =
  /** The field name matched the sensitive list — never stored, in any form. */
  | "sensitive_field"
  /** An object, array or function. Audit payloads hold scalars only. */
  | "unsupported_type"
  /** Longer than an audit summary may carry; document bodies land here. */
  | "too_long";

/**
 * One field that moved. `before` and `after` are ABSENT when redacted — not
 * emptied, not hashed, not truncated. A redacted change still records that the
 * field changed, which is the part an auditor needs.
 */
export interface AuditFieldChange {
  readonly field: string;
  /** Plain-language field name for the screen. Falls back to the path. */
  readonly label: string;
  readonly before?: AuditValue;
  readonly after?: AuditValue;
  readonly redacted: boolean;
  readonly redactionReason?: AuditRedactionReason;
}

export interface AuditChangeSummary {
  readonly changes: readonly AuditFieldChange[];
  /** How many of the above carry no values, so the screen can say so. */
  readonly redactedCount: number;
}

/* -------------------------------------------------------------------------- */
/* The event                                                                   */
/* -------------------------------------------------------------------------- */

/** Where a projected event was read from. Absent on natively raised events. */
export interface AuditProjection {
  readonly module: AuditModule;
  /** The producing module's own record id. This module never edits it. */
  readonly recordId: string;
  /** Its own history entry id, when it keeps one. */
  readonly entryId?: string;
}

/**
 * IMMUTABLE. Every field is readonly and the service exposes no update. A
 * correction is a new event carrying `correctsEventId`.
 */
export interface AuditEvent {
  readonly id: string;
  readonly organizationId: string;
  /** Attribution snapshot: readable after the person leaves the organization. */
  readonly actor: ActorRef;
  /** The membership the action was taken as. Never a user id on its own. */
  readonly membershipId: string;
  readonly module: AuditModule;
  readonly action: AuditAction;
  /** The producing module's own action key, kept verbatim. */
  readonly sourceAction?: string;
  readonly entity: AuditEntityRef;
  readonly relatedEntities?: readonly AuditEntityRef[];
  readonly source: AuditEventSource;
  /** The channel it arrived on. Orthogonal to `source`. */
  readonly channel: EventSource;
  readonly outcome: AuditOutcome;
  /** When it happened. What the timeline is ordered by. */
  readonly occurredAt: IsoDateTime;
  /** When the ledger learned about it. Differs for imports and batches. */
  readonly recordedAt: IsoDateTime;
  /** Groups everything one intent produced, across modules. */
  readonly correlationId: string;
  /** The single call. Unique per event; two events never share one. */
  readonly requestId: string;
  /** What happened, in the operator's language. */
  readonly summary: string;
  readonly changes?: AuditChangeSummary;
  /** For permission-sensitive actions: what was needed, and what was missing. */
  readonly permissionContext?: {
    readonly required: readonly PermissionKey[];
    readonly missing?: readonly PermissionKey[];
  };
  /** Set on a correcting event. The corrected event is never touched. */
  readonly correctsEventId?: string;
  readonly correctionReason?: string;
  /** Set when this event was projected from another module's own history. */
  readonly projection?: AuditProjection;
}

/* -------------------------------------------------------------------------- */
/* Reading the ledger                                                          */
/* -------------------------------------------------------------------------- */

export interface AuditEventFilters {
  /** Matches the summary, the entity label and the actor name. */
  search?: string;
  module?: AuditModule[];
  action?: AuditAction[];
  source?: AuditEventSource[];
  outcome?: AuditOutcome[];
  /** Actor history: everything one membership did. */
  actorMembershipId?: string;
  entityKind?: AuditEntityKind[];
  /** Entity links: everything that happened to one record. */
  entityId?: string;
  /** Everything one intent produced, across modules. */
  correlationId?: string;
  /** ISO instants, inclusive. */
  from?: IsoDateTime;
  to?: IsoDateTime;
}

export interface AuditEventQuery extends PageRequest {
  filters?: AuditEventFilters;
}

export type AuditEventPage = Page<AuditEvent>;

/**
 * An event plus the corrections appended against it. The correction chain is
 * resolved on read rather than stored, because storing it on the original
 * would mean writing to an immutable record.
 */
export interface AuditEventDetail {
  readonly event: AuditEvent;
  /** Events whose `correctsEventId` is this event, oldest first. */
  readonly corrections: readonly AuditEvent[];
  /** The event this one corrects, when it corrects one. */
  readonly corrected?: AuditEvent;
  /** Everything sharing this event's correlation id, oldest first. */
  readonly correlated: readonly AuditEvent[];
}

/* -------------------------------------------------------------------------- */
/* Export-ready views                                                           */
/* -------------------------------------------------------------------------- */

export interface AuditExportColumn {
  readonly key: string;
  readonly label: string;
}

export type AuditExportRow = Readonly<Record<string, string>>;

/**
 * A flat, ready-to-serialize projection of a filtered ledger read.
 *
 * It is a VIEW, not a file: nothing is written to disk, emailed, uploaded or
 * transmitted. The screen renders it and says exactly that, so nobody believes
 * an export has been delivered somewhere.
 */
export interface AuditExportView {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly generatedAt: IsoDateTime;
  readonly generatedBy: ActorRef;
  readonly filters: AuditEventFilters;
  readonly columns: readonly AuditExportColumn[];
  readonly rows: readonly AuditExportRow[];
  /** True when the row cap trimmed the result. Never silent. */
  readonly truncated: boolean;
  readonly totalMatching: number;
  /** Shown verbatim on screen and carried into whatever consumes this. */
  readonly notice: string;
}
