import {
  isInvoiceOverdue, type Invoice, type InvoiceReadiness, type InvoiceStatus,
} from "@/types";

/**
 * The invoice status machine.
 *
 * Three of the nine statuses are DERIVED and are never chosen by a person:
 *  - `needs_documents` / `ready` follow the readiness checks,
 *  - `overdue` follows the due date and the balance.
 * The rest are recorded actions: a person submits, records a payment, opens a
 * dispute, or voids. Deriving what can be derived is what keeps a list of
 * invoices honest without anybody having to maintain it.
 */

/** What a person may move an invoice to directly. Derived edges are not here. */
const ALLOWED: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ["needs_documents", "ready", "void"],
  needs_documents: ["ready", "draft", "void"],
  ready: ["submitted", "needs_documents", "draft", "void"],
  submitted: ["disputed", "partially_paid", "paid", "overdue", "void"],
  disputed: ["submitted", "partially_paid", "paid", "overdue", "void"],
  partially_paid: ["paid", "disputed", "overdue", "void"],
  overdue: ["partially_paid", "paid", "disputed", "void"],
  paid: [],
  void: [],
};

export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return ALLOWED[from].includes(to);
}

export class InvoiceTransitionError extends Error {
  constructor(readonly from: InvoiceStatus, readonly to: InvoiceStatus) {
    super(`An invoice cannot move from ${from} to ${to}.`);
    this.name = "InvoiceTransitionError";
  }
}

export function assertTransition(from: InvoiceStatus, to: InvoiceStatus): void {
  if (!canTransition(from, to)) throw new InvoiceTransitionError(from, to);
}

/** Before issue, the status is whatever the readiness checks say it is. */
export function draftStatusFor(readiness: InvoiceReadiness): InvoiceStatus {
  return readiness.ready ? "ready" : "needs_documents";
}

/**
 * Re-derives the status of an already-issued invoice from its own money and
 * dates. Recorded states that a person owns — `disputed`, `void` — are left
 * alone except when payment settles the balance.
 */
export function deriveStatus(invoice: Invoice, now = Date.now()): InvoiceStatus {
  if (invoice.status === "void") return "void";

  // Full payment settles everything, including a dispute.
  if (invoice.payments.length > 0 && invoice.balanceCents <= 0) return "paid";

  // An open dispute outranks the payment and date derivations: it is the thing
  // a biller has to act on, and a partially paid dispute is still a dispute.
  if (invoice.dispute && !invoice.dispute.resolvedAt) return "disputed";

  if (invoice.status === "draft" || invoice.status === "needs_documents") {
    return invoice.status;
  }
  if (invoice.status === "ready") return "ready";

  if (isInvoiceOverdue({ ...invoice, status: "submitted" }, now)) return "overdue";
  if (invoice.payments.length > 0 && invoice.balanceCents > 0) return "partially_paid";

  return invoice.status === "overdue" || invoice.status === "partially_paid"
    ? "submitted"
    : invoice.status;
}

/** The due date an invoice gets when it is issued. Terms come from the payer. */
export function dueDateFor(issueDate: string, paymentTermsDays: number): string {
  const due = new Date(issueDate);
  due.setUTCDate(due.getUTCDate() + paymentTermsDays);
  return due.toISOString();
}
