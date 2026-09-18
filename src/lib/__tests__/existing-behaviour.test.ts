import { describe, expect, it } from "vitest";
import { NotFoundError, PermissionDeniedError } from "@/lib/api/contracts/context";
import { mockHomeService } from "@/lib/api/mock/home";
import { mockLoadsService } from "@/lib/api/mock/loads";
import { PRODUCT_NAV } from "@/config/nav";
import { effectivePermissions } from "@/lib/permissions/effective";
import { requiredPermissionsForPath } from "@/lib/permissions/route-manifest";
import {
  MOCK_MEMBERSHIPS, MOCK_ORGANIZATIONS, } from "@/lib/session/fixtures";
import { contextFor, DRIVER, INDIVIDUAL_DISPATCHER, OWNER_CARRIER } from "@/lib/reports/__tests__/helpers";

/**
 * Behaviour that existed before reporting did. Reporting reads the Loads
 * module, the permission catalog, the route manifest and the seeded templates,
 * so these are the things a change to it could quietly break.
 */
describe("loads service — scope and redaction still hold", () => {
  it("narrows a driver membership to its own assigned loads", async () => {
    const ctx = contextFor(DRIVER);
    const page = await mockLoadsService.list(ctx, { view: "all" });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((l) => l.assignment?.driverId === ctx.driverProfileId)).toBe(true);
  });

  it("omits money entirely from a membership without rates:view", async () => {
    const page = await mockLoadsService.list(contextFor(INDIVIDUAL_DISPATCHER), { view: "all" });
    expect(page.items.every((l) => l.financials === undefined)).toBe(true);
  });

  it("keeps money for a membership that holds rates:view", async () => {
    const page = await mockLoadsService.list(contextFor(OWNER_CARRIER), { view: "all" });
    expect(page.items.some((l) => l.financials !== undefined)).toBe(true);
  });

  it("answers 'not found' for a load in another organization", async () => {
    const other = await mockLoadsService.list(contextFor(INDIVIDUAL_DISPATCHER), { view: "all" });
    await expect(
      mockLoadsService.get(contextFor(OWNER_CARRIER), other.items[0].id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses documents without documents:view", async () => {
    const ctx = contextFor(OWNER_CARRIER);
    const page = await mockLoadsService.list(ctx, { view: "all" });
    const blind = {
      ...ctx,
      permissions: new Set([...ctx.permissions].filter((p) => p !== "documents:view")),
    };
    await expect(
      mockLoadsService.documents(blind, page.items[0].id),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe("home summary — unchanged by reporting", () => {
  it("gives an owner the financial block and withholds it from a rate-blind membership", async () => {
    const owner = await mockHomeService.summary(contextFor(OWNER_CARRIER));
    expect(owner.financials).not.toBeNull();

    const dispatcher = await mockHomeService.summary(contextFor(INDIVIDUAL_DISPATCHER));
    expect(dispatcher.financials).toBeNull();
  });
});

describe("permissions", () => {
  it("still gives an owner everything available to the organization type", () => {
    const membership = MOCK_MEMBERSHIPS.find((m) => m.id === OWNER_CARRIER)!;
    const organization = MOCK_ORGANIZATIONS.find((o) => o.id === membership.organizationId)!;
    const permissions = effectivePermissions(membership, organization);
    expect(permissions.has("reports:view")).toBe(true);
    expect(permissions.has("revenue:view")).toBe(true);
  });

  it("still applies template ∪ grants − revocations", () => {
    const permissions = contextFor(INDIVIDUAL_DISPATCHER).permissions;
    expect(permissions.has("customers:edit")).toBe(true); // explicit grant
    expect(permissions.has("loads:delete")).toBe(false); // explicit revocation
    expect(permissions.has("loads:view")).toBe(true); // from the template
  });

  it("gives the seeded dispatcher template their own reports but not the organization's", () => {
    const permissions = contextFor(INDIVIDUAL_DISPATCHER).permissions;
    expect(permissions.has("reports:view")).toBe(true);
    expect(permissions.has("revenue:view")).toBe(false);
    expect(permissions.has("rates:view")).toBe(false);
  });

  it("leaves a driver membership out of reporting altogether", () => {
    const permissions = contextFor(DRIVER).permissions;
    expect(permissions.has("reports:view")).toBe(false);
  });
});

describe("routes and navigation", () => {
  it("gates the reports routes on the reporting permission", () => {
    expect(requiredPermissionsForPath("/reports")).toEqual(["reports:view"]);
    // A report's own route inherits the section's requirement.
    expect(requiredPermissionsForPath("/reports/carrier_revenue")).toEqual(["reports:view"]);
  });

  it("leaves the other routes as they were", () => {
    expect(requiredPermissionsForPath("/loads")).toEqual(["loads:view"]);
    expect(requiredPermissionsForPath("/loads/ld_0001")).toEqual(["loads:view"]);
    expect(requiredPermissionsForPath("/finance/invoices")).toEqual(["invoices:view"]);
    expect(requiredPermissionsForPath("/fleet/trucks")).toEqual(["trucks:view"]);
  });

  it("shows the Reports nav item to the membership the route admits", () => {
    const item = PRODUCT_NAV.flatMap((s) => s.items).find((i) => i.href === "/reports")!;
    expect(item.requires).toEqual(["reports:view"]);
    expect(item.requires.every((p) => contextFor(INDIVIDUAL_DISPATCHER).permissions.has(p))).toBe(true);
    expect(item.requires.every((p) => contextFor(DRIVER).permissions.has(p))).toBe(false);
  });
});
