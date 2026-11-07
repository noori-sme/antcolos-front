import { describe, expect, it, vi } from "vitest";
import {
  toTruckAssignmentRow, toTruckLookup, toTruckOperatingRow, toTruckOwnershipRow,
} from "./trucks";

/** Fixtures copied from ../antcolos/docs/requirements/fleet-api-contract.md. */
const CONTRACT_LOOKUP = {
  id: "aa11bb22-cc33-dd44-ee55-ff6677889900",
  vin: "1HGBH41JXMN109186",
  year: 2022,
  make: "Freightliner",
  model: "Cascadia",
  color: "White",
  equipmentType: "DRY_VAN",
  licensePlate: "8ABC123",
  licensePlateState: "CA",
  alreadyOnFleet: false,
  archived: false,
};

const CONTRACT_ASSIGNMENT_ROW = {
  id: "c1d2e3f4-1111-2222-3333-444455556666",
  truckId: "aa11bb22-cc33-dd44-ee55-ff6677889900",
  organizationId: "7a1b2c3d-4e5f-6789-a0b1-c2d3e4f56789",
  userId: "1a2b3c4d-5e6f-7890-abcd-ef1234567890",
  userName: "Jordan Lee",
  type: "DRIVER",
  coverage: null,
  status: "ASSIGNED",
  startAt: "2026-09-04T12:00:00.000Z",
  endAt: null,
  assignedByUserId: "9f8e7d6c-5b4a-3210-fedc-ba9876543210",
  endedByUserId: null,
  replacedByAssignmentId: null,
  createdAt: "2026-09-04T12:00:00.000Z",
};

const CONTRACT_OWNERSHIP_ROW = {
  id: "b0b1c2d3-e4f5-6789-a0b1-c2d3e4f56789",
  truckId: "aa11bb22-cc33-dd44-ee55-ff6677889900",
  ownershipId: "b0b1c2d3-e4f5-6789-a0b1-c2d3e4f56789",
  ownerType: "USER",
  ownerOrganizationId: null,
  ownerUserId: "1a2b3c4d-5e6f-7890-abcd-ef1234567890",
  ownershipType: "OWNER_OPERATOR",
  verificationStatus: "UNVERIFIED",
  startAt: "2026-09-07T10:00:00.000Z",
  endAt: null,
  createdByUserId: "9f8e7d6c-5b4a-3210-fedc-ba9876543210",
  endedByUserId: null,
};

const CONTRACT_OPERATING_ROW = {
  id: "d1e2f3a4-b5c6-7890-d1e2-f3a4b5c67890",
  truckId: "aa11bb22-cc33-dd44-ee55-ff6677889900",
  operatingId: "d1e2f3a4-b5c6-7890-d1e2-f3a4b5c67890",
  organizationId: "7a1b2c3d-4e5f-6789-a0b1-c2d3e4f56789",
  unitNumber: "104",
  homeTerminalCity: "Fresno",
  homeTerminalState: "CA",
  notes: "Prefers West Coast lanes",
  operationalStatus: "UNAVAILABLE",
  verificationStatus: "UNVERIFIED",
  startAt: "2026-09-07T10:00:00.000Z",
  endAt: "2026-11-05T10:00:00.000Z",
  createdByUserId: "9f8e7d6c-5b4a-3210-fedc-ba9876543210",
  endedByUserId: "9f8e7d6c-5b4a-3210-fedc-ba9876543210",
  createdAt: "2026-09-07T10:00:00.000Z",
};

describe("toTruckLookup (§1b)", () => {
  it("maps the contract example", () => {
    expect(toTruckLookup(CONTRACT_LOOKUP)).toEqual({
      id: CONTRACT_LOOKUP.id,
      vin: "1HGBH41JXMN109186",
      year: 2022,
      make: "Freightliner",
      model: "Cascadia",
      color: "White",
      equipmentType: "DRY_VAN",
      licensePlate: "8ABC123",
      licensePlateState: "CA",
      alreadyOnFleet: false,
      archived: false,
      unitNumber: undefined,
    });
  });

  it("keeps this org's unit number when already on the fleet, and maps nulls to undefined", () => {
    const lookup = toTruckLookup({
      ...CONTRACT_LOOKUP,
      alreadyOnFleet: true,
      unitNumber: "104",
      year: null,
      make: null,
      licensePlate: null,
    });
    expect(lookup).toMatchObject({ alreadyOnFleet: true, unitNumber: "104" });
    expect(lookup.year).toBeUndefined();
    expect(lookup.make).toBeUndefined();
    expect(lookup.licensePlate).toBeUndefined();
  });

  it("drops an unknown equipment type instead of casting it, and treats missing flags as false", () => {
    const lookup = toTruckLookup({ id: "x", vin: "V", equipmentType: "HOVERCRAFT" });
    expect(lookup.equipmentType).toBeUndefined();
    expect(lookup.alreadyOnFleet).toBe(false);
    expect(lookup.archived).toBe(false);
  });
});

describe("toTruckAssignmentRow (§Assignment row)", () => {
  it("maps the contract example (driver, no coverage)", () => {
    expect(toTruckAssignmentRow(CONTRACT_ASSIGNMENT_ROW)).toEqual({
      id: CONTRACT_ASSIGNMENT_ROW.id,
      truckId: CONTRACT_ASSIGNMENT_ROW.truckId,
      userId: CONTRACT_ASSIGNMENT_ROW.userId,
      userName: "Jordan Lee",
      type: "DRIVER",
      coverage: undefined,
      status: "ASSIGNED",
      startAt: "2026-09-04T12:00:00.000Z",
      endAt: null,
      assignedByUserId: CONTRACT_ASSIGNMENT_ROW.assignedByUserId,
      endedByUserId: null,
      replacedByAssignmentId: null,
      createdAt: "2026-09-04T12:00:00.000Z",
    });
  });

  it("maps a replaced dispatcher row and drops unknown enum values", () => {
    const row = toTruckAssignmentRow({
      ...CONTRACT_ASSIGNMENT_ROW,
      type: "DISPATCHER",
      coverage: "TEMPORARY",
      status: "REPLACED",
      endAt: "2026-10-01T00:00:00.000Z",
      replacedByAssignmentId: "new-row",
    });
    expect(row).toMatchObject({
      type: "DISPATCHER",
      coverage: "TEMPORARY",
      status: "REPLACED",
      endAt: "2026-10-01T00:00:00.000Z",
      replacedByAssignmentId: "new-row",
    });
    expect(toTruckAssignmentRow({ ...CONTRACT_ASSIGNMENT_ROW, status: "PAUSED" }).status)
      .toBeUndefined();
  });
});

describe("toTruckOwnershipRow (§12)", () => {
  it("maps a user-owned row from the contract shape", () => {
    expect(toTruckOwnershipRow(CONTRACT_OWNERSHIP_ROW)).toMatchObject({
      id: CONTRACT_OWNERSHIP_ROW.id,
      ownershipId: CONTRACT_OWNERSHIP_ROW.ownershipId,
      ownerType: "USER",
      ownerOrganizationId: null,
      ownerUserId: CONTRACT_OWNERSHIP_ROW.ownerUserId,
      ownershipType: "OWNER_OPERATOR",
      endAt: null,
      endedByUserId: null,
    });
  });
});

describe("toTruckOperatingRow (§11)", () => {
  it("maps a closed operating row from the contract shape", () => {
    expect(toTruckOperatingRow(CONTRACT_OPERATING_ROW)).toMatchObject({
      id: CONTRACT_OPERATING_ROW.id,
      operatingId: CONTRACT_OPERATING_ROW.operatingId,
      unitNumber: "104",
      operationalStatus: "UNAVAILABLE",
      endAt: "2026-11-05T10:00:00.000Z",
      endedByUserId: CONTRACT_OPERATING_ROW.endedByUserId,
    });
  });
});

describe("httpTrucksService requests", () => {
  const ctx = { organizationId: "org-1" } as never;

  async function load() {
    vi.resetModules();
    const client = {
      get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(),
    };
    vi.doMock("../client", () => ({ apiClient: client }));
    const { httpTrucksService } = await import("./trucks");
    return { client, service: httpTrucksService };
  }

  it("returns null for an unknown VIN instead of throwing", async () => {
    const { client, service } = await load();
    client.get.mockResolvedValue({ status: 404, data: { message: "Truck not found" } });

    await expect(service.lookupByVin(ctx, "1HGBH41JXMN109186")).resolves.toBeNull();
    const [path, config] = client.get.mock.calls[0];
    expect(path).toBe("/trucks/lookup");
    expect(config.params).toEqual({ vin: "1HGBH41JXMN109186" });
    expect(config.validateStatus(404)).toBe(true);
    expect(config.validateStatus(500)).toBe(false);
  });

  it("sends the Idempotency-Key on create", async () => {
    const { client, service } = await load();
    client.post.mockResolvedValue({ status: 201, data: { id: "t1", vin: "V" } });

    await service.create(
      ctx,
      { vin: "V", unitNumber: "104", equipmentType: "DRY_VAN" },
      "key-1",
    );
    expect(client.post).toHaveBeenCalledWith(
      "/trucks",
      { vin: "V", unitNumber: "104", equipmentType: "DRY_VAN" },
      { headers: { "Idempotency-Key": "key-1" } },
    );
  });

  it("posts status commands to the contract paths with an optional reason", async () => {
    const { client, service } = await load();
    client.post.mockResolvedValue({ status: 201, data: { id: "t1" } });

    await service.setStatus(ctx, "t1", "MAINTENANCE", "Annual inspection", "k");
    await service.setStatus(ctx, "t1", "AVAILABLE", undefined, "k2");
    expect(client.post.mock.calls[0]).toEqual([
      "/trucks/t1/maintenance",
      { reason: "Annual inspection" },
      { headers: { "Idempotency-Key": "k" } },
    ]);
    expect(client.post.mock.calls[1][0]).toBe("/trucks/t1/available");
    expect(client.post.mock.calls[1][1]).toEqual({});
  });

  it("never sends coverage for a DRIVER assignment (the contract rejects it)", async () => {
    const { client, service } = await load();
    client.post.mockResolvedValue({ status: 201, data: CONTRACT_ASSIGNMENT_ROW });

    await service.assign(
      ctx,
      "t1",
      { userId: "u1", type: "DRIVER", coverage: "PRIMARY" },
      "k",
    );
    await service.assign(
      ctx,
      "t1",
      { userId: "u2", type: "DISPATCHER", coverage: "TEMPORARY" },
      "k2",
    );
    expect(client.post.mock.calls[0][1]).toEqual({ userId: "u1", type: "DRIVER" });
    expect(client.post.mock.calls[1][1]).toEqual({
      userId: "u2", type: "DISPATCHER", coverage: "TEMPORARY",
    });
  });

  it("uses the replace, remove, end-operating and ownership paths", async () => {
    const { client, service } = await load();
    client.post.mockResolvedValue({ status: 201, data: {} });
    client.delete.mockResolvedValue({ status: 200, data: "" });
    client.patch.mockResolvedValue({ status: 200, data: { id: "t1" } });

    await service.replaceAssignment(ctx, "t1", "a1", { userId: "u3" }, "k1");
    await service.removeAssignment(ctx, "t1", "a1", "k2");
    await service.endOperating(ctx, "t1", "op1", "k3");
    await service.replaceOwnership(
      ctx, "t1", "own1", { ownerType: "USER", ownerUserId: "u4" }, "k4",
    );
    await service.update(ctx, "t1", { unitNumber: "105", notes: null });
    await service.archive(ctx, "t1");

    expect(client.post.mock.calls.map((c) => c[0])).toEqual([
      "/trucks/t1/assignments/a1/replace",
      "/trucks/t1/assignments/a1/remove",
      "/trucks/t1/operating-carriers/op1/end",
      "/trucks/t1/ownership/own1/replace",
    ]);
    expect(client.post.mock.calls.map((c) => c[2].headers["Idempotency-Key"])).toEqual([
      "k1", "k2", "k3", "k4",
    ]);
    expect(client.patch).toHaveBeenCalledWith("/trucks/t1", { unitNumber: "105", notes: null });
    expect(client.delete).toHaveBeenCalledWith("/trucks/t1");
  });
});
