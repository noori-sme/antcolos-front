import { describe, expect, it } from "vitest";
import { fuelTx, mileage } from "@/test/fuel-factories";
import {
  costCentsOf, countableMileage, countableTransactions, groupBy, isPropulsionFuel,
  summarize, totalGallonsThousandths, totalMiles, totalSpendCents, totalTaxableMiles,
} from "./economy";

describe("fuel economy", () => {
  it("excludes superseded, duplicate and rejected purchases from every figure", () => {
    const rows = [
      fuelTx({ id: "keep", gallonsThousandths: 100_000 }),
      fuelTx({
        id: "superseded",
        gallonsThousandths: 10_000,
        state: "corrected",
        revision: { number: 1, originalId: "superseded", isCurrent: false, supersededById: "keep" },
      }),
      fuelTx({ id: "dupe", gallonsThousandths: 100_000, state: "duplicate" }),
      fuelTx({ id: "rejected", gallonsThousandths: 100_000, state: "rejected" }),
    ];
    expect(countableTransactions(rows).map((t) => t.id)).toEqual(["keep"]);
    expect(totalGallonsThousandths(rows)).toBe(100_000);
  });

  it("counts DEF as spend but never as gallons", () => {
    const rows = [
      fuelTx({ id: "diesel", gallonsThousandths: 100_000, cost: { currency: "USD", pricePerGallonMills: 4_000, totalCostCents: 40_000 } }),
      fuelTx({ id: "def", fuelType: "def", gallonsThousandths: 5_000, cost: { currency: "USD", pricePerGallonMills: 3_000, totalCostCents: 1_500 } }),
    ];
    expect(isPropulsionFuel("def")).toBe(false);
    expect(totalGallonsThousandths(rows)).toBe(100_000);
    expect(totalSpendCents(rows)).toBe(41_500);
    // The pump price the fleet is judged on ignores the DEF top-up.
    expect(summarize(rows, []).averagePricePerGallonMills).toBe(4_000);
  });

  it("treats a withheld cost as zero rather than throwing", () => {
    const withheld = fuelTx({ cost: undefined });
    expect(costCentsOf(withheld)).toBe(0);
    expect(totalSpendCents([withheld])).toBe(0);
  });

  it("takes miles from mileage records and gallons from purchases, never one from the other", () => {
    const purchases = [fuelTx({ gallonsThousandths: 153_400, cost: { currency: "USD", pricePerGallonMills: 3_899, totalCostCents: 59_811 } })];
    const miles = [
      mileage({ jurisdiction: "IL", totalMiles: 400, taxableMiles: 380 }),
      mileage({ jurisdiction: "IN", totalMiles: 600, taxableMiles: 600 }),
    ];
    const summary = summarize(purchases, miles);
    expect(summary.totalMiles).toBe(1_000);
    expect(summary.totalGallonsThousandths).toBe(153_400);
    expect(summary.mpgHundredths).toBe(652);
    expect(totalTaxableMiles(miles)).toBe(980);
  });

  it("excludes superseded and rejected mileage", () => {
    const rows = [
      mileage({ id: "keep", totalMiles: 100 }),
      mileage({
        id: "old",
        totalMiles: 999,
        state: "corrected",
        revision: { number: 1, originalId: "old", isCurrent: false },
      }),
      mileage({ id: "no", totalMiles: 999, state: "rejected" }),
    ];
    expect(countableMileage(rows).map((r) => r.id)).toEqual(["keep"]);
    expect(totalMiles(rows)).toBe(100);
  });

  it("reports no MPG rather than a wrong one when a side is missing", () => {
    expect(summarize([fuelTx()], []).mpgHundredths).toBe(0);
    expect(summarize([], [mileage()]).mpgHundredths).toBe(0);
    expect(summarize([], []).costPerMileMills).toBe(0);
  });

  it("groups by a key and skips records that have none", () => {
    const grouped = groupBy(
      [fuelTx({ driverProfileId: "a" }), fuelTx({ driverProfileId: "a" }), fuelTx({ driverProfileId: undefined })],
      (t) => t.driverProfileId,
    );
    expect([...grouped.keys()]).toEqual(["a"]);
    expect(grouped.get("a")).toHaveLength(2);
  });
});
