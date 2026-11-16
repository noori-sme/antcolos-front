import { describe, expect, it } from "vitest";
import type { LoadRecordStop, LoadTimelineEntry } from "@/types/load-record";
import {
  equipmentLabel, money, routeSummary, stopWindow, timelineSentence,
} from "./format";

const stop = (extras: Partial<LoadRecordStop> = {}): LoadRecordStop => ({
  sequence: 1,
  type: "pickup",
  facilityName: null,
  addressLine1: null,
  city: "Joliet",
  state: "IL",
  postalCode: null,
  timezone: "America/Chicago",
  scheduledDate: "2026-11-25",
  windowStart: null,
  windowEnd: null,
  appointmentConfirmed: false,
  contactName: null,
  contactPhone: null,
  notes: null,
  ...extras,
});

const entry = (extras: Partial<LoadTimelineEntry>): LoadTimelineEntry => ({
  id: "e",
  type: "load.status_changed",
  occurredAt: "2026-11-15T14:05:00.000Z",
  source: "api",
  actor: null,
  from: null,
  to: null,
  reason: null,
  party: null,
  tonuAmount: null,
  changedFields: [],
  truckId: null,
  driverUserId: null,
  ...extras,
});

describe("load record formatting", () => {
  it("labels equipment codes and money", () => {
    expect(equipmentLabel("DRY_VAN")).toBe("Dry van");
    expect(equipmentLabel("STEP_DECK")).toBe("Step deck");
    expect(money("2750.00")).toBe("$2,750.00");
    expect(money(null)).toBeNull();
  });

  it("shows a window in the stop's own timezone", () => {
    expect(
      stopWindow(
        stop({
          windowStart: "2026-11-25T14:00:00.000Z",
          windowEnd: "2026-11-25T16:00:00.000Z",
        }),
      ),
    ).toBe("08:00–10:00 CST");
    expect(stopWindow(stop({ windowStart: "2026-11-25T14:00:00.000Z" }))).toBe("08:00 CST");
    expect(stopWindow(stop())).toBeNull();
  });

  it("summarizes the route as first pickup → last delivery", () => {
    expect(
      routeSummary([
        stop(),
        stop({ sequence: 2, type: "delivery", city: "Newark", state: "NJ" }),
      ]),
    ).toBe("Joliet, IL → Newark, NJ");
    expect(routeSummary([])).toBe("No stops");
  });

  it("writes a sentence for each known event and names unknown ones", () => {
    expect(timelineSentence(entry({ from: "en_route_pickup", to: "arrived_pickup" }))).toBe(
      "En route to pickup → At pickup",
    );
    expect(
      timelineSentence(entry({ type: "load.status_corrected", from: "loaded", to: "arrived_pickup" })),
    ).toBe("Status corrected: Loaded → At pickup");
    expect(
      timelineSentence(entry({ type: "load.cancelled", party: "shipper", tonuAmount: "150.00" })),
    ).toBe("Cancelled by the shipper · TONU $150.00");
    expect(timelineSentence(entry({ type: "load.created" }))).toBe("Load created");
    expect(timelineSentence(entry({ type: "load.updated", changedFields: ["notes", "weightLbs"] }))).toBe(
      "Details edited: notes, weightLbs",
    );
    expect(timelineSentence(entry({ type: "load.truck_assigned" }))).toBe("Truck booked for this load");
    expect(timelineSentence(entry({ type: "load.driver_rejected" }))).toBe("Driver turned the load down");
    expect(timelineSentence(entry({ type: "load.driver_accepted" }))).toBe("Driver accepted the load");
    expect(timelineSentence(entry({ type: "load.pod_received" }))).toBe("load.pod_received");
  });
});
