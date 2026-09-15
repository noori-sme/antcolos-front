import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { AvailabilityInput, Geofence } from "@/lib/tracking";
import {
  CONFIRMED_CONFIDENCE, MAX_INFERRED_CONFIDENCE, decideAvailability, dedupeSignals,
  evaluateGeofence, isPublishableAvailability, operationalCycleKey,
} from "@/lib/tracking";
import type { LocationSignal, Provenance } from "@/types";
import { resetWorld } from "./tracking-harness";

/**
 * The availability engine, tested directly.
 *
 * Pure input, pure output: every situation below is constructed in the test
 * rather than arranged out of fixtures, which is the point of keeping the
 * rules in a function that fetches nothing.
 */

const MOCK_PROVENANCE: Provenance = {
  module: "telematics",
  adapter: "mock:test",
  mock: true,
  observedAt: "2026-09-15T12:00:00.000Z",
  receivedAt: "2026-09-15T12:00:00.000Z",
};

const NOW = new Date("2026-09-15T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

const CHICAGO = { latitude: 41.878, longitude: -87.63 };
const COLUMBUS = { latitude: 39.961, longitude: -82.999 };

function position(overrides: Partial<LocationSignal> = {}): LocationSignal {
  return {
    id: `sig_${Math.random().toString(36).slice(2, 8)}`,
    truckId: "truck_1",
    organizationId: "org_test",
    transport: "fleet_telemetry",
    city: "Columbus",
    state: "OH",
    point: COLUMBUS,
    speedMph: 0,
    observedAt: minutesAgo(10),
    receivedAt: minutesAgo(9),
    confidence: 0.8,
    provenance: MOCK_PROVENANCE,
    ...overrides,
  };
}

function baseInput(overrides: Partial<AvailabilityInput> = {}): AvailabilityInput {
  return {
    truckId: "truck_1",
    truckUnit: "104",
    organizationId: "org_test",
    equipmentStatus: "loaded",
    load: {
      id: "load_1",
      reference: "NL-24817",
      status: "in_transit",
      deliveryCity: "Columbus",
      deliveryState: "OH",
      deliveryPoint: COLUMBUS,
      deliveryAppointmentAt: new Date(NOW.getTime() + 3 * 3_600_000).toISOString(),
    },
    signals: [position()],
    provenance: MOCK_PROVENANCE,
    now: NOW,
    ...overrides,
  };
}

describe("GPS alone never confirms an empty truck", () => {
  beforeEach(resetWorld);

  it("will not reach Empty Confirmed from a position parked at the receiver", () => {
    const decision = decideAvailability(baseInput({
      load: {
        id: "load_1",
        reference: "NL-24817",
        status: "at_delivery",
        deliveryCity: "Columbus",
        deliveryState: "OH",
        deliveryPoint: COLUMBUS,
        deliveryAppointmentAt: minutesAgo(180),
        deliveryArrivedAt: minutesAgo(150),
      },
      signals: [
        position({ observedAt: minutesAgo(150) }),
        position({ observedAt: minutesAgo(90) }),
        position({ observedAt: minutesAgo(5) }),
      ],
    }));

    assert.notEqual(decision.state, "empty_confirmed");
    assert.equal(decision.basis, "inferred");
    assert.ok(decision.confidence <= MAX_INFERRED_CONFIDENCE);
  });

  it("will not reach Empty Confirmed from a POD, a geofence exit and a delivered status together", () => {
    const decision = decideAvailability(baseInput({
      load: {
        id: "load_1",
        reference: "NL-24817",
        status: "delivered",
        deliveryCity: "Columbus",
        deliveryState: "OH",
        deliveryPoint: COLUMBUS,
        deliveryAppointmentAt: minutesAgo(300),
        deliveryArrivedAt: minutesAgo(280),
        deliveryDepartedAt: minutesAgo(30),
      },
      pod: { present: true, verified: false, at: minutesAgo(40) },
      signals: [position({ observedAt: minutesAgo(5) })],
    }));

    assert.equal(decision.state, "likely_available");
    assert.equal(decision.basis, "inferred");
    assert.ok(decision.awaiting?.toLowerCase().includes("confirm"));
  });

  it("reaches Empty Confirmed the moment a person says so", () => {
    const decision = decideAvailability(baseInput({
      confirmation: {
        by: "dispatcher",
        actorName: "Sam Murtaza",
        at: minutesAgo(2),
        empty: true,
      },
    }));

    assert.equal(decision.state, "empty_confirmed");
    assert.equal(decision.basis, "confirmed");
    assert.equal(decision.confidence, CONFIRMED_CONFIDENCE);
  });

  it("reaches Empty Confirmed from a driver's own workflow milestone", () => {
    const decision = decideAvailability(baseInput({
      workflow: {
        unloaded: { at: minutesAgo(20), basis: "confirmed", attribution: "driver" },
      },
    }));

    assert.equal(decision.state, "empty_confirmed");
    assert.equal(decision.basis, "confirmed");
  });

  it("does NOT treat an inferred workflow milestone as a driver action", () => {
    const decision = decideAvailability(baseInput({
      workflow: {
        unloaded: {
          at: minutesAgo(20),
          basis: "inferred",
          attribution: "adapter",
          rationale: "A geofence exit suggested it.",
        },
      },
    }));

    assert.notEqual(decision.state, "empty_confirmed");
    assert.equal(decision.basis, "inferred");
  });
});

describe("before delivery, ETA and proximity produce Expected Available", () => {
  beforeEach(resetWorld);

  it("derives an expected empty time from the ETA plus unloading", () => {
    const eta = new Date(NOW.getTime() + 2 * 3_600_000).toISOString();
    const decision = decideAvailability(baseInput({
      etaAt: eta,
      signals: [position({ point: CHICAGO, city: "Chicago", state: "IL", speedMph: 60 })],
    }));

    assert.equal(decision.state, "expected_available");
    assert.equal(decision.basis, "inferred");
    assert.ok(decision.expectedEmptyAt);
    assert.ok(Date.parse(decision.expectedEmptyAt!) > Date.parse(eta));
    assert.equal(decision.expectedEmptyCity, "Columbus");
  });

  it("says it cannot tell when there is no appointment and no ETA", () => {
    const decision = decideAvailability(baseInput({
      load: {
        id: "load_1",
        reference: "NL-24817",
        status: "in_transit",
        deliveryCity: "Columbus",
        deliveryState: "OH",
        deliveryPoint: COLUMBUS,
      },
    }));

    assert.equal(decision.state, "availability_uncertain");
    assert.match(decision.rationale, /no delivery appointment and no ETA/i);
  });
});

describe("missing, stale and contradictory signals", () => {
  beforeEach(resetWorld);

  it("is uncertain on a running load with no position at all", () => {
    const decision = decideAvailability(baseInput({ signals: [] }));
    assert.equal(decision.state, "availability_uncertain");
    assert.match(decision.rationale, /nothing has reported a position/i);
  });

  it("is uncertain when the only position is older than the trust window", () => {
    const decision = decideAvailability(baseInput({
      signals: [position({ observedAt: minutesAgo(400) })],
    }));
    assert.equal(decision.state, "availability_uncertain");
    assert.match(decision.rationale, /older than the/i);
  });

  it("refuses to agree with paperwork that contradicts the truck's position", () => {
    const decision = decideAvailability(baseInput({
      load: {
        id: "load_1",
        reference: "NL-24817",
        status: "delivered",
        deliveryCity: "Columbus",
        deliveryState: "OH",
        deliveryPoint: COLUMBUS,
        deliveryAppointmentAt: minutesAgo(200),
        deliveryDepartedAt: minutesAgo(30),
      },
      pod: { present: true, verified: false },
      // Still in Chicago — several hundred miles from the receiver.
      signals: [position({ point: CHICAGO, city: "Chicago", state: "IL", observedAt: minutesAgo(5) })],
    }));

    assert.equal(decision.state, "availability_uncertain");
    assert.match(decision.rationale, /cannot both be right/i);
  });

  it("keeps the position it disregarded, with the reason", () => {
    const decision = decideAvailability(baseInput({
      signals: [position({ observedAt: minutesAgo(400) })],
    }));
    const disregarded = decision.evidence.filter((e) => e.disregardedReason);
    assert.ok(disregarded.length > 0);
    assert.match(disregarded[0].disregardedReason!, /window/i);
  });
});

describe("the geofence pass-by guard", () => {
  const fence: Geofence = {
    subjectId: "stop_1",
    label: "Rivet DC Columbus",
    centre: COLUMBUS,
    radiusMiles: 1.5,
  };

  it("rejects a reading inside the fence at highway speed", () => {
    const verdict = evaluateGeofence(fence, [
      { point: COLUMBUS, speedMph: 62, observedAt: minutesAgo(3) },
    ], NOW);
    assert.equal(verdict.believable, false);
    assert.match("rejection" in verdict ? verdict.rejection : "", /passing, not a truck arriving/i);
  });

  it("rejects a reading inside the fence that has not dwelled long enough", () => {
    const verdict = evaluateGeofence(fence, [
      { point: COLUMBUS, speedMph: 0, observedAt: minutesAgo(4) },
    ], NOW);
    assert.equal(verdict.believable, false);
    assert.match("rejection" in verdict ? verdict.rejection : "", /dwell/i);
  });

  it("believes a stationary truck that has been inside for long enough", () => {
    const verdict = evaluateGeofence(fence, [
      { point: COLUMBUS, speedMph: 0, observedAt: minutesAgo(95) },
      { point: COLUMBUS, speedMph: 0, observedAt: minutesAgo(40) },
      { point: COLUMBUS, speedMph: 0, observedAt: minutesAgo(5) },
    ], NOW);
    assert.equal(verdict.believable, true);
    assert.ok(verdict.dwellMinutes >= 90);
  });

  it("does not let a false geofence reading move availability", () => {
    const decision = decideAvailability(baseInput({
      receiverFence: fence,
      signals: [position({ speedMph: 62, observedAt: minutesAgo(3) })],
    }));

    const entry = decision.evidence.find((e) => e.kind === "geofence_entry");
    assert.ok(entry?.disregardedReason);
    assert.notEqual(decision.state, "likely_available");
    assert.notEqual(decision.state, "empty_confirmed");
  });
});

describe("duplicate signals", () => {
  it("collapses repeats that share a source record id", () => {
    const shared: Provenance = { ...MOCK_PROVENANCE, externalId: "eld-77120" };
    const rows = [
      position({ id: "a", provenance: shared }),
      position({ id: "b", provenance: shared, receivedAt: minutesAgo(1) }),
    ];
    assert.equal(dedupeSignals(rows).length, 1);
    // The first copy survives, so `receivedAt` stays honest about when we heard.
    assert.equal(dedupeSignals(rows)[0].id, "a");
  });

  it("collapses repeats of the same place at the same instant", () => {
    const at = minutesAgo(12);
    const rows = [position({ id: "a", observedAt: at }), position({ id: "b", observedAt: at })];
    assert.equal(dedupeSignals(rows).length, 1);
  });

  it("reports duplicates on the decision rather than hiding them", () => {
    const at = minutesAgo(12);
    const decision = decideAvailability(baseInput({
      signals: [position({ observedAt: at }), position({ observedAt: at }), position({ observedAt: at })],
    }));
    const note = decision.evidence.find((e) => e.summary.includes("duplicate"));
    assert.ok(note, "the decision should say duplicates were collapsed");
  });
});

describe("the operational cycle key", () => {
  it("is stable for one truck finishing one load", () => {
    const a = operationalCycleKey({ truckId: "t1", loadId: "l1" });
    const b = operationalCycleKey({ truckId: "t1", loadId: "l1", emptyAt: minutesAgo(5) });
    assert.equal(a, b);
  });

  it("differs for the same truck on a different load", () => {
    assert.notEqual(
      operationalCycleKey({ truckId: "t1", loadId: "l1" }),
      operationalCycleKey({ truckId: "t1", loadId: "l2" }),
    );
  });

  it("buckets an idle truck so repeated readings are one cycle", () => {
    const a = operationalCycleKey({ truckId: "t1", emptyAt: minutesAgo(5) });
    const b = operationalCycleKey({ truckId: "t1", emptyAt: minutesAgo(35) });
    assert.equal(a, b);
  });
});

describe("what may be published at all", () => {
  it("publishes the three availability states and not the other two", () => {
    assert.equal(isPublishableAvailability("expected_available"), true);
    assert.equal(isPublishableAvailability("likely_available"), true);
    assert.equal(isPublishableAvailability("empty_confirmed"), true);
    assert.equal(isPublishableAvailability("availability_uncertain"), false);
    assert.equal(isPublishableAvailability("unavailable"), false);
  });
});
