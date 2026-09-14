import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canTransition, computeTotals, deriveStatus, draftStatusFor, dueDateFor,
  evaluateReadiness, formatInvoiceNumber, meteredAmountCents, nextInvoiceNumber,
  parseInvoiceNumber, withRecomputedTotals,
} from "@/lib/invoices";
import {
  invoiceBalanceCents, isInvoiceEditable, isInvoiceOverdue, missingInvoiceDocuments,
  type Invoice, type InvoiceLineItem, type InvoicePayment,
} from "@/types";

const ACTOR = {
  userId: "usr_test",
  membershipId: "mem_test",
  displayNameSnapshot: "Test Actor",
  source: "web" as const,
};

const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

function line(overrides: Partial<InvoiceLineItem> = {}): InvoiceLineItem {
  return {
    id: `ivl_${Math.random().toString(36).slice(2, 8)}`,
    kind: "linehaul",
    label: "Linehaul",
    amountCents: 100_000,
    source: { module: "rate_confirmation", referenceId: "rcon_1" },
    ...overrides,
  };
}

function payment(amountCents: number, daysAgo = 1): InvoicePayment {
  return {
    id: `ivp_${Math.random().toString(36).slice(2, 8)}`,
    amountCents,
    currency: "USD",
    method: "ach",
    receivedAt: days(-daysAgo),
    recordedBy: ACTOR,
    recordedAt: days(-daysAgo),
  };
}

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  const lineItems = overrides.lineItems ?? [line()];
  const payments = overrides.payments ?? [];
  // Built through the same recompute the service uses, so a fixture can never
  // be internally inconsistent in a way production could not be.
  return withRecomputedTotals({
    id: "6f1c0a2e-0000-4000-8000-000000000001",
    organizationId: "org_test",
    number: "INV-2026-0001",
    status: "draft",
    currency: "USD",
    carrier: {
      organizationId: "org_test",
      legalName: "Test Carrier LLC",
      displayName: "Test Carrier",
    },
    billingParty: {
      partyId: "cus_test",
      kind: "broker",
      name: "Test Broker",
      billingContact: { email: "ap@broker.example" },
      paymentTermsDays: 30,
    },
    loadId: "ld_test",
    load: {
      loadId: "ld_test",
      reference: "TL-0001",
      originCity: "Chicago", originState: "IL",
      destinationCity: "Dallas", destinationState: "TX",
      deliveredAt: days(-3),
      equipment: "box_truck",
      loadedMiles: 900,
    },
    rateConfirmation: {
      rateConfirmationId: "rcon_1",
      agreedLinehaulCents: 100_000,
      preApprovedAccessorialCodes: ["detention"],
      receivedAt: days(-6),
      verifiedAt: days(-6),
    },
    linehaulCents: 100_000,
    lineItems,
    subtotalCents: 0,
    totalCents: 0,
    amountPaidCents: 0,
    balanceCents: 0,
    paymentTermsDays: 30,
    documents: [
      { kind: "rate_confirmation", required: true, documentId: "doc_1", verificationStateSnapshot: "verified" },
      { kind: "bill_of_lading", required: true, documentId: "doc_2", verificationStateSnapshot: "not_required" },
      { kind: "proof_of_delivery", required: true, documentId: "doc_3", verificationStateSnapshot: "not_required" },
    ],
    payments,
    version: 1,
    audit: [],
    createdAt: days(-3),
    createdBy: ACTOR,
    updatedAt: days(-3),
    ...overrides,
  } as Invoice);
}

describe("invoice money", () => {
  it("sums line items and payments without touching floats", () => {
    const totals = computeTotals(
      [line({ amountCents: 104_100 }), line({ kind: "detention", amountCents: 8_000 })],
      [payment(50_000)],
    );
    assert.equal(totals.subtotalCents, 112_100);
    assert.equal(totals.totalCents, 112_100);
    assert.equal(totals.amountPaidCents, 50_000);
    assert.equal(totals.balanceCents, 62_100);
  });

  it("meters a charge to whole cents", () => {
    assert.equal(meteredAmountCents(2.5, 6_500), 16_250);
    assert.equal(meteredAmountCents(1.5, 5_333), 8_000);
  });

  it("reads the balance off the invoice, not off a recomputation", () => {
    const inv = invoice({ payments: [payment(40_000)] });
    assert.equal(invoiceBalanceCents(inv), 60_000);
  });
});

describe("invoice numbering", () => {
  it("is per organization and per year, and never reuses a number", () => {
    assert.equal(
      nextInvoiceNumber(["INV-2026-0001", "INV-2026-0002"], { year: 2026 }),
      "INV-2026-0003",
    );
  });

  it("continues from the highest number a carrier already used", () => {
    assert.equal(
      nextInvoiceNumber(["INV-2026-0412", "INV-2026-0007"], { year: 2026 }),
      "INV-2026-0413",
    );
  });

  it("does not let a void steal its number back", () => {
    // The voided number is still in the list, so the sequence steps past it.
    const used = ["INV-2026-0113", "INV-2026-0114"];
    assert.equal(nextInvoiceNumber(used, { year: 2026 }), "INV-2026-0115");
  });

  it("ignores numbers from another year or another prefix", () => {
    assert.equal(
      nextInvoiceNumber(["INV-2025-0900", "ACME-2026-0500"], { year: 2026 }),
      "INV-2026-0001",
    );
  });

  it("round-trips format and parse", () => {
    const parts = { prefix: "INV", year: 2026, sequence: 42 };
    assert.equal(formatInvoiceNumber(parts), "INV-2026-0042");
    assert.deepEqual(parseInvoiceNumber("INV-2026-0042"), parts);
    assert.equal(parseInvoiceNumber("not-an-invoice"), null);
  });
});

describe("readiness", () => {
  it("passes a complete invoice", () => {
    const readiness = evaluateReadiness(invoice());
    assert.equal(readiness.ready, true, JSON.stringify(readiness.checks.filter((c) => c.state === "fail")));
    assert.equal(readiness.missingDocumentKinds.length, 0);
  });

  it("blocks when a required document is missing, and names it", () => {
    const inv = invoice({
      documents: [
        { kind: "rate_confirmation", required: true, documentId: "doc_1" },
        { kind: "proof_of_delivery", required: true },
      ],
    });
    const readiness = evaluateReadiness(inv);
    assert.equal(readiness.ready, false);
    assert.deepEqual(readiness.missingDocumentKinds, ["proof_of_delivery"]);
    assert.equal(missingInvoiceDocuments(inv).length, 1);
  });

  it("blocks when an attached document was rejected", () => {
    const inv = invoice({
      documents: [
        { kind: "rate_confirmation", required: true, documentId: "doc_1" },
        { kind: "proof_of_delivery", required: true, documentId: "doc_3", verificationStateSnapshot: "rejected" },
      ],
    });
    const check = evaluateReadiness(inv).checks.find((c) => c.id === "documents_verified");
    assert.equal(check?.state, "fail");
  });

  it("blocks an accessorial nobody approved", () => {
    const inv = invoice({
      lineItems: [
        line(),
        line({ kind: "lumper", label: "Lumper fee", amountCents: 12_500, source: { module: "accessorial", referenceId: "acc_1" } }),
      ],
    });
    const readiness = evaluateReadiness(inv);
    assert.equal(readiness.ready, false);
    const check = readiness.checks.find((c) => c.id === "accessorials_approved");
    assert.equal(check?.state, "fail");
    assert.match(check!.detail, /Lumper fee/);
  });

  it("accepts an accessorial the rate confirmation pre-authorized", () => {
    const inv = invoice({
      lineItems: [
        line(),
        line({ kind: "detention", label: "Detention, 1.5 hrs", amountCents: 8_000, source: { module: "detention", referenceId: "acc_2" } }),
      ],
    });
    assert.equal(evaluateReadiness(inv).ready, true);
  });

  it("blocks a linehaul that does not match the rate confirmation", () => {
    const inv = invoice({ lineItems: [line({ amountCents: 110_000 })] });
    const check = evaluateReadiness(inv).checks.find((c) => c.id === "linehaul_matches_rate_con");
    assert.equal(check?.state, "fail");
  });

  it("blocks a load that never delivered", () => {
    const inv = invoice({ load: { ...invoice().load, deliveredAt: undefined } });
    const check = evaluateReadiness(inv).checks.find((c) => c.id === "load_delivered");
    assert.equal(check?.state, "fail");
  });

  it("warns without blocking when the payer wants original documents", () => {
    const inv = invoice({
      billingParty: { ...invoice().billingParty, requiresOriginalDocuments: true },
    });
    const readiness = evaluateReadiness(inv);
    const check = readiness.checks.find((c) => c.id === "billing_party_billable");
    assert.equal(check?.state, "warn");
    assert.equal(readiness.ready, true);
  });

  it("blocks a payer with no terms to count days against", () => {
    const inv = invoice({
      billingParty: { ...invoice().billingParty, paymentTermsDays: 0 },
    });
    assert.equal(evaluateReadiness(inv).ready, false);
  });
});

describe("status", () => {
  it("allows only the transitions a person may make", () => {
    assert.equal(canTransition("draft", "ready"), true);
    assert.equal(canTransition("ready", "submitted"), true);
    assert.equal(canTransition("draft", "submitted"), false);
    assert.equal(canTransition("paid", "submitted"), false);
    assert.equal(canTransition("void", "draft"), false);
  });

  it("derives the draft-side status from readiness", () => {
    assert.equal(draftStatusFor(evaluateReadiness(invoice())), "ready");
    const short = invoice({ documents: [{ kind: "proof_of_delivery", required: true }] });
    assert.equal(draftStatusFor(evaluateReadiness(short)), "needs_documents");
  });

  it("counts the due date off the issue date and the payer's terms", () => {
    const due = dueDateFor("2026-09-01T00:00:00.000Z", 30);
    assert.equal(due.slice(0, 10), "2026-10-01");
  });

  it("calls a submitted invoice overdue once its due date passes", () => {
    const inv = invoice({
      status: "submitted",
      issueDate: days(-40),
      dueDate: days(-10),
    });
    assert.equal(isInvoiceOverdue(inv), true);
    assert.equal(deriveStatus(inv), "overdue");
  });

  it("never calls a draft overdue, however old it is", () => {
    const inv = invoice({ status: "draft", dueDate: days(-90) });
    assert.equal(isInvoiceOverdue(inv), false);
    assert.equal(deriveStatus(inv), "draft");
  });

  it("settles to paid when the balance reaches zero, dispute or not", () => {
    const inv = invoice({
      status: "disputed",
      issueDate: days(-20),
      dueDate: days(-5),
      payments: [payment(100_000)],
      dispute: {
        openedAt: days(-10),
        openedBy: ACTOR,
        reasonCode: "rate_mismatch",
        detail: "Rate disagreement",
      },
    });
    assert.equal(deriveStatus(inv), "paid");
  });

  it("keeps an open dispute ahead of the overdue derivation", () => {
    const inv = invoice({
      status: "disputed",
      issueDate: days(-40),
      dueDate: days(-10),
      dispute: {
        openedAt: days(-9),
        openedBy: ACTOR,
        reasonCode: "accessorial_rejected",
        detail: "Lumper rejected",
      },
    });
    assert.equal(deriveStatus(inv), "disputed");
  });

  it("only lets money change while the invoice is still being assembled", () => {
    assert.equal(isInvoiceEditable(invoice({ status: "draft" })), true);
    assert.equal(isInvoiceEditable(invoice({ status: "needs_documents" })), true);
    assert.equal(isInvoiceEditable(invoice({ status: "submitted" })), false);
    assert.equal(isInvoiceEditable(invoice({ status: "paid" })), false);
  });
});
