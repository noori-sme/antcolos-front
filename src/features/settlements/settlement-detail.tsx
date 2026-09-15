"use client";

import {
  ArrowLeft, Ban, CheckCircle2, FileText, Link2, MessageSquareWarning,
  Pencil, RefreshCw, Send, Wallet,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { canBeOverdue } from "@/lib/settlements/status";
import { money } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import type { Settlement, SettlementDispute } from "@/types";
import {
  AdjustmentDialog, ApproveDialog, DisputeDialog, RecordPaymentDialog,
  ResolveDisputeDialog, VoidDialog,
} from "./action-dialogs";
import { CalculationBreakdown } from "./calculation-breakdown";
import {
  BlockedChip, DisputeChip, OverdueChip, PayeeKindChip, SettlementKindChip,
  SettlementStatusChip,
} from "./settlement-chips";
import {
  ADJUSTMENT_KIND_LABEL, AUDIT_ACTION_LABEL, DISPUTE_REASON_LABEL,
  DISPUTE_RESOLUTION_LABEL, PAYMENT_METHOD_LABEL, daysPast, dueLabel,
  formatDate, formatDateTime,
} from "./settlement-labels";
import { useSettlement, useSettlementAction, useSettlementAudit } from "./hooks";

/**
 * One settlement, in full.
 *
 * Every button below is rendered from the capabilities the SERVICE computed,
 * not from a permission check made here. That way a screen cannot offer an
 * action the service would refuse, and the two cannot drift apart as the rules
 * grow.
 */
export function SettlementDetailScreen({ settlementId }: { settlementId: string }) {
  const query = useSettlement(settlementId);
  const audit = useSettlementAudit(settlementId);
  const action = useSettlementAction();

  const [approveOpen, setApproveOpen] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [resolveDisputeId, setResolveDisputeId] = useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);

  if (query.isPending) return <LoadingSkeleton rows={6} />;
  if (query.isError) {
    return (
      <ErrorState
        title="Could not open this settlement"
        description={query.error.message}
        onRetry={() => query.refetch()}
      />
    );
  }

  const { settlement, capabilities, privacy, resolvableLoadIds } = query.data;
  const openDispute = settlement.disputes.find(
    (d) => d.status === "open" || d.status === "under_review",
  );
  const overdueDays =
    settlement.paymentDueAt &&
    settlement.amountOutstandingCents > 0 &&
    canBeOverdue(settlement.status)
      ? daysPast(settlement.paymentDueAt)
      : 0;

  const run = (next: Parameters<typeof action.mutate>[0]["action"]) =>
    action.mutate({ id: settlement.id, action: next });

  return (
    <div className="space-y-section">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2">
          <Link href="/finance/settlements">
            <ArrowLeft aria-hidden />
            All settlements
          </Link>
        </Button>

        <PageHeader
          title={settlement.number}
          description={
            privacy === "payee_self"
              ? `Your pay for ${settlement.period.label}.`
              : `${settlement.payee.displayNameSnapshot} · ${settlement.period.label}`
          }
          actions={
            <div className="flex flex-wrap items-center justify-end gap-2">
              {capabilities.canRecalculate ? (
                <Button
                  variant="secondary"
                  disabled={action.isPending}
                  onClick={() => run({ kind: "recalculate" })}
                >
                  <RefreshCw aria-hidden />
                  Recalculate
                </Button>
              ) : null}

              {capabilities.canSubmitForReview ? (
                <Button
                  variant="secondary"
                  disabled={action.isPending}
                  onClick={() => run({ kind: "submitForReview" })}
                >
                  <Send aria-hidden />
                  Send for review
                </Button>
              ) : null}

              {capabilities.canApprove ? (
                <Button variant="primary" onClick={() => setApproveOpen(true)}>
                  <CheckCircle2 aria-hidden />
                  Approve
                </Button>
              ) : null}

              {capabilities.canMarkReadyForPayment ? (
                <Button
                  variant="primary"
                  disabled={action.isPending}
                  onClick={() => run({ kind: "markReadyForPayment" })}
                >
                  <Wallet aria-hidden />
                  Queue for payment
                </Button>
              ) : null}

              {capabilities.canRecordPayment ? (
                <Button variant="primary" onClick={() => setPaymentOpen(true)}>
                  <Wallet aria-hidden />
                  Record payment
                </Button>
              ) : null}

              {capabilities.canResolveDispute && openDispute ? (
                <Button variant="primary" onClick={() => setResolveDisputeId(openDispute.id)}>
                  <MessageSquareWarning aria-hidden />
                  Close dispute
                </Button>
              ) : null}

              {capabilities.canGenerateStatement ? (
                <Button variant="secondary" asChild>
                  <Link href={`/finance/settlements/${settlement.id}/statement`}>
                    <FileText aria-hidden />
                    Statement
                  </Link>
                </Button>
              ) : null}

              {capabilities.canDispute ? (
                <Button variant="secondary" onClick={() => setDisputeOpen(true)}>
                  <MessageSquareWarning aria-hidden />
                  {privacy === "payee_self" ? "Something looks wrong" : "Raise a dispute"}
                </Button>
              ) : null}

              {capabilities.canCreateAdjustment ? (
                <Button variant="secondary" onClick={() => setAdjustOpen(true)}>
                  <Pencil aria-hidden />
                  Correct
                </Button>
              ) : null}

              {capabilities.canVoid ? (
                <Button variant="ghost" onClick={() => setVoidOpen(true)}>
                  <Ban aria-hidden />
                  Void
                </Button>
              ) : null}
            </div>
          }
        />
      </div>

      {action.isError ? (
        <p role="alert" className="rounded-md bg-st-danger-bg/60 px-4 py-3 text-[0.8125rem] text-st-danger">
          {action.error.message}
        </p>
      ) : null}

      {/* Status line ------------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <SettlementStatusChip status={settlement.status} />
        <SettlementKindChip kind={settlement.kind} />
        <PayeeKindChip kind={settlement.payee.kind} />
        <BlockedChip
          count={settlement.loadLines.reduce(
            (n, l) => n + l.missingData.filter((g) => g.blocksApproval).length,
            0,
          )}
        />
        {/* Only when the status does not already say so — otherwise the row
            would read "Disputed  Disputed". */}
        <DisputeChip count={openDispute && settlement.status !== "disputed" ? 1 : 0} />
        <OverdueChip days={overdueDays} />
      </div>

      <SettlementNotices settlement={settlement} />
      <MoneySummary settlement={settlement} />

      {settlement.adjustments.length > 0 ? (
        <AdjustmentList settlement={settlement} />
      ) : null}

      <Separator />

      <section aria-labelledby="breakdown" className="space-y-4">
        <h2 id="breakdown" className="text-[1rem] font-semibold text-fg">
          How this was worked out
        </h2>
        <CalculationBreakdown
          settlement={settlement}
          snapshot={settlement.snapshot}
          resolvableLoadIds={resolvableLoadIds}
        />
      </section>

      {settlement.disputes.length > 0 ? (
        <DisputeThread settlement={settlement} />
      ) : null}

      {settlement.payments.length > 0 ? <PaymentList settlement={settlement} /> : null}

      <AuditTrail entries={audit.data ?? []} loading={audit.isPending} />

      {/* Dialogs ----------------------------------------------------------- */}
      <ApproveDialog
        settlement={settlement}
        open={approveOpen}
        onOpenChange={(v) => { setApproveOpen(v); if (!v) action.reset(); }}
        action={action}
      />
      <DisputeDialog
        settlement={settlement}
        open={disputeOpen}
        onOpenChange={(v) => { setDisputeOpen(v); if (!v) action.reset(); }}
        action={action}
      />
      {resolveDisputeId ? (
        <ResolveDisputeDialog
          settlement={settlement}
          disputeId={resolveDisputeId}
          open
          onOpenChange={(v) => { if (!v) { setResolveDisputeId(null); action.reset(); } }}
          action={action}
        />
      ) : null}
      <RecordPaymentDialog
        settlement={settlement}
        open={paymentOpen}
        onOpenChange={(v) => { setPaymentOpen(v); if (!v) action.reset(); }}
        action={action}
      />
      <AdjustmentDialog
        settlement={settlement}
        open={adjustOpen}
        onOpenChange={(v) => { setAdjustOpen(v); if (!v) action.reset(); }}
        action={action}
      />
      <VoidDialog
        settlement={settlement}
        open={voidOpen}
        onOpenChange={(v) => { setVoidOpen(v); if (!v) action.reset(); }}
        action={action}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Notices                                                                     */
/* -------------------------------------------------------------------------- */

/** The things somebody needs to know before they read the numbers. */
function SettlementNotices({ settlement }: { settlement: Settlement }) {
  const notices: { tone: "danger" | "warning" | "info"; body: React.ReactNode }[] = [];

  if (settlement.status === "voided") {
    notices.push({
      tone: "warning",
      body: (
        <>
          <span className="font-medium text-fg">This settlement was voided</span> on{" "}
          {formatDate(settlement.voidedAt)}. {settlement.voidReason}
        </>
      ),
    });
  }

  if (settlement.correctsSettlementId) {
    notices.push({
      tone: "info",
      body: (
        <>
          This is a correction. It does not replace the settlement it belongs to —{" "}
          <Link
            href={`/finance/settlements/${settlement.correctsSettlementId}`}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            open the original
          </Link>
          , which keeps its own figures.
        </>
      ),
    });
  }

  for (const id of settlement.adjustmentSettlementIds ?? []) {
    notices.push({
      tone: "info",
      body: (
        <>
          A correction has been raised against this settlement. Its figures are
          unchanged;{" "}
          <Link
            href={`/finance/settlements/${id}`}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            open the correction
          </Link>{" "}
          to see the difference.
        </>
      ),
    });
  }

  if (notices.length === 0) return null;

  return (
    <div className="space-y-2">
      {notices.map((notice, i) => (
        <p
          key={i}
          className={cn(
            "flex items-start gap-2 rounded-lg border px-4 py-3 text-[0.8125rem] leading-relaxed text-fg-muted",
            notice.tone === "danger" && "border-st-danger/35 bg-st-danger-bg/40",
            notice.tone === "warning" && "border-st-warning/35 bg-st-warning-bg/40",
            notice.tone === "info" && "border-st-info/35 bg-st-info-bg/40",
          )}
        >
          <Link2 aria-hidden className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
          <span>{notice.body}</span>
        </p>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Money summary                                                               */
/* -------------------------------------------------------------------------- */

function MoneySummary({ settlement }: { settlement: Settlement }) {
  const tiles = [
    { label: "Gross earnings", value: money(settlement.totals.grossEarningsCents) },
    { label: "Net pay", value: money(settlement.totals.netPayCents), strong: true },
    { label: "Paid so far", value: money(settlement.amountPaidCents) },
    { label: "Still owed", value: money(settlement.amountOutstandingCents) },
  ];

  return (
    <div className="space-y-2.5">
      <dl className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-lg border border-border bg-surface p-4 shadow-e1">
            <dt className="text-[0.75rem] text-fg-muted">{tile.label}</dt>
            <dd
              className={cn(
                "mt-1 tabular-nums text-fg",
                tile.strong
                  ? "text-[1.375rem] leading-8 font-semibold"
                  : "text-[1.0625rem] leading-7 font-medium",
              )}
            >
              {tile.value}
            </dd>
          </div>
        ))}
      </dl>

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.75rem] text-fg-subtle">
        <span>Period {settlement.period.label}</span>
        {settlement.paymentDueAt ? <span>{dueLabel(settlement.paymentDueAt)}</span> : null}
        {settlement.approvedAt ? <span>Approved {formatDate(settlement.approvedAt)}</span> : null}
        {settlement.paidAt ? <span>Paid {formatDate(settlement.paidAt)}</span> : null}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Adjustments                                                                 */
/* -------------------------------------------------------------------------- */

function AdjustmentList({ settlement }: { settlement: Settlement }) {
  return (
    <section aria-labelledby="adjustments" className="space-y-3">
      <h2 id="adjustments" className="text-[1rem] font-semibold text-fg">
        Added and withheld
      </h2>
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface shadow-e1">
        {settlement.adjustments.map((adjustment) => (
          <li
            key={adjustment.id}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2">
                <span className="text-[0.875rem] font-medium text-fg">{adjustment.label}</span>
                <Badge tone="outline">{ADJUSTMENT_KIND_LABEL[adjustment.kind]}</Badge>
                {adjustment.installment ? (
                  <span className="text-[0.75rem] text-fg-subtle">
                    {adjustment.installment.number} of {adjustment.installment.of}
                  </span>
                ) : null}
              </p>
              {adjustment.note ? (
                <p className="mt-0.5 text-[0.75rem] text-fg-muted">{adjustment.note}</p>
              ) : null}
              {adjustment.expense ? (
                <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                  Approved by {adjustment.expense.approvedBySnapshot} on{" "}
                  {formatDate(adjustment.expense.approvedAt)}
                </p>
              ) : null}
            </div>
            <p
              className={cn(
                "shrink-0 text-[0.9375rem] font-semibold tabular-nums",
                adjustment.direction === "addition" ? "text-fg" : "text-st-danger",
              )}
            >
              {adjustment.direction === "addition" ? "+" : "−"}
              {money(adjustment.amountCents)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Disputes                                                                    */
/* -------------------------------------------------------------------------- */

function DisputeThread({ settlement }: { settlement: Settlement }) {
  return (
    <section aria-labelledby="disputes" className="space-y-3">
      <h2 id="disputes" className="text-[1rem] font-semibold text-fg">
        Disputes
      </h2>
      <ul className="space-y-3">
        {settlement.disputes.map((dispute) => (
          <li key={dispute.id}>
            <DisputeCard dispute={dispute} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function DisputeCard({ dispute }: { dispute: SettlementDispute }) {
  const open = dispute.status === "open" || dispute.status === "under_review";
  return (
    <article
      className={cn(
        "rounded-lg border bg-surface p-4 shadow-e1",
        open ? "border-st-danger/35" : "border-border",
      )}
    >
      <header className="flex flex-wrap items-center gap-2">
        <Badge tone={open ? "danger" : "neutral"}>
          {open ? "Open" : DISPUTE_RESOLUTION_LABEL[dispute.resolution ?? "withdrawn"]}
        </Badge>
        <span className="text-[0.8125rem] font-medium text-fg">
          {DISPUTE_REASON_LABEL[dispute.reason]}
        </span>
        {dispute.claimedAmountCents ? (
          <span className="text-[0.75rem] text-fg-muted">
            {money(dispute.claimedAmountCents)} in question
          </span>
        ) : null}
      </header>

      <p className="mt-2 text-[0.875rem] leading-relaxed text-fg">{dispute.summary}</p>
      <p className="mt-1 text-[0.75rem] text-fg-subtle">
        Raised by {dispute.raisedBy.displayNameSnapshot} on {formatDateTime(dispute.raisedAt)}
      </p>

      {dispute.messages.length > 0 ? (
        <ol className="mt-3 space-y-2 border-l-2 border-border pl-3">
          {dispute.messages.map((message) => (
            <li key={message.id}>
              <p className="text-[0.8125rem] text-fg">{message.body}</p>
              <p className="text-[0.6875rem] text-fg-subtle">
                {message.actor.displayNameSnapshot} · {formatDateTime(message.at)}
              </p>
            </li>
          ))}
        </ol>
      ) : null}

      {dispute.resolvedAt ? (
        <p className="mt-3 rounded-md bg-surface-sunken px-3 py-2 text-[0.8125rem] text-fg-muted">
          <span className="font-medium text-fg">
            {DISPUTE_RESOLUTION_LABEL[dispute.resolution ?? "withdrawn"]}
          </span>{" "}
          by {dispute.resolvedBy?.displayNameSnapshot} on {formatDate(dispute.resolvedAt)}.{" "}
          {dispute.resolutionNote}
          {dispute.adjustmentSettlementId ? (
            <>
              {" "}
              <Link
                href={`/finance/settlements/${dispute.adjustmentSettlementId}`}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Open the correction
              </Link>
              .
            </>
          ) : null}
        </p>
      ) : null}
    </article>
  );
}

/* -------------------------------------------------------------------------- */
/* Payments                                                                    */
/* -------------------------------------------------------------------------- */

function PaymentList({ settlement }: { settlement: Settlement }) {
  return (
    <section aria-labelledby="payments" className="space-y-3">
      <h2 id="payments" className="text-[1rem] font-semibold text-fg">
        Payments
      </h2>
      <p className="text-[0.8125rem] text-fg-muted">
        Recorded here, paid elsewhere. Antcolos does not move money.
      </p>
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface shadow-e1">
        {settlement.payments.map((payment) => (
          <li
            key={payment.id}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3"
          >
            <div>
              <p className="text-[0.875rem] font-medium text-fg">
                {PAYMENT_METHOD_LABEL[payment.method]}
                {payment.referenceNumber ? (
                  <span className="ml-2 font-mono text-[0.75rem] text-fg-muted">
                    {payment.referenceNumber}
                  </span>
                ) : null}
              </p>
              <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                Paid {formatDate(payment.paidAt)} · recorded by{" "}
                {payment.recordedBy.displayNameSnapshot}
              </p>
            </div>
            <p className="text-[0.9375rem] font-semibold tabular-nums text-fg">
              {money(payment.amountCents)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Audit                                                                       */
/* -------------------------------------------------------------------------- */

function AuditTrail({
  entries,
  loading,
}: {
  entries: Settlement["audit"];
  loading: boolean;
}) {
  return (
    <section aria-labelledby="audit" className="space-y-3">
      <h2 id="audit" className="text-[1rem] font-semibold text-fg">
        History
      </h2>
      <p className="text-[0.8125rem] text-fg-muted">
        Everything that has happened to this settlement, newest first. Entries are
        added, never changed or removed.
      </p>

      {loading ? (
        <LoadingSkeleton rows={3} />
      ) : (
        <ol className="space-y-2.5">
          {entries.map((entry) => (
            <li key={entry.id} className="flex gap-3">
              <span
                aria-hidden
                className="mt-1.5 size-1.5 shrink-0 rounded-full bg-border-strong"
              />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="text-[0.8125rem] font-medium text-fg">
                    {AUDIT_ACTION_LABEL[entry.action]}
                  </span>
                  {entry.fromStatus && entry.toStatus ? (
                    <Badge tone="outline">
                      {entry.fromStatus.replace(/_/g, " ")} → {entry.toStatus.replace(/_/g, " ")}
                    </Badge>
                  ) : null}
                </p>
                <p className="mt-0.5 text-[0.8125rem] text-fg-muted">{entry.summary}</p>
                <p className="mt-0.5 text-[0.6875rem] text-fg-subtle">
                  {entry.actor.displayNameSnapshot} · {formatDateTime(entry.at)}
                  {entry.toNetPayCents != null && entry.fromNetPayCents != null
                    ? ` · ${money(entry.fromNetPayCents)} → ${money(entry.toNetPayCents)}`
                    : null}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
