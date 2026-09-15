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
import { appendReading } from "@/lib/api/mock/fleet-telemetry";
import { TRUCK_IDS } from "@/lib/api/mock/truck-registry";
import { mockStore } from "@/lib/api/mock/store";
import {
  MERIDIAN_DISPATCHER, NORTHLINE_OWNER, SOLO_DISPATCHER, resetWorld,
  trackingContextFor, without,
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

describe("precise-location permission gates everything derived from a coordinate", () => {
  beforeEach(resetWorld);

  it("gives a dispatcher without the permission a city and no coordinates", () => {
    const ctx = trackingContextFor(MERIDIAN_DISPATCHER);
    assert.equal(ctx.permissions.has("eld:location:precise:view"), false);

    const signals = locationSignalsFor(ctx, { truckId: TRUCK_IDS.mdA12 });
    assert.ok(signals.length > 0);
    for (const signal of signals) {
      assert.equal(signal.precision, "city_only");
      assert.equal(signal.point, undefined, "a coordinate must never survive the reduction");
    }
  });

  it("states why route progress, miles and geofence are absent", () => {
    const board = dispatchTrackingBoardSync(trackingContextFor(MERIDIAN_DISPATCHER));
    const row = board.rows.find((r) => r.loadReference === "MD-9042")!;

    assert.equal(row.precision, "city_only");
    assert.equal(row.routeProgressPercent, undefined);
    assert.equal(row.milesToDelivery, undefined);
    assert.ok(row.precisionNote, "a blank must be explained, not left ambiguous");
    assert.match(row.precisionNote!, /eld:location:precise:view/);
    assert.match(row.precisionNote!, /no city-level estimate is substituted/i);
    assert.equal(row.alerts.some((a) => a.kind === "geofence"), false);
  });

  it("does not infer city-level proximity as a substitute", () => {
    const board = dispatchTrackingBoardSync(trackingContextFor(MERIDIAN_DISPATCHER));
    const row = board.rows.find((r) => r.loadReference === "MD-9042")!;
    // The receiver is Pittsburgh and the truck reports a Pennsylvania city.
    // A centroid-to-centroid distance would be easy and would be a lie.
    assert.equal(row.milesToDelivery, undefined);
    assert.equal(row.routeProgressPercent, undefined);
  });

  it("records the declined evaluation as evidence rather than silence", () => {
    const ctx = trackingContextFor(MERIDIAN_DISPATCHER);
    const decision = availabilityForTruck(TRUCK_IDS.mdA12, ctx)!;
    const declined = decision.evidence.find(
      (e) => e.disregardedReason?.includes("eld:location:precise:view"),
    );
    assert.ok(declined, "the engine should say what it declined to evaluate and why");
    assert.match(declined!.summary, /not evaluated/i);
  });

  it("gives an owner with the permission the full derived picture", () => {
    const board = dispatchTrackingBoardSync(trackingContextFor(NORTHLINE_OWNER));
    const row = board.rows.find((r) => r.loadReference === "NL-24817")!;
    assert.equal(row.precision, "exact");
    assert.equal(row.precisionNote, undefined);
    assert.ok(row.milesToDelivery != null);
    assert.ok(row.routeProgressPercent != null);
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
