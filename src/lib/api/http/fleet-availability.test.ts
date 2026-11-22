import { describe, expect, it } from "vitest";
import { toTruckAvailability } from "./fleet-availability";

/** From ../antcolos/docs/requirements/fleet-api-contract.md §Truck availability (plan 47). */
const CONTRACT_ROW = {
  truckId: "a0b1c2d3-0000-4000-8000-000000000001",
  unitNumber: "104",
  equipmentType: "DRY_VAN",
  operationalStatus: "LOADED_IN_TRANSIT",
  bucket: "WITHIN_5H",
  estimatedEmptyAt: "2026-11-17T22:00:00.000Z",
  emptyCity: "Dallas",
  emptyState: "TX",
  activeLoadId: "c1d2e3f4-0000-4000-8000-000000000002",
};

describe("fleet availability mapper", () => {
  it("maps the contract example", () => {
    expect(toTruckAvailability(CONTRACT_ROW)).toEqual({ ...CONTRACT_ROW });
  });

  it("keeps an empty truck and an unknown bucket visible", () => {
    expect(
      toTruckAvailability({ ...CONTRACT_ROW, bucket: "TELEPORTING", estimatedEmptyAt: null, emptyCity: null, emptyState: null, activeLoadId: null }),
    ).toMatchObject({ bucket: "UNKNOWN", estimatedEmptyAt: null, emptyCity: null, activeLoadId: null });
    expect(toTruckAvailability({ ...CONTRACT_ROW, equipmentType: "SPACESHIP" }).equipmentType).toBeUndefined();
  });
});
