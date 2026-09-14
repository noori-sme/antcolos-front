import { describe, expect, it } from "vitest";
import { fuelTx } from "@/test/fuel-factories";
import { findDuplicate } from "./duplicates";

const sourceRef = (externalId: string) => ({
  adapterId: "fuel_card.mock",
  externalId,
  importedAt: "2026-05-14T13:00:00.000Z",
});

describe("duplicate detection", () => {
  it("calls a re-imported row an exact duplicate, with no judgement needed", () => {
    const existing = fuelTx({ id: "first", sourceRef: sourceRef("fc-101-2026-05-14") });
    const incoming = fuelTx({ id: "second", sourceRef: sourceRef("fc-101-2026-05-14") });
    const match = findDuplicate(incoming, [existing]);
    expect(match).toMatchObject({ transactionId: "first", strength: "exact" });
  });

  it("calls a near-identical purchase on the same truck a likely duplicate", () => {
    const existing = fuelTx({ id: "first", purchasedAt: "2026-05-14T12:00:00.000Z" });
    const incoming = fuelTx({ id: "second", purchasedAt: "2026-05-14T12:20:00.000Z" });
    expect(findDuplicate(incoming, [existing])).toMatchObject({ strength: "likely" });
  });

  it("does not match across trucks, or outside the window, or at a different amount", () => {
    const existing = fuelTx({ id: "first", purchasedAt: "2026-05-14T12:00:00.000Z" });
    expect(findDuplicate(fuelTx({ id: "x", truckId: "truck_2" }), [existing])).toBeNull();
    expect(
      findDuplicate(fuelTx({ id: "x", purchasedAt: "2026-05-14T16:00:00.000Z" }), [existing]),
    ).toBeNull();
    expect(
      findDuplicate(
        fuelTx({ id: "x", cost: { currency: "USD", pricePerGallonMills: 3_899, totalCostCents: 99_999 } }),
        [existing],
      ),
    ).toBeNull();
  });

  it("never matches a record against itself", () => {
    const only = fuelTx({ id: "same" });
    expect(findDuplicate(only, [only])).toBeNull();
  });

  it("ignores superseded, rejected and already-duplicate rows as candidates", () => {
    const pool = [
      fuelTx({ id: "old", state: "corrected", revision: { number: 1, originalId: "old", isCurrent: false } }),
      fuelTx({ id: "rejected", state: "rejected" }),
      fuelTx({ id: "dupe", state: "duplicate" }),
    ];
    expect(findDuplicate(fuelTx({ id: "incoming" }), pool)).toBeNull();
  });
});
