import { beforeEach, describe, expect, it } from "vitest";
import {
  NEVER_GRANTABLE, PERMISSION_CATALOG, PERMISSION_GROUP_LABELS, PERMISSION_GROUP_ORDER,
  availablePermissionKeys, permissionMeta,
} from "@/lib/permissions/catalog";
import { SEED_TEMPLATES, seedTemplates } from "@/lib/permissions/templates";
import { effectivePermissions } from "@/lib/permissions/effective";
import { ROUTE_MANIFEST, requiredPermissionsForPath } from "@/lib/permissions/route-manifest";
import { ALL_NAV_SECTIONS, PRODUCT_NAV } from "@/config/nav";
import { mockNeedsYouService } from "@/lib/api/mock/needs-you";
import { mockStore } from "@/lib/api/mock/store";
import { fleetSync, resetTruckRegistry, truckContextFrom } from "@/lib/api/mock/truck-registry";
import { resetTrailerRegistry, trailerFleetSync } from "@/lib/api/mock/trailer-registry";
import { resetFleetTelemetry } from "@/lib/api/mock/fleet-telemetry";
import { trailerContextFrom } from "@/lib/api/mock/fleet-operations";
import {
  MOCK_MEMBERSHIPS, MOCK_ORGANIZATIONS, MOCK_TEMPLATES,
} from "@/lib/session/fixtures";
import type { PermissionKey } from "@/types";
import { MERIDIAN_DISPATCHER, NORTHLINE_OWNER, contextFor } from "../helpers/context";

beforeEach(() => {
  mockStore.reset();
  resetTruckRegistry();
  resetTrailerRegistry();
  resetFleetTelemetry();
});

/**
 * The invariants the permission system already had, re-asserted now that two
 * keys and a group have been added to it. Adding to a catalog is exactly the
 * kind of change that quietly breaks a group label or a template.
 */
describe("the permission catalog still holds together", () => {
  it("has no duplicate keys", () => {
    const keys = PERMISSION_CATALOG.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("labels and orders every group exactly once", () => {
    const groups = new Set(PERMISSION_CATALOG.map((p) => p.group));
    for (const g of groups) {
      expect(PERMISSION_GROUP_LABELS[g], `label for ${g}`).toBeTruthy();
      expect(PERMISSION_GROUP_ORDER).toContain(g);
    }
    expect(new Set(PERMISSION_GROUP_ORDER).size).toBe(PERMISSION_GROUP_ORDER.length);
    expect(PERMISSION_GROUP_ORDER.length).toBe(Object.keys(PERMISSION_GROUP_LABELS).length);
  });

  it("gives every key a plain-language description", () => {
    for (const p of PERMISSION_CATALOG) {
      expect(p.label.length).toBeGreaterThan(3);
      expect(p.description.length).toBeGreaterThan(15);
      expect(permissionMeta(p.key)).toBe(p);
    }
  });

  it("keeps the never-grantable powers out of the catalog", () => {
    const keys = new Set<string>(PERMISSION_CATALOG.map((p) => p.key));
    for (const n of NEVER_GRANTABLE) expect(keys.has(n.id)).toBe(false);
  });

  it("registers the two new fleet keys and nothing more", () => {
    const fleetKeys = PERMISSION_CATALOG.filter((p) => p.group === "fleet").map((p) => p.key);
    expect(fleetKeys).toEqual(["fleet:view", "fleet:telemetry:record"]);
    // Neither is an alias for an existing power: assigning drivers and
    // attaching trailers still belong to the modules that own those records.
    expect(fleetKeys).not.toContain("trucks:assignments:manage");
    expect(fleetKeys).not.toContain("trailers:attachments:manage");
  });

  it("offers the fleet keys to both organization types", () => {
    for (const type of ["CARRIER", "DISPATCH_AGENCY"] as const) {
      const keys = availablePermissionKeys(type);
      expect(keys).toContain("fleet:view");
      expect(keys).toContain("fleet:telemetry:record");
    }
    // While the carrier-only keys stay carrier-only.
    expect(availablePermissionKeys("DISPATCH_AGENCY")).not.toContain("trucks:create");
  });
});

describe("seed templates still reference only real keys", () => {
  it("never names a key that is not in the catalog", () => {
    const known = new Set<string>(PERMISSION_CATALOG.map((p) => p.key));
    for (const t of SEED_TEMPLATES) {
      for (const k of t.permissions) expect(known.has(k), `${t.name} → ${k}`).toBe(true);
    }
  });

  it("leaves the Driver template minimal", () => {
    const driver = SEED_TEMPLATES.find((t) => t.name === "Driver")!;
    expect(driver.permissions).not.toContain("fleet:view");
    // trucks:view IS granted, deliberately: a driver has to reach their own
    // assigned truck to report a fault on it. What stays out is the fleet
    // dashboard and anything that lets them manage equipment.
    expect(driver.permissions).not.toContain("trucks:manage");
  });

  it("gives dispatch, safety and maintenance the fleet dashboard", () => {
    for (const name of ["Dispatcher", "Safety", "Maintenance"]) {
      const t = SEED_TEMPLATES.find((x) => x.name === name)!;
      expect(t.permissions, name).toContain("fleet:view");
    }
  });

  it("still builds one set of templates per organization", () => {
    const built = seedTemplates("org_test");
    expect(built).toHaveLength(SEED_TEMPLATES.length);
    expect(built.every((t) => t.organizationId === "org_test")).toBe(true);
  });
});

describe("effective permissions are unchanged in shape", () => {
  it("gives an owner everything available to the organization type", () => {
    const membership = MOCK_MEMBERSHIPS.find((m) => m.id === NORTHLINE_OWNER)!;
    const org = MOCK_ORGANIZATIONS.find((o) => o.id === membership.organizationId)!;
    const effective = effectivePermissions(membership, org, MOCK_TEMPLATES);
    expect(effective.size).toBe(availablePermissionKeys(org.type).length);
    expect(effective.has("fleet:view")).toBe(true);
  });

  it("still honours a revocation over a template grant", () => {
    const membership = MOCK_MEMBERSHIPS.find((m) => m.id === MERIDIAN_DISPATCHER)!;
    const org = MOCK_ORGANIZATIONS.find((o) => o.id === membership.organizationId)!;
    const effective = effectivePermissions(membership, org, MOCK_TEMPLATES);
    expect(effective.has("loads:delete")).toBe(false);   // revoked
    expect(effective.has("customers:edit")).toBe(true);  // granted
    expect(effective.has("rates:view")).toBe(false);     // never granted
  });

  it("grants a suspended membership nothing", () => {
    const membership = MOCK_MEMBERSHIPS.find((m) => m.id === MERIDIAN_DISPATCHER)!;
    const org = MOCK_ORGANIZATIONS.find((o) => o.id === membership.organizationId)!;
    const suspended = { ...membership, status: "suspended" as const };
    expect(effectivePermissions(suspended, org, MOCK_TEMPLATES).size).toBe(0);
  });
});

describe("routing and navigation stay in step", () => {
  it("derives a manifest entry for every nav item", () => {
    for (const section of ALL_NAV_SECTIONS) {
      for (const item of section.items) {
        expect(ROUTE_MANIFEST[item.href], item.href).toBeDefined();
        expect(ROUTE_MANIFEST[item.href]).toEqual(item.requires);
      }
    }
  });

  it("gates the fleet routes on fleet:view", () => {
    expect(requiredPermissionsForPath("/fleet")).toEqual(["fleet:view"]);
    expect(requiredPermissionsForPath("/fleet/equipment/truck/abc")).toEqual(["fleet:view"]);
  });

  it("leaves the trucks and trailers routes on their own permissions", () => {
    // Longest prefix wins, so the new /fleet entry must not swallow these.
    expect(requiredPermissionsForPath("/fleet/trucks")).toEqual(["trucks:view"]);
    expect(requiredPermissionsForPath("/fleet/trucks/abc")).toEqual(["trucks:view"]);
    expect(requiredPermissionsForPath("/fleet/trucks/new")).toEqual(["trucks:create"]);
    expect(requiredPermissionsForPath("/fleet/trailers")).toEqual(["trailers:view"]);
  });

  it("names every nav permission in the catalog", () => {
    const known = new Set<PermissionKey>(PERMISSION_CATALOG.map((p) => p.key));
    for (const section of ALL_NAV_SECTIONS) {
      for (const item of section.items) {
        for (const k of item.requires) expect(known.has(k), `${item.href} → ${k}`).toBe(true);
      }
    }
  });

  it("puts Fleet in the fleet section without displacing Trucks or Trailers", () => {
    const fleetSection = PRODUCT_NAV.find((s) => s.id === "fleet")!;
    const hrefs = fleetSection.items.map((i) => i.href);
    expect(hrefs).toContain("/fleet");
    expect(hrefs).toContain("/fleet/trucks");
    expect(hrefs).toContain("/fleet/trailers");
  });
});

describe("the modules the fleet layer reads are untouched", () => {
  it("still serves the existing Needs You queue", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const items = await mockNeedsYouService.list(ctx);
    // The seeded non-fleet items are all still there and still sorted by urgency.
    const seeded = items.filter((i) => !i.id.startsWith("ny_fleet_"));
    expect(seeded.length).toBeGreaterThan(0);
    const severities = items.map((i) => i.severity);
    const rank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
    for (let i = 1; i < severities.length; i += 1) {
      expect(rank[severities[i]]).toBeGreaterThanOrEqual(rank[severities[i - 1]]);
    }
  });

  it("still filters the queue by severity and by owner", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const critical = await mockNeedsYouService.list(ctx, { severity: ["critical"] });
    expect(critical.every((i) => i.severity === "critical")).toBe(true);
    const unassigned = await mockNeedsYouService.list(ctx, { owner: "unassigned" });
    expect(unassigned.every((i) => !i.assigneeMembershipId)).toBe(true);
  });

  it("still refuses to park a critical item behind a long snooze", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const items = await mockNeedsYouService.list(ctx, { severity: ["critical"] });
    if (!items.length) return;
    await expect(mockNeedsYouService.snooze(ctx, items[0].id, {
      hours: 48, reason: "Later.",
    })).rejects.toThrow(/at most 2 hours/);
  });

  it("still returns the truck and trailer rosters the equipment screens use", () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const trucks = fleetSync(truckContextFrom(ctx));
    const trailers = trailerFleetSync(trailerContextFrom(ctx));
    expect(trucks.length).toBeGreaterThan(0);
    expect(trailers.length).toBeGreaterThan(0);
    // Every row is a projection keyed by the permanent id, as before.
    expect(trucks.every((t) => t.id === t.truckId)).toBe(true);
    expect(trailers.every((t) => t.id === t.trailerId)).toBe(true);
  });

  it("builds a trailer context the same way the truck one is built", () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const truckCtx = truckContextFrom(ctx);
    const trailerCtx = trailerContextFrom(ctx);
    // The organization always comes from the membership, never from a caller.
    expect(trailerCtx.organizationId).toBe(ctx.organizationId);
    expect(trailerCtx.organizationId).toBe(truckCtx.organizationId);
    expect(trailerCtx.membershipId).toBe(truckCtx.membershipId);
    expect(trailerCtx.actorName).toBe(truckCtx.actorName);
    expect(trailerCtx.driverProfileId).toBe(truckCtx.driverProfileId);
  });
});
