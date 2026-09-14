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
  | "customer_response"
  | "truck_going_empty";

export type NeedsYouStatus = "open" | "snoozed" | "resolved" | "escalated";

export type NeedsYouSource = "system" | "telegram" | "eld" | "ocr" | "manual";

export type NeedsYouEntityKind =
  | "load" | "truck" | "driver" | "document" | "customer" | "settlement" | "invoice";

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
  | "approve_settlement" | "resolve_dispute" | "record_payment";

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
  expiring_document: "Expiring document",
  settlement_review: "Settlement review",
  settlement_missing_data: "Settlement missing data",
  settlement_dispute: "Settlement disputed",
  settlement_payment_overdue: "Settlement overdue",
  invoice_review: "Invoice review",
  customer_response: "Customer waiting",
  truck_going_empty: "Truck going empty",
};

/**
 * High-risk items may be snoozed briefly to clear the queue, never parked.
 * Snooze options are capped by severity so nothing critical disappears.
 */
export const MAX_SNOOZE_HOURS: Record<NeedsYouSeverity, number> = {
  critical: 2, high: 8, medium: 24, low: 72,
};
