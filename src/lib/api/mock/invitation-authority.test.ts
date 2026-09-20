import { beforeEach, describe, expect, it } from "vitest";
import { contextFor } from "@/test/context";
import { services } from "@/lib/api";
import { PermissionDeniedError } from "@/lib/api/contracts/context";
import { effectivePermissions } from "@/lib/permissions/effective";
import { requiredPermissionsForPath } from "@/lib/permissions/route-manifest";
import { SEED_TEMPLATES } from "@/lib/permissions/templates";
import { ALL_NAV_SECTIONS } from "@/config/nav";
import { MOCK_MEMBERSHIPS, MOCK_ORGANIZATIONS } from "@/lib/session/fixtures";
import { resetRoster } from "@/lib/session/membership-store";
import { resetMembershipDirectory } from "./membership-directory";
import { resetTemplateStore } from "./template-store";
import { resetAccessStore } from "./access-store";
import { accessNeedsYouItems } from "./access-needs-you";
import type { PermissionKey } from "@/types";

/**
 * Who may invite somebody into an organization.
 *
 * ★ THE RULE ★
 * The Owner, or somebody the Owner has explicitly given `invitations:create`.
 * Nobody else may invite, and — the part that is easy to get wrong — nobody
 * else may SEE the feature either. A nav item that leads to a refusal is not a
 * closed door, it is a sign on a closed door telling people it is there.
 *
 * There is deliberately no Admin role, no `isAdmin` flag and no second
 * structural rank beside `isOwner`: delegation happens through the permission,
 * which is the only mechanism the product has for it. An active owner holds
 * every permission their organization type supports, so "the owner or a
 * delegate" is exactly one check.
 *
 * ███ NOT SECURITY ███
 * Every check below reads a permission set assembled in a browser. The value is
 * that the SAME key gates the nav item, the route, the screen and the service
 * call, so there is one answer to "may this person invite" rather than four
 * that can drift apart.
 */

const NORTHLINE = MOCK_ORGANIZATIONS.find((o) => o.id === "org_northline")!;
const INVITE: PermissionKey = "invitations:create";

beforeEach(() => {
  resetTemplateStore();
  resetAccessStore();
  resetRoster();
  resetMembershipDirectory();
});

function navItemFor(href: string) {
  for (const section of ALL_NAV_SECTIONS) {
    const found = section.items.find((i) => i.href === href);
    if (found) return found;
  }
  return undefined;
}

describe("one key, from the nav item to the service call", () => {
  it("gates the nav item on the key that actually lets you invite", () => {
    expect(navItemFor("/settings/invitations")?.requires).toEqual([INVITE]);
  });

  it("gates both routes on the same key", () => {
    expect(requiredPermissionsForPath("/settings/invitations")).toEqual([INVITE]);
    expect(requiredPermissionsForPath("/settings/invitations/new")).toEqual([INVITE]);
  });

  it("gates the service call on it too", async () => {
    const ctx = contextFor("org_northline", { without: [INVITE] });
    await expect(services.access.create(ctx, {
      kind: "employee",
      roleName: "Employee",
      recipientName: "Nadia Haddad",
      recipientEmail: "nadia@example.com",
      permissions: ["loads:view"],
      expiresAt: null,
    })).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("does not offer a call to action into a screen the person cannot open", () => {
    const viewerOnly = contextFor("org_northline", {
      permissions: ["invitations:view", "members:view", "loads:view"],
    });
    for (const item of accessNeedsYouItems(viewerOnly)) {
      const requires = item.recommendedAction?.requires ?? [];
      if (item.recommendedAction?.href?.startsWith("/settings/invitations")) {
        expect(requires).toContain(INVITE);
      }
    }
  });
});

describe("the owner", () => {
  it("can invite, without anybody having granted it to them", async () => {
    const owner = MOCK_MEMBERSHIPS.find((m) => m.id === "mem_northline_owner")!;
    expect(owner.isOwner).toBe(true);
    // Not written on the seat anywhere — it falls out of being the owner.
    expect(owner.grants).not.toContain(INVITE);
    expect(effectivePermissions(owner, NORTHLINE).has(INVITE)).toBe(true);

    const invitation = await services.access.create(contextFor("org_northline"), {
      kind: "employee",
      roleName: "Employee",
      recipientName: "Nadia Haddad",
      recipientEmail: "nadia@example.com",
      permissions: ["loads:view"],
      expiresAt: null,
    });
    expect(invitation.status).toBe("pending");
    expect(invitation.invitedByMembershipId).toBe("mem_northline_owner");
  });

  it("loses it the moment the seat stops being active", () => {
    const owner = MOCK_MEMBERSHIPS.find((m) => m.id === "mem_northline_owner")!;
    for (const status of ["suspended", "left", "invited"] as const) {
      expect(effectivePermissions({ ...owner, status }, NORTHLINE).has(INVITE)).toBe(false);
    }
  });
});

describe("a delegate the owner has given the key to", () => {
  it("can invite", async () => {
    const delegate = contextFor("org_northline", {
      permissions: ["invitations:view", INVITE, "members:view", "loads:view"],
    });
    const invitation = await services.access.create(delegate, {
      kind: "employee",
      roleName: "Employee",
      recipientName: "Nadia Haddad",
      recipientEmail: "nadia@example.com",
      permissions: ["loads:view"],
      expiresAt: null,
    });
    expect(invitation.status).toBe("pending");
  });

  it("still cannot hand out access they do not hold themselves", async () => {
    const delegate = contextFor("org_northline", {
      permissions: ["invitations:view", INVITE, "members:view", "loads:view"],
    });
    // Holding the invite key is not a way around the clamp that has always
    // applied to what an invitation may carry.
    await expect(services.access.create(delegate, {
      kind: "employee",
      roleName: "Employee",
      recipientName: "Nadia Haddad",
      recipientEmail: "nadia@example.com",
      permissions: ["loads:view", "revenue:view", "permissions:manage"],
      expiresAt: null,
    })).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe("everybody else cannot see it, let alone use it", () => {
  it("no seeded role carries the invite key", () => {
    // The delegation exists as a mechanism and is given to nobody by default,
    // so the out-of-the-box answer to "who may invite" is: the owner.
    for (const template of SEED_TEMPLATES) {
      expect(template.permissions).not.toContain(INVITE);
    }
  });

  it("hides the nav item from somebody who may only read invitations", () => {
    const viewerOnly = new Set<PermissionKey>(["invitations:view", "members:view"]);
    const item = navItemFor("/settings/invitations")!;
    // This is the leak that used to exist: the seeded "Contracts and
    // relationships" role grants `invitations:view`, so a real person saw the
    // item, clicked it, and was told they may not be there.
    expect(item.requires!.every((k) => viewerOnly.has(k))).toBe(false);
  });

  it("refuses the route to them as well, so a typed URL is no way in", () => {
    const viewerOnly = new Set<PermissionKey>(["invitations:view", "members:view"]);
    for (const path of ["/settings/invitations", "/settings/invitations/new"]) {
      expect(requiredPermissionsForPath(path).every((k) => viewerOnly.has(k))).toBe(false);
    }
  });

  it("refuses a driver, who holds neither key", () => {
    const driver = SEED_TEMPLATES.find((t) => t.name === "Driver")!;
    expect(driver.permissions).not.toContain(INVITE);
    expect(driver.permissions).not.toContain("invitations:view");
  });
});
