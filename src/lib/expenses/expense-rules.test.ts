import { describe, expect, it } from "vitest";
import type { Expense } from "@/types/expense";
import { canRouteExpense, canVoidExpense, isReason, routingReasonText } from "./expense-rules";

const expense = (status: Expense["status"]): Expense => ({
  id: "e1", receiptId: "r1", kind: "FUEL", amount: "1.00", currency: "USD", incurredAt: "", truckId: null,
  loadId: null, driverUserId: "d", status, routingReason: null, reimbursable: false, routeReason: null,
  routedByUserId: null, routedAt: null, voidReason: null, voidedAt: null, createdAt: "",
});

describe("expense rules (F2.2)", () => {
  it("routes only what is unassigned, and voids only what is posted", () => {
    const all = { canRoute: true, canVoid: true };
    expect(canRouteExpense(expense("UNASSIGNED"), all)).toBe(true);
    expect(canRouteExpense(expense("POSTED"), all)).toBe(false);
    expect(canVoidExpense(expense("POSTED"), all)).toBe(true);
    expect(canVoidExpense(expense("VOIDED"), all)).toBe(false);
    expect(canVoidExpense(expense("UNKNOWN"), all)).toBe(false);
    expect(canRouteExpense(expense("UNASSIGNED"), { canRoute: false, canVoid: true })).toBe(false);
  });

  it("says why routing chose what it chose", () => {
    expect(routingReasonText("NO_OWNERSHIP")).toBe("No owner on record for that date");
    expect(routingReasonText(null)).toBe("—");
  });

  it("accepts a reason of 1 to 500 characters", () => {
    expect(isReason("  ")).toBe(false);
    expect(isReason("Duplicate")).toBe(true);
    expect(isReason("x".repeat(501))).toBe(false);
  });
});
