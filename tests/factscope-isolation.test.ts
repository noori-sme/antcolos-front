import test from "node:test";
import assert from "node:assert/strict";
import {
  contributeAndPublish, meterReadings, resetMeterLedger,
  type ContributeMeterReadingInput,
} from "@/lib/api/mock/meter-ledger";
import {
  buildDomainEvent, EVENT_SCOPE_MATRIX, EventScopeRefusedError,
  FUEL_TRANSACTION_CONFIRMED_VERSION, LOAD_FINALIZED_VERSION,
  METER_READING_RECORDED_VERSION, meterFactScopeAt, propagationBus, resetPropagationBus,
} from "@/lib/propagation";
import {
  approveCarrierRelationship, endCarrierRelationship, FIXTURE_VINS, operatingContextAt,
  recordTerminationStep,
  registerOrConnectTruck, releaseOperatingLease, resetTruckRegistry, truckContextFrom,
  TRUCK_IDS,
} from "@/lib/api/mock/truck-registry";
import {
  resetTrailerRegistry, TRAILER_IDS, trailerOperatingContextAt,
} from "@/lib/api/mock/trailer-registry";
import { resolveOperatingContextAt } from "@/lib/fleet/operating-context";
import { mockFleetService } from "@/lib/api/mock/fleet-operations";
import { mockFuelService } from "@/lib/api/mock/fuel";
import { resetFuelStore } from "@/lib/api/mock/fuel-store";
import { resetFleetTelemetry } from "@/lib/api/mock/fleet-telemetry";
import { recordMeterReading, resetMaintenanceRegistry } from "@/lib/api/mock/maintenance-registry";
import { retryDistribution } from "@/lib/api/mock/rate-confirmation";
import { MOCK_MEMBERSHIPS, MOCK_ORGANIZATIONS } from "@/lib/session/fixtures";
import { ALL_PERMISSIONS, ctxFor, serviceContext } from "./helpers.ts";
import type { ActorRef, DomainEventKind, FactScope } from "@/types";

/**
 * ★ A6 — FACT SCOPE AND CROSS-ORGANIZATION EVENT ISOLATION ★
 *
 * Two claims, and every test here defends one of them:
 *
 *  1. ATTRIBUTION IS DERIVED FROM CANONICAL RECORDS AT `occurredAt`. Who a meter
 *     reading belongs to is what the truck or trailer registry says was
 *     operating the equipment when the meter was READ — not what the caller
 *     passed in, not who typed it, and not what is true today.
 *
 *  2. A SCOPE FIELD IS NOT A GRANT. Being named on a fact as the carrier or the
 *     dispatch workspace is not permission to read it, and publishing one does
 *     not make anybody the operating carrier of anything.
 *
 * The fixtures do the arguing. NL-107 has a live lease; NL-118 is owned by a
 * person and run by a carrier with no lease at all; NL-104 has a second
 * approved carrier that does not own it; NL-121 was only ever asked for.
 */

const NORTHLINE = "org_northline";
const BAXTER = "org_baxter";
const MERIDIAN = "org_meridian";

const HOUR = 3_600_000;
const hoursAgo = (h: number) => new Date(Date.now() - h * HOUR).toISOString();

const ACTOR: ActorRef = {
  userId: "usr_test", membershipId: "mem_test",
  displayNameSnapshot: "Test Caller", source: "web",
};

let n = 0;

/**
 * One contribution through the door every publisher uses.
 *
 * `scope.organizationId` is the RECORDING workspace, which is all a contributor
 * is ever trusted for. Everything else about the scope is derived.
 */
function contribution(
  over: Partial<ContributeMeterReadingInput> & { scope: FactScope },
): ContributeMeterReadingInput & { actor: ActorRef } {
  n += 1;
  return {
    equipmentKind: "truck",
    equipmentId: TRUCK_IDS.nl107,
    odometerMiles: 500_000 + n,
    readAt: hoursAgo(1),
    source: "manual_entry",
    contributor: "fleet",
    verification: "confirmed",
    idempotencyKey: `a6:${n}`,
    actor: ACTOR,
    provenance: {
      module: "telematics", adapter: "mock:test", mock: true,
      observedAt: hoursAgo(1), receivedAt: hoursAgo(1),
    },
    ...over,
  };
}

async function refusal(fn: () => Promise<unknown>): Promise<EventScopeRefusedError> {
  try {
    await fn();
  } catch (error) {
    assert.ok(
      error instanceof EventScopeRefusedError,
      `expected a scope refusal, got ${(error as Error).name}: ${(error as Error).message}`,
    );
    return error as EventScopeRefusedError;
  }
  throw new Error("Expected the publication to be refused, but it succeeded.");
}

test.beforeEach(() => {
  resetTruckRegistry();
  resetTrailerRegistry();
  resetMaintenanceRegistry();
  resetFleetTelemetry();
  resetMeterLedger();
  resetFuelStore();
  resetPropagationBus();
  n = 0;
});

/* -------------------------------------------------------------------------- */
/* 1. The three ways a carrier is proven                                       */
/* -------------------------------------------------------------------------- */

test("NL-107: a truck under a live operating lease pins that exact lease id", async () => {
  const { event } = await contributeAndPublish(contribution({
    equipmentId: TRUCK_IDS.nl107,
    scope: { organizationId: NORTHLINE },
  }));

  assert.equal(event.scope.organizationId, NORTHLINE);
  assert.equal(event.scope.carrierOrganizationId, NORTHLINE);
  assert.equal(event.scope.truckOperatingLeaseId, "lease_nl107");
  assert.equal(event.scope.trailerOperatingLeaseId, undefined,
    "a truck event never carries a trailer lease id");

  const context = operatingContextAt(TRUCK_IDS.nl107, event.occurredAt);
  assert.ok(context.resolved);
  assert.equal(context.basis, "operating_lease");
  assert.equal(context.lease?.id, "lease_nl107");
});

test("NL-118: a person-owned truck with one approved carrier and no lease", async () => {
  // Marcus Hale owns unit 118; Northline runs it under a leased_owner_operator
  // relationship and has never taken an operating lease on it. The carrier-owned
  // rule cannot prove this one, and inventing a lease to fill the field would be
  // a fabrication — so the field stays empty and the relationship proves it.
  const { event } = await contributeAndPublish(contribution({
    equipmentId: TRUCK_IDS.nl118,
    scope: { organizationId: NORTHLINE },
  }));

  assert.equal(event.scope.organizationId, NORTHLINE);
  assert.equal(event.scope.carrierOrganizationId, NORTHLINE);
  assert.equal(event.scope.truckOperatingLeaseId, undefined);

  const context = operatingContextAt(TRUCK_IDS.nl118, event.occurredAt);
  assert.ok(context.resolved);
  assert.equal(context.basis, "sole_approved_relationship");
  assert.equal(context.relationship.relationshipType, "leased_owner_operator");
});

test("NL-104: the owner's relationship wins over a second approved carrier", async () => {
  // Both Northline (carrier_owned, the legal owner) and Baxter
  // (leased_owner_operator) are approved on unit 104 right now, and neither
  // holds a lease. The derivation is decidable because one of them owns it.
  const context = operatingContextAt(TRUCK_IDS.nl104, hoursAgo(1));
  assert.ok(context.resolved);
  assert.equal(context.basis, "carrier_owned");
  assert.equal(context.operatingCarrierOrganizationId, NORTHLINE);

  const { event } = await contributeAndPublish(contribution({
    equipmentId: TRUCK_IDS.nl104,
    scope: { organizationId: NORTHLINE },
  }));
  assert.equal(event.scope.organizationId, NORTHLINE);
  assert.equal(event.scope.truckOperatingLeaseId, undefined);

  // And Baxter, which is genuinely approved on the same truck, cannot publish
  // against it: approved is eligibility, not operation.
  const refused = await refusal(() => contributeAndPublish(contribution({
    equipmentId: TRUCK_IDS.nl104,
    scope: { organizationId: BAXTER },
  })));
  assert.equal(refused.code, "not_the_operating_carrier");
});

test("ownership decides the carrier-owned case, never relationship age", () => {
  // The fixture's owner also happens to hold the OLDEST relationship, so the
  // rule is proved here on records where it holds the newest one. If the rule
  // were "the earliest relationship wins", this would answer org_other.
  const owned = resolveOperatingContextAt({
    equipmentNoun: "truck",
    instant: hoursAgo(1),
    leases: [],
    relationships: [
      {
        id: "rel_other", organizationId: "org_other", relationshipType: "leased_owner_operator",
        status: "approved", approvedAt: hoursAgo(900), startedAt: hoursAgo(900),
      },
      {
        id: "rel_owner", organizationId: "org_owner", relationshipType: "carrier_owned",
        status: "approved", approvedAt: hoursAgo(100), startedAt: hoursAgo(100),
      },
    ],
    ownership: [
      { id: "own_1", ownerType: "organization", ownerRef: "org_owner", status: "active", startedAt: hoursAgo(1000) },
    ],
  });
  assert.ok(owned.resolved);
  assert.equal(owned.basis, "carrier_owned");
  assert.equal(owned.operatingCarrierOrganizationId, "org_owner");

  // And with nobody owning it, two approved carriers is a refusal rather than
  // the older of the two.
  const ambiguous = resolveOperatingContextAt({
    equipmentNoun: "truck",
    instant: hoursAgo(1),
    leases: [],
    relationships: [
      {
        id: "rel_a", organizationId: "org_a", relationshipType: "leased_owner_operator",
        status: "approved", approvedAt: hoursAgo(900), startedAt: hoursAgo(900),
      },
      {
        id: "rel_b", organizationId: "org_b", relationshipType: "leased_owner_operator",
        status: "approved", approvedAt: hoursAgo(100), startedAt: hoursAgo(100),
      },
    ],
    ownership: [
      { id: "own_person", ownerType: "person", ownerRef: "dp_someone", status: "active", startedAt: hoursAgo(1000) },
    ],
  });
  assert.equal(ambiguous.resolved, false);
  assert.ok(!ambiguous.resolved && ambiguous.code === "conflicting_relationships");
  assert.ok(!ambiguous.resolved && ambiguous.records.includes("rel_a") && ambiguous.records.includes("rel_b"));
});

/* -------------------------------------------------------------------------- */
/* 2. Trailers are the other half of the fleet                                 */
/* -------------------------------------------------------------------------- */

test("RF-114: a reefer's hour meter publishes under its own operating context", async () => {
  const before = propagationBus.events(NORTHLINE).length;
  await recordMeterReading(
    { kind: "trailer", equipmentId: TRAILER_IDS.rf114 },
    { engineHours: 9_400 },
    ctxFor("mem_northline_owner"),
  );

  const published = propagationBus.events(NORTHLINE)
    .filter((e) => e.kind === "equipment_meter.reading_recorded" && e.subjectId === TRAILER_IDS.rf114);
  assert.equal(published.length, before + 1, "the reefer's hours reached the bus");
  const [event] = published;
  assert.equal(event.subjectKind, "trailer");
  assert.equal(event.scope.organizationId, NORTHLINE);
  assert.equal(event.scope.carrierOrganizationId, NORTHLINE);
  // Northline owns R-114 and runs it under its own carrier_owned relationship.
  // No lease was ever taken on it, so no lease id is invented for it.
  assert.equal(event.scope.trailerOperatingLeaseId, undefined);
  assert.equal(event.scope.truckOperatingLeaseId, undefined);
});

test("LK-702: a trailer under a live lease pins the TRAILER lease id", async () => {
  const { event } = await contributeAndPublish(contribution({
    equipmentKind: "trailer",
    equipmentId: TRAILER_IDS.lk702,
    odometerMiles: undefined,
    engineHours: 4_100,
    scope: { organizationId: NORTHLINE },
  }));

  assert.equal(event.scope.trailerOperatingLeaseId, "tlease_lk702");
  assert.equal(event.scope.truckOperatingLeaseId, undefined,
    "a trailer lease id never lands in the truck field");

  const context = trailerOperatingContextAt(TRAILER_IDS.lk702, event.occurredAt);
  assert.ok(context.resolved);
  assert.equal(context.basis, "operating_lease");
  assert.equal(context.lease?.id, "tlease_lk702");
});

test("a truck reading carrying a trailer lease id is refused outright", async () => {
  const before = meterReadings(TRUCK_IDS.nl107).length;
  const refused = await refusal(() => contributeAndPublish(contribution({
    equipmentId: TRUCK_IDS.nl107,
    scope: { organizationId: NORTHLINE, trailerOperatingLeaseId: "tlease_lk702" },
  })));
  assert.equal(refused.code, "lease_wrong_equipment_kind");
  assert.equal(meterReadings(TRUCK_IDS.nl107).length, before, "and nothing was appended");
});

/* -------------------------------------------------------------------------- */
/* 3. Recording is not operating                                               */
/* -------------------------------------------------------------------------- */

test("a dispatcher recording telemetry is refused BEFORE anything is written", async () => {
  // Meridian dispatches Baxter's A-12 and sees it in its own fleet, and the
  // seeded Dispatcher template carries `fleet:telemetry:record`. Neither is
  // Baxter's consent to write Baxter's meter history, and no record in
  // Antcolos grants that — so the command refuses.
  //
  // Given EVERY permission on purpose: the point is that no permission a
  // dispatch workspace holds, and no amount of equipment visibility, adds up
  // to the operating carrier's consent.
  const meridian = serviceContext("mem_meridian_dispatcher", { permissions: ALL_PERMISSIONS });
  const seeded = meterReadings(TRUCK_IDS.mdA12).length;

  const error = await refusal(() => mockFleetService.recordTelemetry(meridian, {
    assetKind: "truck",
    assetId: TRUCK_IDS.mdA12,
    odometerMiles: 390_000,
  }));
  assert.equal(error.code, "not_the_operating_carrier");

  // Nothing partially succeeded: no telemetry row, no ledger row, no event,
  // for either organization.
  const detail = await mockFleetService.asset(meridian, "truck", TRUCK_IDS.mdA12);
  assert.equal(
    detail.telemetryHistory.filter((r) => r.odometerMiles === 390_000).length, 0,
    "the telemetry row was not written either",
  );
  assert.equal(meterReadings(TRUCK_IDS.mdA12).length, seeded);
  assert.equal(propagationBus.events(BAXTER).length, 0);
  assert.equal(propagationBus.events(MERIDIAN).length, 0);
  assert.equal(propagationBus.projections(MERIDIAN).length, 0);
});

test("the dispatcher keeps everything that is not writing somebody's meters", async () => {
  // The refusal is narrow on purpose. A dispatch workspace still sees the
  // equipment it dispatches and still records where a truck is — what it
  // cannot do is write the carrier's odometer.
  const meridian = serviceContext("mem_meridian_dispatcher", { permissions: ALL_PERMISSIONS });

  const rows = await mockFleetService.equipment(meridian);
  assert.ok(
    rows.some((r) => r.assetId === TRUCK_IDS.mdA12),
    "Baxter's A-12 is still in Meridian's fleet",
  );

  const reading = await mockFleetService.recordTelemetry(meridian, {
    assetKind: "truck",
    assetId: TRUCK_IDS.mdA12,
    location: { city: "Allentown", state: "PA" },
  });
  assert.ok(reading.id, "a location-only submission still lands");
});

test("the operating carrier's own telemetry still writes both rows", async () => {
  // The same command, from the carrier that actually runs the truck. This is
  // what must not have been broken by closing the door on everybody else.
  const northline = serviceContext("mem_northline_owner");
  const before = meterReadings(TRUCK_IDS.nl104).length;

  const reading = await mockFleetService.recordTelemetry(northline, {
    assetKind: "truck",
    assetId: TRUCK_IDS.nl104,
    odometerMiles: 900_000,
  });

  assert.equal(reading.odometerMiles, 900_000);
  assert.equal(meterReadings(TRUCK_IDS.nl104).length, before + 1);
  const published = propagationBus.events(NORTHLINE)
    .filter((e) => e.subjectId === TRUCK_IDS.nl104);
  assert.equal(published.length, 1);
  assert.equal(published[0].scope.organizationId, NORTHLINE);
  assert.equal(published[0].scope.dispatchOrganizationId, undefined,
    "and no dispatch workspace is named on it");
});

test("a fuel purchase by a dispatch workspace refuses the odometer, not the receipt", async () => {
  const meridian = serviceContext("mem_meridian_dispatcher", { permissions: ALL_PERMISSIONS });
  const purchase = {
    truckId: TRUCK_IDS.mdA12,
    purchasedAt: hoursAgo(3),
    location: { jurisdiction: "PA", merchantName: "Pilot Allentown" },
    fuelType: "diesel" as const,
    gallonsThousandths: 100_000,
    pricePerGallonMills: 4_100,
    totalCostCents: 41_000,
  };

  const error = await refusal(() => mockFuelService.recordTransaction(meridian, {
    ...purchase, odometerMiles: 391_000,
  }));
  assert.equal(error.code, "not_the_operating_carrier");

  // And the receipt itself was not written. A refusal that left a purchase on
  // file with no odometer would be a worse outcome than either answer.
  const after = await mockFuelService.listTransactions(meridian);
  assert.equal(
    after.filter((t) => t.odometerMiles === 391_000).length, 0,
    "no transaction was stored",
  );

  // The same purchase with no odometer on it writes nothing to anybody's meter
  // history, so it is not this rule's business and still lands.
  const ok = await mockFuelService.recordTransaction(meridian, purchase);
  assert.equal(ok.organizationId, MERIDIAN);
});

test("no dispatch grant authorizes a meter write, from any carrier", async () => {
  // Baxter handed Summit dispatch access to unit 107 — a truck Northline runs
  // under its own operating lease. Both records are genuine and they disagree.
  // Under A6 the disagreement does not need resolving to answer this: neither
  // grant would have authorized the write.
  const refused = await refusal(() => contributeAndPublish(contribution({
    equipmentId: TRUCK_IDS.nl107,
    scope: { organizationId: "org_summit" },
  })));
  assert.equal(refused.code, "not_the_operating_carrier");

  // And Summit's grant on unit 111 is from Northline, the carrier that really
  // does operate it — still no.
  const alsoRefused = await refusal(() => contributeAndPublish(contribution({
    equipmentId: TRUCK_IDS.nl111,
    scope: { organizationId: "org_summit" },
  })));
  assert.equal(alsoRefused.code, "not_the_operating_carrier");

  assert.equal(propagationBus.events("org_summit").length, 0);
  assert.equal(propagationBus.events(NORTHLINE).length, 0);
});

test("naming a dispatch workspace on a reading is refused outright", async () => {
  const refused = await refusal(() => contributeAndPublish(contribution({
    equipmentId: TRUCK_IDS.mdA12,
    scope: { organizationId: BAXTER, dispatchOrganizationId: MERIDIAN },
  })));
  assert.equal(refused.code, "dispatch_write_not_authorized");
});

test("a caller cannot name a carrier the canonical records disagree with", async () => {
  const before = meterReadings(TRUCK_IDS.nl107).length;
  const refused = await refusal(() => contributeAndPublish(contribution({
    equipmentId: TRUCK_IDS.nl107,
    scope: { organizationId: NORTHLINE, carrierOrganizationId: BAXTER },
  })));
  assert.equal(refused.code, "carrier_mismatch");
  assert.equal(meterReadings(TRUCK_IDS.nl107).length, before, "nothing was appended");
  assert.equal(propagationBus.events(NORTHLINE).length, 0);
  assert.equal(propagationBus.events(BAXTER).length, 0);
});

test("operatingAuthorityId is reserved and refused rather than ignored", async () => {
  const refused = await refusal(() => contributeAndPublish(contribution({
    equipmentId: TRUCK_IDS.nl107,
    scope: { organizationId: NORTHLINE, operatingAuthorityId: "oa_northline" },
  })));
  assert.equal(refused.code, "operating_authority_reserved");
});

/* -------------------------------------------------------------------------- */
/* 4. Nothing about a refusal is half-done                                     */
/* -------------------------------------------------------------------------- */

test("NL-121: a relationship that was only ever asked for proves nothing", async () => {
  const refused = await refusal(() => contributeAndPublish(contribution({
    equipmentId: TRUCK_IDS.nl121,
    scope: { organizationId: NORTHLINE },
  })));
  assert.equal(refused.code, "no_relationship");
  assert.equal(meterReadings(TRUCK_IDS.nl121).length, 0, "no reading was appended");
  assert.equal(propagationBus.events(NORTHLINE).length, 0, "no event was published");
  assert.equal(propagationBus.projections(NORTHLINE).length, 0, "no projection ran");
});

test("a moment before any carrier was onboarded is refused", async () => {
  // Northline began operating unit 118 two hundred days ago. A reading dated
  // before that has no carrier it can honestly belong to, and today's carrier
  // must not inherit it.
  const before = meterReadings(TRUCK_IDS.nl118).length;
  const refused = await refusal(() => contributeAndPublish(contribution({
    equipmentId: TRUCK_IDS.nl118,
    readAt: hoursAgo(24 * 300),
    scope: { organizationId: NORTHLINE },
  })));
  assert.equal(refused.code, "no_relationship");
  assert.equal(meterReadings(TRUCK_IDS.nl118).length, before, "nothing was appended");
  assert.equal(propagationBus.events(NORTHLINE).length, 0);
});

test("two carriers and nobody owning it refuses, through the real registry", async () => {
  // Baxter connects to Marcus Hale's truck through the ordinary onboarding
  // path. Northline is already approved on it and nobody who holds a
  // relationship owns it, so from that moment the records genuinely do not say
  // which carrier a reading belongs to.
  const seeded = meterReadings(TRUCK_IDS.nl118).length;
  const baxter = truckContextFrom(serviceContext("mem_baxter_owner"));
  const outcome = await registerOrConnectTruck(baxter, {
    vin: FIXTURE_VINS.nl118,
    equipmentType: "tractor",
    unitNumber: "BX-118",
    year: 2021,
    make: "Ram",
    model: "5500",
    registration: {
      plateNumber: "PA-0001", plateState: "PA",
      expiresAt: new Date(Date.now() + 90 * 24 * HOUR).toISOString(),
      registeredOwnerName: "Marcus Hale",
    },
    specs: {},
    status: "available",
    availability: {},
    relationshipType: "leased_owner_operator",
    ownerType: "person",
    ownerName: "Marcus Hale",
    evidence: [],
  });
  assert.equal(outcome.status, "relationship_pending");
  assert.ok(outcome.status === "relationship_pending");
  await approveCarrierRelationship(outcome.relationship.id, baxter);

  const refused = await refusal(() => contributeAndPublish(contribution({
    equipmentId: TRUCK_IDS.nl118,
    readAt: new Date().toISOString(),
    scope: { organizationId: NORTHLINE },
  })));
  assert.equal(refused.code, "conflicting_relationships");
  assert.equal(refused.records.length, 2, "and the refusal names both relationships");
  assert.equal(meterReadings(TRUCK_IDS.nl118).length, seeded, "nothing was appended");
  assert.equal(propagationBus.events(NORTHLINE).length, 0);
});

/* -------------------------------------------------------------------------- */
/* 5. History does not move                                                    */
/* -------------------------------------------------------------------------- */

test("a backdated reading keeps the context that covered the moment it was read", async () => {
  // Unit 107's lease was activated two days ago. A reading from three days ago
  // happened before it, under the carrier-owned relationship.
  const before = await contributeAndPublish(contribution({
    equipmentId: TRUCK_IDS.nl107,
    readAt: hoursAgo(72),
    scope: { organizationId: NORTHLINE },
  }));
  assert.equal(before.event.scope.truckOperatingLeaseId, undefined);
  assert.equal(before.event.scope.organizationId, NORTHLINE);

  const during = await contributeAndPublish(contribution({
    equipmentId: TRUCK_IDS.nl107,
    readAt: hoursAgo(1),
    scope: { organizationId: NORTHLINE },
  }));
  assert.equal(during.event.scope.truckOperatingLeaseId, "lease_nl107");

  // Now end the lease through the canonical path: four termination steps, then
  // the release. The truck goes back to being merely approved for everybody.
  const northline = truckContextFrom(serviceContext("mem_northline_owner"));
  for (const step of ["unloaded", "trip_requirements", "delivery_confirmation", "exclusive_control"] as const) {
    await recordTerminationStep("lease_nl107", step, northline);
  }
  const released = await releaseOperatingLease("lease_nl107", northline);
  assert.equal(released.status, "released");

  // What was published does not move. The event still carries the lease it was
  // published under, and the derivation still answers for that moment.
  assert.equal(during.event.scope.truckOperatingLeaseId, "lease_nl107");
  const thenContext = operatingContextAt(TRUCK_IDS.nl107, during.event.occurredAt);
  assert.ok(thenContext.resolved);
  assert.equal(thenContext.lease?.id, "lease_nl107");

  // And a reading taken now, after the release, is attributed without it.
  const after = await contributeAndPublish(contribution({
    equipmentId: TRUCK_IDS.nl107,
    readAt: new Date().toISOString(),
    scope: { organizationId: NORTHLINE },
  }));
  assert.equal(after.event.scope.truckOperatingLeaseId, undefined);
  assert.equal(after.event.scope.organizationId, NORTHLINE,
    "Northline still owns and runs it; only the exclusive lease ended");
});

test("an ended relationship stops attributing, and does not un-attribute the past", async () => {
  // Unit 118 is run by Northline under the one relationship that proves it.
  const during = await contributeAndPublish(contribution({
    equipmentId: TRUCK_IDS.nl118,
    readAt: hoursAgo(2),
    scope: { organizationId: NORTHLINE },
  }));
  assert.equal(during.event.scope.organizationId, NORTHLINE);

  const northline = truckContextFrom(serviceContext("mem_northline_owner"));
  const relationship = operatingContextAt(TRUCK_IDS.nl118, hoursAgo(2));
  assert.ok(relationship.resolved);
  await endCarrierRelationship(relationship.relationship.id, "Owner took the truck back.", northline);

  // From now on there is no carrier to attribute a reading to, and Northline
  // does not keep the truck by having been on it yesterday.
  const seeded = meterReadings(TRUCK_IDS.nl118).length;
  const refused = await refusal(() => contributeAndPublish(contribution({
    equipmentId: TRUCK_IDS.nl118,
    readAt: new Date().toISOString(),
    scope: { organizationId: NORTHLINE },
  })));
  assert.equal(refused.code, "no_relationship");
  assert.equal(meterReadings(TRUCK_IDS.nl118).length, seeded);

  // What happened while the relationship was live still belongs to Northline,
  // both on the event that was published and on the derivation itself.
  assert.equal(during.event.scope.organizationId, NORTHLINE);
  const past = operatingContextAt(TRUCK_IDS.nl118, during.event.occurredAt);
  assert.ok(past.resolved);
  assert.equal(past.operatingCarrierOrganizationId, NORTHLINE);
});

/* -------------------------------------------------------------------------- */
/* 6. The boundary itself                                                      */
/* -------------------------------------------------------------------------- */

test("the bus refuses a hand-built event before storing it or running anything", async () => {
  // Nothing downstream is reachable by going around the meter ledger's door.
  const event = buildDomainEvent({
    kind: "equipment_meter.reading_recorded",
    version: METER_READING_RECORDED_VERSION,
    scope: { organizationId: MERIDIAN, carrierOrganizationId: MERIDIAN },
    subjectId: TRUCK_IDS.mdA12,
    subjectKind: "truck",
    occurredAt: hoursAgo(1),
    actor: ACTOR,
    idempotencyKey: "a6:hand-built",
    provenance: {
      module: "telematics", adapter: "mock:test", mock: true,
      observedAt: hoursAgo(1), receivedAt: hoursAgo(1),
    },
    payload: {
      readingId: "emr_fake", equipmentKind: "truck" as const, equipmentId: TRUCK_IDS.mdA12,
      odometerMiles: 390_000, readAt: hoursAgo(1), verification: "confirmed" as const,
      accepted: {},
    },
  });

  await assert.rejects(
    () => propagationBus.publish(event),
    (error: Error) => error instanceof EventScopeRefusedError && error.code === "carrier_mismatch",
  );
  assert.equal(propagationBus.events(MERIDIAN).length, 0);
  assert.equal(propagationBus.event(BAXTER, event.eventId), undefined,
    "the refused event was never stored under anybody",
  );
});

test("an event whose subject and payload disagree about the equipment is refused", async () => {
  const event = buildDomainEvent({
    kind: "equipment_meter.reading_recorded",
    version: METER_READING_RECORDED_VERSION,
    scope: { organizationId: NORTHLINE, carrierOrganizationId: NORTHLINE },
    subjectId: TRUCK_IDS.nl104,
    subjectKind: "truck",
    occurredAt: hoursAgo(1),
    actor: ACTOR,
    idempotencyKey: "a6:mismatched-subject",
    provenance: {
      module: "telematics", adapter: "mock:test", mock: true,
      observedAt: hoursAgo(1), receivedAt: hoursAgo(1),
    },
    payload: {
      readingId: "emr_fake", equipmentKind: "truck" as const, equipmentId: TRUCK_IDS.nl111,
      odometerMiles: 1, readAt: hoursAgo(1), verification: "confirmed" as const, accepted: {},
    },
  });

  await assert.rejects(
    () => propagationBus.publish(event),
    (error: Error) => error instanceof EventScopeRefusedError
      && error.code === "subject_payload_mismatch",
  );
});

test("a load event cannot carry an equipment operating lease id", async () => {
  const event = buildDomainEvent({
    kind: "load.finalized",
    version: LOAD_FINALIZED_VERSION,
    scope: { organizationId: NORTHLINE, truckOperatingLeaseId: "lease_nl107" },
    subjectId: "load_test",
    subjectKind: "load",
    occurredAt: hoursAgo(1),
    actor: ACTOR,
    idempotencyKey: "a6:load-with-lease",
    provenance: {
      module: "loads", adapter: "mock:test", mock: true,
      observedAt: hoursAgo(1), receivedAt: hoursAgo(1),
    },
    payload: {},
  });

  await assert.rejects(
    () => propagationBus.publish(event),
    (error: Error) => error instanceof EventScopeRefusedError
      && error.code === "lease_wrong_equipment_kind",
  );
});

test("the matrix describes the rules that are actually enforced", () => {
  const kinds: DomainEventKind[] = [
    "load.finalized", "fuel_transaction.confirmed", "equipment_meter.reading_recorded",
  ];
  for (const kind of kinds) {
    const rule = EVENT_SCOPE_MATRIX[kind];
    assert.ok(rule, `${kind} has a rule`);
    assert.ok(rule.writeRule.length > 40, `${kind} says what is enforced on the way in`);
    assert.ok(rule.readRule.length > 20, `${kind} says what is enforced on the way out`);
    // No canonical grant delegates a cross-organization write on ANY kind
    // today. Naming one here would be a claim the records do not support.
    assert.equal(
      rule.crossOrganizationWrite, null,
      `${kind} names no cross-organization write grant`,
    );
  }

  assert.equal(EVENT_SCOPE_MATRIX["load.finalized"].leaseReference, "none");
  assert.equal(EVENT_SCOPE_MATRIX["fuel_transaction.confirmed"].leaseReference, "none");
  assert.equal(
    EVENT_SCOPE_MATRIX["equipment_meter.reading_recorded"].leaseReference, "by_equipment_kind",
  );

  // Exhaustive: a fourth kind cannot be published until somebody decides its
  // rule.
  assert.deepEqual(Object.keys(EVENT_SCOPE_MATRIX).sort(), [...kinds].sort());
});

/* -------------------------------------------------------------------------- */
/* 7. Authority is checked when the write happens                              */
/* -------------------------------------------------------------------------- */

test("a carrier that has stopped operating cannot backdate into the history", async () => {
  // Northline runs unit 118 today and records a reading two hours ago.
  const during = await contributeAndPublish(contribution({
    equipmentId: TRUCK_IDS.nl118,
    readAt: hoursAgo(2),
    scope: { organizationId: NORTHLINE },
  }));
  assert.equal(during.event.scope.organizationId, NORTHLINE);

  const northline = truckContextFrom(serviceContext("mem_northline_owner"));
  const context = operatingContextAt(TRUCK_IDS.nl118, hoursAgo(2));
  assert.ok(context.resolved);
  await endCarrierRelationship(context.relationship.id, "Owner took the truck back.", northline);

  // A reading dated INSIDE the window Northline really did operate it is still
  // refused, because the authority to write is a question about now. Attribution
  // looks at `occurredAt`; permission does not.
  const seeded = meterReadings(TRUCK_IDS.nl118).length;
  const refused = await refusal(() => contributeAndPublish(contribution({
    equipmentId: TRUCK_IDS.nl118,
    readAt: hoursAgo(3),
    scope: { organizationId: NORTHLINE },
  })));
  assert.equal(refused.code, "write_authority_ended");
  assert.equal(meterReadings(TRUCK_IDS.nl118).length, seeded, "nothing was appended");

  // And what was published while it did operate is untouched.
  assert.equal(during.event.scope.organizationId, NORTHLINE);
  assert.equal(propagationBus.events(NORTHLINE).length, 1);
});

/* -------------------------------------------------------------------------- */
/* 8. An event id is not a capability                                          */
/* -------------------------------------------------------------------------- */

test("another organization's event id reads back nothing", async () => {
  const { event } = await contributeAndPublish(contribution({
    equipmentId: TRUCK_IDS.nl107,
    scope: { organizationId: NORTHLINE },
  }));

  // The owner sees its own distribution.
  assert.ok(propagationBus.projectionsFor(NORTHLINE, event.eventId).length > 0);

  // Holding the id is not holding the right. An id from another organization
  // answers exactly as an id that was never published.
  assert.deepEqual(propagationBus.projectionsFor(BAXTER, event.eventId), []);
  assert.deepEqual(propagationBus.projectionsFor(MERIDIAN, event.eventId), []);
  assert.equal(propagationBus.event(BAXTER, event.eventId), undefined);
  assert.deepEqual(propagationBus.projectionsFor(NORTHLINE, "dev_made.up:v1:nothing"), []);
});

test("another organization cannot re-run a projection by knowing its event id", async () => {
  const { event } = await contributeAndPublish(contribution({
    equipmentId: TRUCK_IDS.nl107,
    scope: { organizationId: NORTHLINE },
  }));
  const [record] = propagationBus.projectionsFor(NORTHLINE, event.eventId);
  assert.ok(record, "there is a projection to try to re-run");
  const attemptsBefore = record.attempts;

  const stolen = await propagationBus.retry(BAXTER, event.eventId, record.subscriberId);
  assert.equal(stolen, undefined, "the retry did not happen");
  assert.equal(
    propagationBus.projectionsFor(NORTHLINE, event.eventId)[0].attempts, attemptsBefore,
    "and the projection did not run again",
  );
});

test("a rate confirmation's distribution cannot be re-run after permission loss", async () => {
  // `retryDistribution` re-runs a projection, which WRITES into whatever module
  // it targets. It needs the same authority that distributing the rate
  // confirmation needed in the first place.
  const workflow = { distribution: [{ key: "driver_workflow" }] } as never;
  const withoutSigning = {
    ...serviceContext("mem_northline_owner", {
      permissions: new Set([...ALL_PERMISSIONS].filter((k) => k !== "loads:create")),
    }),
    organization: MOCK_ORGANIZATIONS.find((o) => o.id === NORTHLINE)!,
    membership: MOCK_MEMBERSHIPS.find((m) => m.id === "mem_northline_owner")!,
  };

  const out = await retryDistribution(withoutSigning, workflow, "dev_anything", "driver_workflow");
  assert.deepEqual(out, [{ key: "driver_workflow" }], "the stored distribution came back untouched");
});

/* -------------------------------------------------------------------------- */
/* 9. An empty carrier is not a carrier                                        */
/* -------------------------------------------------------------------------- */

test("an event carrying an empty carrier organization is refused", async () => {
  // `resolveAttribution` answers `basis: "unresolved"` with an empty carrier id
  // when nothing covers a purchase. That is an honest state for the fuel record
  // and a lie on an event, where every reader compares the field.
  const event = buildDomainEvent({
    kind: "fuel_transaction.confirmed",
    version: FUEL_TRANSACTION_CONFIRMED_VERSION,
    scope: { organizationId: NORTHLINE, carrierOrganizationId: "" },
    subjectId: "fuel_test",
    subjectKind: "fuel_transaction",
    occurredAt: hoursAgo(1),
    actor: ACTOR,
    idempotencyKey: "a6:empty-carrier",
    provenance: {
      module: "fuel", adapter: "mock:test", mock: true,
      observedAt: hoursAgo(1), receivedAt: hoursAgo(1),
    },
    payload: {},
  });

  await assert.rejects(
    () => propagationBus.publish(event),
    (error: Error) => error instanceof EventScopeRefusedError
      && error.code === "empty_carrier_organization",
  );

  // Absent is fine: it says "nobody established this", which is true.
  const honest = buildDomainEvent({
    ...({
      kind: "fuel_transaction.confirmed" as const,
      version: FUEL_TRANSACTION_CONFIRMED_VERSION,
      scope: { organizationId: NORTHLINE },
      subjectId: "fuel_test_2",
      subjectKind: "fuel_transaction",
      occurredAt: hoursAgo(1),
      actor: ACTOR,
      idempotencyKey: "a6:absent-carrier",
      provenance: {
        module: "fuel" as const, adapter: "mock:test", mock: true,
        observedAt: hoursAgo(1), receivedAt: hoursAgo(1),
      },
      payload: {},
    }),
  });
  const published = await propagationBus.publish(honest);
  assert.equal(published.duplicate, false);
});

test("the derivation is a pure read: asking twice changes nothing", () => {
  const seededRows = meterReadings(TRUCK_IDS.nl107).length;
  const first = meterFactScopeAt({
    equipmentKind: "truck",
    equipmentId: TRUCK_IDS.nl107,
    occurredAt: hoursAgo(1),
    asserted: { organizationId: NORTHLINE },
  });
  const second = meterFactScopeAt({
    equipmentKind: "truck",
    equipmentId: TRUCK_IDS.nl107,
    occurredAt: hoursAgo(1),
    asserted: { organizationId: NORTHLINE },
  });
  assert.deepEqual(first, second);
  assert.equal(
    meterReadings(TRUCK_IDS.nl107).length, seededRows,
    "and deriving wrote nothing to the ledger",
  );
});
