import { describe, expect, it } from "vitest";
import { toConfirmBody, toReceipt, toReceiptDetail } from "./receipts";

/** The contract's Receipt example (receipts-api-contract.md → Object). */
const RECEIPT = {
  id: "a0b1c2d3-0000-4000-8000-000000000090",
  documentId: "0b6f8c1e-0000-4000-8000-000000000091",
  kind: "FUEL",
  status: "CONFIRMED",
  truckId: "5e6f7a8b-0000-4000-8000-000000000050",
  loadId: null,
  driverUserId: "b2a7c1d0-0000-4000-8000-000000000011",
  purchasedAt: "2026-11-21T14:05:00.000Z",
  totalAmount: "412.50",
  currency: "USD",
  vendor: "Love’s #512",
  city: "Joliet",
  state: "IL",
  gallons: "100.000",
  unitPrice: "4.1250",
  category: null,
  partsAmount: null,
  laborAmount: null,
  odometerMiles: null,
  arithmeticWarning: false,
  rejectReason: null,
  confirmedByUserId: null,
  confirmedAt: "2026-11-21T14:06:00.000Z",
  createdByUserId: "b2a7c1d0-0000-4000-8000-000000000011",
  createdAt: "2026-11-21T14:05:30.000Z",
  updatedAt: "2026-11-21T14:06:00.000Z",
};

describe("receipts http mapper", () => {
  it("keeps money as the contract's exact decimal strings", () => {
    const r = toReceipt(RECEIPT);
    expect(r).toMatchObject({
      kind: "FUEL",
      status: "CONFIRMED",
      totalAmount: "412.50",
      gallons: "100.000",
      unitPrice: "4.1250",
      loadId: null,
      confirmedByUserId: null,
      arithmeticWarning: false,
    });
    expect(typeof r.totalAmount).toBe("string");
  });

  it("never casts an unknown kind or status", () => {
    const r = toReceipt({ ...RECEIPT, kind: "PARKING", status: "VOIDED" });
    expect(r.kind).toBe("FUEL");
    expect(r.status).toBe("PENDING_REVIEW");
  });

  it("maps the detail's fields and drops failure codes it does not know", () => {
    const d = toReceiptDetail({
      ...RECEIPT,
      status: "PENDING_REVIEW",
      fields: [
        { path: "totalAmount", value: 412.5, confidence: 0.91 },
        { path: "quantity", value: "100.000", confidence: 0.98 },
        { path: "merchantAddress", value: { city: "Joliet" }, confidence: null },
        { value: 1 },
      ],
      failures: ["TOTAL_LOW_CONFIDENCE", "SOMETHING_NEW"],
    });
    expect(d.fields).toEqual([
      { path: "totalAmount", value: 412.5, confidence: 0.91 },
      { path: "quantity", value: "100.000", confidence: 0.98 },
      { path: "merchantAddress", value: null, confidence: null },
    ]);
    expect(d.failures).toEqual(["TOTAL_LOW_CONFIDENCE"]);
  });

  it("sends only the corrections a person set, keeping an explicit null", () => {
    expect(toConfirmBody({ totalAmount: "400.00", vendor: null, gallons: undefined })).toEqual({
      totalAmount: "400.00",
      vendor: null,
    });
  });
});
