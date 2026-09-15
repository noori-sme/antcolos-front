import { beforeEach, describe, expect, it } from "vitest";
import { services } from "@/lib/api";
import { PermissionDeniedError } from "@/lib/api/contracts/context";
import { mockStore } from "@/lib/api/mock/store";
import { resetComplianceRegistry } from "@/lib/api/mock/compliance-registry";
import { resetComplianceNeedsYou } from "@/lib/api/mock/compliance-needs-you";
import {
  activationStateFor, fleetSync, resetTruckRegistry, truckContextFrom,
  truckLeaseHolder, TRUCK_IDS,
} from "@/lib/api/mock/truck-registry";
import { resetTrailerRegistry } from "@/lib/api/mock/trailer-registry";
import { resetCarrierDriversMock } from "@/features/driver/mock-carrier-drivers";
import { effectivePermissions } from "@/lib/permissions/effective";
import { clampToGrantable, grantablePermissionKeys } from "@/lib/permissions/grantable";
import { MOCK_MEMBERSHIPS, MOCK_ORGANIZATIONS, MOCK_TEMPLATES } from "@/lib/session/fixtures";
import { availablePermissionKeys } from "@/lib/permissions/catalog";
import {
  BAXTER_OWNER, CASCADE_DRIVER, MERIDIAN_DISPATCHER, NORTHLINE_OWNER,
  contextFor, membership, withPermissions, withoutPermissions,
} from "../support/context";

/**
 * The behaviour that was already here.
 *
 * Safety & Compliance reaches into the Needs You queue, the permission
 * templates, the document store and both equipment registries. These tests are
 * what says it did so without breaking any of them.
 */

beforeEach(() => {
  mockStore.reset();
  resetTruckRegistry();
  resetTrailerRegistry();
  resetCarrierDriversMock();
  resetComplianceRegistry();
  resetComplianceNeedsYou();
});

describe("permissions", () => {
  it("gives an owner everything the organization type supports, and nothing else", () => {
    const org = MOCK_ORGANIZATIONS.find((o) => o.id === "org_northline")!;
    const owner = membership(NORTHLINE_OWNER);
    const permissions = effectivePermissions(owner, org, MOCK_TEMPLATES);
    expect(permissions.size).toBe(availablePermissionKeys(org.type).length);
  });

  it("still lets a revocation beat a grant", () => {
    const org = MOCK_ORGANIZATIONS.find((o) => o.id === "org_meridian")!;
    const dispatcher = membership(MERIDIAN_DISPATCHER);
    const permissions = effectivePermissions(dispatcher, org, MOCK_TEMPLATES);
    expect(permissions.has("loads:delete")).toBe(false);
    expect(permissions.has("documents:approve")).toBe(true);
    // The rate-blind dispatcher is the fixture the whole model exists to prove.
    expect(permissions.has("rates:view")).toBe(false);
  });

  it("grants nothing at all to a membership that is not active", () => {
    const org = MOCK_ORGANIZATIONS.find((o) => o.id === "org_northline")!;
    const suspended = { ...membership(NORTHLINE_OWNER), status: "suspended" as const };
    expect(effectivePermissions(suspended, org, MOCK_TEMPLATES).size).toBe(0);
  });

  it("never lets anybody hand out access they do not hold", () => {
    const ctx = contextFor(MERIDIAN_DISPATCHER);
    const grantable = grantablePermissionKeys(ctx.permissions, "DISPATCH_AGENCY");
    expect(grantable).not.toContain("rates:view");
    expect(
      clampToGrantable(["rates:view", "loads:view"], ctx.permissions, "DISPATCH_AGENCY"),
    ).toEqual(["loads:view"]);
  });

  it("gives the Driver template its own compliance view and nothing wider", () => {
    // Added with Safety & Compliance: a driver must be able to see what they
    // owe. Record scope keeps it to their own record — they still cannot read
    // the carrier's roster.
    const driver = contextFor(CASCADE_DRIVER);
    expect(driver.permissions.has("compliance:view")).toBe(true);
    expect(driver.permissions.has("drivers:view")).toBe(false);
    expect(driver.permissions.has("compliance:manage")).toBe(false);
  });
});

describe("Needs You, as it was", () => {
  it("still serves the seeded operational items", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const items = await services.needsYou.list(ctx, { status: ["open", "escalated"] });
    const seeded = mockStore.org("org_northline").needsYou;
    for (const item of seeded.filter((i) => i.status === "open")) {
      expect(items.some((i) => i.id === item.id), item.title).toBe(true);
    }
  });

  it("still hides items whose permissions the membership lacks", async () => {
    const ctx = withoutPermissions(contextFor(NORTHLINE_OWNER), "documents:view");
    const items = await services.needsYou.list(ctx, { status: ["open", "escalated"] });
    expect(items.some((i) => i.requires.includes("documents:view"))).toBe(false);
  });

  it("still answers 'forbidden' for a seeded item the caller may not see", async () => {
    const full = contextFor(NORTHLINE_OWNER);
    // A SEEDED item — one the organization's own bucket holds. Document items
    // are deliberately not used here: the Document Center answers not-found
    // rather than forbidden, so another membership's paperwork is not even
    // acknowledged to exist. The seeded queue still says forbidden.
    const listed = await services.needsYou.list(full);
    const bucket = new Set(mockStore.org("org_northline").needsYou.map((i) => i.id));
    const gated = listed.find((i) => bucket.has(i.id) && i.requires.length > 0)!;
    const ctx = withoutPermissions(full, ...gated.requires);
    await expect(services.needsYou.get(ctx, gated.id)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it("still narrows a driver membership to its own loads", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const items = await services.needsYou.list(ctx);
    const loadItems = items.filter((i) => i.entity.kind === "load");
    const org = mockStore.org("org_cascade");
    for (const item of loadItems) {
      const load = org.loads.find((l) => l.id === item.entity.id);
      expect(load?.assignment?.driverId).toBe(ctx.driverProfileId);
    }
  });

  it("still caps a snooze by severity", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const critical = (await services.needsYou.list(ctx)).find(
      (i) => i.severity === "critical" && i.entity.kind !== "compliance_requirement",
    )!;
    await expect(
      services.needsYou.snooze(ctx, critical.id, { hours: 8, reason: "later" }),
    ).rejects.toThrow(/at most 2 hours/);
  });

  it("still refuses a snooze with no reason", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const item = (await services.needsYou.list(ctx))[0];
    await expect(
      services.needsYou.snooze(ctx, item.id, { hours: 1, reason: "  " }),
    ).rejects.toThrow(/reason/i);
  });

  it("still requires the recommended action's permission to resolve", async () => {
    const full = contextFor(NORTHLINE_OWNER);
    const item = (await services.needsYou.list(full)).find(
      (i) => i.recommendedAction.requires.length > 0 &&
        i.entity.kind !== "compliance_requirement",
    )!;
    const ctx = withoutPermissions(full, ...item.recommendedAction.requires);
    await expect(services.needsYou.resolve(ctx, item.id)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });
});

describe("loads, as they were", () => {
  it("still redacts money from a membership without rates:view", async () => {
    const ctx = contextFor(MERIDIAN_DISPATCHER);
    const loads = await services.loads.list(ctx);
    expect(loads.items.length).toBeGreaterThan(0);
    expect(loads.items.every((l) => l.financials === undefined)).toBe(true);
  });

  it("still shows money to an owner", async () => {
    const loads = await services.loads.list(contextFor(NORTHLINE_OWNER));
    expect(loads.items.some((l) => l.financials !== undefined)).toBe(true);
  });

  it("still serves only a load's own documents", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const load = (await services.loads.list(ctx)).items.find((l) => l.reference === "NL-24812")!;
    const documents = await services.loads.documents(ctx, load.id);
    expect(documents.length).toBeGreaterThan(0);
    for (const document of documents) {
      expect(document.links.some((l) => l.entityKind === "load" && l.entityId === load.id)).toBe(true);
    }
  });

  it("keeps the new organization-level paperwork out of a load's documents", async () => {
    // Compliance added organization documents to the same Document Center.
    // They must not leak into a load's document list.
    const ctx = contextFor(NORTHLINE_OWNER);
    const load = (await services.loads.list(ctx)).items[0];
    const documents = await services.loads.documents(ctx, load.id);
    expect(documents.some((d) => d.links.some((l) => l.entityKind === "organization"))).toBe(false);
  });
});

describe("the truck registry, as it was", () => {
  it("still lets exactly one carrier hold operating authority at a time", () => {
    // Northline holds the live lease on 107. Baxter is approved on the same
    // truck and must read as locked out, not as un-onboarded.
    expect(truckLeaseHolder(TRUCK_IDS.nl107)).toBe("org_northline");
    expect(activationStateFor(TRUCK_IDS.nl107, "org_northline")).toBe("active_operating_lease");
    expect(activationStateFor(TRUCK_IDS.nl107, "org_baxter")).toBe("locked_by_other");
  });

  it("still excludes a pending relationship from the fleet", () => {
    const fleet = fleetSync(truckContextFrom(contextFor(NORTHLINE_OWNER)));
    expect(fleet.some((t) => t.truckId === TRUCK_IDS.nl121)).toBe(false);
  });

  it("shows a driver membership no fleet at all without trucks:view", () => {
    // The Driver template now DOES grant trucks:view, so a driver can report a
    // fault on the truck they are on. The rule this guards is unchanged, so it
    // is asserted by taking the permission away rather than by assuming the
    // template withholds it: no trucks:view, no roster, before record scope
    // ever comes into it.
    const ctx = withoutPermissions(contextFor(CASCADE_DRIVER), "trucks:view");
    expect(ctx.permissions.has("trucks:view")).toBe(false);
    expect(fleetSync(truckContextFrom(ctx))).toHaveLength(0);
  });

  it("still narrows a driver to their own truck when the carrier does grant it", () => {
    // The registry's own rule: permission says what, the assignment says which.
    const ctx = withPermissions(contextFor(CASCADE_DRIVER), "trucks:view");
    expect(fleetSync(truckContextFrom(ctx)).map((t) => t.truckId)).toEqual([TRUCK_IDS.cs47]);
  });

  it("still counts only the documents that are actually a problem", () => {
    // The paperwork added for compliance is all approved, so no unit's warning
    // count moved.
    const fleet = fleetSync(truckContextFrom(contextFor(NORTHLINE_OWNER)));
    const unit104 = fleet.find((t) => t.truckId === TRUCK_IDS.nl104)!;
    expect(unit104.documentWarnings).toBe(0);
    const unit111 = fleet.find((t) => t.truckId === TRUCK_IDS.nl111)!;
    expect(unit111.documentWarnings).toBeGreaterThan(0);
  });
});

describe("home, as it was", () => {
  it("still agrees with the roster about how many trucks there are", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const summary = await services.home.summary(ctx);
    expect(summary.counts.trucksTotal).toBe(fleetSync(truckContextFrom(ctx)).length);
  });

  it("still withholds financials from a membership that may not see them", async () => {
    expect((await services.home.summary(contextFor(MERIDIAN_DISPATCHER))).financials).toBeNull();
    expect((await services.home.summary(contextFor(NORTHLINE_OWNER))).financials).not.toBeNull();
  });

  it("serves every organization the session can switch into", async () => {
    // Baxter is a real membership. Before this milestone the store had no
    // partition for it, so switching to it threw.
    for (const m of MOCK_MEMBERSHIPS) {
      await expect(services.home.summary(contextFor(m.id))).resolves.toBeTruthy();
    }
  });
});

describe("organization isolation", () => {
  it("still refuses to read one organization's record through another", () => {
    expect(() => mockStore.assertOwned("org_northline", "org_baxter")).toThrow();
  });

  it("keeps every queue to its own organization", async () => {
    for (const id of [NORTHLINE_OWNER, BAXTER_OWNER, MERIDIAN_DISPATCHER, CASCADE_DRIVER]) {
      const ctx = contextFor(id);
      const items = await services.needsYou.list(ctx);
      expect(items.every((i) => i.organizationId === ctx.organizationId)).toBe(true);
    }
  });
});
