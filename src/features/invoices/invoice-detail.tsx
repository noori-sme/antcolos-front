"use client";

import {
  ArrowLeft, Building2, CalendarClock, FileText, History, Link2, Lock,
  Package, RefreshCw, Trash2, Truck, Wallet,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DOCUMENT_KIND_LABEL, VERIFICATION_STATE_LABEL } from "@/config/documents";
import {
  BILLING_PARTY_KIND_LABEL, DISPUTE_REASON_LABEL, INVOICE_AUDIT_LABEL,
  INVOICE_LINE_KIND_LABEL, INVOICE_STATUS, LINE_SOURCE_LABEL,
  PAYMENT_METHOD_LABEL, SUBMISSION_CHANNEL_LABEL, lineUnitLabel,
} from "@/config/invoices";
import { EQUIPMENT_LABEL } from "@/config/statuses";
import { useActiveMembership, useCan } from "@/lib/session/hooks";
import { cn, dateIn, dateTimeIn, money, relativeTime } from "@/lib/utils";
import {
  invoiceDaysPastDue, isInvoiceEditable, type Invoice, type InvoiceLineItem,
} from "@/types";
import {
  DisputeDialog, ReasonDialog, RecordPaymentDialog, SubmitDialog,
} from "./action-dialogs";
import { useInvoice, useInvoiceAction, useInvoiceReadiness } from "./hooks";
import { InvoiceStatusBadge, ReadinessRow, ReadinessSummary } from "./status-chips";

type OpenDialog = "submit" | "payment" | "dispute" | "resolve" | "void" | null;

export function InvoiceDetail({ invoiceId }: { invoiceId: string }) {
  const invoice = useInvoice(invoiceId);
  const readiness = useInvoiceReadiness(invoiceId);
  const action = useInvoiceAction();
  const { organization } = useActiveMembership();
  const [dialog, setDialog] = useState<OpenDialog>(null);

  const canEdit = useCan("invoices:edit");
  const canSend = useCan("invoices:send");
  const orgTz = organization?.timeZone ?? "UTC";

  if (invoice.isPending) {
    return (
      <div className="space-y-section">
        <Skeleton className="h-9 w-72" />
        <LoadingSkeleton rows={6} />
      </div>
    );
  }

  if (invoice.isError) {
    return (
      <div className="space-y-stack">
        <Button asChild variant="ghost" size="sm">
          <Link href="/finance/invoices">
            <ArrowLeft aria-hidden />
            All invoices
          </Link>
        </Button>
        <ErrorState
          title="This invoice is not available"
          description={
            /not found/i.test(invoice.error.message)
              ? "It does not exist in this organization, or it is outside what your membership can see."
              : invoice.error.message
          }
        />
      </div>
    );
  }

  const inv = invoice.data;
  const pastDue = inv.status === "overdue" ? invoiceDaysPastDue(inv) : null;
  const failing = readiness.data?.checks.filter((c) => c.state === "fail") ?? [];
  const alreadySent = !["draft", "needs_documents", "ready"].includes(inv.status);
  const close = () => {
    setDialog(null);
    action.reset();
  };
  const run = (a: Parameters<typeof action.mutate>[0]["action"]) =>
    action.mutate({ id: inv.id, action: a }, { onSuccess: close });

  return (
    <div className="space-y-section">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link href="/finance/invoices">
            <ArrowLeft aria-hidden />
            All invoices
          </Link>
        </Button>

        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-mono text-[1.5rem] leading-8 font-semibold tracking-[-0.01em] text-fg">
                {inv.number}
              </h1>
              <InvoiceStatusBadge status={inv.status} />
              {pastDue != null && pastDue > 0 ? (
                <Badge tone="danger">{pastDue} days past due</Badge>
              ) : null}
              {inv.replacesInvoiceId ? <Badge tone="outline">Reissue</Badge> : null}
            </div>
            <p className="mt-1.5 text-[0.9375rem] text-fg-muted">
              {inv.billingParty.name}
              <span className="mx-1.5 text-fg-subtle">·</span>
              {inv.load.originCity}, {inv.load.originState}
              <span className="mx-1.5 text-fg-subtle">→</span>
              {inv.load.destinationCity}, {inv.load.destinationState}
            </p>
            <p className="mt-0.5 text-[0.8125rem] text-fg-subtle">
              {INVOICE_STATUS[inv.status].description}
            </p>
          </div>

          <div className="shrink-0 text-left sm:text-right">
            <p className="tnum text-[1.5rem] leading-8 font-semibold text-fg">
              {money(inv.totalCents)}
            </p>
            <p className="tnum text-[0.8125rem] text-fg-muted">
              {inv.balanceCents === 0
                ? "Settled in full"
                : `${money(inv.balanceCents)} outstanding`}
            </p>
          </div>
        </header>
      </div>

      <ActionBar
        invoice={inv}
        canEdit={canEdit}
        canSend={canSend}
        pending={action.isPending}
        onIssue={() => run({ kind: "issue" })}
        onRecheck={() => run({ kind: "recheck" })}
        onRefreshDocuments={() => run({ kind: "refreshDocuments" })}
        onOpen={setDialog}
      />

      {action.isError && dialog === null ? (
        <p role="alert" className="text-[0.8125rem] text-st-danger">
          {action.error.message}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-stack lg:grid-cols-3">
        <div className="space-y-stack lg:col-span-2">
          {/* Readiness — the answer to "why can this not go out yet". */}
          <Card>
            <CardHeader>
              <div className="min-w-0">
                <CardTitle>Readiness</CardTitle>
                <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
                  {alreadySent
                    ? "This invoice has already gone out. The checks are kept for reference."
                    : "Checked against this invoice's own snapshot, not against whatever the other modules say today."}
                </p>
              </div>
              {readiness.data ? (
                <Badge tone={readiness.data.ready ? "success" : "warning"}>
                  {readiness.data.ready
                    ? "All checks passed"
                    : `${failing.length} blocking`}
                </Badge>
              ) : null}
            </CardHeader>
            <CardContent className="px-0 pb-2">
              {readiness.isPending ? (
                <div className="px-5 pb-3">
                  <LoadingSkeleton rows={3} />
                </div>
              ) : readiness.isError ? (
                <div className="px-5 pb-3">
                  <ErrorState description={readiness.error.message} />
                </div>
              ) : (
                <>
                  <div className="border-t border-border px-5 py-3">
                    <ReadinessSummary
                      ready={readiness.data.ready}
                      failing={failing}
                      alreadySent={alreadySent}
                    />
                  </div>
                  <ul className="divide-y divide-border border-t border-border">
                    {readiness.data.checks.map((check) => (
                      <ReadinessRow key={check.id} check={check} />
                    ))}
                  </ul>
                </>
              )}
            </CardContent>
          </Card>

          {/* Line items */}
          <Card>
            <CardHeader>
              <div className="min-w-0">
                <CardTitle>Line items</CardTitle>
                <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
                  Every charge points back at the module that authorised it.
                </p>
              </div>
              <Badge tone="outline">
                {inv.lineItems.length} line{inv.lineItems.length === 1 ? "" : "s"}
              </Badge>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <ul className="divide-y divide-border border-t border-border">
                {inv.lineItems.map((line) => (
                  <LineItemRow
                    key={line.id}
                    line={line}
                    timeZone={orgTz}
                    removable={canEdit && isInvoiceEditable(inv) && line.kind !== "linehaul"}
                    pending={action.isPending}
                    onRemove={() =>
                      action.mutate({
                        id: inv.id,
                        action: { kind: "removeLineItem", lineItemId: line.id },
                      })
                    }
                  />
                ))}
              </ul>
              <dl className="border-t border-border px-5 py-3">
                <Amount label="Subtotal" cents={inv.subtotalCents} />
                <Amount label="Total" cents={inv.totalCents} strong />
                {inv.amountPaidCents > 0 ? (
                  <Amount label="Paid" cents={-inv.amountPaidCents} />
                ) : null}
                <Amount label="Balance" cents={inv.balanceCents} strong />
              </dl>
            </CardContent>
          </Card>

          {/* Documents */}
          <Card>
            <CardHeader>
              <div className="min-w-0">
                <CardTitle>Documents</CardTitle>
                <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
                  What this payer requires, and what was attached at the time.
                </p>
              </div>
              {canEdit ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={action.isPending}
                  onClick={() => action.mutate({ id: inv.id, action: { kind: "refreshDocuments" } })}
                >
                  <RefreshCw aria-hidden />
                  Refresh
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <ul className="divide-y divide-border border-t border-border">
                {inv.documents.map((doc) => (
                  <li key={doc.kind} className="flex items-start gap-3 px-5 py-3">
                    <FileText
                      aria-hidden
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        doc.documentId ? "text-fg-subtle" : "text-st-warning",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.875rem] font-medium text-fg">
                        {DOCUMENT_KIND_LABEL[doc.kind]}
                        {doc.required ? null : (
                          <span className="ml-1.5 text-[0.6875rem] font-normal text-fg-subtle">
                            optional
                          </span>
                        )}
                      </span>
                      {doc.documentId ? (
                        <>
                          <span className="block truncate text-[0.75rem] text-fg-subtle">
                            {doc.fileNameSnapshot ?? doc.documentId}
                            {doc.versionSnapshot ? ` · v${doc.versionSnapshot}` : ""}
                          </span>
                          {doc.verificationStateSnapshot ? (
                            <Badge
                              tone={
                                doc.verificationStateSnapshot === "rejected"
                                  ? "danger"
                                  : doc.verificationStateSnapshot === "pending"
                                    ? "warning"
                                    : "outline"
                              }
                              className="mt-1"
                            >
                              {VERIFICATION_STATE_LABEL[doc.verificationStateSnapshot]}
                            </Badge>
                          ) : null}
                        </>
                      ) : (
                        <span className="block text-[0.75rem] text-st-warning">
                          {doc.required ? "Required, not attached" : "Not attached"}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* Payments */}
          <Card>
            <CardHeader>
              <div className="min-w-0">
                <CardTitle>Payment history</CardTitle>
                <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
                  Recorded by people. No bank or accounting system is connected.
                </p>
              </div>
              {inv.payments.length > 0 ? (
                <Badge tone="outline">{money(inv.amountPaidCents)} received</Badge>
              ) : null}
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {inv.payments.length === 0 ? (
                <p className="border-t border-border px-5 py-4 text-[0.8125rem] text-fg-muted">
                  Nothing received yet.
                </p>
              ) : (
                <ul className="divide-y divide-border border-t border-border">
                  {inv.payments.map((payment) => (
                    <li key={payment.id} className="flex items-start gap-3 px-5 py-3">
                      <Wallet aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-[0.875rem] font-medium text-fg">
                            {PAYMENT_METHOD_LABEL[payment.method]}
                            {payment.reference ? (
                              <span className="ml-1.5 font-normal text-fg-muted">
                                {payment.reference}
                              </span>
                            ) : null}
                          </span>
                          <span className="tnum text-[0.875rem] font-medium text-fg">
                            {money(payment.amountCents)}
                          </span>
                        </span>
                        <span className="block text-[0.75rem] text-fg-subtle">
                          Received {dateIn(payment.receivedAt, orgTz)} · recorded by{" "}
                          {payment.recordedBy.displayNameSnapshot}
                        </span>
                        {payment.note ? (
                          <span className="block text-[0.75rem] text-fg-muted">{payment.note}</span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Version and audit history */}
          <Card>
            <CardHeader>
              <div className="min-w-0">
                <CardTitle>History</CardTitle>
                <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
                  Append-only. Version {inv.version}; nothing here is ever edited.
                </p>
              </div>
              <Badge tone="outline">
                {inv.audit.length} entr{inv.audit.length === 1 ? "y" : "ies"}
              </Badge>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <ol className="divide-y divide-border border-t border-border">
                {[...inv.audit].reverse().map((entry) => (
                  <li key={entry.id} className="flex items-start gap-3 px-5 py-3">
                    <History aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[0.875rem] font-medium text-fg">
                          {INVOICE_AUDIT_LABEL[entry.action] ?? entry.action}
                        </span>
                        {entry.fromStatus && entry.toStatus ? (
                          <Badge tone="neutral">
                            {INVOICE_STATUS[entry.fromStatus].label} →{" "}
                            {INVOICE_STATUS[entry.toStatus].label}
                          </Badge>
                        ) : null}
                        {entry.amountCents ? (
                          <span className="tnum text-[0.75rem] text-fg-muted">
                            {money(entry.amountCents)}
                          </span>
                        ) : null}
                      </span>
                      <span className="block text-[0.75rem] text-fg-subtle">
                        v{entry.version} · {dateTimeIn(entry.at, orgTz)} ·{" "}
                        {entry.actor.displayNameSnapshot}
                      </span>
                      {entry.note ? (
                        <span className="mt-0.5 block text-[0.8125rem] leading-5 text-fg-muted">
                          {entry.note}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-stack">
          {/* Dates and terms */}
          <Card>
            <CardHeader>
              <CardTitle>Dates and terms</CardTitle>
            </CardHeader>
            <CardContent className="border-t border-border pt-0">
              <Row icon={CalendarClock} label="Issued">
                <span className="text-fg">
                  {inv.issueDate ? dateIn(inv.issueDate, orgTz) : "Not issued yet"}
                </span>
              </Row>
              <Row icon={CalendarClock} label={`Due · net ${inv.paymentTermsDays}`}>
                <span className={pastDue != null && pastDue > 0 ? "text-st-danger" : "text-fg"}>
                  {inv.dueDate ? dateIn(inv.dueDate, orgTz) : "—"}
                </span>
                {inv.dueDate && inv.balanceCents > 0 ? (
                  <span className="block text-[0.75rem] text-fg-subtle">
                    {relativeTime(inv.dueDate)}
                  </span>
                ) : null}
              </Row>
              {inv.submission ? (
                <Row icon={Link2} label="Submitted">
                  <span className="text-fg">
                    {SUBMISSION_CHANNEL_LABEL[inv.submission.channel]}
                    {inv.submission.destination ? ` · ${inv.submission.destination}` : ""}
                  </span>
                  <span className="block text-[0.75rem] text-fg-subtle">
                    {dateTimeIn(inv.submission.submittedAt, orgTz)} by{" "}
                    {inv.submission.submittedBy.displayNameSnapshot}
                  </span>
                  <span className="mt-1 block text-[0.75rem] text-fg-subtle">
                    Delivery not confirmed — Antcolos does not send invoices.
                  </span>
                </Row>
              ) : null}
              {inv.voidedAt ? (
                <Row icon={Trash2} label="Voided">
                  <span className="text-fg">{dateIn(inv.voidedAt, orgTz)}</span>
                  <span className="block text-[0.75rem] text-fg-muted">{inv.voidReason}</span>
                </Row>
              ) : null}
            </CardContent>
          </Card>

          {/* Dispute */}
          {inv.dispute ? (
            <Card className={inv.dispute.resolvedAt ? undefined : "border-st-danger/40"}>
              <CardHeader>
                <CardTitle>Dispute</CardTitle>
                <Badge tone={inv.dispute.resolvedAt ? "success" : "danger"}>
                  {inv.dispute.resolvedAt ? "Resolved" : "Open"}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-2 border-t border-border pt-3">
                <p className="text-[0.8125rem] font-medium text-fg">
                  {DISPUTE_REASON_LABEL[inv.dispute.reasonCode]}
                </p>
                <p className="text-[0.8125rem] leading-5 text-fg-muted">
                  {inv.dispute.detail}
                </p>
                <p className="text-[0.75rem] text-fg-subtle">
                  {inv.dispute.disputedAmountCents
                    ? `${money(inv.dispute.disputedAmountCents)} contested of ${money(inv.totalCents)}`
                    : "The whole invoice is contested"}
                  {" · "}
                  opened {dateTimeIn(inv.dispute.openedAt, orgTz)} by{" "}
                  {inv.dispute.openedBy.displayNameSnapshot}
                </p>
                {inv.dispute.resolvedAt ? (
                  <p className="rounded-md bg-surface-sunken px-3 py-2 text-[0.8125rem] leading-5 text-fg-muted">
                    {inv.dispute.resolution}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {/* Billed to — the snapshot, not the live profile */}
          <Card>
            <CardHeader>
              <CardTitle>Billed to</CardTitle>
              <Badge tone="neutral">Snapshot</Badge>
            </CardHeader>
            <CardContent className="border-t border-border pt-0">
              <Row icon={Building2} label={BILLING_PARTY_KIND_LABEL[inv.billingParty.kind]}>
                <span className="text-fg">{inv.billingParty.name}</span>
                {inv.billingParty.mcNumber ? (
                  <span className="block text-[0.75rem] text-fg-subtle">
                    {inv.billingParty.mcNumber}
                  </span>
                ) : null}
                {inv.billingParty.billingContact?.email ? (
                  <span className="block text-[0.75rem] text-fg-subtle">
                    {inv.billingParty.billingContact.email}
                  </span>
                ) : null}
                {inv.billingParty.billingAddress ? (
                  <span className="block text-[0.75rem] text-fg-subtle">
                    {[
                      inv.billingParty.billingAddress.line1,
                      `${inv.billingParty.billingAddress.city}, ${inv.billingParty.billingAddress.state}`,
                      inv.billingParty.billingAddress.postalCode,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                ) : null}
                {inv.billingParty.submissionPortal ? (
                  <span className="block text-[0.75rem] text-fg-subtle">
                    Submit through {inv.billingParty.submissionPortal}
                  </span>
                ) : null}
              </Row>
              <Row icon={Truck} label="Remit to">
                <span className="text-fg">{inv.carrier.legalName}</span>
                {inv.carrier.mcNumber || inv.carrier.dotNumber ? (
                  <span className="block text-[0.75rem] text-fg-subtle">
                    {[inv.carrier.mcNumber, inv.carrier.dotNumber && `DOT ${inv.carrier.dotNumber}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                ) : null}
                {inv.carrier.remitToAddress ? (
                  <span className="block text-[0.75rem] text-fg-subtle">
                    {[
                      inv.carrier.remitToAddress.line1,
                      `${inv.carrier.remitToAddress.city}, ${inv.carrier.remitToAddress.state}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                ) : null}
              </Row>
              <p className="pt-3 text-[0.75rem] leading-5 text-fg-subtle">
                Copied when this invoice was created. If the payer renames itself
                or moves, this invoice keeps saying what was actually billed.
              </p>
            </CardContent>
          </Card>

          {/* The load and the agreement, by reference */}
          <Card>
            <CardHeader>
              <CardTitle>Load and agreement</CardTitle>
            </CardHeader>
            <CardContent className="border-t border-border pt-0">
              <Row icon={Package} label="Load">
                <Link
                  href={`/loads/${inv.loadId}`}
                  className="font-mono text-[0.875rem] text-primary hover:underline"
                >
                  {inv.load.reference}
                </Link>
                {inv.load.customerReference ? (
                  <span className="block text-[0.75rem] text-fg-subtle">
                    Customer ref {inv.load.customerReference}
                  </span>
                ) : null}
                <span className="block text-[0.75rem] text-fg-subtle">
                  {EQUIPMENT_LABEL[inv.load.equipment] ?? inv.load.equipment} ·{" "}
                  {inv.load.loadedMiles.toLocaleString()} loaded miles
                  {inv.load.driverNameSnapshot ? ` · ${inv.load.driverNameSnapshot}` : ""}
                </span>
                {inv.load.deliveredAt ? (
                  <span className="block text-[0.75rem] text-fg-subtle">
                    Delivered {dateIn(inv.load.deliveredAt, orgTz)}
                  </span>
                ) : (
                  <span className="block text-[0.75rem] text-st-warning">Not delivered</span>
                )}
              </Row>
              <Row icon={FileText} label="Rate confirmation">
                {inv.rateConfirmation ? (
                  <>
                    <span className="tnum text-fg">
                      {money(inv.rateConfirmation.agreedLinehaulCents)} agreed linehaul
                    </span>
                    <span className="block text-[0.75rem] text-fg-subtle">
                      Received {dateIn(inv.rateConfirmation.receivedAt, orgTz)}
                      {inv.rateConfirmation.verifiedAt ? " · verified" : " · not verified"}
                    </span>
                  </>
                ) : (
                  <span className="text-st-warning">None on file</span>
                )}
              </Row>
              {inv.replacesInvoiceId ? (
                <Row icon={Link2} label="Replaces">
                  <Link
                    href={`/finance/invoices/${inv.replacesInvoiceId}`}
                    className="text-[0.875rem] text-primary hover:underline"
                  >
                    The invoice this one reissues
                  </Link>
                </Row>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Dialogs */}
      <SubmitDialog
        invoice={inv}
        open={dialog === "submit"}
        onOpenChange={(open) => (open ? setDialog("submit") : close())}
        pending={action.isPending}
        error={action.error?.message}
        onConfirm={(channel, destination, note) =>
          run({
            kind: "submit",
            input: {
              channel,
              destination: destination || undefined,
              note: note || undefined,
            },
          })
        }
      />
      <RecordPaymentDialog
        invoice={inv}
        open={dialog === "payment"}
        onOpenChange={(open) => (open ? setDialog("payment") : close())}
        pending={action.isPending}
        error={action.error?.message}
        onConfirm={(input) =>
          run({
            kind: "recordPayment",
            input: { ...input, reference: input.reference || undefined },
          })
        }
      />
      <DisputeDialog
        invoice={inv}
        open={dialog === "dispute"}
        onOpenChange={(open) => (open ? setDialog("dispute") : close())}
        pending={action.isPending}
        error={action.error?.message}
        onConfirm={(input) => run({ kind: "openDispute", input })}
      />
      <ReasonDialog
        open={dialog === "resolve"}
        onOpenChange={(open) => (open ? setDialog("resolve") : close())}
        title="Resolve the dispute"
        description="Say what was agreed. The invoice returns to whatever the money says it is."
        label="What was agreed"
        placeholder="Apex accepted the lumper receipt and will pay in full on the next run."
        confirmLabel="Resolve"
        pending={action.isPending}
        error={action.error?.message}
        onConfirm={(resolution) => run({ kind: "resolveDispute", resolution })}
      />
      <ReasonDialog
        open={dialog === "void"}
        onOpenChange={(open) => (open ? setDialog("void") : close())}
        title="Void this invoice"
        description="The invoice is kept, with its number, and stops being a receivable. The number is never reused."
        label="Why"
        placeholder="Billed the broker direct; this load was factored."
        confirmLabel="Void invoice"
        danger
        pending={action.isPending}
        error={action.error?.message}
        onConfirm={(reason) => run({ kind: "void", reason })}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ActionBar({
  invoice, canEdit, canSend, pending, onIssue, onRecheck, onRefreshDocuments, onOpen,
}: {
  invoice: Invoice;
  canEdit: boolean;
  canSend: boolean;
  pending: boolean;
  onIssue: () => void;
  onRecheck: () => void;
  onRefreshDocuments: () => void;
  onOpen: (dialog: OpenDialog) => void;
}) {
  const actions: React.ReactNode[] = [];
  const live = invoice.status !== "void" && invoice.status !== "paid";

  if (canEdit && invoice.status === "draft") {
    actions.push(
      <Button key="issue" variant="primary" size="sm" disabled={pending} onClick={onIssue}>
        Issue invoice
      </Button>,
    );
  }
  if (canEdit && invoice.status === "needs_documents") {
    actions.push(
      <Button key="refresh" variant="secondary" size="sm" disabled={pending} onClick={onRefreshDocuments}>
        <RefreshCw aria-hidden />
        Check for documents
      </Button>,
    );
  }
  if (invoice.status === "needs_documents" || invoice.status === "ready") {
    actions.push(
      <Button key="recheck" variant="ghost" size="sm" disabled={pending} onClick={onRecheck}>
        Re-run readiness
      </Button>,
    );
  }
  if (canSend && invoice.status === "ready") {
    actions.push(
      <Button key="submit" variant="primary" size="sm" disabled={pending} onClick={() => onOpen("submit")}>
        Record as sent
      </Button>,
    );
  }
  if (canEdit && live && invoice.issueDate && invoice.balanceCents > 0) {
    actions.push(
      <Button key="payment" variant="secondary" size="sm" disabled={pending} onClick={() => onOpen("payment")}>
        <Wallet aria-hidden />
        Record payment
      </Button>,
    );
  }
  if (canEdit && live && invoice.submission && !invoice.dispute) {
    actions.push(
      <Button key="dispute" variant="ghost" size="sm" disabled={pending} onClick={() => onOpen("dispute")}>
        Open dispute
      </Button>,
    );
  }
  if (canEdit && invoice.dispute && !invoice.dispute.resolvedAt) {
    actions.push(
      <Button key="resolve" variant="secondary" size="sm" disabled={pending} onClick={() => onOpen("resolve")}>
        Resolve dispute
      </Button>,
    );
  }
  if (canEdit && live) {
    actions.push(
      <Button key="void" variant="ghost" size="sm" disabled={pending} onClick={() => onOpen("void")}>
        <Trash2 aria-hidden />
        Void
      </Button>,
    );
  }

  if (actions.length === 0) {
    return (
      <p className="flex items-start gap-2 text-[0.8125rem] text-fg-muted">
        <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
        {invoice.status === "paid" || invoice.status === "void"
          ? "This invoice is closed. It is kept as a record and can no longer change."
          : "Your membership can read this invoice but not act on it."}
      </p>
    );
  }

  return <div className="flex flex-wrap items-center gap-2">{actions}</div>;
}

function LineItemRow({
  line, timeZone, removable, pending, onRemove,
}: {
  line: InvoiceLineItem;
  timeZone: string;
  removable: boolean;
  pending: boolean;
  onRemove: () => void;
}) {
  const metered =
    line.quantity != null && line.unit && line.unitAmountCents != null
      ? `${line.quantity} ${lineUnitLabel(line.unit, line.quantity)} × ${money(line.unitAmountCents)}`
      : null;

  return (
    <li className="flex items-start gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={line.kind === "linehaul" ? "neutral" : "info"}>
            {INVOICE_LINE_KIND_LABEL[line.kind]}
          </Badge>
          <span className="text-[0.875rem] font-medium text-fg">{line.label}</span>
        </div>
        <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
          {LINE_SOURCE_LABEL[line.source.module] ?? line.source.module}
          {metered ? ` · ${metered}` : ""}
          {line.source.approvedBy
            ? ` · approved by ${line.source.approvedBy.displayNameSnapshot}${
                line.source.approvedAt ? ` on ${dateIn(line.source.approvedAt, timeZone)}` : ""
              }`
            : line.kind === "linehaul"
              ? " · authorised by the rate confirmation"
              : " · no approval recorded"}
        </p>
        {line.notes ? (
          <p className="mt-1 text-[0.75rem] text-fg-muted">{line.notes}</p>
        ) : null}
      </div>
      <span className="tnum shrink-0 text-[0.875rem] font-medium text-fg">
        {money(line.amountCents)}
      </span>
      {removable ? (
        <Button
          variant="ghost"
          size="iconSm"
          aria-label={`Remove ${line.label}`}
          disabled={pending}
          onClick={onRemove}
        >
          <Trash2 aria-hidden />
        </Button>
      ) : null}
    </li>
  );
}

function Row({
  icon: Icon, label, children,
}: {
  icon: typeof Building2;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-border py-3 last:border-0">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
      <div className="min-w-0 flex-1">
        <p className="text-[0.75rem] text-fg-subtle">{label}</p>
        <div className="mt-0.5 text-[0.875rem]">{children}</div>
      </div>
    </div>
  );
}

function Amount({
  label, cents, strong,
}: {
  label: string;
  cents: number;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between py-1.5">
      <dt className="text-[0.8125rem] text-fg-muted">{label}</dt>
      <dd className={cn("tnum text-[0.875rem]", strong ? "font-semibold text-fg" : "text-fg")}>
        {money(cents)}
      </dd>
    </div>
  );
}
