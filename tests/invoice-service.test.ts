import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { services } from "@/lib/api";
import {
  NotFoundError, PermissionDeniedError,
} from "@/lib/api/contracts/context";
import { resetInvoiceRegistry } from "@/lib/api/mock/invoice-registry";
import { mockStore } from "@/lib/api/mock/store";
import { BILLER, VIEWER, ctx } from "./context";

const NORTHLINE = "org_northline";
const MERIDIAN = "org_meridian";
const invoices = services.invoices;

beforeEach(() => {
  mockStore.reset();
  resetInvoiceRegistry();
});

async function rejects(fn: () => Promise<unknown>, matcher: RegExp | (new (...a: never[]) => Error)) {
  await assert.rejects(fn, matcher as never);
}

async function byNumber(number: string) {
  const page = await invoices.list(ctx(NORTHLINE, BILLER), { view: "all" });
  const found = page.items.find((i) => i.number === number);
  assert.ok(found, `fixture ${number} is missing`);
  return found;
}

describe("permissions", () => {
  it("refuses to list invoices without invoices:view", async () => {
    await rejects(() => invoices.list(ctx(NORTHLINE, ["loads:view"])), PermissionDeniedError);
  });

  it("refuses to create without invoices:create", async () => {
    const load = (await invoices.invoiceableLoads(ctx(NORTHLINE, BILLER)))
      .find((l) => !l.existingInvoiceId);
    assert.ok(load);
    await rejects(
      () => invoices.create(ctx(NORTHLINE, VIEWER), { loadId: load.loadId }),
      PermissionDeniedError,
    );
  });

  it("refuses to submit without invoices:send", async () => {
    const ready = await byNumber("INV-2026-0117");
    await rejects(
      () => invoices.submit(ctx(NORTHLINE, ["invoices:view", "invoices:edit"]), ready.id, { channel: "email" }),
      PermissionDeniedError,
    );
  });

  it("refuses to edit line items without invoices:edit", async () => {
    const draft = await byNumber("INV-2026-0116");
    await rejects(
      () => invoices.addLineItem(ctx(NORTHLINE, VIEWER), draft.id, {
        kind: "other", label: "Extra", amountCents: 5_000,
      }),
      PermissionDeniedError,
    );
  });

  it("names every permission the caller is missing", async () => {
    try {
      await invoices.list(ctx(NORTHLINE, []));
      assert.fail("should have thrown");
    } catch (error) {
      assert.ok(error instanceof PermissionDeniedError);
      assert.deepEqual(error.required, ["invoices:view"]);
    }
  });
});

describe("carrier data isolation", () => {
  it("never returns another carrier's invoices in a list", async () => {
    const northline = await invoices.list(ctx(NORTHLINE, BILLER), { view: "all" });
    const meridian = await invoices.list(ctx(MERIDIAN, BILLER), { view: "all" });

    assert.ok(northline.items.length > 0);
    assert.ok(meridian.items.length > 0);
    for (const invoice of northline.items) assert.equal(invoice.organizationId, NORTHLINE);
    for (const invoice of meridian.items) assert.equal(invoice.organizationId, MERIDIAN);

    const shared = northline.items.filter((n) => meridian.items.some((m) => m.id === n.id));
    assert.deepEqual(shared, []);
  });

  it("treats another carrier's invoice as not found, never as forbidden", async () => {
    const theirs = (await invoices.list(ctx(MERIDIAN, BILLER), { view: "all" })).items[0];
    // A 403 would confirm that another carrier has an invoice with this id.
    await rejects(() => invoices.get(ctx(NORTHLINE, BILLER), theirs.id), NotFoundError);
  });

  it("refuses to bill a load that belongs to another carrier", async () => {
    const theirLoad = mockStore.org(MERIDIAN).loads[0];
    await rejects(
      () => invoices.create(ctx(NORTHLINE, BILLER), { loadId: theirLoad.id }),
      NotFoundError,
    );
  });

  it("cannot mutate another carrier's invoice", async () => {
    const theirs = (await invoices.list(ctx(MERIDIAN, BILLER), { view: "all" })).items[0];
    await rejects(
      () => invoices.void(ctx(NORTHLINE, BILLER), theirs.id, { reason: "not mine" }),
      NotFoundError,
    );
  });

  it("keeps each organization's numbering separate", async () => {
    const northline = await invoices.list(ctx(NORTHLINE, BILLER), { view: "all" });
    const meridian = await invoices.list(ctx(MERIDIAN, BILLER), { view: "all" });
    assert.ok(northline.items.some((i) => i.number === "INV-2026-0101"));
    assert.ok(meridian.items.some((i) => i.number === "INV-2026-0041"));
  });
});

describe("record scope", () => {
  const driverCtx = (driverProfileId?: string) =>
    ctx(NORTHLINE, BILLER, {
      scope: { loads: "assigned", financials: "own" },
      driverProfileId,
    });

  it("shows a scoped membership only invoices for loads it drove", async () => {
    const all = await invoices.list(ctx(NORTHLINE, BILLER), { view: "all" });
    const scoped = await invoices.list(driverCtx("drv_nl_04"), { view: "all" });

    assert.ok(scoped.items.length > 0);
    assert.ok(scoped.items.length < all.items.length);

    const ownLoads = new Set(
      mockStore.org(NORTHLINE).loads
        .filter((l) => l.assignment?.driverId === "drv_nl_04")
        .map((l) => l.id),
    );
    for (const invoice of scoped.items) assert.ok(ownLoads.has(invoice.loadId));
  });

  it("shows nothing to a scoped membership with no driver profile", async () => {
    const scoped = await invoices.list(driverCtx(undefined), { view: "all" });
    assert.equal(scoped.items.length, 0);
  });

  it("hides another driver's invoice behind not found", async () => {
    const all = await invoices.list(ctx(NORTHLINE, BILLER), { view: "all" });
    const someoneElses = all.items.find((i) => {
      const load = mockStore.org(NORTHLINE).loads.find((l) => l.id === i.loadId);
      return load?.assignment?.driverId !== "drv_nl_04";
    });
    assert.ok(someoneElses);
    await rejects(() => invoices.get(driverCtx("drv_nl_04"), someoneElses.id), NotFoundError);
  });
});

describe("search, filters and summary", () => {
  it("searches the number, the load and the payer", async () => {
    const c = ctx(NORTHLINE, BILLER);
    assert.equal((await invoices.list(c, { search: "INV-2026-0101" })).items.length, 1);
    assert.equal((await invoices.list(c, { search: "NL-24728" })).items.length, 1);
    const apex = await invoices.list(c, { search: "apex", view: "all" });
    assert.ok(apex.items.length >= 2);
    for (const i of apex.items) assert.match(i.billingParty.name.toLowerCase(), /apex/);
  });

  it("filters by view", async () => {
    const c = ctx(NORTHLINE, BILLER);
    const overdue = await invoices.list(c, { view: "overdue" });
    assert.ok(overdue.items.length > 0);
    for (const i of overdue.items) assert.equal(i.status, "overdue");

    const disputed = await invoices.list(c, { view: "disputed" });
    for (const i of disputed.items) assert.equal(i.status, "disputed");

    const drafts = await invoices.list(c, { view: "draft" });
    for (const i of drafts.items) assert.equal(i.status, "draft");
  });

  it("filters by missing documents", async () => {
    const missing = await invoices.list(ctx(NORTHLINE, BILLER), { missingDocuments: true, view: "all" });
    assert.ok(missing.items.length > 0);
    for (const i of missing.items) {
      assert.ok(i.documents.some((d) => d.required && !d.documentId));
    }
  });

  it("sorts by total, both ways", async () => {
    const c = ctx(NORTHLINE, BILLER);
    const desc = await invoices.list(c, { view: "all" }, { field: "total", direction: "desc" });
    const asc = await invoices.list(c, { view: "all" }, { field: "total", direction: "asc" });
    assert.ok(desc.items[0].totalCents >= desc.items[desc.items.length - 1].totalCents);
    assert.equal(asc.items[0].id, desc.items[desc.items.length - 1].id);
  });

  it("summarises only what the caller can see", async () => {
    const summary = await invoices.summary(ctx(NORTHLINE, BILLER));
    const all = await invoices.list(ctx(NORTHLINE, BILLER), { view: "all" });

    const outstanding = all.items.filter((i) =>
      ["submitted", "disputed", "partially_paid", "overdue"].includes(i.status),
    );
    assert.equal(summary.outstandingCount, outstanding.length);
    assert.equal(
      summary.outstandingCents,
      outstanding.reduce((sum, i) => sum + i.balanceCents, 0),
    );
    assert.ok(summary.overdueCount >= 1);
    assert.ok(summary.disputedCount >= 1);
  });
});

describe("creating an invoice", () => {
  it("builds a draft from the upstream packet and links, never copies, the load", async () => {
    const c = ctx(NORTHLINE, BILLER);
    const billable = (await invoices.invoiceableLoads(c)).find((l) => !l.existingInvoiceId);
    assert.ok(billable, "expected a billable load with no invoice");

    const invoice = await invoices.create(c, { loadId: billable.loadId });
    assert.equal(invoice.status, "draft");
    assert.equal(invoice.loadId, billable.loadId);
    assert.equal(invoice.load.reference, billable.reference);
    assert.equal(invoice.version, 1);
    assert.equal(invoice.audit.length, 1);
    assert.equal(invoice.audit[0].action, "created");
    assert.equal(invoice.issueDate, undefined);
    assert.match(invoice.id, /^[0-9a-f-]{36}$/);
    assert.match(invoice.number, /^INV-\d{4}-\d{4}$/);
  });

  it("refuses a second live invoice for the same load", async () => {
    const c = ctx(NORTHLINE, BILLER);
    const taken = (await invoices.invoiceableLoads(c)).find((l) => l.existingInvoiceId);
    assert.ok(taken);
    await rejects(() => invoices.create(c, { loadId: taken.loadId }), /already bills load/);
  });

  it("allows a reissue once the first invoice is voided", async () => {
    const c = ctx(NORTHLINE, BILLER);
    const ready = await byNumber("INV-2026-0117");
    await invoices.void(c, ready.id, { reason: "Wrong payer" });

    const reissued = await invoices.create(c, { loadId: ready.loadId });
    assert.equal(reissued.loadId, ready.loadId);
    assert.notEqual(reissued.id, ready.id);
    assert.notEqual(reissued.number, ready.number);
  });

  it("bills an approved third-party payer instead of the load's customer", async () => {
    const voided = await byNumber("INV-2026-0113");
    const replacement = await byNumber("INV-2026-0114");

    assert.equal(voided.status, "void");
    assert.equal(replacement.loadId, voided.loadId);
    assert.equal(replacement.billingParty.kind, "factoring_company");
    assert.equal(replacement.replacesInvoiceId, voided.id);
  });
});

describe("the invoice lifecycle", () => {
  it("issues a complete draft straight to ready", async () => {
    const c = ctx(NORTHLINE, BILLER);
    const draft = await byNumber("INV-2026-0116");
    const issued = await invoices.issue(c, draft.id);

    assert.equal(issued.status, "ready");
    assert.ok(issued.issueDate);
    assert.ok(issued.dueDate);
    assert.equal(issued.version, draft.version + 1);
    assert.equal(issued.audit.at(-1)?.toStatus, "ready");
  });

  it("holds an incomplete invoice at needs_documents", async () => {
    const held = await byNumber("INV-2026-0115");
    assert.equal(held.status, "needs_documents");
    const readiness = await invoices.readiness(ctx(NORTHLINE, BILLER), held.id);
    assert.equal(readiness.ready, false);
    assert.ok(readiness.missingDocumentKinds.includes("proof_of_delivery"));
  });

  it("refuses to submit an invoice that is not ready, and says why", async () => {
    const c = ctx(NORTHLINE, BILLER);
    const held = await byNumber("INV-2026-0115");
    await rejects(() => invoices.submit(c, held.id, { channel: "email" }), /not ready/);
  });

  it("records a submission without claiming anything was delivered", async () => {
    const c = ctx(NORTHLINE, BILLER);
    const ready = await byNumber("INV-2026-0117");
    const sent = await invoices.submit(c, ready.id, {
      channel: "email",
      destination: "ap@apexlog.example",
    });

    assert.equal(sent.status, "submitted");
    assert.equal(sent.submission?.deliveryConfirmed, false);
    assert.equal(sent.submission?.submittedBy.membershipId, c.membershipId);
  });

  it("moves needs_documents to ready once the paperwork arrives", async () => {
    const c = ctx(NORTHLINE, BILLER);
    const held = await byNumber("INV-2026-0115");

    // The Documents module is what changes here — the POD lands against the load.
    const org = mockStore.org(NORTHLINE);
    const load = org.loads.find((l) => l.id === held.loadId);
    assert.ok(load);
    const pod = {
      ...org.documents[0],
      id: "doc_test_pod",
      kind: "proof_of_delivery" as const,
      fileName: "pod.jpg",
      version: 1,
      links: [{ entityKind: "load" as const, entityId: load.id }],
      verification: { state: "verified" as const },
    };
    org.documents.push(pod);
    load.documentRequirements = load.documentRequirements.map((r) =>
      r.kind === "proof_of_delivery" ? { ...r, satisfiedByDocumentId: pod.id } : r,
    );

    const refreshed = await invoices.refreshDocuments(c, held.id);
    assert.equal(refreshed.status, "ready");
    assert.ok(refreshed.documents.some((d) => d.documentId === pod.id));
  });

  it("records a payment and derives partially paid, then paid", async () => {
    const c = ctx(NORTHLINE, BILLER);
    const open = await byNumber("INV-2026-0112");
    assert.equal(open.status, "submitted");

    const half = Math.round(open.totalCents / 2);
    const part = await invoices.recordPayment(c, open.id, {
      amountCents: half,
      method: "ach",
      receivedAt: new Date().toISOString(),
      reference: "ACH 1",
    });
    assert.equal(part.status, "partially_paid");
    assert.equal(part.amountPaidCents, half);
    assert.equal(part.balanceCents, open.totalCents - half);

    const settled = await invoices.recordPayment(c, open.id, {
      amountCents: part.balanceCents,
      method: "ach",
      receivedAt: new Date().toISOString(),
      reference: "ACH 2",
    });
    assert.equal(settled.status, "paid");
    assert.equal(settled.balanceCents, 0);
    assert.equal(settled.payments.length, 2);
  });

  it("refuses a payment larger than the balance", async () => {
    const c = ctx(NORTHLINE, BILLER);
    const open = await byNumber("INV-2026-0112");
    await rejects(
      () => invoices.recordPayment(c, open.id, {
        amountCents: open.totalCents + 1,
        method: "check",
        receivedAt: new Date().toISOString(),
      }),
      /more than the/,
    );
  });

  it("refuses a payment against a draft", async () => {
    const c = ctx(NORTHLINE, BILLER);
    const draft = await byNumber("INV-2026-0116");
    await rejects(
      () => invoices.recordPayment(c, draft.id, {
        amountCents: 1_000, method: "ach", receivedAt: new Date().toISOString(),
      }),
      /not been billed/,
    );
  });

  it("opens and resolves a dispute without losing the payment history", async () => {
    const c = ctx(NORTHLINE, BILLER);
    const open = await byNumber("INV-2026-0107");
    assert.equal(open.status, "partially_paid");
    const paidBefore = open.amountPaidCents;

    const disputed = await invoices.openDispute(c, open.id, {
      reasonCode: "rate_mismatch",
      detail: "Rivet says the agreed rate was $1,380.00.",
      disputedAmountCents: 4_000,
    });
    assert.equal(disputed.status, "disputed");
    assert.equal(disputed.amountPaidCents, paidBefore);

    const resolved = await invoices.resolveDispute(c, open.id, "Rate con re-read; Rivet agreed to pay in full.");
    assert.equal(resolved.status, "partially_paid");
    assert.ok(resolved.dispute?.resolvedAt);
    assert.equal(resolved.amountPaidCents, paidBefore);
  });

  it("voids without releasing the number, and keeps the record", async () => {
    const c = ctx(NORTHLINE, BILLER);
    const draft = await byNumber("INV-2026-0116");
    const voided = await invoices.void(c, draft.id, { reason: "Duplicate of a manual invoice." });

    assert.equal(voided.status, "void");
    assert.equal(voided.number, draft.number);
    assert.equal(voided.voidReason, "Duplicate of a manual invoice.");

    const next = await invoices.create(c, {
      loadId: (await invoices.invoiceableLoads(c)).find((l) => !l.existingInvoiceId)!.loadId,
    });
    assert.notEqual(next.number, draft.number);
  });

  it("refuses to void an invoice that has already been paid", async () => {
    const c = ctx(NORTHLINE, BILLER);
    const paid = await byNumber("INV-2026-0101");
    await rejects(() => invoices.void(c, paid.id, { reason: "changed my mind" }), /cannot be voided/);
  });
});

describe("what an issued invoice will not let you do", () => {
  it("refuses to change the money on a submitted invoice", async () => {
    const c = ctx(NORTHLINE, BILLER);
    const sent = await byNumber("INV-2026-0112");
    await rejects(
      () => invoices.addLineItem(c, sent.id, { kind: "other", label: "Late fee", amountCents: 5_000 }),
      /changes by appending/,
    );
  });

  it("refuses to remove the linehaul, ever", async () => {
    const c = ctx(NORTHLINE, BILLER);
    const draft = await byNumber("INV-2026-0116");
    const linehaul = draft.lineItems.find((l) => l.kind === "linehaul");
    assert.ok(linehaul);
    await rejects(() => invoices.removeLineItem(c, draft.id, linehaul.id), /cannot be removed/);
  });

  it("refuses an accessorial no upstream module approved", async () => {
    const c = ctx(NORTHLINE, BILLER);
    const draft = await byNumber("INV-2026-0116");
    await rejects(
      () => invoices.addLineItem(c, draft.id, {
        kind: "lumper", label: "Lumper", amountCents: 12_500, accessorialId: "acc_not_real",
      }),
      /has not been approved upstream/,
    );
  });

  it("refuses a line item that bills nothing", async () => {
    const c = ctx(NORTHLINE, BILLER);
    const draft = await byNumber("INV-2026-0116");
    await rejects(
      () => invoices.addLineItem(c, draft.id, { kind: "other", label: "Free", amountCents: 0 }),
      /positive amount/,
    );
  });
});

describe("snapshots and audit", () => {
  it("does not rewrite an issued invoice when the payer's profile changes", async () => {
    const c = ctx(NORTHLINE, BILLER);
    const before = await byNumber("INV-2026-0101");
    const billedName = before.billingParty.name;

    // The Broker/Shipper module renames the customer months later.
    const customer = mockStore.org(NORTHLINE).customers.find((cu) => cu.id === before.billingParty.partyId);
    assert.ok(customer);
    customer.name = "Apex Logistics Group (renamed)";

    const after = await invoices.get(c, before.id);
    assert.equal(after.billingParty.name, billedName);
  });

  it("does not rewrite the billed lane when the load is edited", async () => {
    const c = ctx(NORTHLINE, BILLER);
    const before = await byNumber("INV-2026-0101");
    const load = mockStore.org(NORTHLINE).loads.find((l) => l.id === before.loadId);
    assert.ok(load);
    load.stops[0].address.city = "Somewhere Else";

    const after = await invoices.get(c, before.id);
    assert.equal(after.load.originCity, before.load.originCity);
  });

  it("bumps the version and appends one audit entry per change", async () => {
    const c = ctx(NORTHLINE, BILLER);
    const draft = await byNumber("INV-2026-0116");
    const startVersion = draft.version;
    const startAudit = draft.audit.length;

    const issued = await invoices.issue(c, draft.id);
    assert.equal(issued.version, startVersion + 1);
    assert.equal(issued.audit.length, startAudit + 1);

    const entry = issued.audit.at(-1);
    assert.equal(entry?.version, issued.version);
    assert.equal(entry?.actor.membershipId, c.membershipId);
    assert.equal(entry?.fromStatus, "draft");
  });

  it("keeps the whole history of a fixture with a long life", async () => {
    const paid = await byNumber("INV-2026-0101");
    const actions = paid.audit.map((a) => a.action);
    assert.deepEqual(actions, [
      "created", "status_changed", "submitted", "payment_recorded", "status_changed",
    ]);
    assert.equal(paid.audit.at(-1)?.toStatus, "paid");
    // Versions are sequential and never reused.
    assert.deepEqual(paid.audit.map((a) => a.version), [1, 2, 3, 4, 5]);
  });
});
