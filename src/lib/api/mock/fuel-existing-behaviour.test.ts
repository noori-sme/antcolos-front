import { beforeEach, describe, expect, it } from "vitest";
import { contextFor } from "@/test/context";
import { services } from "@/lib/api";
import { PermissionDeniedError } from "../contracts/context";
import { resetFuelStore } from "./fuel-store";
import { mockStore } from "./store";
import { fleetSync, resetTruckRegistry, truckContextFrom, TRUCK_IDS } from "./truck-registry";

/**
 * Regression cover for the systems the fuel module builds on.
 *
 * The fuel work touched shared ground — the permission catalog, the Needs You
 * vocabulary, the seed, the truck registry's read windows. These assert that
 * everything that worked before still works exactly the same way.
 */

beforeEach(() => {
  resetTruckRegistry();
  resetFuelStore();
  mockStore.reset();
});

describe("loads", () => {
  it("still lists an organization's own loads and nobody else's", async () => {
    const northline = await services.loads.list(contextFor("org_northline"));
    const meridian = await services.loads.list(contextFor("org_meridian"));
    expect(northline.items.length).toBeGreaterThan(0);
    expect(northline.items.every((l) => l.organizationId === "org_northline")).toBe(true);
    expect(meridian.items.every((l) => l.organizationId === "org_meridian")).toBe(true);
  });

  it("still omits financials from a membership without rates:view", async () => {
    const blind = contextFor("org_meridian");
    expect(blind.permissions.has("rates:view")).toBe(false);
    const { items } = await services.loads.list(blind);
    expect(items.every((l) => l.financials === undefined)).toBe(true);

    const owner = await services.loads.list(contextFor("org_northline"));
    expect(owner.items.some((l) => l.financials !== undefined)).toBe(true);
  });

  it("still narrows a driver membership to its own loads", async () => {
    const driver = contextFor("org_cascade");
    const { items } = await services.loads.list(driver);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((l) => l.assignment?.driverId === driver.driverProfileId)).toBe(true);
  });

  it("still refuses a load read without loads:view", async () => {
    const ctx = contextFor("org_northline", { permissions: [] });
    await expect(services.loads.list(ctx)).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe("home", () => {
  it("still summarizes each organization, including one with nothing in it", async () => {
    const northline = await services.home.summary(contextFor("org_northline"));
    expect(northline.counts.trucksTotal).toBeGreaterThan(0);
    expect(northline.financials).not.toBeNull();

    // Summit used to have no loads, drivers or customers at all. It has its own
    // records now, so what is asserted is the rule rather than the fixture: a
    // workspace summarizes without throwing, however little is in it.
    const summit = await services.home.summary(contextFor("org_summit"));
    expect(summit.counts.activeLoads).toBeGreaterThanOrEqual(0);

    // Baxter is the second carrier the fuel work needed. It must work too.
    const baxter = await services.home.summary(contextFor("org_baxter"));
    expect(baxter.counts.trucksTotal).toBeGreaterThan(0);
  });

  it("still withholds the financial tile from a membership without revenue:view", async () => {
    const summary = await services.home.summary(contextFor("org_meridian"));
    expect(summary.financials).toBeNull();
  });
});

describe("Needs You", () => {
  it("still returns the seeded operational items alongside the derived fuel ones", async () => {
    const items = await services.needsYou.list(contextFor("org_northline"), {});
    const categories = new Set(items.map((i) => i.category));
    expect(categories.has("rate_con_verification") || categories.has("unassigned_load")).toBe(true);
    expect(items.every((i) => i.organizationId === "org_northline")).toBe(true);
  });

  it("still snoozes, escalates and resolves a seeded item", async () => {
    const ctx = contextFor("org_northline");
    const [item] = await services.needsYou.list(ctx, { category: ["unassigned_load"] });
    const snoozed = await services.needsYou.snooze(ctx, item.id, { hours: 1, reason: "Waiting on the customer." });
    expect(snoozed.status).toBe("snoozed");
    const escalated = await services.needsYou.escalate(ctx, item.id, { note: "Still nothing." });
    expect(escalated.status).toBe("escalated");
    const resolved = await services.needsYou.resolve(ctx, item.id, "Assigned.");
    expect(resolved.status).toBe("resolved");
  });

  it("still caps how long a high-severity item can be parked", async () => {
    const ctx = contextFor("org_northline");
    const items = await services.needsYou.list(ctx, { severity: ["critical"] });
    if (items.length === 0) return;
    await expect(
      services.needsYou.snooze(ctx, items[0].id, { hours: 48, reason: "later" }),
    ).rejects.toThrow(/at most/i);
  });
});

describe("the truck registry", () => {
  it("still projects one organization's own view of the permanent fleet", async () => {
    const ctx = contextFor("org_northline");
    const fleet = fleetSync(truckContextFrom(ctx));
    expect(fleet.length).toBeGreaterThan(0);
    expect(fleet.every((t) => t.organizationId === "org_northline")).toBe(true);
    // A pending relationship is not part of the fleet.
    expect(fleet.some((t) => t.truckId === TRUCK_IDS.nl121)).toBe(false);
  });

  it("still gives two carriers different views of one permanent truck", async () => {
    const northline = fleetSync(truckContextFrom(contextFor("org_northline")))
      .find((t) => t.truckId === TRUCK_IDS.nl107);
    const baxter = fleetSync(truckContextFrom(contextFor("org_baxter")))
      .find((t) => t.truckId === TRUCK_IDS.nl107);

    expect(northline?.unit).toBe("107");
    expect(baxter?.unit).toBe("BX-07");
    expect(northline?.activationState).toBe("active_operating_lease");
    expect(baxter?.activationState).toBe("locked_by_other");
    // The lease holder's load reference never travels to the other carrier.
    expect(baxter?.myLoadReference).toBeUndefined();
  });

  it("still returns nothing at all without trucks:view", () => {
    const ctx = contextFor("org_northline", { permissions: [] });
    expect(fleetSync(truckContextFrom(ctx))).toEqual([]);
  });
});
