import {
  invoiceAmountPaidCents, invoiceSubtotalCents,
  type Invoice, type InvoiceLineItem, type InvoicePayment,
} from "@/types";

/**
 * One place computes invoice money. Screens render what this returns; they
 * never add cents themselves, so a total can never differ between the list,
 * the detail screen and the record that gets sent.
 */
export interface InvoiceTotals {
  subtotalCents: number;
  totalCents: number;
  amountPaidCents: number;
  balanceCents: number;
}

export function computeTotals(
  lineItems: readonly InvoiceLineItem[],
  payments: readonly InvoicePayment[],
): InvoiceTotals {
  const subtotalCents = invoiceSubtotalCents(lineItems);
  // Taxes and fees do not exist in freight invoicing here, so the total is the
  // subtotal. The field stays separate so adding one later is not a migration.
  const totalCents = subtotalCents;
  const amountPaidCents = invoiceAmountPaidCents(payments);
  return {
    subtotalCents,
    totalCents,
    amountPaidCents,
    balanceCents: totalCents - amountPaidCents,
  };
}

/** Rewrites the derived money on an invoice. The line items stay as given. */
export function withRecomputedTotals(invoice: Invoice): Invoice {
  const totals = computeTotals(invoice.lineItems, invoice.payments);
  const linehaul = invoice.lineItems.find((l) => l.kind === "linehaul");
  return {
    ...invoice,
    linehaulCents: linehaul?.amountCents ?? 0,
    ...totals,
  };
}

/** Detention at $65.00/hr for 2.5 hours. Rounded to whole cents, never floats. */
export function meteredAmountCents(quantity: number, unitAmountCents: number): number {
  return Math.round(quantity * unitAmountCents);
}
