import type {
  ActorRef, Invoice, InvoiceAuditAction, InvoiceAuditEntry, InvoiceDocumentRef,
  InvoiceLineItem, InvoiceLineSource, InvoiceStatus, Load, NeedsYouItem,
} from "@/types";
import { missingInvoiceDocuments } from "@/types";
import {
  deriveStatus, dueDateFor, draftStatusFor, evaluateReadiness,
  nextInvoiceNumber, withRecomputedTotals,
} from "@/lib/invoices";
import type {
  AddLineItemInput, ApprovedAccessorialInput, InvoiceSourcePacket,
} from "../contracts/invoices";
import {
  carrierSnapshotFor, sourcePacketFor, toBillingPartySnapshot,
} from "./invoice-sources";
import { mockStore } from "./store";
import { daysFromNow, nowIso } from "./time";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The invoice store, PARTITIONED BY CARRIER ORGANIZATION. Every accessor takes
 * an organizationId, and an invoice is only ever reachable through the
 * organization that owns it, so a cross-carrier read fails here in development
 * exactly as it must in production.
 *
 * Fixtures are seeded lazily, per organization, from loads that already exist
 * in the load store. Nothing here invents a load, a document, a rate
 * confirmation or a broker profile: it goes through `invoice-sources.ts`,
 * which is the stand-in for those modules and the only place that pretends.
 */

let seq = 0;
const rowId = (prefix: string) => `${prefix}_${(++seq).toString(36).padStart(4, "0")}`;

/** Invoice ids are UUIDs and nothing else. Never parsed, never derived. */
export function invoiceUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += "-";
    else if (i === 14) out += "4";
    else out += hex[Math.floor(Math.random() * 16)];
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Audit                                                                       */
/* -------------------------------------------------------------------------- */

export interface AuditInput {
  actor: ActorRef;
  action: InvoiceAuditAction;
  at?: string;
  fromStatus?: InvoiceStatus;
  toStatus?: InvoiceStatus;
  changedFields?: string[];
  note?: string;
  amountCents?: number;
}

/**
 * The only way an invoice changes. Every mutation bumps the version, appends
 * one audit entry and stamps `updatedAt` — there is no path that edits an
 * invoice quietly, which is the whole point of the record.
 */
export function applyChange(
  invoice: Invoice,
  change: Partial<Invoice>,
  audit: AuditInput,
): Invoice {
  const version = invoice.version + 1;
  const at = audit.at ?? nowIso();
  const entry: InvoiceAuditEntry = {
    id: rowId("iva"),
    version,
    at,
    actor: audit.actor,
    action: audit.action,
    fromStatus: audit.fromStatus,
    toStatus: audit.toStatus,
    changedFields: audit.changedFields,
    note: audit.note,
    amountCents: audit.amountCents,
  };
  return withRecomputedTotals({
    ...invoice,
    ...change,
    version,
    updatedAt: at,
    audit: [...invoice.audit, entry],
  });
}

/* -------------------------------------------------------------------------- */
/* Building an invoice from an upstream packet                                 */
/* -------------------------------------------------------------------------- */

function accessorialLine(input: ApprovedAccessorialInput): InvoiceLineItem {
  const owningModule: InvoiceLineSource["module"] =
    input.kind === "detention" ? "detention"
      : input.kind === "layover" ? "layover"
        : "accessorial";
  return {
    id: rowId("ivl"),
    kind: input.kind,
    label: input.label,
    quantity: input.quantity,
    unit: input.unit,
    unitAmountCents: input.unitAmountCents,
    amountCents: input.amountCents,
    notes: input.notes,
    source: {
      module: owningModule,
      referenceId: input.accessorialId,
      approvedBy: {
        userId: "usr_sam",
        membershipId: input.approvedByMembershipId,
        displayNameSnapshot: input.approvedByDisplayName,
        source: "web",
      },
      approvedAt: input.approvedAt,
      evidenceDocumentId: input.evidenceDocumentId,
    },
  };
}

export function documentRefsFrom(packet: InvoiceSourcePacket): InvoiceDocumentRef[] {
  return packet.documents.map((d) => ({
    kind: d.kind,
    required: d.required,
    documentId: d.documentId,
    fileNameSnapshot: d.fileName,
    versionSnapshot: d.version,
    verificationStateSnapshot: d.verificationState,
    attachedAt: d.documentId ? nowIso() : undefined,
  }));
}

export interface BuildInvoiceOptions {
  organizationId: string;
  number: string;
  packet: InvoiceSourcePacket;
  actor: ActorRef;
  createdAt?: string;
  paymentTermsDays?: number;
  note?: string;
}

/** A draft, built entirely from the packet. Links by id, copies snapshots. */
export function buildDraftInvoice(options: BuildInvoiceOptions): Invoice {
  const { packet } = options;
  const createdAt = options.createdAt ?? nowIso();
  const billingParty = toBillingPartySnapshot(packet.billingParty);
  const terms = options.paymentTermsDays ?? billingParty.paymentTermsDays;

  const lineItems: InvoiceLineItem[] = [];
  if (packet.rateConfirmation) {
    lineItems.push({
      id: rowId("ivl"),
      kind: "linehaul",
      label: `Linehaul — ${packet.load.originCity}, ${packet.load.originState} to ${packet.load.destinationCity}, ${packet.load.destinationState}`,
      amountCents: packet.rateConfirmation.agreedLinehaulCents,
      source: {
        module: "rate_confirmation",
        referenceId: packet.rateConfirmation.rateConfirmationId,
        evidenceDocumentId: packet.rateConfirmation.documentId,
      },
    });
  }
  for (const accessorial of packet.approvedAccessorials) {
    lineItems.push(accessorialLine(accessorial));
  }

  const draft: Invoice = {
    id: invoiceUuid(),
    organizationId: options.organizationId,
    number: options.number,
    status: "draft",
    currency: "USD",
    carrier: carrierSnapshotFor(options.organizationId),
    billingParty,
    loadId: packet.load.loadId,
    load: {
      loadId: packet.load.loadId,
      reference: packet.load.reference,
      customerReference: packet.load.customerReference,
      originCity: packet.load.originCity,
      originState: packet.load.originState,
      destinationCity: packet.load.destinationCity,
      destinationState: packet.load.destinationState,
      pickedUpAt: packet.load.pickedUpAt,
      deliveredAt: packet.load.deliveredAt,
      equipment: packet.load.equipment,
      loadedMiles: packet.load.loadedMiles,
      driverNameSnapshot: packet.load.driverNameSnapshot,
    },
    rateConfirmation: packet.rateConfirmation
      ? {
          rateConfirmationId: packet.rateConfirmation.rateConfirmationId,
          documentId: packet.rateConfirmation.documentId,
          agreedLinehaulCents: packet.rateConfirmation.agreedLinehaulCents,
          preApprovedAccessorialCodes: packet.rateConfirmation.preApprovedAccessorialCodes,
          receivedAt: packet.rateConfirmation.receivedAt,
          verifiedAt: packet.rateConfirmation.verifiedAt,
        }
      : undefined,
    linehaulCents: 0,
    lineItems,
    subtotalCents: 0,
    totalCents: 0,
    amountPaidCents: 0,
    balanceCents: 0,
    paymentTermsDays: terms,
    documents: documentRefsFrom(packet),
    payments: [],
    version: 1,
    audit: [
      {
        id: rowId("iva"),
        version: 1,
        at: createdAt,
        actor: options.actor,
        action: "created",
        toStatus: "draft",
        note:
          options.note ??
          `Drafted from load ${packet.load.reference} for ${billingParty.name}.`,
      },
    ],
    createdAt,
    createdBy: options.actor,
    updatedAt: createdAt,
  };

  return withRecomputedTotals(draft);
}

/** A manually added or accessorial-backed line, from the service's input type. */
export function buildLineItem(
  input: AddLineItemInput,
  accessorial: ApprovedAccessorialInput | undefined,
  actor: ActorRef,
): InvoiceLineItem {
  if (accessorial) return accessorialLine(accessorial);
  return {
    id: rowId("ivl"),
    kind: input.kind,
    label: input.label,
    quantity: input.quantity,
    unit: input.unit,
    unitAmountCents: input.unitAmountCents,
    amountCents: input.amountCents,
    notes: input.notes,
    source: {
      module: "manual",
      evidenceDocumentId: input.evidenceDocumentId,
      // A manual line carries the biller as its approver, because somebody has
      // to answer for it when the payer asks where the number came from.
      approvedBy: actor,
      approvedAt: nowIso(),
    },
  };
}

export function paymentId(): string {
  return rowId("ivp");
}

/* -------------------------------------------------------------------------- */
/* The store                                                                   */
/* -------------------------------------------------------------------------- */

class InvoiceStore {
  private byOrg = new Map<string, Invoice[]>();

  /** Seeds this organization's fixtures the first time it is looked at. */
  all(organizationId: string): Invoice[] {
    let rows = this.byOrg.get(organizationId);
    if (!rows) {
      rows = seedInvoices(organizationId);
      this.byOrg.set(organizationId, rows);
    }
    return this.refreshDerived(rows);
  }

  /**
   * `overdue`, `partially_paid` and `paid` follow from the due date and the
   * money, so they are re-derived on every read. No audit entry is written for
   * them on purpose: a day passing is not something an actor did.
   */
  private refreshDerived(rows: Invoice[]): Invoice[] {
    for (let i = 0; i < rows.length; i++) {
      const derived = deriveStatus(rows[i]);
      if (derived !== rows[i].status) rows[i] = { ...rows[i], status: derived };
    }
    return rows;
  }

  find(organizationId: string, invoiceId: string): Invoice | undefined {
    return this.all(organizationId).find((i) => i.id === invoiceId);
  }

  add(organizationId: string, invoice: Invoice): Invoice {
    mockStore.assertOwned(organizationId, invoice.organizationId);
    this.all(organizationId).push(invoice);
    return invoice;
  }

  replace(organizationId: string, next: Invoice): Invoice {
    mockStore.assertOwned(organizationId, next.organizationId);
    const rows = this.all(organizationId);
    const index = rows.findIndex((i) => i.id === next.id);
    if (index >= 0) rows[index] = next;
    return next;
  }

  /** Numbers already used by this organization, including voided ones. */
  usedNumbers(organizationId: string): string[] {
    return this.all(organizationId).map((i) => i.number);
  }

  /** Test/debug helper. Not used by the UI. */
  reset() {
    this.byOrg.clear();
    seededNeedsYou.clear();
  }
}

export const invoiceStore = new InvoiceStore();

export function resetInvoiceRegistry() {
  invoiceStore.reset();
}

export function nextNumberFor(organizationId: string): string {
  return nextInvoiceNumber(invoiceStore.usedNumbers(organizationId));
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

function actor(name: string, membershipId: string): ActorRef {
  return { userId: "usr_sam", membershipId, displayNameSnapshot: name, source: "web" };
}

interface FixtureSpec {
  number: string;
  loadRef: string;
  /** Overrides the load's customer — an approved third-party payer. */
  billingPartyId?: string;
  createdDaysAgo: number;
  /** Absent leaves the invoice in draft. */
  issuedDaysAgo?: number;
  submitted?: { daysAgo: number; channel: "email" | "portal" | "factoring"; destination?: string };
  payments?: { daysAgo: number; fraction: number; method: "ach" | "check" | "wire" | "factoring"; reference?: string }[];
  dispute?: { daysAgo: number; reasonCode: "rate_mismatch" | "accessorial_rejected" | "missing_documents" | "duplicate_invoice"; detail: string; amountFraction?: number };
  voided?: { daysAgo: number; reason: string };
  replacesNumber?: string;
  termsDays?: number;
}

/** Applies a fixture's scripted history through the same append-only path. */
function applyFixture(
  invoice: Invoice,
  spec: FixtureSpec,
  biller: ActorRef,
  bookkeeper: ActorRef,
): Invoice {
  let current = invoice;

  if (spec.issuedDaysAgo != null) {
    const issueDate = daysFromNow(-spec.issuedDaysAgo);
    const issued = {
      ...current,
      issueDate,
      dueDate: dueDateFor(issueDate, current.paymentTermsDays),
    };
    const status = draftStatusFor(evaluateReadiness(issued));
    current = applyChange(
      current,
      { ...issued, status },
      {
        actor: biller,
        action: "status_changed",
        at: issueDate,
        fromStatus: "draft",
        toStatus: status,
        changedFields: ["issueDate", "dueDate", "status"],
        note: status === "ready"
          ? "Issued. Every readiness check passed."
          : "Issued, but a required document is still missing.",
      },
    );
  }

  if (spec.submitted) {
    const at = daysFromNow(-spec.submitted.daysAgo);
    current = applyChange(
      current,
      {
        status: "submitted",
        submission: {
          submittedAt: at,
          submittedBy: biller,
          channel: spec.submitted.channel,
          destination: spec.submitted.destination,
          deliveryConfirmed: false,
        },
      },
      {
        actor: biller,
        action: "submitted",
        at,
        fromStatus: current.status,
        toStatus: "submitted",
        note: `Sent by ${spec.submitted.channel}. Antcolos did not send it — a person did and recorded it here.`,
      },
    );
  }

  for (const payment of spec.payments ?? []) {
    const at = daysFromNow(-payment.daysAgo);
    const amountCents = Math.round(current.totalCents * payment.fraction);
    const withPayment = applyChange(
      current,
      {
        payments: [
          ...current.payments,
          {
            id: paymentId(),
            amountCents,
            currency: "USD" as const,
            method: payment.method,
            receivedAt: at,
            reference: payment.reference,
            recordedBy: bookkeeper,
            recordedAt: at,
          },
        ],
      },
      {
        actor: bookkeeper,
        action: "payment_recorded",
        at,
        amountCents,
        note: `${payment.method.toUpperCase()} received${payment.reference ? ` · ${payment.reference}` : ""}.`,
      },
    );
    const status: InvoiceStatus =
      withPayment.balanceCents <= 0 ? "paid" : "partially_paid";
    current = applyChange(withPayment, { status }, {
      actor: bookkeeper,
      action: "status_changed",
      at,
      fromStatus: withPayment.status,
      toStatus: status,
    });
  }

  if (spec.dispute) {
    const at = daysFromNow(-spec.dispute.daysAgo);
    current = applyChange(
      current,
      {
        status: "disputed",
        dispute: {
          openedAt: at,
          openedBy: biller,
          reasonCode: spec.dispute.reasonCode,
          detail: spec.dispute.detail,
          disputedAmountCents: spec.dispute.amountFraction
            ? Math.round(current.totalCents * spec.dispute.amountFraction)
            : undefined,
        },
      },
      {
        actor: biller,
        action: "dispute_opened",
        at,
        fromStatus: current.status,
        toStatus: "disputed",
        note: spec.dispute.detail,
      },
    );
  }

  if (spec.voided) {
    const at = daysFromNow(-spec.voided.daysAgo);
    current = applyChange(
      current,
      {
        status: "void",
        voidedAt: at,
        voidedBy: biller,
        voidReason: spec.voided.reason,
      },
      {
        actor: biller,
        action: "voided",
        at,
        fromStatus: current.status,
        toStatus: "void",
        note: spec.voided.reason,
      },
    );
  }

  return current;
}

const FIXTURES: Record<string, FixtureSpec[]> = {
  org_northline: [
    {
      number: "INV-2026-0101", loadRef: "NL-24701",
      createdDaysAgo: 62, issuedDaysAgo: 62,
      submitted: { daysAgo: 62, channel: "email", destination: "ap@apexlog.example" },
      payments: [{ daysAgo: 38, fraction: 1, method: "ach", reference: "ACH 8841206" }],
    },
    {
      number: "INV-2026-0104", loadRef: "NL-24728",
      createdDaysAgo: 41, issuedDaysAgo: 41,
      submitted: { daysAgo: 41, channel: "email", destination: "billing@tandemfp.example" },
    },
    {
      number: "INV-2026-0107", loadRef: "NL-24744",
      createdDaysAgo: 28, issuedDaysAgo: 28,
      submitted: { daysAgo: 27, channel: "email", destination: "ap@rivetsupply.example" },
      payments: [{ daysAgo: 6, fraction: 0.6, method: "check", reference: "Check 20418" }],
    },
    {
      number: "INV-2026-0109", loadRef: "NL-24762",
      createdDaysAgo: 19, issuedDaysAgo: 19,
      submitted: { daysAgo: 19, channel: "portal", destination: "Apex Carrier Portal" },
      dispute: {
        daysAgo: 9, reasonCode: "accessorial_rejected", amountFraction: 0.074,
        detail: "Apex rejects the $125.00 lumper: their receiver says the fee was prepaid at the dock. The lumper receipt is attached and shows the driver paid it.",
      },
    },
    {
      number: "INV-2026-0112", loadRef: "NL-24775",
      createdDaysAgo: 12, issuedDaysAgo: 12,
      submitted: { daysAgo: 12, channel: "email", destination: "ap@glenmark.example" },
    },
    {
      number: "INV-2026-0113", loadRef: "NL-24788",
      createdDaysAgo: 8, issuedDaysAgo: 8,
      submitted: { daysAgo: 8, channel: "email", destination: "billing@tandemfp.example" },
      voided: {
        daysAgo: 7,
        reason: "Billed the broker direct. This load was factored, so the invoice has to go to Ridgeline. Reissued as INV-2026-0114.",
      },
    },
    {
      number: "INV-2026-0114", loadRef: "NL-24788",
      billingPartyId: "pay_ridgeline_factoring",
      createdDaysAgo: 7, issuedDaysAgo: 7,
      replacesNumber: "INV-2026-0113",
      submitted: { daysAgo: 7, channel: "factoring", destination: "Ridgeline Client Portal" },
      payments: [{ daysAgo: 5, fraction: 1, method: "factoring", reference: "Advance 4471-B" }],
    },
    {
      number: "INV-2026-0115", loadRef: "NL-24812",
      createdDaysAgo: 1, issuedDaysAgo: 1,
    },
    {
      number: "INV-2026-0116", loadRef: "NL-24805",
      createdDaysAgo: 0,
    },
    {
      number: "INV-2026-0117", loadRef: "NL-24799",
      createdDaysAgo: 0, issuedDaysAgo: 0,
    },
  ],
  org_meridian: [
    {
      number: "INV-2026-0041", loadRef: "MD-8974",
      createdDaysAgo: 22, issuedDaysAgo: 22,
      submitted: { daysAgo: 22, channel: "email", destination: "ap@keystonebrokerage.example" },
    },
    {
      number: "INV-2026-0044", loadRef: "MD-8990",
      createdDaysAgo: 11, issuedDaysAgo: 11,
      submitted: { daysAgo: 11, channel: "email", destination: "ap@harborpoint.example" },
      payments: [{ daysAgo: 2, fraction: 0.5, method: "ach", reference: "ACH 5520114" }],
    },
  ],
  org_cascade: [
    {
      number: "INV-2026-0007", loadRef: "CS-3309",
      createdDaysAgo: 2, issuedDaysAgo: 2,
    },
  ],
};

function seedInvoices(organizationId: string): Invoice[] {
  const specs = FIXTURES[organizationId];
  if (!specs) return [];

  let loads: Load[];
  try {
    loads = mockStore.org(organizationId).loads;
  } catch {
    // An organization with no seeded operational data has no invoices either.
    return [];
  }

  const biller = actor("Sam Murtaza", `mem_${organizationId}_owner`);
  const bookkeeper = actor("Renata Cruz", `mem_${organizationId}_books`);

  const built: Invoice[] = [];
  for (const spec of specs) {
    const load = loads.find((l) => l.reference === spec.loadRef);
    if (!load) continue;
    const packet = sourcePacketFor(organizationId, load.id, spec.billingPartyId);
    if (!packet) continue;

    let invoice = buildDraftInvoice({
      organizationId,
      number: spec.number,
      packet,
      actor: biller,
      createdAt: daysFromNow(-spec.createdDaysAgo),
      paymentTermsDays: spec.termsDays,
    });

    if (spec.replacesNumber) {
      const replaced = built.find((i) => i.number === spec.replacesNumber);
      if (replaced) invoice = { ...invoice, replacesInvoiceId: replaced.id };
    }

    built.push(applyFixture(invoice, spec, biller, bookkeeper));
  }
  return built;
}

/* -------------------------------------------------------------------------- */
/* Needs You                                                                   */
/* -------------------------------------------------------------------------- */

const seededNeedsYou = new Set<string>();

function needsYouItem(
  organizationId: string,
  item: Omit<NeedsYouItem, "id" | "organizationId" | "history">,
): NeedsYouItem {
  return {
    id: rowId("ny_inv"),
    organizationId,
    ...item,
    history: [
      {
        id: rowId("nyh"),
        at: item.createdAt,
        actor: {
          userId: "system",
          membershipId: "system",
          displayNameSnapshot: "Antcolos",
          source: "system",
        },
        action: "created",
        note: item.reason,
      },
    ],
  };
}

/**
 * The invoice module's Needs You items: missing documents, disputes and
 * overdue receivables. They are derived from the invoices themselves rather
 * than written by hand, so an item cannot survive the thing that caused it.
 *
 * They are pushed into the ORGANIZATION'S OWN Needs You list once, so they
 * behave like every other item — snoozeable, assignable, resolvable — instead
 * of being a second parallel queue that only the invoice screen knows about.
 */
export function ensureInvoiceNeedsYou(organizationId: string): void {
  if (seededNeedsYou.has(organizationId)) return;
  seededNeedsYou.add(organizationId);

  let queue: NeedsYouItem[];
  try {
    queue = mockStore.org(organizationId).needsYou;
  } catch {
    return;
  }

  const items: NeedsYouItem[] = [];
  const money = (cents: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

  for (const invoice of invoiceStore.all(organizationId)) {
    const href = `/finance/invoices/${invoice.id}`;
    const label = `${invoice.number} · ${invoice.billingParty.name}`;

    const missing = missingInvoiceDocuments(invoice);
    if (invoice.status === "needs_documents" && missing.length > 0) {
      items.push(needsYouItem(organizationId, {
        category: "missing_document",
        severity: "high",
        status: "open",
        title: `${invoice.number} cannot be sent — ${missing.length} document${missing.length > 1 ? "s" : ""} missing`,
        reason: `${invoice.load.reference} is invoiced for ${money(invoice.totalCents)} but ${missing
          .map((d) => d.kind.replace(/_/g, " "))
          .join(" and ")} has not been attached.`,
        detail: "The invoice is held at Needs Documents until the paperwork arrives. Nothing goes to the payer in the meantime.",
        entity: { kind: "invoice", id: invoice.id, label, href },
        relatedEntities: [
          { kind: "load", id: invoice.loadId, label: invoice.load.reference, href: `/loads/${invoice.loadId}` },
        ],
        recommendedAction: {
          kind: "request_document",
          label: "Chase the missing paperwork",
          requires: ["documents:view"],
        },
        dueAt: daysFromNow(1),
        source: "system",
        requires: ["invoices:view"],
        createdAt: invoice.updatedAt,
      }));
    }

    if (invoice.dispute && !invoice.dispute.resolvedAt) {
      items.push(needsYouItem(organizationId, {
        category: "invoice_dispute",
        severity: "critical",
        status: "open",
        title: `${invoice.billingParty.name} is disputing ${invoice.number}`,
        reason: invoice.dispute.detail,
        detail: invoice.dispute.disputedAmountCents
          ? `${money(invoice.dispute.disputedAmountCents)} of ${money(invoice.totalCents)} is contested. The rest is not in dispute and can still be chased.`
          : "The whole invoice is contested.",
        entity: { kind: "invoice", id: invoice.id, label, href },
        recommendedAction: {
          kind: "contact_customer",
          label: "Answer the dispute",
          requires: ["invoices:view"],
        },
        dueAt: daysFromNow(2),
        source: "system",
        requires: ["invoices:view"],
        createdAt: invoice.dispute.openedAt,
      }));
    }

    if (invoice.status === "overdue") {
      const days = invoice.dueDate
        ? Math.floor((Date.now() - new Date(invoice.dueDate).getTime()) / 86_400_000)
        : 0;
      items.push(needsYouItem(organizationId, {
        category: "invoice_overdue",
        severity: days > 14 ? "critical" : "high",
        status: "open",
        title: `${invoice.number} is ${days} day${days === 1 ? "" : "s"} past due`,
        reason: `${money(invoice.balanceCents)} outstanding from ${invoice.billingParty.name} on net ${invoice.paymentTermsDays} terms.`,
        detail: invoice.submission
          ? `Sent by ${invoice.submission.channel} on ${invoice.submission.submittedAt.slice(0, 10)}. Delivery was never confirmed — Antcolos does not send invoices yet.`
          : "No submission has been recorded against this invoice at all.",
        entity: { kind: "invoice", id: invoice.id, label, href },
        recommendedAction: {
          kind: "contact_customer",
          label: "Chase the payment",
          requires: ["invoices:view"],
        },
        dueAt: daysFromNow(0),
        source: "system",
        requires: ["invoices:view"],
        createdAt: invoice.dueDate ?? invoice.updatedAt,
      }));
    }
  }

  queue.push(...items);
}
