import { describe, expect, it } from "vitest";
import type { Receipt } from "@/types/receipt";
import {
  canConfirm, canReject, formatMoney, isMoney, isQuantity, isUnitPrice, trimDecimal,
} from "./receipt-rules";

const receipt = (extras: Partial<Receipt> = {}): Receipt => ({
  id: "r1", documentId: "d1", kind: "FUEL", status: "PENDING_REVIEW", truckId: null, loadId: null,
  driverUserId: "driver-1", purchasedAt: null, totalAmount: null, currency: "USD", vendor: null,
  city: null, state: null, gallons: null, unitPrice: null, category: null, partsAmount: null,
  laborAmount: null, odometerMiles: null, arithmeticWarning: false, rejectReason: null,
  confirmedByUserId: null, confirmedAt: null, createdByUserId: "driver-1",
  createdAt: "2026-11-21T14:05:30.000Z", updatedAt: "2026-11-21T14:05:30.000Z",
  ...extras,
});

describe("receipt rules (F2.1)", () => {
  it("formats decimal strings as money without floats", () => {
    expect(formatMoney("412.50")).toBe("$412.50");
    expect(formatMoney("1234.5")).toBe("$1,234.50");
    expect(formatMoney("1000000")).toBe("$1,000,000.00");
    expect(formatMoney("0.1")).toBe("$0.10");
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney("abc")).toBe("—");
  });

  it("drops trailing zeros for gallons and unit price", () => {
    expect(trimDecimal("100.000")).toBe("100");
    expect(trimDecimal("4.1250")).toBe("4.125");
    expect(trimDecimal("12")).toBe("12");
    expect(trimDecimal(null)).toBe("—");
  });

  it("checks the contract's decimal formats", () => {
    expect(isMoney("412.50")).toBe(true);
    expect(isMoney("412.505")).toBe(false);
    expect(isMoney("-1")).toBe(false);
    expect(isQuantity("100.125")).toBe(true);
    expect(isQuantity("100.1255")).toBe(false);
    expect(isUnitPrice("4.1250")).toBe(true);
    expect(isUnitPrice("4.12505")).toBe(false);
  });

  it("lets the payer confirm their own and a reviewer any pending receipt", () => {
    const driver = { userId: "driver-1", canReview: false, canConfirmOwn: true };
    const other = { userId: "driver-2", canReview: false, canConfirmOwn: true };
    const reviewer = { userId: "acct-1", canReview: true, canConfirmOwn: false };
    expect(canConfirm(receipt(), driver)).toBe(true);
    expect(canConfirm(receipt(), other)).toBe(false);
    expect(canConfirm(receipt(), reviewer)).toBe(true);
    expect(canConfirm(receipt({ status: "CONFIRMED" }), reviewer)).toBe(false);
    expect(canConfirm(receipt({ status: "EXTRACTING" }), driver)).toBe(false);
    expect(canReject(receipt(), driver)).toBe(false);
    expect(canReject(receipt(), reviewer)).toBe(true);
  });
});
