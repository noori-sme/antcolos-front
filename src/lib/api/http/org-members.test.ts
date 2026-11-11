import { describe, expect, it } from "vitest";
import { toPage } from "./dto";
import { toOrgMember } from "./org-members";

/** Copied from ../antcolos/docs/requirements/membership-api-contract.md §2. */
const CONTRACT_LIST = {
  data: [
    {
      userId: "9f8e7d6c-5b4a-3210-fedc-ba9876543210",
      name: "Jordan Lee",
      email: "driver@example.com",
      roleId: "DRIVER",
      roleName: "Driver",
      hasPermissionOverrides: false,
      joinedAt: "2026-08-27T12:00:00.000Z",
    },
  ],
  meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
};

describe("toOrgMember (membership-api-contract §2)", () => {
  it("maps the contract example page", () => {
    const page = toPage(CONTRACT_LIST, toOrgMember);
    expect(page.meta.totalItems).toBe(1);
    expect(page.data).toEqual([
      {
        userId: "9f8e7d6c-5b4a-3210-fedc-ba9876543210",
        name: "Jordan Lee",
        email: "driver@example.com",
        roleId: "DRIVER",
        roleName: "Driver",
        hasPermissionOverrides: false,
        joinedAt: "2026-08-27T12:00:00.000Z",
      },
    ]);
  });

  it("keeps a custom role's name and flags overrides only when true", () => {
    const member = toOrgMember({
      ...CONTRACT_LIST.data[0],
      roleId: "5b9c0d1e-2f3a-4b5c-6d7e-8f9a0b1c2d3e",
      roleName: "Night dispatch",
      hasPermissionOverrides: "yes",
    });
    expect(member.roleName).toBe("Night dispatch");
    expect(member.hasPermissionOverrides).toBe(false);
  });

  it("falls back to the email when the name is missing", () => {
    expect(toOrgMember({ ...CONTRACT_LIST.data[0], name: null }).name).toBe("driver@example.com");
  });
});
