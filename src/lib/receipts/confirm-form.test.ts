import { describe, expect, it } from "vitest";
import type { Receipt } from "@/types/receipt";
import { confirmFormSchema, toConfirmInput, toFormValues } from "./confirm-form";

const receipt = (extras: Partial<Receipt> = {}): Receipt => ({
  id: "r1", documentId: "d1", kind: "FUEL", status: "PENDING_REVIEW", truckId: null, loadId: null,
  driverUserId: "driver-1", purchasedAt: null, totalAmount: null, currency: "USD", vendor: null,
  city: null, state: null, gallons: null, unitPrice: null, category: null, partsAmount: null,
  laborAmount: null, odometerMiles: null, arithmeticWarning: false, rejectReason: null,
  confirmedByUserId: null, confirmedAt: null, createdByUserId: "driver-1",
  createdAt: "2026-11-21T14:05:30.000Z", updatedAt: "2026-11-21T14:05:30.000Z",
  ...extras,
});

const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

describe("receipt confirm form (F2.1)", () => {
  const fields = [
    { path: "totalAmount", value: 412.5, confidence: 0.9 },
    { path: "quantity", value: "100.000", confidence: 0.98 },
    { path: "purchaseDate", value: "2026-11-20", confidence: 0.99 },
    { path: "merchantName", value: "Pilot", confidence: null },
  ];

  it("starts from what was read when the receipt has no values yet", () => {
    expect(toFormValues(receipt(), fields)).toMatchObject({
      purchasedOn: "2026-11-20",
      totalAmount: "412.5",
      gallons: "100.000",
      vendor: "Pilot",
      unitPrice: "",
    });
  });

  it("sends nothing when nothing changed, and only what changed otherwise", () => {
    const initial = toFormValues(receipt(), fields);
    expect(toConfirmInput(initial, initial)).toEqual({});
    expect(
      toConfirmInput({ ...initial, totalAmount: "412.05", vendor: "", purchasedOn: "2026-11-19" }, initial),
    ).toEqual({ totalAmount: "412.05", vendor: null, purchasedAt: "2026-11-19T12:00:00.000Z" });
  });

  it("mirrors the contract's formats", () => {
    const valid = {
      purchasedOn: yesterday(), totalAmount: "400.00", gallons: "", unitPrice: "", partsAmount: "220.00",
      laborAmount: "180", vendor: "Joe's", city: "", state: "", odometerMiles: "184220",
    };
    expect(confirmFormSchema.safeParse(valid).success).toBe(true);
    expect(confirmFormSchema.safeParse({ ...valid, totalAmount: "400.001" }).success).toBe(false);
    expect(confirmFormSchema.safeParse({ ...valid, totalAmount: "" }).success).toBe(false);
    expect(confirmFormSchema.safeParse({ ...valid, purchasedOn: tomorrow() }).success).toBe(false);
    expect(confirmFormSchema.safeParse({ ...valid, gallons: "1.2345" }).success).toBe(false);
    expect(confirmFormSchema.safeParse({ ...valid, odometerMiles: "12.5" }).success).toBe(false);
  });
});
