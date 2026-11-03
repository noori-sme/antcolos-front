import { describe, expect, it } from "vitest";
import {
  toOrgInvitation, toOrgInvitationPage, toOrgRole, toOrgRoles, toPermissionCatalog,
} from "./org-access";

/** invitations-api-contract.md §Invitation. */
const CONTRACT_INVITATION = {
  id: "3f2a1c4e-7b8d-4a21-9c0e-1f2a3b4c5d6e",
  email: "driver@example.com",
  firstName: "Jordan",
  lastName: "Lee",
  roleId: "DRIVER",
  status: "PENDING",
  organizationId: "7a1b2c3d-4e5f-6789-a0b1-c2d3e4f56789",
  invitedByUserId: "9f8e7d6c-5b4a-3210-fedc-ba9876543210",
  invitedUserId: null,
  expiresAt: "2026-09-03T12:00:00.000Z",
  createdAt: "2026-08-27T12:00:00.000Z",
  updatedAt: "2026-08-27T12:00:00.000Z",
  acceptedAt: null,
  acceptedUserId: null,
};

/** permissions-api-contract.md §2 List roles. */
const CONTRACT_ROLES = {
  roles: [
    { id: "DRIVER", name: "Driver", permissions: ["load.read", "load.update", "document.create"] },
    {
      id: "7a1b2c3d-4e5f-6789-a0b1-c2d3e4f56789",
      name: "Senior Dispatcher",
      description: "Can manage loads and trucks",
      permissions: ["load.read", "load.update"],
      createdAt: "2026-08-31T12:00:00.000Z",
      updatedAt: "2026-08-31T12:00:00.000Z",
    },
  ],
};

/** permissions-api-contract.md §1. */
const CONTRACT_CATALOG = {
  modules: [
    {
      module: "membership",
      label: "Membership & Team",
      resources: [
        {
          resource: "membership",
          label: "Membership",
          actions: [
            { action: "list", label: "List members" },
            { action: "remove", label: "Remove member" },
          ],
        },
      ],
    },
  ],
};

describe("toOrgInvitation", () => {
  it("maps the contract's example invitation", () => {
    expect(toOrgInvitation(CONTRACT_INVITATION)).toEqual({
      ...CONTRACT_INVITATION,
      status: "pending",
    });
  });

  it("maps every contract status, including the approval-request ones", () => {
    const cases: Array<[string, string]> = [
      ["PENDING", "pending"],
      ["ACCEPTED", "accepted"],
      ["EXPIRED", "expired"],
      ["REVOKED", "revoked"],
      ["DECLINED", "declined"],
      ["PENDING_ADMIN_APPROVAL", "awaiting_approval"],
      ["REJECTED_BY_ADMIN", "rejected_by_admin"],
    ];
    for (const [api, ui] of cases) {
      expect(toOrgInvitation({ ...CONTRACT_INVITATION, status: api }).status).toBe(ui);
    }
  });

  it("leaves an unknown status undefined instead of guessing", () => {
    expect(toOrgInvitation({ ...CONTRACT_INVITATION, status: "ARCHIVED" }).status).toBeUndefined();
  });

  it("keeps nullable fields null and fills accepted ones", () => {
    const accepted = toOrgInvitation({
      ...CONTRACT_INVITATION,
      status: "ACCEPTED",
      acceptedAt: "2026-09-01T12:00:00.000Z",
      acceptedUserId: "u1",
      invitedUserId: "u1",
    });
    expect(accepted).toMatchObject({ acceptedAt: "2026-09-01T12:00:00.000Z", acceptedUserId: "u1", invitedUserId: "u1" });
    expect(toOrgInvitation({ ...CONTRACT_INVITATION, acceptedAt: undefined }).acceptedAt).toBeNull();
  });
});

describe("toOrgInvitationPage", () => {
  it("maps list items with their effective permissions and the meta", () => {
    const page = toOrgInvitationPage({
      data: [{ ...CONTRACT_INVITATION, status: "PENDING_ADMIN_APPROVAL", permissions: ["load.read", 3] }],
      meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
    });
    expect(page.meta).toEqual({ page: 1, pageSize: 20, totalItems: 1, totalPages: 1 });
    expect(page.data[0]?.status).toBe("awaiting_approval");
    expect(page.data[0]?.permissions).toEqual(["load.read"]);
  });

  it("returns an empty page for an empty body", () => {
    expect(toOrgInvitationPage(undefined).data).toEqual([]);
  });
});

describe("roles", () => {
  it("maps the contract's role list, system and custom", () => {
    const roles = toOrgRoles(CONTRACT_ROLES);
    expect(roles).toHaveLength(2);
    expect(roles[0]).toEqual({
      id: "DRIVER", name: "Driver", description: undefined,
      permissions: ["load.read", "load.update", "document.create"],
      createdAt: undefined, updatedAt: undefined,
    });
    expect(roles[1]).toMatchObject({ description: "Can manage loads and trucks", createdAt: "2026-08-31T12:00:00.000Z" });
  });

  it("maps a single role (create / update response)", () => {
    expect(toOrgRole(CONTRACT_ROLES.roles[1]!).id).toBe("7a1b2c3d-4e5f-6789-a0b1-c2d3e4f56789");
  });

  it("skips rows without an id", () => {
    expect(toOrgRoles({ roles: [{ name: "x" }] })).toEqual([]);
  });
});

describe("toPermissionCatalog", () => {
  it("maps the contract's catalog example", () => {
    expect(toPermissionCatalog(CONTRACT_CATALOG)).toEqual(CONTRACT_CATALOG);
  });

  it("drops actions without a key", () => {
    const catalog = toPermissionCatalog({
      modules: [{ module: "m", label: "M", resources: [{ resource: "r", label: "R", actions: [{ label: "no key" }] }] }],
    });
    expect(catalog.modules[0]?.resources[0]?.actions).toEqual([]);
  });
});
