"use client";

import { MessageSquare, Phone } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { VISIBILITY_FIELD_LABEL } from "@/types";
import type { DriverVisibilityField } from "@/types";
import {
  previewForDriver, recordDriverDecision, sendOpportunityToDriver,
} from "@/lib/api/mock/driver-review";
import type { DriverSendPreview } from "@/lib/api/mock/driver-review";
import type { MtLoopContext } from "@/lib/api/mock/mt-loop";
import { InfoTip } from "@/features/mt-loop/tip";
import { cn } from "@/lib/utils";

/**
 * Putting a load in front of a driver, by text or by phone.
 *
 * ★ TWO CHANNELS, ONE REDACTION ★
 * Whichever is used, the driver's version of the load is the same one: the
 * carrier's visibility policy applied, then narrowed again by what the SENDER
 * may see. `previewForDriver` builds it with the same function the send uses,
 * so what this dialog shows is what travels — a preview assembled separately
 * would eventually show a rate the send withholds, or worse, the reverse.
 *
 * The difference between the two is who reads it out. A text is the redacted
 * payload, verbatim, in the box. A call is the dispatcher reading it aloud, so
 * that panel carries the driver's version AND the facts only the dispatcher
 * may know, kept visibly apart — because the one thing a dispatcher must not
 * do on that call is read out the line the policy removed.
 *
 * ★ NOTHING LEAVES ANTCOLOS ★
 * No SMS gateway and no driver app are connected. Both buttons record the send
 * against the cycle exactly as they will when one is, and both say so. A
 * "Sent!" that had gone nowhere would be the one lie this module cannot
 * afford: the whole point of asking a driver is that somebody is waiting on
 * an answer.
 */
export function SendToDriverDialog({
  matchId, ctx, onClose, onChanged,
}: {
  matchId: string;
  ctx: MtLoopContext | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<"sms" | "phone">("sms");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["driver-send-preview", matchId, ctx?.membershipId],
    queryFn: async () => previewForDriver(matchId, ctx!) ?? null,
    enabled: Boolean(ctx),
  });
  const p = q.data ?? undefined;

  async function send(channel: "sms" | "phone") {
    if (!ctx) return;
    setBusy(true);
    setError(null);
    const outcome = await sendOpportunityToDriver(matchId, ctx, note, channel).catch(() => null);
    setBusy(false);
    if (!outcome || outcome.status !== "ok") {
      setError(
        outcome?.status === "no_driver" ? "There is no driver on this truck."
          : outcome?.status === "already_sent" ? "This load is already with the driver."
            : "Nothing was sent.",
      );
      return;
    }
    setSent(outcome.review.reviewId);
    onChanged();
  }

  async function answer(reviewId: string, kind: "approved" | "declined") {
    if (!ctx) return;
    setBusy(true);
    await recordDriverDecision(reviewId, kind, ctx, {
      comment: kind === "declined" ? "Declined on the phone." : undefined,
    }).catch(() => null);
    setBusy(false);
    onChanged();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        title={p ? `${p.driverName} · unit ${p.truckUnit}` : "Send to driver"}
        className="max-w-xl"
      >
        {q.isPending ? (
          <p className="mt-3 text-[0.8125rem] text-fg-muted">Reading the policy…</p>
        ) : !p ? (
          <p className="mt-3 text-[0.8125rem] leading-relaxed text-fg-muted">
            No driver on this truck, or this load is not readable from here.
          </p>
        ) : (
          <>
            <div className="mt-3 flex gap-1.5">
              <ModeTab active={mode === "sms"} onClick={() => setMode("sms")} icon={MessageSquare}>
                Text
              </ModeTab>
              <ModeTab active={mode === "phone"} onClick={() => setMode("phone")} icon={Phone}>
                Call
              </ModeTab>
            </div>

            {mode === "sms" ? (
              <>
                {/* Verbatim: this is the message, not a description of it. */}
                <pre className="mt-3 max-h-56 overflow-y-auto rounded-md border border-border bg-surface-sunken px-3 py-2.5 font-mono text-[0.75rem] leading-relaxed whitespace-pre-wrap text-fg">
                  {smsFor(p, note)}
                </pre>
                <Withheld preview={p} />
                <Input
                  value={note}
                  placeholder="Add a line (optional)"
                  onChange={(e) => setNote(e.target.value)}
                  className="mt-2"
                />
              </>
            ) : (
              <>
                {/*
                  ★ THE TWO COLUMNS ARE NOT DECORATION ★
                  Left is what the driver may be told. Right is what only the
                  dispatcher may know. On a phone call the policy has no way of
                  enforcing itself, so the screen draws the line instead.
                */}
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <FactList
                    title="Read this out"
                    tone="ok"
                    rows={driverRows(p)}
                  />
                  <FactList
                    title="Yours only"
                    tone="warn"
                    tip="The carrier's policy removes these from anything sent to this driver. Saying them on the phone puts them back."
                    rows={withheldRows(p)}
                  />
                </div>
                {p.driverPhone ? (
                  <Button variant="secondary" size="sm" asChild className="mt-2">
                    <a href={`tel:${p.driverPhone.replace(/[^+\d]/g, "")}`}>
                      <Phone className="size-3.5" aria-hidden />
                      {p.driverPhone}
                    </a>
                  </Button>
                ) : (
                  <p className="mt-2 text-[0.75rem] text-st-warning">No phone number on file.</p>
                )}
              </>
            )}

            {error ? (
              <p role="alert" className="mt-2 text-[0.75rem] text-st-danger">{error}</p>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {sent ? (
                mode === "phone" ? (
                  <>
                    {/*
                      A call has no inbox to wait on: the answer happens while
                      the dispatcher is still holding the phone, so it is
                      recorded here rather than left waiting for a reply that
                      has already been given out loud.
                    */}
                    <span className="text-[0.75rem] font-medium text-fg">What did they say?</span>
                    <Button variant="primary" size="sm" disabled={busy} onClick={() => answer(sent, "approved")}>
                      Accepted
                    </Button>
                    <Button variant="secondary" size="sm" disabled={busy} onClick={() => answer(sent, "declined")}>
                      Declined
                    </Button>
                  </>
                ) : (
                  <>
                    <Badge tone="success">Recorded</Badge>
                    <span className="text-[0.75rem] text-fg-muted">
                      Waiting on {p.driverName}
                    </span>
                    <span className="flex-1" />
                    <Button variant="ghost" size="sm" onClick={onClose}>Done</Button>
                  </>
                )
              ) : (
                <>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={busy}
                    onClick={() => send(mode)}
                  >
                    {mode === "sms" ? "Send text" : "Log the call"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
                  <span className="flex-1" />
                  <span className="flex items-center gap-1 text-[0.6875rem] text-st-warning">
                    Not delivered
                    <InfoTip text="No SMS gateway and no driver app are connected to Antcolos. This records the send against the cycle exactly as it will when one is, and the driver's answer is recorded by a dispatcher." />
                  </span>
                </>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

function ModeTab({
  active, onClick, icon: Icon, children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Phone;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[0.75rem] font-medium",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-surface text-fg-muted hover:text-fg",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {children}
    </button>
  );
}

function FactList({
  title, rows, tone, tip,
}: {
  title: string;
  rows: Array<[string, string]>;
  tone: "ok" | "warn";
  tip?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2",
        tone === "warn" ? "border-st-warning/45 bg-st-warning-bg/25" : "border-border bg-surface-sunken",
      )}
    >
      <p className="flex items-center gap-1 text-[0.625rem] font-semibold tracking-wide uppercase">
        <span className={tone === "warn" ? "text-st-warning" : "text-fg-subtle"}>{title}</span>
        {tip ? <InfoTip text={tip} /> : null}
      </p>
      {rows.length === 0 ? (
        <p className="mt-1 text-[0.75rem] text-fg-subtle">Nothing</p>
      ) : (
        <dl className="mt-1 space-y-0.5">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-2">
              <dt className="text-[0.625rem] tracking-wide text-fg-subtle uppercase">{k}</dt>
              <dd className="text-[0.75rem] font-medium tabular-nums text-fg">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** The fields the policy removed, named so nobody reads one out by accident. */
function Withheld({ preview }: { preview: DriverSendPreview }) {
  if (preview.visibility.withheld.length === 0) return null;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[0.6875rem] text-fg-subtle">
      <span className="font-medium text-st-warning">
        {preview.visibility.withheld.length} withheld
      </span>
      {preview.visibility.withheld.map((w) => (
        <span
          key={w.field}
          title={w.because}
          className="cursor-help rounded-sm border border-border px-1.5 py-0.5"
        >
          {VISIBILITY_FIELD_LABEL[w.field]}
        </span>
      ))}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

const money = (c?: number) => (c === undefined ? undefined : `$${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
const when = (iso?: string) => (iso === undefined
  ? undefined
  : new Date(iso).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }));

/**
 * The text, built from the REDACTED facts and nothing else.
 *
 * Short lines and no prose: it is read on a phone, often at a dock. Every line
 * is a label and a value, and a field the policy removed simply has no line —
 * never an empty one, which would tell the driver a number exists that they
 * are not allowed to see.
 */
export function smsFor(p: DriverSendPreview, note?: string): string {
  const f = p.facts;
  const lines = [
    `${p.carrierName} · unit ${p.truckUnit}`,
    `PU  ${f.originCity}, ${f.originState}${when(f.pickupAt) ? ` — ${when(f.pickupAt)}` : ""}`,
    `DEL ${f.destinationCity}, ${f.destinationState}${when(f.deliverBy) ? ` — ${when(f.deliverBy)}` : ""}`,
  ];
  const kv: Array<[string, string | undefined]> = [
    ["Equip", f.equipmentLabel],
    ["Miles", f.loadedMiles === undefined ? undefined : `${f.loadedMiles.toLocaleString()} loaded${f.deadheadMiles === undefined ? "" : ` · ${f.deadheadMiles} empty`}`],
    ["Load", [f.commodity, f.weightLbs === undefined ? undefined : `${f.weightLbs.toLocaleString()} lb`].filter(Boolean).join(" · ") || undefined],
    ["Rate", money(f.totalRateCents) === undefined ? undefined : `${money(f.totalRateCents)}${f.ratePerMileCents === undefined ? "" : ` · $${(f.ratePerMileCents / 100).toFixed(2)}/mi`}`],
    ["You", money(f.driverPayEstimateCents) === undefined ? undefined : `${money(f.driverPayEstimateCents)} est.`],
    ["Broker", f.brokerName],
  ];
  for (const [k, v] of kv) if (v) lines.push(`${k.padEnd(3)} ${v}`);
  if (note?.trim()) lines.push("", note.trim());
  lines.push("", "Reply YES or NO.");
  return lines.join("\n");
}

function driverRows(p: DriverSendPreview): Array<[string, string]> {
  const f = p.facts;
  const rows: Array<[string, string | undefined]> = [
    ["PU", `${f.originCity}, ${f.originState}`],
    ["PU at", when(f.pickupAt)],
    ["DEL", `${f.destinationCity}, ${f.destinationState}`],
    ["DEL by", when(f.deliverBy)],
    ["Equip", f.equipmentLabel],
    ["Loaded", f.loadedMiles === undefined ? undefined : `${f.loadedMiles.toLocaleString()} mi`],
    ["Empty", f.deadheadMiles === undefined ? undefined : `${f.deadheadMiles} mi`],
    ["Weight", f.weightLbs === undefined ? undefined : `${f.weightLbs.toLocaleString()} lb`],
    ["Rate", money(f.totalRateCents)],
    ["Their pay", money(f.driverPayEstimateCents)],
  ];
  return rows.filter((r): r is [string, string] => r[1] !== undefined);
}

/**
 * What the dispatcher knows and the driver may not be told.
 *
 * ★ DRIVEN BY THE POLICY, NOT BY A HAND-WRITTEN LIST ★
 * Every field the policy withheld gets a row, in the order the policy named
 * them. A field with a number shows it. A field the policy governs but that is
 * not a figure we hold — the carrier's margin is the one that matters — shows a
 * dash. The earlier version only knew how to draw fields that had values, so a
 * driver whose ONLY withheld field was the margin saw "Nothing" on the call
 * sheet while the text tab said "1 withheld" two clicks away.
 */
function withheldRows(p: DriverSendPreview): Array<[string, string]> {
  const f = p.full;
  const value = (field: DriverVisibilityField): string | undefined => {
    switch (field) {
      case "total_rate": return money(f.totalRateCents);
      case "rate_per_mile":
        return f.ratePerMileCents === undefined
          ? undefined : `$${(f.ratePerMileCents / 100).toFixed(2)}/mi`;
      case "estimated_profit": return money(f.estimatedProfitCents);
      case "driver_pay_estimate": return money(f.driverPayEstimateCents);
      case "broker_name": return f.brokerName;
      case "broker_contact": return f.brokerContact;
      case "loaded_miles":
        return f.loadedMiles === undefined ? undefined : `${f.loadedMiles} mi`;
      case "deadhead_miles":
        return f.deadheadMiles === undefined ? undefined : `${f.deadheadMiles} mi`;
      case "commodity_and_weight":
        return [f.commodity, f.weightLbs === undefined
          ? undefined : `${f.weightLbs.toLocaleString()} lb`].filter(Boolean).join(" · ") || undefined;
      case "pickup_window": return f.pickupAt === undefined ? undefined : when(f.pickupAt);
      case "accessorial_terms": return f.accessorialTerms;
      // No figure is held for this one. It is a policy line, not a fact.
      case "carrier_margin": return undefined;
    }
  };
  return p.visibility.withheld.map((w) => [
    SHORT_FIELD_LABEL[w.field],
    value(w.field) ?? "\u2014",
  ]);
}

/** The long policy labels do not fit a two-column call sheet. */
const SHORT_FIELD_LABEL: Record<DriverVisibilityField, string> = {
  total_rate: "Rate",
  rate_per_mile: "Per mi",
  estimated_profit: "Est. left",
  carrier_margin: "Margin",
  driver_pay_estimate: "Their pay",
  broker_name: "Broker",
  broker_contact: "Contact",
  deadhead_miles: "Empty",
  loaded_miles: "Loaded",
  pickup_window: "Times",
  commodity_and_weight: "Load",
  accessorial_terms: "Accessorials",
};
