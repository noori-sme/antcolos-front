import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { money, relativeTime } from "@/lib/utils";
import {
  invoiceDaysPastDue, missingInvoiceDocuments, type Invoice,
} from "@/types";
import { InvoiceStatusBadge } from "./status-chips";

/** The phone reading of an invoice: who owes what, and whether it is late. */
export function InvoiceCards({ invoices }: { invoices: Invoice[] }) {
  return (
    <ul className="space-y-2.5">
      {invoices.map((invoice) => {
        const missing = missingInvoiceDocuments(invoice);
        const pastDue = invoice.status === "overdue" ? invoiceDaysPastDue(invoice) : null;
        return (
          <li key={invoice.id}>
            <Link
              href={`/finance/invoices/${invoice.id}`}
              className="block rounded-lg border border-border bg-surface p-4 shadow-e1 transition-colors hover:bg-surface-hover"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-[0.875rem] font-semibold text-fg">
                    {invoice.number}
                  </p>
                  <p className="truncate text-[0.8125rem] text-fg-muted">
                    {invoice.billingParty.name}
                  </p>
                </div>
                <InvoiceStatusBadge status={invoice.status} withTitle={false} />
              </div>

              <p className="mt-2 text-[0.8125rem] text-fg-muted">
                {invoice.load.originCity}, {invoice.load.originState}
                <span className="mx-1 text-fg-subtle">→</span>
                {invoice.load.destinationCity}, {invoice.load.destinationState}
                <span className="mx-1 text-fg-subtle">·</span>
                <span className="font-mono">{invoice.load.reference}</span>
              </p>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-1.5">
                  {missing.length > 0 ? (
                    <Badge tone="warning">{missing.length} document missing</Badge>
                  ) : null}
                  {pastDue != null && pastDue > 0 ? (
                    <Badge tone="danger">{pastDue}d past due</Badge>
                  ) : invoice.dueDate && invoice.balanceCents > 0 ? (
                    <Badge tone="outline">Due {relativeTime(invoice.dueDate)}</Badge>
                  ) : null}
                </span>
                <span className="text-right">
                  <span className="tnum block text-[0.9375rem] font-semibold text-fg">
                    {money(invoice.totalCents)}
                  </span>
                  {invoice.balanceCents !== invoice.totalCents ? (
                    <span className="tnum block text-[0.75rem] text-fg-subtle">
                      {money(invoice.balanceCents)} outstanding
                    </span>
                  ) : null}
                </span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
