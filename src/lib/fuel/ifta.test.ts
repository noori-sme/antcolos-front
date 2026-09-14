import { describe, expect, it } from "vitest";
import { fuelTx, mileage } from "@/test/fuel-factories";
import type { IftaPeriod } from "@/types";
import {
  derivePeriodState, jurisdictionSummaries, mileageInPeriod, qualifyForIfta,
  readinessIssues, transactionsInPeriod,
} from "./ifta";
import { quarterBounds, quarterDueDate } from "./periods";

function period(overrides: Partial<IftaPeriod> = {}): IftaPeriod {
  const year = overrides.year ?? 2026;
  const quarter = overrides.quarter ?? 2;
  const { startsOn, endsOn } = quarterBounds(year, quarter);
  return {
    id: `ifta_org_a_org_a_${year}Q${quarter}`,
    organizationId: "org_a",
    carrierOrganizationId: "org_a",
    carrierNameSnapshot: "Carrier A",
    year,
    quarter,
    startsOn,
    endsOn,
    dueOn: quarterDueDate(year, quarter),
    state: "incomplete",
    amendments: [],
    createdAt: `${startsOn}T00:00:00.000Z`,
    ...overrides,
  };
}

/** Well after Q2 2026 closed, so the quarter under test is finished. */
const AFTER_Q2 = Date.parse("2026-08-01T00:00:00.000Z");

describe("qualification", () => {
  it("qualifies diesel bought in a member jurisdiction", () => {
    expect(qualifyForIfta("diesel", "IL").qualifies).toBe(true);
    expect(qualifyForIfta("biodiesel_blend", "ON").qualifies).toBe(true);
  });

  it("never qualifies DEF, and says why", () => {
    const result = qualifyForIfta("def", "IL");
    expect(result.qualifies).toBe(false);
    expect(result.note).toMatch(/consumable/i);
  });

  it("does not qualify a purchase in a non-member jurisdiction", () => {
    const alaska = qualifyForIfta("diesel", "AK");
    expect(alaska.qualifies).toBe(false);
    expect(alaska.note).toMatch(/not an IFTA member/i);
    expect(qualifyForIfta("diesel", "DC").qualifies).toBe(false);
  });

  it("does not qualify electricity", () => {
    expect(qualifyForIfta("electric", "IL").qualifies).toBe(false);
  });
});

describe("period membership", () => {
  it("keeps only the records of the right carrier inside the right quarter", () => {
    const p = period();
    const rows = [
      fuelTx({ id: "in", purchasedAt: "2026-05-14T12:00:00.000Z" }),
      fuelTx({ id: "before", purchasedAt: "2026-03-31T12:00:00.000Z" }),
      fuelTx({ id: "after", purchasedAt: "2026-07-01T12:00:00.000Z" }),
      fuelTx({
        id: "other_carrier",
        purchasedAt: "2026-05-14T12:00:00.000Z",
        attribution: { carrierOrganizationId: "org_b", carrierNameSnapshot: "B", basis: "operating_lease", resolvedAt: "x" },
      }),
    ];
    expect(transactionsInPeriod(rows, p).map((t) => t.id)).toEqual(["in"]);
    expect(
      mileageInPeriod(
        [mileage({ id: "m_in" }), mileage({ id: "m_out", travelStartedAt: "2026-07-02T00:00:00.000Z" })],
        p,
      ).map((r) => r.id),
    ).toEqual(["m_in"]);
  });
});

describe("jurisdiction summaries", () => {
  it("computes tax-paid, deemed and net gallons per jurisdiction", () => {
    // 1,000 miles on 153.400 gal → 6.52 fleet MPG.
    const purchases = [
      fuelTx({ location: { jurisdiction: "IL", address: { city: "Effingham", state: "IL" } }, gallonsThousandths: 100_000 }),
      fuelTx({ location: { jurisdiction: "IN", address: { city: "Gary", state: "IN" } }, gallonsThousandths: 53_400 }),
    ];
    const miles = [
      mileage({ jurisdiction: "IL", totalMiles: 400, taxableMiles: 400 }),
      mileage({ jurisdiction: "IN", totalMiles: 600, taxableMiles: 600 }),
    ];
    const lines = jurisdictionSummaries(purchases, miles);
    const il = lines.find((l) => l.jurisdiction === "IL")!;
    const inn = lines.find((l) => l.jurisdiction === "IN")!;

    expect(il.taxPaidGallonsThousandths).toBe(100_000);
    // 400 taxable miles at 6.52 MPG = 61.350 gallons deemed burned.
    expect(il.taxableGallonsThousandths).toBe(61_350);
    expect(il.netTaxableGallonsThousandths).toBe(61_350 - 100_000);
    expect(inn.netTaxableGallonsThousandths).toBe(inn.taxableGallonsThousandths - 53_400);
  });

  it("shows a jurisdiction with miles and no fuel, and one with fuel and no miles", () => {
    const lines = jurisdictionSummaries(
      [fuelTx({ location: { jurisdiction: "OH", address: { city: "Columbus", state: "OH" } } })],
      [mileage({ jurisdiction: "IL", totalMiles: 200, taxableMiles: 200 })],
    );
    expect(lines.map((l) => l.jurisdiction)).toEqual(["IL", "OH"]);
    expect(lines.find((l) => l.jurisdiction === "IL")!.taxPaidGallonsThousandths).toBe(0);
    expect(lines.find((l) => l.jurisdiction === "OH")!.totalMiles).toBe(0);
  });

  it("does not credit tax-paid gallons for a purchase that does not qualify", () => {
    const lines = jurisdictionSummaries(
      [fuelTx({ fuelType: "def", qualifiesForIfta: false, gallonsThousandths: 20_000 })],
      [mileage({ jurisdiction: "IL", totalMiles: 200, taxableMiles: 200 })],
    );
    expect(lines[0].taxPaidGallonsThousandths).toBe(0);
    expect(lines[0].purchaseCount).toBe(1);
  });
});

describe("readiness", () => {
  const clean = () => ({
    fuel: [fuelTx({ receiptDocumentId: "doc_1", state: "verified" })],
    miles: [mileage({ state: "verified" })],
  });

  it("is ready when the quarter is over and nothing is outstanding", () => {
    const { fuel, miles } = clean();
    expect(readinessIssues(period(), fuel, miles, AFTER_Q2)).toEqual([]);
  });

  it("is never ready while the quarter is still running", () => {
    const { fuel, miles } = clean();
    const midQuarter = Date.parse("2026-05-15T00:00:00.000Z");
    expect(readinessIssues(period(), fuel, miles, midQuarter)).toContain("period_not_finished");
  });

  it("names every outstanding thing rather than the first one", () => {
    const issues = readinessIssues(
      period(),
      [fuelTx({ state: "imported", receiptDocumentId: undefined, flags: ["missing_receipt"] })],
      [mileage({ state: "pending_review", flags: ["odometer_gap"] })],
      AFTER_Q2,
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        "fuel_awaiting_review", "mileage_awaiting_review", "missing_receipts",
        "flagged_transactions", "flagged_mileage",
      ]),
    );
  });

  it("flags a quarter with no records at all on both sides", () => {
    const issues = readinessIssues(period(), [], [], AFTER_Q2);
    expect(issues).toContain("no_mileage_records");
    expect(issues).toContain("no_fuel_purchases");
  });

  it("flags fuel bought where no miles were recorded", () => {
    const issues = readinessIssues(
      period(),
      [fuelTx({ location: { jurisdiction: "OH", address: { city: "Columbus", state: "OH" } }, receiptDocumentId: "d" })],
      [mileage({ jurisdiction: "IL" })],
      AFTER_Q2,
    );
    expect(issues).toContain("fuel_without_mileage_jurisdiction");
  });

  it("flags a record nothing could attribute", () => {
    const issues = readinessIssues(
      period(),
      [fuelTx({
        receiptDocumentId: "d",
        attribution: { carrierOrganizationId: "org_a", carrierNameSnapshot: "A", basis: "unresolved", resolvedAt: "x" },
      })],
      [mileage()],
      AFTER_Q2,
    );
    expect(issues).toContain("unresolved_attribution");
  });
});

describe("derived period state", () => {
  it("is ready with no issues, needs_review with soft ones, incomplete with blocking ones", () => {
    expect(derivePeriodState(period(), [])).toBe("ready");
    expect(derivePeriodState(period(), ["missing_receipts"])).toBe("needs_review");
    expect(derivePeriodState(period(), ["no_fuel_purchases", "missing_receipts"])).toBe("incomplete");
    expect(derivePeriodState(period(), ["period_not_finished"])).toBe("incomplete");
  });

  it("never recomputes away a decision a person made", () => {
    expect(derivePeriodState(period({ state: "filed" }), ["missing_receipts"])).toBe("filed");
    expect(derivePeriodState(period({ state: "amended" }), [])).toBe("amended");
  });
});
