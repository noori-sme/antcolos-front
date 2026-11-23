"use client";

import { AlertTriangle, ChevronRight } from "lucide-react";
import { ReceiptStatusBadge } from "@/components/common/status-badge";
import { formatMoney, KIND_LABEL } from "@/lib/receipts/receipt-rules";
import type { Receipt } from "@/types/receipt";

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;

/** One receipt in a list; opens its detail. The badge sits under the title so it fits at 360 px. */
export function ReceiptRow({ receipt, onOpen }: { receipt: Receipt; onOpen: (id: string) => void }) {
  const when = day(receipt.purchasedAt) ?? `Sent ${day(receipt.createdAt) ?? ""}`;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(receipt.id)}
        className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3.5 text-left shadow-e1 transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.875rem] font-medium text-fg">
            {KIND_LABEL[receipt.kind]} · {receipt.vendor ?? "Vendor not read"}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <ReceiptStatusBadge status={receipt.status} />
            <span className="text-[0.8125rem] text-fg-muted">{when}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {receipt.arithmeticWarning ? (
            <AlertTriangle role="img" aria-label="Amounts don't add up" className="size-4 text-st-warning" />
          ) : null}
          <span className="text-[0.875rem] font-medium tabular-nums text-fg">
            {formatMoney(receipt.totalAmount, receipt.currency)}
          </span>
          <ChevronRight aria-hidden className="size-4 text-fg-subtle" />
        </div>
      </button>
    </li>
  );
}
