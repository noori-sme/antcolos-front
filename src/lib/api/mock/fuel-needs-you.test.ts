import { beforeEach, describe, expect, it } from "vitest";
import { contextFor } from "@/test/context";
import { services } from "@/lib/api";
import type { NeedsYouCategory } from "@/types";
import { mockFuelService } from "./fuel";
import { fuelDb, resetFuelStore } from "./fuel-store";
import { mockStore } from "./store";
import { resetTruckRegistry } from "./truck-registry";

/**
 * Needs You items must be REAL: derived from the ledger, resolving when the
 * problem does. A hand-written alert would pass a "does an item exist" test
 * and fail every one of these.
 */

beforeEach(() => {
  resetTruckRegistry();
  resetFuelStore();
  mockStore.reset();
});

const ctx = () => contextFor("org_northline");

async function categories(): Promise<NeedsYouCategory[]> {
  const items = await services.needsYou.list(ctx(), {});
  return [...new Set(items.map((i) => i.category))];
}

describe("fuel items in the Needs You queue", () => {
  it("raises an item for each kind of problem the fixtures actually contain", async () => {
    const found = await categories();
    expect(found).toEqual(
      expect.arrayContaining([
        "missing_fuel_receipt",
        "duplicate_fuel_purchase",
        "suspicious_fuel_transaction",
        "invalid_mileage",
        "incomplete_ifta_period",
      ]),
    );
  });

  it("points every item at the record it is about", async () => {
    const items = await services.needsYou.list(ctx(), { category: ["missing_fuel_receipt"] });
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.entity.kind).toBe("fuel_transaction");
      expect(item.entity.href).toBe(`/fuel/transactions/${item.entity.id}`);
      const detail = await mockFuelService.getTransaction(ctx(), item.entity.id);
      expect(detail.transaction.receiptDocumentId).toBeUndefined();
    }
  });

  it("does not pile up a second copy on every read", async () => {
    const first = await services.needsYou.list(ctx(), {});
    const second = await services.needsYou.list(ctx(), {});
    const third = await services.needsYou.list(ctx(), {});
    expect(second).toHaveLength(first.length);
    expect(third).toHaveLength(first.length);
    const ids = third.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("resolves an item once the underlying problem is gone", async () => {
    const [item] = await services.needsYou.list(ctx(), { category: ["missing_fuel_receipt"] });
    expect(item.status).toBe("open");

    // Attaching the receipt is the fix the item asks for.
    const db = fuelDb();
    db.receipts.push({
      id: "doc_test_receipt",
      organizationId: "org_northline",
      kind: "fuel_receipt",
      fileName: "receipt.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 120_000,
      links: [{ entityKind: "fuel_transaction", entityId: item.entity.id }],
      uploadedAt: new Date().toISOString(),
      uploadedBy: ctx().actor,
      source: "web",
      ocr: { state: "not_applicable" },
      verification: { state: "not_required" },
      version: 1,
    });
    await mockFuelService.attachReceipt(ctx(), item.entity.id, "doc_test_receipt");

    const after = await services.needsYou.get(ctx(), item.id);
    expect(after.status).toBe("resolved");
    expect(after.resolutionNote).toMatch(/no longer outstanding/i);
  });

  it("reopens an item if the problem comes back", async () => {
    const [item] = await services.needsYou.list(ctx(), { category: ["suspicious_fuel_transaction"] });
    // Resolve it by hand, as an operator would after deciding it was fine.
    await services.needsYou.resolve(ctx(), item.id, "Checked with the driver.");
    // The flags are still on the record, so the next sync puts it back.
    const after = await services.needsYou.get(ctx(), item.id);
    expect(after.status).toBe("open");
    expect(after.history.some((h) => h.action === "reopened")).toBe(true);
  });

  it("hides fuel items from a membership without the fuel permission", async () => {
    const blind = contextFor("org_northline", { without: ["fuel:view", "mileage:view", "ifta:view"] });
    const items = await services.needsYou.list(blind, {});
    expect(items.some((i) => i.category === "missing_fuel_receipt")).toBe(false);
    expect(items.some((i) => i.category === "invalid_mileage")).toBe(false);
    expect(items.some((i) => i.category === "incomplete_ifta_period")).toBe(false);
    // The rest of the queue is untouched.
    expect(items.length).toBeGreaterThan(0);
  });

  it("hides IFTA items from somebody who may see fuel but not tax", async () => {
    const operational = contextFor("org_northline", { without: ["ifta:view"] });
    const items = await services.needsYou.list(operational, {});
    expect(items.some((i) => i.category === "missing_fuel_receipt")).toBe(true);
    expect(items.some((i) => i.category === "incomplete_ifta_period")).toBe(false);
  });

  it("never puts one organization's fuel item in another's queue", async () => {
    const northline = await services.needsYou.list(ctx(), {});
    const baxter = await services.needsYou.list(contextFor("org_baxter"), {});
    expect(northline.every((i) => i.organizationId === "org_northline")).toBe(true);
    expect(baxter.every((i) => i.organizationId === "org_baxter")).toBe(true);
    const overlap = northline.filter((i) => baxter.some((b) => b.id === i.id));
    expect(overlap).toEqual([]);
  });

  it("counts fuel items in the open badge the nav shows", async () => {
    const withFuel = await services.needsYou.openCount(ctx());
    const withoutFuel = await services.needsYou.openCount(
      contextFor("org_northline", { without: ["fuel:view", "mileage:view", "ifta:view"] }),
    );
    expect(withFuel).toBeGreaterThan(withoutFuel);
  });
});
