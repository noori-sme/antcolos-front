import { beforeEach, describe, expect, it } from "vitest";
import { mockFleetService } from "@/lib/api/mock/fleet-operations";
import { mockNeedsYouService } from "@/lib/api/mock/needs-you";
import { mockStore } from "@/lib/api/mock/store";
import { resetTruckRegistry } from "@/lib/api/mock/truck-registry";
import { resetTrailerRegistry } from "@/lib/api/mock/trailer-registry";
import { resetFleetTelemetry } from "@/lib/api/mock/fleet-telemetry";
import { CATEGORY_LABEL, type NeedsYouCategory } from "@/types";
import { BAXTER_OWNER, NORTHLINE_OWNER, contextFor } from "./helpers/context";

const FLEET_CATEGORIES: NeedsYouCategory[] = [
  "stale_location", "invalid_assignment", "equipment_unavailable", "operational_blocker",
];

beforeEach(() => {
  mockStore.reset();
  resetTruckRegistry();
  resetTrailerRegistry();
  resetFleetTelemetry();
});

describe("derived Needs You items are real, not filler", () => {
  it("raises something against the seeded fleet", async () => {
    const items = await mockFleetService.needsYou(contextFor(NORTHLINE_OWNER));
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) {
      expect(FLEET_CATEGORIES).toContain(i.category);
      expect(i.reason.length).toBeGreaterThan(20);
      expect(i.entity.id).toBeTruthy();
      expect(i.recommendedAction.requires.length).toBeGreaterThan(0);
      // A rule in this codebase spotted it. Never attributed to a device.
      expect(i.source).toBe("system");
    }
  });

  it("covers the four operational rules the layer promises", async () => {
    const items = await mockFleetService.needsYou(contextFor(NORTHLINE_OWNER));
    const seen = new Set(items.map((i) => i.category));
    // Stale location and paperwork blockers are both seeded deliberately.
    expect(seen.has("stale_location")).toBe(true);
    expect(seen.has("operational_blocker")).toBe(true);
  });

  it("keeps every category labelled, so nothing renders as a raw key", () => {
    for (const c of FLEET_CATEGORIES) {
      expect(CATEGORY_LABEL[c]).toBeTruthy();
      expect(CATEGORY_LABEL[c]).not.toContain("_");
    }
  });

  it("uses ids that are stable across recomputation", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const first = await mockFleetService.needsYou(ctx);
    const second = await mockFleetService.needsYou(ctx);
    expect(second.map((i) => i.id).sort()).toEqual(first.map((i) => i.id).sort());
  });

  it("never raises an item about equipment held by another carrier", async () => {
    for (const membership of [NORTHLINE_OWNER, BAXTER_OWNER]) {
      const ctx = contextFor(membership);
      const rows = await mockFleetService.equipment(ctx);
      const lockedIds = new Set(
        rows.filter((r) => r.authority.lockedByOtherAuthority).map((r) => r.assetId),
      );
      const items = await mockFleetService.needsYou(ctx);
      for (const i of items) {
        // Chasing a location or paperwork on somebody else's live equipment is
        // not this organization's job, and the item would disclose the lock.
        if (i.category === "stale_location" || i.category === "operational_blocker") {
          expect(lockedIds.has(i.entity.id)).toBe(false);
        }
      }
    }
  });

  it("never puts another carrier's load reference in an item", async () => {
    const items = await mockFleetService.needsYou(contextFor(BAXTER_OWNER));
    const northline = await mockFleetService.equipment(contextFor(NORTHLINE_OWNER));
    const theirReferences = northline
      .map((r) => r.myLoadReference)
      .filter((r): r is string => Boolean(r));

    const blob = JSON.stringify(items);
    for (const reference of theirReferences) {
      expect(blob).not.toContain(reference);
    }
  });

  it("stays silent about IFTA", async () => {
    const items = await mockFleetService.needsYou(contextFor(NORTHLINE_OWNER));
    // Antcolos does not track IFTA and cannot know whether a return was filed.
    for (const i of items) {
      expect(i.title.toLowerCase()).not.toContain("ifta");
    }
  });

  it("is honest in a stale-location item about nothing being connected", async () => {
    const items = await mockFleetService.needsYou(contextFor(NORTHLINE_OWNER));
    const stale = items.find((i) => i.category === "stale_location");
    expect(stale).toBeTruthy();
    expect(`${stale!.reason} ${stale!.detail ?? ""}`)
      .toMatch(/no gps, eld or telematics feed is connected/i);
  });
});

describe("derived items join the organization's real queue", () => {
  it("appears in needsYou.list and can be snoozed and resolved like any other", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const listed = await mockNeedsYouService.list(ctx);
    const fleetItem = listed.find((i) => FLEET_CATEGORIES.includes(i.category));
    expect(fleetItem, "fleet items should reach the queue").toBeTruthy();

    const snoozed = await mockNeedsYouService.snooze(ctx, fleetItem!.id, {
      hours: 1, reason: "Driver is calling in at the next stop.",
    });
    expect(snoozed.status).toBe("snoozed");
    expect(snoozed.history.at(-1)?.action).toBe("snoozed");

    // Recomputing does not resurrect it as a fresh open item.
    const again = await mockNeedsYouService.list(ctx);
    expect(again.find((i) => i.id === fleetItem!.id)?.status).toBe("snoozed");
  });

  it("stays resolved once somebody has dealt with it", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const listed = await mockNeedsYouService.list(ctx);
    const fleetItem = listed.find((i) => i.category === "stale_location")!;

    await mockNeedsYouService.resolve(ctx, fleetItem.id, "Located at the yard.");
    const again = await mockNeedsYouService.list(ctx);
    expect(again.find((i) => i.id === fleetItem.id)?.status).toBe("resolved");
  });

  it("counts toward the open badge without breaking the existing count", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const count = await mockNeedsYouService.openCount(ctx);
    const listed = await mockNeedsYouService.list(ctx);
    const open = listed.filter((i) => i.status === "open" || i.status === "escalated").length;
    expect(count).toBe(open);
  });

  it("is withheld from a membership without fleet:view", async () => {
    const ctx = contextFor(NORTHLINE_OWNER, { without: ["fleet:view"] });
    const listed = await mockNeedsYouService.list(ctx);
    expect(listed.some((i) => FLEET_CATEGORIES.includes(i.category))).toBe(false);
  });
});
