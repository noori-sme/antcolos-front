"use client";

import { Radar, RefreshCw, Search, Unplug } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CONNECTION_IS_PLANNED, CONNECTION_LABEL, SEARCH_STATUS_LABEL, SOURCE_LABEL,
  type SearchSession,
} from "@/types";
import {
  closeSearch, pauseSearch, resumeSearch, searchAgain, startSearch, widenSearch,
  type SearchOutcome,
} from "@/lib/api/mock/search-session";
import type { MtLoopContext } from "@/lib/api/mock/mt-loop";
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
  dispatchCycleId, session, ctx, onChanged,
}: {
  dispatchCycleId: string;
  session?: SearchSession;
  ctx: MtLoopContext | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [asking, setAsking] = useState<"pause" | "close" | null>(null);
  const [reason, setReason] = useState("");

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
            {session ? (
              <Badge tone={session.status === "running" ? "info" : session.status === "paused" ? "warning" : "neutral"}>
                {SEARCH_STATUS_LABEL[session.status]}
              </Badge>
            ) : null}
          </h2>
          <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
            {session
              ? "Every source that was searched for this truck, and what each one had."
              : "Nothing is looking for a load for this truck yet."}
          </p>
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

          <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-subtle">
            Looking for {session.criteria.equipment.replace(/_/g, " ")}, up to{" "}
            {session.criteria.maxDeadheadMiles} miles empty, at $
            {(session.criteria.minRatePerMileCents / 100).toFixed(2)}/mi or better
            {session.criteria.refusedStates.length
              ? `, and not into ${session.criteria.refusedStates.join(", ")}`
              : ""}
            . These come from the truck and the carrier&rsquo;s own rules, not from a form.
            {session.criteria.widened ? " You have widened this search." : ""}
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
          <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-subtle">
            The load boards will be read by a browser extension running in your own browser. It is
            not built yet, so those two rows searched nothing — which is why they say so instead of
            quietly returning an empty list.
          </p>

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
        <div className="mt-3 rounded-md border border-dashed border-border px-3.5 py-4 text-center">
          <p className="text-[0.8125rem] font-medium text-fg">No search running</p>
          <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
            Starting one looks at every connected source and puts what it finds in the Opportunity
            Inbox, against this truck&rsquo;s cycle.
          </p>
        </div>
      )}
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
