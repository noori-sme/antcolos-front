import { beforeEach, describe, expect, it } from "vitest";
import { contextFor } from "@/test/context";
import { PermissionDeniedError } from "../contracts/context";
import { mockFuelService, mockIftaService } from "./fuel";
import { fuelDb, resetFuelStore } from "./fuel-store";
import { mockStore } from "./store";
import { resetTruckRegistry, TRUCK_IDS } from "./truck-registry";

/**
 * The service layer is the boundary, so this is where the important tests are.
 *
 * Everything below asserts a refusal or a redaction that the UI cannot be
 * trusted to perform: hiding a button is a courtesy, and these are the rules.
 */

beforeEach(() => {
  resetTruckRegistry();
  resetFuelStore();
  mockStore.reset();
});

const ownerCtx = () => contextFor("org_northline");
const baxterCtx = () => contextFor("org_baxter");
const dispatcherCtx = () => contextFor("org_meridian");

describe("permission gate", () => {
  it("refuses every read without fuel:view", async () => {
    const ctx = contextFor("org_northline", { permissions: [] });
    await expect(mockFuelService.dashboard(ctx)).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(mockFuelService.listTransactions(ctx)).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(mockFuelService.audit(ctx)).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("refuses a manual purchase without fuel:record, even holding fuel:view", async () => {
    const ctx = contextFor("org_northline", { permissions: ["fuel:view"] });
    await expect(
      mockFuelService.recordTransaction(ctx, {
        truckId: TRUCK_IDS.nl104,
        purchasedAt: new Date(Date.now() - 3_600_000).toISOString(),
        location: { jurisdiction: "IL", address: { city: "Chicago", state: "IL" } },
        fuelType: "gasoline",
        gallonsThousandths: 40_000,
        pricePerGallonMills: 3_499,
        totalCostCents: 13_996,
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("refuses review and correction to somebody who may only look", async () => {
    const ctx = contextFor("org_northline", { permissions: ["fuel:view"] });
    const [any] = await mockFuelService.listTransactions(ownerCtx());
    await expect(mockFuelService.verifyTransaction(ctx, any.id)).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(
      mockFuelService.correctTransaction(ctx, any.id, { reason: "no" }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("refuses mileage reads without mileage:view, separately from fuel", async () => {
    const ctx = contextFor("org_northline", { permissions: ["fuel:view"] });
    await expect(mockFuelService.listMileage(ctx)).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe("organization isolation", () => {
  it("never returns another carrier's purchases", async () => {
    const northline = await mockFuelService.listTransactions(ownerCtx());
    const baxter = await mockFuelService.listTransactions(baxterCtx());
    expect(northline.length).toBeGreaterThan(0);
    expect(baxter.length).toBeGreaterThan(0);
    expect(northline.every((t) => t.organizationId === "org_northline")).toBe(true);
    expect(baxter.every((t) => t.organizationId === "org_baxter")).toBe(true);
  });

  it("answers 'not found' for another organization's record, not 'forbidden'", async () => {
    const [theirs] = await mockFuelService.listTransactions(baxterCtx());
    await expect(mockFuelService.getTransaction(ownerCtx(), theirs.id)).rejects.toThrow(/not found/i);
  });

  it("keeps two carriers' records on the SAME permanent truck completely apart", async () => {
    // Baxter runs Northline's 104 under its own authority as BX-04.
    const northline = await mockFuelService.listTransactions(ownerCtx(), { truckId: TRUCK_IDS.nl104 });
    const baxter = await mockFuelService.listTransactions(baxterCtx(), { truckId: TRUCK_IDS.nl104 });

    expect(northline.length).toBeGreaterThan(0);
    expect(baxter.length).toBeGreaterThan(0);
    expect(new Set(northline.map((t) => t.id))).not.toEqual(new Set(baxter.map((t) => t.id)));
    expect(northline.every((t) => t.attribution.carrierOrganizationId === "org_northline")).toBe(true);
    expect(baxter.every((t) => t.attribution.carrierOrganizationId === "org_baxter")).toBe(true);
  });
});

describe("relationship and operating-authority scope", () => {
  it("only returns purchases for trucks the organization still has a relationship with", async () => {
    const rows = await mockFuelService.listTransactions(ownerCtx());
    // nl121 is only pending approval, so it is not part of the fleet.
    expect(rows.some((t) => t.truckId === TRUCK_IDS.nl121)).toBe(false);
  });

  it("refuses to record against a truck the organization cannot see", async () => {
    await expect(
      mockFuelService.recordTransaction(ownerCtx(), {
        truckId: TRUCK_IDS.cs47, // Cascade's truck.
        purchasedAt: new Date(Date.now() - 3_600_000).toISOString(),
        location: { jurisdiction: "IL", address: { city: "Chicago", state: "IL" } },
        fuelType: "diesel",
        gallonsThousandths: 40_000,
        pricePerGallonMills: 3_899,
        totalCostCents: 15_596,
      }),
    ).rejects.toThrow(/not found/i);
  });

  it("narrows a driver membership to its own records", async () => {
    const driver = contextFor("org_cascade", { with: ["fuel:view", "mileage:view"] });
    const rows = await mockFuelService.listTransactions(driver);
    expect(rows.every((t) => t.driverProfileId === driver.driverProfileId)).toBe(true);
  });

  it("shows a driver nothing belonging to another driver", async () => {
    const driver = contextFor("org_cascade", {
      with: ["fuel:view"],
      driverProfileId: "dp_somebody_else",
    });
    expect(await mockFuelService.listTransactions(driver)).toEqual([]);
  });
});

describe("cost redaction", () => {
  it("omits the cost object rather than zeroing it", async () => {
    const blind = contextFor("org_northline", { permissions: ["fuel:view"] });
    const rows = await mockFuelService.listTransactions(blind);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((t) => t.cost === undefined)).toBe(true);

    const seeing = await mockFuelService.listTransactions(ownerCtx());
    expect(seeing.some((t) => t.cost !== undefined)).toBe(true);
  });

  it("omits every money figure from the dashboard, and says so", async () => {
    const blind = contextFor("org_northline", { permissions: ["fuel:view", "mileage:view"] });
    const dashboard = await mockFuelService.dashboard(blind);
    expect(dashboard.costVisible).toBe(false);
    expect(dashboard.economy.totalSpendCents).toBeUndefined();
    expect(dashboard.economy.costPerMileMills).toBeUndefined();
    expect(dashboard.byJurisdiction.every((j) => j.spendCents === undefined)).toBe(true);
    // The operational figures are still there — only the money went.
    expect(dashboard.economy.totalMiles).toBeGreaterThan(0);
    expect(dashboard.economy.mpgHundredths).toBeGreaterThan(0);
  });

  it("still shows money to somebody who holds fuel:costs:view", async () => {
    const dashboard = await mockFuelService.dashboard(ownerCtx());
    expect(dashboard.costVisible).toBe(true);
    expect(dashboard.economy.totalSpendCents).toBeGreaterThan(0);
  });
});

describe("dispatch organizations", () => {
  it("sees only the trucks a carrier explicitly shared, and no others", async () => {
    const rows = await mockFuelService.listTransactions(dispatcherCtx());
    expect(rows.length).toBeGreaterThan(0);
    const shared = new Set<string>([TRUCK_IDS.mdA12, TRUCK_IDS.mdA18]);
    expect(rows.every((t) => shared.has(t.truckId))).toBe(true);
    expect(rows.every((t) => t.organizationId === "org_baxter")).toBe(true);
  });

  it("does not see fuel cost, even holding the cost permission, when the grant excludes it", async () => {
    const ctx = contextFor("org_meridian", { with: ["fuel:costs:view"] });
    const rows = await mockFuelService.listTransactions(ctx);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((t) => t.cost === undefined)).toBe(true);
  });

  it("is refused IFTA outright without a separate authorization, even holding ifta:view", async () => {
    const ctx = contextFor("org_meridian", { with: ["ifta:view", "ifta:manage"] });
    await expect(mockIftaService.listPeriods(ctx)).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("gets no IFTA panel on the dashboard either", async () => {
    const ctx = contextFor("org_meridian", { with: ["ifta:view"] });
    const dashboard = await mockFuelService.dashboard(ctx);
    expect(dashboard.currentPeriod).toBeNull();
  });

  it("is allowed IFTA once the carrier authorizes tax filing in the grant", async () => {
    const grant = fuelDb().grants.find((g) => g.dispatchOrganizationId === "org_meridian")!;
    grant.includesTaxFiling = true;
    const ctx = contextFor("org_meridian", { with: ["ifta:view"] });
    await expect(mockIftaService.listPeriods(ctx)).resolves.toBeInstanceOf(Array);
  });

  it("cannot write into the carrier's ledger, only read it", async () => {
    const ctx = contextFor("org_meridian", { with: ["fuel:review", "fuel:correct"] });
    const [shared] = await mockFuelService.listTransactions(ctx);
    await expect(mockFuelService.verifyTransaction(ctx, shared.id)).rejects.toThrow(
      /belongs to org_baxter/i,
    );
  });

  it("sees nothing at all once the carrier ends the grant", async () => {
    const grant = fuelDb().grants.find((g) => g.dispatchOrganizationId === "org_meridian")!;
    grant.status = "ended";
    expect(await mockFuelService.listTransactions(dispatcherCtx())).toEqual([]);
  });
});
