import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
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
} from "./driver-workflow-harness";

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
    assert.equal(new Set(keys).size, keys.length);
  });

  it("gives every group a label and a place in the reading order", () => {
    for (const permission of PERMISSION_CATALOG) {
      assert.ok(PERMISSION_GROUP_LABELS[permission.group]);
      assert.ok(PERMISSION_GROUP_ORDER.includes(permission.group));
    }
    assert.equal(new Set(PERMISSION_GROUP_ORDER).size, PERMISSION_GROUP_ORDER.length);
  });

  it("keeps the owner-only powers out of the catalog entirely", () => {
    const keys = new Set<string>(PERMISSION_CATALOG.map((p) => p.key));
    for (const reserved of NEVER_GRANTABLE) {
      assert.equal(keys.has(reserved.id), false);
    }
  });

  it("gives an owner every permission their organization type offers", () => {
    const membership = MOCK_MEMBERSHIPS.find((m) => m.id === NORTHLINE_OWNER)!;
    const organization = MOCK_ORGANIZATIONS.find((o) => o.id === membership.organizationId)!;
    const effective = effectivePermissions(membership, organization, MOCK_TEMPLATES);

    for (const key of availablePermissionKeys(organization.type)) {
      assert.equal(effective.has(key), true);
    }
    // Including the ones this branch added.
    assert.equal(effective.has("proposals:respond"), true);
    assert.equal(effective.has("trips:execute"), true);
  });

  it("still withholds rates:view from the Meridian dispatcher", () => {
    const ctx = contextFor(MERIDIAN_DISPATCHER);
    assert.equal(ctx.permissions.has("rates:view"), false);
    assert.equal(ctx.permissions.has("loads:delete"), false);
    assert.equal(ctx.permissions.has("customers:edit"), true);
  });

  it("routes both driver memberships through the same driver template", () => {
    for (const id of [CASCADE_DRIVER, STONEBRIDGE_DRIVER]) {
      const ctx = contextFor(id);
      assert.equal(ctx.permissions.has("proposals:view"), true);
      assert.equal(ctx.permissions.has("trips:execute"), true);
      // A driver still sees no money through the permission system.
      assert.equal(ctx.permissions.has("rates:view"), false);
      assert.equal(ctx.scope.loads, "assigned");
    }
  });
});

describe("route gating still matches the nav", () => {
  it("gates the new driver routes and inherits on nested paths", () => {
    assert.deepEqual(requiredPermissionsForPath("/driver/proposals"), ["proposals:view"]);
    assert.deepEqual(requiredPermissionsForPath("/driver/proposals/prop_1"), ["proposals:view"]);
    assert.deepEqual(requiredPermissionsForPath("/driver/loads/load_1"), ["loads:view"]);
  });

  it("leaves the existing routes where they were", () => {
    assert.deepEqual(requiredPermissionsForPath("/loads"), ["loads:view"]);
    assert.deepEqual(requiredPermissionsForPath("/loads/abc"), ["loads:view"]);
    assert.deepEqual(requiredPermissionsForPath("/dispatch"), ["loads:view", "loads:assign"]);
    assert.deepEqual(requiredPermissionsForPath("/account/profile"), []);
  });
});

describe("the existing load service is unaffected", () => {
  beforeEach(resetWorld);

  it("still narrows a driver to their own loads and strips the money", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const page = await services.loads.list(ctx);

    assert.ok(page.items.length > 0);
    assert.equal(page.items.every((l) => l.assignment?.driverId === ctx.driverProfileId), true);
    assert.equal(page.items.every((l) => l.financials === undefined), true);
  });

  it("still gives an owner every load with its financials", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const page = await services.loads.list(ctx);

    assert.ok(page.items.length > 0);
    assert.equal(page.items.some((l) => l.financials !== undefined), true);
  });

  it("serves the organization this branch added like any other", async () => {
    const ctx = contextFor(STONEBRIDGE_DRIVER);
    const page = await services.loads.list(ctx);

    assert.equal(page.items.every((l) => l.organizationId === "org_stonebridge"), true);
    assert.deepEqual(page.items.map((l) => l.reference).sort(), ["SB-1036", "SB-1042", "SB-1048"]);
  });

  it("reports a load in another organization as not found", async () => {
    const owner = contextFor(NORTHLINE_OWNER);
    const driver = contextFor(STONEBRIDGE_DRIVER);
    const theirs = await services.loads.list(owner);

    await assert.rejects(
      services.loads.get(driver, theirs.items[0].id),
      NotFoundError,
    );
  });
});

describe("Needs You and Home still work in every organization", () => {
  beforeEach(resetWorld);

  it("serves the home summary for each membership", async () => {
    for (const id of [NORTHLINE_OWNER, MERIDIAN_DISPATCHER, CASCADE_DRIVER, STONEBRIDGE_DRIVER]) {
      const summary = await services.home.summary(contextFor(id));
      assert.ok(summary);
      assert.equal(Array.isArray(summary.activeLoads), true);
    }
  });

  it("serves Needs You in the organization this branch added", async () => {
    const ctx = contextFor(STONEBRIDGE_DRIVER);
    const items = await services.needsYou.list(ctx);
    assert.equal(items.every((i) => i.organizationId === "org_stonebridge"), true);
  });

  it("still refuses a list call from a membership without the permission", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const stripped = {
      ...ctx,
      permissions: new Set([...ctx.permissions].filter((p) => p !== "loads:view")),
    };
    await assert.rejects(
      services.loads.list(stripped),
      PermissionDeniedError,
    );
  });
});
