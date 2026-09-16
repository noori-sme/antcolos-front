import test from "node:test";
import assert from "node:assert/strict";
import { loopContextFor, resetPropagationWorld } from "./propagation-harness.ts";
import { contextFor } from "@/test/context";
import { mockFuelService } from "@/lib/api/mock/fuel";
import { TRUCK_IDS } from "@/lib/api/mock/truck-registry";
import { listRequirementsSync, meterFor } from "@/lib/api/mock/maintenance-registry";
import {
  meterReadings, meterStateOf, meterDisputeReason,
} from "@/lib/api/mock/meter-ledger";
import { propagationBus } from "@/lib/propagation";
import type { FuelTransaction } from "@/types";

/**
 * The second Required Example: a fuel receipt, and everything it moves.
 *
 * The headline is the last test in this file. An oil change due at a mileage now
 * comes due from a fuel purchase, because the odometer on the receipt is a meter
 * reading and there is one meter ledger. Before this, mileage had to be typed
 * into the fuel screen, the fleet screen and the maintenance screen separately,
 * and none of the three moved the other two.
 */

const TRUCK = TRUCK_IDS.nl104;
const ORG = "org_northline";
const MAINTENANCE_CTX = "mem_northline_owner";

function fuelCtx() {
  return contextFor(ORG);
}

async function purchase(overrides: Partial<{
  odometerMiles: number;
  gallonsThousandths: number;
  totalCostCents: number;
  jurisdiction: string;
  purchasedAt: string;
  extracted: Record<string, unknown>;
}> = {}): Promise<FuelTransaction> {
  return mockFuelService.recordTransaction(fuelCtx(), {
    truckId: TRUCK,
    purchasedAt: overrides.purchasedAt ?? new Date().toISOString(),
    location: {
      jurisdiction: overrides.jurisdiction ?? "IN",
      merchantName: "Pilot #442",
      city: "Lafayette",
      state: "IN",
    },
    odometerMiles: overrides.odometerMiles,
    fuelType: "diesel",
    gallonsThousandths: overrides.gallonsThousandths ?? 132_400,
    pricePerGallonMills: 3_889,
    totalCostCents: overrides.totalCostCents ?? 51_500,
    extracted: overrides.extracted as never,
  });
}

test.beforeEach(() => resetPropagationWorld());

/* -------------------------------------------------------------------------- */

test("one receipt produces one canonical transaction and one event", async () => {
  const t = await purchase({ odometerMiles: 131_900 });

  const events = propagationBus
    .events(ORG)
    .filter((e) => e.kind === "fuel_transaction.confirmed" && e.subjectId === t.id);
  assert.equal(events.length, 1, "exactly one event for the transaction");
  assert.equal(events[0].version, 1);

  // Every subscriber ran, exactly once, and said something.
  const rows = propagationBus.projectionsFor(ORG, events[0].eventId);
  const ids = rows.map((r) => r.subscriberId);
  for (const expected of [
    "fuel_cost", "fuel_economy", "ifta_preparation", "fuel_accounting", "fuel_reports",
  ]) {
    assert.ok(ids.includes(expected), `${expected} was offered the event`);
  }
  for (const row of rows) {
    assert.equal(row.attempts, 1);
    assert.ok(row.detail.length > 0);
    if (row.state !== "processed") assert.ok(row.reason, `${row.subscriberId} says why`);
  }

  // Republishing is the retry a flaky call produces. Nothing runs twice.
  const replay = await propagationBus.publish(events[0]);
  assert.equal(replay.duplicate, true);
  assert.deepEqual(
    propagationBus.projectionsFor(ORG, events[0].eventId).map((r) => r.attempts),
    rows.map(() => 1),
  );
});

test("a correction keeps both values and does not duplicate the transaction", async () => {
  const original = await purchase({
    odometerMiles: 131_900,
    gallonsThousandths: 132_400,
    totalCostCents: 51_500,
  });

  const revised = await mockFuelService.correctTransaction(fuelCtx(), original.id, {
    reason: "The pump receipt reads 128.400 gal, not 132.400.",
    gallonsThousandths: 128_400,
    totalCostCents: 49_940,
  });

  // A new revision, the same lineage, the original superseded rather than edited.
  assert.notEqual(revised.id, original.id);
  assert.equal(revised.revision.originalId, original.revision.originalId);
  assert.equal(revised.revision.supersedesId, original.id);
  assert.equal(revised.revision.number, 2);

  const events = propagationBus
    .events(ORG)
    .filter((e) => e.kind === "fuel_transaction.confirmed");
  assert.equal(events.length, 2, "one event per revision, never one per reader");

  const corrected = events.find((e) => e.subjectId === revised.id)!;
  const payload = corrected.payload as {
    extracted?: { gallonsThousandths?: number; totalCostCents?: number };
    gallonsThousandths: number;
    correctionReason?: string;
    supersedesTransactionId?: string;
  };
  // What the receipt said travels with what a person confirmed.
  assert.equal(payload.extracted?.gallonsThousandths, 132_400);
  assert.equal(payload.gallonsThousandths, 128_400);
  assert.ok(payload.correctionReason);
  assert.equal(payload.supersedesTransactionId, original.id);

  // The projection spells the difference out rather than quietly replacing it.
  const cost = propagationBus
    .projectionsFor(ORG, corrected.eventId)
    .find((r) => r.subscriberId === "fuel_cost")!;
  assert.match(cost.detail, /shown as 132\.400, corrected to 128\.400/);
});

test("a purchase with no odometer cannot move fuel economy, and says so", async () => {
  const t = await purchase({});
  const event = propagationBus
    .events(ORG)
    .find((e) => e.kind === "fuel_transaction.confirmed" && e.subjectId === t.id)!;
  const economy = propagationBus
    .projectionsFor(ORG, event.eventId)
    .find((r) => r.subscriberId === "fuel_economy")!;
  assert.equal(economy.state, "needs_review");
  assert.match(economy.reason ?? "", /odometer/i);
  assert.equal(economy.retryable, true);
});

test("the pump odometer reaches the one meter ledger, tagged as a fuel receipt", async () => {
  const before = meterStateOf(TRUCK).readingCount;
  await purchase({ odometerMiles: 131_900 });

  const state = meterStateOf(TRUCK);
  assert.equal(state.readingCount, before + 1);
  assert.equal(state.odometer?.value, 131_900);
  assert.equal(state.odometer?.source, "fuel_receipt");
  assert.equal(state.odometer?.contributor, "fuel");

  // Append-only: the earlier readings are all still there.
  const readings = meterReadings(TRUCK);
  assert.equal(readings.length, before + 1);
  assert.ok(readings.some((r) => r.contributor === "maintenance"));
  assert.ok(readings.some((r) => r.contributor === "fleet"));
});

test("a receipt whose odometer runs backwards is kept as evidence, never accepted", async () => {
  await purchase({ odometerMiles: 131_900 });
  // Somebody reads the wrong truck's dash.
  await purchase({ odometerMiles: 98_000, jurisdiction: "IL" });

  const state = meterStateOf(TRUCK);
  assert.equal(state.odometer?.value, 131_900, "the accepted value does not go down");

  const regression = state.disputed.find((r) => r.odometerMiles === 98_000);
  assert.ok(regression, "the bad reading is kept, not discarded");
  const why = meterDisputeReason(regression, state);
  assert.match(why ?? "", /does not go backwards/i);

  // And the maintenance projection reports it rather than silently ignoring it.
  const event = propagationBus
    .events(ORG)
    .filter((e) => e.kind === "equipment_meter.reading_recorded")
    .find((e) => (e.payload as { odometerMiles?: number }).odometerMiles === 98_000)!;
  const row = propagationBus
    .projectionsFor(ORG, event.eventId)
    .find((r) => r.subscriberId === "maintenance_meter")!;
  assert.equal(row.state, "needs_review");
  assert.match(row.reason ?? "", /backwards|already on file/i);
});

/* -------------------------------------------------------------------------- */
/* The headline                                                                */
/* -------------------------------------------------------------------------- */

test("an oil change comes due from a fuel receipt, with nobody re-entering mileage", async () => {
  const mctx = loopContextFor(MAINTENANCE_CTX);
  const ref = { kind: "truck" as const, equipmentId: TRUCK };

  const oilBefore = listRequirementsSync(mctx as never)
    .find((r) => r.requirement.id === "req_nl104_oil")!;
  const meterBefore = meterFor(ref)!.latest!.odometerMiles!;
  assert.ok(oilBefore, "unit 104 has a mileage-triggered oil change");
  assert.equal(oilBefore.due.kind, "mileage");

  // A driver buys fuel and writes down the dash. That is the only entry.
  await purchase({ odometerMiles: meterBefore + 13_400 });

  const meterAfter = meterFor(ref)!;
  assert.equal(meterAfter.latest?.odometerMiles, meterBefore + 13_400);
  assert.equal(
    meterAfter.latest?.source, "fuel_receipt",
    "maintenance shows where the reading came from rather than calling it manual",
  );

  const oilAfter = listRequirementsSync(mctx as never)
    .find((r) => r.requirement.id === "req_nl104_oil")!;
  assert.equal(oilAfter.due.kind, "mileage");
  assert.ok(
    oilAfter.due.remainingMiles! < oilBefore.due.remainingMiles!,
    `the oil change moved: ${oilBefore.due.label} → ${oilAfter.due.label}`,
  );
  assert.equal(oilAfter.state, "overdue");

  // Nothing was written into maintenance's own store, because it has none.
  const readings = meterReadings(TRUCK).filter((r) => r.contributor === "fuel");
  assert.equal(readings.length, 1);
});
