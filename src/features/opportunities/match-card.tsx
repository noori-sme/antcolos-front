"use client";

import {
  ArrowRight, Check, Circle, Handshake, Landmark, Mail, Minus, Star, TriangleAlert,
  UserCheck, X,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CHECK_LABEL, FACTOR_LABEL, MATCH_STATUS_LABEL, SOURCE_LABEL,
  type MatchCheck, type MatchCheckOutcome, type MatchWithListing,
} from "@/types";
import { Metric, Tip } from "@/features/mt-loop/tip";
import { FactoringChip } from "@/features/factoring/factoring-chip";
import { cn } from "@/lib/utils";

/**
 * One opportunity, for one truck.
 *
 * Shows the load, the score and — crucially — the working. A dispatcher who is
 * told a load scores 74 learns nothing; one who is told it scores 74 because
 * the rate is strong and the deadhead is short but it does not get the driver
 * home can act on it, or disagree and go and move a slider.
 *
 * Ineligible loads look different but are NOT hidden. "Nothing suits this
 * truck" is a dead end; "eleven loads, and here is the one thing wrong with
 * each" is a to-do list — raise the deadhead limit, chase the medical card,
 * ring the carrier about the authority.
 */
export function MatchCard({
  row, rank, busy, onShortlist, onDismiss, onRestore, onOpenDraft, onTalkToBroker,
  askBlockedBecause, onSendToDriver, onCheckFactoring, driverState,
}: {
  row: MatchWithListing;
  /** 1-based place in the short list. Absent for everything below it. */
  rank?: number;
  busy: boolean;
  onShortlist: () => void;
  onDismiss: (reason: string) => void;
  onRestore: () => void;
  onOpenDraft?: (draftId: string) => void;
  /** Open the broker dialog — email or phone. Absent where neither may start. */
  onTalkToBroker?: () => void;
  /**
   * Why there is no "Ask for it" button.
   *
   * Shown instead of the button rather than as a disabled one: a dispatcher
   * needs to know that no phone call will fix a sprinter van being the wrong
   * equipment, and a greyed-out control does not say that.
   */
  askBlockedBecause?: string;
  /** Put this load in front of the driver before anybody negotiates it. */
  onSendToDriver?: () => void;
  /**
   * Open the carrier's fallback factoring workflow for this load.
   *
   * ★ PRESENT ONLY WHERE THERE IS NO AUTOMATIC CHECK ★
   * With a working automatic connection the status simply appears and this is
   * absent — a "Check with factoring" button beside a completed result would
   * imply a manual step that does not exist. Where the carrier has no
   * authorized API, this is the one contextual button, and it opens the
   * carrier's own configured workflow rather than pretending to call anybody.
   */
  onCheckFactoring?: () => void;
  /**
   * Where the driver review has got to.
   *
   * A label and the sentence behind it, kept apart: "Driver first" is what a
   * dispatcher scanning five loads needs, and "Northline Freight asks that the
   * driver sees a load before it is negotiated" is what they need once, when
   * they wonder why there is no Broker button.
   */
  driverState?: { label: string; detail: string };
}) {
  const [showChecks, setShowChecks] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState("");

  const { match, listing } = row;
  const failed = match.checks.filter((c) => c.blocking && c.outcome === "fail");
  const warned = match.checks.filter((c) => c.outcome === "warn");
  const gone = match.status === "closed_listing_gone" || listing.status !== "open";

  return (
    <li
      className={cn(
        "rounded-md border bg-surface-sunken px-3.5 py-3",
        match.status === "booked" ? "border-st-success/45"
          : failed.length > 0 ? "border-border"
            : rank !== undefined ? "border-primary/30" : "border-border",
        (gone || match.status === "dismissed") && "opacity-70",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          {/* The lane, the state, the truck. One line, always. */}
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] font-medium text-fg">
            {rank !== undefined ? (
              <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/12 text-[0.6875rem] font-semibold tabular-nums text-primary">
                {rank}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1.5">
              {listing.origin.city}, {listing.origin.state}
              <ArrowRight className="size-3 text-fg-subtle" aria-hidden />
              {listing.destination.city}, {listing.destination.state}
            </span>
            <StatusChip status={match.status} listingStatus={listing.status} />
            {/*
              The factoring answer rides on the line the dispatcher is already
              reading. It is not a stage, a lane or a step — it is an
              eligibility fact about this broker for this carrier, next to the
              other eligibility facts.
            */}
            {row.factoring ? <FactoringChip status={row.factoring} /> : null}
            <span className="text-[0.75rem] font-normal text-fg-muted">{match.truckUnit}</span>
          </p>

          {/*
            ★ THE NUMBERS, AS NUMBERS ★
            These were three sentences of comma-separated clauses. A dispatcher
            comparing five loads reads the same six figures on each, so they
            are labelled and they line up.
          */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Metric label="Rate" value={money(listing.offeredRateCents) ?? "—"} tone={listing.offeredRateCents === undefined ? "muted" : "good"} />
            {match.allInRatePerMileCents !== undefined ? (
              <Metric label="/mi" value={`$${(match.allInRatePerMileCents / 100).toFixed(2)}`} />
            ) : null}
            {match.estimatedProfitCents !== undefined ? (
              <Metric
                label="Left"
                value={`$${Math.round(match.estimatedProfitCents / 100).toLocaleString()}`}
                tone={match.estimatedProfitCents < 0 ? "bad" : "muted"}
                title="What is left after the estimated cost of running it."
              />
            ) : null}
            <Metric label="Empty" value={`${match.deadheadMiles} mi`} tone={match.deadheadMiles > 100 ? "warn" : "muted"} />
            <Metric label="Loaded" value={`${listing.loadedMiles.toLocaleString()} mi`} />
            <Metric label="PU" value={shortWhen(listing.pickupAt)} />
            {listing.deliverBy ? <Metric label="DEL" value={shortWhen(listing.deliverBy)} /> : null}
          </div>

          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.6875rem] text-fg-subtle">
            <span className="text-fg-muted">{listing.broker.name}</span>
            <span>{listing.equipment.replace(/_/g, " ")}</span>
            <Tip text={`${SOURCE_LABEL[listing.source]}${listing.sightings.length > 1 ? `, seen on ${listing.sightings.length} sources` : ` — ${listing.sourceName}`}`}>
              <span>{listing.sightings.length > 1 ? `${listing.sightings.length} sources` : listing.sourceName}</span>
            </Tip>
          </p>

          {/*
            ★ PROBLEMS AS CHIPS, NOT PARAGRAPHS ★
            A failing check still stops the load and is still red and still
            named. Its sentence is in the tip, and the full working is behind
            "Why" — which is where it always was.
          */}
          {failed.length > 0 || warned.length > 0 ? (
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {failed.map((c) => (
                <li key={c.key}>
                  <Tip text={c.detail}>
                    <span className="inline-flex items-center gap-1 rounded-sm border border-st-danger/45 bg-st-danger-bg/40 px-1.5 py-0.5 text-[0.6875rem] font-medium text-st-danger">
                      <X className="size-3" aria-hidden />
                      {CHECK_LABEL[c.key]}
                    </span>
                  </Tip>
                </li>
              ))}
              {failed.length === 0 ? warned.slice(0, 3).map((c) => (
                <li key={c.key}>
                  <Tip text={c.detail}>
                    <span className="inline-flex items-center gap-1 rounded-sm border border-st-warning/45 bg-st-warning-bg/35 px-1.5 py-0.5 text-[0.6875rem] text-st-warning">
                      <TriangleAlert className="size-3" aria-hidden />
                      {CHECK_LABEL[c.key]}
                    </span>
                  </Tip>
                </li>
              )) : null}
            </ul>
          ) : null}

          {/* One muted line for anything that has happened TO this row. */}
          {match.dismissReason || gone || askBlockedBecause || driverState ? (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[0.6875rem]">
              {match.dismissReason ? (
                <Tip text={match.dismissReason}><span className="text-fg-muted">Dismissed</span></Tip>
              ) : null}
              {gone ? (
                <Tip text={listing.closeReason ?? "This load has gone."}>
                  <span className="text-fg-muted">Gone</span>
                </Tip>
              ) : null}
              {askBlockedBecause ? (
                <Tip text={askBlockedBecause}>
                  <span className="text-fg-muted">No conversation will fix it</span>
                </Tip>
              ) : null}
              {driverState ? (
                <Tip text={driverState.detail}>
                  <span className="text-primary">{driverState.label}</span>
                </Tip>
              ) : null}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <Score total={match.score.total} dimmed={failed.length > 0 || gone} />
          <div className="flex flex-wrap justify-end gap-1.5">
            {!gone && match.status !== "dismissed" && match.status !== "booked"
              && match.status !== "shortlisted" ? (
                <Button variant="ghost" size="sm" disabled={busy} onClick={onShortlist} title="Short-list">
                  <Star className="size-3.5" aria-hidden />
                </Button>
              ) : null}
            {match.status === "dismissed" ? (
              <Button variant="ghost" size="sm" disabled={busy} onClick={onRestore}>
                Put back
              </Button>
            ) : null}
            {!gone && match.status !== "dismissed" && match.status !== "booked" ? (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDismissing(true)} title="Not this one">
                <X className="size-3.5" aria-hidden />
              </Button>
            ) : null}
            {/*
              ★ BOTH CONVERSATIONS START HERE ★
              Talking to the broker and putting it to the driver are the two
              things a dispatcher does with an opportunity, and both used to be
              somewhere else on the page. Each opens its own dialog with the
              load already in it.
            */}
            {onCheckFactoring ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={onCheckFactoring}
                data-testid="check-with-factoring"
              >
                <Landmark className="size-3.5" aria-hidden />
                Check with factoring
              </Button>
            ) : null}
            {onSendToDriver ? (
              <Button variant="secondary" size="sm" disabled={busy} onClick={onSendToDriver}>
                <UserCheck className="size-3.5" aria-hidden />
                Driver
              </Button>
            ) : null}
            {onTalkToBroker ? (
              <Button variant="primary" size="sm" disabled={busy} onClick={onTalkToBroker}>
                <Handshake className="size-3.5" aria-hidden />
                Broker
              </Button>
            ) : null}
            {row.draftId && onOpenDraft ? (
              <Button variant="ghost" size="sm" onClick={() => onOpenDraft(row.draftId!)} title="Prepared message">
                <Mail className="size-3.5" aria-hidden />
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => setShowChecks((v) => !v)}>
              {showChecks ? "Hide" : "Why"}
            </Button>
          </div>
        </div>
      </div>

      {dismissing ? (
        <div className="mt-3 rounded-md border border-border bg-surface px-3 py-2.5">
          <label htmlFor={`why-${match.matchId}`} className="text-[0.75rem] font-medium text-fg">
            Why not this one?
          </label>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input
              id={`why-${match.matchId}`}
              value={reason}
              placeholder="Rate is too soft for that lane"
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && reason.trim()) {
                  e.preventDefault();
                  setDismissing(false);
                  onDismiss(reason.trim());
                  setReason("");
                }
              }}
              className="max-w-sm"
            />
            <Button
              variant="primary"
              size="sm"
              disabled={busy || !reason.trim()}
              onClick={() => {
                setDismissing(false);
                onDismiss(reason.trim());
                setReason("");
              }}
            >
              Dismiss it
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setDismissing(false); setReason(""); }}>
              Cancel
            </Button>
          </div>
          <p className="mt-1.5 text-[0.75rem] leading-relaxed text-fg-subtle">
            The reason is kept, and it is what the ranking learns from.
          </p>
        </div>
      ) : null}

      {showChecks ? (
        <div className="mt-3 grid gap-3 rounded-md border border-border bg-surface px-3 py-2.5 sm:grid-cols-2">
          <div>
            <h4 className="text-[0.75rem] font-semibold text-fg">Every check</h4>
            <ul className="mt-1.5 space-y-1">
              {match.checks.map((c) => (
                <li key={c.key} className="flex items-start gap-1.5 text-[0.75rem] leading-relaxed">
                  <CheckIcon outcome={c.outcome} />
                  <span className="min-w-0">
                    <span className="font-medium text-fg">{CHECK_LABEL[c.key]}</span>
                    <span className="text-fg-muted"> — {c.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-[0.75rem] font-semibold text-fg">How it scored {match.score.total}</h4>
            <ul className="mt-1.5 space-y-1.5">
              {[...match.score.components]
                .sort((a, b) => b.contribution - a.contribution)
                .map((c) => (
                  <li key={c.key} className="text-[0.75rem] leading-relaxed">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-medium text-fg">{FACTOR_LABEL[c.key]}</span>
                      <span className="tabular-nums text-fg-muted">
                        +{c.contribution.toFixed(1)}
                      </span>
                    </span>
                    <span
                      aria-hidden
                      className="mt-0.5 block h-1 rounded-full bg-surface-sunken"
                    >
                      <span
                        className="block h-1 rounded-full bg-primary/55"
                        style={{ width: `${Math.max(2, Math.min(100, c.raw))}%` }}
                      />
                    </span>
                    <span className="text-fg-subtle">{c.detail}</span>
                  </li>
                ))}
            </ul>
            <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-subtle">
              The bars are how well this load did on each thing. What it adds up to depends on the
              weights you set, which is why the total is only comparable against other loads ranked
              the same way.
            </p>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/* -------------------------------------------------------------------------- */

function Score({ total, dimmed }: { total: number; dimmed?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex min-w-12 flex-col items-center rounded-md px-2 py-1",
        dimmed ? "bg-surface text-fg-subtle" : "bg-primary/10 text-primary",
      )}
    >
      <span className="text-[1.0625rem] leading-none font-semibold tabular-nums">{total}</span>
      <span className="mt-0.5 text-[0.625rem] tracking-wide uppercase">score</span>
    </span>
  );
}

const TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger" | "outline"> = {
  eligible: "info",
  shortlisted: "success",
  ineligible: "outline",
  dismissed: "neutral",
  booked: "success",
  closed_listing_gone: "neutral",
};

function StatusChip({ status, listingStatus }: { status: string; listingStatus: string }) {
  if (listingStatus !== "open" && status !== "booked") {
    return <Badge tone="neutral">{listingStatus}</Badge>;
  }
  return <Badge tone={TONE[status] ?? "neutral"}>{MATCH_STATUS_LABEL[status as never]}</Badge>;
}

function CheckIcon({ outcome }: { outcome: MatchCheckOutcome }) {
  const common = "mt-0.5 size-3 shrink-0";
  if (outcome === "pass") return <Check className={cn(common, "text-st-success")} aria-label="passes" />;
  if (outcome === "fail") return <X className={cn(common, "text-st-danger")} aria-label="fails" />;
  if (outcome === "warn") return <TriangleAlert className={cn(common, "text-st-warning")} aria-label="worth a look" />;
  return <Minus className={cn(common, "text-fg-subtle")} aria-label="not known" />;
}

const money = (c?: number) =>
  c === undefined ? undefined : `$${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

/** "Sat 10:56" — a dispatcher reading five of these needs them the same width. */
const shortWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "short", hour: "numeric", minute: "2-digit",
  });

export { Circle as MatchDot };
export type { MatchCheck };
