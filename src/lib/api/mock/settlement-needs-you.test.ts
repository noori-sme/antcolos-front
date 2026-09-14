import { beforeEach, describe, expect, it } from "vitest";
import type { PermissionKey } from "@/types";
import { availablePermissionKeys } from "@/lib/permissions/catalog";
import { DEFAULT_SCOPE, OWN_RECORDS_SCOPE } from "@/lib/permissions/scope";
import type { ServiceContext } from "../contracts/context";
import { mockNeedsYouService as needsYou } from "./needs-you";
import { settlementStore } from "./settlement-registry";
import { mockSettlementsService as settlements } from "./settlements";

function ctxFor(
  organizationId: string,
  membershipId: string,
  permissions: PermissionKey[],
  over: Partial<ServiceContext> = {},
): ServiceContext {
  return {
    organizationId,
    membershipId,
    permissions: new Set(permissions),
    scope: DEFAULT_SCOPE,
    actor: { userId: "usr_sam", membershipId, displayNameSnapshot: "Sam Murtaza", source: "web" },
    ...over,
  };
}

const northlineOwner = () =>
  ctxFor("org_northline", "mem_northline_owner", availablePermissionKeys("CARRIER"));

const cascadeDriver = () =>
  ctxFor("org_cascade", "mem_cascade_driver", ["settlements:view", "loads:view"], {
    scope: OWN_RECORDS_SCOPE,
    driverProfileId: "drv_cascade_0192",
  });

beforeEach(() => {
  settlementStore.reset();
});

describe("settlement items in the Needs You queue", () => {
  it("puts missing data, disputes and overdue payments into the queue", async () => {
    const items = await needsYou.list(northlineOwner());
    const categories = new Set(items.map((i) => i.category));
    expect(categories.has("settlement_missing_data")).toBe(true);
    expect(categories.has("settlement_dispute")).toBe(true);
    expect(categories.has("settlement_payment_overdue")).toBe(true);
  });

  it("does not disturb the items that were already there", async () => {
    const items = await needsYou.list(northlineOwner());
    // The load and document items the queue already had are still present.
    expect(items.some((i) => i.entity.kind === "load")).toBe(true);
    expect(items.some((i) => !i.derived)).toBe(true);
  });

  it("marks every settlement item as derived, and points it at the settlement", async () => {
    const items = (await needsYou.list(northlineOwner())).filter((i) =>
      i.category.startsWith("settlement_"),
    );
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.derived).toBe(true);
      expect(item.entity.kind).toBe("settlement");
      expect(item.entity.href).toMatch(/^\/finance\/settlements\//);
      expect(item.status).toBe("open");
    }
  });

  it("counts them in the nav badge", async () => {
    const ctx = northlineOwner();
    const count = await needsYou.openCount(ctx);
    const open = (await needsYou.list(ctx)).filter(
      (i) => i.status === "open" || i.status === "escalated",
    ).length;
    expect(count).toBe(open);
  });

  it("refuses to snooze or resolve one, and says why", async () => {
    const ctx = northlineOwner();
    const derived = (await needsYou.list(ctx)).find((i) => i.derived)!;
    await expect(needsYou.snooze(ctx, derived.id, { hours: 2, reason: "later" })).rejects.toThrow(
      /clears on its own/,
    );
    await expect(needsYou.resolve(ctx, derived.id)).rejects.toThrow(/clears on its own/);
    await expect(needsYou.assign(ctx, derived.id, "mem_x")).rejects.toThrow(/clears on its own/);
  });

  it("stops listing one once the settlement stops producing it", async () => {
    const ctx = northlineOwner();
    const before = (await needsYou.list(ctx)).filter((i) => i.category === "settlement_review");
    expect(before.length).toBeGreaterThan(0);

    // Approving is the fix for "awaiting approval". Nothing hides the row.
    const settlementId = before[0].entity.id;
    await settlements.approve(ctx, settlementId);

    const after = (await needsYou.list(ctx)).filter(
      (i) => i.category === "settlement_review" && i.entity.id === settlementId,
    );
    expect(after).toHaveLength(0);
  });

  it("gives a payee only items about their own settlements", async () => {
    const items = (await needsYou.list(cascadeDriver())).filter((i) =>
      i.category.startsWith("settlement_"),
    );
    for (const item of items) {
      expect(item.entity.label).toContain("Sam Murtaza");
    }
  });

  it("keeps settlement items out of the queue for someone without settlements:view", async () => {
    const ctx = ctxFor("org_northline", "mem_dispatcher", ["loads:view", "documents:view"]);
    const items = await needsYou.list(ctx);
    expect(items.some((i) => i.category.startsWith("settlement_"))).toBe(false);
  });
});
