import { describe, expect, it } from "vitest";
import {
  correctionTargets, stepActions, stepLabel, LOAD_TRIP,
} from "./status";

describe("load record status helpers", () => {
  it("offers the API's steps as actions, cancel apart, in trip order", () => {
    expect(stepActions(["cancelled", "arrived_pickup"])).toEqual({
      steps: ["arrived_pickup"],
      canCancel: true,
    });
    expect(stepActions([])).toEqual({ steps: [], canCancel: false });
  });

  it("names each step as the action a person takes", () => {
    expect(stepLabel("en_route_pickup")).toBe("Start trip to pickup");
    expect(stepLabel("awaiting_broker_release")).toBe("Waiting for broker release");
    expect(stepLabel("delivered")).toBe("Delivered");
  });

  it("offers only earlier trip states for a correction", () => {
    expect(correctionTargets("loaded")).toEqual([
      "arrived_pickup",
      "en_route_pickup",
      "driver_accepted",
      "driver_assigned",
      "rc_received",
      "booked",
    ]);
    expect(correctionTargets("in_transit")).not.toContain("awaiting_broker_release");
    expect(correctionTargets("in_transit", true)[0]).toBe("awaiting_broker_release");
    expect(correctionTargets("booked")).toEqual([]);
    expect(correctionTargets("cancelled")).toEqual([]);
  });

  it("keeps the trip in the backend's order", () => {
    expect(LOAD_TRIP[0]).toBe("booked");
    expect(LOAD_TRIP.at(-1)).toBe("invoice_ready");
    expect(LOAD_TRIP).not.toContain("cancelled");
  });
});
