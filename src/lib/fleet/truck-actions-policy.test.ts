import { describe, expect, it } from "vitest";
import type { FleetTruck } from "@/types/fleet-truck";
import { isOwnedByThisOrganization, truckActionsFor } from "./truck-actions-policy";

const ORG = "7a1b2c3d-4e5f-6789-a0b1-c2d3e4f56789";
const OTHER = "8b2c3d4e-5f60-7891-b0c1-d2e3f4a56790";

function truck(overrides: Partial<FleetTruck> = {}): FleetTruck {
  return {
    id: "t1",
    vin: "1HGBH41JXMN109186",
    legalOwner: { ownershipId: "own1", ownerType: "ORGANIZATION", ownerOrganizationId: ORG },
    operating: { operatingId: "op1", organizationId: ORG, operationalStatus: "UNAVAILABLE" },
    ...overrides,
  };
}
const ALL = { edit: true, delete: true };

describe("isOwnedByThisOrganization", () => {
  it("is true when the owner org is this org's operating org", () => {
    expect(isOwnedByThisOrganization(truck())).toBe(true);
  });

  it("is false for another carrier, a member owner, or no operating row", () => {
    expect(
      isOwnedByThisOrganization(
        truck({ legalOwner: { ownerType: "ORGANIZATION", ownerOrganizationId: OTHER } }),
      ),
    ).toBe(false);
    expect(
      isOwnedByThisOrganization(
        truck({ legalOwner: { ownerType: "USER", ownerUserId: "u1", ownerOrganizationId: null } }),
      ),
    ).toBe(false);
    expect(isOwnedByThisOrganization(truck({ operating: null }))).toBe(false);
  });
});

describe("truckActionsFor", () => {
  it("offers everything to an owner with edit and delete", () => {
    expect(truckActionsFor(truck(), ALL)).toEqual({
      status: true, edit: true, handOff: true, leave: true, archive: true,
      archiveBlockedReason: null,
    });
  });

  it("refuses everything without permissions", () => {
    const actions = truckActionsFor(truck(), { edit: false, delete: false });
    expect(Object.values(actions).filter((v) => v === true)).toEqual([]);
  });

  it("does not offer hand-off or archive to an operating carrier that is not the owner", () => {
    const actions = truckActionsFor(
      truck({ legalOwner: { ownerType: "ORGANIZATION", ownerOrganizationId: OTHER } }),
      ALL,
    );
    expect(actions).toMatchObject({ status: true, edit: true, leave: true, handOff: false, archive: false });
  });

  it("does not offer archive without trucks:delete", () => {
    expect(truckActionsFor(truck(), { edit: true, delete: false }).archive).toBe(false);
  });

  it("blocks archive while the truck is AVAILABLE", () => {
    const actions = truckActionsFor(
      truck({ operating: { operatingId: "op1", organizationId: ORG, operationalStatus: "AVAILABLE" } }),
      ALL,
    );
    expect(actions.archive).toBe(true);
    expect(actions.archiveBlockedReason).toMatch(/unavailable first/);
  });

  it("offers nothing on an archived truck", () => {
    const actions = truckActionsFor(truck({ archivedAt: "2026-11-01T00:00:00.000Z" }), ALL);
    expect(Object.values(actions).filter((v) => v === true)).toEqual([]);
  });
});
