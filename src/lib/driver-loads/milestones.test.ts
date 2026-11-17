import { describe, expect, it } from "vitest";
import type { DriverLoad } from "@/types/driver-load";
import type { LoadRecordStop } from "@/types/load-record";
import {
  activeLoad, canUpload, currentStop, isOnTrip, milestoneConfirm, milestoneLabel, stopName,
} from "./milestones";

const stop = (sequence: number, type: "pickup" | "delivery", city: string, extras: Partial<LoadRecordStop> = {}): LoadRecordStop => ({
  sequence, type, facilityName: null, addressLine1: null, city, state: "IL", postalCode: null,
  timezone: "America/Chicago", scheduledDate: null, windowStart: null, windowEnd: null,
  appointmentConfirmed: false, contactName: null, contactPhone: null, notes: null,
  actualArrivalAt: null, actualCompletedAt: null, actualDepartureAt: null, ...extras,
});
const stops = [stop(1, "pickup", "Joliet"), stop(2, "pickup", "Aurora"), stop(3, "delivery", "Peoria")];

const load = (extras: Partial<DriverLoad> = {}): DriverLoad => ({
  id: "l1", status: "driver_accepted", statusChangedAt: "", brokerLoadNumber: "NS-1",
  referenceNumbers: [], equipmentType: "DRY_VAN", weightLbs: null, commodity: null,
  specialInstructions: null, requiresBrokerRelease: false, truckId: null, driverAssignedAt: null,
  driverAcceptedAt: null, stops, documents: [], nextMilestones: [], ...extras,
});

describe("driver milestones (plan 16)", () => {
  it("numbers stops within their type", () => {
    expect(stops.map((s) => stopName(stops, s.sequence))).toEqual(["Pickup 1", "Pickup 2", "Delivery 1"]);
    expect(stopName(stops, 9)).toBe("Stop 9");
  });

  it.each([
    [{ milestone: "start_trip", stopSequence: null }, "Start trip"],
    [{ milestone: "arrived", stopSequence: 2 }, "Arrived at pickup 2 · Aurora, IL"],
    [{ milestone: "loaded", stopSequence: 1 }, "Loaded at pickup 1"],
    [{ milestone: "awaiting_release", stopSequence: null }, "Waiting for broker release"],
    [{ milestone: "released", stopSequence: null }, "Cleared to depart"],
    [{ milestone: "departed", stopSequence: 2 }, "Departed pickup 2"],
    [{ milestone: "delivered", stopSequence: 3 }, "Delivered at delivery 1"],
  ] as const)("labels %o as %s", (next, label) => {
    expect(milestoneLabel(next, stops)).toBe(label);
  });

  it("explains what a confirmation records", () => {
    expect(milestoneConfirm({ milestone: "arrived", stopSequence: 3 }, stops)).toMatch(/delivery 1/);
    expect(milestoneConfirm({ milestone: "start_trip", stopSequence: null }, stops)).toMatch(/first pickup/);
  });

  it("shows the load on the road first", () => {
    const later = load({ id: "a", status: "driver_assigned" });
    const onRoad = load({ id: "b", status: "in_transit" });
    expect(activeLoad([later, onRoad])?.id).toBe("b");
    expect(activeLoad([later])?.id).toBe("a");
    expect(activeLoad([])).toBeNull();
    expect(isOnTrip("delivered")).toBe(false);
  });

  it("opens uploads when the backend takes them", () => {
    expect(canUpload("en_route_pickup", "bol")).toBe(false);
    expect(canUpload("arrived_pickup", "bol")).toBe(true);
    expect(canUpload("arrived_delivery", "pod")).toBe(false);
    expect(canUpload("delivered", "pod")).toBe(true);
  });

  it("finds the stop the driver is at or heading to", () => {
    const done = { actualArrivalAt: "x", actualCompletedAt: "x", actualDepartureAt: "x" };
    expect(currentStop(load({ stops: [stop(1, "pickup", "Joliet", done), stops[2]] }))?.sequence).toBe(3);
    expect(currentStop(load({ stops: [stop(1, "pickup", "Joliet", done)] }))).toBeNull();
  });
});
