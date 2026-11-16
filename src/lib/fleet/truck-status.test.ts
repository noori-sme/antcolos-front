import { describe, expect, it } from "vitest";
import { isOnTrip, manualStatusTargets } from "./truck-status";

describe("truck operational status (plan 15)", () => {
  it("offers the manual moves the backend allows", () => {
    expect(manualStatusTargets("AVAILABLE")).toEqual(["UNAVAILABLE", "MAINTENANCE"]);
    expect(manualStatusTargets("MAINTENANCE")).toEqual(["AVAILABLE", "UNAVAILABLE"]);
    expect(manualStatusTargets("DELIVERED")).toEqual(["AVAILABLE", "UNAVAILABLE", "MAINTENANCE"]);
    expect(manualStatusTargets(undefined)).toEqual(["AVAILABLE", "UNAVAILABLE", "MAINTENANCE"]);
  });

  it("offers nothing while the truck is on a load", () => {
    for (const status of ["LOAD_BOOKED", "EN_ROUTE_PICKUP", "AT_PICKUP", "LOADED_IN_TRANSIT", "AT_DELIVERY"] as const) {
      expect(manualStatusTargets(status)).toEqual([]);
      expect(isOnTrip(status)).toBe(true);
    }
    expect(isOnTrip("DELIVERED")).toBe(false);
    expect(isOnTrip("AVAILABLE")).toBe(false);
  });
});
