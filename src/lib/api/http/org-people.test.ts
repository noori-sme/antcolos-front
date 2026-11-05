import { describe, expect, it } from "vitest";
import { toOrgPerson } from "./org-people";

/** Copied from ../antcolos/docs/requirements/users-api-contract.md §2 (list item). */
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

describe("toOrgPerson (users contract §2–§4)", () => {
  it("maps the contract driver example", () => {
    expect(toOrgPerson(CONTRACT_DRIVER)).toEqual({
      userId: CONTRACT_DRIVER.userId,
      membershipId: CONTRACT_DRIVER.membershipId,
      name: "Jordan Lee",
      email: "driver@example.com",
      username: "jordanlee",
      currentTruckUnitNumber: "104",
    });
  });

  it("handles no current truck and falls back to first + last name", () => {
    const person = toOrgPerson({
      ...CONTRACT_DRIVER,
      name: null,
      currentTruck: null,
    });
    expect(person.name).toBe("Jordan Lee");
    expect(person.currentTruckUnitNumber).toBeUndefined();
  });
});
