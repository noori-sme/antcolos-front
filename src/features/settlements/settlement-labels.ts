import type {
  CompensationMethod,
  DisputeReason,
  DisputeResolution,
  MileageBasis,
  SettlementPaymentMethod,
  PercentageBasis,
  SettlementAdjustmentKind,
  SettlementAuditAction,
  SettlementDataGap,
  SettlementKind,
} from "@/types";

/**
 * Words this module shows people.
 *
 * Written for a carrier owner and a driver, not an engineer — a driver reading
 * their own statement should recognise every line on it. Nothing here branches
 * on a status or a permission; it only turns an enum into English.
 */

export const COMPENSATION_METHOD_LABEL: Record<CompensationMethod, string> = {
  percentage: "Percentage",
  fixed: "Fixed",
  per_mile: "Per mile",
  combined: "Combined",
};

export const PERCENTAGE_BASIS_LABEL: Record<PercentageBasis, string> = {
  gross_revenue: "gross revenue",
  linehaul: "linehaul",
  linehaul_plus_shared_accessorials: "linehaul plus shared accessorials",
};

export const MILEAGE_BASIS_LABEL: Record<MileageBasis, string> = {
  loaded: "loaded miles",
  deadhead: "deadhead miles",
  loaded_plus_deadhead: "loaded and deadhead miles",
};

export const ADJUSTMENT_KIND_LABEL: Record<SettlementAdjustmentKind, string> = {
  commission: "Commission",
  reimbursement: "Reimbursement",
  deduction: "Deduction",
  fuel_advance: "Fuel advance",
  lumper: "Lumper",
  other_expense: "Expense",
  adjustment: "Correction",
};

export const SETTLEMENT_KIND_LABEL: Record<SettlementKind, string> = {
  regular: "Settlement",
  adjustment: "Correction",
  revision: "Revision",
};

export const DISPUTE_REASON_LABEL: Record<DisputeReason, string> = {
  missing_load: "A load is missing",
  incorrect_rate: "The rate looks wrong",
  incorrect_miles: "The mileage looks wrong",
  unexpected_deduction: "A deduction I did not expect",
  missing_reimbursement: "Something I paid for was not paid back",
  incorrect_commission: "The commission looks wrong",
  other: "Something else",
};

export const DISPUTE_RESOLUTION_LABEL: Record<DisputeResolution, string> = {
  upheld: "Settlement stands",
  adjusted: "Corrected",
  withdrawn: "Withdrawn",
};

export const PAYMENT_METHOD_LABEL: Record<SettlementPaymentMethod, string> = {
  ach: "ACH",
  check: "Check",
  wire: "Wire",
  fuel_card: "Fuel card",
  cash: "Cash",
  other: "Other",
};

export const DATA_GAP_LABEL: Record<SettlementDataGap["kind"], string> = {
  missing_agreement: "No compensation terms",
  missing_rate: "No rate on the load",
  missing_miles: "No mileage on the load",
  missing_document: "Paperwork missing",
  missing_invoice: "Not invoiced yet",
  unapproved_expense: "Expense not approved",
  missing_payee_profile: "Payee record incomplete",
};

export const AUDIT_ACTION_LABEL: Record<SettlementAuditAction, string> = {
  created: "Opened",
  recalculated: "Recalculated",
  line_added: "Load added",
  line_removed: "Load removed",
  adjustment_added: "Adjustment added",
  adjustment_removed: "Adjustment removed",
  submitted_for_review: "Sent for review",
  approved: "Approved",
  snapshot_frozen: "Figures frozen",
  dispute_raised: "Disputed",
  dispute_message: "Dispute message",
  dispute_resolved: "Dispute closed",
  marked_ready_for_payment: "Queued for payment",
  payment_recorded: "Payment recorded",
  payment_reversed: "Payment reversed",
  statement_generated: "Statement produced",
  voided: "Voided",
  adjustment_settlement_created: "Correction raised",
  superseded: "Superseded",
};

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

export function formatDate(iso?: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
}

export function formatDateTime(iso?: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatMiles(miles: number): string {
  return `${miles.toLocaleString("en-US")} mi`;
}

/** Whole days past a due date. Negative means it is not due yet. */
export function daysPast(iso: string, from = Date.now()): number {
  return Math.floor((from - new Date(iso).getTime()) / 86_400_000);
}

/** "4 days overdue" / "due in 3 days" / "due today". */
export function dueLabel(iso?: string): string {
  if (!iso) return "No due date";
  const days = daysPast(iso);
  if (days === 0) return "Due today";
  if (days > 0) return `${days} ${days === 1 ? "day" : "days"} overdue`;
  const ahead = Math.abs(days);
  return `Due in ${ahead} ${ahead === 1 ? "day" : "days"}`;
}
