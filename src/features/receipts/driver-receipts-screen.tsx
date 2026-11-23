"use client";

import { ReceiptText } from "lucide-react";
import { useState } from "react";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { useReceipts } from "./hooks";
import { ReceiptDetailSheet } from "./receipt-detail-sheet";
import { ReceiptRow } from "./receipt-row";
import { UploadReceiptCard } from "./upload-receipt-card";

const FILTERS = { page: 1, pageSize: 50 };

/** The driver's receipts (F2.1): send one in, see what was read, confirm it. */
export function DriverReceiptsScreen() {
  const [openId, setOpenId] = useState<string | null>(null);
  const query = useReceipts(FILTERS);
  const receipts = query.data?.data ?? [];
  const waiting = receipts.filter((r) => r.status === "PENDING_REVIEW").length;

  return (
    <div className="space-y-section">
      <PageHeader
        title="My receipts"
        description="Fuel, repair and toll receipts you paid on the road."
      />
      <UploadReceiptCard onUploaded={setOpenId} />

      <section aria-labelledby="my-receipts-list" className="space-y-3">
        <h2 id="my-receipts-list" className="text-[0.9375rem] font-semibold text-fg">
          Sent {waiting > 0 ? <span className="font-normal text-fg-muted">· {waiting} need a check</span> : null}
        </h2>
        {query.isPending ? <LoadingSkeleton rows={3} /> : null}
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
      </section>

      <ReceiptDetailSheet receiptId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
