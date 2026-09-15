import { beforeEach, describe, expect, it } from "vitest";
import { services } from "@/lib/api";
import {
  PERMISSION_CATALOG, PERMISSION_GROUP_LABELS, PERMISSION_GROUP_ORDER,
  availablePermissionKeys,
} from "@/lib/permissions/catalog";
import { requiredPermissionsForPath } from "@/lib/permissions/route-manifest";
import { SEED_TEMPLATES } from "@/lib/permissions/templates";
import { ALL_NAV_SECTIONS } from "@/config/nav";
import type { PermissionKey } from "@/types";
import {
  CASCADE_DRIVER, MERIDIAN_DISPATCHER, NORTHLINE_OWNER, contextFor,
  resetAuditAndRisk, risk, riskWorker, signalWith, openCaseFor,
} from "./helpers";

/**
 * What this branch must NOT have changed.
 *
 * The audit ledger reads other modules' histories. The one thing that would
 * make it a liability is if reading them changed them, or if adding a
 * permission group quietly widened somebody's access.
 */

beforeEach(resetAuditAndRisk);

describe("the permission catalog is still coherent", () => {
  it("has no duplicate keys and labels every group", () => {
    const keys = PERMISSION_CATALOG.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const permission of PERMISSION_CATALOG) {
      expect(PERMISSION_GROUP_LABELS[permission.group]).toBeTruthy();
      expect(PERMISSION_GROUP_ORDER).toContain(permission.group);
    }
    expect(new Set(PERMISSION_GROUP_ORDER).size).toBe(PERMISSION_GROUP_ORDER.length);
  });

  it("registers the new keys and gives an owner all of them", () => {
    const owner = contextFor(NORTHLINE_OWNER);
    const added: PermissionKey[] = [
      "audit:export", "risk:view", "risk:assign", "risk:investigate", "risk:resolve",
    ];
    for (const key of added) {
      expect(PERMISSION_CATALOG.some((p) => p.key === key), key).toBe(true);
      expect(owner.permissions.has(key), key).toBe(true);
      expect(availablePermissionKeys("DISPATCH_AGENCY")).toContain(key);
    }
  });

  it("does not hand the new powers to anybody who did not already do this work", () => {
    // A dispatcher moves freight. A driver drives. Neither investigates.
    const dispatcher = SEED_TEMPLATES.find((t) => t.name === "Dispatcher")!;
    const driver = SEED_TEMPLATES.find((t) => t.name === "Driver")!;
    for (const template of [dispatcher, driver]) {
      for (const key of ["audit:view", "audit:export", "risk:view", "risk:investigate", "risk:resolve"]) {
        expect(template.permissions as readonly string[], template.name).not.toContain(key);
      }
    }

    // Reading a flagged concern and closing an investigation stay separate.
    const safety = SEED_TEMPLATES.find((t) => t.name === "Safety")!;
    expect(safety.permissions).toContain("risk:view");
    expect(safety.permissions as readonly string[]).not.toContain("risk:resolve");
  });

  it("still withholds rates:view from the Meridian dispatcher", () => {
    const ctx = contextFor(MERIDIAN_DISPATCHER);
    expect(ctx.permissions.has("rates:view")).toBe(false);
    expect(ctx.permissions.has("risk:investigate")).toBe(false);
    expect(ctx.permissions.has("customers:edit")).toBe(true);
  });

  it("keeps a driver membership out of the ledger and out of risk", () => {
    const driver = contextFor(CASCADE_DRIVER);
    expect(driver.permissions.has("audit:view")).toBe(false);
    expect(driver.permissions.has("risk:view")).toBe(false);
    expect(driver.scope.loads).toBe("assigned");
  });
});

describe("routes still gate the way the nav says they do", () => {
  it("leaves the existing routes where they were", () => {
    expect(requiredPermissionsForPath("/loads")).toEqual(["loads:view"]);
    expect(requiredPermissionsForPath("/loads/abc")).toEqual(["loads:view"]);
    expect(requiredPermissionsForPath("/compliance")).toEqual(["compliance:view"]);
    expect(requiredPermissionsForPath("/finance/settlements")).toEqual(["settlements:view"]);
  });

  it("gates the new routes, and inherits on nested paths", () => {
    expect(requiredPermissionsForPath("/audit")).toEqual(["audit:view"]);
    expect(requiredPermissionsForPath("/audit/events")).toEqual(["audit:view"]);
    expect(requiredPermissionsForPath("/audit/events/aev_1")).toEqual(["audit:view"]);
    expect(requiredPermissionsForPath("/audit/signals")).toEqual(["risk:view"]);
    expect(requiredPermissionsForPath("/audit/cases")).toEqual(["risk:view"]);
    expect(requiredPermissionsForPath("/audit/cases/rc_1")).toEqual(["risk:view"]);
  });

  it("keeps the settings audit page on the same key it always had", () => {
    expect(requiredPermissionsForPath("/settings/audit")).toEqual(["audit:view"]);
  });

  it("gives every nav item a route that resolves to its own requirements", () => {
    for (const section of ALL_NAV_SECTIONS) {
      for (const item of section.items) {
        expect(requiredPermissionsForPath(item.href), item.href).toEqual(item.requires);
      }
    }
  });
});

describe("reading a module's history does not change it", () => {
  it("leaves each module's own audit trail exactly where it was", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);

    const fuelBefore = await services.fuel.audit(ctx);
    const invoicesBefore = await services.invoices.list(ctx, undefined, undefined, { limit: 50 });
    const complianceBefore = await services.compliance.list(ctx, {});

    // Project everything into the ledger, twice.
    await services.audit.list(ctx, { limit: 1000 });
    await services.audit.list(ctx, { limit: 1000 });

    const fuelAfter = await services.fuel.audit(ctx);
    const invoicesAfter = await services.invoices.list(ctx, undefined, undefined, { limit: 50 });
    const complianceAfter = await services.compliance.list(ctx, {});

    expect(fuelAfter).toEqual(fuelBefore);
    expect(invoicesAfter.items.map((i) => i.audit)).toEqual(
      invoicesBefore.items.map((i) => i.audit),
    );
    expect(complianceAfter.map((r) => r.history)).toEqual(
      complianceBefore.map((r) => r.history),
    );
  });

  it("keeps the module as the authority: the projection points back at its record", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const page = await services.audit.list(ctx, {
      limit: 1000,
      filters: { module: ["fuel"] },
    });
    const projected = page.items.filter((e) => e.projection);
    expect(projected.length).toBeGreaterThan(0);

    const fuelEntries = await services.fuel.audit(ctx);
    const fuelIds = new Set(fuelEntries.map((e) => e.id));
    for (const event of projected) {
      expect(fuelIds.has(event.projection!.entryId!)).toBe(true);
    }
  });
});

describe("the other Needs You producers are untouched", () => {
  it("still produces the same queue for a membership with no risk access", async () => {
    const driver = contextFor(CASCADE_DRIVER);
    const before = await services.needsYou.list(driver);

    // Do a full round of risk work in another organization.
    const ctx = riskWorker();
    const opened = await openCaseFor(ctx, await signalWith(ctx, (s) => s.severity === "critical"));
    await risk.assign(ctx, opened.id, ctx.membershipId);

    const after = await services.needsYou.list(driver);
    expect(after.map((i) => i.id)).toEqual(before.map((i) => i.id));
  });
});
