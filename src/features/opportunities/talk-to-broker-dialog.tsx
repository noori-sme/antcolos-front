"use client";

import { Mail, Phone } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { MatchWithListing } from "@/types";
import {
  approveMessage, markMessageSent, prepareMessage,
} from "@/lib/api/mock/communications";
import {
  negotiationForMatch, openNegotiation, recordBrokerRound, recordOurOffer,
} from "@/lib/api/mock/negotiation";
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

  /** Whatever was typed, straight onto the conversation. */
  async function logOffers() {
    if (!ctx) return;
    setBusy(true);
    setError(null);
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
    setDone("Saved to the conversation");
    setOurs("");
    setTheirs("");
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
            {/* The crib sheet: what gets asked on every call, in reading order. */}
            <div className="mt-3 grid gap-x-4 gap-y-1 sm:grid-cols-2">
              <Fact k="PU" v={`${listing.origin.city}, ${listing.origin.state}`} />
              <Fact k="PU at" v={when(listing.pickupAt)} />
              <Fact k="DEL" v={`${listing.destination.city}, ${listing.destination.state}`} />
              <Fact k="DEL by" v={when(listing.deliverBy)} />
              <Fact k="Equip" v={listing.equipment.replace(/_/g, " ")} />
              <Fact k="Weight" v={listing.weightLbs === undefined ? undefined : `${listing.weightLbs.toLocaleString()} lb`} />
              <Fact k="Commodity" v={listing.commodity} />
              <Fact k="Loaded" v={`${listing.loadedMiles.toLocaleString()} mi`} />
              <Fact k="Empty" v={`${match.deadheadMiles} mi`} />
              <Fact k="Posted" v={money(listing.offeredRateCents)} />
              <Fact k="Their ref" v={listing.sourceReference} />
              <Fact k="Unit" v={match.truckUnit} />
            </div>

            {phone ? (
              <Button variant="secondary" size="sm" asChild className="mt-2">
                <a href={`tel:${phone.replace(/[^+\d]/g, "")}`}>
                  <Phone className="size-3.5" aria-hidden />
                  {phone}
                </a>
              </Button>
            ) : null}

            {/*
              Two numbers, saved the moment the call ends. A dispatcher who has
              to leave this dialog to write down what was said will write it
              down on paper, and the conversation record will be a fiction.
            */}
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
                disabled={busy || (!dollarsToCents(ours) && !dollarsToCents(theirs))}
                onClick={logOffers}
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

function Fact({ k, v }: { k: string; v?: string }) {
  if (!v) return null;
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-border/60 py-0.5">
      <span className="text-[0.625rem] tracking-wide text-fg-subtle uppercase">{k}</span>
      <span className="text-[0.75rem] font-medium tabular-nums text-fg">{v}</span>
    </div>
  );
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
