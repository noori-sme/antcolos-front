import type { PermissionKey } from "./permission";
import type { ActorRef } from "./user";

/**
 * Needs You is the primary Home surface: decisions and exceptions, not
 * analytics. Every item carries severity, due time, affected entity, reason,
 * recommended action, owner, source and audit history — enough to act without
 * navigating through several modules.
 */

export type NeedsYouSeverity = "critical" | "high" | "medium" | "low";

export type NeedsYouCategory =
  | "rate_con_verification"
  | "unassigned_load"
  | "missing_equipment"
  | "status_confirmation"
  | "eta_risk"
  | "missing_document"
  | "detention"
  | "expiring_document"
  | "settlement_review"
  | "settlement_missing_data"
  | "settlement_dispute"
  | "settlement_payment_overdue"
  | "invoice_review"
  | "invoice_dispute"
  | "invoice_overdue"
  | "customer_response"
  | "truck_going_empty"
  // Fuel & IFTA. Derived from the fuel ledger itself, never hand-written.
  | "missing_fuel_receipt"
  | "invalid_mileage"
  | "duplicate_fuel_purchase"
  | "suspicious_fuel_transaction"
  | "incomplete_ifta_period"

  // Safety & Compliance. These come from compliance requirements, which are
  // separate records from the documents that may satisfy them.
  | "compliance_missing"
  | "compliance_rejected"
  | "compliance_expiring"
  | "compliance_expired"
  | "compliance_critical"

  /* ---- ELD & Telematics. Derived from devices, bindings and the event
     stream itself, never seeded. Each one is a real inconsistency somebody can
     go and fix, and each one disappears when they do. ---- */
  /** A device is linked but nothing usable has arrived inside its expectation. */
  | "telemetry_stale"
  /** A binding points at a device, truck or driver that no longer lines up. */
  | "telemetry_binding_broken"
  /** A device or connection has stopped reporting, or was taken down. */
  | "telemetry_device_disconnected"
  /** Two sources disagree about a truck's odometer by more than tolerance. */
  | "telemetry_odometer_conflict"
  /** Equipment is reporting a fault its provider marked critical. */
  | "telematics_diagnostic"

  // Fleet operations. Derived from the permanent records, never hand-written.
  | "stale_location"
  | "invalid_assignment"
  | "equipment_unavailable"
  | "operational_blocker"

  // Maintenance. Raised from the maintenance registry, not stored as fixtures.
  | "overdue_service"
  | "critical_defect"
  | "unresolved_repair"
  | "equipment_out_of_service"

  // Insurance and claims. Derived from the insurance registry rather than
  // seeded, so an item disappears when the underlying policy or claim is
  // actually sorted out and never because somebody ticked it off.
  | "missing_coverage"
  | "expiring_policy"
  | "expired_policy"
  | "unresolved_claim"
  | "missing_claim_evidence"
  | "critical_insurance_gap"

  /* ---- MT Loop conditions. Derived from live state, never seeded. ---- */
  /** An open MT Loop nobody has ACCEPTED. It still has a responsible party. */
  | "unassigned_loop"
  /** A truck is going empty and nobody has recorded when or where. */
  | "missing_availability"
  /** The truck runs under a different authority than the one that granted us access. */
  | "operating_authority"
  /** An MT Loop stopped by a problem rather than by a choice. */
  | "blocked_loop"
  /**
   * A downstream projection of a canonical change could not finish on its own.
   *
   * Two shapes, both actionable: it FAILED and can be run again, or it needs a
   * person to decide something a rule must not decide for them — which a
   * possible duplicate broker profile is the archetype of.
   */
  | "projection_failed"
  | "projection_needs_review"
  /** Two workspaces, or two loads, laying claim to the same thing. */
  | "assignment_conflict"
  /**
   * A dispatch organization has raised one of this carrier's trucks back to
   * them. The only routine way work crosses an organization boundary.
   */
  | "dispatch_escalation"
  /** The truck goes empty sooner than the loop is being worked. */
  | "sla_deadline"
  /** A truck is empty and nobody has started looking for a load for it. */
  | "no_search"
  /** A prepared message is sitting unread. */
  | "draft_waiting"
  /** A load worth having is about to be unbookable. */
  | "expiring_opportunity"
  /** A broker has answered and the conversation is waiting on us. */
  | "broker_replied"
  /** A price the broker gave is about to stop being good. */
  | "offer_expiring"
  /** A price is agreed and nothing has been booked on it. */
  | "agreed_not_booked"
  /** A booked load the driver has not accepted yet. */
  | "driver_consent"
  /** A booked load whose broker is not linked to a permanent profile. */
  | "broker_profile_unlinked"
  /** A prepared message nobody has read. */
  | "message_waiting"
  /** A rate confirmation has arrived and nobody has checked it. */
  | "ratecon_waiting"
  /** A rate confirmation disagrees with what was booked. */
  | "ratecon_disagrees"
  /** A booked load with no rate confirmation at all. */
  | "ratecon_missing"
  /** An opportunity is sitting with a driver who has not answered. */
  | "driver_review_waiting"
  /** The driver said no, or wants something answered first. */
  | "driver_blocked"
  /** The driver will take it, at a different number. */
  | "driver_countered"

  /* ---- Contracts and relationships. Derived from contract state. ---- */
  /** A version is out for signature and somebody has not signed it. */
  | "contract_signature_missing"
  /** An agreement is inside its OWN renewal reminder window. */
  | "contract_expiring"
  /** It ran out and nothing renewed or replaced it. */
  | "contract_expired"
  /** Something the agreement asks for is missing or has run out. */
  | "contract_requirement_unmet"
  /** Notice was given and the closeout is not finished. */
  | "contract_termination_unresolved"
  /** A draft was sent for review and nobody has read it. */
  | "contract_review_waiting"

  /* ---- Workforce & HR. Derived from engagement state and from the modules
     onboarding reads. Raised ONLY when a person must act: an active engagement
     with nothing outstanding produces nothing at all, which is what keeps this
     from becoming an HR inbox. ---- */
  /** Somebody was taken forward and nobody has decided about them. */
  | "workforce_applicant_review"
  /** A step required for activation is blocked in the module that owns it. */
  | "workforce_onboarding_blocked"
  /** Everything onboarding asks for is done and nobody has started them. */
  | "workforce_start_approval"
  /** An offboarding step failed and the person still holds what it would end. */
  | "workforce_offboarding_incomplete"
  /**
   * Somebody was expected back from leave and nobody has said whether they are.
   *
   * Raised because Antcolos will not assume a return: an expected date passing
   * is not evidence that anybody came back, and quietly marking them available
   * is how work reaches somebody who is still away.
   */
  | "workforce_leave_return_due"

  /* ---- Driver qualification file. Derived from the custody records. ---- */
  /** A driver shared a document this carrier has not reviewed or adopted. */
  | "qualification_review_required"
  /** The driver replaced a version this carrier adopted and relies on. */
  | "qualification_replacement_available"

  /* ---- Access. Derived from acceptance runs that did not finish. ---- */
  /**
   * Somebody accepted an invitation and one of the records it creates did not
   * finish. They are part-connected: visible, recoverable, and stuck until
   * either they accept again or somebody here notices.
   */
  | "invitation_acceptance_incomplete"

  /* ---- Import. Derived from claims the matcher would not decide. ---- */
  /**
   * A row from a carrier's own records that could be one of their people and
   * could be somebody new, and nothing in it proves which.
   *
   * The whole reason the import stops. Guessing costs a second permanent
   * identity for somebody who already had one, and nobody notices until they
   * count — so the row waits here for a person who can actually tell.
   */
  | "import_claim_unresolved"

  /* ---- Audit & Risk. Derived from open risk cases, never seeded. ---- */
  /** A high-severity risk case somebody has been made responsible for. */
  | "risk_case_assigned"
  /** A critical risk case. These never wait on a queue being tidied. */
  | "risk_case_critical"
  /** An open risk case whose due date has passed. */
  | "risk_case_overdue";

export type NeedsYouStatus = "open" | "snoozed" | "resolved" | "escalated";

export type NeedsYouSource = "system" | "telegram" | "eld" | "ocr" | "manual";

export type NeedsYouEntityKind =
  | "load" | "truck" | "driver" | "document" | "customer" | "settlement" | "invoice"
  | "fuel_transaction" | "mileage_record" | "ifta_period"

  | "load" | "truck" | "trailer" | "driver" | "document" | "customer"
  | "settlement" | "invoice" | "organization" | "person"
  | "compliance_requirement"

  | "settlement" | "invoice"

  | "load" | "truck" | "driver" | "document" | "customer" | "settlement" | "invoice"
  // Maintenance records. A trailer is its own kind, never a truck.
  | "trailer" | "maintenance_requirement" | "defect" | "repair_order"

  | "load" | "truck" | "trailer" | "driver" | "document" | "customer"
  | "settlement" | "invoice" | "policy" | "claim" | "carrier"

  | "load" | "truck" | "driver" | "document" | "customer" | "settlement" | "invoice"
  /** One MT Loop — a single truck's cycle between loads. */
  | "mt_loop"
  /** A carrier organization. Not a customer: a carrier moves the freight. */
  | "carrier"
  /** One load on offer, from whatever source. */
  | "listing"
  /** A prepared message to a broker. */
  | "draft"
  /** One conversation with a broker about one load for one truck. */
  | "negotiation"
  /** A load that was booked out of the Opportunity Inbox. */
  | "booking"
  /** One prepared message to a broker, in a conversation. */
  | "message"
  /** A rate confirmation being checked. */
  | "rate_confirmation"
  /** An opportunity sent to a driver for review. */
  | "driver_review"
  /** One agreement. Never the relationship it papers. */
  | "contract"
  /** One immutable version of one agreement. */
  | "contract_version"
  /** One investigation, opened off one or more risk signals. */
  | "risk_case"
  /** One person's working relationship with one organization. */
  | "workforce_engagement"
  /** One invitation to one person. Never the seat it would create. */
  | "invitation"
  /** One carrier's pinned custody record of one document version. */
  | "qualification_record"
  /**
   * One row of what a carrier asserted while importing their own records.
   *
   * NEVER a person, a truck or an organization. It is evidence of a claim, and
   * the moment it becomes one of those it stops being a claim — which is the
   * property that keeps an import from growing into a second registry.
   */
  | "import_claim"
  /** One ELD or telematics device. Never the truck it happens to be on. */
  | "eld_device"
  /** One organization's link to a provider. */
  | "eld_connection";

export interface NeedsYouEntityRef {
  kind: NeedsYouEntityKind;
  id: string;
  label: string;
  /** Route to the entity, when the module exists. */
  href?: string;
}

export type NeedsYouActionKind =
  | "verify" | "assign_load" | "contact_driver" | "request_document"
  | "review" | "confirm_status" | "start_search" | "contact_customer"
  | "attach_receipt" | "review_mileage" | "resolve_duplicate" | "complete_period"

  | "open_compliance" | "assign_responsibility"

  | "record_location" | "fix_assignment" | "review_equipment"

  | "approve_settlement" | "resolve_dispute" | "record_payment"

  // Maintenance
  | "schedule_service" | "open_repair_order" | "review_defect" | "return_to_service"

  | "renew_policy" | "add_coverage" | "advance_claim" | "collect_evidence"

  /** Take, or hand out, responsibility for an MT Loop. */
  | "assign_loop"
  /** Record when and where a truck goes empty. */
  | "update_availability"
  /** Look at who is actually entitled to run or dispatch the truck. */
  | "review_authority"
  /** Begin looking for a load for a truck. */
  | "start_search"
  /** Read a prepared message before it can go anywhere. */
  | "review_draft"
  /** Answer a broker who has come back to us. */
  | "answer_broker"
  /** Turn an agreed price into a load. */
  | "book_load"
  /** Ask the driver whether they will take it. */
  | "ask_driver"
  /** Read a prepared message and decide whether it goes. */
  | "read_message"
  /** Check a rate confirmation against what was booked. */
  | "check_ratecon"
  /** Chase, or answer, a driver who has the opportunity. */
  | "chase_driver"

  /* ---- Contracts ---- */
  /** Sign a version, for a party the person is authorised to sign for. */
  | "sign_contract"
  /** Ask the other party for a signature nobody else may give. */
  | "chase_signature"
  /** Read a draft somebody sent for review, and decide. */
  | "review_contract"
  /** Renew an agreement, or give notice that it will not renew. */
  | "renew_contract"
  /** Produce whatever an agreement is asking for. */
  | "satisfy_requirement"
  /** Work through the closeout steps of a termination. */
  | "complete_termination"

  /* ---- Access ---- */
  /** Look at an acceptance that did not finish, and at what is missing. */
  | "review_acceptance"

  /* ---- Import ---- */
  /** Say which existing record an imported row is, or that it is nobody's. */
  | "resolve_import_claim"

  /* ---- Workforce & HR ---- */
  /** Decide whether to take a prospective person forward. Never automatic. */
  | "review_applicant"
  /** Open the engagement and deal with whatever is blocking onboarding. */
  | "open_engagement"
  /** Start somebody whose onboarding is finished. */
  | "start_engagement"
  /** Finish an offboarding step that did not complete. */
  | "finish_offboarding"

  /* ---- Driver qualification file ---- */
  /** Look at a shared document version and decide whether to rely on it. */
  | "review_qualification_document"

  /* ---- Audit & Risk ---- */
  /** Open the case and work it. The queue is never where a case is closed. */
  | "investigate_risk"

  /* ---- ELD & Telematics ---- */
  /** Look at a device that has gone quiet or is reporting an error. */
  | "check_device"
  /** Put the device-to-truck or driver-to-device binding right. */
  | "fix_binding"
  /** Reconcile two odometer readings that disagree. */
  | "reconcile_odometer"
  /** Look at a fault the equipment is reporting. */
  | "review_diagnostic";

export interface NeedsYouRecommendedAction {
  kind: NeedsYouActionKind;
  label: string;
  /** Permission required to perform it. */
  requires: PermissionKey[];
  /**
   * Straight to where the thing is FIXED, not to the dashboard it was noticed on.
   *
   * Needs You only earns its place as a daily surface if an item takes a person
   * to the action. Absent falls back to `entity.href`, which points at the record
   * rather than at the resolution — a worse answer, and the reason this field
   * exists.
   */
  href?: string;
  /** Set when the destination screen is not built yet. */
  deferred?: boolean;
}

export interface NeedsYouHistoryEntry {
  id: string;
  at: string;
  actor: ActorRef;
  action:
    | "created" | "assigned" | "snoozed" | "unsnoozed"
    | "escalated" | "resolved" | "reopened" | "note";
  note?: string;
  /** For snoozes. */
  until?: string;
}

export interface NeedsYouItem {
  id: string;
  organizationId: string;
  category: NeedsYouCategory;
  severity: NeedsYouSeverity;
  status: NeedsYouStatus;
  title: string;
  /** Why this is here, in the operator's language. */
  reason: string;
  detail?: string;
  entity: NeedsYouEntityRef;
  relatedEntities?: NeedsYouEntityRef[];
  recommendedAction: NeedsYouRecommendedAction;
  /** Operational deadline. Sorting is by urgency, which combines this with severity. */
  dueAt?: string;
  assigneeMembershipId?: string;
  source: NeedsYouSource;
  /** Permission required to see this item at all. */
  requires: PermissionKey[];
  /**
   * True when the item is COMPUTED from another module's state rather than
   * stored here — a settlement blocked by missing data, say.
   *
   * A derived item cannot be assigned, snoozed, escalated or resolved, because
   * there is nothing to write to and hiding the row would not fix the thing it
   * is about. It stops appearing when the underlying state stops producing it,
   * which is the only honest way to close it.
   */
  derived?: boolean;
  /**
   * What the system already did, and the one decision it stopped on.
   *
   * Optional on the type and never optional in practice: the service attaches
   * one to every item it returns. It stays optional so a producer that has not
   * been taught its own playbook yet still type-checks, and so a stored record
   * from before this existed still reads.
   */
  automation?: NeedsYouAutomation;
  createdAt: string;
  snoozedUntil?: string;
  snoozeReason?: string;
  resolvedAt?: string;
  resolutionNote?: string;
  history: NeedsYouHistoryEntry[];
}

export interface NeedsYouFilters {
  severity?: NeedsYouSeverity[];
  category?: NeedsYouCategory[];
  status?: NeedsYouStatus[];
  entityKind?: NeedsYouEntityKind[];
  /** "me" resolves to the caller's membership; "unassigned" matches no assignee. */
  owner?: "all" | "me" | "unassigned";
  /** Only items due within this many hours. */
  dueWithinHours?: number;
  search?: string;
}

export const SEVERITY_ORDER: Record<NeedsYouSeverity, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
};

export const SEVERITY_LABEL: Record<NeedsYouSeverity, string> = {
  critical: "Critical", high: "High", medium: "Medium", low: "Low",
};

export const CATEGORY_LABEL: Record<NeedsYouCategory, string> = {
  invitation_acceptance_incomplete: "Acceptance did not finish",
  import_claim_unresolved: "Imported row needs you",
  rate_con_verification: "Rate con to verify",
  unassigned_load: "Unassigned load",
  missing_equipment: "Missing equipment",
  status_confirmation: "Status confirmation",
  eta_risk: "ETA risk",
  missing_document: "Missing document",
  detention: "Possible detention",
  expiring_document: "Document expiry",
  settlement_review: "Settlement review",
  settlement_missing_data: "Settlement missing data",
  settlement_dispute: "Settlement disputed",
  settlement_payment_overdue: "Settlement overdue",
  invoice_review: "Invoice review",
  invoice_dispute: "Invoice disputed",
  invoice_overdue: "Invoice overdue",
  customer_response: "Customer waiting",
  truck_going_empty: "Truck going empty",
  missing_fuel_receipt: "Missing fuel receipt",
  invalid_mileage: "Invalid mileage record",
  duplicate_fuel_purchase: "Duplicate fuel purchase",
  suspicious_fuel_transaction: "Fuel purchase to check",
  incomplete_ifta_period: "IFTA quarter incomplete",
  telemetry_stale: "Telemetry has gone stale",
  telemetry_binding_broken: "Device binding is broken",
  telemetry_device_disconnected: "Device disconnected",
  telemetry_odometer_conflict: "Odometer readings disagree",
  telematics_diagnostic: "Critical diagnostic reported",
  compliance_missing: "Compliance evidence missing",
  compliance_rejected: "Compliance evidence rejected",
  compliance_expiring: "Compliance expiring", compliance_expired: "Compliance expired",
  compliance_critical: "Critical compliance issue", stale_location: "Stale location",
  invalid_assignment: "Invalid assignment",
  equipment_unavailable: "Equipment unavailable",
  operational_blocker: "Operational blocker", overdue_service: "Overdue service",
  critical_defect: "Critical defect", unresolved_repair: "Unresolved repair",
  equipment_out_of_service: "Equipment out of service",
  missing_coverage: "Missing coverage", expiring_policy: "Expiring policy",
  expired_policy: "Expired policy", unresolved_claim: "Unresolved claim",
  missing_claim_evidence: "Missing claim evidence",
  critical_insurance_gap: "Critical insurance gap",
  // The loop has a responsible party; nobody has accepted it.
  unassigned_loop: "MT Loop nobody has claimed",
  missing_availability: "Missing availability",
  operating_authority: "Operating Authority conflict", blocked_loop: "Blocked MT Loop",
  projection_failed: "Update did not finish",
  projection_needs_review: "Needs your decision",
  assignment_conflict: "Assignment conflict",
  dispatch_escalation: "Your dispatcher needs you",
  sla_deadline: "Deadline approaching",
  no_search: "Nobody is looking", draft_waiting: "Message waiting for you",
  expiring_opportunity: "Load about to go", broker_replied: "Broker answered",
  offer_expiring: "Offer about to lapse", agreed_not_booked: "Agreed, not booked",
  driver_consent: "Driver has not accepted",
  broker_profile_unlinked: "Broker profile not linked",
  message_waiting: "Message waiting to be read",
  ratecon_waiting: "Rate confirmation to check",
  ratecon_disagrees: "Rate confirmation disagrees",
  ratecon_missing: "No rate confirmation yet",
  driver_review_waiting: "Waiting on the driver", driver_blocked: "Driver said no",
  driver_countered: "Driver countered",
  contract_signature_missing: "Signature missing",
  contract_expiring: "Contract expiring",
  contract_expired: "Contract expired",
  contract_requirement_unmet: "Contract requirement outstanding",
  contract_termination_unresolved: "Termination unfinished",
  contract_review_waiting: "Contract waiting for review",
  workforce_applicant_review: "Somebody waiting on a decision",
  workforce_onboarding_blocked: "Onboarding blocked",
  workforce_start_approval: "Ready to start",
  workforce_offboarding_incomplete: "Offboarding unfinished",
  workforce_leave_return_due: "Expected back from leave",
  qualification_review_required: "Qualification document to review",
  qualification_replacement_available: "Newer version available",
  risk_case_assigned: "Risk case assigned to you",
  risk_case_critical: "Critical risk case",
  risk_case_overdue: "Risk case overdue",
};

/**
 * High-risk items may be snoozed briefly to clear the queue, never parked.
 * Snooze options are capped by severity so nothing critical disappears.
 */
export const MAX_SNOOZE_HOURS: Record<NeedsYouSeverity, number> = {
  critical: 2, high: 8, medium: 24, low: 72,
};

/* -------------------------------------------------------------------------- */
/* Automation: what the system already did, and the one decision left          */
/* -------------------------------------------------------------------------- */

/**
 * ★ NEEDS YOU IS A DECISION QUEUE, NOT A WORK QUEUE ★
 *
 * An item earns its place here only when the system has already run everything
 * that can be run unattended — found the condition, gathered the evidence,
 * contacted whoever had to be contacted, priced the options — and has stopped
 * at the one step a rule must not take on somebody's behalf.
 *
 * So every item carries its own automation record: the steps already done, the
 * options already worked out, and, once a person picks one, what the system did
 * next. A person's whole job on this screen is one press.
 */

export type NeedsYouAutomationStage =
  /** Pre-work is finished and the system is stopped on a human decision. */
  | "awaiting_decision"
  /** A decision was taken; the downstream steps are running. */
  | "executing"
  /** Everything downstream of the decision has finished. */
  | "done"
  /**
   * Nothing here can execute it: the item is a view of another module's state,
   * so the single action is to open that module. One press either way.
   */
  | "handoff";

/** One thing the system did on its own, before anybody was asked. */
export interface NeedsYouPreworkStep {
  id: string;
  /** Five words at most. "3 quotes collected", "Broker reply parsed". */
  label: string;
  /** The long version. Rendered on hover, never inline. */
  detail?: string;
  at: string;
}

export type NeedsYouMetricTone = "good" | "warn" | "bad" | "neutral";

/**
 * One number worth comparing across options, already formatted.
 *
 * Formatted at the source on purpose: the currency, the interval and the
 * rounding are facts about the quote, and a screen that re-derives them is a
 * screen that can disagree with the document the number came from.
 */
export interface NeedsYouMetric {
  /** "Premium", "Coverage", "Rating". One word where possible. */
  label: string;
  value: string;
  tone?: NeedsYouMetricTone;
  /** Hover-only context. Never rendered inline. */
  detail?: string;
}

export type NeedsYouOptionIntent =
  /** Take it. The system resumes and finishes the workflow. */
  | "approve"
  /** Take none of them. The system stands down and records why. */
  | "decline"
  /** The decision belongs in the module that owns the record. */
  | "open";

export interface NeedsYouDecisionOption {
  id: string;
  /**
   * The button. Carries the commitment: "Approve $1,840/mo", not "Approve".
   * Somebody must be able to act on it without opening anything.
   */
  label: string;
  /** Column heading when options are compared side by side. */
  name?: string;
  intent: NeedsYouOptionIntent;
  /** The system's own pick. Exactly one option may carry it. */
  recommended?: boolean;
  /**
   * Comparable numbers. Present only where real records back them — an option
   * never invents a figure to fill a column.
   */
  metrics: NeedsYouMetric[];
  /** What runs, unattended, the moment this is pressed. Short phrases. */
  downstream: string[];
  /** For `open`: where a person finishes it. */
  href?: string;
}

export type NeedsYouExecutionState = "queued" | "running" | "done";

export interface NeedsYouExecutionStep {
  label: string;
  state: NeedsYouExecutionState;
  at?: string;
}

/** What a person chose, and what the system did about it. */
export interface NeedsYouDecisionRecord {
  optionId: string;
  optionLabel: string;
  decidedAt: string;
  actor: ActorRef;
  steps: NeedsYouExecutionStep[];
}

export interface NeedsYouAutomation {
  stage: NeedsYouAutomationStage;
  /** Steps the system ran unattended. */
  stepsDone: number;
  /** Steps in the whole workflow, the human decision included. */
  stepsTotal: number;
  prework: NeedsYouPreworkStep[];
  /** Empty only for a handoff. Otherwise at least one press finishes it. */
  options: NeedsYouDecisionOption[];
  decision?: NeedsYouDecisionRecord;
}

/** Share of the workflow the system carried, as a whole percentage. */
export function automationProgress(a: NeedsYouAutomation): number {
  if (a.stepsTotal <= 0) return 0;
  return Math.min(100, Math.round((a.stepsDone / a.stepsTotal) * 100));
}
