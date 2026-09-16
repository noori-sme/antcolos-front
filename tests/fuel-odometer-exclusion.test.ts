import test from "node:test";
import assert from "node:assert/strict";
import { mockFuelService } from "@/lib/api/mock/fuel";
import { resetFuelStore } from "@/lib/api/mock/fuel-store";
import { meterReadings, meterStateOf, resetMeterLedger } from "@/lib/api/mock/meter-ledger";
import { mockNeedsYouService } from "@/lib/api/mock/needs-you";
import { propagationBus, readableProjectionsFor, resetPropagationBus } from "@/lib/propagation";
import {
  approveCarrierRelationship, endCarrierRelationship, FIXTURE_VINS, operatingContextAt,
  registerOrConnectTruck, resetTruckRegistry, truckContextFrom, TRUCK_IDS,
} from "@/lib/api/mock/truck-registry";
import { resetTrailerRegistry } from "@/lib/api/mock/trailer-registry";
import { mockStore } from "@/lib/api/mock/store";
import { serviceContext } from "./helpers.ts";

/**
 * ★ WHAT HAPPENS TO AN ODOMETER THE LEDGER WOULD NOT TAKE ★
 *
 * A6 refuses a meter reading whose operating carrier the canonical records
 * cannot establish, and fuel keeps the receipt anyway, because a purchase that
 * happened is a fact whoever it belonged to. That leaves one value in an
 * awkward place — recorded on the receipt, absent from the ledger — and these
 * are the four questions that decide whether that is honest or lossy.
 */

const NORTHLINE = "org_northline";
const DAY = 86_400_000;
const ctx = () => serviceContext("mem_northline_owner");
/** Before anybody was onboarded on unit 131, so nothing covers the moment. */
const beforeAnyAuthority = () => new Date(Date.now() - 300 * DAY).toISOString();

const purchase = {
  truckId: TRUCK_IDS.nl131,
  location: { jurisdiction: "IL", address: { city: "Rockford", state: "IL" } },
  fuelType: "diesel" as const,
  gallonsThousandths: 40_000,
  pricePerGallonMills: 3_899,
  totalCostCents: 15_596,
};

test.beforeEach(() => {
  resetTruckRegistry();
  resetTrailerRegistry();
  resetFuelStore();
  resetMeterLedger();
  resetPropagationBus();
  mockStore.reset();
});

/* -------------------------------------------------------------------------- */
/* 1. The value is kept, with everything needed to use it later                */
/* -------------------------------------------------------------------------- */

test("the odometer stays on the canonical fuel record, with its source and its instants", async () => {
  const at = beforeAnyAuthority();
  const created = await mockFuelService.recordTransaction(ctx(), {
    ...purchase, odometerMiles: 41_200, purchasedAt: at,
  });

  // The reading itself, and everything a later contribution needs from it.
  assert.equal(created.odometerMiles, 41_200);
  assert.equal(created.purchasedAt, at, "when the meter was read");
  assert.equal(created.source, "manual", "how it got here");
  assert.ok(created.createdAt, "when Antcolos learned it");
  assert.equal(created.createdBy.membershipId, "mem_northline_owner", "who put it there");
  assert.equal(created.truckId, TRUCK_IDS.nl131);

  // And it is NOT in the ledger, because the ledger holds nothing it cannot
  // attribute. Nothing was discarded and nothing was written twice.
  assert.equal(
    meterReadings(TRUCK_IDS.nl131).some((r) => r.odometerMiles === 41_200), false,
  );
});

/* -------------------------------------------------------------------------- */
/* 2. The failure reaches a person through the queue that already exists       */
/* -------------------------------------------------------------------------- */

test("the attribution failure is raised to the responsible person, at high severity", async () => {
  const created = await mockFuelService.recordTransaction(ctx(), {
    ...purchase, odometerMiles: 41_200, purchasedAt: beforeAnyAuthority(),
  });
  assert.ok(created.flags.includes("no_active_operating_authority"));

  const queue = await mockNeedsYouService.list(ctx());
  const raised = queue.find(
    (i) => i.category === "suspicious_fuel_transaction" && i.id.includes(created.id),
  );
  assert.ok(raised, "the purchase is in Needs You");
  assert.equal(raised.severity, "high");
  assert.match(raised.reason, /authority/i);
  // The consequence is said out loud, not left for somebody to deduce.
  assert.match(
    `${raised.reason} ${raised.detail ?? ""}`, /ledger/i,
    "and it says the odometer stayed out of the meter ledger",
  );
  assert.ok(raised.requires.length > 0, "and only somebody entitled to fuel sees it");
});

/* -------------------------------------------------------------------------- */
/* 3. Once the records are fixed, the same reading can still land              */
/* -------------------------------------------------------------------------- */

test("republishing the same receipt contributes its odometer exactly once", async () => {
  // The mechanism a recovery would use, on a purchase whose carrier IS
  // establishable. The contribution is keyed on the transaction's own id, so
  // reviewing the receipt again — or any other republication of it — cannot
  // append a second copy of one reading.
  const created = await mockFuelService.recordTransaction(ctx(), {
    ...purchase, odometerMiles: 44_100, purchasedAt: new Date(Date.now() - 3_600_000).toISOString(),
  });
  const landed = () => meterReadings(TRUCK_IDS.nl131).filter((r) => r.odometerMiles === 44_100);
  assert.equal(landed().length, 1, "the odometer reached the ledger with the purchase");

  await mockFuelService.verifyTransaction(ctx(), created.id);
  assert.equal(landed().length, 1, "reviewing it republishes and appends nothing");

  await mockFuelService.verifyTransaction(ctx(), created.id);
  assert.equal(landed().length, 1, "and again");
  assert.equal(landed()[0].scope.organizationId, NORTHLINE);
});

test("★ GAP: an excluded reading has no canonical way back into the ledger", async () => {
  // Baxter onboards onto Marcus Hale's truck, which Northline runs. From that
  // moment two carriers cover it and neither owns it, so nothing can say whose
  // a reading is.
  const baxter = truckContextFrom(serviceContext("mem_baxter_owner"));
  const connected = await registerOrConnectTruck(baxter, {
    vin: FIXTURE_VINS.nl118,
    equipmentType: "tractor", unitNumber: "BX-118", year: 2021, make: "Ram", model: "5500",
    registration: {
      plateNumber: "PA-0001", plateState: "PA",
      expiresAt: new Date(Date.now() + 90 * DAY).toISOString(),
      registeredOwnerName: "Marcus Hale",
    },
    specs: {}, status: "available", availability: {},
    relationshipType: "leased_owner_operator",
    ownerType: "person", ownerName: "Marcus Hale", evidence: [],
  });
  assert.ok(connected.status === "relationship_pending");
  await approveCarrierRelationship(connected.relationship.id, baxter);

  const at = new Date().toISOString();
  assert.equal(operatingContextAt(TRUCK_IDS.nl118, at).resolved, false, "genuinely unanswerable");

  const created = await mockFuelService.recordTransaction(ctx(), {
    ...purchase, truckId: TRUCK_IDS.nl118, odometerMiles: 99_450, purchasedAt: at,
  });
  assert.equal(created.odometerMiles, 99_450, "the receipt keeps the number");
  const landed = () => meterReadings(TRUCK_IDS.nl118).filter((r) => r.odometerMiles === 99_450);
  assert.equal(landed().length, 0);

  // Baxter stands the mistake down through the canonical path.
  await endCarrierRelationship(connected.relationship.id, "Onboarded by mistake.", baxter);

  // ★ AND THE MOMENT IS STILL UNANSWERABLE. ★
  // Ending a relationship records that it ended NOW; it does not un-cover the
  // interval it genuinely covered, and it must not — that is the same
  // append-only history that stops a later change rewriting past attribution.
  // Every canonical write starts its interval at `now`, so no correction
  // reaches backwards, and this reading can never be contributed.
  assert.equal(operatingContextAt(TRUCK_IDS.nl118, at).resolved, false);
  await mockFuelService.verifyTransaction(ctx(), created.id);
  assert.equal(landed().length, 0, "republishing changes nothing, because the records have not");

  // What is NOT true is that anything was lost or duplicated: the value, its
  // instant and its source are on the receipt, and one ledger holds the
  // readings it can stand behind.
  const detail = await mockFuelService.getTransaction(ctx(), created.id);
  assert.equal(detail.transaction.odometerMiles, 99_450);
  assert.equal(detail.transaction.purchasedAt, at);
});

/* -------------------------------------------------------------------------- */
/* 4. Nothing claims the reading was recorded when it was not                  */
/* -------------------------------------------------------------------------- */

test("no record or projection says the ledger took a reading it refused", async () => {
  const created = await mockFuelService.recordTransaction(ctx(), {
    ...purchase, odometerMiles: 41_200, purchasedAt: beforeAnyAuthority(),
  });

  // The ledger's own answer for the truck does not include it, by value or by
  // count, and the derived state does not name the purchase's reading.
  const state = meterStateOf(TRUCK_IDS.nl131);
  assert.notEqual(state.odometer?.value, 41_200);
  assert.equal(state.disputed.some((r) => r.odometerMiles === 41_200), false,
    "not even as a disputed reading — it was never appended");

  // The event's projections are the fuel module's own. The meter projection
  // handles only `equipment_meter.reading_recorded`, so it is never offered
  // this event and cannot report success about it.
  const [event] = propagationBus.events(NORTHLINE)
    .filter((e) => e.kind === "fuel_transaction.confirmed" && e.subjectId === created.id);
  assert.ok(event);
  const rows = readableProjectionsFor(ctx(), event.eventId);
  assert.equal(rows.some((r) => r.subscriberId === "maintenance_meter"), false);
  for (const row of rows) {
    assert.ok(
      !/meter ledger/i.test(`${row.detail} ${row.reason ?? ""}`),
      `${row.subscriberId} must not claim the meter ledger took this`,
    );
  }

  // No meter event exists for the equipment at all.
  assert.equal(
    propagationBus.events(NORTHLINE)
      .some((e) => e.kind === "equipment_meter.reading_recorded"),
    false,
  );
});
