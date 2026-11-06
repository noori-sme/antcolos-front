import { describe, expect, it } from "vitest";
import { toOrgPerson, toOrgPersonDetail } from "./org-people";

/** Copied from ../antcolos/docs/requirements/users-api-contract.md. */
const CONTRACT_DRIVER = {
  userId: "9f8e7d6c-5b4a-3210-fedc-ba9876543210",
  membershipId: "2b3c4d5e-6f70-8901-bcde-f12345678901",
  firstName: "Jordan",
  lastName: "Lee",
  name: "Jordan Lee",
  username: "jordanlee",
  email: "driver@example.com",
  phone: "4155552671",
  roleId: "DRIVER",
  roleName: "Driver",
  joinedAt: "2026-08-27T12:00:00.000Z",
  accountStatus: "ACTIVE",
  currentTruck: {
    assignmentId: "c1d2e3f4-5a6b-7890-cdef-1234567890ab",
    truckId: "a0b1c2d3-4e5f-6789-a0b1-c2d3e4f56789",
    unitNumber: "104",
    startAt: "2026-09-01T12:00:00.000Z",
  },
};

const CONTRACT_DISPATCHER = {
  userId: "8e7d6c5b-4a32-10fe-dcba-9876543210fe",
  membershipId: "3c4d5e6f-7081-9012-cdef-234567890123",
  firstName: "Sam",
  lastName: "Nguyen",
  name: "Sam Nguyen",
  username: "samnguyen",
  email: "dispatch@example.com",
  phone: null,
  roleId: "DISPATCHER",
  roleName: "Dispatcher",
  joinedAt: "2026-08-20T12:00:00.000Z",
  accountStatus: "ACTIVE",
  currentAssignments: [
    {
      assignmentId: "c1d2e3f4-5a6b-7890-cdef-1234567890ab",
      truckId: "a0b1c2d3-4e5f-6789-a0b1-c2d3e4f56789",
      unitNumber: "104",
      coverage: "PRIMARY",
      startAt: "2026-09-01T12:00:00.000Z",
    },
  ],
};

describe("toOrgPerson (users contract §2–§4)", () => {
  it("maps the contract driver example", () => {
    expect(toOrgPerson(CONTRACT_DRIVER)).toEqual({
      userId: CONTRACT_DRIVER.userId,
      membershipId: CONTRACT_DRIVER.membershipId,
      firstName: "Jordan",
      lastName: "Lee",
      name: "Jordan Lee",
      username: "jordanlee",
      email: "driver@example.com",
      phone: "4155552671",
      roleId: "DRIVER",
      roleName: "Driver",
      joinedAt: "2026-08-27T12:00:00.000Z",
      accountStatus: "ACTIVE",
      currentTruck: {
        assignmentId: CONTRACT_DRIVER.currentTruck.assignmentId,
        truckId: CONTRACT_DRIVER.currentTruck.truckId,
        unitNumber: "104",
        startAt: "2026-09-01T12:00:00.000Z",
      },
    });
  });

  it("keeps an explicit null truck, falls back to first + last name", () => {
    const person = toOrgPerson({ ...CONTRACT_DRIVER, name: null, currentTruck: null });
    expect(person.name).toBe("Jordan Lee");
    expect(person.currentTruck).toBeNull();
  });

  it("maps the dispatcher example, with null phone as undefined", () => {
    const person = toOrgPerson(CONTRACT_DISPATCHER);
    expect(person.phone).toBeUndefined();
    expect(person.currentAssignments).toEqual([
      {
        assignmentId: CONTRACT_DISPATCHER.currentAssignments[0].assignmentId,
        truckId: CONTRACT_DISPATCHER.currentAssignments[0].truckId,
        unitNumber: "104",
        coverage: "PRIMARY",
        startAt: "2026-09-01T12:00:00.000Z",
      },
    ]);
    expect(person).not.toHaveProperty("currentTruck");
  });

  it("maps the admin overrides flag", () => {
    const admin: Record<string, unknown> = { ...CONTRACT_DRIVER };
    delete admin.currentTruck;
    expect(
      toOrgPerson({ ...admin, roleId: "ADMIN", hasPermissionOverrides: true })
        .hasPermissionOverrides,
    ).toBe(true);
  });
});

describe("toOrgPersonDetail (§2 get)", () => {
  it("adds the address, with null lines as undefined", () => {
    const detail = toOrgPersonDetail({
      ...CONTRACT_DRIVER,
      currentTruck: null,
      address: {
        addressLine1: "123 Market St",
        addressLine2: null,
        postalCode: "94105",
        city: "San Francisco",
        state: "CA",
        country: "US",
      },
    });
    expect(detail.address).toEqual({
      addressLine1: "123 Market St",
      addressLine2: undefined,
      postalCode: "94105",
      city: "San Francisco",
      state: "CA",
      country: "US",
    });
  });

  it("returns a null address when none is sent", () => {
    expect(toOrgPersonDetail({ ...CONTRACT_DRIVER, address: null }).address).toBeNull();
  });
});
