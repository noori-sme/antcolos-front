import test from "node:test";
import assert from "node:assert/strict";
import {
  NEVER_GRANTABLE, PERMISSION_CATALOG, PERMISSION_GROUP_LABELS,
  PERMISSION_GROUP_ORDER, availablePermissionKeys, permissionMeta,
} from "@/lib/permissions/catalog";
import { effectivePermissions } from "@/lib/permissions/effective";
import { grantablePermissionKeys } from "@/lib/permissions/grantable";
import { seedTemplates } from "@/lib/permissions/templates";
import { requiredPermissionsForPath, ROUTE_MANIFEST } from "@/lib/permissions/route-manifest";
import {
  MOCK_MEMBERSHIPS, MOCK_ORGANIZATIONS, } from "@/lib/session/fixtures";
import { buildSeed } from "@/lib/api/mock/seed";
import {
  fleetSync, resetTruckRegistry, truckContextFrom, TRUCK_IDS, accessReason,
} from "@/lib/api/mock/truck-registry";
import { resetTrailerRegistry, trailerFleetSync } from "@/lib/api/mock/trailer-registry";
import { serviceContext } from "./helpers.ts";

/**
 * Regression cover for the systems this milestone extended: the permission
 * catalog, the templates, the route manifest, the seed and the equipment
 * registries. Maintenance reuses all of them rather than duplicating any, so
 * these are the assertions that would catch it having broken one.
 */

test.beforeEach(() => {
  resetTruckRegistry();
  resetTrailerRegistry();
});

/* -------------------------------------------------------------------------- */
/* The permission catalog                                                      */
/* -------------------------------------------------------------------------- */

test("every catalog key is unique", () => {
  const keys = PERMISSION_CATALOG.map((p) => p.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("every catalog group has a label and a place in the reading order", () => {
  for (const permission of PERMISSION_CATALOG) {
    assert.ok(PERMISSION_GROUP_LABELS[permission.group], `${permission.group} has a label`);
    assert.ok(
      PERMISSION_GROUP_ORDER.includes(permission.group),
      `${permission.group} appears in the order`,
    );
  }
});

test("every group in the order is a group something actually uses", () => {
  const used = new Set(PERMISSION_CATALOG.map((p) => p.group));
  for (const group of PERMISSION_GROUP_ORDER) {
    assert.ok(used.has(group), `${group} has at least one permission`);
  }
});

test("reserved owner powers never appear as grantable permissions", () => {
  const keys = new Set<string>(PERMISSION_CATALOG.map((p) => p.key));
  for (const reserved of NEVER_GRANTABLE) {
    assert.ok(!keys.has(reserved.id), `${reserved.id} is not a permission`);
  }
});

test("maintenance is a first-class module in the catalog", () => {
  const maintenance = PERMISSION_CATALOG.filter((p) => p.group === "maintenance");
  assert.ok(maintenance.length >= 8);

  // Money is flagged as financial so it gets the loud warning.
  assert.equal(permissionMeta("maintenance:costs:view").financial, true);
  assert.equal(permissionMeta("maintenance:costs:view").sensitive, true);
  // Writing permanent history is sensitive.
  assert.equal(permissionMeta("maintenance:service:record").sensitive, true);
  // Plain viewing is not.
  assert.equal(permissionMeta("maintenance:view").sensitive, undefined);
});

test("a dispatch organization is never offered carrier-only keys", () => {
  const dispatch = new Set(availablePermissionKeys("DISPATCH_AGENCY"));
  assert.ok(!dispatch.has("trucks:create"));
  assert.ok(!dispatch.has("trailers:create"));
  // Sharing your own equipment's maintenance is a carrier's act.
  assert.ok(!dispatch.has("maintenance:share:manage"));
  // But a dispatcher may still be given the viewing key.
  assert.ok(dispatch.has("maintenance:view"));
});

/* -------------------------------------------------------------------------- */
/* Effective permissions and delegation                                        */
/* -------------------------------------------------------------------------- */

test("an owner holds everything their organization type supports", () => {
  const membership = MOCK_MEMBERSHIPS.find((m) => m.id === "mem_northline_owner")!;
  const organization = MOCK_ORGANIZATIONS.find((o) => o.id === "org_northline")!;
  const permissions = effectivePermissions(membership, organization);

  assert.deepEqual(
    [...permissions].sort(),
    [...availablePermissionKeys("CARRIER")].sort(),
  );
});

test("a revocation still beats a grant", () => {
  const membership = MOCK_MEMBERSHIPS.find((m) => m.id === "mem_meridian_dispatcher")!;
  const organization = MOCK_ORGANIZATIONS.find((o) => o.id === "org_meridian")!;
  const permissions = effectivePermissions(membership, organization);

  assert.ok(permissions.has("customers:edit"), "explicit grant applies");
  assert.ok(!permissions.has("loads:delete"), "explicit revocation applies");
  assert.ok(!permissions.has("rates:view"), "never granted in the first place");
});

test("a suspended membership holds nothing", () => {
  const membership = MOCK_MEMBERSHIPS.find((m) => m.id === "mem_meridian_dispatcher")!;
  const organization = MOCK_ORGANIZATIONS.find((o) => o.id === "org_meridian")!;
  const permissions = effectivePermissions(
    { ...membership, status: "suspended" }, organization);
  assert.equal(permissions.size, 0);
});

test("nobody can delegate access they do not hold", () => {
  const dispatcher = serviceContext("mem_meridian_dispatcher");
  const grantable = new Set(grantablePermissionKeys(dispatcher.permissions, "DISPATCH_AGENCY"));

  for (const key of grantable) {
    assert.ok(dispatcher.permissions.has(key), `${key} is held before it can be given`);
  }
  assert.ok(!grantable.has("rates:view"));
});

/* -------------------------------------------------------------------------- */
/* Seed templates                                                              */
/* -------------------------------------------------------------------------- */

test("every seeded template names only real permissions", () => {
  const known = new Set<string>(PERMISSION_CATALOG.map((p) => p.key));
  for (const template of seedTemplates("org_test")) {
    for (const key of template.permissions) {
      assert.ok(known.has(key), `${template.name} references a real key: ${key}`);
    }
  }
});

test("the Driver template stays minimal", () => {
  const driver = seedTemplates("org_test").find((t) => t.name === "Driver")!;
  // A driver can report what is wrong with their truck...
  assert.ok(driver.permissions.includes("maintenance:defects:report"));
  // ...and never runs the shop, sees the money, or parks equipment.
  assert.ok(!driver.permissions.includes("maintenance:repairs:manage"));
  assert.ok(!driver.permissions.includes("maintenance:costs:view"));
  assert.ok(!driver.permissions.includes("maintenance:outofservice:manage"));
  assert.ok(!driver.permissions.includes("maintenance:manage"));
});

test("the Dispatcher template gains no maintenance power beyond looking", () => {
  const dispatcher = seedTemplates("org_test").find((t) => t.name === "Dispatcher")!;
  const maintenance = dispatcher.permissions.filter((k) => k.startsWith("maintenance:"));
  assert.deepEqual(maintenance, ["maintenance:view"]);
  assert.ok(!dispatcher.permissions.includes("rates:view"), "still does not see what a load pays");
});

/* -------------------------------------------------------------------------- */
/* Route manifest                                                              */
/* -------------------------------------------------------------------------- */

test("the route manifest requires only real permissions", () => {
  const known = new Set<string>(PERMISSION_CATALOG.map((p) => p.key));
  for (const [route, required] of Object.entries(ROUTE_MANIFEST)) {
    for (const key of required) {
      assert.ok(known.has(key), `${route} requires a real key: ${key}`);
    }
  }
});

test("the longest matching route prefix still wins", () => {
  assert.deepEqual(requiredPermissionsForPath("/loads/ld_123"), ["loads:view"]);
  assert.deepEqual(requiredPermissionsForPath("/fleet/trucks/new"), ["trucks:create"]);
  assert.deepEqual(requiredPermissionsForPath("/account/profile"), []);
});

test("maintenance routes are gated", () => {
  assert.deepEqual(requiredPermissionsForPath("/maintenance"), ["maintenance:view"]);
  assert.deepEqual(
    requiredPermissionsForPath("/maintenance/truck/abc-123"),
    ["maintenance:view"],
    "a deep maintenance route inherits the gate",
  );
});

/* -------------------------------------------------------------------------- */
/* Seed and organization partitioning                                          */
/* -------------------------------------------------------------------------- */

test("every organization a membership points at is seeded", () => {
  const seed = buildSeed();
  for (const membership of MOCK_MEMBERSHIPS) {
    assert.ok(
      seed[membership.organizationId],
      `${membership.organizationId} has seed data, so its screens do not throw`,
    );
  }
});

test("seeded records belong to the organization that holds them", () => {
  for (const [organizationId, data] of Object.entries(buildSeed())) {
    for (const load of data.loads) assert.equal(load.organizationId, organizationId);
    for (const item of data.needsYou) assert.equal(item.organizationId, organizationId);
    for (const driver of data.drivers) assert.equal(driver.organizationId, organizationId);
  }
});

/* -------------------------------------------------------------------------- */
/* Equipment registries still behave                                           */
/* -------------------------------------------------------------------------- */

test("the fleet is still derived from relationships, not from record creation", () => {
  const northline = truckContextFrom(serviceContext("mem_northline_owner"));
  const fleet = fleetSync(northline);

  assert.ok(fleet.length > 0);
  // nl121's relationship is only pending, so it is not part of the fleet.
  assert.ok(!fleet.some((t) => t.truckId === TRUCK_IDS.nl121));
  assert.equal(accessReason(TRUCK_IDS.nl121, northline), "pending_relationship");
});

test("a truck belonging to nobody the caller knows is invisible", () => {
  const cascade = truckContextFrom(serviceContext("mem_cascade_driver"));
  assert.equal(accessReason(TRUCK_IDS.nl115, cascade), null);
});

test("a driver membership sees only the truck it is assigned to", () => {
  const driver = truckContextFrom(serviceContext("mem_cascade_driver"));
  const fleet = fleetSync(driver);

  assert.equal(fleet.length, 1, "one truck, not the carrier's whole fleet");
  assert.equal(fleet[0].truckId, TRUCK_IDS.cs47);
});

test("trailer visibility never comes from a driver assignment", () => {
  const driver = serviceContext("mem_cascade_driver");
  const trailers = trailerFleetSync({
    organizationId: driver.organizationId,
    membershipId: driver.membershipId,
    actorName: driver.actor.displayNameSnapshot,
    permissions: driver.permissions,
    driverProfileId: driver.driverProfileId,
  });
  assert.equal(trailers.length, 0, "a driver on a truck gets no trailer fleet");
});

test("two carriers get two projections of one permanent truck, not two trucks", () => {
  const northline = truckContextFrom(serviceContext("mem_northline_owner"));
  const baxter = truckContextFrom(serviceContext("mem_baxter_owner"));

  const nl = fleetSync(northline).find((t) => t.truckId === TRUCK_IDS.nl104);
  const bx = fleetSync(baxter).find((t) => t.truckId === TRUCK_IDS.nl104);

  assert.ok(nl && bx, "both carriers see it");
  assert.equal(nl.truckId, bx.truckId, "the same permanent id");
  assert.notEqual(nl.unit, bx.unit, "each with its own unit number");
});
