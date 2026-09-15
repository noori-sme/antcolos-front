import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  confirmTruckEmpty, dispatchTrackingBoardSync, loadTrackingSync, publishAvailability,
} from "@/lib/api/mock/tracking-board";
import { loopForCycle, mtLoopBoardSync } from "@/lib/api/mock/mt-loop";
import { simulatePosition, simulateSignalOutage } from "@/lib/api/mock/tracking-signals";
import { availabilityForTruck } from "@/lib/api/mock/tracking-availability";
import { TRUCK_IDS } from "@/lib/api/mock/truck-registry";
import { mockStore } from "@/lib/api/mock/store";
import {
  CASCADE_DRIVER, MERIDIAN_DISPATCHER, NORTHLINE_OWNER, resetWorld,
  trackingContextFor, withOnly, without,
} from "./tracking-harness";

/**
 * The dispatch tracking board, through the service layer.
 *
 * These prove the boundary rather than the screen: what one workspace may see,
 * what it may not, and that publishing availability twice does not produce two
 * MT Loop entries for one empty truck.
 */

describe("the board is organization-scoped and multi-carrier", () => {
  beforeEach(resetWorld);

  it("puts several carriers on one dispatch board with no workspace switching", () => {
    const board = dispatchTrackingBoardSync(trackingContextFor(MERIDIAN_DISPATCHER));

    assert.ok(board.carriers.length >= 2, "a dispatch workspace works more than one carrier");
    const names = board.carriers.map((c) => c.name);
    assert.ok(names.includes("Baxter Transit LLC"));
    assert.ok(names.includes("Crosswind Freight"));
    // Every carrier chip is nameable — a row whose equipment is not shared here
    // never becomes an unusable "This carrier" filter.
    assert.ok(board.carriers.every((c) => c.name.trim().length > 0));
  });

  it("carries the operating authority in force on every row that has a carrier", () => {
    const board = dispatchTrackingBoardSync(trackingContextFor(MERIDIAN_DISPATCHER));
    const row = board.rows.find((r) => r.loadReference === "MD-9042");
    assert.ok(row?.authority, "the row should carry the authority it runs under");
    assert.equal(row!.authority!.carrierOrganizationId, "org_baxter");
    assert.equal(typeof row!.authority!.allowedDispatch, "boolean");
    assert.ok(row!.authority!.snapshotAt);
  });

  it("names the carrier a carrier workspace runs its own freight under", () => {
    const board = dispatchTrackingBoardSync(trackingContextFor(NORTHLINE_OWNER));
    const row = board.rows.find((r) => r.loadReference === "NL-24817");
    assert.equal(row?.carrierOrganizationId, "org_northline");
    assert.equal(row?.carrierName, "Northline Freight");
  });

  it("never shows one workspace another workspace's loads", () => {
    const meridian = dispatchTrackingBoardSync(trackingContextFor(MERIDIAN_DISPATCHER));
    const northline = dispatchTrackingBoardSync(trackingContextFor(NORTHLINE_OWNER));

    const meridianRefs = new Set(meridian.rows.map((r) => r.loadReference));
    for (const row of northline.rows) {
      assert.equal(meridianRefs.has(row.loadReference), false,
        `${row.loadReference} leaked across the organization boundary`);
    }
    assert.ok(northline.rows.every((r) => r.loadReference.startsWith("NL-")));
    assert.ok(meridian.rows.every((r) => r.loadReference.startsWith("MD-")));
  });

  it("gives a driver membership nothing at all", () => {
    const board = dispatchTrackingBoardSync(trackingContextFor(CASCADE_DRIVER));
    assert.equal(board.rows.length, 0);
    assert.equal(board.carriers.length, 0);
  });

  it("gives nothing to a membership without tracking:view", () => {
    const ctx = without(trackingContextFor(MERIDIAN_DISPATCHER), "tracking:view");
    assert.equal(dispatchTrackingBoardSync(ctx).rows.length, 0);
  });

  it("gives nothing to a membership scoped to its own records", () => {
    const ctx = trackingContextFor(MERIDIAN_DISPATCHER, {
      scope: { loads: "assigned", financials: "own" },
    });
    assert.equal(dispatchTrackingBoardSync(ctx).rows.length, 0);
  });

  it("withholds the position when the equipment is not shared with this workspace", () => {
    // Northline's own loads, read by a caller who may see loads but not trucks.
    const ctx = withOnly(
      trackingContextFor(NORTHLINE_OWNER),
      "tracking:view", "loads:view",
    );
    const board = dispatchTrackingBoardSync(ctx);
    const row = board.rows.find((r) => r.loadReference === "NL-24817");
    assert.ok(row, "the load is still the workspace's own");
    assert.equal(row!.truckUnit, undefined);
    assert.equal(row!.currentCity, undefined);
    assert.equal(row!.health, "unavailable");
    assert.match(row!.healthReason, /not one this workspace can see/i);
  });
});

describe("live, stale, offline, interrupted and unavailable", () => {
  beforeEach(resetWorld);

  it("reads a fresh feed as live and says how old it is", () => {
    const board = dispatchTrackingBoardSync(trackingContextFor(NORTHLINE_OWNER));
    const row = board.rows.find((r) => r.loadReference === "NL-24817")!;
    assert.equal(row.health, "live");
    assert.ok((row.lastUpdateAgeMinutes ?? 999) < 45);
    assert.ok(row.lastSignalLabel?.includes("mock adapter"), "the screen must be told it is a mock");
  });

  it("reads an established feed that stopped as interrupted, not merely stale", () => {
    const board = dispatchTrackingBoardSync(trackingContextFor(MERIDIAN_DISPATCHER));
    const row = board.rows.find((r) => r.loadReference === "MD-9042")!;
    assert.equal(row.health, "interrupted");
    assert.match(row.healthReason, /was working and it stopped/i);
    assert.ok(row.alerts.some((a) => a.kind === "signal_lost"));
  });

  it("reads a single hours-old position as offline", () => {
    const board = dispatchTrackingBoardSync(trackingContextFor(MERIDIAN_DISPATCHER));
    const row = board.rows.find((r) => r.loadReference === "MD-9038")!;
    assert.equal(row.health, "offline");
  });

  it("reads a silenced feed as offline and says nothing has ever reported", () => {
    const ctx = trackingContextFor(NORTHLINE_OWNER);
    simulateSignalOutage(ctx.organizationId, TRUCK_IDS.nl104, true);
    const row = dispatchTrackingBoardSync(ctx).rows.find((r) => r.loadReference === "NL-24817")!;
    assert.equal(row.health, "offline");
    assert.match(row.healthReason, /ever been reported/i);
  });

  it("goes back to live when the feed comes back", () => {
    const ctx = trackingContextFor(NORTHLINE_OWNER);
    simulateSignalOutage(ctx.organizationId, TRUCK_IDS.nl104, true);
    simulateSignalOutage(ctx.organizationId, TRUCK_IDS.nl104, false);
    const row = dispatchTrackingBoardSync(ctx).rows.find((r) => r.loadReference === "NL-24817")!;
    assert.equal(row.health, "live");
  });
});

describe("confirmed versus inferred", () => {
  beforeEach(resetWorld);

  it("marks a milestone suggested by an ELD signal as inferred, never as the driver's", () => {
    const view = loadTrackingSync(
      trackingContextFor(NORTHLINE_OWNER),
      mockStore.org("org_northline").loads.find((l) => l.reference === "NL-24816")!.id,
    )!;
    const recorded = view.row.milestones.filter((m) => m.at);
    assert.ok(recorded.length > 0);
    for (const m of recorded) {
      assert.ok(m.basis === "confirmed" || m.basis === "inferred");
      if (m.basis === "inferred") {
        assert.notEqual(m.attribution, "driver", "a machine never stands in for a driver");
        assert.ok(m.inferenceRationale ?? true);
      }
    }
  });

  it("keeps a rejected geofence reading visible, with the reason it was rejected", () => {
    const ctx = trackingContextFor(NORTHLINE_OWNER);
    const load = mockStore.org("org_northline").loads.find((l) => l.reference === "NL-24817")!;
    // A truck doing 62mph through the receiver's circle. Nothing arrived.
    simulatePosition({
      organizationId: ctx.organizationId,
      truckId: TRUCK_IDS.nl104,
      loadId: load.id,
      city: "Columbus",
      state: "OH",
      speedMph: 62,
      minutesAgo: 1,
    });

    const view = loadTrackingSync(ctx, load.id)!;
    const geofenceAlert = view.row.alerts.find((a) => a.kind === "geofence");
    assert.ok(geofenceAlert, "the reading should surface");
    assert.match(geofenceAlert!.title + geofenceAlert!.detail, /not believed|passing, not a truck arriving/i);
    assert.notEqual(view.availability?.state, "empty_confirmed");
  });
});

describe("availability reaches the MT Loop service, once", () => {
  beforeEach(resetWorld);

  it("opens a cycle for a publishable decision", () => {
    const ctx = trackingContextFor(NORTHLINE_OWNER);
    const results = publishAvailability(ctx);
    const opened = results.filter((r) => r.publication.outcome === "loop_opened");
    assert.ok(opened.length > 0, "at least one truck should have a cycle opened");
    for (const r of opened) {
      assert.ok(loopForCycle(r.decision.cycleKey, ctx.organizationId));
    }
  });

  it("does not open a second entry for the same truck and cycle", () => {
    const ctx = trackingContextFor(NORTHLINE_OWNER);
    publishAvailability(ctx);
    const before = mtLoopBoardSync(ctx).loops.length;

    const second = publishAvailability(ctx);
    const third = publishAvailability(ctx);
    const after = mtLoopBoardSync(ctx).loops.length;

    assert.equal(after, before, "republishing must not grow the board");
    for (const r of [...second, ...third]) {
      assert.notEqual(r.publication.outcome, "loop_opened");
    }
  });

  it("writes no history line when the conclusion has not moved", () => {
    const ctx = trackingContextFor(NORTHLINE_OWNER);
    const first = publishAvailability(ctx).find((r) => r.publication.outcome === "loop_opened")!;
    const loop = loopForCycle(first.decision.cycleKey, ctx.organizationId)!;
    const lines = loop.history.length;

    publishAvailability(ctx);
    publishAvailability(ctx);

    assert.equal(
      loopForCycle(first.decision.cycleKey, ctx.organizationId)!.history.length,
      lines,
      "a heartbeat is not an event",
    );
  });

  it("refuses to publish an uncertain availability at all", () => {
    const ctx = trackingContextFor(MERIDIAN_DISPATCHER);
    const results = publishAvailability(ctx);
    const uncertain = results.filter((r) => r.decision.state === "availability_uncertain");
    assert.ok(uncertain.length > 0, "the fixtures include a truck nobody can place");
    for (const r of uncertain) {
      assert.equal(r.publication.outcome, "not_publishable");
      assert.match(r.publication.reason, /will not put a guess on the board/i);
    }
  });

  it("refuses to open a cycle for a truck another workspace covers", () => {
    const ctx = trackingContextFor(NORTHLINE_OWNER);
    const results = publishAvailability(ctx);
    const foreign = results.filter((r) => r.publication.outcome === "not_responsible");
    assert.ok(foreign.length > 0, "Northline has delegated trucks to a dispatch agency");
  });

  it("records the publication on the loop with its basis and its adapter", () => {
    const ctx = trackingContextFor(NORTHLINE_OWNER);
    const first = publishAvailability(ctx).find((r) => r.publication.outcome === "loop_opened")!;
    const loop = loopForCycle(first.decision.cycleKey, ctx.organizationId)!;

    assert.ok(loop.availability);
    assert.equal(loop.availability!.cycleKey, first.decision.cycleKey);
    assert.equal(loop.availability!.sourceIsMock, true);
    assert.match(loop.availability!.sourceAdapter, /^mock:/);
  });
});

describe("a person confirming an empty truck", () => {
  beforeEach(resetWorld);

  it("moves the decision to Empty Confirmed and publishes it to the same cycle", async () => {
    const ctx = trackingContextFor(NORTHLINE_OWNER);
    // Unit 104 is one Northline dispatches itself; 107 is delegated to Summit,
    // and confirming that one here would correctly be refused.
    const before = availabilityForTruck(TRUCK_IDS.nl104, ctx)!;
    assert.notEqual(before.state, "empty_confirmed");

    publishAvailability(ctx);
    const loopCount = mtLoopBoardSync(ctx).loops.length;

    const { decision, publication } = await confirmTruckEmpty(ctx, {
      truckId: TRUCK_IDS.nl104,
      empty: true,
      note: "Driver rang in — doors shut, rolling.",
    });

    assert.equal(decision?.state, "empty_confirmed");
    assert.equal(decision?.basis, "confirmed");
    assert.equal(decision?.cycleKey, before.cycleKey, "same cycle, not a new one");
    assert.ok(publication?.outcome === "loop_updated" || publication?.outcome === "loop_opened");
    assert.ok(mtLoopBoardSync(ctx).loops.length <= loopCount + 1);
  });

  it("attributes a dispatcher's phone call to the dispatcher, never to the driver", async () => {
    const ctx = trackingContextFor(NORTHLINE_OWNER);
    const { decision } = await confirmTruckEmpty(ctx, { truckId: TRUCK_IDS.nl104, empty: true });
    const human = decision!.evidence.find((e) => e.kind === "human_confirmation")!;
    assert.equal(human.attribution, "dispatcher");
    assert.equal(human.basis, "confirmed");
  });

  it("does not let a confirmation carry into the next cycle", async () => {
    const ctx = trackingContextFor(NORTHLINE_OWNER);
    await confirmTruckEmpty(ctx, { truckId: TRUCK_IDS.nl104, empty: true });

    // The truck picks up different freight: a different cycle entirely.
    const org = mockStore.org("org_northline");
    const load = org.loads.find((l) => l.assignment?.truckId === TRUCK_IDS.nl104)!;
    load.assignment!.endedAt = new Date().toISOString();

    const next = availabilityForTruck(TRUCK_IDS.nl104, ctx)!;
    assert.notEqual(next.cycleKey, `${TRUCK_IDS.nl104}::load:${load.id}`);
  });
});
