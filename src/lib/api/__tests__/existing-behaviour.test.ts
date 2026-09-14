import { beforeEach, describe, expect, it } from "vitest";
import { services } from "@/lib/api";
import { NotFoundError, PermissionDeniedError } from "@/lib/api/contracts/context";
import {
  NEVER_GRANTABLE, PERMISSION_CATALOG, PERMISSION_GROUP_LABELS,
  PERMISSION_GROUP_ORDER, availablePermissionKeys,
} from "@/lib/permissions/catalog";
import { effectivePermissions } from "@/lib/permissions/effective";
import { requiredPermissionsForPath } from "@/lib/permissions/route-manifest";
import {
  MOCK_MEMBERSHIPS, MOCK_ORGANIZATIONS, MOCK_TEMPLATES,
} from "@/lib/session/fixtures";
import {
  CASCADE_DRIVER, MERIDIAN_DISPATCHER, NORTHLINE_OWNER, STONEBRIDGE_DRIVER,
  contextFor, resetWorld,
} from "@/lib/driver-workflow/__tests__/harness";

/**
 * Regression cover for the behaviour that was already here before this branch.
 *
 * This feature added three permission keys, a permission group, an
 * organization and a membership to the shared fixtures. Each of those is the
 * sort of change that quietly breaks something two modules away, so the
 * invariants they could break are asserted rather than assumed.
 */

describe("the permission catalog stays coherent", () => {
  it("has no duplicate keys", () => {
    const keys = PERMISSION_CATALOG.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every group a label and a place in the reading order", () => {
    for (const permission of PERMISSION_CATALOG) {
      expect(PERMISSION_GROUP_LABELS[permission.group]).toBeTruthy();
      expect(PERMISSION_GROUP_ORDER).toContain(permission.group);
    }
    expect(new Set(PERMISSION_GROUP_ORDER).size).toBe(PERMISSION_GROUP_ORDER.length);
  });

  it("keeps the owner-only powers out of the catalog entirely", () => {
    const keys = new Set<string>(PERMISSION_CATALOG.map((p) => p.key));
    for (const reserved of NEVER_GRANTABLE) {
      expect(keys.has(reserved.id)).toBe(false);
    }
  });

  it("gives an owner every permission their organization type offers", () => {
    const membership = MOCK_MEMBERSHIPS.find((m) => m.id === NORTHLINE_OWNER)!;
    const organization = MOCK_ORGANIZATIONS.find((o) => o.id === membership.organizationId)!;
    const effective = effectivePermissions(membership, organization, MOCK_TEMPLATES);

    for (const key of availablePermissionKeys(organization.type)) {
      expect(effective.has(key)).toBe(true);
    }
    // Including the ones this branch added.
    expect(effective.has("proposals:respond")).toBe(true);
    expect(effective.has("trips:execute")).toBe(true);
  });

  it("still withholds rates:view from the Meridian dispatcher", () => {
    const ctx = contextFor(MERIDIAN_DISPATCHER);
    expect(ctx.permissions.has("rates:view")).toBe(false);
    expect(ctx.permissions.has("loads:delete")).toBe(false);
    expect(ctx.permissions.has("customers:edit")).toBe(true);
  });

  it("routes both driver memberships through the same driver template", () => {
    for (const id of [CASCADE_DRIVER, STONEBRIDGE_DRIVER]) {
      const ctx = contextFor(id);
      expect(ctx.permissions.has("proposals:view")).toBe(true);
      expect(ctx.permissions.has("trips:execute")).toBe(true);
      // A driver still sees no money through the permission system.
      expect(ctx.permissions.has("rates:view")).toBe(false);
      expect(ctx.scope.loads).toBe("assigned");
    }
  });
});

describe("route gating still matches the nav", () => {
  it("gates the new driver routes and inherits on nested paths", () => {
    expect(requiredPermissionsForPath("/driver/proposals")).toEqual(["proposals:view"]);
    expect(requiredPermissionsForPath("/driver/proposals/prop_1")).toEqual(["proposals:view"]);
    expect(requiredPermissionsForPath("/driver/loads/load_1")).toEqual(["loads:view"]);
  });

  it("leaves the existing routes where they were", () => {
    expect(requiredPermissionsForPath("/loads")).toEqual(["loads:view"]);
    expect(requiredPermissionsForPath("/loads/abc")).toEqual(["loads:view"]);
    expect(requiredPermissionsForPath("/dispatch")).toEqual(["loads:view", "loads:assign"]);
    expect(requiredPermissionsForPath("/account/profile")).toEqual([]);
  });
});

describe("the existing load service is unaffected", () => {
  beforeEach(resetWorld);

  it("still narrows a driver to their own loads and strips the money", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const page = await services.loads.list(ctx);

    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((l) => l.assignment?.driverId === ctx.driverProfileId)).toBe(true);
    expect(page.items.every((l) => l.financials === undefined)).toBe(true);
  });

  it("still gives an owner every load with its financials", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const page = await services.loads.list(ctx);

    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.some((l) => l.financials !== undefined)).toBe(true);
  });

  it("serves the organization this branch added like any other", async () => {
    const ctx = contextFor(STONEBRIDGE_DRIVER);
    const page = await services.loads.list(ctx);

    expect(page.items.every((l) => l.organizationId === "org_stonebridge")).toBe(true);
    expect(page.items.map((l) => l.reference).sort()).toEqual(["SB-1036", "SB-1042", "SB-1048"]);
  });

  it("reports a load in another organization as not found", async () => {
    const owner = contextFor(NORTHLINE_OWNER);
    const driver = contextFor(STONEBRIDGE_DRIVER);
    const theirs = await services.loads.list(owner);

    await expect(services.loads.get(driver, theirs.items[0].id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("Needs You and Home still work in every organization", () => {
  beforeEach(resetWorld);

  it("serves the home summary for each membership", async () => {
    for (const id of [NORTHLINE_OWNER, MERIDIAN_DISPATCHER, CASCADE_DRIVER, STONEBRIDGE_DRIVER]) {
      const summary = await services.home.summary(contextFor(id));
      expect(summary).toBeTruthy();
      expect(Array.isArray(summary.activeLoads)).toBe(true);
    }
  });

  it("serves Needs You in the organization this branch added", async () => {
    const ctx = contextFor(STONEBRIDGE_DRIVER);
    const items = await services.needsYou.list(ctx);
    expect(items.every((i) => i.organizationId === "org_stonebridge")).toBe(true);
  });

  it("still refuses a list call from a membership without the permission", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const stripped = {
      ...ctx,
      permissions: new Set([...ctx.permissions].filter((p) => p !== "loads:view")),
    };
    await expect(services.loads.list(stripped)).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
