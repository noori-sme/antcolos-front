import { describe, expect, it } from "vitest";
import { toExpense, toLedgerEntry } from "./expenses";

/** The contract's examples (expenses-api-contract.md → Objects). */
const EXPENSE = {
  id: "a0b1c2d3-0000-4000-8000-000000000101",
  receiptId: "0b6f8c1e-0000-4000-8000-000000000090",
  kind: "FUEL",
  amount: "412.50",
  currency: "USD",
  incurredAt: "2026-11-21T14:05:00.000Z",
  truckId: "5e6f7a8b-0000-4000-8000-000000000050",
  loadId: null,
  driverUserId: "b2a7c1d0-0000-4000-8000-000000000011",
  status: "POSTED",
  routingReason: "COMPANY_TRUCK",
  reimbursable: false,
  routeReason: null,
  routedByUserId: null,
  routedAt: null,
  voidReason: null,
  voidedAt: null,
  createdAt: "2026-11-21T14:06:00.000Z",
};
const ENTRY = {
  id: "c1d2e3f4-0000-4000-8000-000000000201",
  receiptId: "0b6f8c1e-0000-4000-8000-000000000090",
  source: { id: "45df530f-0000-4000-8000-000000000001", name: "Acme Haulage" },
  kind: "FUEL",
  amount: "412.50",
  currency: "USD",
  incurredAt: "2026-11-21T14:05:00.000Z",
  truckId: "5e6f7a8b-0000-4000-8000-000000000050",
  loadId: null,
  status: "POSTED",
  dismissReason: null,
  createdAt: "2026-11-21T14:06:00.000Z",
};

describe("expenses http mapper", () => {
  it("maps an expense with its amount as the exact decimal string", () => {
    expect(toExpense(EXPENSE)).toMatchObject({
      status: "POSTED",
      routingReason: "COMPANY_TRUCK",
      amount: "412.50",
      loadId: null,
      reimbursable: false,
    });
  });

  it("never casts an unknown status, kind or routing reason", () => {
    expect(toExpense({ ...EXPENSE, status: "ARCHIVED", kind: "PARKING", routingReason: "NEW" })).toMatchObject({
      status: "UNKNOWN",
      kind: "UNKNOWN",
      routingReason: null,
    });
  });

  it("maps a ledger entry with the carrier it came from", () => {
    expect(toLedgerEntry(ENTRY)).toMatchObject({
      source: { name: "Acme Haulage" },
      amount: "412.50",
      status: "POSTED",
    });
    expect(toLedgerEntry({ ...ENTRY, status: "GONE", source: undefined })).toMatchObject({
      status: "UNKNOWN",
      source: { id: "", name: "" },
    });
  });
});
