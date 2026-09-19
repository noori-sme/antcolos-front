"use client";

import { Mail, Paperclip, Plus } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  CommunicationThread, MessageTemplateKey, OutreachMessage, ThreadSummary,
} from "@/types";
import { MESSAGE_STATUS_LABEL, SEND_METHOD_LABEL, TEMPLATE_LABEL } from "@/types";
import { relativeTime } from "@/lib/utils/format";
import type { MtLoopContext } from "@/lib/api/mock/mt-loop";
import type { CycleCommunications } from "@/lib/api/mock/communications";
import {
  approveMessage, cancelMessage, markMessageSent, prepareMessage,
} from "@/lib/api/mock/communications";
import { InfoTip } from "@/features/mt-loop/tip";
import { cn } from "@/lib/utils";

/**
 * Everything said to a broker about this truck, and the templates for saying
 * the next thing.
 *
 * The panel is honest about two different things at once, and they are easy to
 * confuse: what Antcolos prepares BY ITSELF, and what it can SEND. It prepares
 * three kinds of message on real triggers and says so on each template; it
 * sends nothing at all, ever, and says that at the top where it cannot be
 * missed. A dispatcher who believes delay notices go out automatically will not
 * send one, and that is a worse failure than any missing feature.
 */
export function CommunicationsPanel({
  dispatchCycleId, communications, ctx, onChanged,
}: {
  dispatchCycleId: string;
  communications: CycleCommunications;
  ctx: MtLoopContext | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [extras, setExtras] = useState<Record<string, string>>({});

  async function act(fn: () => Promise<{ status: string }>) {
    if (!ctx) return;
    setBusy(true);
    setError(null);
    const outcome = await fn().catch(() => null) as { status: string; missing?: string[]; reason?: string } | null;
    setBusy(false);
    if (!outcome) setError("Something went wrong. Nothing was changed.");
    else if (outcome.status === "not_permitted") setError("You are not allowed to do that.");
    else if (outcome.status === "blocked") setError(outcome.reason ?? "That cannot be done yet.");
    else if (outcome.status === "incomplete") {
      setError(`That message is not finished: ${(outcome.missing ?? []).join("; ")}.`);
    }
    onChanged();
  }

  const { threads, available, counts } = communications;

  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg">
            <Mail className="size-4 text-fg-subtle" aria-hidden />
            Messages
            <InfoTip text="Written as the carrier, under their MC. Antcolos never sends anything — you send it and mark it here." />
            {counts.waitingForYou > 0 ? (
              <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[0.6875rem] font-medium tabular-nums text-fg-muted">
                {counts.waitingForYou}
              </span>
            ) : null}
          </h2>
        </div>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => setPicking((v) => !v)}>
          <Plus className="size-3.5" aria-hidden />
          Write one
        </Button>
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-md border border-st-danger/40 bg-st-danger-bg/60 px-3.5 py-2.5 text-[0.8125rem] text-fg">
          {error}
        </p>
      ) : null}

      {picking ? (
        <TemplatePicker
          available={available}
          busy={busy}
          extras={extras}
          onExtra={(k, v) => setExtras((prev) => ({ ...prev, [k]: v }))}
          onPick={(key) => {
            setPicking(false);
            void act(() => prepareMessage(dispatchCycleId, key, ctx!, {
              extras: {
                currentLocation: extras.currentLocation || undefined,
                delayReason: extras.delayReason || undefined,
                detentionHours: extras.detentionHours ? Number(extras.detentionHours) : undefined,
                receiverName: extras.receiverName || undefined,
                shortOrDamaged: extras.shortOrDamaged || undefined,
              },
            }));
          }}
          onClose={() => setPicking(false)}
        />
      ) : null}

      {threads.length === 0 ? (
        <div className="mt-3 rounded-md border border-dashed border-border px-3.5 py-3 text-center">
          <p className="text-[0.8125rem] font-medium text-fg">Nothing written yet</p>
          <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
            Approving a prepared inquiry, or writing one from a template, starts the conversation
            here.
          </p>
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {threads.map((summary) => (
            <ThreadRow
              key={summary.thread.threadId}
              summary={summary}
              openId={openId}
              busy={busy}
              onOpen={setOpenId}
              onApprove={(id) => void act(() => approveMessage(id, ctx!))}
              onSent={(id) => void act(() => markMessageSent(id, ctx!))}
              onCancel={(id) => void act(() => cancelMessage(id, ctx!))}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function ThreadRow({
  summary, openId, busy, onOpen, onApprove, onSent, onCancel,
}: {
  summary: ThreadSummary;
  openId: string | null;
  busy: boolean;
  onOpen: (id: string | null) => void;
  onApprove: (messageId: string) => void;
  onSent: (messageId: string) => void;
  onCancel: (messageId: string) => void;
}) {
  const t: CommunicationThread = summary.thread;
  const live = t.messages.filter((m) => m.status !== "cancelled" && m.status !== "superseded");

  return (
    <li className="rounded-md border border-border bg-surface-sunken px-3.5 py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium text-fg">
            {t.brokerName}
            {summary.waitingForYou > 0 ? <Badge tone="warning">Waiting for you</Badge> : null}
            {t.loadReference ? <Badge tone="outline">{t.loadReference}</Badge> : null}
          </p>
          <p className="mt-0.5 text-[0.75rem] text-fg-muted">
            {t.lane} · as {t.carrierName} · {summary.sent} marked as sent
          </p>
        </div>
        <span className="text-[0.75rem] text-fg-subtle">{relativeTime(summary.lastActivityAt)}</span>
      </div>

      <ul className="mt-2 space-y-1.5">
        {live.map((m) => (
          <MessageRow
            key={m.messageId}
            message={m}
            open={openId === m.messageId}
            busy={busy}
            onOpen={() => onOpen(openId === m.messageId ? null : m.messageId)}
            onApprove={() => onApprove(m.messageId)}
            onSent={() => onSent(m.messageId)}
            onCancel={() => onCancel(m.messageId)}
          />
        ))}
      </ul>
    </li>
  );
}

function MessageRow({
  message, open, busy, onOpen, onApprove, onSent, onCancel,
}: {
  message: OutreachMessage;
  open: boolean;
  busy: boolean;
  onOpen: () => void;
  onApprove: () => void;
  onSent: () => void;
  onCancel: () => void;
}) {
  return (
    <li className={cn(
      "rounded-md border bg-surface px-3 py-2",
      message.status === "draft" ? "border-primary/30" : "border-border",
    )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span className="flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium text-fg">
            {TEMPLATE_LABEL[message.templateKey]}
            <Badge tone={
              message.status === "sent" ? "success"
                : message.status === "draft" ? "info" : "outline"
            }
            >
              {MESSAGE_STATUS_LABEL[message.status]}
            </Badge>
            {message.blockedReason ? <Badge tone="danger">Blocked</Badge> : null}
            {message.attachments.length > 0 ? (
              <span className="inline-flex items-center gap-1 text-[0.75rem] text-fg-muted">
                <Paperclip className="size-3" aria-hidden />
                {message.attachments.length}
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block truncate text-[0.75rem] text-fg-subtle">{message.subject}</span>
        </button>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          {message.status === "draft" ? (
            <>
              <Button variant="secondary" size="sm" disabled={busy} onClick={onApprove}>Approve</Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>Throw away</Button>
            </>
          ) : null}
          {message.status === "approved" ? (
            <Button variant="secondary" size="sm" disabled={busy} onClick={onSent}>I have sent it</Button>
          ) : null}
        </div>
      </div>

      {message.preparedBecause ? (
        <p className="mt-1 text-[0.75rem] leading-relaxed text-fg-muted">
          Prepared because: {message.preparedBecause}
        </p>
      ) : null}
      {message.blockedReason ? (
        <p className="mt-1 text-[0.75rem] leading-relaxed text-st-danger">{message.blockedReason}</p>
      ) : null}
      {message.missing.length > 0 ? (
        <p className="mt-1 text-[0.75rem] leading-relaxed text-st-warning">
          Not finished: {message.missing.join(", ")}.
        </p>
      ) : null}
      {message.sentAt && message.sendMethod ? (
        <p className="mt-1 text-[0.75rem] text-fg-muted">
          {SEND_METHOD_LABEL[message.sendMethod]} — {message.sentByName}, {relativeTime(message.sentAt)}.
          {" "}Antcolos has no mailbox; nothing left this machine.
        </p>
      ) : null}

      {open ? (
        <div className="mt-2 rounded-md border border-border bg-surface-sunken px-3 py-2.5">
          <dl className="grid gap-x-4 gap-y-0.5 text-[0.75rem] sm:grid-cols-[auto_minmax(0,1fr)]">
            <dt className="text-fg-subtle">From</dt>
            <dd className="text-fg">{message.fromName}{message.fromEmail ? ` <${message.fromEmail}>` : ""}</dd>
            <dt className="text-fg-subtle">To</dt>
            <dd className="text-fg">{message.toName ?? "—"}{message.toEmail ? ` <${message.toEmail}>` : ""}</dd>
            <dt className="text-fg-subtle">Subject</dt>
            <dd className="text-fg">{message.subject}</dd>
          </dl>
          {message.attachments.length > 0 ? (
            <ul className="mt-2 space-y-0.5">
              {message.attachments.map((a) => (
                <li key={a.documentId} className="flex items-center gap-1.5 text-[0.75rem] text-fg-muted">
                  <Paperclip className="size-3" aria-hidden />
                  {a.fileName} — {a.label}
                </li>
              ))}
            </ul>
          ) : null}
          <pre className="mt-2 whitespace-pre-wrap font-sans text-[0.8125rem] leading-relaxed text-fg">
            {message.body}
          </pre>
        </div>
      ) : null}
    </li>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Pick what to say.
 *
 * Every template is listed, including the ones that cannot be filled yet, with
 * the reason underneath. A template that is simply missing from the list reads
 * as "Antcolos cannot write that", which is a different and wrong statement.
 */
function TemplatePicker({
  available, busy, extras, onExtra, onPick, onClose,
}: {
  available: CycleCommunications["available"];
  busy: boolean;
  extras: Record<string, string>;
  onExtra: (key: string, value: string) => void;
  onPick: (key: MessageTemplateKey) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<MessageTemplateKey | null>(null);
  const chosen = available.find((t) => t.key === selected);
  const needsDelay = selected === "delay_or_detention";
  const needsWhere = selected === "in_transit_update" || selected === "delay_or_detention";
  const needsDelivery = selected === "delivery_update";

  return (
    <div className="mt-3 rounded-md border border-border bg-surface-sunken px-3.5 py-3">
      <p className="text-[0.8125rem] font-medium text-fg">What do you want to say?</p>
      <ul className="mt-2 space-y-1.5">
        {available.map((t) => (
          <li key={t.key}>
            <button
              type="button"
              onClick={() => setSelected(t.key)}
              className={cn(
                "w-full rounded-md border px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                selected === t.key ? "border-primary/50 bg-surface" : "border-border bg-surface",
              )}
            >
              <span className="flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium text-fg">
                {t.label}
                {t.autoDraftsWhen ? <Badge tone="outline">Prepared for you</Badge> : null}
                {t.missing.length > 0 ? <Badge tone="warning">Not ready</Badge> : null}
              </span>
              <span className="mt-0.5 block text-[0.75rem] leading-relaxed text-fg-muted">{t.purpose}</span>
              {t.autoDraftsWhen ? (
                <span className="mt-0.5 block text-[0.75rem] leading-relaxed text-fg-subtle">
                  Antcolos prepares this one: {t.autoDraftsWhen}
                </span>
              ) : (
                <span className="mt-0.5 block text-[0.75rem] leading-relaxed text-fg-subtle">
                  Nobody prepares this one for you. Pick it when you need it.
                </span>
              )}
              {t.missing.length > 0 ? (
                <span className="mt-0.5 block text-[0.75rem] leading-relaxed text-st-warning">
                  {t.missing.join("; ")}.
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>

      {chosen ? (
        <div className="mt-3 space-y-2">
          {needsWhere ? (
            <Field label="Where is the truck?" value={extras.currentLocation ?? ""} placeholder="I-80 near Toledo, OH" onChange={(v) => onExtra("currentLocation", v)} />
          ) : null}
          {needsDelay ? (
            <>
              <Field label="What happened?" value={extras.delayReason ?? ""} placeholder="Shipper loaded three hours late" onChange={(v) => onExtra("delayReason", v)} />
              <Field label="Hours sitting, if this is detention" value={extras.detentionHours ?? ""} placeholder="3" onChange={(v) => onExtra("detentionHours", v)} />
            </>
          ) : null}
          {needsDelivery ? (
            <>
              <Field label="Who took it?" value={extras.receiverName ?? ""} placeholder="Reyes Receiving, Dock 4" onChange={(v) => onExtra("receiverName", v)} />
              <Field label="Anything short or damaged?" value={extras.shortOrDamaged ?? ""} placeholder="Two cases crushed on the top tier" onChange={(v) => onExtra("shortOrDamaged", v)} />
            </>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="sm" disabled={busy} onClick={() => onPick(chosen.key)}>
              Write it
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          </div>
          <p className="text-[0.6875rem] leading-relaxed text-fg-subtle">
            It will be prepared as a draft for you to read. Nothing is sent from Antcolos.
          </p>
        </div>
      ) : (
        <Button variant="ghost" size="sm" className="mt-2" onClick={onClose}>Cancel</Button>
      )}
    </div>
  );
}

function Field({
  label, value, placeholder, onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-[0.75rem] font-medium text-fg">
      {label}
      <Input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 max-w-md"
      />
    </label>
  );
}
