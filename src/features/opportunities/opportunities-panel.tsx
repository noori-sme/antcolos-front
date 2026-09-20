"use client";

import { Mail, Package } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { MatchWithListing, OutreachDraft } from "@/types";
import {
  DRAFT_STATUS_LABEL, DRIVER_REVIEW_STATUS_LABEL, UNARGUABLE_CHECKS,
} from "@/types";
import { dismissMatch, restoreMatch, shortlistMatch } from "@/lib/api/mock/opportunity-matching";
import { approveDraft, cancelDraft } from "@/lib/api/mock/outreach-drafts";
import type { MtLoopContext } from "@/lib/api/mock/mt-loop";
import { MatchCard } from "./match-card";
import { TalkToBrokerDialog } from "./talk-to-broker-dialog";
import { SendToDriverDialog } from "@/features/driver-review/send-to-driver-dialog";
import { InfoTip } from "@/features/mt-loop/tip";

/**
 * The opportunities for one truck: the best few, then everything else.
 *
 * The split is the point. A dispatcher can act on five loads; they cannot act
 * on thirty. But hiding the other twenty-five would be worse than useless —
 * that is where "this would work if you would allow 20 more empty miles" lives,
 * and a dispatcher who never sees it never widens the search.
 */
export function OpportunitiesPanel({
  top, rest, drafts, ctx, onChanged,
}: {
  top: MatchWithListing[];
  rest: MatchWithListing[];
  drafts: OutreachDraft[];
  ctx: MtLoopContext | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRest, setShowRest] = useState(false);
  const [openDraftId, setOpenDraftId] = useState<string | null>(null);
  /** Which dialog is open over the list, and on which row. */
  const [talkTo, setTalkTo] = useState<MatchWithListing | null>(null);
  const [sendTo, setSendTo] = useState<string | null>(null);

  async function act(fn: () => Promise<{ status: string }>) {
    if (!ctx) return;
    setBusy(true);
    setError(null);
    const outcome = await fn().catch(() => null);
    setBusy(false);
    if (!outcome) setError("Something went wrong. Nothing was changed.");
    else if (outcome.status === "not_permitted") setError("You are not allowed to do that.");
    else if (outcome.status === "needs_reason") setError("That needs a reason.");
    else if (outcome.status === "not_found") setError("That is no longer here.");
    else if (outcome.status === "no_driver") setError("There is no driver on this truck to send it to.");
    else if (outcome.status === "undeliverable") setError("The driver's side did not take it.");
    onChanged();
  }

  const openDraft = drafts.find((d) => d.draftId === openDraftId);

  /**
   * Whether this load can be argued about, and if not, why not.
   *
   * Asked of the service rather than guessed from the match's status, so the
   * button and the rule can never disagree: the same function decides both.
   */
  /**
   * What this row offers, read from the row.
   *
   * Everything here comes off the data the service already resolved. Asking a
   * module during render is what made this note go stale: the card's props had
   * not changed, so nothing re-rendered when the driver answered.
   */
  function ask(row: MatchWithListing) {
    if (!ctx) return {};
    const matchId = row.match.matchId;
    const driver = row.driver;
    const negotiable = row.match.status !== "closed_listing_gone"
      && row.match.status !== "booked"
      && row.listing.status === "open";

    const unarguable = row.match.checks.filter(
      (c) => c.outcome === "fail" && UNARGUABLE_CHECKS.includes(c.key),
    );
    if (unarguable.length > 0) {
      return { askBlockedBecause: `No conversation will fix this: ${unarguable.map((c) => c.detail).join(" ")}` };
    }

    /*
     * ★ BOTH ACTIONS OPEN SOMETHING, RATHER THAN DOING SOMETHING ★
     * "Send to driver" used to fire a send on the first click, with no sight
     * of what the driver would receive; "Ask for it" opened a negotiation with
     * nothing said in it. Each now opens the dialog that does the work, with
     * the load already loaded — and the permission rules that gated the old
     * buttons still gate these, unchanged.
     */
    const send = driver?.canSend && negotiable
      ? { onSendToDriver: () => setSendTo(matchId) }
      : {};
    const blockedByDriver = Boolean(driver && !driverClear(driver));

    return {
      ...send,
      onTalkToBroker: negotiable && !blockedByDriver ? () => setTalkTo(row) : undefined,
      /*
       * A label for the scan, the sentence for the tip. The note is often a
       * full sentence naming the carrier and its rule — true, and not
       * something to print on every row of a list of fourteen.
       */
      driverState: driver?.note
        ? {
          label: driver.status
            ? DRIVER_REVIEW_STATUS_LABEL[driver.status]
            : driver.reviewRequired ? "Driver first" : "Driver",
          detail: driver.note,
        }
        : undefined,
    };
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg">
            <Package className="size-4 text-fg-subtle" aria-hidden />
            Opportunities
            <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[0.6875rem] font-medium tabular-nums text-fg-muted">
              {top.length + rest.length}
            </span>
            <InfoTip text="The best few first. Everything else is below, each with the reason it is not up here." />
          </h2>

        </div>
        {drafts.filter((d) => d.status === "ready").length > 0 ? (
          <Badge tone="info">
            <Mail aria-hidden className="size-3" />
            {drafts.filter((d) => d.status === "ready").length} draft
            {drafts.filter((d) => d.status === "ready").length === 1 ? "" : "s"} to read
          </Badge>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-md border border-st-danger/40 bg-st-danger-bg/60 px-3.5 py-2.5 text-[0.8125rem] text-fg">
          {error}
        </p>
      ) : null}

      <div className="mt-3">
        {top.length === 0 && rest.length === 0 ? (
          <p className="flex items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-3.5 py-4 text-[0.8125rem] font-medium text-fg">
            Nothing found yet
            <InfoTip text="Start a search and whatever the connected sources have will appear here, checked against this truck." />
          </p>
        ) : (
          <>
            {top.length > 0 ? (
              <ul className="space-y-2">
                {top.map((row, i) => (
                  <MatchCard
                    key={row.match.matchId}
                    row={row}
                    rank={i + 1}
                    busy={busy}
                    onShortlist={() => void act(() => shortlistMatch(row.match.matchId, ctx!))}
                    onDismiss={(reason) => void act(() => dismissMatch(row.match.matchId, reason, ctx!))}
                    onRestore={() => void act(() => restoreMatch(row.match.matchId, ctx!))}
                    onOpenDraft={setOpenDraftId}
                    {...ask(row)}
                  />
                ))}
              </ul>
            ) : (
              <div className="rounded-md border border-dashed border-border px-3.5 py-4 text-center">
                <p className="text-[0.8125rem] font-medium text-fg">Nothing is eligible right now</p>
                <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
                  {rest.length} load{rest.length === 1 ? " was" : "s were"} considered and every one
                  of them failed something. Open the list below to see what.
                </p>
              </div>
            )}

            {rest.length > 0 ? (
              <div className="mt-3">
                <Button variant="ghost" size="sm" onClick={() => setShowRest((v) => !v)}>
                  {showRest
                    ? "Hide the rest"
                    : `Show the other ${rest.length} load${rest.length === 1 ? "" : "s"}`}
                </Button>
                {showRest ? (
                  <ul className="mt-2 space-y-2">
                    {rest.map((row) => (
                      <MatchCard
                        key={row.match.matchId}
                        row={row}
                        busy={busy}
                        onShortlist={() => void act(() => shortlistMatch(row.match.matchId, ctx!))}
                        onDismiss={(reason) => void act(() => dismissMatch(row.match.matchId, reason, ctx!))}
                        onRestore={() => void act(() => restoreMatch(row.match.matchId, ctx!))}
                        onOpenDraft={setOpenDraftId}
                        {...ask(row)}
                      />
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>

      {openDraft ? (
        <DraftReview
          draft={openDraft}
          busy={busy}
          onClose={() => setOpenDraftId(null)}
          onApprove={() => void act(() => approveDraft(openDraft.draftId, ctx!))}
          onCancel={() => void act(() => cancelDraft(openDraft.draftId, ctx!))}
        />
      ) : null}

      {talkTo ? (
        <TalkToBrokerDialog
          row={talkTo}
          ctx={ctx}
          onClose={() => setTalkTo(null)}
          onChanged={onChanged}
        />
      ) : null}
      {sendTo ? (
        <SendToDriverDialog
          matchId={sendTo}
          ctx={ctx}
          onClose={() => setSendTo(null)}
          onChanged={onChanged}
        />
      ) : null}
    </section>
  );
}

/**
 * Whether the driver's side is out of the way.
 *
 * Mirrors the service's own gate rather than second-guessing it: waiting,
 * paused and declined hold a negotiation up; approved, countered and nothing
 * sent at all do not.
 */
export function driverClear(driver: { status?: string; reviewRequired: boolean; hasDriver: boolean }): boolean {
  if (driver.status === "waiting" || driver.status === "paused" || driver.status === "declined") {
    return false;
  }
  if (driver.status) return true;
  return !driver.reviewRequired || !driver.hasDriver;
}

/* -------------------------------------------------------------------------- */

/**
 * The prepared message, for a person to read before anything happens to it.
 *
 * The notice at the bottom is not boilerplate. A screen that shows a finished
 * email with an Approve button on it looks exactly like a screen that sends
 * email, and the difference matters enormously to somebody deciding whether to
 * press it.
 */
export function DraftReview({
  draft, busy, onClose, onApprove, onCancel,
}: {
  draft: OutreachDraft;
  busy: boolean;
  onClose: () => void;
  onApprove: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-4 rounded-md border border-border bg-surface-sunken p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-[0.8125rem] font-semibold text-fg">
            <Mail className="size-3.5 text-fg-subtle" aria-hidden />
            Prepared message
            <Badge tone={draft.status === "ready" ? "info" : draft.status === "approved" ? "success" : "neutral"}>
              {DRAFT_STATUS_LABEL[draft.status]}
            </Badge>
          </h3>
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[0.75rem] text-fg-subtle">
            <span>From {draft.fromName} &lt;{draft.fromEmail ?? "no address on file"}&gt;</span>
            <span>To {draft.toName ?? "the broker"} &lt;{draft.toEmail ?? "no address"}&gt;</span>
          </p>
          <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
            Covers {draft.truckUnits.length === 1 ? "unit" : "units"}{" "}
            {draft.truckUnits.join(", ")} — one message for {draft.carrierName}, however many of
            their trucks suit it.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>

      {draft.blockedReason ? (
        <p className="mt-3 rounded-md border border-st-danger/40 bg-st-danger-bg/50 px-3 py-2 text-[0.75rem] leading-relaxed text-fg">
          {draft.blockedReason}
        </p>
      ) : null}
      {draft.supersededReason ? (
        <p className="mt-3 rounded-md border border-border bg-surface px-3 py-2 text-[0.75rem] leading-relaxed text-fg-muted">
          {draft.supersededReason}
        </p>
      ) : null}

      <p className="mt-3 text-[0.8125rem] font-medium text-fg">{draft.subject}</p>
      <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-border bg-surface px-3 py-2.5 text-[0.75rem] leading-relaxed whitespace-pre-wrap text-fg">
        {draft.body}
      </pre>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {draft.status === "ready" ? (
          <>
            <Button
              variant="primary"
              size="sm"
              disabled={busy || Boolean(draft.blockedReason)}
              onClick={onApprove}
            >
              Approve it
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
              Throw it away
            </Button>
          </>
        ) : null}
        {draft.reviewedByName ? (
          <span className="text-[0.75rem] text-fg-subtle">
            Read by {draft.reviewedByName}
            {draft.reviewedAt
              ? ` on ${new Date(draft.reviewedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
              : ""}
          </span>
        ) : null}
      </div>

      <p className="mt-3 text-[0.75rem] leading-relaxed text-fg-subtle">
        <strong className="font-medium text-fg-muted">Nothing is sent from here.</strong> Approving
        records that you have read it and that it may go; actually sending is the outreach milestone
        and is not built. No mail has been delivered and no broker has been contacted.
      </p>
    </div>
  );
}
