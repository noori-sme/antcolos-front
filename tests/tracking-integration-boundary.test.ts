import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  LocationSourceNotConnectedError, TRACKING_SIGNAL_SOURCES, signalSourceDescriptor,
  transportIsConnected, unconnectedAdapter,
} from "@/lib/tracking";
import {
  locationSignalsFor, mockLocationAdapter, reportedEta, simulatePosition,
  trackingSignalSources,
} from "@/lib/api/mock/tracking-signals";
import { appendReading } from "@/lib/api/mock/fleet-telemetry";
import { TRUCK_IDS } from "@/lib/api/mock/truck-registry";
import { mockStore } from "@/lib/api/mock/store";
import { dispatchTrackingBoardSync, publicTracking } from "@/lib/api/mock/tracking-board";
import {
  addTrackingRecipient, openTrackingSession, revokeTrackingLink, trackingAudit,
  trackingAuditForLedger,
} from "@/lib/api/mock/tracking-registry";
import { readAllFeeds } from "@/lib/api/mock/audit-sources";
import { NORTHLINE_OWNER, resetWorld, trackingContextFor, without } from "./tracking-harness";

/**
 * The integration boundary.
 *
 * Two things to prove: that nothing claims to be connected when it is not, and
 * that this module reads the existing ELD/telematics layer rather than growing
 * a second store of positions beside it.
 */

describe("nothing claims to be connected", () => {
  it("reports every planned transport as not connected", () => {
    assert.ok(TRACKING_SIGNAL_SOURCES.length >= 6);
    for (const source of TRACKING_SIGNAL_SOURCES) {
      assert.equal(source.status, "not_connected", `${source.transport} claims to be connected`);
      assert.equal(transportIsConnected(source.transport), false);
      assert.ok(source.ownedBy.length > 0, "every boundary names who would own it");
      assert.ok(source.wouldPopulate.length > 0);
    }
  });

  it("declares the transports the brief asks to be prepared for", () => {
    const transports = TRACKING_SIGNAL_SOURCES.map((s) => s.transport);
    for (const expected of ["eld", "mobile_gps", "telegram_location", "api", "email", "sms"]) {
      assert.ok(transports.includes(expected as never), `no adapter shape for ${expected}`);
      assert.ok(signalSourceDescriptor(expected as never));
    }
  });

  it("fails loudly rather than inventing a position", async () => {
    const adapter = unconnectedAdapter("eld");
    await assert.rejects(
      () => adapter.positionsFor({ organizationId: "org_northline", truckId: "t" }),
      (error: Error) => {
        assert.ok(error instanceof LocationSourceNotConnectedError);
        assert.match(error.message, /will not invent a position/i);
        return true;
      },
    );
  });

  it("refuses to hand out a position to a caller with no identity", async () => {
    resetWorld();
    // The adapter contract takes an organization id and no membership. Who may
    // see a truck depends on the workspace asking, so there is no honest answer
    // to give a caller that cannot be scoped — and returning the carrier's
    // positions "because the org id matched" is exactly the bypass this
    // milestone closed.
    const signals = await mockLocationAdapter.positionsFor({
      organizationId: "org_northline",
      truckId: TRUCK_IDS.nl104,
    });
    assert.equal(signals.length, 0);
    assert.equal(mockLocationAdapter.describe().status, "not_connected");
    assert.equal(trackingSignalSources().length, TRACKING_SIGNAL_SOURCES.length);
  });

  it("stamps everything a scoped read produces as a mock", () => {
    resetWorld();
    const ctx = trackingContextFor(NORTHLINE_OWNER);
    const signals = locationSignalsFor(ctx, { truckId: TRUCK_IDS.nl104 });
    assert.ok(signals.length > 0);
    for (const signal of signals) {
      assert.equal(signal.provenance.mock, true);
      assert.match(signal.provenance.adapter, /^mock:/);
    }
  });
});

describe("it reads the existing layers rather than copying them", () => {
  beforeEach(resetWorld);

  it("normalizes a fleet telemetry reading into a location signal", () => {
    const ctx = trackingContextFor(NORTHLINE_OWNER);
    const reading = appendReading(
      {
        assetKind: "truck",
        assetId: TRUCK_IDS.nl111,
        location: { city: "Chicago", state: "IL", description: "Home terminal, bay 3" },
      },
      { organizationId: ctx.organizationId, membershipId: ctx.membershipId, actorName: "Sam Murtaza" },
    );

    const signals = locationSignalsFor(ctx, { truckId: TRUCK_IDS.nl111 });
    const mine = signals.find((s) => s.provenance.externalId === reading.id);
    assert.ok(mine, "the fleet layer's own reading should surface as a signal");
    // A person typed it, so it is a person's statement, not a device reading.
    assert.equal(mine!.transport, "dispatcher_entry");
    assert.equal(mine!.telemetrySource, "manual_entry");
  });

  it("keeps one organization's readings out of another's tracking", () => {
    const ctx = trackingContextFor(NORTHLINE_OWNER);
    appendReading(
      {
        assetKind: "truck",
        assetId: TRUCK_IDS.nl111,
        location: { city: "Chicago", state: "IL" },
      },
      { organizationId: "org_baxter", membershipId: "mem_baxter_owner", actorName: "Somebody Else" },
    );
    const signals = locationSignalsFor(ctx, { truckId: TRUCK_IDS.nl111 });
    assert.equal(
      signals.some((s) => s.organizationId !== ctx.organizationId),
      false,
      "a reading recorded by another organization must not appear here",
    );
  });

  it("reads the ETA off the Load module's own timeline instead of computing one", () => {
    const load = mockStore.org("org_northline").loads.find((l) => l.reference === "NL-24817")!;
    const eta = reportedEta("org_northline", load.id);
    assert.ok(eta, "the fixture load carries a load.eta_updated event");

    // And nothing invents one where the Load module has not recorded it.
    const quiet = mockStore.org("org_northline").loads.find((l) => l.reference === "NL-24822")!;
    assert.equal(reportedEta("org_northline", quiet.id), undefined);
  });

  it("does not double-count a position that arrives twice", () => {
    const ctx = trackingContextFor(NORTHLINE_OWNER);
    const load = mockStore.org("org_northline").loads.find((l) => l.reference === "NL-24817")!;
    const before = locationSignalsFor(ctx, { truckId: TRUCK_IDS.nl104, loadId: load.id }).length;

    const shape = {
      organizationId: ctx.organizationId,
      truckId: TRUCK_IDS.nl104,
      loadId: load.id,
      city: "Columbus",
      state: "OH",
      speedMph: 0,
      minutesAgo: 2,
    };
    simulatePosition(shape);
    simulatePosition(shape);
    simulatePosition(shape);

    const after = locationSignalsFor(ctx, { truckId: TRUCK_IDS.nl104, loadId: load.id }).length;
    assert.equal(after, before + 1, "three copies of one observation are one observation");
  });

  it("surfaces the adapter's honesty on the board itself", () => {
    const board = dispatchTrackingBoardSync(trackingContextFor(NORTHLINE_OWNER));
    assert.ok(board.sources.every((s) => s.status === "not_connected"));
    const tracked = board.rows.find((r) => r.lastSignalLabel);
    assert.match(tracked!.lastSignalLabel!, /mock adapter/i);
  });
});

describe("the tracking history reaches the one audit ledger", () => {
  beforeEach(resetWorld);

  it("projects tracking lines rather than keeping a second audit log", async () => {
    const ctx = trackingContextFor(NORTHLINE_OWNER);
    const load = mockStore.org("org_northline").loads.find((l) => l.reference === "NL-24817")!;
    const session = await openTrackingSession(ctx, { loadId: load.id });
    await addTrackingRecipient(ctx, {
      sessionId: session.id, audience: "broker", partyName: "Apex Logistics",
    });

    const feeds = await readAllFeeds(ctx);
    const dispatch = feeds.find((f) => f.module === "dispatch");
    assert.ok(dispatch, "the ledger reads a dispatch feed");

    const mine = dispatch!.records.filter((r) => r.action === "dispatch.tracking_changed");
    assert.ok(mine.length >= 2, "opening tracking and issuing a link are both projected");
    // The tracking module keeps its own entry ids; the ledger does not mint new ones.
    const ids = new Set(trackingAudit(ctx).map((e) => e.id));
    for (const record of mine) assert.ok(ids.has(record.entryId));
    // And the module's own action key survives verbatim.
    assert.ok(mine.some((r) => r.sourceAction === "link_issued"));
  });

  it("projects a refused link access as a denial", async () => {
    const ctx = trackingContextFor(NORTHLINE_OWNER);
    const load = mockStore.org("org_northline").loads.find((l) => l.reference === "NL-24817")!;
    const session = await openTrackingSession(ctx, { loadId: load.id });
    const recipient = await addTrackingRecipient(ctx, {
      sessionId: session.id, audience: "broker", partyName: "Apex Logistics",
    });
    await revokeTrackingLink(ctx, session.id, recipient.id, "Withdrawn.");
    publicTracking(recipient.link.token);

    const feeds = await readAllFeeds(ctx);
    const denied = feeds
      .find((f) => f.module === "dispatch")!
      .records.find((r) => r.sourceAction === "link_access_refused");
    assert.ok(denied);
    assert.equal(denied!.outcome, "denied");
  });

  it("gives the ledger nothing without tracking:view", async () => {
    const ctx = trackingContextFor(NORTHLINE_OWNER);
    const load = mockStore.org("org_northline").loads.find((l) => l.reference === "NL-24817")!;
    await openTrackingSession(ctx, { loadId: load.id });

    const limited = without(ctx, "tracking:view");
    assert.equal(trackingAuditForLedger(limited).length, 0);
  });
});
