"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import { useState } from "react";
import { ReceiptStatusBadge } from "@/components/common/status-badge";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { Button } from "@/components/ui/button";
import { Sheet, SheetCloseButton, SheetContent } from "@/components/ui/sheet";
import {
  canConfirm, canReject, FAILURE_TEXT, formatMoney, KIND_LABEL, trimDecimal,
} from "@/lib/receipts/receipt-rules";
import type { ReceiptDetail } from "@/types/receipt";
import { ConfirmReceiptForm } from "./confirm-receipt-form";
import { useReceipt, useReceiptViewer } from "./hooks";
import { RejectReceiptDialog } from "./reject-receipt-dialog";

const SECTION = "text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase";

/** One receipt: what was read, why it waits for a person, and the decision. */
export function ReceiptDetailSheet({ receiptId, onClose }: { receiptId: string | null; onClose: () => void }) {
  const query = useReceipt(receiptId);
  const receipt = query.data;
  return (
    <Sheet open={Boolean(receiptId)} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent title="Receipt" description="What was read off the receipt and what happens next.">
        <header className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[1rem] font-semibold text-fg">
              {receipt ? `${KIND_LABEL[receipt.kind]} receipt` : "Receipt"}
            </h2>
            {receipt ? (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <ReceiptStatusBadge status={receipt.status} />
                <span className="text-[0.8125rem] text-fg-muted">
                  {formatMoney(receipt.totalAmount, receipt.currency)}
                </span>
              </div>
            ) : null}
          </div>
          <SheetCloseButton />
        </header>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {query.isPending ? <LoadingSkeleton rows={3} /> : null}
          {query.isError ? (
            <ErrorState description={query.error.message} onRetry={() => void query.refetch()} />
          ) : null}
          {receipt ? <Body receipt={receipt} onDecided={onClose} /> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Body({ receipt, onDecided }: { receipt: ReceiptDetail; onDecided: () => void }) {
  const viewer = useReceiptViewer();
  const [rejecting, setRejecting] = useState(false);

  if (receipt.status === "EXTRACTING") {
    return (
      <p className="flex items-center gap-2 text-[0.875rem] text-fg-muted" role="status">
        <Loader2 aria-hidden className="size-4 animate-spin" />
        Reading the receipt. This usually takes under a minute.
      </p>
    );
  }

  return (
    <>
      {receipt.status === "PENDING_REVIEW" && receipt.failures.length > 0 ? (
        <section className="rounded-lg border border-border bg-st-warning-bg px-4 py-3">
          <h3 className={SECTION}>Check before confirming</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[0.875rem] text-fg">
            {receipt.failures.map((f) => <li key={f}>{FAILURE_TEXT[f]}</li>)}
          </ul>
        </section>
      ) : null}

      {receipt.status === "REJECTED" ? (
        <section>
          <h3 className={SECTION}>Rejected</h3>
          <p className="mt-1 text-[0.875rem] text-fg">{receipt.rejectReason ?? "No reason given."}</p>
        </section>
      ) : null}

      {receipt.arithmeticWarning ? (
        <p className="flex items-start gap-2 text-[0.8125rem] text-fg-muted">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-st-warning" />
          The confirmed amounts don&apos;t add up to the total. A person accepted them as they are.
        </p>
      ) : null}

      {canConfirm(receipt, viewer) ? (
        <section>
          <h3 className={SECTION}>Confirm</h3>
          <div className="mt-3">
            <ConfirmReceiptForm receipt={receipt} onDone={onDecided} />
          </div>
        </section>
      ) : (
        <Summary receipt={receipt} />
      )}

      {receipt.fields.length > 0 ? (
        <section>
          <h3 className={SECTION}>What was read</h3>
          <dl className="mt-2 divide-y divide-border rounded-lg border border-border">
            {receipt.fields.map((f) => (
              <div key={f.path} className="flex items-center justify-between gap-3 px-3 py-2 text-[0.8125rem]">
                <dt className="truncate text-fg-muted">{f.path}</dt>
                <dd className="flex shrink-0 items-center gap-2 text-fg">
                  <span>{f.value === null ? "—" : String(f.value)}</span>
                  {f.confidence !== null ? (
                    <span className="tabular-nums text-fg-subtle">{Math.round(f.confidence * 100)}%</span>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {canReject(receipt, viewer) ? (
        <div className="flex justify-end border-t border-border pt-4">
          <Button variant="ghost" onClick={() => setRejecting(true)}>Reject receipt</Button>
          <RejectReceiptDialog
            receiptId={receipt.id}
            open={rejecting}
            onOpenChange={setRejecting}
            onRejected={onDecided}
          />
        </div>
      ) : null}
    </>
  );
}

function Summary({ receipt }: { receipt: ReceiptDetail }) {
  const rows: [string, string][] = [
    ["Date", receipt.purchasedAt ? new Date(receipt.purchasedAt).toLocaleDateString() : "—"],
    ["Total", formatMoney(receipt.totalAmount, receipt.currency)],
    ...(receipt.kind === "FUEL"
      ? ([["Gallons", trimDecimal(receipt.gallons)], ["Price per gallon", receipt.unitPrice ? `$${trimDecimal(receipt.unitPrice)}` : "—"]] as [string, string][])
      : []),
    ...(receipt.kind === "REPAIR"
      ? ([["Parts", formatMoney(receipt.partsAmount)], ["Labor", formatMoney(receipt.laborAmount)]] as [string, string][])
      : []),
    ["Vendor", receipt.vendor ?? "—"],
    ["Place", [receipt.city, receipt.state].filter(Boolean).join(", ") || "—"],
    ["Confirmed by", receipt.status === "CONFIRMED" ? (receipt.confirmedByUserId ? "A person" : "Antcolos (read and checked)") : "—"],
  ];
  return (
    <section>
      <dl className="divide-y divide-border rounded-lg border border-border">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 px-3 py-2 text-[0.875rem]">
            <dt className="text-fg-muted">{label}</dt>
            <dd className="text-right text-fg">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
