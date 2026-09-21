"use client";

import {
  ArrowRight, Handshake, Landmark, Radar, RefreshCw, Search, Unplug, UserRound,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CONNECTION_IS_PLANNED, CONNECTION_LABEL, SEARCH_STATUS_LABEL, SOURCE_LABEL,
  type MatchWithListing, type SearchSession,
} from "@/types";
import {
  closeSearch, pauseSearch, resumeSearch, searchAgain, startSearch, widenSearch,
  type SearchOutcome,
} from "@/lib/api/mock/search-session";
import type { MtLoopContext } from "@/lib/api/mock/mt-loop";
import { SendToDriverDialog } from "@/features/driver-review/send-to-driver-dialog";
import { FactoringChip } from "@/features/factoring/factoring-chip";
import { CheckWithFactoringDialog } from "@/features/factoring/check-with-factoring-dialog";
import { useAutomaticFactoringChecks } from "@/features/factoring/use-automatic-checks";
import { TalkToBrokerDialog } from "./talk-to-broker-dialog";
import { InfoTip, Metric } from "@/features/mt-loop/tip";
import { cn } from "@/lib/utils";

/**
 * Looking for a load for one truck.
 *
 * The panel's real job is not the button — it is the source list underneath it.
 * A dispatcher needs to be able to see at a glance that the load boards are not
 * wired up yet, because otherwise an empty result reads as "there is no
 * freight" rather than "nobody looked at the two places most of it is". Every
 * source says how it reaches Antcolos and whether that is built.
 */
export function SearchPanel({
  dispatchCycleId, session, top = [], ctx, onChanged,
}: {
  dispatchCycleId: string;
  session?: SearchSession;
  /**
   * The best few this search turned up.
   *
   * ★ WHY THE SEARCH STAGE SHOWS LOADS AT ALL ★
   * It lists SOURCES, which answers "did anybody look?" and not "what did they
   * find?". A dispatcher who has just watched a search finish wants the second
   * question, and making them scroll to the next stage to ring a broker about
   * the top result is a step that exists for no reason. Three rows, and the
   * full list with its working is still one stage down.
   */
  top?: MatchWithListing[];
  ctx: MtLoopContext | null;
  onChanged: () => void;
}) {
  const [talkTo, setTalkTo] = useState<MatchWithListing | null>(null);
  const [sendTo, setSendTo] = useState<string | null>(null);
  /**
   * The row whose fallback factoring workflow is open.
   *
   * ★ THE CHECK STARTS WHERE THE LOAD IS ★
   * A dispatcher who has just seen a load is the person who needs its factoring
   * answer, and sending them to a settings screen to get it is the step this
   * whole design exists to avoid. Same dialog as the Opportunity list, reading
   * the same canonical record.
   */
  const [checking, setChecking] = useState<MatchWithListing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [asking, setAsking] = useState<"pause" | "close" | null>(null);
  const [reason, setReason] = useState("");

  // The same background sweep the Opportunity list runs. Shared dedupe means
  // the two surfaces never ask the same factor about the same broker twice.
  useAutomaticFactoringChecks(top, ctx, onChanged);

  async function run(fn: () => Promise<SearchOutcome>, success: string) {
    if (!ctx) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const outcome = await fn().catch(() => null);
    setBusy(false);
    if (!outcome) setError("Something went wrong. Nothing was changed.");
    else if (outcome.status === "not_permitted") setError("You are not allowed to do that.");
    else if (outcome.status === "needs_reason") setError("That needs a reason.");
    else if (outcome.status === "no_cycle") setError("This truck has no open cycle to search for.");
    else if (outcome.status === "already_running") setMessage("A search is already running for this truck.");
    else setMessage(success);
    onChanged();
  }

  function submitReason() {
    const action = asking;
    const text = reason.trim();
    if (!action || !text || !session) return;
    setAsking(null);
    setReason("");
    if (action === "pause") void run(() => pauseSearch(session.searchSessionId, text, ctx!), "Paused.");
    else void run(() => closeSearch(session.searchSessionId, text, ctx!), "Search closed.");
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg">
            <Radar className="size-4 text-fg-subtle" aria-hidden />
            Load search
            <InfoTip text="Every connected source, what each one had, and what was already in the inbox. Two are not built yet and say so." />
            {session ? (
              <Badge tone={session.status === "running" ? "info" : session.status === "paused" ? "warning" : "neutral"}>
                {SEARCH_STATUS_LABEL[session.status]}
              </Badge>
            ) : null}
          </h2>

        </div>

        <div className="flex flex-wrap gap-2">
          {!session ? (
            <Button
              variant="primary"
              size="sm"
              disabled={busy || !ctx}
              onClick={() => void run(() => startSearch(dispatchCycleId, ctx!), "Searching.")}
            >
              <Search className="size-3.5" aria-hidden />
              Start searching
            </Button>
          ) : null}
          {session?.status === "running" ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => void run(() => searchAgain(session.searchSessionId, ctx!), "Looked again.")}
              >
                <RefreshCw className="size-3.5" aria-hidden />
                Look again
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setAsking("pause")}>
                Pause
              </Button>
            </>
          ) : null}
          {session?.status === "paused" ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => void run(() => resumeSearch(session.searchSessionId, ctx!), "Back on it.")}
            >
              Resume
            </Button>
          ) : null}
          {session && session.status !== "closed" ? (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setAsking("close")}>
              Close
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-md border border-st-danger/40 bg-st-danger-bg/60 px-3.5 py-2.5 text-[0.8125rem] text-fg">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="mt-3 rounded-md border border-st-success/40 bg-st-success-bg/60 px-3.5 py-2.5 text-[0.8125rem] text-fg">
          {message}
        </p>
      ) : null}

      {asking ? (
        <div className="mt-3 rounded-md border border-border bg-surface-sunken px-3 py-2.5">
          <label htmlFor={`search-reason-${dispatchCycleId}`} className="text-[0.75rem] font-medium text-fg">
            {asking === "pause" ? "Why are you pausing it?" : "Why are you closing it?"}
          </label>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input
              id={`search-reason-${dispatchCycleId}`}
              value={reason}
              placeholder={asking === "pause" ? "Waiting on the driver to confirm" : "Covered it by phone"}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitReason(); } }}
              className="max-w-sm"
            />
            <Button variant="primary" size="sm" disabled={busy || !reason.trim()} onClick={submitReason}>
              {asking === "pause" ? "Pause it" : "Close it"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setAsking(null); setReason(""); }}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {session ? (
        <>
          {session.pauseReason ? (
            <p className="mt-3 text-[0.8125rem] text-fg-muted">Paused: {session.pauseReason}</p>
          ) : null}

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            <Stat label="Looking out of" value={[session.criteria.originCity, session.criteria.originState].filter(Boolean).join(", ") || "—"} />
            <Stat label="Loads seen" value={String(session.counts.listingsSeen)} />
            <Stat label="Already had" value={String(session.counts.duplicatesFolded)} />
            <Stat label="Considered" value={String(session.counts.matchesCreated)} />
          </dl>

          {/*
            ★ THE CRITERIA AS FIGURES, NOT AS A SENTENCE ★
            It read "Looking for box truck, up to 150 miles empty, at $2.10/mi
            or better, and not into NY. These come from the truck and the
            carrier's own rules, not from a form." — thirty-one words to carry
            four numbers a dispatcher checks at a glance. Where they come from
            is worth saying once, in the tip, not on every read.
          */}
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Metric label="Equip" value={session.criteria.equipment.replace(/_/g, " ")} />
            <Metric label="Empty" value={`≤ ${session.criteria.maxDeadheadMiles} mi`} />
            <Metric label="Floor" value={`$${(session.criteria.minRatePerMileCents / 100).toFixed(2)}/mi`} />
            {session.criteria.refusedStates.length ? (
              <Metric label="Not into" value={session.criteria.refusedStates.join(", ")} tone="warn" />
            ) : null}
            {session.criteria.widened ? <Badge tone="info">widened</Badge> : null}
            <InfoTip text="Read off this truck and this carrier's own rules — the equipment it is rated for, the deadhead the carrier accepts and its rate floor. Nothing here was typed into a form." />
          </p>

          {session.status !== "closed" ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void run(
                  () => widenSearch(
                    session.searchSessionId,
                    { maxDeadheadMiles: session.criteria.maxDeadheadMiles + 50 },
                    ctx!,
                  ),
                  "Widened by 50 empty miles.",
                )}
              >
                Allow 50 more empty miles
              </Button>
            </div>
          ) : null}

          <h3 className="mt-4 text-[0.75rem] font-semibold text-fg">Where it looked</h3>
          <ul className="mt-2 space-y-1.5">
            {session.sources.map((s) => (
              <li
                key={s.id}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border px-3 py-2",
                  s.status === "not_connected"
                    ? "border-dashed border-border bg-surface"
                    : "border-border bg-surface-sunken",
                )}
              >
                <span className="flex min-w-0 flex-wrap items-center gap-2 text-[0.8125rem] text-fg">
                  {s.status === "not_connected" ? (
                    <Unplug className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
                  ) : null}
                  {s.sourceName}
                  <Badge tone="outline">{SOURCE_LABEL[s.source]}</Badge>
                  {CONNECTION_IS_PLANNED[s.connection] ? (
                    <Badge tone="warning">{CONNECTION_LABEL[s.connection]} — not built</Badge>
                  ) : null}
                </span>
                <span className="text-[0.75rem] text-fg-subtle">{s.note ?? "—"}</span>
              </li>
            ))}
          </ul>
          {/*
            ★ THE WARNING STAYS; THE ESSAY GOES ★
            A dispatcher must not read an empty result as "there is no freight"
            when the two places most of it lives were never searched. That is a
            COUNT and a colour, on the sources themselves — the forty words
            explaining browser extensions belong behind the tip.
          */}
          {session.sources.some((x) => x.status === "not_connected") ? (
            <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[0.6875rem] text-fg-muted">
              <Badge tone="warning">
                {session.sources.filter((x) => x.status === "not_connected").length} not searched
              </Badge>
              <InfoTip text="The load boards are read by a browser extension running in your own browser, and it is not built yet. Those rows searched nothing, and say so rather than quietly returning an empty list." />
            </p>
          ) : null}

          <h3 className="mt-4 text-[0.75rem] font-semibold text-fg">What happened</h3>
          <ol className="mt-2 space-y-1">
            {[...session.history].reverse().slice(0, 8).map((h) => (
              <li key={h.id} className="flex gap-2.5">
                <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-border-strong" />
                <span className="min-w-0 text-[0.75rem] leading-relaxed text-fg-muted">
                  {h.note ?? h.action.replace(/_/g, " ")}
                  <span className="text-fg-subtle">
                    {" · "}
                    {new Date(h.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                    {" · "}
                    {h.actorName}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="mt-3 flex items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-3.5 py-4 text-[0.8125rem] font-medium text-fg">
          Not running
          <InfoTip text="Starting one looks at every connected source and puts what it finds in the Opportunity Inbox, against this truck's cycle." />
        </p>
      )}

      {/* The best few, with the one action a finished search leads to. */}
      {top.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3">
          {top.slice(0, 3).map((row) => (
            <li
              key={row.match.matchId}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-surface-sunken px-2.5 py-1.5"
            >
              <span className="inline-flex min-w-0 items-center gap-1.5 text-[0.75rem] font-medium text-fg">
                {row.listing.origin.city}, {row.listing.origin.state}
                <ArrowRight className="size-3 shrink-0 text-fg-subtle" aria-hidden />
                {row.listing.destination.city}, {row.listing.destination.state}
              </span>
              {row.listing.offeredRateCents !== undefined ? (
                <Metric
                  label="Rate"
                  value={`$${(row.listing.offeredRateCents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                  tone="good"
                />
              ) : null}
              <Metric label="Empty" value={`${row.match.deadheadMiles} mi`} />
              <Metric label="Score" value={String(row.match.score.total)} />
              {row.factoring ? <FactoringChip status={row.factoring} /> : null}
              <span className="flex-1" />
              {row.factoring?.offersManualCheck ? (
                <Button
                  variant="secondary"
                  size="sm"
                  data-testid="check-with-factoring"
                  onClick={() => setChecking(row)}
                >
                  <Landmark className="size-3.5" aria-hidden />
                  Check with factoring
                </Button>
              ) : null}
              {/*
                ★ THE DRIVER IS ASKED FROM HERE TOO ★
                Northline's rule is driver-first, and the first moment a
                dispatcher has something to ask about is this list. Making them
                walk to the Opportunities stage to do it put a screen between
                the decision and the question — and the driver's answer is what
                the broker call is built on, so it belongs before it.
              */}
              <Button variant="secondary" size="sm" onClick={() => setSendTo(row.match.matchId)}>
                <UserRound className="size-3.5" aria-hidden />
                Driver
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setTalkTo(row)}>
                <Handshake className="size-3.5" aria-hidden />
                Broker
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {checking && ctx ? (
        <CheckWithFactoringDialog
          ctx={ctx}
          subject={{
            carrierOrganizationId: checking.match.carrierOrganizationId,
            brokerNameObserved: checking.listing.broker.name,
            brokerMcNumber: checking.listing.broker.mcNumber,
            proposedAmountCents: checking.listing.offeredRateCents,
            dispatchCycleId: checking.match.dispatchCycleId,
            listingId: checking.listing.listingId,
            laneLabel: `${checking.listing.origin.city}, ${checking.listing.origin.state} → ${checking.listing.destination.city}, ${checking.listing.destination.state}`,
          }}
          onClose={() => setChecking(null)}
          onRecorded={onChanged}
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

      {talkTo ? (
        <TalkToBrokerDialog
          row={talkTo}
          ctx={ctx}
          onClose={() => setTalkTo(null)}
          onChanged={onChanged}
        />
      ) : null}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.6875rem] font-medium tracking-wide text-fg-subtle uppercase">{label}</dt>
      <dd className="mt-0.5 text-[0.8125rem] font-medium text-fg">{value}</dd>
    </div>
  );
}
