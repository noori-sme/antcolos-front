"use client";

import { Wallet } from "lucide-react";
import { useState } from "react";
import { LedgerEntryStatusBadge } from "@/components/common/status-badge";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { formatMoney, KIND_LABEL } from "@/lib/receipts/receipt-rules";
import { cn } from "@/lib/utils";
import type { LedgerEntry } from "@/types/expense";
import { day } from "./expense-row";
import { useDismissLedgerEntry, useExpenseIntentKeys, useMyLedger } from "./hooks";
import { ReasonDialog } from "./reason-dialog";

const PAGE_SIZE = 25;

/**
 * An owner-operator's own ledger (F2.2): costs of the trucks they own, from
 * every carrier they drive for. Nobody else sees it, including the carriers.
 */
export function MyLedgerScreen() {
  const [page, setPage] = useState(1);
  const [dismissing, setDismissing] = useState<LedgerEntry | null>(null);
  const query = useMyLedger({ page, pageSize: PAGE_SIZE });
  const dismiss = useDismissLedgerEntry();
  const keys = useExpenseIntentKeys();
  const entries = query.data?.data ?? [];
  const meta = query.data?.meta;

  return (
    <div className="space-y-section">
      <PageHeader
        title="My truck ledger"
        description="Fuel, repairs and tolls on the trucks you own, from every carrier you drive for. Only you can see this."
      />
      {query.isPending ? <LoadingSkeleton rows={4} /> : null}
      {query.isError ? <ErrorState description={query.error.message} onRetry={() => void query.refetch()} /> : null}
      {query.isSuccess && entries.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="Nothing in your ledger yet"
          description="If you own the truck you drive, its receipts land here once they're confirmed."
        />
      ) : null}
      {entries.length > 0 ? (
        <ul className={cn("space-y-2", query.isPlaceholderData && "opacity-60")}>
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3.5 shadow-e1"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.875rem] font-medium text-fg">
                  {KIND_LABEL[entry.kind]} · {day(entry.incurredAt)}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <LedgerEntryStatusBadge status={entry.status} />
                  <span className="truncate text-[0.8125rem] text-fg-muted">via {entry.source.name || "a carrier"}</span>
                </div>
              </div>
              <span className="shrink-0 text-[0.875rem] font-medium tabular-nums text-fg">
                {formatMoney(entry.amount, entry.currency)}
              </span>
              {entry.status === "POSTED" ? (
                <Button size="sm" variant="ghost" onClick={() => setDismissing(entry)}>
                  Not mine
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {meta && meta.totalPages > 1 ? (
        <nav aria-label="Pages" className="flex items-center justify-between gap-3 text-[0.8125rem] text-fg-muted">
          <span>Page {meta.page} of {meta.totalPages}</span>
          <div className="flex gap-2">
            <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Newer</Button>
            <Button size="sm" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>Older</Button>
          </div>
        </nav>
      ) : null}

      <ReasonDialog
        open={dismissing !== null}
        onOpenChange={(open) => (open ? undefined : setDismissing(null))}
        title="This isn't my expense"
        description="It stays on record, marked dismissed, and no longer counts in your ledger."
        confirmLabel="Dismiss"
        pending={dismiss.isPending}
        error={dismiss.error}
        onConfirm={(reason) => {
          if (!dismissing) return;
          dismiss.mutate(
            { id: dismissing.id, reason, idempotencyKey: keys.keyFor(`dismiss:${dismissing.id}:${reason}`) },
            {
              onSuccess: () => {
                keys.clear();
                setDismissing(null);
              },
            },
          );
        }}
      />
    </div>
  );
}
