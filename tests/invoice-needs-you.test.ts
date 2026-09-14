import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { services } from "@/lib/api";
import { resetInvoiceRegistry } from "@/lib/api/mock/invoice-registry";
import { mockStore } from "@/lib/api/mock/store";
import type { PermissionKey } from "@/types";
import { BILLER, ctx } from "./context";

const NORTHLINE = "org_northline";
const needsYou = services.needsYou;

beforeEach(() => {
  mockStore.reset();
  resetInvoiceRegistry();
});

const invoiceItems = async (permissions = BILLER) =>
  (await needsYou.list(ctx(NORTHLINE, permissions))).filter((i) =>
    ["invoice_dispute", "invoice_overdue"].includes(i.category) ||
    i.entity.kind === "invoice",
  );

describe("invoice items in Needs You", () => {
  it("raises an item for every open dispute, overdue invoice and held invoice", async () => {
    const items = await invoiceItems();
    const categories = items.map((i) => i.category);

    assert.ok(categories.includes("invoice_dispute"), "expected a dispute item");
    assert.ok(categories.includes("invoice_overdue"), "expected an overdue item");
    assert.ok(
      items.some((i) => i.category === "missing_document" && i.entity.kind === "invoice"),
      "expected a missing-document item against an invoice",
    );
  });

  it("points every item at the invoice it came from", async () => {
    const c = ctx(NORTHLINE, BILLER);
    const items = await invoiceItems();
    const all = await services.invoices.list(c, { view: "all" });

    for (const item of items) {
      assert.equal(item.entity.kind, "invoice");
      assert.equal(item.entity.href, `/finance/invoices/${item.entity.id}`);
      assert.ok(all.items.some((i) => i.id === item.entity.id));
    }
  });

  it("hides them from a membership without invoices:view", async () => {
    const withoutInvoices = await needsYou.list(
      ctx(NORTHLINE, ["loads:view", "documents:view", "trucks:view", "drivers:view"]),
    );
    assert.equal(withoutInvoices.filter((i) => i.entity.kind === "invoice").length, 0);

    const withInvoices = await invoiceItems();
    assert.ok(withInvoices.length > 0);
  });

  it("does not create a second queue — they snooze and resolve like anything else", async () => {
    const c = ctx(NORTHLINE, BILLER);
    const item = (await invoiceItems()).find((i) => i.category === "invoice_overdue");
    assert.ok(item);

    const snoozed = await needsYou.snooze(c, item.id, { hours: 2, reason: "Called Tandem, waiting on a callback." });
    assert.equal(snoozed.status, "snoozed");
    assert.ok(snoozed.history.some((h) => h.action === "snoozed"));

    const reopened = await needsYou.unsnooze(c, item.id);
    assert.equal(reopened.status, "open");

    const resolved = await needsYou.resolve(c, item.id, "Payment promised for Friday.");
    assert.equal(resolved.status, "resolved");
  });

  it("counts them in the open badge", async () => {
    // The only difference between the two memberships is invoices:view, so the
    // difference in the badge is exactly what the invoice module contributes.
    const base: PermissionKey[] = [
      "loads:view", "documents:view", "trucks:view", "drivers:view",
      "compliance:view", "customers:view",
    ];
    const withInvoices = await needsYou.openCount(ctx(NORTHLINE, [...base, "invoices:view"]));
    const withoutInvoices = await needsYou.openCount(ctx(NORTHLINE, base));
    assert.ok(
      withInvoices > withoutInvoices,
      `expected the invoice items to raise the badge: ${withInvoices} vs ${withoutInvoices}`,
    );
  });

  it("seeds the items once, however many times the queue is read", async () => {
    const c = ctx(NORTHLINE, BILLER);
    const first = (await needsYou.list(c)).length;
    await needsYou.list(c);
    const third = (await needsYou.list(c)).length;
    assert.equal(first, third);
  });
});
