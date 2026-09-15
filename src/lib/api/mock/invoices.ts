import type {
  Invoice, InvoiceReadiness, InvoiceStatus, Page, PageRequest, PermissionKey,
} from "@/types";
import {
  INVOICE_OPEN_STATUSES, invoiceAgeDays, missingInvoiceDocuments,
} from "@/types";
import {
  assertTransition, draftStatusFor, dueDateFor, evaluateReadiness,
  blockingReasons,
} from "@/lib/invoices";
import {
  NotFoundError, PermissionDeniedError, type ServiceContext,
} from "../contracts/context";
import type {
  AddLineItemInput, CreateInvoiceInput, InvoiceFilters, InvoiceSort,
  InvoiceSummary, InvoiceableLoad, InvoicesService, OpenDisputeInput,
  RecordPaymentInput, SubmitInvoiceInput, VoidInvoiceInput,
} from "../contracts/invoices";
import {
  applyChange, buildDraftInvoice, buildLineItem, documentRefsFrom,
  invoiceStore, nextNumberFor, paymentId,
} from "./invoice-registry";
import { approvedAccessorialInputs, sourcePacketFor } from "./invoice-sources";
import { mockStore } from "./store";
import { nowIso } from "./time";

const LATENCY_MS = 200;
const wait = () => new Promise<void>((r) => setTimeout(r, LATENCY_MS));

/**
 * The invoice service.
 *
 * Two things are enforced HERE, at the seam, and not in the screens:
 *
 *  1. PERMISSION. Every method names the key it needs and throws without it.
 *     A UI bug that renders a forbidden button still fails at this line, which
 *     is the expectation the real API must meet.
 *
 *  2. CARRIER DATA ISOLATION. An invoice is reachable only through the carrier
 *     organization that owns it. Another carrier's invoice is NOT FOUND rather
 *     than forbidden — a 403 would confirm that some other carrier has an
 *     invoice for that load, which is itself commercial information.
 *
 * Record scope narrows further: a membership scoped to its own records sees
 * only invoices for loads it actually drove.
 */

function require(ctx: ServiceContext, ...keys: PermissionKey[]): void {
  const missing = keys.filter((k) => !ctx.permissions.has(k));
  if (missing.length > 0) throw new PermissionDeniedError(missing);
}

/**
 * The caller's visible set: their organization's invoices, narrowed by record
 * scope. Everything else in this file starts from this function — there is no
 * accessor that reaches around it.
 */
function visibleInvoices(ctx: ServiceContext): Invoice[] {
  require(ctx, "invoices:view");
  const all = invoiceStore.all(ctx.organizationId);

  if (ctx.scope.loads === "assigned" || ctx.scope.financials === "own") {
    if (!ctx.driverProfileId) return [];
    const ownLoadIds = new Set(
      mockStore
        .org(ctx.organizationId)
        .loads.filter((l) => l.assignment?.driverId === ctx.driverProfileId)
        .map((l) => l.id),
    );
    return all.filter((i) => ownLoadIds.has(i.loadId));
  }
  return all;
}

function findInvoice(ctx: ServiceContext, invoiceId: string): Invoice {
  const invoice = visibleInvoices(ctx).find((i) => i.id === invoiceId);
  if (!invoice) throw new NotFoundError("Invoice");
  // Belt and braces: the store is partitioned, and the record still has to
  // agree about who owns it before anything is returned.
  mockStore.assertOwned(ctx.organizationId, invoice.organizationId);
  return invoice;
}

/* -------------------------------------------------------------------------- */
/* Filtering and sorting                                                       */
/* -------------------------------------------------------------------------- */

const OUTSTANDING: InvoiceStatus[] = [...INVOICE_OPEN_STATUSES];

function inView(invoice: Invoice, view: InvoiceFilters["view"]): boolean {
  switch (view) {
    case "draft": return invoice.status === "draft";
    case "needs_documents": return invoice.status === "needs_documents";
    case "ready": return invoice.status === "ready";
    case "outstanding": return OUTSTANDING.includes(invoice.status);
    case "overdue": return invoice.status === "overdue";
    case "disputed": return invoice.status === "disputed";
    case "paid": return invoice.status === "paid";
    case "void": return invoice.status === "void";
    default: return true;
  }
}

function matches(invoice: Invoice, f: InvoiceFilters): boolean {
  if (f.view && !inView(invoice, f.view)) return false;
  if (f.status?.length && !f.status.includes(invoice.status)) return false;
  if (f.billingPartyId && invoice.billingParty.partyId !== f.billingPartyId) return false;
  if (f.loadId && invoice.loadId !== f.loadId) return false;
  if (f.overdueOnly && invoice.status !== "overdue") return false;
  if (f.missingDocuments && missingInvoiceDocuments(invoice).length === 0) return false;
  if (f.minTotalCents != null && invoice.totalCents < f.minTotalCents) return false;
  if (f.issuedFrom) {
    if (!invoice.issueDate) return false;
    if (new Date(invoice.issueDate).getTime() < new Date(f.issuedFrom).getTime()) return false;
  }
  if (f.issuedTo) {
    if (!invoice.issueDate) return false;
    if (new Date(invoice.issueDate).getTime() > new Date(f.issuedTo).getTime()) return false;
  }
  if (f.search) {
    const q = f.search.trim().toLowerCase();
    const hay = [
      invoice.number,
      invoice.load.reference,
      invoice.load.customerReference ?? "",
      invoice.billingParty.name,
      invoice.load.originCity,
      invoice.load.destinationCity,
      invoice.load.driverNameSnapshot ?? "",
    ]
      .join(" ")
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function timeOf(iso?: string): number {
  return iso ? new Date(iso).getTime() : 0;
}

function compare(a: Invoice, b: Invoice, sort: InvoiceSort): number {
  const dir = sort.direction === "asc" ? 1 : -1;
  switch (sort.field) {
    case "number": return a.number.localeCompare(b.number) * dir;
    case "dueDate": return (timeOf(a.dueDate) - timeOf(b.dueDate)) * dir;
    case "total": return (a.totalCents - b.totalCents) * dir;
    case "balance": return (a.balanceCents - b.balanceCents) * dir;
    case "billingParty":
      return a.billingParty.name.localeCompare(b.billingParty.name) * dir;
    case "status": return a.status.localeCompare(b.status) * dir;
    case "age": return (invoiceAgeDays(a) - invoiceAgeDays(b)) * dir;
    case "issueDate":
    default:
      return (
        (timeOf(a.issueDate ?? a.createdAt) - timeOf(b.issueDate ?? b.createdAt)) * dir
      );
  }
}

/* -------------------------------------------------------------------------- */
/* Service                                                                     */
/* -------------------------------------------------------------------------- */

export const mockInvoicesService: InvoicesService = {
  async list(ctx, filters = {}, sort, page: PageRequest = {}): Promise<Page<Invoice>> {
    await wait();
    const all = visibleInvoices(ctx)
      .filter((i) => matches(i, filters))
      .sort((a, b) => compare(a, b, sort ?? { field: "issueDate", direction: "desc" }));

    const limit = page.limit ?? 50;
    const start = page.cursor ? Number(page.cursor) : 0;
    const items = all.slice(start, start + limit);
    const next = start + limit;

    return {
      items,
      totalCount: all.length,
      nextCursor: next < all.length ? String(next) : undefined,
    };
  },

  async get(ctx, invoiceId) {
    await wait();
    return findInvoice(ctx, invoiceId);
  },

  async summary(ctx): Promise<InvoiceSummary> {
    await wait();
    const invoices = visibleInvoices(ctx);
    const sum = (rows: Invoice[], pick: (i: Invoice) => number) =>
      rows.reduce((total, i) => total + pick(i), 0);

    const outstanding = invoices.filter((i) => OUTSTANDING.includes(i.status));
    const overdue = invoices.filter((i) => i.status === "overdue");
    const disputed = invoices.filter((i) => i.status === "disputed");
    const thirtyDaysAgo = Date.now() - 30 * 86_400_000;
    const recentlyPaid = invoices.filter(
      (i) =>
        i.status === "paid" &&
        i.payments.some((p) => new Date(p.receivedAt).getTime() >= thirtyDaysAgo),
    );

    return {
      currency: "USD",
      draftCount: invoices.filter((i) => i.status === "draft").length,
      needsDocumentsCount: invoices.filter((i) => i.status === "needs_documents").length,
      readyCount: invoices.filter((i) => i.status === "ready").length,
      outstandingCount: outstanding.length,
      outstandingCents: sum(outstanding, (i) => i.balanceCents),
      overdueCount: overdue.length,
      overdueCents: sum(overdue, (i) => i.balanceCents),
      disputedCount: disputed.length,
      disputedCents: sum(disputed, (i) => i.dispute?.disputedAmountCents ?? i.balanceCents),
      paidLast30DaysCents: sum(recentlyPaid, (i) => i.amountPaidCents),
    };
  },

  async readiness(ctx, invoiceId): Promise<InvoiceReadiness> {
    await wait();
    return evaluateReadiness(findInvoice(ctx, invoiceId));
  },

  async invoiceableLoads(ctx): Promise<InvoiceableLoad[]> {
    await wait();
    require(ctx, "invoices:view", "loads:view");

    const invoices = invoiceStore.all(ctx.organizationId);
    const org = mockStore.org(ctx.organizationId);

    // The Loads module decides what "finished" means; Invoices only reads it.
    const billableStatuses = ["delivered", "ready_to_invoice", "invoiced", "paid"];

    return org.loads
      .filter((l) => billableStatuses.includes(l.status))
      .map((load) => {
        // A void invoice does not block a reissue; anything else does.
        const existing = invoices.find(
          (i) => i.loadId === load.id && i.status !== "void",
        );
        return {
          loadId: load.id,
          reference: load.reference,
          billingPartyName: load.customer.name,
          lane: `${load.stops[0].address.city}, ${load.stops[0].address.state} → ${
            load.stops[load.stops.length - 1].address.city
          }, ${load.stops[load.stops.length - 1].address.state}`,
          deliveredAt: load.stops[load.stops.length - 1].departedAt,
          totalRateCents: load.financials?.totalRateCents ?? 0,
          missingDocumentKinds: load.documentRequirements
            .filter((r) => r.required && !r.satisfiedByDocumentId)
            .map((r) => r.kind),
          existingInvoiceId: existing?.id,
        };
      })
      .sort((a, b) => timeOf(b.deliveredAt) - timeOf(a.deliveredAt));
  },

  async create(ctx, input: CreateInvoiceInput) {
    await wait();
    require(ctx, "invoices:create");

    const packet = sourcePacketFor(ctx.organizationId, input.loadId, input.billingPartyId);
    // A load in another organization is NOT FOUND here, exactly as it would be
    // if it did not exist at all.
    if (!packet) throw new NotFoundError("Load");

    const existing = invoiceStore
      .all(ctx.organizationId)
      .find((i) => i.loadId === input.loadId && i.status !== "void");
    if (existing) {
      throw new Error(
        `${existing.number} already bills load ${packet.load.reference}. Void it before issuing another.`,
      );
    }

    const invoice = buildDraftInvoice({
      organizationId: ctx.organizationId,
      number: nextNumberFor(ctx.organizationId),
      packet,
      actor: ctx.actor,
      paymentTermsDays: input.paymentTermsDays,
      note: input.note,
    });

    return invoiceStore.add(ctx.organizationId, invoice);
  },

  async addLineItem(ctx, invoiceId, input: AddLineItemInput) {
    await wait();
    require(ctx, "invoices:edit");
    const invoice = findInvoice(ctx, invoiceId);
    assertEditable(invoice);

    if (input.amountCents <= 0) {
      throw new Error("A line item has to bill a positive amount.");
    }

    // An accessorial may only be billed if the module that owns it approved it.
    let approved;
    if (input.accessorialId) {
      const load = mockStore
        .org(ctx.organizationId)
        .loads.find((l) => l.id === invoice.loadId);
      approved = load
        ? approvedAccessorialInputs(load).find((a) => a.accessorialId === input.accessorialId)
        : undefined;
      if (!approved) {
        throw new Error(
          "That accessorial has not been approved upstream, so it cannot be billed.",
        );
      }
    }

    const line = buildLineItem(input, approved, ctx.actor);
    const next = applyChange(
      invoice,
      { lineItems: [...invoice.lineItems, line] },
      {
        actor: ctx.actor,
        action: "line_item_added",
        amountCents: line.amountCents,
        changedFields: ["lineItems"],
        note: `${line.label} added.`,
      },
    );
    return invoiceStore.replace(ctx.organizationId, next);
  },

  async removeLineItem(ctx, invoiceId, lineItemId) {
    await wait();
    require(ctx, "invoices:edit");
    const invoice = findInvoice(ctx, invoiceId);
    assertEditable(invoice);

    const line = invoice.lineItems.find((l) => l.id === lineItemId);
    if (!line) throw new NotFoundError("Line item");
    if (line.kind === "linehaul") {
      throw new Error(
        "The linehaul comes from the rate confirmation and cannot be removed. Void the invoice instead.",
      );
    }

    const next = applyChange(
      invoice,
      { lineItems: invoice.lineItems.filter((l) => l.id !== lineItemId) },
      {
        actor: ctx.actor,
        action: "line_item_removed",
        amountCents: line.amountCents,
        changedFields: ["lineItems"],
        note: `${line.label} removed.`,
      },
    );
    return invoiceStore.replace(ctx.organizationId, next);
  },

  async refreshDocuments(ctx, invoiceId) {
    await wait();
    require(ctx, "invoices:edit");
    const invoice = findInvoice(ctx, invoiceId);

    const packet = sourcePacketFor(
      ctx.organizationId, invoice.loadId, invoice.billingParty.partyId,
    );
    if (!packet) throw new NotFoundError("Load");

    const documents = documentRefsFrom(packet);
    const before = missingInvoiceDocuments(invoice).length;
    const withDocs = applyChange(
      invoice,
      { documents },
      {
        actor: ctx.actor,
        action: "documents_refreshed",
        changedFields: ["documents"],
        note: `Re-read the Documents module: ${
          documents.filter((d) => d.documentId).length
        } of ${documents.length} requirements satisfied.`,
      },
    );

    // A refresh that completes the paperwork moves the invoice on by itself.
    const after = missingInvoiceDocuments(withDocs).length;
    if (withDocs.issueDate && before !== after) {
      const status = draftStatusFor(evaluateReadiness(withDocs));
      if (status !== withDocs.status && canReadinessMove(withDocs.status)) {
        const moved = applyChange(withDocs, { status }, {
          actor: ctx.actor,
          action: "status_changed",
          fromStatus: withDocs.status,
          toStatus: status,
          note: "Readiness re-evaluated after the documents changed.",
        });
        return invoiceStore.replace(ctx.organizationId, moved);
      }
    }
    return invoiceStore.replace(ctx.organizationId, withDocs);
  },

  async issue(ctx, invoiceId) {
    await wait();
    require(ctx, "invoices:edit");
    const invoice = findInvoice(ctx, invoiceId);
    if (invoice.status !== "draft") {
      throw new Error(`${invoice.number} has already been issued.`);
    }

    const issueDate = nowIso();
    const dated = {
      ...invoice,
      issueDate,
      dueDate: dueDateFor(issueDate, invoice.paymentTermsDays),
    };
    const status = draftStatusFor(evaluateReadiness(dated));
    assertTransition(invoice.status, status);

    const next = applyChange(
      invoice,
      { ...dated, status },
      {
        actor: ctx.actor,
        action: "status_changed",
        fromStatus: invoice.status,
        toStatus: status,
        changedFields: ["issueDate", "dueDate", "status"],
        note: status === "ready"
          ? "Issued. Every readiness check passed."
          : "Issued, but the paperwork is not complete yet.",
      },
    );
    return invoiceStore.replace(ctx.organizationId, next);
  },

  async recheck(ctx, invoiceId) {
    await wait();
    require(ctx, "invoices:view");
    const invoice = findInvoice(ctx, invoiceId);
    if (!canReadinessMove(invoice.status)) {
      throw new Error(
        `Readiness only applies before an invoice is sent. ${invoice.number} is ${invoice.status}.`,
      );
    }

    const status = draftStatusFor(evaluateReadiness(invoice));
    if (status === invoice.status) return invoice;

    const next = applyChange(invoice, { status }, {
      actor: ctx.actor,
      action: "status_changed",
      fromStatus: invoice.status,
      toStatus: status,
      note: "Readiness re-checked.",
    });
    return invoiceStore.replace(ctx.organizationId, next);
  },

  async submit(ctx, invoiceId, input: SubmitInvoiceInput) {
    await wait();
    require(ctx, "invoices:send");
    const invoice = findInvoice(ctx, invoiceId);

    const readiness = evaluateReadiness(invoice);
    if (!readiness.ready) {
      throw new Error(
        `${invoice.number} is not ready: ${blockingReasons(readiness)
          .map((r) => r.label.toLowerCase())
          .join(", ")}.`,
      );
    }
    assertTransition(invoice.status, "submitted");

    const at = nowIso();
    const next = applyChange(
      invoice,
      {
        status: "submitted",
        submission: {
          submittedAt: at,
          submittedBy: ctx.actor,
          channel: input.channel,
          destination: input.destination,
          reference: input.reference,
          note: input.note,
          // Antcolos sends nothing. This records what a person did outside it.
          deliveryConfirmed: false,
        },
      },
      {
        actor: ctx.actor,
        action: "submitted",
        at,
        fromStatus: invoice.status,
        toStatus: "submitted",
        note: input.note ?? `Recorded as sent by ${input.channel}.`,
      },
    );
    return invoiceStore.replace(ctx.organizationId, next);
  },

  async recordPayment(ctx, invoiceId, input: RecordPaymentInput) {
    await wait();
    require(ctx, "invoices:edit");
    const invoice = findInvoice(ctx, invoiceId);

    if (invoice.status === "void") {
      throw new Error("A voided invoice cannot take a payment.");
    }
    if (!invoice.issueDate) {
      throw new Error("A draft has not been billed to anyone yet.");
    }
    if (input.amountCents <= 0) throw new Error("A payment has to be positive.");
    if (input.amountCents > invoice.balanceCents) {
      throw new Error(
        `That is more than the ${(invoice.balanceCents / 100).toFixed(2)} outstanding. Overpayments are an accounting matter, and accounting is not connected.`,
      );
    }

    const at = nowIso();
    const withPayment = applyChange(
      invoice,
      {
        payments: [
          ...invoice.payments,
          {
            id: paymentId(),
            amountCents: input.amountCents,
            currency: "USD" as const,
            method: input.method,
            receivedAt: input.receivedAt,
            reference: input.reference,
            note: input.note,
            recordedBy: ctx.actor,
            recordedAt: at,
          },
        ],
      },
      {
        actor: ctx.actor,
        action: "payment_recorded",
        at,
        amountCents: input.amountCents,
        changedFields: ["payments"],
        note: `${input.method.toUpperCase()} recorded${input.reference ? ` · ${input.reference}` : ""}. No payment processor is connected; this is somebody saying what arrived.`,
      },
    );

    const status: InvoiceStatus =
      withPayment.balanceCents <= 0 ? "paid" : "partially_paid";
    const next = applyChange(withPayment, { status }, {
      actor: ctx.actor,
      action: "status_changed",
      at,
      fromStatus: withPayment.status,
      toStatus: status,
    });
    return invoiceStore.replace(ctx.organizationId, next);
  },

  async openDispute(ctx, invoiceId, input: OpenDisputeInput) {
    await wait();
    require(ctx, "invoices:edit");
    const invoice = findInvoice(ctx, invoiceId);
    if (!input.detail.trim()) throw new Error("A dispute needs to say what is wrong.");
    assertTransition(invoice.status, "disputed");

    const next = applyChange(
      invoice,
      {
        status: "disputed",
        dispute: {
          openedAt: nowIso(),
          openedBy: ctx.actor,
          reasonCode: input.reasonCode,
          detail: input.detail.trim(),
          disputedAmountCents: input.disputedAmountCents,
        },
      },
      {
        actor: ctx.actor,
        action: "dispute_opened",
        fromStatus: invoice.status,
        toStatus: "disputed",
        amountCents: input.disputedAmountCents,
        note: input.detail.trim(),
      },
    );
    return invoiceStore.replace(ctx.organizationId, next);
  },

  async resolveDispute(ctx, invoiceId, resolution) {
    await wait();
    require(ctx, "invoices:edit");
    const invoice = findInvoice(ctx, invoiceId);
    if (!invoice.dispute || invoice.dispute.resolvedAt) {
      throw new Error(`${invoice.number} has no open dispute.`);
    }
    if (!resolution.trim()) throw new Error("A resolution has to say what was agreed.");

    const at = nowIso();
    // Resolving returns the invoice to where the money says it should be.
    const status: InvoiceStatus =
      invoice.balanceCents <= 0 ? "paid"
        : invoice.payments.length > 0 ? "partially_paid"
          : "submitted";

    const next = applyChange(
      invoice,
      {
        status,
        dispute: {
          ...invoice.dispute,
          resolvedAt: at,
          resolvedBy: ctx.actor,
          resolution: resolution.trim(),
        },
      },
      {
        actor: ctx.actor,
        action: "dispute_resolved",
        at,
        fromStatus: invoice.status,
        toStatus: status,
        note: resolution.trim(),
      },
    );
    return invoiceStore.replace(ctx.organizationId, next);
  },

  async void(ctx, invoiceId, input: VoidInvoiceInput) {
    await wait();
    require(ctx, "invoices:edit");
    const invoice = findInvoice(ctx, invoiceId);
    if (!input.reason.trim()) throw new Error("A void has to say why.");
    if (invoice.status === "paid") {
      throw new Error("A paid invoice cannot be voided. Issue a credit instead — and credits are not built yet.");
    }
    assertTransition(invoice.status, "void");

    const at = nowIso();
    const next = applyChange(
      invoice,
      {
        status: "void",
        voidedAt: at,
        voidedBy: ctx.actor,
        voidReason: input.reason.trim(),
      },
      {
        actor: ctx.actor,
        action: "voided",
        at,
        fromStatus: invoice.status,
        toStatus: "void",
        note: input.reason.trim(),
      },
    );
    // The number is NOT released. The gap in the sequence is the record.
    return invoiceStore.replace(ctx.organizationId, next);
  },
};

/** Money may only change while the invoice is still being assembled. */
function assertEditable(invoice: Invoice): void {
  if (invoice.status === "draft" || invoice.status === "needs_documents") return;
  throw new Error(
    `${invoice.number} is ${invoice.status}. An issued invoice changes by appending — a payment, a dispute or a void — never by editing what was billed.`,
  );
}

function canReadinessMove(status: InvoiceStatus): boolean {
  return status === "needs_documents" || status === "ready";
}
