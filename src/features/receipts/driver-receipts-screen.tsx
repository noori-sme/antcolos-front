"use client";

import { ReceiptText } from "lucide-react";
import { useState } from "react";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { useCanAny } from "@/lib/session/hooks";
import { useReceipts } from "./hooks";
import { ReceiptDetailSheet } from "./receipt-detail-sheet";
import { ReceiptRow } from "./receipt-row";
import { UploadReceiptCard } from "./upload-receipt-card";

const PAGE_SIZE = 25;

/** The driver's receipts (F2.1): send one in, see what was read, confirm it. */
export function DriverReceiptsScreen() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const canSee = useCanAny(["receipts:own:view", "receipts:view"]);
  const query = useReceipts({ page, pageSize: PAGE_SIZE });
  // How many wait for a check across every page, not only this one.
  const waiting = useReceipts({ status: "PENDING_REVIEW", page: 1, pageSize: 1 }).data?.meta.totalItems ?? 0;
  const receipts = query.data?.data ?? [];
  const meta = query.data?.meta;

  return (
    <div className="space-y-section">
      <PageHeader title="My receipts" description="Fuel, repair and toll receipts you paid on the road." />
      <UploadReceiptCard onUploaded={(id) => (canSee ? setOpenId(id) : undefined)} />

      <section aria-labelledby="my-receipts-list" className="space-y-3">
        <h2 id="my-receipts-list" className="text-[0.9375rem] font-semibold text-fg">
          Sent {waiting > 0 ? <span className="font-normal text-fg-muted">· {waiting} need a check</span> : null}
        </h2>
        {!canSee ? (
          <EmptyState
            icon={ReceiptText}
            title="Receipts you send go to the office"
            description="Your role can send receipts but not list them. Ask your dispatcher about one you sent."
          />
        ) : null}
        {canSee && query.isPending ? <LoadingSkeleton rows={3} /> : null}
        {query.isError ? (
          <ErrorState description={query.error.message} onRetry={() => void query.refetch()} />
        ) : null}
        {query.isSuccess && receipts.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title="No receipts yet"
            description="Send your first receipt above. It goes to the truck you drive now."
          />
        ) : null}
        {receipts.length > 0 ? (
          <ul className="space-y-2">
            {receipts.map((r) => <ReceiptRow key={r.id} receipt={r} onOpen={setOpenId} />)}
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
      </section>

      <ReceiptDetailSheet receiptId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
