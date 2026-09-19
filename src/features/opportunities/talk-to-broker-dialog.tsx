"use client";

import { Mail, Phone } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { LoadFactKey, MatchWithListing } from "@/types";
import { LOAD_FACT_LABEL } from "@/types";
import {
  approveMessage, markMessageSent, prepareMessage,
} from "@/lib/api/mock/communications";
import {
  negotiationForMatch, openNegotiation, recordBrokerRound, recordOurOffer,
} from "@/lib/api/mock/negotiation";
import {
  correctionsInForce, recordCorrection,
} from "@/lib/api/mock/listing-corrections";
import type { MtLoopContext } from "@/lib/api/mock/mt-loop";
import { InfoTip } from "@/features/mt-loop/tip";
import { cn } from "@/lib/utils";

/**
 * Getting hold of a broker about one load, by mail or by phone.
 *
 * ★ ONE CLICK, AND THE REVIEW STILL HAPPENS ★
 * Asking about a load used to be: prepare a draft, find it in a panel, read it,
 * approve it, then mark it sent — five steps and four screens for a message a
 * dispatcher sends thirty times a day. It is one button now, and the draft is
 * ON this dialog: the reading happens because the message is in front of them
 * when they press it, not because they were made to walk to it.
 *
 * Nothing about the record changed. The message is still prepared from the
 * carrier's own template under their MC, still approved by a named person, and
 * still recorded as sent by hand — because no mailbox is connected and it is
 * still a person who actually sends it.
 *
 * ★ THE CALL PANEL IS A CRIB SHEET WITH A KEYBOARD ★
 * A dispatcher on the phone needs the address, the weight and the appointment
 * in front of them, and needs somewhere to put the two numbers that come out
 * of the call before they forget them. Both offers save through the real
 * negotiation service, so a price agreed on the phone is the same record as
 * one agreed any other way — rounds, provenance and all.
 */
export function TalkToBrokerDialog({
  row, ctx, onClose, onChanged,
}: {
  row: MatchWithListing;
  ctx: MtLoopContext | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<"email" | "call">("email");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ours, setOurs] = useState("");
  const [theirs, setTheirs] = useState("");
  /** What the broker corrected on this call, before it is saved. */
  const [fixes, setFixes] = useState<Partial<Record<LoadFactKey, string>>>({});

  const { listing, match } = row;

  /*
   * The draft itself, prepared the moment the dialog opens.
   *
   * A dispatcher reading a message they are about to send needs the real one,
   * rendered from this carrier's identity — not a mock-up of one. Preparing on
   * open costs a read and removes a step.
   */
  const draft = useQuery({
    queryKey: ["broker-draft", match.dispatchCycleId, match.matchId, ctx?.membershipId],
    queryFn: async () => {
      const outcome = await prepareMessage(match.dispatchCycleId, "load_inquiry", ctx!, {
        // Named directly, so the draft can be read before anybody has opened a
        // conversation — looking at a message is not the same as sending one.
        aboutListingId: listing.listingId,
        preparedBecause: `Asking ${listing.broker.name} about ${listing.origin.city} → ${listing.destination.city}.`,
      });
      return outcome.status === "ok" ? outcome.message : null;
    },
    enabled: Boolean(ctx) && mode === "email",
  });

  /*
   * What has already been corrected on this load, for this cycle.
   *
   * Read rather than assumed: a correction made on an earlier call is in force
   * now, and a crib sheet that showed the board's figure again would have the
   * dispatcher read the wrong weight down the phone.
   */
  const corrections = useQuery({
    queryKey: ["listing-corrections", listing.listingId, match.dispatchCycleId, ctx?.membershipId],
    queryFn: async () => correctionsInForce(listing.listingId, match.dispatchCycleId, ctx!),
    enabled: Boolean(ctx),
  });
  const inForce = corrections.data ?? {};

  /** Prepare → approve → record, in one press, with the text on screen. */
  async function confirmAndSend() {
    const message = draft.data;
    if (!ctx || !message) return;
    setBusy(true);
    setError(null);
    const approved = await approveMessage(message.messageId, ctx).catch(() => null);
    if (approved?.status !== "ok") {
      setBusy(false);
      setError(
        approved?.status === "incomplete"
          ? "The draft is missing something it needs."
          : approved?.status === "blocked" ? approved.reason : "Nothing was sent.",
      );
      return;
    }
    const marked = await markMessageSent(message.messageId, ctx).catch(() => null);
    setBusy(false);
    if (marked?.status !== "ok") { setError("Approved, but not recorded as sent."); return; }
    // Asking about a load IS opening the conversation. Leaving the negotiation
    // unopened would put the reply nowhere when it comes back.
    if (!negotiationForMatch(match.matchId, ctx)) {
      await openNegotiation(match.matchId, ctx).catch(() => null);
    }
    setDone("Sent and logged");
    onChanged();
  }

  /**
   * Everything the call produced, saved in one press.
   *
   * ★ CORRECTIONS ARE NOT NOTES ★
   * A weight the broker fixed on the phone is recorded as a correction on the
   * load — beside the board's figure, never over it — and from that moment it
   * is what the driver is told and what the rate confirmation is checked
   * against. Typing it into a comment box would have left three other screens
   * still reading 40,000.
   */
  async function logCall() {
    if (!ctx) return;
    setBusy(true);
    setError(null);

    for (const [key, raw] of Object.entries(fixes) as [LoadFactKey, string][]) {
      if (!raw?.trim()) continue;
      const parsed = parseFix(key, raw);
      if (!parsed) continue;
      await recordCorrection({
        listingId: listing.listingId,
        dispatchCycleId: match.dispatchCycleId,
        key,
        listingValue: postedValue(key, row),
        correctedValue: parsed.display,
        numericValue: parsed.numeric,
        source: "broker_call",
        note: "Corrected by the broker on the phone.",
      }, ctx).catch(() => null);
    }

    const ourCents0 = dollarsToCents(ours);
    const theirCents0 = dollarsToCents(theirs);
    if (ourCents0 === undefined && theirCents0 === undefined) {
      setBusy(false);
      setDone("Saved");
      setFixes({});
      void corrections.refetch();
      onChanged();
      return;
    }

    let negotiation = negotiationForMatch(match.matchId, ctx);
    if (!negotiation) {
      const opened = await openNegotiation(match.matchId, ctx).catch(() => null);
      if (opened?.status !== "ok") {
        setBusy(false);
        setError("That conversation could not be opened.");
        return;
      }
      negotiation = opened.negotiation;
    }
    const ourCents = dollarsToCents(ours);
    const theirCents = dollarsToCents(theirs);
    if (ourCents !== undefined) {
      await recordOurOffer(negotiation.negotiationId, ourCents, ctx, "Said on the phone.").catch(() => null);
    }
    if (theirCents !== undefined) {
      await recordBrokerRound(negotiation.negotiationId, {
        kind: "counter",
        amountCents: theirCents,
        channel: "recorded_by_hand",
        note: "Said on the phone.",
      }, ctx).catch(() => null);
    }
    setBusy(false);
    setDone("Saved");
    setOurs("");
    setTheirs("");
    setFixes({});
    void corrections.refetch();
    onChanged();
  }

  const phone = listing.broker.phone;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        title={`${listing.broker.name} · ${listing.origin.city} → ${listing.destination.city}`}
        className="max-w-xl"
      >
        <div className="mt-3 flex gap-1.5">
          <ModeTab active={mode === "email"} onClick={() => setMode("email")} icon={Mail}>
            Email
          </ModeTab>
          <ModeTab active={mode === "call"} onClick={() => setMode("call")} icon={Phone}>
            Call
          </ModeTab>
        </div>

        {mode === "email" ? (
          draft.isPending ? (
            <p className="mt-3 text-[0.8125rem] text-fg-muted">Preparing it…</p>
          ) : !draft.data ? (
            <p className="mt-3 text-[0.8125rem] leading-relaxed text-fg-muted">
              No draft could be prepared for this load.
            </p>
          ) : (
            <>
              <p className="mt-3 flex flex-wrap items-baseline gap-x-2 text-[0.75rem]">
                <span className="text-fg-subtle">To</span>
                <span className="font-medium text-fg">
                  {listing.broker.contactName ?? listing.broker.name}
                  {listing.broker.email ? ` · ${listing.broker.email}` : ""}
                </span>
              </p>
              <p className="mt-0.5 text-[0.8125rem] font-medium text-fg">
                {draft.data.subject}
              </p>
              <pre className="mt-2 max-h-52 overflow-y-auto rounded-md border border-border bg-surface-sunken px-3 py-2.5 font-mono text-[0.75rem] leading-relaxed whitespace-pre-wrap text-fg">
                {draft.data.body}
              </pre>
              {draft.data.missing.length > 0 ? (
                <p className="mt-1.5 text-[0.75rem] text-st-warning">
                  Missing: {draft.data.missing.join(", ")}
                </p>
              ) : null}
            </>
          )
        ) : (
          <>
            {/*
              ★ THREE COLUMNS, AND THE MIDDLE ONE NEVER CHANGES ★
              What the board posted, and what the broker says on the phone. The
              posted figure stays on the screen after it has been corrected,
              because "the board said 40,000 and Dana said 30,000" is the thing
              a dispatcher has to be able to tell a driver, a receiver and a
              claims adjuster six weeks later.
            */}
            <div className="mt-3 overflow-hidden rounded-md border border-border">
              <div className="grid grid-cols-[auto_1fr_minmax(7.5rem,1fr)] items-center gap-x-3 border-b border-border bg-surface-sunken px-2.5 py-1 text-[0.5625rem] font-semibold tracking-wide text-fg-subtle uppercase">
                <span>Fact</span>
                <span>Posted</span>
                <span>Broker says</span>
              </div>
              {CRIB.map((line) => {
                const posted = line.key ? postedValue(line.key, row) : line.read?.(row);
                if (!posted && !line.key) return null;
                const fixed = line.key ? inForce[line.key] : undefined;
                return (
                  <div
                    key={line.label}
                    className="grid grid-cols-[auto_1fr_minmax(7.5rem,1fr)] items-center gap-x-3 border-b border-border/60 px-2.5 py-1 last:border-b-0"
                  >
                    <span className="w-16 text-[0.5625rem] tracking-wide text-fg-subtle uppercase">
                      {line.label}
                    </span>
                    <span className={cn(
                      "truncate text-[0.75rem] tabular-nums",
                      fixed ? "text-fg-subtle line-through" : "font-medium text-fg",
                    )}>
                      {posted ?? "—"}
                    </span>
                    {line.key ? (
                      <div className="flex items-center gap-1">
                        <Input
                          type={line.input}
                          value={fixes[line.key] ?? ""}
                          placeholder={fixed ? showFix(line.key, fixed.correctedValue) : "—"}
                          onChange={(e) => setFixes((f) => ({ ...f, [line.key!]: e.target.value }))}
                          className="h-7 px-1.5 text-[0.75rem]"
                        />
                        {fixed && !fixes[line.key] ? (
                          <Badge tone="info">fixed</Badge>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-[0.6875rem] text-fg-subtle">—</span>
                    )}
                  </div>
                );
              })}
            </div>

            {Object.keys(inForce).length > 0 ? (
              <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[0.6875rem] text-fg-muted">
                <Badge tone="info">{Object.keys(inForce).length} corrected</Badge>
                <span>in force downstream</span>
                <InfoTip text="A correction becomes what the driver is told and what the rate confirmation is checked against, from the moment it is saved. The board's own figure is kept beside it and is never overwritten." />
              </p>
            ) : null}

            {phone ? (
              <Button variant="secondary" size="sm" asChild className="mt-2">
                <a href={`tel:${phone.replace(/[^+\d]/g, "")}`}>
                  <Phone className="size-3.5" aria-hidden />
                  {phone}
                </a>
              </Button>
            ) : null}

            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-0.5">
                <span className="text-[0.625rem] tracking-wide text-fg-subtle uppercase">You asked</span>
                <Input
                  value={ours}
                  inputMode="decimal"
                  placeholder="$"
                  onChange={(e) => setOurs(e.target.value)}
                  className="w-28"
                />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-[0.625rem] tracking-wide text-fg-subtle uppercase">They said</span>
                <Input
                  value={theirs}
                  inputMode="decimal"
                  placeholder="$"
                  onChange={(e) => setTheirs(e.target.value)}
                  className="w-28"
                />
              </label>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy || (
                  !dollarsToCents(ours)
                  && !dollarsToCents(theirs)
                  && !Object.values(fixes).some((v) => v?.trim())
                )}
                onClick={logCall}
              >
                Save
              </Button>
            </div>
          </>
        )}

        {error ? <p role="alert" className="mt-2 text-[0.75rem] text-st-danger">{error}</p> : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {mode === "email" ? (
            done ? (
              <>
                <Badge tone="success">{done}</Badge>
                <span className="flex-1" />
                <Button variant="ghost" size="sm" onClick={onClose}>Done</Button>
              </>
            ) : (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy || !draft.data || draft.data.missing.length > 0}
                  onClick={confirmAndSend}
                >
                  Confirm &amp; send
                </Button>
                <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
              </>
            )
          ) : (
            <>
              {done ? <Badge tone="success">{done}</Badge> : null}
              <span className="flex-1" />
              <Button variant="ghost" size="sm" onClick={onClose}>Done</Button>
            </>
          )}
          {mode === "email" && !done ? (
            <>
              <span className="flex-1" />
              <span className="flex items-center gap-1 text-[0.6875rem] text-st-warning">
                Recorded, not emailed
                <InfoTip text="No mailbox is connected to Antcolos. One press prepares the message under the carrier's own identity, approves it in your name and records it as sent — the same record that will carry a real send when a mailbox exists. You still send it from your own mail." />
              </span>
            </>
          ) : null}
        </div>
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

/**
 * The crib sheet, in the order a broker call actually goes.
 *
 * A line with a `key` can be corrected on the call; one without cannot, and
 * says so with a dash rather than an empty box somebody would try to type in.
 */
interface CribLine {
  label: string;
  key?: LoadFactKey;
  input?: "text" | "number" | "datetime-local";
  /** For the lines that are not correctable and so have no fact key. */
  read?: (row: MatchWithListing) => string | undefined;
}

const CRIB: CribLine[] = [
  { label: "PU", read: (r) => `${r.listing.origin.city}, ${r.listing.origin.state}` },
  { label: LOAD_FACT_LABEL.pickup_at, key: "pickup_at", input: "datetime-local" },
  { label: "DEL", read: (r) => `${r.listing.destination.city}, ${r.listing.destination.state}` },
  { label: LOAD_FACT_LABEL.deliver_by, key: "deliver_by", input: "datetime-local" },
  { label: "Equip", read: (r) => r.listing.equipment.replace(/_/g, " ") },
  { label: LOAD_FACT_LABEL.weight_lbs, key: "weight_lbs", input: "number" },
  { label: LOAD_FACT_LABEL.commodity, key: "commodity", input: "text" },
  { label: LOAD_FACT_LABEL.loaded_miles, key: "loaded_miles", input: "number" },
  { label: "Empty", read: (r) => `${r.match.deadheadMiles} mi` },
  { label: LOAD_FACT_LABEL.rate_cents, key: "rate_cents", input: "text" },
  { label: "Their ref", read: (r) => r.listing.sourceReference },
  { label: "Unit", read: (r) => r.match.truckUnit },
];

/** A stored correction, in the form a person reads rather than the form it is kept in. */
function showFix(key: LoadFactKey, stored: string): string {
  if (key === "pickup_at" || key === "deliver_by") return when(stored) ?? stored;
  return stored;
}

/** What the load board published for one fact, formatted for reading aloud. */
function postedValue(key: LoadFactKey, row: MatchWithListing): string | undefined {
  const l = row.listing;
  switch (key) {
    case "pickup_at": return when(l.pickupAt);
    case "deliver_by": return when(l.deliverBy);
    case "weight_lbs": return l.weightLbs === undefined ? undefined : `${l.weightLbs.toLocaleString()} lb`;
    case "commodity": return l.commodity;
    case "loaded_miles": return `${l.loadedMiles.toLocaleString()} mi`;
    case "rate_cents": return money(l.offeredRateCents);
    default: return undefined;
  }
}

/**
 * What the dispatcher typed, turned into something downstream can use.
 *
 * A correction with no usable value is DROPPED rather than stored as text: a
 * weight of "about thirty" that the driver screen cannot read is not a
 * correction, and pretending it is would be worse than losing it.
 */
function parseFix(
  key: LoadFactKey,
  raw: string,
): { display: string; numeric?: number } | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  switch (key) {
    case "weight_lbs": {
      const n = Number(text.replace(/[^0-9.]/g, ""));
      if (!Number.isFinite(n) || n <= 0) return undefined;
      return { display: `${Math.round(n).toLocaleString()} lb`, numeric: Math.round(n) };
    }
    case "loaded_miles": {
      const n = Number(text.replace(/[^0-9.]/g, ""));
      if (!Number.isFinite(n) || n <= 0) return undefined;
      return { display: `${Math.round(n).toLocaleString()} mi`, numeric: Math.round(n) };
    }
    case "rate_cents": {
      const cents = dollarsToCents(text);
      if (cents === undefined) return undefined;
      return { display: money(cents)!, numeric: cents };
    }
    case "pickup_at":
    case "deliver_by": {
      const ms = Date.parse(text);
      if (!Number.isFinite(ms)) return undefined;
      // Stored as an instant, shown in the reader's own zone like every other
      // time in the product.
      return { display: new Date(ms).toISOString() };
    }
    case "commodity":
      return { display: text };
  }
}

const money = (c?: number) =>
  c === undefined ? undefined : `$${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const when = (iso?: string) =>
  iso === undefined ? undefined : new Date(iso).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });

/**
 * "2,450" or "$2450.00" to cents.
 *
 * Returns `undefined` for anything that is not a number, so an empty box and a
 * typo both mean "nothing was said" rather than an offer of zero dollars.
 */
function dollarsToCents(text: string): number | undefined {
  const n = Number(text.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : undefined;
}
