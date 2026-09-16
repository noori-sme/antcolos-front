import test from "node:test";
import assert from "node:assert/strict";
import {
  contributeMeterReading, meterDisputeReason, meterIsStale, meterReadings,
  meterStateOf, resetMeterLedger,
} from "@/lib/api/mock/meter-ledger";
import * as meterLedger from "@/lib/api/mock/meter-ledger";
import { TRUCK_IDS } from "@/lib/api/mock/truck-registry";
import type { ContributeMeterReadingInput } from "@/lib/api/mock/meter-ledger";

/**
 * The canonical Equipment Meter Ledger.
 *
 * One physical truck, one odometer. The properties tested here are the ones the
 * design rests on: the history is append-only, the accepted value is derived
 * rather than stored, the derivation does not depend on which module reported
 * first, a correction appends instead of overwriting, and NOTHING about a change
 * of owner, carrier or operating authority resets or splits the series.
 */

/**
 * The seeded truck, for the tests about the seed itself.
 */
const SEEDED = TRUCK_IDS.nl104;

/**
 * A truck the seed deliberately holds NO reading for.
 *
 * Every synthetic test below uses it, so a made-up number can never collide with
 * the fixture series and produce a dispute the test did not mean to create. An
 * asset nobody has ever reported on is a real state and the seed keeps one on
 * purpose; this borrows it.
 */
const TRUCK = TRUCK_IDS.nl121;
const HOUR = 3_600_000;
const hoursAgo = (h: number) => new Date(Date.now() - h * HOUR).toISOString();

let n = 0;
function reading(
  odometerMiles: number,
  at: string,
  over: Partial<ContributeMeterReadingInput> = {},
): ContributeMeterReadingInput {
  n += 1;
  return {
    equipmentKind: "truck",
    equipmentId: TRUCK,
    equipmentLabel: "NL-121",
    odometerMiles,
    readAt: at,
    source: "manual_entry",
    contributor: "fleet",
    scope: { organizationId: "org_northline", carrierOrganizationId: "org_northline" },
    verification: "confirmed",
    idempotencyKey: `test:${n}`,
    provenance: {
      module: "telematics", adapter: "mock:test", mock: true,
      observedAt: at, receivedAt: at,
    },
    ...over,
  };
}

test.beforeEach(() => {
  resetMeterLedger();
  n = 0;
});

/* -------------------------------------------------------------------------- */

test("the seeded history is one series per truck, and it climbs", () => {
  const state = meterStateOf(SEEDED);
  assert.ok(state.odometer, "NL-104 has an accepted odometer");
  assert.ok(state.readingCount >= 2, "from more than one contributor");
  assert.equal(
    state.disputed.length, 0,
    "and the two fixture sets that used to disagree about it now agree",
  );

  const series = meterReadings(SEEDED)
    .filter((r) => r.odometerMiles !== undefined)
    .sort((a, b) => Date.parse(a.readAt) - Date.parse(b.readAt));
  let previous = -Infinity;
  for (const r of series) {
    assert.ok(
      r.odometerMiles! >= previous,
      `the seeded series does not go backwards at ${r.readAt}`,
    );
    previous = r.odometerMiles!;
  }
});

test("the accepted value is the latest reading, whoever reported it", () => {
  contributeMeterReading(reading(200_000, hoursAgo(5), { contributor: "maintenance" }));
  contributeMeterReading(reading(200_400, hoursAgo(1), { contributor: "fuel", source: "fuel_receipt" }));

  const state = meterStateOf(TRUCK);
  assert.equal(state.odometer?.value, 200_400);
  assert.equal(state.odometer?.contributor, "fuel");
  assert.equal(state.odometer?.source, "fuel_receipt");
});

test("the derivation does not depend on which module reported first", () => {
  // Same two facts, opposite arrival order. A meter that answered differently
  // depending on that is exactly how three modules held three odometers.
  resetMeterLedger();
  contributeMeterReading(reading(300_000, hoursAgo(10)));
  contributeMeterReading(reading(301_000, hoursAgo(2)));
  const forwards = meterStateOf(TRUCK).odometer?.value;

  resetMeterLedger();
  n = 0;
  contributeMeterReading(reading(301_000, hoursAgo(2)));
  contributeMeterReading(reading(300_000, hoursAgo(10)));
  const backwards = meterStateOf(TRUCK).odometer?.value;

  assert.equal(forwards, backwards);
  assert.equal(forwards, 301_000);
});

test("a reading below what was already true is kept, and not used", () => {
  contributeMeterReading(reading(400_000, hoursAgo(10)));
  contributeMeterReading(reading(395_000, hoursAgo(1)));

  const state = meterStateOf(TRUCK);
  assert.equal(state.odometer?.value, 400_000, "the accepted value does not fall");

  const bad = state.disputed.find((r) => r.odometerMiles === 395_000);
  assert.ok(bad, "the reading survives as evidence somebody reported it");
  assert.match(meterDisputeReason(bad, state) ?? "", /does not go backwards/i);
  assert.equal(
    meterReadings(TRUCK).filter((r) => r.odometerMiles === 395_000).length, 1,
    "nothing was deleted",
  );
});

test("a correction appends and marks, it never overwrites", () => {
  const first = contributeMeterReading(reading(500_000, hoursAgo(4)));
  const fix = contributeMeterReading(reading(510_000, hoursAgo(4), {
    correctsReadingId: first.reading.readingId,
    correctionReason: "Transposed digits on the original.",
  }));

  const rows = meterReadings(TRUCK);
  const original = rows.find((r) => r.readingId === first.reading.readingId)!;
  assert.ok(original, "the original reading is still there");
  assert.ok(original.flags.includes("corrected"), "marked, not edited");
  assert.equal(original.odometerMiles, 500_000, "with its original value intact");

  assert.equal(meterStateOf(TRUCK).odometer?.value, 510_000);
  assert.equal(fix.reading.correctsReadingId, first.reading.readingId);
  assert.equal(fix.reading.correctionReason, "Transposed digits on the original.");
});

test("a retried contribution writes once", () => {
  const input = reading(600_000, hoursAgo(3));
  const first = contributeMeterReading(input);
  const second = contributeMeterReading(input);

  assert.equal(second.duplicate, true);
  assert.equal(second.reading.readingId, first.reading.readingId);
  assert.equal(
    meterReadings(TRUCK).filter((r) => r.odometerMiles === 600_000).length, 1,
  );
});

/* -------------------------------------------------------------------------- */
/* The one the design turns on                                                 */
/* -------------------------------------------------------------------------- */

test("history is never reset or split when the carrier or authority changes", () => {
  // Northline runs the truck, then hands it to Baxter under a different
  // operating authority. Same physical truck, same odometer.
  contributeMeterReading(reading(700_000, hoursAgo(20), {
    scope: {
      organizationId: "org_northline",
      carrierOrganizationId: "org_northline",
      operatingAuthorityId: "oa_northline",
    },
  }));
  contributeMeterReading(reading(700_900, hoursAgo(10), {
    scope: {
      organizationId: "org_baxter",
      carrierOrganizationId: "org_baxter",
      operatingAuthorityId: "oa_baxter",
    },
  }));
  contributeMeterReading(reading(701_600, hoursAgo(2), {
    scope: {
      organizationId: "org_baxter",
      carrierOrganizationId: "org_baxter",
      operatingAuthorityId: "oa_baxter",
    },
  }));

  const state = meterStateOf(TRUCK);
  // One series. The new carrier gets the odometer the truck actually has, not a
  // series that starts at zero the day they took it on.
  assert.equal(state.odometer?.value, 701_600);
  assert.equal(state.odometer?.recordedByOrganizationId, "org_baxter");
  assert.ok(
    meterReadings(TRUCK).some((r) => r.odometerMiles === 700_000),
    "and Northline's readings are still in the history",
  );
  assert.equal(state.disputed.length, 0, "with no dispute caused by the handover");
});

test("a fact's own scope fields never decide who may read it", () => {
  contributeMeterReading(reading(800_000, hoursAgo(6), {
    scope: { organizationId: "org_northline", carrierOrganizationId: "org_northline" },
  }));
  contributeMeterReading(reading(800_500, hoursAgo(1), {
    scope: { organizationId: "org_baxter", carrierOrganizationId: "org_baxter" },
  }));

  // `visibleMeterReadings` used to return every reading whose scope NAMED the
  // caller — as the recorder, the carrier or the dispatch workspace — which is
  // a cross-organization read grant handed out by the attribution fields
  // themselves. It is gone, and the ledger exports nothing that takes an
  // organization and hands back rows.
  assert.equal(
    (meterLedger as Record<string, unknown>).visibleMeterReadings, undefined,
    "the scope-equality read helper is not back",
  );

  // What remains is unscoped and says so. Deciding who may see a unit's history
  // belongs to the module that owns the equipment.
  assert.equal(meterReadings(TRUCK).length, 2);

  // The accepted value is deliberately not narrowed either: a carrier taking
  // over a truck needs the odometer it has, not the odometer it can see the
  // paperwork for.
  assert.equal(meterStateOf(TRUCK).odometer?.value, 800_500);
});

test("a stale reading is labelled, not discarded", () => {
  resetMeterLedger();
  n = 0;
  contributeMeterReading(reading(900_000, hoursAgo(24 * 60)));
  const state = meterStateOf(TRUCK);
  assert.equal(state.odometer?.value, 900_000, "a stale number beats no number");
  assert.equal(meterIsStale(state.odometer, 21), true, "and it is labelled as old");
  assert.equal(meterIsStale(state.odometer, 90), false);
});

test("a reading with neither meter is refused, and a negative one too", () => {
  assert.throws(
    () => contributeMeterReading({ ...reading(0, hoursAgo(1)), odometerMiles: undefined }),
    /odometer value, engine hours, or both/,
  );
  assert.throws(() => contributeMeterReading(reading(-1, hoursAgo(1))), /negative/);
});

test("odometer and engine hours are independent", () => {
  contributeMeterReading(reading(950_000, hoursAgo(5)));
  contributeMeterReading({
    ...reading(0, hoursAgo(3)),
    odometerMiles: undefined,
    engineHours: 12_000,
  });
  const state = meterStateOf(TRUCK);
  assert.equal(state.engineHours?.value, 12_000);
  // A reading that captured only the hour meter must never be completed with a
  // guess at the other, so the odometer still reads what it read before.
  assert.equal(state.odometer?.value, 950_000);
});
