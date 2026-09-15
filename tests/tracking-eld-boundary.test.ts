import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  dispatchTrackingBoardSync, loadTrackingSync, publicTracking,
} from "@/lib/api/mock/tracking-board";
import {
  locationScopeFor, locationSignalsFor, simulatePosition,
} from "@/lib/api/mock/tracking-signals";
import { availabilityForTruck } from "@/lib/api/mock/tracking-availability";
import {
  addTrackingRecipient, openTrackingSession,
} from "@/lib/api/mock/tracking-registry";
import { eldTelemetryForTruckSync } from "@/lib/api/mock/eld";
import { services } from "@/lib/api";
import { appendReading } from "@/lib/api/mock/fleet-telemetry";
import { TRUCK_IDS } from "@/lib/api/mock/truck-registry";
import { mockStore } from "@/lib/api/mock/store";
import {
  MERIDIAN_DISPATCHER, NORTHLINE_OWNER, SOLO_DISPATCHER, SUMMIT_OWNER, resetWorld,
  rejects, trackingContextFor, without,
} from "./tracking-harness";

/**
 * The ELD boundary, as Tracking consumes it.
 *
 * Every test here is about one rule: the ELD & Telematics module decides who
 * may see a position, and Tracking has no way around it — not through a
 * check-call, not through the load timeline, not through the simulation inbox,
 * and not through a public tracking link.
 */

describe("the carrier's explicit per-truck share governs the board", () => {
  beforeEach(resetWorld);

  it("shows a position for the one truck the carrier shared", () => {
    // Baxter shares A-12 with Meridian — position and meters, nothing else.
    const board = dispatchTrackingBoardSync(trackingContextFor(MERIDIAN_DISPATCHER));
    const shared = board.rows.find((r) => r.loadReference === "MD-9042")!;
    assert.equal(shared.health, "live");
    assert.ok(shared.currentCity, "a shared truck reports a city");
    assert.equal(shared.lastSignalTransport, "eld_telemetry");
  });

  it("shows nothing for a truck the carrier did not share", () => {
    const board = dispatchTrackingBoardSync(trackingContextFor(MERIDIAN_DISPATCHER));
    for (const reference of ["MD-9038", "MD-9031"]) {
      const row = board.rows.find((r) => r.loadReference === reference)!;
      assert.equal(row.health, "unavailable");
      assert.equal(row.currentCity, undefined);
      assert.equal(row.lastUpdateAt, undefined);
      assert.match(row.healthReason, /not shared with this workspace/i);
    }
  });

  it("gives a carrier its own trucks without needing a share record", () => {
    const board = dispatchTrackingBoardSync(trackingContextFor(NORTHLINE_OWNER));
    const row = board.rows.find((r) => r.loadReference === "NL-24817")!;
    assert.equal(row.health, "live");
    assert.equal(row.lastSignalTransport, "eld_telemetry");
  });

  it("refuses every position when the membership lacks eld:view", () => {
    const ctx = without(trackingContextFor(NORTHLINE_OWNER), "eld:view");
    const scope = locationScopeFor(ctx, TRUCK_IDS.nl104);
    assert.equal(scope.scoped, false);
    assert.match(scope.refusal!, /does not hold eld:view/i);
    assert.equal(locationSignalsFor(ctx, { truckId: TRUCK_IDS.nl104 }).length, 0);
  });
});

describe("no fallback source may bypass the ELD boundary", () => {
  beforeEach(resetWorld);

  it("will not surface a dispatcher's own check-call for an unshared truck", () => {
    const ctx = trackingContextFor(MERIDIAN_DISPATCHER);
    // Meridian types in a position for a truck Crosswind never shared with it.
    appendReading(
      {
        assetKind: "truck",
        assetId: TRUCK_IDS.crosswind,
        location: { city: "Greensboro", state: "NC", description: "Called in by the driver" },
      },
      { organizationId: ctx.organizationId, membershipId: ctx.membershipId, actorName: "Sam Murtaza" },
    );

    assert.equal(locationSignalsFor(ctx, { truckId: TRUCK_IDS.crosswind }).length, 0);
    const row = dispatchTrackingBoardSync(ctx).rows.find((r) => r.loadReference === "MD-9038")!;
    assert.equal(row.currentCity, undefined);
  });

  it("will not surface a load-timeline position for an unshared truck", () => {
    const ctx = trackingContextFor(MERIDIAN_DISPATCHER);
    const load = mockStore.org("org_meridian").loads.find((l) => l.reference === "MD-9038")!;
    mockStore.org("org_meridian").events.push({
      id: "evt_probe_1",
      organizationId: "org_meridian",
      loadId: load.id,
      kind: "load.location_reported",
      occurredAt: new Date().toISOString(),
      recordedAt: new Date().toISOString(),
      actor: { userId: "usr_sam", membershipId: ctx.membershipId, displayNameSnapshot: "Sam", source: "web" },
      source: "web",
      payload: { note: "Near Greensboro, NC" },
    });

    const signals = locationSignalsFor(ctx, { truckId: TRUCK_IDS.crosswind, loadId: load.id });
    assert.equal(signals.length, 0);
  });

  it("will not surface a simulated position for an unshared truck", () => {
    const ctx = trackingContextFor(MERIDIAN_DISPATCHER);
    simulatePosition({
      organizationId: ctx.organizationId,
      truckId: TRUCK_IDS.crosswind,
      city: "Greensboro",
      state: "NC",
    });
    assert.equal(locationSignalsFor(ctx, { truckId: TRUCK_IDS.crosswind }).length, 0);
  });

  it("blocks a solo dispatcher's own check-call on a truck nobody shared with them", () => {
    // Cascade has not shared unit 47 with the solo workspace. The fixture
    // check-call in that workspace exists precisely to prove it stays blocked.
    const ctx = trackingContextFor(SOLO_DISPATCHER);
    assert.equal(locationScopeFor(ctx, TRUCK_IDS.cs47).scoped, false);
    assert.equal(locationSignalsFor(ctx, { truckId: TRUCK_IDS.cs47 }).length, 0);
  });

  it("keeps fallback sources working where the truck IS in scope", () => {
    const ctx = trackingContextFor(NORTHLINE_OWNER);
    const reading = appendReading(
      {
        assetKind: "truck",
        assetId: TRUCK_IDS.nl104,
        location: { city: "Dayton", state: "OH", description: "Driver rang in" },
      },
      { organizationId: ctx.organizationId, membershipId: ctx.membershipId, actorName: "Sam Murtaza" },
    );
    const signals = locationSignalsFor(ctx, { truckId: TRUCK_IDS.nl104 });
    assert.ok(signals.some((s) => s.provenance.externalId === reading.id));
    // And the ELD observations are there too — this is precedence, not exclusion.
    assert.ok(signals.some((s) => s.transport === "eld_telemetry"));
  });
});

describe("precise location is granted per truck, by the carrier", () => {
  beforeEach(resetWorld);

  it("gives a dispatcher coordinates for a truck whose carrier granted them", () => {
    // Baxter shares A-12 with Meridian, precision included. A dispatcher
    // covering a truck needs to know how far out it is.
    const ctx = trackingContextFor(MERIDIAN_DISPATCHER);
    assert.equal(ctx.permissions.has("eld:location:precise:view"), true,
      "the seeded Dispatcher template holds the permission");

    const scope = locationScopeFor(ctx, TRUCK_IDS.mdA12);
    assert.equal(scope.precision, "exact");
    const signals = locationSignalsFor(ctx, { truckId: TRUCK_IDS.mdA12, scope });
    assert.ok(signals.length > 0);
    assert.ok(signals.some((s) => s.point), "a granted truck yields coordinates");
  });

  it("withholds coordinates for a truck whose carrier withheld them", () => {
    // Northline shares unit 111 with Summit for planning, and withholds
    // precision on it. Summit gets a city and a state.
    const ctx = trackingContextFor(SUMMIT_OWNER);
    assert.equal(ctx.permissions.has("eld:location:precise:view"), true,
      "an owner holds every permission — the share is what withholds this");

    const scope = locationScopeFor(ctx, TRUCK_IDS.nl111);
    assert.equal(scope.scoped, true, "the truck IS shared");
    assert.equal(scope.precision, "city_only", "but not precisely");

    const signals = locationSignalsFor(ctx, { truckId: TRUCK_IDS.nl111, scope });
    assert.ok(signals.length > 0, "a city-level position is still a position");
    for (const signal of signals) {
      assert.equal(signal.precision, "city_only");
      assert.equal(signal.point, undefined, "a coordinate must never survive the reduction");
    }
  });

  it("grants precision on one truck without leaking it to another", () => {
    // The whole point of per-truck: Summit holds a city-level grant on 111 and
    // no grant at all on 131. Neither tells it anything about the other.
    const ctx = trackingContextFor(SUMMIT_OWNER);
    assert.equal(locationScopeFor(ctx, TRUCK_IDS.nl111).scoped, true);
    assert.equal(locationScopeFor(ctx, TRUCK_IDS.nl131).scoped, false);
    assert.equal(locationSignalsFor(ctx, { truckId: TRUCK_IDS.nl131 }).length, 0);
  });

  it("records the declined evaluation as evidence rather than silence", () => {
    const ctx = trackingContextFor(SUMMIT_OWNER);
    const decision = availabilityForTruck(TRUCK_IDS.nl111, ctx)!;
    const declined = decision.evidence.find(
      (e) => e.disregardedReason?.includes("eld:location:precise:view"),
    );
    assert.ok(declined, "the engine should say what it declined to evaluate and why");
    assert.match(declined!.summary, /not evaluated/i);
  });

  it("gives an owner the full derived picture on its own equipment", () => {
    const board = dispatchTrackingBoardSync(trackingContextFor(NORTHLINE_OWNER));
    const row = board.rows.find((r) => r.loadReference === "NL-24817")!;
    assert.equal(row.precision, "exact");
    assert.equal(row.precisionNote, undefined);
    assert.ok(row.milesToDelivery != null);
    assert.ok(row.routeProgressPercent != null);
  });

  it("gives the dispatcher the derived picture on the truck they were granted", () => {
    const board = dispatchTrackingBoardSync(trackingContextFor(MERIDIAN_DISPATCHER));
    const row = board.rows.find((r) => r.loadReference === "MD-9042")!;
    assert.equal(row.precision, "exact");
    assert.equal(row.precisionNote, undefined);
    assert.ok(row.milesToDelivery != null);
  });
});

describe("source precedence and provenance", () => {
  beforeEach(resetWorld);

  it("prefers the ELD observation and says which source each position came from", () => {
    const ctx = trackingContextFor(NORTHLINE_OWNER);
    const view = loadTrackingSync(
      ctx,
      mockStore.org("org_northline").loads.find((l) => l.reference === "NL-24817")!.id,
    )!;
    assert.equal(view.row.lastSignalTransport, "eld_telemetry");
    // Every position carries a transport and a mock-labelled adapter.
    for (const signal of view.signals) {
      assert.ok(signal.transport);
      assert.equal(signal.provenance.mock, true);
    }
  });

  it("carries the ELD event id so a position can be traced to its observation", () => {
    const ctx = trackingContextFor(NORTHLINE_OWNER);
    const read = eldTelemetryForTruckSync(ctx, TRUCK_IDS.nl104)!;
    const signals = locationSignalsFor(ctx, { truckId: TRUCK_IDS.nl104 });
    const fromEld = signals.filter((s) => s.transport === "eld_telemetry");

    assert.ok(fromEld.length > 0);
    const eventIds = new Set(read.observations.map((e) => e.id));
    for (const signal of fromEld) {
      assert.ok(eventIds.has(signal.provenance.externalId!));
    }
  });

  it("does not raise a provider's own confidence", () => {
    const ctx = trackingContextFor(NORTHLINE_OWNER);
    const signals = locationSignalsFor(ctx, { truckId: TRUCK_IDS.nl104 })
      .filter((s) => s.transport === "eld_telemetry");
    for (const signal of signals) assert.ok(signal.confidence <= 1);
  });

  it("collapses a repeat of an ELD observation exactly once", () => {
    const ctx = trackingContextFor(NORTHLINE_OWNER);
    const before = locationSignalsFor(ctx, { truckId: TRUCK_IDS.nl104 });
    const after = locationSignalsFor(ctx, { truckId: TRUCK_IDS.nl104 });
    assert.equal(after.length, before.length, "reading twice must not double the run");
    assert.equal(new Set(after.map((s) => s.id)).size, after.length);
  });

  it("collapses a simulated duplicate of an existing position", () => {
    const ctx = trackingContextFor(NORTHLINE_OWNER);
    const before = locationSignalsFor(ctx, { truckId: TRUCK_IDS.nl104 }).length;
    const shape = {
      organizationId: ctx.organizationId,
      truckId: TRUCK_IDS.nl104,
      city: "Dayton",
      state: "OH",
      minutesAgo: 3,
    };
    simulatePosition(shape);
    simulatePosition(shape);
    simulatePosition(shape);
    assert.equal(locationSignalsFor(ctx, { truckId: TRUCK_IDS.nl104 }).length, before + 1);
  });
});

describe("the ETA is attributed, never computed here", () => {
  beforeEach(resetWorld);

  it("names the load timeline when an ETA was reported", () => {
    const board = dispatchTrackingBoardSync(trackingContextFor(NORTHLINE_OWNER));
    const row = board.rows.find((r) => r.loadReference === "NL-24817")!;
    assert.equal(row.etaSource, "load_event");
    assert.ok(row.etaAt);
  });

  it("says plainly when the appointment is standing in for an ETA", () => {
    const board = dispatchTrackingBoardSync(trackingContextFor(NORTHLINE_OWNER));
    const row = board.rows.find((r) => r.loadReference === "NL-24816")!;
    assert.equal(row.etaSource, "appointment");
    // And no lateness is claimed from comparing an appointment with itself.
    assert.equal(row.etaVarianceMinutes, undefined);
  });
});

describe("a public tracking link cannot reach a coordinate", () => {
  beforeEach(resetWorld);

  it("shows the broker a city and never a coordinate", async () => {
    const ctx = trackingContextFor(NORTHLINE_OWNER);
    const load = mockStore.org("org_northline").loads.find((l) => l.reference === "NL-24817")!;
    const session = await openTrackingSession(ctx, { loadId: load.id });
    const recipient = await addTrackingRecipient(ctx, {
      sessionId: session.id, audience: "broker", partyName: "Apex Logistics",
    });

    const result = publicTracking(recipient.link.token);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.ok(result.view.truckLocation?.city, "the broker gets a city");
    const json = JSON.stringify(result.view);
    assert.equal(json.includes("latitude"), false);
    assert.equal(json.includes("longitude"), false);
  });

  it("resolves under the carrier's authority, not the viewer's", async () => {
    // The dispatcher who minted the link holds no precise-location permission
    // in Meridian; the link is Northline's to give and resolves regardless.
    const ctx = trackingContextFor(NORTHLINE_OWNER);
    const load = mockStore.org("org_northline").loads.find((l) => l.reference === "NL-24817")!;
    const session = await openTrackingSession(ctx, { loadId: load.id });
    const recipient = await addTrackingRecipient(ctx, {
      sessionId: session.id, audience: "broker", partyName: "Apex Logistics",
    });
    const result = publicTracking(recipient.link.token);
    assert.equal(result.ok, true);
  });
});

describe("the carrier keeps control of precise position", () => {
  beforeEach(resetWorld);

  const carrier = () => trackingContextFor(NORTHLINE_OWNER);

  it("defaults a new position share to including coordinates", async () => {
    const share = await services.eld.grantShare(carrier(), {
      viewerOrganizationId: "org_summit",
      truckId: TRUCK_IDS.nl131,
      signalClasses: ["position"],
    });
    assert.equal(share.precisePosition, true);
    assert.equal(
      locationScopeFor(trackingContextFor(SUMMIT_OWNER), TRUCK_IDS.nl131).precision,
      "exact",
    );
  });

  it("lets the carrier withhold coordinates while still sharing the position", async () => {
    const share = await services.eld.grantShare(carrier(), {
      viewerOrganizationId: "org_summit",
      truckId: TRUCK_IDS.nl131,
      signalClasses: ["position"],
      precisePosition: false,
    });
    assert.equal(share.precisePosition, false);

    const scope = locationScopeFor(trackingContextFor(SUMMIT_OWNER), TRUCK_IDS.nl131);
    assert.equal(scope.scoped, true, "the truck is still shared");
    assert.equal(scope.precision, "city_only", "the coordinates are not");
  });

  it("never grants coordinates on a share that does not include position", async () => {
    const share = await services.eld.grantShare(carrier(), {
      viewerOrganizationId: "org_summit",
      truckId: TRUCK_IDS.nl131,
      signalClasses: ["meters"],
      // Asking for precision without position is incoherent, and is refused
      // rather than honoured: there are no coordinates in a meter reading.
      precisePosition: true,
    });
    assert.equal(share.precisePosition, false);
  });

  it("takes the coordinates back when the carrier revokes the share", async () => {
    const ctx = carrier();
    const share = await services.eld.grantShare(ctx, {
      viewerOrganizationId: "org_summit",
      truckId: TRUCK_IDS.nl131,
      signalClasses: ["position"],
    });
    assert.equal(
      locationScopeFor(trackingContextFor(SUMMIT_OWNER), TRUCK_IDS.nl131).precision,
      "exact",
    );

    await services.eld.revokeShare(ctx, share.id);

    const scope = locationScopeFor(trackingContextFor(SUMMIT_OWNER), TRUCK_IDS.nl131);
    assert.equal(scope.scoped, false, "revoking the share takes the truck with it");
    assert.equal(locationSignalsFor(trackingContextFor(SUMMIT_OWNER), { truckId: TRUCK_IDS.nl131 }).length, 0);
  });

  it("will not let a dispatch workspace share telemetry it was given", async () => {
    // Meridian holds a precise grant on A-12. It cannot pass that on.
    await rejects(
      () => services.eld.grantShare(trackingContextFor(MERIDIAN_DISPATCHER), {
        viewerOrganizationId: "org_summit",
        truckId: TRUCK_IDS.mdA12,
        signalClasses: ["position"],
      }),
      "PermissionDeniedError",
    );
  });
});

describe("the permission and the share must both agree", () => {
  beforeEach(resetWorld);

  it("gives no coordinates to a membership whose permission was revoked", () => {
    // The carrier granted precision on A-12; the dispatch organization's own
    // owner took the permission off this membership. Both gates, and this one
    // is closed.
    const ctx = without(trackingContextFor(MERIDIAN_DISPATCHER), "eld:location:precise:view");
    const scope = locationScopeFor(ctx, TRUCK_IDS.mdA12);

    assert.equal(scope.scoped, true, "the truck is still shared");
    assert.equal(scope.precision, "city_only");
    for (const signal of locationSignalsFor(ctx, { truckId: TRUCK_IDS.mdA12, scope })) {
      assert.equal(signal.point, undefined);
    }
  });

  it("gives no coordinates when the permission is held but nothing was shared", () => {
    const ctx = trackingContextFor(MERIDIAN_DISPATCHER);
    assert.equal(ctx.permissions.has("eld:location:precise:view"), true);
    assert.equal(locationScopeFor(ctx, TRUCK_IDS.crosswind).scoped, false);
  });

  it("does not let a precise grant widen which trucks are visible at all", () => {
    // Precision is about HOW WELL a truck may be seen, never about WHICH.
    const ctx = trackingContextFor(MERIDIAN_DISPATCHER);
    const board = dispatchTrackingBoardSync(ctx);
    const positioned = board.rows.filter((r) => r.currentCity);
    assert.equal(positioned.length, 1, "one shared truck, one position");
    assert.equal(positioned[0].loadReference, "MD-9042");
  });

  it("reduces the ELD module's own snapshot too, not just Tracking's view", async () => {
    // The reduction lives in the ELD module, so every consumer inherits it —
    // Tracking is not the thing keeping coordinates out of Summit's hands.
    const summit = trackingContextFor(SUMMIT_OWNER);
    const snapshot = await services.eld.snapshot(summit, TRUCK_IDS.nl111);
    assert.equal(snapshot.location.value?.precise, false);
    assert.equal(snapshot.location.value?.latitude, undefined);
    assert.equal(snapshot.location.value?.longitude, undefined);
    assert.ok(snapshot.location.value?.city, "the city survives");
  });

  it("withholds coordinates from the ELD event stream as well as the snapshot", async () => {
    const summit = trackingContextFor(SUMMIT_OWNER);
    const events = await services.eld.events(summit, {
      truckId: TRUCK_IDS.nl111,
      kinds: ["location"],
    });
    assert.ok(events.length > 0);
    for (const event of events) {
      if (event.value.kind !== "location") continue;
      // The module zeroes what it withholds; Tracking drops the point entirely.
      // Either way no real coordinate reaches a viewer who may not hold one.
      assert.equal(event.value.latitude, 0);
      assert.equal(event.value.longitude, 0);
      assert.match(event.ingestionNote ?? "", /eld:location:precise:view/);
    }
  });
});
