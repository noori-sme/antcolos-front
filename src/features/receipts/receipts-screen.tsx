"use client";

import { ReceiptText } from "lucide-react";
import { useState } from "react";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { RECEIPT_STATUS } from "@/config/statuses";
import { KIND_LABEL } from "@/lib/receipts/receipt-rules";
import { useCan } from "@/lib/session/hooks";
import { cn } from "@/lib/utils";
import { RECEIPT_KINDS, type ReceiptFilters, type ReceiptKind, type ReceiptStatus } from "@/types/receipt";
import { useReceipts } from "./hooks";
import { ReceiptDetailSheet } from "./receipt-detail-sheet";
import { ReceiptRow } from "./receipt-row";

const PAGE_SIZE = 25;
const STATUS_TABS: { value: ReceiptStatus | undefined; label: string }[] = [
  { value: "PENDING_REVIEW", label: RECEIPT_STATUS.PENDING_REVIEW.label },
  { value: "CONFIRMED", label: RECEIPT_STATUS.CONFIRMED.label },
  { value: "REJECTED", label: RECEIPT_STATUS.REJECTED.label },
  { value: undefined, label: "All" },
];

const SELECT =
  "h-control rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg shadow-e1 " +
  "hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35";

/**
 * The fleet's receipts (F2.1). Reviewers start on what waits for them; a
 * dispatcher without review starts on everything.
 */
export function ReceiptsScreen() {
  const canReview = useCan("receipts:review");
  const [status, setStatus] = useState<ReceiptStatus | undefined>(canReview ? "PENDING_REVIEW" : undefined);
  const [kind, setKind] = useState<ReceiptKind | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const filters: ReceiptFilters = { status, kind, page, pageSize: PAGE_SIZE };
  const query = useReceipts(filters);
  const receipts = query.data?.data ?? [];
  const meta = query.data?.meta;

  const choose = (next: () => void) => {
    next();
    setPage(1);
  };

  return (
    <div className="space-y-section">
      <PageHeader
        title="Receipts"
        description={
          canReview
            ? "Fuel, repair and toll receipts from the road. Confirm what was read, or reject what isn't a fleet expense."
            : "Fuel, repair and toll receipts from the road."
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Status" className="flex flex-wrap gap-1">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.label}
              type="button"
              aria-pressed={status === tab.value}
              onClick={() => choose(() => setStatus(tab.value))}
              className={cn(
                "h-control-sm rounded-md px-3 text-[0.8125rem] transition-colors",
                status === tab.value ? "bg-surface-sunken font-medium text-fg" : "text-fg-muted hover:bg-surface-hover",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <label className="sr-only" htmlFor="receipt-kind">Kind</label>
        <select
          id="receipt-kind"
          className={SELECT}
          value={kind ?? ""}
          onChange={(e) => choose(() => setKind(RECEIPT_KINDS.find((k) => k === e.target.value)))}
        >
          <option value="">All kinds</option>
          {RECEIPT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </div>

      {query.isPending ? <LoadingSkeleton rows={5} /> : null}
      {query.isError ? (
        <ErrorState description={query.error.message} onRetry={() => void query.refetch()} />
      ) : null}
      {query.isSuccess && receipts.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title={status === "PENDING_REVIEW" ? "Nothing waiting for review" : "No receipts here"}
          description={
            status === "PENDING_REVIEW"
              ? "Receipts the system couldn't confirm on its own will show up here."
              : "Receipts drivers send from the road show up here."
          }
        />
      ) : null}
      {receipts.length > 0 ? (
        <ul className={cn("space-y-2", query.isPlaceholderData && "opacity-60")}>
          {receipts.map((r) => <ReceiptRow key={r.id} receipt={r} onOpen={setOpenId} />)}
        </ul>
      ) : null}

      {meta && meta.totalPages > 1 ? (
        <nav aria-label="Pages" className="flex items-center justify-between gap-3 text-[0.8125rem] text-fg-muted">
          <span>Page {meta.page} of {meta.totalPages} · {meta.totalItems} receipts</span>
          <div className="flex gap-2">
            <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button size="sm" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </nav>
      ) : null}

      <ReceiptDetailSheet receiptId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
