import { beforeEach, describe, expect, it } from "vitest";
import { eldScopesFor, mockEldService } from "@/lib/api/mock/eld";
import { resetEldRegistry } from "@/lib/api/mock/eld-registry";
import { fleetSync, resetTruckRegistry, truckContextFrom } from "@/lib/api/mock/truck-registry";
import { resetTrailerRegistry } from "@/lib/api/mock/trailer-registry";
import { NotFoundError, PermissionDeniedError } from "@/lib/api/contracts/context";
import {
  BAXTER_OWNER, CASCADE_DRIVER, MERIDIAN_DISPATCHER, NORTHLINE_OWNER, SUMMIT_OWNER,
  contextFor,
} from "../helpers/context";

/**
 * Access is decided in the service layer, and these are the six rules it keeps.
 *
 * Every one of them is a rule a screen could not enforce even if it wanted to:
 * the data never reaches the component. That is the point of testing here
 * rather than clicking a button — a test that proved a panel was hidden would
 * prove the panel.
 */

beforeEach(() => {
  resetTruckRegistry();
  resetTrailerRegistry();
  resetEldRegistry();
});

describe("permissions", () => {
  it("refuses everything without eld:view", async () => {
    const ctx = contextFor(NORTHLINE_OWNER, { without: ["eld:view"] });
    await expect(mockEldService.dashboard(ctx)).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(mockEldService.devices(ctx)).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(mockEldService.events(ctx)).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(mockEldService.signals(ctx)).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(mockEldService.needsYou(ctx)).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("does not make eld:view a back door into the truck registry", async () => {
    // Seeing the module is not seeing the fleet. Without trucks:view there is
    // no equipment to attribute anything to, so there is nothing to show.
    const ctx = contextFor(NORTHLINE_OWNER, { permissions: ["eld:view"] });
    expect(await mockEldService.snapshots(ctx)).toHaveLength(0);
    expect(await mockEldService.devices(ctx)).toHaveLength(0);
  });

  it("needs its own key for raw provider payloads", async () => {
    const ctx = contextFor(NORTHLINE_OWNER, { without: ["eld:raw:view"] });
    await expect(mockEldService.rawPayloads(ctx)).rejects.toBeInstanceOf(PermissionDeniedError);

    const full = contextFor(NORTHLINE_OWNER);
    expect((await mockEldService.rawPayloads(full)).length).toBeGreaterThan(0);
  });

  it("needs its own key to register a device or bind one", async () => {
    const viewer = contextFor(NORTHLINE_OWNER, {
      permissions: ["eld:view", "trucks:view", "drivers:view"],
    });
    await expect(mockEldService.connect(viewer, {
      providerId: "prov_mock_alpha", label: "x", transport: "webhook",
      freshnessExpectationMinutes: 15,
    })).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(mockEldService.bindDeviceToTruck(viewer, {
      deviceId: "dev_x", truckId: "truck_x",
    })).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("withholds engine diagnostics without eld:diagnostics:view", async () => {
    const withKey = await mockEldService.snapshots(contextFor(NORTHLINE_OWNER));
    expect(withKey.some((s) => s.diagnostics.length > 0)).toBe(true);

    const without = await mockEldService.snapshots(
      contextFor(NORTHLINE_OWNER, { without: ["eld:diagnostics:view"] }),
    );
    expect(without.every((s) => s.diagnostics.length === 0)).toBe(true);
  });
});

describe("what a screen is handed is already reconciled", () => {
  it("returns the derived connection state, never the stored one", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const connections = await mockEldService.connections(ctx);
    const dashboard = await mockEldService.dashboard(ctx);

    // A link that went quiet at four in the morning did not update itself to
    // say so. Handing a screen the stored value would put a row reading
    // "Connected" next to a count that says "offline".
    const states = new Set(connections.map((c) => c.state));
    expect(states.has("offline") || states.has("stale")).toBe(true);
    expect(connections.every((c) => c.stateReason && c.stateReason.length > 0)).toBe(true);

    const counted = Object.entries(dashboard.summary.connectionCounts)
      .flatMap(([state, n]) => Array.from({ length: n }, () => state))
      .sort();
    expect(counted).toEqual(dashboard.connections.map((c) => c.state).sort());
  });
});

describe("sensitive location", () => {
  it("reduces a position to its geocode without eld:location:precise:view", async () => {
    const precise = await mockEldService.snapshots(contextFor(NORTHLINE_OWNER));
    const withCoordinates = precise.find((s) => s.location.value?.latitude != null)!;
    expect(withCoordinates.location.value?.precise).toBe(true);

    const reduced = await mockEldService.snapshots(
      contextFor(NORTHLINE_OWNER, { without: ["eld:location:precise:view"] }),
    );
    const same = reduced.find((s) => s.truckId === withCoordinates.truckId)!;
    expect(same.location.value?.precise).toBe(false);
    expect(same.location.value?.latitude).toBeUndefined();
    // The city survives. A withheld coordinate is not a withheld observation —
    // "near Lafayette" is still operationally true and still useful.
    expect(same.location.value?.city).toBe(withCoordinates.location.value?.city);
  });
});

describe("cross-organization isolation", () => {
  it("never serves one carrier's devices or events to another", async () => {
    const northline = await mockEldService.devices(contextFor(NORTHLINE_OWNER));
    const baxter = await mockEldService.devices(contextFor(BAXTER_OWNER));
    expect(northline.length).toBeGreaterThan(0);
    expect(baxter.length).toBeGreaterThan(0);

    const nlIds = new Set(northline.map((d) => d.device.id));
    expect(baxter.some((d) => nlIds.has(d.device.id))).toBe(false);

    const nlEvents = await mockEldService.events(contextFor(NORTHLINE_OWNER), { limit: 500 });
    expect(nlEvents.every((e) => e.organizationId === "org_northline")).toBe(true);
  });

  it("answers a device from another organization as not found", async () => {
    const [device] = await mockEldService.devices(contextFor(NORTHLINE_OWNER));
    // Unknown and forbidden are the same answer. Anything else turns an id
    // field into a directory of other carriers' hardware.
    await expect(mockEldService.device(contextFor(BAXTER_OWNER), device.device.id))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("dispatch workspaces see only what was explicitly shared", () => {
  it("gives a dispatch organization nothing it was not granted", async () => {
    const summit = contextFor(SUMMIT_OWNER);
    const snapshots = await mockEldService.snapshots(summit);
    // Summit dispatches two of Northline's units. It was granted telemetry on
    // ONE of them, so "explicitly shared" is visibly per-truck.
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].truckUnit).toBe("111");
  });

  it("shares operational signals, not the carrier's hardware or its links", async () => {
    const summit = contextFor(SUMMIT_OWNER);
    expect(await mockEldService.devices(summit)).toHaveLength(0);
    expect(await mockEldService.connections(summit)).toHaveLength(0);
    expect(await mockEldService.rawPayloads(summit)).toHaveLength(0);
  });

  it("says a device was withheld rather than reporting there is none", async () => {
    const [snapshot] = await mockEldService.snapshots(contextFor(SUMMIT_OWNER));
    // "No device" and "a device you may not know about" are different facts.
    // One empty field cannot say both, so the snapshot says which.
    expect(snapshot.deviceId).toBeUndefined();
    expect(snapshot.deviceWithheld).toBe(true);
  });

  it("counts the shared trucks' signals rather than reporting zero", async () => {
    const dashboard = await mockEldService.dashboard(contextFor(SUMMIT_OWNER));
    const stream = await mockEldService.events(contextFor(SUMMIT_OWNER), { limit: 500 });
    expect(stream.length).toBeGreaterThan(0);
    // A dashboard reporting zero next to a stream full of rows is exactly the
    // disagreement this module exists to prevent.
    expect(dashboard.summary.eventsLast24h).toBeGreaterThan(0);
  });

  it("never names the driver to a dispatch workspace", async () => {
    const [snapshot] = await mockEldService.snapshots(contextFor(SUMMIT_OWNER));
    expect(snapshot.driverName).toBeUndefined();
    expect(snapshot.driverProfileId).toBeUndefined();
    expect(snapshot.hos).toBeUndefined();
  });

  it("honours the signal classes on the grant, not the relationship", async () => {
    // Meridian was granted position AND meters on A-12, and never diagnostics.
    const meridian = contextFor(MERIDIAN_DISPATCHER);
    const [snapshot] = await mockEldService.snapshots(meridian);
    expect(snapshot.truckUnit).toBe("A-12");
    expect(snapshot.location.value).toBeDefined();
    expect(snapshot.odometer.value).toBeDefined();
    expect(snapshot.diagnostics).toHaveLength(0);
  });

  it("refuses to let a dispatch workspace re-share what it was given", async () => {
    const summit = contextFor(SUMMIT_OWNER);
    const [snapshot] = await mockEldService.snapshots(summit);
    await expect(mockEldService.grantShare(summit, {
      viewerOrganizationId: "org_meridian",
      truckId: snapshot.truckId,
      signalClasses: ["position"],
    })).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("stops serving a share the moment the underlying relationship is gone", async () => {
    // The fleet layer is authoritative about existence. A grant for a truck it
    // no longer returns produces nothing, which is what stops a stale share
    // from outliving the relationship it was made under.
    const summit = contextFor(SUMMIT_OWNER, { without: ["trucks:view"] });
    expect(await mockEldService.snapshots(summit)).toHaveLength(0);
  });
});

describe("driver privacy", () => {
  it("shows a driver the truck they are on and nothing else", async () => {
    const driver = contextFor(CASCADE_DRIVER);
    const devices = await mockEldService.devices(driver);
    expect(devices).toHaveLength(1);
    expect(devices[0].truckUnit).toBe("47");

    const snapshots = await mockEldService.snapshots(driver);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].truckUnit).toBe("47");
  });

  it("gives a driver their own clock and never another driver's", async () => {
    const driver = contextFor(CASCADE_DRIVER);
    const [snapshot] = await mockEldService.snapshots(driver);
    expect(snapshot.hos?.value).toBeDefined();
    expect(snapshot.hos?.driverProfileId).toBe("drv_cascade_0192");

    const hosEvents = await mockEldService.events(driver, { kinds: ["hos_summary"], limit: 200 });
    expect(hosEvents.length).toBeGreaterThan(0);
    expect(hosEvents.every((e) => e.attribution.driverProfileId === "drv_cascade_0192")).toBe(true);

    const hosSignals = (await mockEldService.signals(driver, 500))
      .filter((s) => s.target === "hos");
    expect(hosSignals.every((s) => s.attribution.driverProfileId === "drv_cascade_0192")).toBe(true);
  });

  it("keeps raw provider payloads away from a driver membership entirely", async () => {
    const driver = contextFor(CASCADE_DRIVER, { permissions: [
      "eld:view", "eld:raw:view", "trucks:view",
    ] });
    expect(await mockEldService.rawPayloads(driver)).toHaveLength(0);
  });
});

describe("operating authority", () => {
  it("keeps two carriers' telemetry apart even on a truck they are both approved on", async () => {
    // Being approved on a truck is not being the carrier that collected data
    // from it. Each organization reads its own partition and only its own, so
    // a shared relationship never becomes a shared event stream.
    const baxter = await mockEldService.snapshots(contextFor(BAXTER_OWNER));
    const northline = await mockEldService.snapshots(contextFor(NORTHLINE_OWNER));
    const northlineByTruck = new Map(northline.map((s) => [s.truckId, s]));

    const sharedTrucks = baxter.filter((s) => northlineByTruck.has(s.truckId));
    expect(sharedTrucks.length).toBeGreaterThan(0);
    for (const seenByBaxter of sharedTrucks) {
      expect(seenByBaxter.deviceId).toBeUndefined();
      expect(seenByBaxter.location.quality).toBe("missing");
      expect(seenByBaxter.eventsConsidered).toBe(0);
    }
  });

  it("drops a truck that is locked under another carrier's operating authority", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const scopes = eldScopesFor(ctx);
    const locked = fleetSync(truckContextFrom(ctx)).filter((t) => t.lockedByAnotherCarrier);
    for (const truck of locked) {
      expect(scopes.some((s) => s.truckId === truck.truckId)).toBe(false);
      await expect(mockEldService.snapshot(ctx, truck.truckId))
        .rejects.toBeInstanceOf(NotFoundError);
    }
  });

  it("records the authority status that was in force, even when it was not active", async () => {
    const events = await mockEldService.events(contextFor(NORTHLINE_OWNER), { limit: 50 });
    // Recorded on every event, whatever it said. A signal produced under
    // inactive authority is still kept, and still says so, forever.
    expect(events.every((e) => e.attribution.operatingAuthorityStatus !== undefined)).toBe(true);
  });
});
