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
  /** An open MT Loop that nobody has taken responsibility for. */
  | "unassigned_loop"
  /** A truck is going empty and nobody has recorded when or where. */
  | "missing_availability"
  /** The truck runs under a different authority than the one that granted us access. */
  | "operating_authority"
  /** An MT Loop stopped by a problem rather than by a choice. */
  | "blocked_loop"
  /** Two workspaces, or two loads, laying claim to the same thing. */
  | "assignment_conflict"
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
  | "driver_countered";

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
  | "driver_review";

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
  | "chase_driver";

export interface NeedsYouRecommendedAction {
  kind: NeedsYouActionKind;
  label: string;
  /** Permission required to perform it. */
  requires: PermissionKey[];
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
  unassigned_loop: "MT Loop with nobody on it",
  missing_availability: "Missing availability",
  operating_authority: "Operating Authority conflict", blocked_loop: "Blocked MT Loop",
  assignment_conflict: "Assignment conflict", sla_deadline: "Deadline approaching",
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
};

/**
 * High-risk items may be snoozed briefly to clear the queue, never parked.
 * Snooze options are capped by severity so nothing critical disappears.
 */
export const MAX_SNOOZE_HOURS: Record<NeedsYouSeverity, number> = {
  critical: 2, high: 8, medium: 24, low: 72,
};
