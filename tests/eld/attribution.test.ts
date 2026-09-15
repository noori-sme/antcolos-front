import { beforeEach, describe, expect, it } from "vitest";
import { mockEldService } from "@/lib/api/mock/eld";
import {
  listBindingHistory, listDevices, listEvents, listVehicleBindings, resetEldRegistry,
} from "@/lib/api/mock/eld-registry";
import { resetTruckRegistry } from "@/lib/api/mock/truck-registry";
import { resetTrailerRegistry } from "@/lib/api/mock/trailer-registry";
import { NORTHLINE_OWNER, contextFor } from "../helpers/context";

/**
 * The property this module exists to guarantee: a binding change does not
 * rewrite history.
 *
 * Every event is attributed AT EVENT TIME to the truck, driver, carrier,
 * operating authority and load that were in force then. Re-binding a device
 * tomorrow, moving a driver, or ending a lease must not reach backwards and
 * relabel last month — because "which truck was this about" is the question
 * every derived number in the product depends on.
 */

const ORG = "org_northline";

beforeEach(() => {
  resetTruckRegistry();
  resetTrailerRegistry();
  resetEldRegistry();
});

const deviceByExternalId = (externalId: string) => {
  const device = listDevices(ORG).find((d) => d.externalRef.externalId === externalId);
  if (!device) throw new Error(`fixture device ${externalId} missing`);
  return device;
};

describe("attribution is resolved from dated bindings, not from what is true now", () => {
  it("attributes an event to the truck the device was bound to at that moment", () => {
    const device = deviceByExternalId("AL-88202");
    const events = listEvents(ORG, { deviceId: device.id, limit: 200 });
    expect(events.length).toBeGreaterThan(0);
    // Every event this device produced falls inside its CURRENT interval (107),
    // because the fixtures only deliver recent data for it — but the earlier
    // interval on unit 104 is still on file and still closed.
    expect(events.every((e) => e.attribution.truckUnitSnapshot === "107")).toBe(true);

    const bindings = listVehicleBindings(ORG, device.id);
    expect(bindings).toHaveLength(2);
    expect(bindings.some((b) => b.truckUnitSnapshot === "104" && b.effectiveTo)).toBe(true);
  });

  it("names the gaps instead of guessing at a driver", () => {
    // Unit 111's gateway is bound to a truck and to nobody. Attribution says so
    // rather than reaching for whoever happens to be on 111 today.
    const device = deviceByExternalId("AL-88203");
    const event = listEvents(ORG, { deviceId: device.id, limit: 10 })[0];
    expect(event.attribution.truckUnitSnapshot).toBe("111");
    expect(event.attribution.driverProfileId).toBeUndefined();
    expect(event.attribution.gaps.join(" ")).toMatch(/driver-to-device binding/);
  });

  it("snapshots the carrier and its operating authority onto every event", () => {
    const event = listEvents(ORG, { limit: 10 })[0];
    expect(event.attribution.carrierOrganizationId).toBe(ORG);
    expect(event.attribution.carrierNameSnapshot).toBe("Northline Freight");
    expect(event.attribution.operatingAuthorityStatus).toBeDefined();
  });

  it("does not rewrite historical telemetry when a binding changes", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const device = deviceByExternalId("AL-88201");

    const before = listEvents(ORG, { deviceId: device.id, limit: 200 });
    expect(before.length).toBeGreaterThan(0);
    const beforeUnits = before.map((e) => e.attribution.truckUnitSnapshot);
    expect(new Set(beforeUnits)).toEqual(new Set(["104"]));

    // Move the device to a different truck, from now.
    const otherTruck = before[0].attribution.truckId!;
    const target = (await mockEldService.snapshots(ctx))
      .find((s) => s.truckId !== otherTruck)!;
    await mockEldService.bindDeviceToTruck(ctx, {
      deviceId: device.id,
      truckId: target.truckId,
      note: "Gateway moved.",
    });

    const after = listEvents(ORG, { deviceId: device.id, limit: 200 })
      .filter((e) => before.some((b) => b.id === e.id));
    // Same events, same attribution. Not one of them now claims to be about the
    // new truck.
    expect(after.map((e) => e.attribution.truckUnitSnapshot))
      .toEqual(before.map((e) => e.attribution.truckUnitSnapshot));
  });
});

describe("bindings are intervals, and the history is immutable", () => {
  it("closes the previous interval instead of replacing it", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const device = deviceByExternalId("AL-88201");
    const originals = listVehicleBindings(ORG, device.id);
    const live = originals.find((b) => !b.effectiveTo)!;

    const snapshots = await mockEldService.snapshots(ctx);
    const target = snapshots.find((s) => s.truckId !== live.truckId)!;
    await mockEldService.bindDeviceToTruck(ctx, { deviceId: device.id, truckId: target.truckId });

    const after = listVehicleBindings(ORG, device.id);
    expect(after.length).toBe(originals.length + 1);

    const closed = after.find((b) => b.id === live.id)!;
    expect(closed.effectiveTo).toBeDefined();
    expect(closed.endReason).toBe("superseded");
    // The row itself is otherwise untouched: same id, same start, same truck.
    expect(closed.truckId).toBe(live.truckId);
    expect(closed.effectiveFrom).toBe(live.effectiveFrom);
  });

  it("writes an audit entry for every binding change, kept apart from the bindings", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const device = deviceByExternalId("AL-88203");
    const before = listBindingHistory(ORG).length;

    const snapshots = await mockEldService.snapshots(ctx);
    await mockEldService.bindDeviceToTruck(ctx, {
      deviceId: device.id, truckId: snapshots[0].truckId,
    });

    const after = listBindingHistory(ORG);
    expect(after.length).toBeGreaterThan(before);
    expect(after[0].actorName).toBe("Sam Murtaza");
    expect(after[0].action).toMatch(/bound|ended/);
  });

  it("ends a binding without removing it", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const device = deviceByExternalId("AL-88201");
    const live = listVehicleBindings(ORG, device.id).find((b) => !b.effectiveTo)!;

    const ended = await mockEldService.endVehicleBinding(ctx, live.id, "unbound");
    expect(ended.effectiveTo).toBeDefined();
    expect(listVehicleBindings(ORG, device.id).some((b) => b.id === live.id)).toBe(true);
  });

  it("treats binding intervals as half-open so one instant belongs to one truck", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const device = deviceByExternalId("AL-88201");
    const snapshots = await mockEldService.snapshots(ctx);
    const previous = listVehicleBindings(ORG, device.id).find((b) => !b.effectiveTo)!;

    const target = snapshots.find((s) => s.truckId !== previous.truckId)!;
    const next = await mockEldService.bindDeviceToTruck(ctx, {
      deviceId: device.id, truckId: target.truckId,
    });
    const closed = listVehicleBindings(ORG, device.id).find((b) => b.id === previous.id)!;

    // The old interval ends exactly where the new one begins. Half-open means
    // the shared instant belongs to the new binding and to nothing else.
    expect(closed.effectiveTo).toBe(next.effectiveFrom);
  });
});
