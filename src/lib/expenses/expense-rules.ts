import type { Expense, ExpenseRoutingReason } from "@/types/expense";

/**
 * The calendar day money was spent, in UTC: the day routing used to pick the
 * truck's owner, so the screen and the decision never disagree near midnight.
 */
export function spentOn(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

/** Plain words for why routing chose what it chose (backend plan 51). */
export const ROUTING_REASON_TEXT: Record<ExpenseRoutingReason, string> = {
  COMPANY_TRUCK: "Company truck",
  LEASED_TRUCK: "Leased truck",
  NO_TRUCK: "No truck on the receipt",
  NO_OWNERSHIP: "No owner on record for that date",
  OTHER_ORG_TRUCK: "Another company's truck",
  INCONSISTENT_OWNERSHIP: "Ownership records don't agree",
  MANUAL: "Routed by a person",
};

export function routingReasonText(reason: ExpenseRoutingReason | null): string {
  return reason ? ROUTING_REASON_TEXT[reason] : "—";
}

export interface ExpenseViewer {
  canRoute: boolean;
  canVoid: boolean;
}

/** Only what waits for a person can be routed; the backend decides again. */
export const canRouteExpense = (e: Expense, v: ExpenseViewer): boolean => e.status === "UNASSIGNED" && v.canRoute;
export const canVoidExpense = (e: Expense, v: ExpenseViewer): boolean => e.status === "POSTED" && v.canVoid;

/** A reason the API accepts: 1–500 characters once trimmed. */
export const isReason = (value: string): boolean => {
  const t = value.trim();
  return t.length > 0 && t.length <= 500;
};
