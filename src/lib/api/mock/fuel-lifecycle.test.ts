import { beforeEach, describe, expect, it } from "vitest";
import { contextFor } from "@/test/context";
import { countableTransactions, totalGallonsThousandths } from "@/lib/fuel/economy";
import { isWithinQuarter } from "@/lib/fuel/periods";
import { mockFuelService, mockIftaService } from "./fuel";
import { fuelDb, resetFuelStore } from "./fuel-store";
import { mockStore } from "./store";
import { resetTruckRegistry, TRUCK_IDS } from "./truck-registry";

beforeEach(() => {
  resetTruckRegistry();
  resetFuelStore();
  mockStore.reset();
});

const ctx = () => contextFor("org_northline");
const anHourAgo = () => new Date(Date.now() - 3_600_000).toISOString();

/**
 * Unit 111 is approved to exactly ONE carrier, so its attribution resolves
 * cleanly. Unit 104 is approved to two at once and is used below for the case
 * where it deliberately does not.
 */
const purchase = {
  truckId: TRUCK_IDS.nl111,
  location: { jurisdiction: "IL", address: { city: "Rockford", state: "IL" } },
  fuelType: "diesel" as const,
  gallonsThousandths: 40_000,
  pricePerGallonMills: 3_899,
  totalCostCents: 15_596,
};

describe("recording a purchase", () => {
  it("writes it into the caller's own ledger, unreviewed, with attribution resolved", async () => {
    const created = await mockFuelService.recordTransaction(ctx(), {
      ...purchase,
      purchasedAt: anHourAgo(),
    });
    expect(created.organizationId).toBe("org_northline");
    expect(created.state).toBe("manual");
    expect(created.source).toBe("manual");
    expect(created.revision).toMatchObject({ number: 1, isCurrent: true, originalId: created.id });
    expect(created.attribution.carrierOrganizationId).toBe("org_northline");
    expect(created.qualifiesForIfta).toBe(true);
  });

  it("does not qualify DEF, and says why on the record", async () => {
    const created = await mockFuelService.recordTransaction(ctx(), {
      ...purchase,
      fuelType: "def",
      purchasedAt: anHourAgo(),
    });
    expect(created.qualifiesForIfta).toBe(false);
    expect(created.qualificationNote).toMatch(/consumable/i);
  });

  it("flags a new purchase that has no receipt", async () => {
    const created = await mockFuelService.recordTransaction(ctx(), {
      ...purchase,
      purchasedAt: anHourAgo(),
    });
    expect(created.flags).toContain("missing_receipt");
  });

  it("refuses a purchase dated in the future, and one with no fuel in it", async () => {
    await expect(
      mockFuelService.recordTransaction(ctx(), {
        ...purchase,
        purchasedAt: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    ).rejects.toThrow(/future/i);
    await expect(
      mockFuelService.recordTransaction(ctx(), {
        ...purchase,
        gallonsThousandths: 0,
        purchasedAt: anHourAgo(),
      }),
    ).rejects.toThrow(/greater than zero/i);
  });

  it("refuses a declared carrier when the authority history already answers it", async () => {
    await expect(
      mockFuelService.recordTransaction(ctx(), {
        ...purchase,
        purchasedAt: anHourAgo(),
        declaredCarrierOrganizationId: "org_baxter",
      }),
    ).rejects.toThrow(/already on record/i);
  });

  it("prefers a live operating lease over the bare relationship", async () => {
    // Unit 107 is approved to two carriers, and Northline holds the lease.
    const created = await mockFuelService.recordTransaction(ctx(), {
      ...purchase,
      truckId: TRUCK_IDS.nl107,
      purchasedAt: anHourAgo(),
    });
    expect(created.attribution.basis).toBe("operating_lease");
    expect(created.attribution.carrierOrganizationId).toBe("org_northline");
  });

  it("refuses to guess when two carriers are approved on the truck and neither holds it", async () => {
    // Unit 104: Northline and Baxter are both approved, no lease is live. The
    // purchase is kept and flagged rather than attributed to whoever asked.
    const created = await mockFuelService.recordTransaction(ctx(), {
      ...purchase,
      truckId: TRUCK_IDS.nl104,
      fuelType: "gasoline",
      purchasedAt: anHourAgo(),
    });
    expect(created.attribution.basis).toBe("unresolved");
    expect(created.attribution.carrierOrganizationId).toBe("");
    expect(created.flags).toContain("no_active_operating_authority");
  });

  it("lets a person fill the gap, and marks the answer as theirs", async () => {
    const created = await mockFuelService.recordTransaction(ctx(), {
      ...purchase,
      truckId: TRUCK_IDS.nl104,
      fuelType: "gasoline",
      purchasedAt: anHourAgo(),
      declaredCarrierOrganizationId: "org_northline",
    });
    expect(created.attribution.basis).toBe("manual_declaration");
    expect(created.attribution.carrierOrganizationId).toBe("org_northline");
  });
});

describe("corrections", () => {
  it("writes a new revision and leaves the original exactly as it was", async () => {
    const created = await mockFuelService.recordTransaction(ctx(), {
      ...purchase,
      purchasedAt: anHourAgo(),
    });
    const before = { ...created };

    const revised = await mockFuelService.correctTransaction(ctx(), created.id, {
      reason: "Gallons were keyed in with the decimal point one place out.",
      gallonsThousandths: 4_000,
    });

    expect(revised.id).not.toBe(created.id);
    expect(revised.revision.number).toBe(2);
    expect(revised.revision.supersedesId).toBe(created.id);
    expect(revised.revision.originalId).toBe(created.revision.originalId);
    expect(revised.gallonsThousandths).toBe(4_000);

    const detail = await mockFuelService.getTransaction(ctx(), created.id);
    const original = detail.revisions.find((r) => r.id === created.id)!;
    expect(original.gallonsThousandths).toBe(before.gallonsThousandths);
    expect(original.state).toBe("corrected");
    expect(original.revision.isCurrent).toBe(false);
    expect(original.revision.supersededById).toBe(revised.id);
  });

  it("carries attribution across unchanged — a correction never re-attributes", async () => {
    const created = await mockFuelService.recordTransaction(ctx(), {
      ...purchase,
      purchasedAt: anHourAgo(),
    });
    const revised = await mockFuelService.correctTransaction(ctx(), created.id, {
      reason: "Wrong gallons.",
      gallonsThousandths: 4_000,
    });
    expect(revised.attribution).toEqual(created.attribution);
    expect(revised.truckId).toBe(created.truckId);
  });

  it("makes only the current revision count toward totals", async () => {
    const created = await mockFuelService.recordTransaction(ctx(), {
      ...purchase,
      purchasedAt: anHourAgo(),
    });
    await mockFuelService.correctTransaction(ctx(), created.id, {
      reason: "Wrong gallons.",
      gallonsThousandths: 4_000,
    });
    const all = await mockFuelService.listTransactions(ctx(), { includeSuperseded: true });
    const chain = all.filter((t) => t.revision.originalId === created.revision.originalId);
    expect(chain).toHaveLength(2);
    expect(countableTransactions(chain)).toHaveLength(1);
    expect(totalGallonsThousandths(chain)).toBe(4_000);
  });

  it("hides superseded revisions from the ledger unless they are asked for", async () => {
    const created = await mockFuelService.recordTransaction(ctx(), {
      ...purchase,
      purchasedAt: anHourAgo(),
    });
    await mockFuelService.correctTransaction(ctx(), created.id, { reason: "x", gallonsThousandths: 4_000 });
    const visible = await mockFuelService.listTransactions(ctx());
    expect(visible.some((t) => t.id === created.id)).toBe(false);
    const everything = await mockFuelService.listTransactions(ctx(), { includeSuperseded: true });
    expect(everything.some((t) => t.id === created.id)).toBe(true);
  });

  it("refuses a correction without a reason, and one on an already-superseded revision", async () => {
    const created = await mockFuelService.recordTransaction(ctx(), {
      ...purchase,
      purchasedAt: anHourAgo(),
    });
    await expect(
      mockFuelService.correctTransaction(ctx(), created.id, { reason: "   " }),
    ).rejects.toThrow(/reason/i);

    await mockFuelService.correctTransaction(ctx(), created.id, { reason: "x", gallonsThousandths: 4_000 });
    await expect(
      mockFuelService.correctTransaction(ctx(), created.id, { reason: "again" }),
    ).rejects.toThrow(/superseded/i);
  });

  it("puts a corrected record back in front of a reviewer", async () => {
    const created = await mockFuelService.recordTransaction(ctx(), { ...purchase, purchasedAt: anHourAgo() });
    await mockFuelService.verifyTransaction(ctx(), created.id);
    const revised = await mockFuelService.correctTransaction(ctx(), created.id, {
      reason: "x",
      gallonsThousandths: 4_000,
    });
    expect(revised.state).toBe("pending_review");
    expect(revised.verifiedAt).toBeUndefined();
  });
});

describe("review", () => {
  it("accepts, and records who accepted it", async () => {
    const created = await mockFuelService.recordTransaction(ctx(), { ...purchase, purchasedAt: anHourAgo() });
    const verified = await mockFuelService.verifyTransaction(ctx(), created.id);
    expect(verified.state).toBe("verified");
    expect(verified.verifiedBy?.membershipId).toBe(ctx().membershipId);
  });

  it("requires a reason to reject, and then excludes the record from totals", async () => {
    const created = await mockFuelService.recordTransaction(ctx(), { ...purchase, purchasedAt: anHourAgo() });
    await expect(mockFuelService.rejectTransaction(ctx(), created.id, "  ")).rejects.toThrow(/reason/i);
    const rejected = await mockFuelService.rejectTransaction(ctx(), created.id, "Card was used on another fleet's truck.");
    expect(rejected.state).toBe("rejected");
    expect(countableTransactions([rejected])).toHaveLength(0);
  });

  it("marks a duplicate, and refuses to point one duplicate at another", async () => {
    const first = await mockFuelService.recordTransaction(ctx(), { ...purchase, purchasedAt: anHourAgo() });
    const second = await mockFuelService.recordTransaction(ctx(), { ...purchase, purchasedAt: anHourAgo() });
    const marked = await mockFuelService.markDuplicate(ctx(), second.id, first.id);
    expect(marked.state).toBe("duplicate");
    expect(marked.duplicateOfId).toBe(first.id);

    const third = await mockFuelService.recordTransaction(ctx(), { ...purchase, purchasedAt: anHourAgo() });
    await expect(mockFuelService.markDuplicate(ctx(), third.id, second.id)).rejects.toThrow(/itself marked a duplicate/i);
    await expect(mockFuelService.markDuplicate(ctx(), third.id, third.id)).rejects.toThrow(/itself/i);
  });

  it("spots the second copy of one purchase without being told", async () => {
    const first = await mockFuelService.recordTransaction(ctx(), { ...purchase, purchasedAt: anHourAgo() });
    const second = await mockFuelService.recordTransaction(ctx(), { ...purchase, purchasedAt: anHourAgo() });
    expect(second.flags).toContain("possible_duplicate");
    expect(second.duplicateOfId).toBe(first.id);
  });
});

describe("mileage", () => {
  const segment = {
    truckId: TRUCK_IDS.nl111,
    jurisdiction: "IN",
    travelStartedAt: new Date(Date.now() - 7_200_000).toISOString(),
    travelEndedAt: new Date(Date.now() - 3_600_000).toISOString(),
    totalMiles: 120,
    taxableMiles: 120,
  };

  it("records a segment and resolves its attribution", async () => {
    const created = await mockFuelService.recordMileage(ctx(), segment);
    expect(created.state).toBe("manual");
    expect(created.jurisdiction).toBe("IN");
    expect(created.attribution.carrierOrganizationId).toBe("org_northline");
  });

  it("refuses taxable miles above total, negative miles, and travel that ends before it starts", async () => {
    await expect(mockFuelService.recordMileage(ctx(), { ...segment, taxableMiles: 200 })).rejects.toThrow(/exceed/i);
    await expect(mockFuelService.recordMileage(ctx(), { ...segment, totalMiles: -1 })).rejects.toThrow(/negative/i);
    await expect(
      mockFuelService.recordMileage(ctx(), {
        ...segment,
        travelStartedAt: segment.travelEndedAt,
        travelEndedAt: segment.travelStartedAt,
      }),
    ).rejects.toThrow(/before it started/i);
  });

  it("will not verify a record that cannot be true", async () => {
    const created = await mockFuelService.recordMileage(ctx(), segment);
    // Force the impossible state a bad import would produce.
    const stored = fuelDb().mileage.find((r) => r.id === created.id)!;
    stored.taxableMiles = stored.totalMiles + 10;
    stored.flags = ["taxable_exceeds_total"];
    await expect(mockFuelService.verifyMileage(ctx(), created.id)).rejects.toThrow(/impossible/i);
  });

  it("corrects with a revision, keeping the original", async () => {
    const created = await mockFuelService.recordMileage(ctx(), segment);
    const revised = await mockFuelService.correctMileage(ctx(), created.id, {
      reason: "The ELD sent a revised total.",
      totalMiles: 134,
      taxableMiles: 134,
    });
    expect(revised.revision.number).toBe(2);
    expect(revised.totalMiles).toBe(134);
    const detail = await mockFuelService.getMileage(ctx(), created.id);
    expect(detail.revisions).toHaveLength(2);
    expect(detail.revisions[0].totalMiles).toBe(120);
    expect(detail.revisions[0].state).toBe("corrected");
  });
});

describe("IFTA quarters", () => {
  /** Clears everything outstanding in a quarter so it can legitimately be filed. */
  function makeReady(year: number, quarter: 1 | 2 | 3 | 4) {
    const db = fuelDb();
    for (const t of db.transactions) {
      if (t.organizationId !== "org_northline") continue;
      if (!isWithinQuarter(t.purchasedAt, year, quarter)) continue;
      if (!t.revision.isCurrent) continue;
      t.state = "verified";
      t.receiptDocumentId = t.receiptDocumentId ?? "doc_seeded";
      t.flags = [];
      t.attribution = { ...t.attribution, carrierOrganizationId: "org_northline", basis: "operating_lease" };
      // A purchase outside the jurisdictions driven is a legitimate readiness
      // issue; park it on a jurisdiction the fleet definitely ran in.
      t.location = { ...t.location, jurisdiction: "IL" };
      t.qualifiesForIfta = true;
    }
    for (const r of db.mileage) {
      if (r.organizationId !== "org_northline") continue;
      if (!isWithinQuarter(r.travelStartedAt, year, quarter)) continue;
      if (!r.revision.isCurrent) continue;
      r.state = "verified";
      r.flags = [];
      r.jurisdiction = "IL";
      r.attribution = { ...r.attribution, carrierOrganizationId: "org_northline", basis: "operating_lease" };
    }
  }

  it("lists a quarter per carrier and derives its state from its records", async () => {
    const periods = await mockIftaService.listPeriods(ctx());
    expect(periods.length).toBeGreaterThan(0);
    expect(periods.every((p) => p.period.organizationId === "org_northline")).toBe(true);
    // Newest first.
    expect(periods[0].period.year * 10 + periods[0].period.quarter).toBeGreaterThanOrEqual(
      periods[periods.length - 1].period.year * 10 + periods[periods.length - 1].period.quarter,
    );
  });

  it("exercises every quarter state across the seeded carriers", async () => {
    const northline = await mockIftaService.listPeriods(ctx());
    const baxter = await mockIftaService.listPeriods(contextFor("org_baxter"));
    const states = new Set([
      ...northline.map((p) => p.period.state),
      ...baxter.map((p) => p.period.state),
    ]);
    // `amended` is reachable only by correcting inside a filed quarter, which
    // has its own test below; the other four have to be here from the start.
    expect(states).toEqual(new Set(["incomplete", "needs_review", "ready", "filed"]));
  });

  it("blocks the quarter that has just closed on something real, not on the clock", async () => {
    const periods = await mockIftaService.listPeriods(ctx());
    const closed = periods.find(
      (p) => p.period.state === "needs_review",
    )!;
    expect(closed.readiness.issues).not.toContain("period_not_finished");
    expect(closed.readiness.issues).toContain("missing_receipts");
  });

  it("never reports tax rates as available, because no provider is connected", async () => {
    const periods = await mockIftaService.listPeriods(ctx());
    expect(periods.every((p) => p.taxRatesAvailable === false)).toBe(true);
  });

  it("refuses to record a filing on a quarter that is not ready", async () => {
    const periods = await mockIftaService.listPeriods(ctx());
    const notReady = periods.find((p) => !p.readiness.ready && p.period.state !== "filed")!;
    await expect(
      mockIftaService.recordFiling(ctx(), notReady.period.id, {}),
    ).rejects.toThrow(/not ready/i);
  });

  it("records an external filing on a ready quarter and locks it", async () => {
    const periods = await mockIftaService.listPeriods(ctx());
    const target = periods.find((p) => p.period.state !== "filed" && p.readiness.issues.every((i) => i !== "period_not_finished"))!;
    makeReady(target.period.year, target.period.quarter);

    const filed = await mockIftaService.recordFiling(ctx(), target.period.id, {
      confirmationReference: "IL-2026-0099",
    });
    expect(filed.period.state).toBe("filed");
    expect(filed.period.filing?.channel).toBe("external");
    expect(filed.period.filing?.confirmationReference).toBe("IL-2026-0099");
    expect(filed.period.lockedAt).toBeTruthy();

    await expect(mockIftaService.recordFiling(ctx(), target.period.id, {})).rejects.toThrow(/already recorded as filed/i);
  });

  it("turns a correction inside a filed quarter into an amendment, not a silent edit", async () => {
    const periods = await mockIftaService.listPeriods(ctx());
    const target = periods.find((p) => p.period.state !== "filed" && p.readiness.issues.every((i) => i !== "period_not_finished"))!;
    makeReady(target.period.year, target.period.quarter);
    await mockIftaService.recordFiling(ctx(), target.period.id, {});

    const inPeriod = (await mockFuelService.listTransactions(ctx())).find((t) =>
      isWithinQuarter(t.purchasedAt, target.period.year, target.period.quarter),
    )!;
    await mockFuelService.correctTransaction(ctx(), inPeriod.id, {
      reason: "Receipt says 84.2, not 8.42.",
      gallonsThousandths: inPeriod.gallonsThousandths * 10,
    });

    const after = await mockIftaService.getPeriod(ctx(), target.period.id);
    expect(after.period.state).toBe("amended");
    expect(after.period.amendments).toHaveLength(1);
    expect(after.period.amendments[0].reason).toMatch(/84\.2/);
    expect(after.period.amendments[0].transactionIds).toHaveLength(1);
  });

  it("only lets a filed quarter be amended", async () => {
    const periods = await mockIftaService.listPeriods(ctx());
    const open = periods.find((p) => p.period.state !== "filed")!;
    await expect(mockIftaService.amendPeriod(ctx(), open.period.id, "why")).rejects.toThrow(/has been filed/i);
  });
});

describe("integrations", () => {
  it("reports every extension point as not connected", async () => {
    const integrations = await mockFuelService.integrations(ctx());
    expect(integrations.length).toBeGreaterThan(0);
    expect(integrations.every((i) => i.status === "not_connected")).toBe(true);
    expect(integrations.map((i) => i.kind)).toEqual(
      expect.arrayContaining([
        "fuel_card", "eld", "gps", "telematics", "receipt_ocr", "toll", "accounting", "ifta_provider",
      ]),
    );
  });

  it("imports nothing, and says nothing was contacted", async () => {
    const result = await mockFuelService.runImport(ctx(), "fuel_card");
    expect(result.status).toBe("not_connected");
    expect(result.message).toMatch(/not connected/i);
    expect(result.message).toMatch(/no outside system was contacted/i);
  });

  it("does not invent an adapter that was never declared", async () => {
    await expect(mockFuelService.runImport(ctx(), "acme_fuel")).rejects.toThrow(/not found/i);
  });
});

describe("audit trail", () => {
  it("appends an entry for every state change and never rewrites one", async () => {
    const created = await mockFuelService.recordTransaction(ctx(), { ...purchase, purchasedAt: anHourAgo() });
    const afterCreate = await mockFuelService.audit(ctx(), created.id);
    expect(afterCreate).toHaveLength(1);
    expect(afterCreate[0].kind).toBe("transaction.recorded");
    const firstEntry = { ...afterCreate[0] };

    await mockFuelService.verifyTransaction(ctx(), created.id);
    await mockFuelService.correctTransaction(ctx(), created.id, { reason: "x", gallonsThousandths: 4_000 });

    const after = await mockFuelService.audit(ctx(), created.id);
    expect(after.map((a) => a.kind)).toEqual(
      expect.arrayContaining(["transaction.recorded", "transaction.verified", "transaction.corrected"]),
    );
    expect(after.find((a) => a.id === firstEntry.id)).toEqual(firstEntry);
  });

  it("records what a correction changed, before and after", async () => {
    const created = await mockFuelService.recordTransaction(ctx(), { ...purchase, purchasedAt: anHourAgo() });
    await mockFuelService.correctTransaction(ctx(), created.id, { reason: "x", gallonsThousandths: 4_000 });
    const entry = (await mockFuelService.audit(ctx(), created.id)).find((a) => a.kind === "transaction.corrected")!;
    expect(entry.before?.gallonsThousandths).toBe(40_000);
    expect(entry.after?.gallonsThousandths).toBe(4_000);
  });

  it("never leaks another organization's audit entries", async () => {
    const northline = await mockFuelService.audit(ctx());
    expect(northline.every((a) => a.organizationId === "org_northline")).toBe(true);
  });
});
