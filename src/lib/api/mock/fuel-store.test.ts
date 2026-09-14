import { beforeEach, describe, expect, it } from "vitest";
import { countableMileage, countableTransactions, summarize } from "@/lib/fuel/economy";
import { isKnownJurisdiction } from "@/lib/fuel/jurisdictions";
import { qualifyForIfta } from "@/lib/fuel/ifta";
import { FUEL_FIXTURE_ECONOMY, fuelDb, resetFuelStore } from "./fuel-store";
import { resetTruckRegistry, TRUCK_IDS } from "./truck-registry";

/**
 * The fixtures have to be honest, not just present.
 *
 * A mock that produces a 40 MPG tractor or a revision chain with two current
 * rows will make every screen above it look plausible and be wrong, so the
 * generated data is checked against the same invariants the real ledger has.
 */

beforeEach(() => {
  resetTruckRegistry();
  resetFuelStore();
});

describe("the seeded ledger", () => {
  it("keeps fuel purchases and mileage records as separate collections", () => {
    const db = fuelDb();
    expect(db.transactions.length).toBeGreaterThan(20);
    expect(db.mileage.length).toBeGreaterThan(20);
    // No record is in both, and neither type carries the other's fields.
    for (const t of db.transactions) expect("jurisdiction" in t).toBe(false);
    for (const r of db.mileage) expect("gallonsThousandths" in r).toBe(false);
  });

  it("has exactly one current row in every revision chain", () => {
    const db = fuelDb();
    const chains = new Map<string, number>();
    for (const t of db.transactions.filter((x) => x.revision.isCurrent)) {
      chains.set(t.revision.originalId, (chains.get(t.revision.originalId) ?? 0) + 1);
    }
    for (const count of chains.values()) expect(count).toBe(1);
  });

  it("contains a real correction chain, with the original kept and excluded", () => {
    const db = fuelDb();
    const superseded = db.transactions.find((t) => t.state === "corrected");
    expect(superseded).toBeDefined();
    expect(superseded!.revision.isCurrent).toBe(false);
    const replacement = db.transactions.find((t) => t.id === superseded!.revision.supersededById);
    expect(replacement).toBeDefined();
    expect(replacement!.revision.number).toBe(2);
    expect(replacement!.revision.correctionReason).toBeTruthy();
    expect(countableTransactions([superseded!])).toHaveLength(0);
  });

  it("produces believable fuel economy per carrier, derived not stated", () => {
    const db = fuelDb();
    for (const organizationId of ["org_northline", "org_baxter", "org_cascade"]) {
      const summary = summarize(
        db.transactions.filter((t) => t.organizationId === organizationId),
        db.mileage.filter((r) => r.organizationId === organizationId),
      );
      expect(summary.totalMiles).toBeGreaterThan(0);
      expect(summary.totalGallonsThousandths).toBeGreaterThan(0);
      // A mixed fleet of vans, box trucks and tractors lands in this band.
      expect(summary.mpgHundredths).toBeGreaterThan(400);
      expect(summary.mpgHundredths).toBeLessThan(2_500);
      expect(summary.costPerMileMills!).toBeGreaterThan(0);
    }
  });

  it("gives back the economy each truck was generated with, per ledger", () => {
    const db = fuelDb();
    for (const truck of FUEL_FIXTURE_ECONOMY) {
      const summary = summarize(
        db.transactions.filter(
          (t) => t.truckId === truck.truckId && t.organizationId === truck.organizationId,
        ),
        db.mileage.filter(
          (r) => r.truckId === truck.truckId && r.organizationId === truck.organizationId,
        ),
      );
      const measured = summary.mpgHundredths / 100;
      // Wide enough for the jitter and for the planted duplicate on unit 104,
      // tight enough to catch a fill sized against the wrong stretch of road.
      expect(measured).toBeGreaterThan(truck.mpg * 0.85);
      expect(measured).toBeLessThan(truck.mpg * 1.15);
    }
  });

  it("uses real jurisdictions and gets qualification right for each purchase", () => {
    for (const t of fuelDb().transactions) {
      expect(isKnownJurisdiction(t.location.jurisdiction)).toBe(true);
      expect(t.qualifiesForIfta).toBe(
        qualifyForIfta(t.fuelType, t.location.jurisdiction).qualifies,
      );
    }
  });

  it("never records more taxable miles than total, except where that is the planted fault", () => {
    const bad = fuelDb().mileage.filter((r) => r.taxableMiles > r.totalMiles);
    expect(bad).toHaveLength(1);
    expect(bad[0].flags).toContain("taxable_exceeds_total");
  });

  it("plants exactly the problems a review queue needs to be exercised", () => {
    const db = fuelDb();
    const current = countableTransactions(db.transactions);
    expect(current.filter((t) => t.flags.includes("missing_receipt")).length).toBeGreaterThan(0);
    expect(current.filter((t) => t.flags.includes("possible_duplicate")).length).toBeGreaterThan(0);
    expect(current.filter((t) => t.flags.includes("price_out_of_band")).length).toBeGreaterThan(0);
    expect(current.filter((t) => t.flags.includes("odometer_regression")).length).toBeGreaterThan(0);
    expect(current.filter((t) => t.attribution.basis === "unresolved").length).toBe(1);
  });

  it("attributes each row to a carrier and freezes it, one truck across two carriers included", () => {
    const db = fuelDb();
    const on104 = db.transactions.filter((t) => t.truckId === TRUCK_IDS.nl104);
    const carriers = new Set(on104.map((t) => t.attribution.carrierOrganizationId));
    expect(carriers.has("org_northline")).toBe(true);
    expect(carriers.has("org_baxter")).toBe(true);
    // And each row's ledger matches the carrier it was written for.
    for (const t of on104) {
      if (t.attribution.basis === "unresolved") continue;
      expect(t.organizationId).toBe(t.attribution.carrierOrganizationId);
    }
  });

  it("never judges one carrier's purchase against another carrier's ledger", () => {
    const db = fuelDb();
    // Unit 104 is run by Northline and by Baxter, with independent odometer
    // series. Comparing across the two manufactures regressions and duplicates.
    const on104 = db.transactions.filter((t) => t.truckId === TRUCK_IDS.nl104);
    expect(new Set(on104.map((t) => t.organizationId)).size).toBe(2);

    const northline104 = on104.filter((t) => t.organizationId === "org_northline");
    const baxter104 = on104.filter((t) => t.organizationId === "org_baxter");
    expect(baxter104.every((t) => !t.flags.includes("odometer_regression"))).toBe(true);
    // Exactly one planted regression on the Northline side, and no more.
    expect(northline104.filter((t) => t.flags.includes("odometer_regression")).length).toBeLessThanOrEqual(1);
    // And no purchase points at a duplicate in the other carrier's ledger.
    for (const t of on104) {
      if (!t.duplicateOfId) continue;
      const other = db.transactions.find((x) => x.id === t.duplicateOfId)!;
      expect(other.organizationId).toBe(t.organizationId);
    }
  });

  it("opens a quarter per carrier and records the oldest as filed externally", () => {
    const db = fuelDb();
    expect(db.periods.length).toBeGreaterThanOrEqual(9);
    const filed = db.periods.filter((p) => p.state === "filed");
    expect(filed.length).toBeGreaterThan(0);
    for (const period of filed) {
      expect(period.filing?.channel).toBe("external");
      expect(period.filing?.note).toMatch(/did not submit/i);
      expect(period.lockedAt).toBeTruthy();
    }
  });

  it("shares fuel with a dispatch organization without cost and without tax filing", () => {
    const [grant] = fuelDb().grants;
    expect(grant.dispatchOrganizationId).toBe("org_meridian");
    expect(grant.includesOperationalFuel).toBe(true);
    expect(grant.includesCosts).toBe(false);
    expect(grant.includesTaxFiling).toBe(false);
  });

  it("links receipts as ordinary Documents rather than a fuel-only file record", () => {
    const db = fuelDb();
    expect(db.receipts.length).toBeGreaterThan(0);
    for (const receipt of db.receipts) {
      expect(receipt.kind).toBe("fuel_receipt");
      expect(receipt.links.some((l) => l.entityKind === "fuel_transaction")).toBe(true);
      // Nothing has been read off any of them: no OCR provider is connected.
      expect(receipt.ocr.state).toBe("not_applicable");
    }
  });

  it("rebuilds identically, so a test never depends on the last test's leftovers", () => {
    const first = fuelDb().transactions.length;
    const miles = countableMileage(fuelDb().mileage).length;
    resetFuelStore();
    expect(fuelDb().transactions.length).toBe(first);
    expect(countableMileage(fuelDb().mileage).length).toBe(miles);
  });
});
