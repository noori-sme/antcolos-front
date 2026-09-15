import { beforeEach, describe, expect, it } from "vitest";
import { mockEldService } from "@/lib/api/mock/eld";
import { mockNeedsYouService } from "@/lib/api/mock/needs-you";
import { resetEldRegistry } from "@/lib/api/mock/eld-registry";
import { resetTruckRegistry } from "@/lib/api/mock/truck-registry";
import { resetTrailerRegistry } from "@/lib/api/mock/trailer-registry";
import { mockStore } from "@/lib/api/mock/store";
import {
  CASCADE_DRIVER, NORTHLINE_OWNER, SUMMIT_OWNER, contextFor,
} from "../helpers/context";

/**
 * Real Needs You items, not reminders invented to fill a list.
 *
 * Each of the five rules is a genuine inconsistency between records that
 * somebody can go and fix, and each one stops appearing when they fix it. A
 * queue padded with rows nobody can action is a queue people stop reading, and
 * the genuinely urgent row then sits in it unread.
 */

beforeEach(() => {
  mockStore.reset();
  resetTruckRegistry();
  resetTrailerRegistry();
  resetEldRegistry();
});

describe("the five rules", () => {
  it("raises every one of them from the seeded fixtures", async () => {
    const items = await mockEldService.needsYou(contextFor(NORTHLINE_OWNER));
    const categories = new Set(items.map((i) => i.category));
    expect(categories).toContain("telemetry_stale");
    expect(categories).toContain("telemetry_device_disconnected");
    expect(categories).toContain("telemetry_odometer_conflict");
    expect(categories).toContain("telematics_diagnostic");
  });

  it("raises a broken binding when a device reports and is bound to nothing", async () => {
    const items = await mockEldService.needsYou(contextFor(NORTHLINE_OWNER));
    const broken = items.find((i) => i.category === "telemetry_binding_broken");
    expect(broken).toBeDefined();
    expect(broken!.reason).toMatch(/none of them can be attributed/);
  });

  it("does not raise staleness on a link somebody took down", async () => {
    // The disconnected link already has its own row. Raising staleness on top
    // would tell the same person the same thing twice and bury the reason
    // under the symptom.
    const items = await mockEldService.needsYou(contextFor(NORTHLINE_OWNER));
    const disconnected = items.filter((i) => i.category === "telemetry_device_disconnected");
    const stale = items.filter((i) => i.category === "telemetry_stale");
    const disconnectedTrucks = new Set(
      disconnected.flatMap((i) => i.relatedEntities ?? []).map((e) => e.id),
    );
    expect(stale.some((i) => disconnectedTrucks.has(i.entity.id))).toBe(false);
  });

  it("does not pick a winner between two disagreeing odometers", async () => {
    const items = await mockEldService.needsYou(contextFor(NORTHLINE_OWNER));
    const conflict = items.find((i) => i.category === "telemetry_odometer_conflict")!;
    expect(conflict.reason).toMatch(/miles apart/);
    expect(conflict.detail).toMatch(/Both readings are kept/);
    // Both sources are named, so the person who knows which device is on the
    // truck can settle it.
    expect((conflict.relatedEntities ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("hands a critical fault to Maintenance rather than diagnosing it", async () => {
    const items = await mockEldService.needsYou(contextFor(NORTHLINE_OWNER));
    const fault = items.find((i) => i.category === "telematics_diagnostic")!;
    expect(fault.severity).toBe("critical");
    expect(fault.detail).toMatch(/does not interpret/);
    expect(fault.requires).toContain("eld:diagnostics:view");
  });
});

describe("items are honest about where they came from", () => {
  it("attributes every item to the system, never to a device", async () => {
    const items = await mockEldService.needsYou(contextFor(NORTHLINE_OWNER));
    expect(items.length).toBeGreaterThan(0);
    // A rule in Antcolos spotted it. The device did not raise it, and saying
    // otherwise would be the same category error the module exists to avoid.
    expect(items.every((i) => i.source === "system")).toBe(true);
  });

  it("gives every item a stable id so a snooze survives a reload", async () => {
    const first = await mockEldService.needsYou(contextFor(NORTHLINE_OWNER));
    const second = await mockEldService.needsYou(contextFor(NORTHLINE_OWNER));
    expect(first.map((i) => i.id)).toEqual(second.map((i) => i.id));
    expect(first.every((i) => i.id.startsWith("ny_eld_"))).toBe(true);
    // The organization is part of the id because equipment is shared: without
    // it two workspaces looking at one truck would mint one item between them.
    expect(first.every((i) => i.id.includes("org_northline"))).toBe(true);
  });
});

describe("the items respect the same access rules as everything else", () => {
  it("raises nothing for a dispatch workspace it has no devices in", async () => {
    // A share covers a truck's operational signals, not the carrier's hardware,
    // so there is nothing here for a dispatcher to fix.
    const items = await mockEldService.needsYou(contextFor(SUMMIT_OWNER));
    expect(items.every((i) => i.category !== "telemetry_device_disconnected")).toBe(true);
  });

  it("raises nothing about equipment a driver cannot see", async () => {
    const items = await mockEldService.needsYou(contextFor(CASCADE_DRIVER));
    const snapshots = await mockEldService.snapshots(contextFor(CASCADE_DRIVER));
    const visible = new Set(snapshots.map((s) => s.truckId));
    for (const item of items) {
      if (item.entity.kind !== "truck") continue;
      expect(visible.has(item.entity.id)).toBe(true);
    }
  });

  it("withholds the diagnostic item without eld:diagnostics:view", async () => {
    const items = await mockEldService.needsYou(
      contextFor(NORTHLINE_OWNER, { without: ["eld:diagnostics:view"] }),
    );
    expect(items.every((i) => i.category !== "telematics_diagnostic")).toBe(true);
  });
});

describe("the queue folds them in with everything else", () => {
  it("shows ELD items in the organization's Needs You list", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const queue = await mockNeedsYouService.list(ctx, {});
    const mine = queue.filter((i) => i.id.startsWith("ny_eld_"));
    expect(mine.length).toBeGreaterThan(0);
    // Folded into ONE queue, not kept in a second one of its own.
    expect(queue.length).toBeGreaterThan(mine.length);
  });

  it("lets an ELD item be snoozed like any other", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const queue = await mockNeedsYouService.list(ctx, {});
    // A non-critical one: the queue caps a critical snooze at two hours, which
    // is the queue's own rule and applies to these rows like any other.
    const item = queue.find((i) => i.id.startsWith("ny_eld_") && i.severity !== "critical")!;
    const snoozed = await mockNeedsYouService.snooze(ctx, item.id, {
      hours: 4, reason: "Shop has it.",
    });
    expect(snoozed.status).toBe("snoozed");

    const after = await mockNeedsYouService.list(ctx, {});
    expect(after.find((i) => i.id === item.id)?.status).toBe("snoozed");
  });

  it("does not raise an ELD item for a membership without eld:view", async () => {
    const ctx = contextFor(NORTHLINE_OWNER, { without: ["eld:view"] });
    const queue = await mockNeedsYouService.list(ctx, {});
    expect(queue.every((i) => !i.id.startsWith("ny_eld_"))).toBe(true);
  });
});
