import { describe, expect, it } from "vitest";
import type { FleetTruck } from "@/types/fleet-truck";
import { tileValue, truckCounts } from "./owner-overview";

const truck = (extras: Partial<FleetTruck>): FleetTruck => ({ id: "t", ...extras }) as FleetTruck;

describe("owner overview", () => {
  it("counts working, available and parked trucks, without archived ones", () => {
    expect(
      truckCounts([
        truck({ operationalStatus: "LOADED_IN_TRANSIT" }),
        truck({ operationalStatus: "LOAD_BOOKED" }),
        truck({ operationalStatus: "AVAILABLE" }),
        truck({ operationalStatus: "MAINTENANCE" }),
        truck({ operationalStatus: "UNAVAILABLE" }),
        truck({ operationalStatus: "AVAILABLE", archivedAt: "2026-01-01T00:00:00Z" }),
        truck({}),
      ]),
    ).toEqual({ total: 6, onTrip: 2, available: 1, maintenance: 1, unavailable: 1 });
  });

  it("shows a dash while a number is unknown", () => {
    expect(tileValue(undefined)).toBe("—");
    expect(tileValue(1200)).toBe("1,200");
  });
});
