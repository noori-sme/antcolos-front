import { describe, expect, it } from "vitest";
import { toTruck, toTruckPage } from "./trucks";

/** Copied from ../antcolos/docs/requirements/fleet-api-contract.md §Truck. */
const CONTRACT_TRUCK = {
  id: "aa11bb22-cc33-dd44-ee55-ff6677889900",
  vin: "1HGBH41JXMN109186",
  licensePlate: "8ABC123",
  licensePlateState: "CA",
  year: 2022,
  make: "Freightliner",
  model: "Cascadia",
  color: "White",
  equipmentType: "DRY_VAN",
  trailerLengthFt: 53,
  trailerNumber: "TRL-104",
  payloadLbs: 45000,
  gvwrLbs: 80000,
  registrationExpiresAt: "2027-03-31T00:00:00.000Z",
  insuranceExpiresAt: "2027-01-15T00:00:00.000Z",
  eldProvider: "Samsara",
  eldDeviceId: "eld-104",
  fuelType: "DIESEL",
  axleCount: 3,
  cabType: "SLEEPER",
  archivedAt: null,
  legalOwner: {
    ownershipId: "b0b1c2d3-e4f5-6789-a0b1-c2d3e4f56789",
    ownerType: "ORGANIZATION",
    ownerOrganizationId: "7a1b2c3d-4e5f-6789-a0b1-c2d3e4f56789",
    ownerUserId: null,
    ownershipType: "COMPANY",
    verificationStatus: "UNVERIFIED",
    startAt: "2026-09-07T10:00:00.000Z",
    endAt: null,
  },
  operating: {
    operatingId: "d1e2f3a4-b5c6-7890-d1e2-f3a4b5c67890",
    organizationId: "7a1b2c3d-4e5f-6789-a0b1-c2d3e4f56789",
    unitNumber: "104",
    homeTerminalCity: "Fresno",
    homeTerminalState: "CA",
    notes: "Prefers West Coast lanes",
    operationalStatus: "UNAVAILABLE",
    verificationStatus: "UNVERIFIED",
    startAt: "2026-09-07T10:00:00.000Z",
    endAt: null,
  },
  unitNumber: "104",
  homeTerminalCity: "Fresno",
  homeTerminalState: "CA",
  notes: "Prefers West Coast lanes",
  ownershipType: "COMPANY",
  operationalStatus: "UNAVAILABLE",
  currentDriver: null,
  currentDispatchers: [],
  createdByUserId: "9f8e7d6c-5b4a-3210-fedc-ba9876543210",
  updatedByUserId: "9f8e7d6c-5b4a-3210-fedc-ba9876543210",
  source: "api",
  createdAt: "2026-09-07T10:00:00.000Z",
  updatedAt: "2026-09-07T10:00:00.000Z",
};

/** Copied from the contract's §2 list example (abbreviated item). */
const CONTRACT_LIST = {
  data: [
    {
      id: "aa11bb22-cc33-dd44-ee55-ff6677889900",
      vin: "1HGBH41JXMN109186",
      unitNumber: "104",
      equipmentType: "DRY_VAN",
      operationalStatus: "AVAILABLE",
      currentDriver: {
        assignmentId: "c1d2e3f4-1111-2222-3333-444455556666",
        userId: "1a2b3c4d-5e6f-7890-abcd-ef1234567890",
        name: "Jordan Lee",
        startAt: "2026-09-04T12:00:00.000Z",
      },
      currentDispatchers: [],
    },
  ],
  meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
};

describe("toTruck", () => {
  it("maps the contract's example truck field for field", () => {
    const truck = toTruck(CONTRACT_TRUCK);
    expect(truck.id).toBe(CONTRACT_TRUCK.id);
    expect(truck.equipmentType).toBe("DRY_VAN");
    expect(truck.operationalStatus).toBe("UNAVAILABLE");
    expect(truck.fuelType).toBe("DIESEL");
    expect(truck.cabType).toBe("SLEEPER");
    expect(truck.legalOwner).toMatchObject({ ownerType: "ORGANIZATION", ownerUserId: null });
    expect(truck.operating).toMatchObject({ unitNumber: "104", operationalStatus: "UNAVAILABLE" });
    expect(truck.currentDriver).toBeNull();
    expect(truck.currentDispatchers).toEqual([]);
    expect(truck.archivedAt).toBeNull();
  });

  it("drops enum values the contract does not list instead of passing them through", () => {
    const truck = toTruck({ ...CONTRACT_TRUCK, equipmentType: "SPACESHIP", operationalStatus: 7 });
    expect(truck.equipmentType).toBeUndefined();
    expect(truck.operationalStatus).toBeUndefined();
  });

  it("turns null identity fields into undefined", () => {
    const truck = toTruck({ ...CONTRACT_TRUCK, make: null, year: null, legalOwner: null });
    expect(truck.make).toBeUndefined();
    expect(truck.year).toBeUndefined();
    expect(truck.legalOwner).toBeNull();
  });

  it("keeps dispatcher coverage and skips malformed assignment rows", () => {
    const truck = toTruck({
      ...CONTRACT_TRUCK,
      currentDispatchers: [
        { assignmentId: "a1", userId: "u1", name: "Sam", coverage: "PRIMARY" },
        { name: "no ids" },
        null,
      ],
    });
    expect(truck.currentDispatchers).toEqual([
      { assignmentId: "a1", userId: "u1", name: "Sam", startAt: undefined, coverage: "PRIMARY" },
    ]);
  });
});

describe("toTruckPage", () => {
  it("maps the contract's list example", () => {
    const page = toTruckPage(CONTRACT_LIST);
    expect(page.meta).toEqual({ page: 1, pageSize: 20, totalItems: 1, totalPages: 1 });
    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.currentDriver).toMatchObject({ name: "Jordan Lee", userId: CONTRACT_LIST.data[0]!.currentDriver.userId });
    expect(page.data[0]?.operationalStatus).toBe("AVAILABLE");
  });

  it("returns an empty page for a body without data", () => {
    expect(toTruckPage({}).data).toEqual([]);
  });
});
