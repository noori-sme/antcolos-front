import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import {
  availablePermissionKeys, NEVER_GRANTABLE, PERMISSION_CATALOG,
  PERMISSION_GROUP_LABELS, PERMISSION_GROUP_ORDER, permissionMeta,
} from "@/lib/permissions/catalog";
import { effectivePermissions } from "@/lib/permissions/effective";
import { clampToGrantable, grantablePermissionKeys } from "@/lib/permissions/grantable";
import { requiredPermissionsForPath, ROUTE_MANIFEST } from "@/lib/permissions/route-manifest";
import { SEED_TEMPLATES, seedTemplates } from "@/lib/permissions/templates";
import {
  MOCK_MEMBERSHIPS, MOCK_ORGANIZATIONS, MOCK_TEMPLATES,
} from "@/lib/session/fixtures";
import { mockLoadsService } from "@/lib/api/mock/loads";
import { mockNeedsYouService } from "@/lib/api/mock/needs-you";
import { mockStore } from "@/lib/api/mock/store";
import { fleetSync, truckContextFrom, TRUCK_IDS } from "@/lib/api/mock/truck-registry";
import { resetInsuranceRegistry } from "@/lib/api/mock/insurance-registry";
import { ALL_PERMISSIONS, serviceContextFor } from "./helpers";
import type { PermissionGroup, PermissionKey } from "@/types";

/**
 * The behaviour that was already here.
 *
 * Insurance widened the permission catalog, the Needs You vocabulary and the
 * navigation, so these guard the seams it touched as well as the invariants
 * the earlier milestones set.
 */

beforeEach(() => {
  resetInsuranceRegistry();
  mockStore.reset();
});

/* ---- Permission catalog --------------------------------------------------- */

test("every catalog key is unique", () => {
  const keys = PERMISSION_CATALOG.map((p) => p.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("every catalog entry has a label, a description and a known group", () => {
  for (const meta of PERMISSION_CATALOG) {
    assert.ok(meta.label.length > 0, `${meta.key} has a label`);
    assert.ok(meta.description.length > 0, `${meta.key} has a description`);
    assert.ok(
      PERMISSION_GROUP_ORDER.includes(meta.group),
      `${meta.key} is in a group the UI knows how to order`,
    );
    assert.ok(PERMISSION_GROUP_LABELS[meta.group], `${meta.group} has a label`);
  }
});

test("every group in the reading order has at least one permission", () => {
  for (const group of PERMISSION_GROUP_ORDER) {
    assert.ok(
      PERMISSION_CATALOG.some((p) => p.group === group),
      `${group} is not an empty heading`,
    );
  }
});

test("the reading order covers exactly the groups that exist", () => {
  const used = new Set<PermissionGroup>(PERMISSION_CATALOG.map((p) => p.group));
  assert.deepEqual([...used].sort(), [...PERMISSION_GROUP_ORDER].sort());
});

test("the powers reserved to the Owner are not permissions at all", () => {
  const keys = new Set<string>(PERMISSION_CATALOG.map((p) => p.key));
  for (const reserved of NEVER_GRANTABLE) {
    assert.ok(!keys.has(reserved.id), `${reserved.id} can never be granted`);
  }
});

test("insurance money keys are marked sensitive and financial", () => {
  for (const key of ["insurance:sensitive:view", "claims:financials:view"] as PermissionKey[]) {
    const meta = permissionMeta(key);
    assert.equal(meta.sensitive, true, `${key} warns before it is granted`);
    assert.equal(meta.financial, true, `${key} warns loudly`);
  }
});

test("every seeded template only asks for keys that exist", () => {
  const keys = new Set<string>(PERMISSION_CATALOG.map((p) => p.key));
  for (const template of SEED_TEMPLATES) {
    for (const key of template.permissions) {
      assert.ok(keys.has(key), `${template.name} asks for a real key: ${key}`);
    }
  }
});

test("no seeded template hands out claim money by accident", () => {
  for (const template of SEED_TEMPLATES) {
    if (template.name === "Accountant" || template.name === "Risk and insurance") continue;
    assert.ok(
      !template.permissions.includes("claims:financials:view"),
      `${template.name} does not see claim money`,
    );
    assert.ok(
      !template.permissions.includes("insurance:sensitive:view"),
      `${template.name} does not see premiums`,
    );
  }
});

test("seeded templates are namespaced to their organization", () => {
  const templates = seedTemplates("org_test");
  assert.ok(templates.every((t) => t.organizationId === "org_test"));
  assert.ok(templates.every((t) => t.id.includes("org_test")));
});

/* ---- Effective permissions ------------------------------------------------ */

test("an owner holds everything their organization type supports", () => {
  const membership = MOCK_MEMBERSHIPS.find((m) => m.id === "mem_northline_owner")!;
  const organization = MOCK_ORGANIZATIONS.find((o) => o.id === membership.organizationId)!;
  const effective = effectivePermissions(membership, organization, MOCK_TEMPLATES);
  assert.deepEqual(
    [...effective].sort(),
    [...availablePermissionKeys(organization.type)].sort(),
  );
});

test("a dispatch agency is never offered carrier-only fleet keys", () => {
  const keys = availablePermissionKeys("DISPATCH_AGENCY");
  assert.ok(!keys.includes("trucks:create"));
  assert.ok(!keys.includes("trailers:delete"));
  // Insurance is not carrier-only: a dispatch agency insures itself too.
  assert.ok(keys.includes("insurance:view"));
});

test("a revocation beats a template grant", () => {
  const membership = MOCK_MEMBERSHIPS.find((m) => m.id === "mem_meridian_dispatcher")!;
  const organization = MOCK_ORGANIZATIONS.find((o) => o.id === membership.organizationId)!;
  const effective = effectivePermissions(membership, organization, MOCK_TEMPLATES);
  assert.ok(effective.has("loads:view"), "from the template");
  assert.ok(effective.has("customers:edit"), "from the explicit grant");
  assert.ok(!effective.has("loads:delete"), "explicitly revoked");
  assert.ok(!effective.has("rates:view"), "never granted");
});

test("a suspended membership holds nothing", () => {
  const membership = {
    ...MOCK_MEMBERSHIPS.find((m) => m.id === "mem_meridian_dispatcher")!,
    status: "suspended" as const,
  };
  const organization = MOCK_ORGANIZATIONS.find((o) => o.id === membership.organizationId)!;
  assert.equal(effectivePermissions(membership, organization, MOCK_TEMPLATES).size, 0);
});

test("nobody can hand out access they do not hold", () => {
  const granter = new Set<PermissionKey>(["insurance:view", "claims:view"]);
  const grantable = grantablePermissionKeys(granter, "CARRIER");
  assert.deepEqual(grantable.sort(), ["claims:view", "insurance:view"]);

  const clamped = clampToGrantable(
    ["insurance:view", "insurance:sensitive:view", "claims:financials:view"],
    granter,
    "CARRIER",
  );
  assert.deepEqual(clamped, ["insurance:view"]);
});

/* ---- Routes --------------------------------------------------------------- */

test("every route in the manifest asks only for real permissions", () => {
  const keys = new Set<string>(PERMISSION_CATALOG.map((p) => p.key));
  for (const [route, required] of Object.entries(ROUTE_MANIFEST)) {
    for (const key of required) {
      assert.ok(keys.has(key), `${route} asks for a real key: ${key}`);
    }
  }
});

test("the insurance routes are gated, and detail pages inherit their section", () => {
  assert.deepEqual(requiredPermissionsForPath("/insurance"), ["insurance:view"]);
  assert.deepEqual(requiredPermissionsForPath("/insurance/policies"), ["insurance:view"]);
  assert.deepEqual(
    requiredPermissionsForPath("/insurance/policies/some-uuid"),
    ["insurance:view"],
  );
  assert.deepEqual(requiredPermissionsForPath("/insurance/claims"), ["claims:view"]);
  assert.deepEqual(requiredPermissionsForPath("/insurance/claims/some-uuid"), ["claims:view"]);
  assert.deepEqual(requiredPermissionsForPath("/insurance/certificates"), ["insurance:view"]);
});

test("the longest matching prefix still wins", () => {
  assert.deepEqual(requiredPermissionsForPath("/loads/abc"), ["loads:view"]);
  assert.deepEqual(requiredPermissionsForPath("/fleet/trucks/new"), ["trucks:create"]);
  assert.deepEqual(requiredPermissionsForPath("/account/profile"), []);
});

/* ---- Loads ---------------------------------------------------------------- */

test("loads are narrowed to the caller's organization", async () => {
  const ctx = serviceContextFor("mem_northline_owner");
  const page = await mockLoadsService.list(ctx);
  assert.ok(page.items.length > 0);
  assert.ok(page.items.every((l) => l.organizationId === "org_northline"));
});

test("a driver membership sees only its own loads, and no money", async () => {
  const ctx = serviceContextFor("mem_cascade_driver");
  const page = await mockLoadsService.list(ctx);
  assert.ok(page.items.length > 0);
  assert.ok(
    page.items.every((l) => l.assignment?.driverId === ctx.driverProfileId),
    "assigned scope really narrows the list",
  );
  assert.ok(page.items.every((l) => l.financials === undefined), "no rates without rates:view");
});

test("a rate-blind dispatcher gets loads with the money stripped", async () => {
  const ctx = serviceContextFor("mem_meridian_dispatcher");
  const page = await mockLoadsService.list(ctx);
  assert.ok(page.items.length > 0);
  assert.ok(page.items.every((l) => l.financials === undefined));
});

/* ---- Needs You ------------------------------------------------------------ */

test("a snooze longer than the severity allows is refused", async () => {
  const ctx = serviceContextFor("mem_northline_owner");
  const items = await mockNeedsYouService.list(ctx, { severity: ["critical"] });
  assert.ok(items.length > 0);
  await assert.rejects(
    () => mockNeedsYouService.snooze(ctx, items[0].id, { hours: 48, reason: "Later." }),
    /can be snoozed for at most/,
  );
});

test("a snooze still needs a reason", async () => {
  const ctx = serviceContextFor("mem_northline_owner");
  const [item] = await mockNeedsYouService.list(ctx);
  await assert.rejects(
    () => mockNeedsYouService.snooze(ctx, item.id, { hours: 1, reason: "  " }),
    /needs a reason/,
  );
});

test("the queue is sorted by urgency", async () => {
  const ctx = serviceContextFor("mem_northline_owner");
  const items = await mockNeedsYouService.list(ctx);
  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  for (let i = 1; i < items.length; i += 1) {
    assert.ok(
      order[items[i - 1].severity] <= order[items[i].severity],
      "severity never goes backwards",
    );
  }
});

test("an item from another organization cannot be reached", async () => {
  const northline = serviceContextFor("mem_northline_owner");
  const [item] = await mockNeedsYouService.list(northline);
  const cascade = serviceContextFor("mem_cascade_driver");
  await assert.rejects(() => mockNeedsYouService.get(cascade, item.id));
});

/* ---- Fleet ---------------------------------------------------------------- */

test("the fleet is derived from relationships, not from who created the record", () => {
  const northline = fleetSync(truckContextFrom(serviceContextFor("mem_northline_owner")));
  const ids = northline.map((t) => t.truckId);
  assert.ok(ids.includes(TRUCK_IDS.nl104));
  assert.ok(!ids.includes(TRUCK_IDS.nl121), "a pending relationship is not yet a fleet member");
  assert.ok(!ids.includes(TRUCK_IDS.cs47), "another carrier's truck never appears");
});

test("a membership without trucks:view gets no fleet at all", () => {
  const ctx = truckContextFrom(serviceContextFor("mem_northline_owner"));
  const blind = { ...ctx, permissions: new Set<PermissionKey>() };
  assert.deepEqual(fleetSync(blind), []);
  assert.ok(fleetSync({ ...ctx, permissions: ALL_PERMISSIONS }).length > 0);
});
