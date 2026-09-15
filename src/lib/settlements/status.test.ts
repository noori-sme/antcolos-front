import { describe, expect, it } from "vitest";
import type { SettlementStatus } from "@/types";
import {
  acceptsPayment,
  allowedTransitions,
  assertTransition,
  canBeOverdue,
  canTransition,
  IllegalSettlementTransitionError,
  isEditable,
  isTerminal,
  requiresAdjustmentToCorrect,
  shouldFreezeSnapshot,
  statusAfterPayment,
} from "./status";

const ALL: SettlementStatus[] = [
  "draft", "needs_review", "approved", "disputed",
  "ready_for_payment", "partially_paid", "paid", "voided",
];

describe("the settlement status machine", () => {
  it("walks the ordinary path from draft to paid", () => {
    expect(canTransition("draft", "needs_review")).toBe(true);
    expect(canTransition("needs_review", "approved")).toBe(true);
    expect(canTransition("approved", "ready_for_payment")).toBe(true);
    expect(canTransition("ready_for_payment", "partially_paid")).toBe(true);
    expect(canTransition("partially_paid", "paid")).toBe(true);
  });

  it("never lets a settlement skip sign-off on its way to being paid", () => {
    expect(canTransition("draft", "approved")).toBe(false);
    expect(canTransition("draft", "paid")).toBe(false);
    expect(canTransition("needs_review", "ready_for_payment")).toBe(false);
    expect(canTransition("needs_review", "paid")).toBe(false);
  });

  it("treats a re-entry into the same status as a bug, not a no-op", () => {
    for (const status of ALL) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it("leaves voided terminal", () => {
    expect(allowedTransitions("voided")).toHaveLength(0);
    for (const status of ALL) {
      expect(canTransition("voided", status)).toBe(false);
    }
  });

  it("never voids a settlement that has already been paid", () => {
    // The money has moved. The only honest correction left is an adjustment.
    expect(canTransition("paid", "voided")).toBe(false);
    expect(allowedTransitions("paid")).toEqual(["disputed"]);
  });

  it("lets a paid settlement still be disputed", () => {
    expect(canTransition("paid", "disputed")).toBe(true);
  });

  it("lets a dispute return the settlement to wherever it came from", () => {
    for (const back of ["needs_review", "approved", "ready_for_payment", "partially_paid", "paid"] as const) {
      expect(canTransition("disputed", back)).toBe(true);
    }
  });

  it("throws on an illegal transition rather than returning a value to ignore", () => {
    expect(() => assertTransition("paid", "draft")).toThrow(IllegalSettlementTransitionError);
    expect(() => assertTransition("draft", "needs_review")).not.toThrow();
  });
});

describe("what may be edited", () => {
  it("allows editing only while the settlement is still being built", () => {
    expect(isEditable("draft")).toBe(true);
    expect(isEditable("needs_review")).toBe(true);
    for (const status of ["approved", "disputed", "ready_for_payment", "partially_paid", "paid", "voided"] as const) {
      expect(isEditable(status)).toBe(false);
    }
  });

  it("freezes the calculation snapshot for exactly the statuses that are closed to editing", () => {
    for (const status of ALL) {
      expect(shouldFreezeSnapshot(status)).toBe(!isEditable(status));
    }
  });

  it("requires an adjustment to correct anything signed off and not voided", () => {
    expect(requiresAdjustmentToCorrect("approved")).toBe(true);
    expect(requiresAdjustmentToCorrect("paid")).toBe(true);
    expect(requiresAdjustmentToCorrect("partially_paid")).toBe(true);
    expect(requiresAdjustmentToCorrect("draft")).toBe(false);
    expect(requiresAdjustmentToCorrect("needs_review")).toBe(false);
    expect(requiresAdjustmentToCorrect("voided")).toBe(false);
  });

  it("marks paid and voided as finished", () => {
    expect(isTerminal("paid")).toBe(true);
    expect(isTerminal("voided")).toBe(true);
    expect(isTerminal("approved")).toBe(false);
  });
});

describe("payment", () => {
  it("accepts money only once the settlement has been queued", () => {
    expect(acceptsPayment("ready_for_payment")).toBe(true);
    expect(acceptsPayment("partially_paid")).toBe(true);
    expect(acceptsPayment("approved")).toBe(false);
    expect(acceptsPayment("draft")).toBe(false);
    expect(acceptsPayment("paid")).toBe(false);
  });

  it("derives the next status from the amounts rather than trusting the caller", () => {
    expect(statusAfterPayment(100_000, 100_000, "ready_for_payment")).toBe("paid");
    expect(statusAfterPayment(100_000, 40_000, "ready_for_payment")).toBe("partially_paid");
    expect(statusAfterPayment(100_000, 0, "ready_for_payment")).toBe("ready_for_payment");
  });

  it("treats an overpayment as paid, not as still owing", () => {
    expect(statusAfterPayment(100_000, 120_000, "partially_paid")).toBe("paid");
  });

  it("settles a zero net the moment anything is recorded against it", () => {
    expect(statusAfterPayment(0, 1, "ready_for_payment")).toBe("paid");
  });

  it("counts a settlement as overdue only while somebody is still owed", () => {
    expect(canBeOverdue("approved")).toBe(true);
    expect(canBeOverdue("ready_for_payment")).toBe(true);
    expect(canBeOverdue("partially_paid")).toBe(true);
    expect(canBeOverdue("paid")).toBe(false);
    expect(canBeOverdue("draft")).toBe(false);
    expect(canBeOverdue("voided")).toBe(false);
  });
});
