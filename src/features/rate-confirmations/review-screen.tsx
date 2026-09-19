"use client";

import { ArrowRight, Check, FileSignature, ShieldCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/layout/page-header";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  DistributionOutcome, ExtractedField, RateConFieldKey, RateConWorkflow,
} from "@/types";
import {
  PROJECTION_STATE_LABEL, RATECON_FIELD_LABEL, RATECON_STATUS_LABEL,
} from "@/types";
import { relativeTime } from "@/lib/utils/format";
import { useMtLoopContext } from "@/features/mt-loop/use-mt-loop";
import { useOpportunityRefresh } from "@/features/opportunities/use-opportunity-refresh";
import {
  confirmAndSign, correctField, fieldsByPriority, progressOf,
  rejectRateConfirmation, returnToBroker, verifyField,
} from "@/lib/api/mock/rate-confirmation";
import { InfoTip } from "@/features/mt-loop/tip";
import { DocumentView } from "./document-view";
import { PROJECTION_TONE } from "./projection-tone";
import { useRateCon } from "./use-rate-con";
import { cn } from "@/lib/utils";

/**
 * The broker's rate confirmation, and what we think it should say, side by side.
 *
 * The rule this screen exists to enforce: nobody signs a document they have not
 * read, field by field. So the fields are a queue rather than a form — one is
 * current, the current one is lit up on the page beside it, and the confirm
 * button does not appear until the last required field has been looked at.
 *
 * Clicking any field moves the highlight. Clicking anything on the DOCUMENT
 * jumps to the field it belongs to, because a dispatcher reading the page will
 * spot the wrong number before they reach it in the list.
 */
export function RateConReviewScreen({ rateConId }: { rateConId: string }) {
  const ctx = useMtLoopContext();
  const query = useRateCon(rateConId);
  const refreshWorkspace = useOpportunityRefresh();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentKey, setCurrentKey] = useState<RateConFieldKey | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [draftValue, setDraftValue] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showSigned, setShowSigned] = useState(false);

  const workflow = query.data ?? undefined;

  async function act(fn: () => Promise<{ status: string }>) {
    if (!ctx) return;
    setBusy(true);
    setError(null);
    const outcome = await fn().catch(() => null) as
      { status: string; reason?: string; blockedReasons?: string[] } | null;
    setBusy(false);
    if (!outcome) setError("Something went wrong. Nothing was changed.");
    else if (outcome.status === "not_permitted") setError("You are not allowed to do that.");
    else if (outcome.status === "blocked") setError(outcome.reason ?? "That cannot be done.");
    else if (outcome.status === "not_ready") setError((outcome.blockedReasons ?? []).join(" "));
    else if (outcome.status === "needs_reason") setError("Type what it should say.");
    void query.refetch();
    refreshWorkspace();
  }

  if (query.isPending) {
    return (
      <div className="space-y-section">
        <Skeleton className="h-9 w-80" />
        <LoadingSkeleton rows={6} />
      </div>
    );
  }
  if (query.isError) {
    return <ErrorState title="Could not open it" onRetry={() => query.refetch()} />;
  }
  if (!workflow) {
    return (
      <ErrorState
        title="This rate confirmation is not yours"
        description="It belongs to another workspace, or it is not here any more."
      />
    );
  }

  const progress = progressOf(workflow);
  // With nothing picked, the screen follows the queue: the next required field
  // nobody has looked at. Picking one pins it there until the next answer, so
  // a dispatcher can jump back to check something without losing their place.
  // No fallback to the first field: once everything required is checked, the
  // queue is EMPTY and should say so. Showing a checked field again invites a
  // second click and a second identical line in the audit.
  const current = workflow.fields.find((f) => f.key === (currentKey ?? progress.nextFieldKey));
  const done = workflow.status === "returned" || workflow.status === "rejected";
  const shown = showSigned && workflow.signed ? workflow.signed : workflow.original;
  const conflicts = workflow.fields.filter((f) => f.disagrees);
  /*
   * ★ AN ANSWERED CONFLICT IS STILL A CONFLICT ★
   * Saying "theirs is right" on a rate that is $50 under what was agreed does
   * not make the document match the booking — it records that a person looked.
   * The banner therefore never shrinks as fields are checked; each line says
   * whether it has been answered yet, and the money is still on the screen.
   */
  const openConflicts = conflicts.filter((f) => f.status === "unreviewed");

  /*
   * ★ ENTER ADVANCES ★
   * Nineteen fields, and every one used to be a reach for the mouse away from
   * the next. A rate confirmation is a keyboard job: read the value, press
   * Enter, read the next one.
   *
   * While correcting, Enter saves the correction instead — that is what the
   * person is in the middle of doing. It is ignored inside any other text box
   * and while a request is in flight, so a held key cannot approve three
   * fields nobody looked at.
   */
  const rateConId_ = workflow.rateConId;
  function approveOrSave() {
    if (busy || !ctx || !current || done) return;
    if (correcting) {
      if (!draftValue.trim()) return;
      void act(() => correctField(rateConId_, current.key, draftValue, ctx, note));
    } else {
      void act(() => verifyField(rateConId_, current.key, ctx));
    }
    moveToNext();
  }

  /** Unpin, so the screen goes back to following the queue. */
  function moveToNext() {
    setCurrentKey(null);
    setCorrecting(false);
    setNote("");
  }

  return (
    <div className="space-y-section">
      <EnterAdvances onEnter={approveOrSave} active={Boolean(ctx) && !done && Boolean(current)} />
      <PageHeader
        title={`Rate confirmation — ${workflow.loadReference}`}
        description={`From ${workflow.brokerName}, for ${workflow.carrierName}. Checked against what was booked.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={workflow.status === "returned" ? "success" : workflow.status === "rejected" ? "danger" : "info"}>
              {RATECON_STATUS_LABEL[workflow.status]}
            </Badge>
            <Button variant="secondary" size="sm" asChild>
              <Link href="/dispatch/opportunities">Back to the inbox</Link>
            </Button>
          </div>
        }
      />

      <EmailStrip workflow={workflow} />

      {error ? (
        <p role="alert" className="rounded-md border border-st-danger/40 bg-st-danger-bg/60 px-3.5 py-2.5 text-[0.8125rem] text-fg">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        {/* The document stays put while the field list scrolls past it: the
            whole point of the screen is looking at both at once. */}
        <section className="rounded-lg border border-border bg-surface p-4 shadow-e1 lg:sticky lg:top-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[0.875rem] font-semibold text-fg">
              {shown.kind === "signed" ? "The signed copy" : "What they sent"}
            </h2>
            {workflow.signed ? (
              <Button variant="ghost" size="sm" onClick={() => setShowSigned((v) => !v)}>
                {showSigned ? "Show the original" : "Show the signed copy"}
              </Button>
            ) : null}
          </div>
          <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
            {shown.kind === "signed"
              ? "The broker's own document with a signature block added. Their pages are carried across unchanged; the received original is kept as it arrived."
              : "Click anything on the page to jump to that field."}
          </p>
          <div className="mt-3">
            <DocumentView
              document={shown}
              label={shown.kind === "signed" ? "Signed rate confirmation" : "Rate confirmation"}
              highlightBlockId={shown.kind === "original" ? current?.blockId : undefined}
              onBlockClick={shown.kind === "original" && !done
                ? (blockId) => {
                  const field = workflow.fields.find((f) => f.blockId === blockId);
                  if (field) { setCurrentKey(field.key); setCorrecting(false); }
                }
                : undefined}
            />
          </div>
        </section>

        {/* What we read, and what we think instead. */}
        <div className="space-y-4">
          <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
            <h2 className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg">
              What we read off it
              <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[0.6875rem] font-medium tabular-nums text-fg-muted">
                {progress.reviewed}/{progress.required}
              </span>
              <span className="flex-1" />
              <kbd className="rounded-sm border border-border px-1.5 py-0.5 text-[0.625rem] font-normal text-fg-subtle">
                Enter
              </kbd>
              <InfoTip text="Enter approves the field being checked and moves to the next one. While you are correcting a value, Enter saves the correction." />
            </h2>


            {/*
              ★ THE MIDDLE ANSWER ★
              Two buttons used to exist here: sign it, or kill the load. A
              document that says $2,200 where $2,500 was agreed is usually
              neither — it is a correction, and a dispatcher without this
              banner either accepted the wrong number or blew up a booked load.
            */}
            {conflicts.length > 0 && !done ? (
              <div className="mt-3 rounded-md border border-st-warning/50 bg-st-warning-bg/35 px-3.5 py-2.5">
                <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] font-semibold text-fg">
                  <TriangleAlert className="size-4 shrink-0 text-st-warning" aria-hidden />
                  {conflicts.length} {conflicts.length === 1 ? "line does" : "lines do"} not match the booking
                  {openConflicts.length === 0 ? (
                    <Badge tone="neutral">all answered</Badge>
                  ) : (
                    <Badge tone="warning">{openConflicts.length} unanswered</Badge>
                  )}
                </p>
                <ul className="mt-1.5 space-y-0.5">
                  {conflicts.map((f) => (
                    <li key={f.key} className="flex flex-wrap items-baseline gap-x-2 text-[0.75rem]">
                      <span className="text-[0.625rem] tracking-wide text-fg-subtle uppercase">
                        {RATECON_FIELD_LABEL[f.key]}
                      </span>
                      <span className="font-medium tabular-nums text-fg">{f.expected ?? "not recorded"}</span>
                      <span aria-hidden className="text-fg-subtle">→</span>
                      <span className="font-medium tabular-nums text-st-warning">{f.value}</span>
                      {f.status === "unreviewed" ? null : (
                        <span className="text-[0.625rem] tracking-wide text-fg-subtle uppercase">
                          {f.status === "corrected" ? "corrected" : "kept theirs"}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={busy}
                    onClick={() => void act(() => returnToBroker(workflow.rateConId, ctx!))}
                  >
                    Send back for correction
                  </Button>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => setRejecting(true)}>
                    Reject the load
                  </Button>
                  <span className="flex-1" />
                  <InfoTip text="Sending it back returns the broker's own document with these lines marked, attached to a message quoting both numbers. The load stands and the truck keeps holding. Rejecting ends it." />
                </div>
                {workflow.sentBackAt ? (
                  <p className="mt-1.5 text-[0.6875rem] text-fg-muted">
                    Already sent back {relativeTime(workflow.sentBackAt)}.
                  </p>
                ) : null}
              </div>
            ) : null}

            {!current && !done ? (
              <p className="mt-3 rounded-md border border-st-success/40 bg-surface-sunken px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-fg">
                Everything that has to be checked has been. Pick any field below to look at it
                again, or confirm and sign.
              </p>
            ) : null}
            {current && !done ? (
              <CurrentField
                field={current}
                busy={busy}
                correcting={correcting}
                draftValue={draftValue}
                note={note}
                onStartCorrecting={() => {
                  setCorrecting(true);
                  setDraftValue(current.expected ?? current.value);
                }}
                onDraftValue={setDraftValue}
                onNote={setNote}
                onCancel={() => setCorrecting(false)}
                onVerify={() => { void act(() => verifyField(workflow.rateConId, current.key, ctx!)); moveToNext(); }}
                onCorrect={() => {
                  void act(() => correctField(workflow.rateConId, current.key, draftValue, ctx!, note));
                  moveToNext();
                }}
              />
            ) : null}

            {/*
              ★ WORST FIRST, NOT PAGE ORDER ★
              A rate read at 82% buried under a street address read at 61% is
              how a wrong number gets signed. The list is ranked: anything that
              disagrees with the booking, then the fields that cost money or
              miss a dock, then anything the reader was unsure of.
            */}
            <ul className="mt-3 space-y-1">
              {fieldsByPriority(workflow).map((f) => (
                <FieldRow
                  key={f.key}
                  field={f}
                  current={f.key === current?.key}
                  onClick={() => { setCurrentKey(f.key); setCorrecting(false); }}
                />
              ))}
            </ul>
          </section>

          {!done ? (
            <ConfirmPanel
              workflow={workflow}
              progress={progress}
              busy={busy}
              confirming={confirming}
              rejecting={rejecting}
              rejectReason={rejectReason}
              onRejectReason={setRejectReason}
              onStartConfirm={() => setConfirming(true)}
              onCancelConfirm={() => setConfirming(false)}
              onConfirm={() => { setConfirming(false); void act(() => confirmAndSign(workflow.rateConId, ctx!)); }}
              onStartReject={() => setRejecting(true)}
              onCancelReject={() => setRejecting(false)}
              onReject={() => {
                setRejecting(false);
                void act(() => rejectRateConfirmation(workflow.rateConId, rejectReason, ctx!));
              }}
            />
          ) : (
            <OutcomePanel workflow={workflow} />
          )}

          <AuditPanel workflow={workflow} />
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function EmailStrip({ workflow }: { workflow: RateConWorkflow }) {
  const e = workflow.email;
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium text-fg">
            {e.fromName} &lt;{e.fromEmail}&gt;
            <Badge tone="warning">Sample email — no mailbox is connected</Badge>
          </p>
          <p className="mt-0.5 text-[0.8125rem] text-fg">{e.subject}</p>
          <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">{e.bodyPreview}</p>
        </div>
        <span className="text-[0.75rem] text-fg-subtle">{relativeTime(e.receivedAt)}</span>
      </div>
      <div className="mt-2 rounded-md border border-border bg-surface-sunken px-3 py-2">
        <p className="text-[0.75rem] font-medium text-fg">
          Matched to {workflow.loadReference}
          {" · "}
          <span className="font-normal text-fg-muted">
            {workflow.evidence.confidence === "certain" ? "certain" : workflow.evidence.confidence}
          </span>
        </p>
        <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
          Because {workflow.evidence.agreedOn.join(", ")}.
          {workflow.evidence.disagreedOn.length > 0
            ? ` Not everything lined up: ${workflow.evidence.disagreedOn.join(", ")}.`
            : ""}
        </p>
      </div>
    </section>
  );
}

function CurrentField({
  field, busy, correcting, draftValue, note,
  onStartCorrecting, onDraftValue, onNote, onCancel, onVerify, onCorrect,
}: {
  field: ExtractedField;
  busy: boolean;
  correcting: boolean;
  draftValue: string;
  note: string;
  onStartCorrecting: () => void;
  onDraftValue: (v: string) => void;
  onNote: (v: string) => void;
  onCancel: () => void;
  onVerify: () => void;
  onCorrect: () => void;
}) {
  return (
    <div className={cn(
      "mt-3 rounded-md border px-3.5 py-3",
      field.disagrees ? "border-st-warning/50 bg-st-warning-bg/40" : "border-primary/40 bg-surface-sunken",
    )}
    >
      <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium text-fg">
        {field.label}
        {field.required ? <Badge tone="outline">Must be checked</Badge> : null}
        {field.disagrees ? <Badge tone="warning">Does not match the booking</Badge> : null}
        <span className="text-[0.75rem] font-normal text-fg-subtle">
          read with {Math.round(field.confidence * 100)}% confidence
        </span>
      </p>

      <dl className="mt-2 grid gap-x-4 gap-y-1 text-[0.8125rem] sm:grid-cols-2">
        <div>
          <dt className="text-[0.75rem] text-fg-subtle">Their document says</dt>
          <dd className="font-medium text-fg">{field.rawText || "—"}</dd>
        </div>
        <div>
          <dt className="text-[0.75rem] text-fg-subtle">We booked</dt>
          <dd className={cn("font-medium", field.disagrees ? "text-st-warning" : "text-fg")}>
            {field.expected ?? "nothing to compare it with"}
          </dd>
        </div>
      </dl>

      {correcting ? (
        <div className="mt-2 space-y-2">
          <label className="block text-[0.75rem] font-medium text-fg">
            What should it say?
            <Input value={draftValue} onChange={(e) => onDraftValue(e.target.value)} className="mt-1 max-w-md" />
          </label>
          <label className="block text-[0.75rem] font-medium text-fg">
            Why (optional)
            <Input value={note} placeholder="Agreed $2,450 on the phone with Alan" onChange={(e) => onNote(e.target.value)} className="mt-1 max-w-md" />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="sm" disabled={busy || !draftValue.trim()} onClick={onCorrect}>
              Correct it
            </Button>
            <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          </div>
          <p className="text-[0.6875rem] leading-relaxed text-fg-subtle">
            Their document is never altered. The correction sits beside what they wrote, and both go
            on the signed copy.
          </p>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="primary" size="sm" disabled={busy} onClick={onVerify}>
            <Check className="size-3.5" aria-hidden />
            Theirs is right
          </Button>
          <Button variant="secondary" size="sm" disabled={busy} onClick={onStartCorrecting}>
            Correct it
          </Button>
        </div>
      )}
    </div>
  );
}

function FieldRow({
  field, current, onClick,
}: {
  field: ExtractedField;
  current: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded-md border px-3 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          current ? "border-primary/50 bg-surface-sunken" : "border-transparent hover:bg-surface-sunken",
        )}
      >
        <span className="flex min-w-0 items-center gap-2 text-[0.8125rem] text-fg">
          <StatusDot field={field} />
          {field.label}
          {field.required ? null : <span className="text-[0.6875rem] text-fg-subtle">optional</span>}
        </span>
        <span className="flex items-center gap-2 text-[0.75rem] text-fg-muted">
          <span className="max-w-[16rem] truncate">{field.value || "—"}</span>
          {field.status === "corrected" ? <Badge tone="info">Corrected</Badge> : null}
          {field.disagrees && field.status === "unreviewed" ? (
            <TriangleAlert className="size-3.5 text-st-warning" aria-label="does not match" />
          ) : null}
        </span>
      </button>
    </li>
  );
}

function StatusDot({ field }: { field: ExtractedField }) {
  if (field.status === "verified") {
    return <Check className="size-3.5 shrink-0 text-st-success" aria-label="checked" />;
  }
  if (field.status === "corrected") {
    return <ArrowRight className="size-3.5 shrink-0 text-primary" aria-label="corrected" />;
  }
  return <span aria-label="not checked" className="size-2 shrink-0 rounded-full border border-border" />;
}

/* -------------------------------------------------------------------------- */

function ConfirmPanel({
  workflow, progress, busy, confirming, rejecting, rejectReason,
  onRejectReason, onStartConfirm, onCancelConfirm, onConfirm,
  onStartReject, onCancelReject, onReject,
}: {
  workflow: RateConWorkflow;
  progress: ReturnType<typeof progressOf>;
  busy: boolean;
  confirming: boolean;
  rejecting: boolean;
  rejectReason: string;
  onRejectReason: (v: string) => void;
  onStartConfirm: () => void;
  onCancelConfirm: () => void;
  onConfirm: () => void;
  onStartReject: () => void;
  onCancelReject: () => void;
  onReject: () => void;
}) {
  const corrections = workflow.fields.filter((f) => f.status === "corrected");
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <h2 className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg">
        <ShieldCheck className="size-4 text-fg-subtle" aria-hidden />
        Signing it
      </h2>
      <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
        {workflow.carrierName}&apos;s signature goes on only when you confirm, and your name goes on
        the record beside it. Nothing else can apply it.
      </p>

      {!progress.canConfirm ? (
        <p className="mt-3 rounded-md border border-dashed border-border px-3.5 py-2.5 text-[0.8125rem] text-fg-muted">
          {progress.blockedReasons.join(" ")}
        </p>
      ) : confirming ? (
        <div className="mt-3 rounded-md border border-primary/40 px-3 py-2.5">
          <p className="text-[0.8125rem] font-medium text-fg">
            Sign {workflow.loadReference} as {workflow.carrierName}?
          </p>
          <ul className="mt-1.5 space-y-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
            <li>{progress.required} fields checked, {corrections.length} corrected.</li>
            {corrections.map((c) => (
              <li key={c.key}>
                {c.label}: their document says &quot;{c.rawText}&quot; — signing says &quot;{c.value}&quot;.
              </li>
            ))}
            <li>A separate signed copy is created. Their original is kept exactly as it arrived.</li>
            <li>The signed copy is recorded as returned to {workflow.brokerName}. Antcolos has no mailbox, so nothing leaves this machine.</li>
            <li>What it says goes to the load record, and everything else is listed as waiting.</li>
          </ul>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="primary" size="sm" disabled={busy} onClick={onConfirm}>
              <FileSignature className="size-3.5" aria-hidden />
              Confirm and sign
            </Button>
            <Button variant="ghost" size="sm" onClick={onCancelConfirm}>Not yet</Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" size="sm" disabled={busy} onClick={onStartConfirm}>
            Confirm and sign
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onStartReject}>
            Stop it
          </Button>
        </div>
      )}

      {rejecting ? (
        <div className="mt-2 rounded-md border border-border px-3 py-2.5">
          <label className="block text-[0.75rem] font-medium text-fg">
            Why are you stopping it?
            <Input
              value={rejectReason}
              placeholder="Rate is wrong and they will not fix it"
              onChange={(e) => onRejectReason(e.target.value)}
              className="mt-1 max-w-md"
            />
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="primary" size="sm" disabled={busy || !rejectReason.trim()} onClick={onReject}>
              Stop it
            </Button>
            <Button variant="ghost" size="sm" onClick={onCancelReject}>Cancel</Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function OutcomePanel({ workflow }: { workflow: RateConWorkflow }) {
  if (workflow.status === "rejected") {
    return (
      <section className="rounded-lg border border-st-danger/40 bg-surface p-4 shadow-e1">
        <h2 className="text-[0.875rem] font-semibold text-fg">Stopped</h2>
        <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">{workflow.rejectedReason}</p>
        <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-subtle">
          Their original is kept. Nothing was signed and nothing went back.
        </p>
      </section>
    );
  }

  const rows = workflow.distribution;
  const processed = rows.filter((d) => d.state === "processed");
  const pending = rows.filter((d) => d.state === "pending");
  const needsReview = rows.filter((d) => d.state === "needs_review");
  const failed = rows.filter((d) => d.state === "failed");
  const sig = workflow.signed?.signature;

  return (
    <section className="rounded-lg border border-st-success/40 bg-surface p-4 shadow-e1">
      <h2 className="text-[0.875rem] font-semibold text-fg">Signed and returned</h2>
      {sig ? (
        <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
          Signed as {sig.signedName} for {sig.carrierName}, authorised by {sig.authorisedByName}
          {" "}{relativeTime(sig.signedAt)}. {sig.statement}
        </p>
      ) : null}
      <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-subtle">
        This load was finalized once and one versioned event was published. Every row
        below is one module&rsquo;s own outcome from that event — read back, not predicted.
        A failure in one never stops the others.
      </p>

      {processed.length > 0 ? (
        <>
          <h3 className="mt-3 text-[0.8125rem] font-medium text-fg">Updated</h3>
          <ul className="mt-1 space-y-1">
            {processed.map((d) => (
              <li key={d.key} className="text-[0.75rem] leading-relaxed">
                <span className="inline-flex items-center gap-1.5 font-medium text-fg">
                  <Check className="size-3.5 text-st-success" aria-hidden />
                  {d.label}
                </span>
                <span className="block text-fg-muted">{d.detail}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {needsReview.length > 0 ? (
        <>
          <h3 className="mt-3 text-[0.8125rem] font-medium text-fg">Needs a person</h3>
          <p className="text-[0.75rem] leading-relaxed text-fg-muted">
            These could not be decided without somebody looking. Guessing is how
            duplicate records get made.
          </p>
          <ul className="mt-1 space-y-1">
            {needsReview.map((d) => <ProjectionRow key={d.key} row={d} />)}
          </ul>
        </>
      ) : null}

      {failed.length > 0 ? (
        <>
          <h3 className="mt-3 text-[0.8125rem] font-medium text-fg">Failed</h3>
          <ul className="mt-1 space-y-1">
            {failed.map((d) => <ProjectionRow key={d.key} row={d} />)}
          </ul>
        </>
      ) : null}

      {pending.length > 0 ? (
        <>
          <h3 className="mt-3 text-[0.8125rem] font-medium text-fg">Waiting</h3>
          <p className="text-[0.75rem] leading-relaxed text-fg-muted">
            The receiving module is not built on this branch. What it will be given
            is kept and named rather than dropped.
          </p>
          <ul className="mt-1 space-y-1">
            {pending.map((d) => <ProjectionRow key={d.key} row={d} />)}
          </ul>
        </>
      ) : null}
    </section>
  );
}

/** One projection outcome, with why it is in that state and whether a retry helps. */
function ProjectionRow({ row }: { row: DistributionOutcome }) {
  return (
    <li className="text-[0.75rem] leading-relaxed">
      <span className="flex flex-wrap items-center gap-2 font-medium text-fg">
        {row.label}
        <Badge tone={PROJECTION_TONE[row.state]}>{PROJECTION_STATE_LABEL[row.state]}</Badge>
        {row.mock ? <Badge tone="outline">Mock adapter</Badge> : null}
        {row.retryable ? <Badge tone="outline">Retry-ready</Badge> : null}
      </span>
      <span className="block text-fg-muted">{row.detail}</span>
      {row.reason ? <span className="block text-fg-subtle">{row.reason}</span> : null}
    </li>
  );
}

function AuditPanel({ workflow }: { workflow: RateConWorkflow }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <h2 className="text-[0.875rem] font-semibold text-fg">Everything that happened to it</h2>
      <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
        Append-only. Who did what, when, and what the document said before they did it.
      </p>
      <ol className="mt-2 space-y-1.5">
        {workflow.audit.map((entry) => (
          <li key={entry.id} className="text-[0.75rem] leading-relaxed">
            <span className="font-medium text-fg">{entry.actorName}</span>
            <span className="text-fg-subtle"> · {relativeTime(entry.at)}</span>
            <span className="block text-fg-muted">{entry.detail}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Enter, from anywhere on the screen.
 *
 * ★ WHY THIS IS NOT AN onKeyDown ON THE PAGE ★
 * It was, and it did nothing: a React key handler only fires for events inside
 * the element, and after a page load the focus is on the document body. A
 * dispatcher who opens a rate confirmation and presses Enter is not going to
 * click the page first, so the listener goes on the document.
 *
 * It stands aside wherever Enter already means something else — inside a text
 * box that is not the correction field, and on a focused button or link, where
 * the browser is about to press it.
 */
function EnterAdvances({ onEnter, active }: { onEnter: () => void; active: boolean }) {
  const latest = useRef(onEnter);
  useEffect(() => {
    latest.current = onEnter;
  });
  useEffect(() => {
    if (!active) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Enter" || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "TEXTAREA" || tag === "BUTTON" || tag === "A" || tag === "SELECT") return;
      if (tag === "INPUT" && el?.getAttribute("data-ratecon") === null) return;
      if (el?.isContentEditable) return;
      e.preventDefault();
      latest.current();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active]);
  return null;
}
