import type { ReceiptKindView } from "./receipt";

/**
 * The company books and an owner-operator's ledger as the NestJS API returns
 * them (backend plan 51, ../antcolos/docs/requirements/expenses-api-contract.md).
 * Amounts are decimal strings.
 */

export const EXPENSE_STATUSES = ["UNASSIGNED", "POSTED", "VOIDED", "MOVED_TO_LEDGER"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];
/** A status this build does not know yet: shown, never acted on. */
export type ExpenseStatusView = ExpenseStatus | "UNKNOWN";

export const EXPENSE_ROUTING_REASONS = [
  "COMPANY_TRUCK", "LEASED_TRUCK", "NO_TRUCK", "NO_OWNERSHIP", "OTHER_ORG_TRUCK",
  "INCONSISTENT_OWNERSHIP", "MANUAL",
] as const;
export type ExpenseRoutingReason = (typeof EXPENSE_ROUTING_REASONS)[number];

export interface Expense {
  id: string;
  receiptId: string;
  kind: ReceiptKindView;
  amount: string;
  currency: string;
  incurredAt: string;
  truckId: string | null;
  loadId: string | null;
  driverUserId: string;
  status: ExpenseStatusView;
  /** null for a reason this build does not know yet. */
  routingReason: ExpenseRoutingReason | null;
  reimbursable: boolean;
  routeReason: string | null;
  routedByUserId: string | null;
  routedAt: string | null;
  voidReason: string | null;
  voidedAt: string | null;
  createdAt: string;
}

export const LEDGER_ENTRY_STATUSES = ["POSTED", "DISMISSED"] as const;
export type LedgerEntryStatus = (typeof LEDGER_ENTRY_STATUSES)[number];

export interface LedgerEntry {
  id: string;
  receiptId: string;
  source: { id: string; name: string };
  kind: ReceiptKindView;
  amount: string;
  currency: string;
  incurredAt: string;
  truckId: string | null;
  loadId: string | null;
  status: LedgerEntryStatus | "UNKNOWN";
  dismissReason: string | null;
  createdAt: string;
}

export interface ExpenseFilters {
  status?: ExpenseStatus;
  truckId?: string;
  page: number;
  pageSize: number;
}

export interface LedgerFilters {
  status?: LedgerEntryStatus;
  page: number;
  pageSize: number;
}

export interface RouteExpenseInput {
  to: "COMPANY" | "OWNER";
  reimbursable?: boolean;
  reason: string;
}
