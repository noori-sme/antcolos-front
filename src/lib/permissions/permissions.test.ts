import { describe, expect, it } from "vitest";
import {
  MOCK_MEMBERSHIPS, MOCK_ORGANIZATIONS, } from "@/lib/session/fixtures";
import type { PermissionKey } from "@/types";
import { can, canAll, canAny } from "./can";
import {
  NEVER_GRANTABLE, PERMISSION_CATALOG, PERMISSION_GROUP_LABELS,
  PERMISSION_GROUP_ORDER, availablePermissionKeys, permissionMeta,
} from "./catalog";
import { effectivePermissions } from "./effective";
import { requiredPermissionsForPath } from "./route-manifest";
import { SEED_TEMPLATES } from "./templates";

/**
 * The permission system is shared by every module, so a change made for fuel
 * has to leave it exactly as it was for everything else. These assert the
 * invariants the whole product depends on, fuel included.
 */

const org = (id: string) => MOCK_ORGANIZATIONS.find((o) => o.id === id)!;
const membership = (id: string) => MOCK_MEMBERSHIPS.find((m) => m.id === id)!;

describe("the catalog", () => {
  it("has no duplicate keys", () => {
    const keys = PERMISSION_CATALOG.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("puts every key in a group that is labelled and ordered", () => {
    for (const meta of PERMISSION_CATALOG) {
      expect(PERMISSION_GROUP_LABELS[meta.group]).toBeTruthy();
      expect(PERMISSION_GROUP_ORDER).toContain(meta.group);
    }
    expect(new Set(PERMISSION_GROUP_ORDER).size).toBe(PERMISSION_GROUP_ORDER.length);
  });

  it("describes every key in plain language", () => {
    for (const meta of PERMISSION_CATALOG) {
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.description.length).toBeGreaterThan(10);
    }
  });

  it("never exposes a reserved owner power as a grantable permission", () => {
    const keys = new Set<string>(PERMISSION_CATALOG.map((p) => p.key));
    for (const reserved of NEVER_GRANTABLE) {
      expect(keys.has(reserved.id)).toBe(false);
    }
  });

  it("keeps fleet-editing keys away from dispatch organizations", () => {
    const dispatch = availablePermissionKeys("DISPATCH_AGENCY");
    expect(dispatch).not.toContain("trucks:create");
    expect(dispatch).not.toContain("trailers:delete");
    expect(availablePermissionKeys("CARRIER")).toContain("trucks:create");
  });

  it("marks the money keys as financial, fuel cost included", () => {
    const financial = PERMISSION_CATALOG.filter((p) => p.financial).map((p) => p.key);
    expect(financial).toEqual(
      expect.arrayContaining(["rates:view", "revenue:view", "fuel:costs:view", "ifta:manage"]),
    );
  });

  it("throws rather than guessing on an unknown key", () => {
    expect(() => permissionMeta("nope:view" as PermissionKey)).toThrow(/Unknown permission/);
  });
});

describe("effective permissions", () => {
  it("gives an active owner everything their organization type allows", () => {
    const effective = effectivePermissions(
      membership("mem_northline_owner"), org("org_northline"));
    expect(effective.size).toBe(availablePermissionKeys("CARRIER").length);
    expect(effective.has("fuel:view")).toBe(true);
    expect(effective.has("ifta:manage")).toBe(true);
  });

  it("applies template, then grant, then revocation — in that order", () => {
    const effective = effectivePermissions(
      membership("mem_meridian_dispatcher"), org("org_meridian"));
    expect(effective.has("loads:view")).toBe(true);        // template
    expect(effective.has("customers:edit")).toBe(true);    // explicit grant
    expect(effective.has("loads:delete")).toBe(false);     // explicit revocation
    expect(effective.has("rates:view")).toBe(false);       // never granted
  });

  it("gives a suspended or departed membership nothing at all", () => {
    const suspended = { ...membership("mem_northline_owner"), status: "suspended" as const };
    expect(effectivePermissions(suspended, org("org_northline")).size).toBe(0);
  });

  it("gives a seat nothing when it is read against another organization", () => {
    // The snapshot on this seat is Northline's. Reading it against Meridian
    // must not produce Meridian access — a template's permissions are keys,
    // and keys mean nothing outside the organization the seat belongs to.
    const northlineSeat = membership("mem_northline_owner");
    expect(effectivePermissions(northlineSeat, org("org_meridian")).size).toBe(0);
  });
});

describe("seeded templates", () => {
  it("gives a dispatcher operational fuel but never tax access", () => {
    const dispatcher = SEED_TEMPLATES.find((t) => t.name === "Dispatcher")!;
    expect(dispatcher.permissions).toContain("fuel:view");
    expect(dispatcher.permissions).not.toContain("ifta:view");
    expect(dispatcher.permissions).not.toContain("ifta:manage");
    expect(dispatcher.permissions).not.toContain("fuel:costs:view");
  });

  it("keeps tax management to the one template that is meant to carry it", () => {
    const withIftaManage = SEED_TEMPLATES.filter((t) => t.permissions.includes("ifta:manage"));
    expect(withIftaManage.map((t) => t.name)).toEqual(["Fuel and tax"]);
  });

  it("still leaves the Driver template scoped to its own work", () => {
    const driver = SEED_TEMPLATES.find((t) => t.name === "Driver")!;
    expect(driver.permissions).not.toContain("fuel:view");
    expect(driver.permissions).not.toContain("rates:view");
  });

  it("only ever lists keys that exist in the catalog", () => {
    const keys = new Set<string>(PERMISSION_CATALOG.map((p) => p.key));
    for (const template of SEED_TEMPLATES) {
      for (const key of template.permissions) expect(keys.has(key)).toBe(true);
    }
  });
});

describe("can()", () => {
  const set = new Set<PermissionKey>(["loads:view", "fuel:view"]);
  it("answers from the permission set and nothing else", () => {
    expect(can(set, "loads:view")).toBe(true);
    expect(can(set, "loads:delete")).toBe(false);
    expect(canAll(set, ["loads:view", "fuel:view"])).toBe(true);
    expect(canAll(set, ["loads:view", "ifta:view"])).toBe(false);
    expect(canAny(set, ["ifta:view", "fuel:view"])).toBe(true);
    expect(canAny(set, [])).toBe(true);
  });
});

describe("the route manifest", () => {
  it("still guards the routes it guarded before", () => {
    expect(requiredPermissionsForPath("/loads")).toEqual(["loads:view"]);
    expect(requiredPermissionsForPath("/fleet/trucks")).toEqual(["trucks:view"]);
    expect(requiredPermissionsForPath("/home")).toEqual([]);
  });

  it("guards the new fuel routes, each with its own key", () => {
    expect(requiredPermissionsForPath("/fuel")).toEqual(["fuel:view"]);
    expect(requiredPermissionsForPath("/fuel/transactions")).toEqual(["fuel:view"]);
    expect(requiredPermissionsForPath("/fuel/mileage")).toEqual(["mileage:view"]);
    expect(requiredPermissionsForPath("/fuel/ifta")).toEqual(["ifta:view"]);
  });

  it("lets the longest matching prefix win, so a detail page inherits its list", () => {
    expect(requiredPermissionsForPath("/fuel/ifta/ifta_org_a_2026Q2")).toEqual(["ifta:view"]);
    expect(requiredPermissionsForPath("/fuel/transactions/fuel_0001")).toEqual(["fuel:view"]);
    expect(requiredPermissionsForPath("/loads/ld_1")).toEqual(["loads:view"]);
  });
});
