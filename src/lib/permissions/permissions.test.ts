import { describe, expect, it } from "vitest";
import {
  MOCK_MEMBERSHIPS, MOCK_ORGANIZATIONS, } from "@/lib/session/fixtures";
import type { PermissionKey } from "@/types";
import { can, canAll, canAny } from "./can";
import { migrateKey, normalizePermissionKey } from "./catalog";
import {
  NEVER_GRANTABLE, PERMISSION_CATALOG, PERMISSION_GROUP_LABELS,
  PERMISSION_GROUP_ORDER, availablePermissionKeys, permissionMeta,
} from "./catalog";
import { effectivePermissions } from "./effective";
import { ALL_NAV_SECTIONS } from "@/config/nav";
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

describe("frozen extension-owned screens (plan 04)", () => {
  const navHrefs = ALL_NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href));

  it("are not in the navigation", () => {
    expect(navHrefs).not.toContain("/dispatch/opportunities");
    expect(navHrefs).not.toContain("/settings/learning");
  });

  it("keep their permission gates for deep links", () => {
    expect(requiredPermissionsForPath("/dispatch/opportunities")).toEqual(["loads:view", "trucks:view"]);
    expect(requiredPermissionsForPath("/settings/learning")).toEqual(["organization:manage"]);
  });
});

describe("people list keys match the backend (plan 06)", () => {
  it("maps each backend list permission to its own key", () => {
    expect(normalizePermissionKey("membership.list_drivers")).toBe("members:list_drivers");
    expect(normalizePermissionKey("membership.list_dispatchers")).toBe("members:list_dispatchers");
    expect(normalizePermissionKey("membership.list_admins")).toBe("members:list_admins");
    // Holding one list never implies another, nor the drivers record key.
    expect(normalizePermissionKey("membership.list")).toBe("members:view");
    // Plan 12: removing a member is gated on the "cut off access" key.
    expect(normalizePermissionKey("membership.remove")).toBe("members:suspend");
    expect(can(new Set<PermissionKey>(["members:list_drivers"]), "drivers:view")).toBe(false);
  });

  it("gates each people page on its own list key", () => {
    expect(requiredPermissionsForPath("/people/drivers")).toEqual(["members:list_drivers"]);
    expect(requiredPermissionsForPath("/people/drivers/u1")).toEqual(["members:list_drivers"]);
    expect(requiredPermissionsForPath("/people/dispatchers")).toEqual(["members:list_dispatchers"]);
    expect(requiredPermissionsForPath("/people/admins")).toEqual(["members:list_admins"]);
  });

  it("gives the Dispatcher template the drivers list only, like the backend default", () => {
    const dispatcher = SEED_TEMPLATES.find((t) => t.name === "Dispatcher")!;
    expect(dispatcher.permissions).toContain("members:list_drivers");
    expect(dispatcher.permissions).not.toContain("members:list_dispatchers");
    expect(dispatcher.permissions).not.toContain("members:list_admins");
  });
});

describe("people pages refuse callers without the list key (plan 06)", () => {
  const pagePermits = (held: readonly PermissionKey[], path: string) =>
    canAll(new Set(held), requiredPermissionsForPath(path));

  it("a Dispatcher opens Drivers but not Dispatchers or Admins", () => {
    const dispatcher = SEED_TEMPLATES.find((t) => t.name === "Dispatcher")!.permissions;
    expect(pagePermits(dispatcher, "/people/drivers")).toBe(true);
    expect(pagePermits(dispatcher, "/people/dispatchers")).toBe(false);
    expect(pagePermits(dispatcher, "/people/admins")).toBe(false);
  });

  it("members:view or drivers:view alone no longer opens the people lists", () => {
    for (const path of ["/people/drivers", "/people/dispatchers", "/people/admins"]) {
      expect(pagePermits(["members:view", "drivers:view"], path)).toBe(false);
    }
  });

  it("every list key is in the catalog, so the Owner holds it", () => {
    const keys = PERMISSION_CATALOG.map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining(["members:list_drivers", "members:list_dispatchers", "members:list_admins"]));
  });
});

describe("documents:review (plan 13)", () => {
  it("maps the backend's document.review both ways", () => {
    expect(normalizePermissionKey("document.review")).toBe("documents:review");
    expect(migrateKey("documents:review")).toBe("document.review");
  });

  it("is in the Dispatcher template, with its prerequisite", () => {
    const dispatcher = SEED_TEMPLATES.find((t) => t.name === "Dispatcher");
    expect(dispatcher?.permissions).toEqual(
      expect.arrayContaining(["documents:review", "documents:view"]),
    );
  });
});

describe("Rate Con routes (plan 13)", () => {
  it("gate upload and review on documents:review", async () => {
    const { requiredPermissionsForPath } = await import("./route-manifest");
    expect(requiredPermissionsForPath("/rate-cons/new")).toEqual(["documents:review"]);
    expect(
      requiredPermissionsForPath("/rate-cons/0b6f8c1e-2d3a-4f5b-9c7d-8e9f0a1b2c3d"),
    ).toEqual(["documents:review"]);
  });
});

