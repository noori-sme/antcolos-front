import test from "node:test";
import assert from "node:assert/strict";
import { mockFuelService } from "@/lib/api/mock/fuel";
import { resetFuelStore } from "@/lib/api/mock/fuel-store";
import { meterReadings, meterStateOf, resetMeterLedger } from "@/lib/api/mock/meter-ledger";
import { resetPropagationBus } from "@/lib/propagation";
import { resetTruckRegistry, TRUCK_IDS } from "@/lib/api/mock/truck-registry";
import { resetTrailerRegistry } from "@/lib/api/mock/trailer-registry";
import { mockStore } from "@/lib/api/mock/store";
import { serviceContext } from "./helpers.ts";

/**
 * ★ ONE DASH READING IS ONE READING, HOWEVER OFTEN THE RECEIPT IS CORRECTED ★
 *
 * The meter contribution is keyed on the transaction id, and `correctTransaction`
 * mints a NEW id for every revision. That is right — a revision is a distinct
 * thing somebody wrote down, and the superseded pump reading was still a number
 * on a dash. What it must never mean is that one physical reading is COUNTED
 * twice, or that a value somebody has since corrected keeps its vote.
 *
 * Three ways a correction can move, and all three are here: leave the reading
 * alone, change the number, change the moment.
 */

const ctx = () => serviceContext("mem_northline_owner");
/** Unit 111 is approved to exactly one carrier, so attribution never gets in the way. */
const TRUCK = TRUCK_IDS.nl111;
const anHourAgo = () => new Date(Date.now() - 3_600_000).toISOString();

const purchase = {
  truckId: TRUCK,
  location: { jurisdiction: "IL", address: { city: "Rockford", state: "IL" } },
  fuelType: "diesel" as const,
  gallonsThousandths: 40_000,
  pricePerGallonMills: 3_899,
  totalCostCents: 15_596,
};

/** Readings this module contributed, oldest first. */
const fuelRows = () => meterReadings(TRUCK)
  .filter((r) => r.contributor === "fuel")
  .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));

/** Readings the ledger would actually let stand as the truck's odometer. */
const eligible = () => fuelRows().filter(
  (r) => !r.flags.includes("corrected") && !r.flags.includes("duplicate"),
);

test.beforeEach(() => {
  resetTruckRegistry();
  resetTrailerRegistry();
  resetFuelStore();
  resetMeterLedger();
  resetPropagationBus();
  mockStore.reset();
});

test("a correction that leaves the reading alone does not count it twice", async () => {
  const at = anHourAgo();
  const first = await mockFuelService.recordTransaction(ctx(), {
    ...purchase, odometerMiles: 216_500, purchasedAt: at,
  });
  await mockFuelService.correctTransaction(ctx(), first.id, {
    reason: "The gallons were mis-keyed.", gallonsThousandths: 38_000,
  });

  // Both revisions contributed, because both are things somebody recorded.
  assert.equal(fuelRows().length, 2);
  // Exactly one of them can stand: the superseded reading is marked as
  // corrected by the one that replaced it.
  assert.equal(eligible().length, 1, "one physical reading, one vote");
  assert.equal(eligible()[0].odometerMiles, 216_500);
  assert.ok(fuelRows()[0].flags.includes("corrected"), "the first points forward");
  assert.equal(fuelRows()[1].correctsReadingId, fuelRows()[0].readingId);
});

test("a corrected odometer wins, and the number it replaced stops counting", async () => {
  // The case the link exists for. Without it both values were eligible at the
  // same instant, and the SUPERSEDED one could be accepted — a typo outvoting
  // its own correction.
  const at = anHourAgo();
  const first = await mockFuelService.recordTransaction(ctx(), {
    ...purchase, odometerMiles: 261_500, purchasedAt: at,
  });
  await mockFuelService.correctTransaction(ctx(), first.id, {
    reason: "Transposed digits: it read 216,500.", odometerMiles: 216_500,
  });

  assert.equal(eligible().length, 1);
  assert.equal(eligible()[0].odometerMiles, 216_500, "the corrected number is the one that counts");
  const superseded = fuelRows().find((r) => r.odometerMiles === 261_500);
  assert.ok(superseded?.flags.includes("corrected"), "and the typo is kept as evidence, not as truth");

  // The derived state agrees, and reports the superseded value as disputed
  // rather than hiding it.
  const state = meterStateOf(TRUCK);
  assert.notEqual(state.odometer?.value, 261_500);
  assert.ok(state.disputed.some((r) => r.odometerMiles === 261_500));
});

test("a correction that moves the moment does not become a second reading", async () => {
  // The quietest of the three. One dash reading, recorded against the wrong
  // time and then fixed, used to appear as two readings at two moments with
  // the same number and nothing linking them.
  const first = await mockFuelService.recordTransaction(ctx(), {
    ...purchase, odometerMiles: 216_500, purchasedAt: anHourAgo(),
  });
  const corrected = new Date(Date.now() - 2 * 3_600_000).toISOString();
  await mockFuelService.correctTransaction(ctx(), first.id, {
    reason: "The pump receipt is timestamped an hour earlier.", purchasedAt: corrected,
  });

  assert.equal(fuelRows().length, 2);
  assert.equal(eligible().length, 1, "one reading, at one moment");
  assert.equal(eligible()[0].readAt, corrected);
  assert.equal(eligible()[0].odometerMiles, 216_500);
});

test("a chain of corrections leaves exactly one reading standing", async () => {
  const at = anHourAgo();
  const first = await mockFuelService.recordTransaction(ctx(), {
    ...purchase, odometerMiles: 216_100, purchasedAt: at,
  });
  const second = await mockFuelService.correctTransaction(ctx(), first.id, {
    reason: "Second look at the receipt.", odometerMiles: 216_400,
  });
  await mockFuelService.correctTransaction(ctx(), second.id, {
    reason: "Third look, with the photo.", odometerMiles: 216_500,
  });

  assert.equal(fuelRows().length, 3, "every revision is on the record");
  assert.equal(eligible().length, 1, "and one of them is the reading");
  assert.equal(eligible()[0].odometerMiles, 216_500);
});

test("republishing a revision cannot append a second copy of it", async () => {
  // The key is the revision's own id, so re-publishing the SAME revision — a
  // review, a retried call — is idempotent. This is the half that already
  // worked, pinned so it stays working alongside the lineage link.
  const at = anHourAgo();
  const first = await mockFuelService.recordTransaction(ctx(), {
    ...purchase, odometerMiles: 216_500, purchasedAt: at,
  });
  const revised = await mockFuelService.correctTransaction(ctx(), first.id, {
    reason: "Gallons.", gallonsThousandths: 38_000,
  });

  await mockFuelService.verifyTransaction(ctx(), revised.id);
  await mockFuelService.verifyTransaction(ctx(), revised.id);

  assert.equal(fuelRows().length, 2, "still one row per revision");
  assert.equal(eligible().length, 1);
});
