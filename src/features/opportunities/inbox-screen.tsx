"use client";

import { Inbox, Layers, Mail, ShieldCheck, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CONNECTION_IS_PLANNED, CONNECTION_LABEL, DRAFT_STATUS_LABEL, FACTOR_DESCRIPTION,
  FACTOR_LABEL, SOURCE_LABEL,
  RATECON_STATUS_LABEL,
  type BookingRecord, type LearningSummary, type Listing, type RankingFactorKey,
  type RankingPreferences, type RateConWorkflow,
} from "@/types";
import { money } from "@/lib/utils/format";
import {
  applySuggestedWeights, resetRankingWeights, setRankingWeight,
} from "@/lib/api/mock/ranking";
import { dismissMatch, restoreMatch, shortlistMatch } from "@/lib/api/mock/opportunity-matching";
import { approveDraft, cancelDraft } from "@/lib/api/mock/outreach-drafts";
import { useMtLoopContext } from "@/features/mt-loop/use-mt-loop";
import { MatchCard } from "./match-card";
import { DraftReview } from "./opportunities-panel";
import { useOpportunityInbox } from "./use-opportunities";
import { useOpportunityRefresh } from "./use-opportunity-refresh";
import { NegotiationPanel } from "./negotiation-panel";
import { canOpen, openNegotiation } from "@/lib/api/mock/negotiation";

/**
 * One inbox for every source.
 *
 * A load board is not special. A load a broker emails, a row in a spreadsheet
 * somebody exported, a standing relationship that sends a list every morning
 * and a load typed in by hand all arrive as the same kind of thing and sit in
 * the same list. The source is kept — it is often the most useful thing about a
 * load — but it does not get its own tab, because a dispatcher works a market,
 * not a set of websites.
 */
export function OpportunityInboxScreen() {
  const ctx = useMtLoopContext();
  const query = useOpportunityInbox();
  const refreshWorkspace = useOpportunityRefresh();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRest, setShowRest] = useState(false);
  const [openDraftId, setOpenDraftId] = useState<string | null>(null);
  const [tuning, setTuning] = useState(false);

  async function act(fn: () => Promise<{ status: string }>) {
    if (!ctx) return;
    setBusy(true);
    setError(null);
    const outcome = await fn().catch(() => null);
    setBusy(false);
    if (!outcome) setError("Something went wrong. Nothing was changed.");
    else if (outcome.status === "not_permitted") setError("You are not allowed to do that.");
    else if (outcome.status === "needs_reason") setError("That needs a reason.");
    void query.refetch();
    refreshWorkspace();
  }

  function adjust(fn: () => void) {
    fn();
    void query.refetch();
    refreshWorkspace();
  }

  if (query.isPending) {
    return (
      <div className="space-y-section">
        <Skeleton className="h-9 w-64" />
        <LoadingSkeleton rows={6} />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="space-y-section">
        <PageHeader title="Opportunity Inbox" />
        <ErrorState
          title="Could not load the inbox"
          description={query.error.message}
          onRetry={() => query.refetch()}
        />
      </div>
    );
  }

  const s = query.data;
  const openDraft = s.drafts.find((d) => d.draftId === openDraftId);

  /** The same gate the service uses, so the button and the rule agree. */
  function ask(matchId: string): { onAskForIt?: () => void; askBlockedBecause?: string } {
    if (!ctx) return {};
    const gate = canOpen(matchId, ctx);
    if (gate.status === "ok") {
      return { onAskForIt: () => void act(() => openNegotiation(matchId, ctx)) };
    }
    if (gate.status === "unarguable") {
      return { askBlockedBecause: `No conversation will fix this: ${gate.reasons.join(" ")}` };
    }
    return {};
  }

  return (
    <div className="space-y-section">
      <PageHeader
        title="Opportunity Inbox"
        description="Every load from every source, in one list, checked against every truck you are responsible for."
        actions={
          <Button variant="secondary" size="sm" onClick={() => setTuning((v) => !v)}>
            <SlidersHorizontal className="size-3.5" aria-hidden />
            {tuning ? "Done" : "What matters to you"}
          </Button>
        }
      />

      {error ? (
        <p role="alert" className="rounded-md border border-st-danger/40 bg-st-danger-bg/60 px-3.5 py-2.5 text-[0.8125rem] text-fg">
          {error}
        </p>
      ) : null}

      <section aria-label="Inbox overview" className="grid grid-cols-2 gap-stack lg:grid-cols-4 xl:grid-cols-7">
        <Tile label="Loads" value={s.counts.listings} hint={`${s.counts.duplicatesFolded} were the same load twice`} />
        <Tile label="Eligible" value={s.counts.eligible} hint="Pass every hard check" />
        <Tile label="Short-listed" value={s.counts.shortlisted} hint="You picked these out" />
        <Tile label="Drafts to read" value={s.counts.draftsWaiting} hint="Nothing is sent" tone={s.counts.draftsWaiting > 0 ? "warning" : "default"} />
        <Tile
          label="Waiting to be read"
          value={s.messagesWaiting + s.rateConsWaiting}
          hint={s.rateConsWaiting > 0
            ? `${s.rateConsWaiting} rate confirmation${s.rateConsWaiting === 1 ? "" : "s"} to check`
            : "Messages and rate confirmations"}
          tone={s.messagesWaiting + s.rateConsWaiting > 0 ? "warning" : "default"}
        />
        <Tile
          label="Brokers waiting on you"
          value={s.counts.negotiationsWaitingOnYou}
          hint={s.counts.agreedNotBooked > 0
            ? `${s.counts.agreedNotBooked} agreed and not booked`
            : "They answered and nobody replied"}
          tone={s.counts.negotiationsWaitingOnYou > 0 || s.counts.agreedNotBooked > 0 ? "warning" : "default"}
        />
        <Tile
          label="Trucks with nobody looking"
          value={s.counts.cyclesWithoutSearch}
          hint={`of ${s.counts.openCycles} open cycles`}
          tone={s.counts.cyclesWithoutSearch > 0 ? "warning" : "default"}
        />
      </section>

      {tuning ? (
        <RankingPanel
          ranking={s.ranking}
          learning={s.learning}
          onSet={(key, value) =>
            adjust(() => setRankingWeight(s.ranking.organizationId, key, value, ctx?.actor.displayNameSnapshot ?? "You"))}
          onReset={() =>
            adjust(() => resetRankingWeights(s.ranking.organizationId, ctx?.actor.displayNameSnapshot ?? "You"))}
          onApplySuggested={() =>
            adjust(() => applySuggestedWeights(s.ranking.organizationId, ctx?.actor.displayNameSnapshot ?? "You"))}
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-4">
          <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
            <h2 className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg">
              <Inbox className="size-4 text-fg-subtle" aria-hidden />
              The best right now
              <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[0.6875rem] font-medium tabular-nums text-fg-muted">
                {s.top.length}
              </span>
            </h2>
            <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
              Across every truck you are responsible for, ordered by what you said matters.
            </p>

            <div className="mt-3">
              {s.top.length === 0 ? (
                <div className="rounded-md border border-dashed border-border px-3.5 py-4 text-center">
                  <p className="text-[0.8125rem] font-medium text-fg">Nothing is eligible right now</p>
                  <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
                    {s.counts.listings === 0
                      ? "Open a truck from MT Loop and start a search, and what the sources have will land here."
                      : `${s.rest.length} loads were considered and every one failed something. They are all below, with the reason.`}
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {s.top.map((row, i) => (
                    <MatchCard
                      key={row.match.matchId}
                      row={row}
                      rank={i + 1}
                      busy={busy}
                      onShortlist={() => void act(() => shortlistMatch(row.match.matchId, ctx!))}
                      onDismiss={(reason) => void act(() => dismissMatch(row.match.matchId, reason, ctx!))}
                      onRestore={() => void act(() => restoreMatch(row.match.matchId, ctx!))}
                      onOpenDraft={setOpenDraftId}
                      {...ask(row.match.matchId)}
                    />
                  ))}
                </ul>
              )}

              {s.rest.length > 0 ? (
                <div className="mt-3">
                  <Button variant="ghost" size="sm" onClick={() => setShowRest((v) => !v)}>
                    {showRest ? "Hide the rest" : `Show the other ${s.rest.length}`}
                  </Button>
                  {showRest ? (
                    <ul className="mt-2 space-y-2">
                      {s.rest.map((row) => (
                        <MatchCard
                          key={row.match.matchId}
                          row={row}
                          busy={busy}
                          onShortlist={() => void act(() => shortlistMatch(row.match.matchId, ctx!))}
                          onDismiss={(reason) => void act(() => dismissMatch(row.match.matchId, reason, ctx!))}
                          onRestore={() => void act(() => restoreMatch(row.match.matchId, ctx!))}
                          onOpenDraft={setOpenDraftId}
                          {...ask(row.match.matchId)}
                        />
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>

          <NegotiationPanel
            negotiations={s.negotiations}
            ctx={ctx}
            onChanged={() => { void query.refetch(); refreshWorkspace(); }}
          />

          {openDraft ? (
            <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
              <DraftReview
                draft={openDraft}
                busy={busy}
                onClose={() => setOpenDraftId(null)}
                onApprove={() => void act(() => approveDraft(openDraft.draftId, ctx!))}
                onCancel={() => void act(() => cancelDraft(openDraft.draftId, ctx!))}
              />
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <DraftsPanel
            drafts={s.drafts}
            onOpen={setOpenDraftId}
          />
          <BookedPanel bookings={s.bookings} />
          <RateConsPanel rateCons={s.rateCons} />
          <SourcesPanel listings={s.listings} />
          <SearchesPanel sessions={s.sessions} />
        </div>
      </div>

      <p className="rounded-md border border-dashed border-border px-3.5 py-2.5 text-[0.75rem] leading-relaxed text-fg-subtle">
        No load board is connected. Everything here came from sample sources that behave like a
        market so the parts that are real — one listing per load however many sources have it, a
        separate match per truck, the ranking, the draft grouping, and standing the competition down
        when a load goes — can be used and argued with. Conversations with brokers are recorded by
        you or produced by the sample market, and every round says which. Messages are written as
        the carrier and never sent by Antcolos; rate confirmations are generated samples read by a
        mock reader, and the signature is a name on a line rather than a credential.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Tile({
  label, value, hint, tone = "default",
}: {
  label: string; value: number; hint: string; tone?: "default" | "warning";
}) {
  return (
    <div
      className={`rounded-lg border bg-surface p-4 shadow-e1 ${tone === "warning" ? "border-st-warning/40" : "border-border"}`}
    >
      <p className="text-[0.75rem] font-medium text-fg-muted">{label}</p>
      <p className="mt-1 text-[1.5rem] leading-none font-semibold tabular-nums text-fg">{value}</p>
      <p className="mt-1.5 text-[0.75rem] text-fg-subtle">{hint}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Ranking                                                                     */
/* -------------------------------------------------------------------------- */

const SOURCE_NOTE: Record<RankingPreferences["source"], string> = {
  default: "These are the defaults Antcolos ships with. Nobody has changed them.",
  adjusted: "You set these.",
  learned: "You accepted what the ranking suggested.",
};

function RankingPanel({
  ranking, learning, onSet, onReset, onApplySuggested,
}: {
  ranking: RankingPreferences;
  learning: LearningSummary;
  onSet: (key: RankingFactorKey, value: number) => void;
  onReset: () => void;
  onApplySuggested: () => void;
}) {
  const keys = Object.keys(ranking.weights) as RankingFactorKey[];

  return (
    <section className="rounded-lg border border-primary/30 bg-primary/[0.03] p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-[0.875rem] font-semibold text-fg">What matters to you</h2>
          <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
            {SOURCE_NOTE[ranking.source]}
            {ranking.updatedByName ? ` Last changed by ${ranking.updatedByName}.` : ""}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onReset}>Put back to the defaults</Button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {keys.map((key) => (
          <div key={key}>
            <label htmlFor={`w-${key}`} className="flex items-center justify-between gap-2 text-[0.8125rem] font-medium text-fg">
              {FACTOR_LABEL[key]}
              <span className="tabular-nums text-fg-muted">{ranking.weights[key]}</span>
            </label>
            <input
              id={`w-${key}`}
              type="range"
              min={0}
              max={100}
              step={5}
              value={ranking.weights[key]}
              onChange={(e) => onSet(key, Number(e.target.value))}
              className="mt-1 w-full accent-[var(--color-primary)]"
            />
            <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-subtle">
              {FACTOR_DESCRIPTION[key]}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-md border border-border bg-surface px-3.5 py-3">
        <h3 className="flex items-center gap-1.5 text-[0.8125rem] font-semibold text-fg">
          <ShieldCheck className="size-3.5 text-fg-subtle" aria-hidden />
          What Antcolos learns, and what it never sees
        </h3>
        <p className="mt-1 text-[0.75rem] leading-relaxed text-fg-muted">
          You have made {learning.observations} decision{learning.observations === 1 ? "" : "s"} the
          ranking could learn from. Across Antcolos there are {learning.networkObservations}.
          Weights never move on their own — a suggestion is offered and you decide.
        </p>

        {learning.suggested ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-[0.75rem] text-fg-muted">
              Based on what you have chased and what you have thrown away, it would suggest a
              different balance.
            </span>
            <Button variant="secondary" size="sm" onClick={onApplySuggested}>
              Use the suggestion
            </Button>
          </div>
        ) : (
          <p className="mt-2 text-[0.75rem] text-fg-subtle">
            Not enough decisions yet to suggest anything. It will say so rather than guess.
          </p>
        )}

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <h4 className="text-[0.75rem] font-semibold text-fg">Leaves this workspace</h4>
            <ul className="mt-1 space-y-0.5">
              {learning.sharedFields.map((f) => (
                <li key={f} className="text-[0.75rem] text-fg-muted">{f}</li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-[0.75rem] font-semibold text-fg">Never leaves it</h4>
            <ul className="mt-1 space-y-0.5">
              {learning.withheldFields.map((f) => (
                <li key={f} className="text-[0.75rem] text-fg-muted">{f}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function DraftsPanel({
  drafts, onOpen,
}: {
  drafts: OutreachDraftLike[];
  onOpen: (id: string) => void;
}) {
  const waiting = drafts.filter((d) => d.status === "ready");
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <h2 className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg">
        <Mail className="size-4 text-fg-subtle" aria-hidden />
        Prepared messages
        <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[0.6875rem] font-medium tabular-nums text-fg-muted">
          {waiting.length}
        </span>
      </h2>
      <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
        One per load per carrier, covering every truck of theirs that suits it. Nothing is sent.
      </p>

      {drafts.length === 0 ? (
        <p className="mt-3 rounded-md border border-dashed border-border px-3.5 py-3 text-[0.75rem] text-fg-muted">
          Drafts are prepared for the best few loads once a search turns something up.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {drafts.slice(0, 8).map((d) => (
            <li key={d.draftId}>
              <button
                type="button"
                onClick={() => onOpen(d.draftId)}
                className="w-full rounded-md border border-border bg-surface-sunken px-3 py-2 text-left transition-colors hover:border-border-strong hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span className="flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium text-fg">
                  {d.carrierName}
                  <Badge tone={d.status === "ready" ? "info" : d.status === "approved" ? "success" : "neutral"}>
                    {DRAFT_STATUS_LABEL[d.status]}
                  </Badge>
                  {d.blockedReason ? <Badge tone="danger">Blocked</Badge> : null}
                </span>
                <span className="mt-0.5 block truncate text-[0.75rem] text-fg-subtle">
                  {d.subject}
                </span>
                <span className="mt-0.5 block text-[0.75rem] text-fg-subtle">
                  {d.truckUnits.length === 1 ? "Unit" : "Units"} {d.truckUnits.join(", ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type OutreachDraftLike = {
  draftId: string; carrierName: string; subject: string; truckUnits: string[];
  status: keyof typeof DRAFT_STATUS_LABEL; blockedReason?: string;
};

/* -------------------------------------------------------------------------- */

function SourcesPanel({ listings }: { listings: Listing[] }) {
  // Counted per sighting, not per row. A load seen on the board and again in a
  // broker's email is one row in the list above, but it really was seen twice,
  // and a dispatcher asking "is the mailbox pulling its weight" is asking about
  // sightings. Counting rows would have credited every load to whichever source
  // happened to reach us first and made the other sources look dead.
  const bySource = new Map<string, { count: number; connection: Listing["connection"] }>();
  for (const l of listings) {
    for (const sighting of l.sightings) {
      const key = `${sighting.source}::${sighting.sourceName}::${sighting.connection}`;
      bySource.set(key, {
        count: (bySource.get(key)?.count ?? 0) + 1,
        connection: sighting.connection,
      });
    }
  }
  const folded = listings.filter((l) => l.sightings.length > 1);

  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <h2 className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg">
        <Layers className="size-4 text-fg-subtle" aria-hidden />
        Where these came from
      </h2>
      <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
        Every source is normalised into one list. The same load from two sources is one row here,
        with both sightings kept.
      </p>

      {bySource.size === 0 ? (
        <p className="mt-3 text-[0.75rem] text-fg-muted">Nothing has arrived yet.</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {[...bySource.entries()].map(([key, v]) => {
            const [source, name, connection] = key.split("::");
            return (
              <li key={key} className="flex flex-wrap items-center justify-between gap-2 text-[0.8125rem] text-fg">
                <span className="flex flex-wrap items-center gap-2">
                  {name}
                  <Badge tone="outline">{SOURCE_LABEL[source as keyof typeof SOURCE_LABEL]}</Badge>
                  {CONNECTION_IS_PLANNED[connection as keyof typeof CONNECTION_IS_PLANNED] ? (
                    <Badge tone="warning">
                      {CONNECTION_LABEL[connection as keyof typeof CONNECTION_LABEL]} — not built
                    </Badge>
                  ) : null}
                </span>
                <span className="tabular-nums text-fg-muted">{v.count}</span>
              </li>
            );
          })}
        </ul>
      )}

      {folded.length > 0 ? (
        <p className="mt-3 text-[0.75rem] leading-relaxed text-fg-muted">
          {folded.length} load{folded.length === 1 ? " was" : "s were"} seen on more than one source
          and folded into a single row, so nobody emails the same broker twice about it.
        </p>
      ) : null}
    </section>
  );
}

/**
 * Rate confirmations, across every truck.
 *
 * On the inbox as well as on each truck because "what is waiting on me" is a
 * question about the whole desk, and an unsigned confirmation is the most
 * expensive thing on it to forget.
 */
function RateConsPanel({ rateCons }: { rateCons: RateConWorkflow[] }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <h2 className="text-[0.875rem] font-semibold text-fg">Rate confirmations</h2>
      <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
        Checked field by field against what was booked, and signed only when you say so.
      </p>
      {rateCons.length === 0 ? (
        <p className="mt-3 text-[0.75rem] text-fg-muted">None have arrived.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rateCons.slice(0, 8).map((w) => (
            <li key={w.rateConId} className="text-[0.8125rem]">
              <Link
                href={`/dispatch/rate-confirmations/${w.rateConId}`}
                className="flex flex-wrap items-center gap-2 text-fg underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {w.loadReference}
                <Badge tone={
                  w.status === "returned" ? "success"
                    : w.status === "rejected" ? "danger" : "warning"
                }
                >
                  {RATECON_STATUS_LABEL[w.status]}
                </Badge>
              </Link>
              <span className="mt-0.5 block text-[0.75rem] text-fg-subtle">{w.brokerName}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[0.6875rem] leading-relaxed text-fg-subtle">
        No mailbox is connected. Each one is a generated sample, and the signature is a name on a
        line rather than a credential.
      </p>
    </section>
  );
}

/**
 * What actually came out of all this: the loads booked from this inbox.
 *
 * Kept on the inbox rather than only on each truck because a dispatcher's
 * question at the end of a morning is "what did we cover", and answering it by
 * opening six trucks in turn is not answering it.
 */
function BookedPanel({ bookings }: { bookings: BookingRecord[] }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <h2 className="text-[0.875rem] font-semibold text-fg">Booked from here</h2>
      <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
        Each one created a real load on the truck&apos;s own cycle.
      </p>
      {bookings.length === 0 ? (
        <p className="mt-3 text-[0.75rem] text-fg-muted">Nothing has been booked yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {bookings.slice(0, 8).map((b) => (
            <li key={b.bookingId} className="text-[0.8125rem]">
              <span className="flex flex-wrap items-center gap-2 text-fg">
                {b.loadReference}
                <span className="text-[0.75rem] text-fg-muted">Unit {b.truckUnit}</span>
                {b.consent === "pending" ? (
                  <Badge tone="warning">Driver has not accepted</Badge>
                ) : null}
                {b.consent === "declined" ? (
                  <Badge tone="danger">Driver declined</Badge>
                ) : null}
              </span>
              <span className="mt-0.5 block text-[0.75rem] text-fg-subtle">
                {money(b.agreedRateCents)} · {b.brokerName} · {b.bookedByName}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[0.6875rem] leading-relaxed text-fg-subtle">
        Brokers here are written exactly as the market gave them. Linking them to permanent Broker,
        Shipper and Receiver profiles is that module&apos;s job, not this one&apos;s.
      </p>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function SearchesPanel({ sessions }: { sessions: Array<{ searchSessionId: string; truckUnit: string; status: string; counts: { listingsSeen: number }; truckId: string }> }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <h2 className="text-[0.875rem] font-semibold text-fg">Searches</h2>
      <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
        Which trucks somebody is actually looking for a load for.
      </p>
      {sessions.length === 0 ? (
        <p className="mt-3 text-[0.75rem] text-fg-muted">Nobody is searching for anything.</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {sessions.slice(0, 8).map((s) => (
            <li key={s.searchSessionId} className="flex flex-wrap items-center justify-between gap-2">
              <Link
                href={`/dispatch/trucks/${s.truckId}`}
                className="text-[0.8125rem] text-fg underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Unit {s.truckUnit}
              </Link>
              <span className="flex items-center gap-2 text-[0.75rem] text-fg-subtle">
                {s.counts.listingsSeen} seen
                <Badge tone={s.status === "running" ? "info" : s.status === "paused" ? "warning" : "neutral"}>
                  {s.status}
                </Badge>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
