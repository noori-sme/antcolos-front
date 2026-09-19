"use client";

import { MessageSquare, MoreHorizontal, RefreshCw, Truck, Wrench } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  MT_LOOP_LANE_LABEL,
  type MtLoopBoard, type MtLoopCard, type MtLoopLane, type MtLoopProgress,
} from "@/types";
import {
  assignLoop, blockLoop, claimLoop, closeLoopById, escalateLoopToCarrier,
  pauseLoop, releaseLoop, resumeLoop, unblockLoop,
  type MtLoopContext, type MtLoopOutcome,
} from "@/lib/api/mock/mt-loop";
import { MiniMap, PositionCaption } from "./mini-map";
import {
  BrokerReplyDialog, LoopActionsDialog, RateConDialog, type LoopActionHandlers,
} from "./loop-dialogs";
import { cn, useNow } from "@/lib/utils";

/**
 * The MT Loop board.
 *
 * First thing on the dispatch dashboard, in every dispatch workspace and for a
 * carrier owner who dispatches their own trucks — because an empty truck is the
 * most expensive thing on the screen, and the longer it stays empty the more it
 * costs.
 *
 * ★ A DECISION SURFACE, NOT A SECOND COPY OF FOUR OTHER SCREENS ★
 *
 * The truck, the trailer, the driver, the carrier, the load and the tracking
 * feed all have permanent records with pages of their own. This board reads
 * them, reconciles them, and shows only what they MEAN right now: the current
 * operational conclusion, anything standing in the way, the one next thing, and
 * who is answerable. It does not restate a VIN, an equipment specification, a
 * driver's paperwork or a trailer's dimensions — a dispatcher who needs those
 * is one click from them, and printing them here would make this a staler copy
 * of a page that is already right.
 *
 * ★ THREE LANES, IN THE ORDER THE QUESTIONS GET ASKED ★
 *
 *   Needs a load   empty, dispatchable, and still without work. Full cards,
 *                  because these are what somebody is going to act on.
 *   Rolling        signed AND moving. One line each: the clock has stopped.
 *   Not ready      something stops dispatch. One line each — out of the way of
 *                  the working lane, and still on the board, still counted,
 *                  still clickable, with the empty clock still running.
 *
 * `Not ready` is the lane that needed the most care. Hiding a truck nobody may
 * dispatch would make the board look calm and quietly lose an open cycle that
 * is costing money; leaving it in the working lane wastes the hour of whoever
 * tries to find freight for it. So it is demoted, never hidden, and the reason
 * it is there is the first thing its row says.
 *
 * ★ WHAT MAY BE COLLAPSED, AND WHAT MAY NOT ★
 * The EXPLANATION behind a state lives one click away, in the actions panel,
 * with the evidence beside it. The BLOCKER never does: anything that stops a
 * dispatch is on the face of the card in the lane that says so, and every
 * button is still rendered from `card.can`, which the service worked out beside
 * the records and re-checks inside every mutation. Collapsing the explanation
 * must never collapse the thing being explained.
 *
 * The panel renders what the service gives it and decides nothing.
 */
export type MtLoopPanelScope = "personal" | "organization";

export function MtLoopPanel({
  board, ctx, onChanged, scope = "organization",
}: {
  board: MtLoopBoard;
  ctx: MtLoopContext | null;
  /** Called after any successful change so the caller can refetch. */
  onChanged: () => void;
  /**
   * ★ WHOSE SCREEN IS THIS? ★
   *
   * `organization` — the dispatch board. Every open loop, every card, because
   *                  that is the job of that screen.
   * `personal`     — Home. Full cards only for loops that need this person,
   *                  plus one compact line for everything the team is
   *                  handling, with links to the views that show it.
   *
   * The panel does not decide which loops those are. It reads
   * `card.needsYouPersonally`, which the Responsibility Engine computed from
   * the same seven reasons that fill My Needs You and the nav badge. There is
   * no Home filtering rule here and there must never be one: a Carrier Owner's
   * Home used to carry an operational card for every truck in the workspace,
   * including healthy ones a dispatcher was already working, which is an
   * organization-wide board wearing a personal screen's clothes.
   */
  scope?: MtLoopPanelScope;
}) {
  const personal = scope === "personal";
  /*
   * What this screen renders at all.
   *
   * On a personal screen that is `needsYouPersonally` and nothing else — a
   * fact the engine computed, not a filter this component invented. On the
   * dispatch board it is everything, which is what an organization-wide board
   * is for.
   */
  const shown = personal ? board.loops.filter((l) => l.needsYouPersonally) : board.loops;

  const [busyLoopId, setBusyLoopId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /** Which panel is open over the board, and on which cycle. */
  const [open, setOpen] = useState<
    { kind: "broker_reply" | "rate_con" | "actions"; card: MtLoopCard; id?: string } | null
  >(null);

  async function run(loopId: string, fn: () => Promise<MtLoopOutcome>, success: string) {
    if (!ctx) return;
    setBusyLoopId(loopId);
    setError(null);
    setMessage(null);
    const outcome = await fn().catch(() => null);
    setBusyLoopId(null);

    if (!outcome) setError("Something went wrong. Nothing was changed.");
    else if (outcome.status === "already_held") {
      setError(`${outcome.responsibleName} picked that up first, so nothing was changed.`);
    } else if (outcome.status === "not_permitted") {
      setError("You are not allowed to do that to this loop.");
    } else if (outcome.status === "not_found") {
      setError("That loop is no longer here.");
    } else if (outcome.status === "needs_reason") {
      setError("That needs a reason before it can be done.");
    } else {
      setMessage(success);
    }
    onChanged();
  }

  function handlersFor(loop: MtLoopCard): LoopActionHandlers {
    return {
      onClaim: () => run(loop.loopId, () => claimLoop(loop.loopId, ctx!), "It is yours now."),
      onRelease: () =>
        run(loop.loopId, () => releaseLoop(loop.loopId, ctx!), "Handed back to the queue."),
      onAssign: (membershipId, name) =>
        run(loop.loopId, () => assignLoop(loop.loopId, membershipId, name, ctx!), `Given to ${name}.`),
      onPause: (reason) =>
        run(loop.loopId, () => pauseLoop(loop.loopId, reason, 8, ctx!), "Paused for 8 hours."),
      onResume: () => run(loop.loopId, () => resumeLoop(loop.loopId, ctx!), "Back on it."),
      onBlock: (reason) => run(loop.loopId, () => blockLoop(loop.loopId, reason, ctx!), "Blocked."),
      onUnblock: () => run(loop.loopId, () => unblockLoop(loop.loopId, ctx!), "Unblocked."),
      onClose: (reason) =>
        run(loop.loopId, () => closeLoopById(loop.loopId, reason, ctx!), "This cycle is closed."),
      onEscalateToCarrier: (reason) =>
        run(
          loop.loopId,
          () => escalateLoopToCarrier(loop.loopId, reason, ctx!),
          "The carrier has been asked. You still have the truck.",
        ),
    };
  }

  const lanes: Record<MtLoopLane, MtLoopCard[]> = {
    needs_load: shown.filter((c) => c.lane === "needs_load"),
    rolling: shown.filter((c) => c.lane === "rolling"),
    not_ready: shown.filter((c) => c.lane === "not_ready"),
  };

  return (
    <section
      aria-labelledby="mt-loop-heading"
      className="rounded-lg border border-border bg-surface p-4 shadow-e1"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2
            id="mt-loop-heading"
            className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg"
          >
            <RefreshCw className="size-4 text-fg-subtle" aria-hidden />
            MT Loop
            <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[0.6875rem] font-medium tabular-nums text-fg-muted">
              {shown.length}
            </span>
          </h2>
          <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
            {personal
              ? "Empty trucks that need you — yours to work, fallen to you, escalated to you, or waiting on your decision."
              : "Every truck this workspace covers that is empty or about to be, from the moment it goes empty until its next load has run."}
          </p>
        </div>
        {shown.length > 0 ? (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.75rem] text-fg-subtle">
            {/* Whose turn it is, counted. The one number worth leading with:
                a truck waiting on a broker is not waiting on the reader. */}
            <span className="font-medium text-fg">
              {shown.filter((c) => c.progress.yourTurn).length} waiting on you
            </span>
            <span>{shown.filter((c) => !c.claimed).length} not claimed</span>
            {lanes.not_ready.length > 0 ? (
              <span className="text-st-danger">{lanes.not_ready.length} not ready</span>
            ) : null}
          </p>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-md border border-st-danger/40 bg-st-danger-bg/60 px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-fg"
        >
          {error}
        </p>
      ) : null}
      {message ? (
        <p
          role="status"
          className="mt-3 rounded-md border border-st-success/40 bg-st-success-bg/60 px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-fg"
        >
          {message}
        </p>
      ) : null}

      <div className="mt-3">
        {shown.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-3.5 py-4 text-center">
            <p className="text-[0.8125rem] font-medium text-fg">
              {personal ? "No empty truck needs you" : "No trucks going empty"}
            </p>
            <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
              {personal
                ? "A loop lands here when it is yours to work, when nobody else can take it, when somebody escalates it to you or asks for your help, or when it is waiting on your decision."
                : "A loop opens by itself the moment one of your trucks becomes available or is expected to go empty. Nothing here is waiting on you."}
            </p>
          </div>
        ) : (
          /*
           * Three columns where there is room, stacked where there is not.
           *
           * `Needs a load` is given half the width at the wide breakpoint: its
           * cards carry a map, a clock, a state and a sentence, and the other
           * two lanes are one line per truck. Equal thirds would squeeze the
           * only lane anybody works from.
           */
          <div className="grid gap-4 lg:grid-cols-4">
            <Lane
              lane="needs_load"
              cards={lanes.needs_load}
              className="lg:col-span-2"
              empty="Nothing is waiting for work."
            >
              {lanes.needs_load.map((card) => (
                <FullCard
                  key={card.loopId}
                  card={card}
                  busy={busyLoopId === card.loopId}
                  onOpenInline={() =>
                    setOpen({ kind: card.inlineAction!.kind, card, id: card.inlineAction!.id })}
                  onOpenActions={() => setOpen({ kind: "actions", card })}
                />
              ))}
            </Lane>

            <Lane
              lane="rolling"
              cards={lanes.rolling}
              empty="Nothing has left yet. A truck moves here only when the rate confirmation is signed and back AND the driver has started for the pickup."
            >
              {lanes.rolling.map((card) => (
                <CompactRow
                  key={card.loopId}
                  card={card}
                  onOpenActions={() => setOpen({ kind: "actions", card })}
                />
              ))}
            </Lane>

            <Lane
              lane="not_ready"
              cards={lanes.not_ready}
              empty="Every open cycle can be dispatched."
              note="Still real cycles, still counting, still somebody's."
            >
              {lanes.not_ready.map((card) => (
                <CompactRow
                  key={card.loopId}
                  card={card}
                  onOpenActions={() => setOpen({ kind: "actions", card })}
                />
              ))}
            </Lane>
          </div>
        )}
      </div>

      {personal ? <HandledByOthers board={board} /> : null}
      <DispatchedOut board={board} />

      <p className="mt-3 text-[0.75rem] leading-relaxed text-fg-subtle">
        A card is the conclusion, not the file: the truck, the driver, the trailer and the
        load keep their own records and this reads them. Contacting brokers is not built
        yet — messages can be prepared and read, but nothing is sent, and a broker&rsquo;s
        reply is recorded by a person. What is real here is the cycle itself: who is
        responsible, what is standing in the way, and what happened to it.
      </p>

      {open?.kind === "broker_reply" && open.id ? (
        <BrokerReplyDialog
          card={open.card}
          negotiationId={open.id}
          ctx={ctx}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {open?.kind === "rate_con" ? (
        <RateConDialog card={open.card} ctx={ctx} onClose={() => setOpen(null)} />
      ) : null}
      {open?.kind === "actions" ? (
        <LoopActionsDialog
          card={open.card}
          assignableTo={board.assignableTo}
          busy={busyLoopId === open.card.loopId}
          handlers={handlersFor(open.card)}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Lanes                                                                       */
/* -------------------------------------------------------------------------- */

const LANE_ACCENT: Record<MtLoopLane, string> = {
  needs_load: "border-st-warning text-st-warning",
  rolling: "border-st-success text-st-success",
  not_ready: "border-border-strong text-fg-muted",
};

function Lane({
  lane, cards, children, className, empty, note,
}: {
  lane: MtLoopLane;
  cards: MtLoopCard[];
  children: React.ReactNode;
  className?: string;
  /** What this lane being empty MEANS. Never just "nothing here". */
  empty: string;
  note?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div
        className={cn(
          "flex items-center gap-2 border-b-2 pb-1.5",
          LANE_ACCENT[lane],
        )}
      >
        <span className="text-[0.75rem] font-semibold tracking-wide uppercase">
          {MT_LOOP_LANE_LABEL[lane]}
        </span>
        <span className="text-[0.75rem] tabular-nums">{cards.length}</span>
      </div>

      {cards.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-3 text-[0.75rem] leading-relaxed text-fg-muted">
          {empty}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">{children}</ul>
      )}

      {note && cards.length > 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-2 text-[0.6875rem] leading-relaxed text-fg-subtle">
          {note}
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Cards                                                                       */
/* -------------------------------------------------------------------------- */

/** The badge tone. Coloured only when the ball is with the person reading. */
function progressTone(progress: MtLoopProgress) {
  if (progress.key === "stopped") return "danger" as const;
  if (progress.key === "rolling") return "success" as const;
  return progress.yourTurn ? ("info" as const) : ("neutral" as const);
}

/**
 * How long this truck has been earning nothing, or when it stops.
 *
 * The clock is the point of the whole board, so it is the one number set in a
 * larger, tabular face. A truck that is not empty yet gets the time it comes
 * free instead — counting up from a moment that has not happened would be a
 * made-up number.
 */
function Dwell({ card, compact }: { card: MtLoopCard; compact?: boolean }) {
  // The clock ticks, and "now" comes from a hydration-safe store so the server
  // and the client never disagree about how long a truck has been sitting.
  const now = useNow();

  if (!card.emptyNow) {
    return (
      <span className="text-[0.8125rem] tabular-nums text-fg-muted">
        {card.expectedEmptyAt
          ? `empty ${new Date(card.expectedEmptyAt).toLocaleString(undefined, {
              weekday: "short", hour: "numeric", minute: "2-digit",
            })}`
          : "no empty time recorded"}
      </span>
    );
  }

  // Before the clock is readable, no number. A figure that changes on hydration
  // is worse than a blank in the one place on this board nobody should doubt.
  if (now === null) return <span className={compact ? "text-[0.75rem]" : "text-[0.875rem]"}>&nbsp;</span>;

  const since = card.expectedEmptyAt ?? card.openedAt;
  const minutes = Math.max(0, Math.floor((now - Date.parse(since)) / 60_000));
  const hours = Math.floor(minutes / 60);
  // Minutes under the hour, because "0h empty" on a truck that came free forty
  // minutes ago reads as a rounding error rather than as a clock.
  const label = hours >= 24
    ? `${Math.floor(hours / 24)}d ${hours % 24}h empty`
    : hours >= 1
      ? `${hours}h empty`
      : `${minutes}m empty`;

  return (
    <span
      className={cn(
        "font-semibold tabular-nums",
        compact ? "text-[0.75rem]" : "text-[0.875rem]",
        hours >= 12 ? "text-st-danger" : "text-st-warning",
      )}
    >
      {label}
    </span>
  );
}

/**
 * The truck's mark.
 *
 * ★ AN ICON, BECAUSE THERE IS NO PHOTOGRAPH TO SHOW ★
 * The approved design puts the truck's own photo here. No truck record in
 * Antcolos carries one — not `Truck`, not `FleetTruck`, not the document store —
 * so there is nothing to render, and a stock photograph of somebody else's
 * vehicle would be worse than a silhouette. The shape is kept so the picture
 * drops straight in when the field exists.
 */
function TruckMark({ size = "lg" }: { size?: "lg" | "sm" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-sm border border-border bg-surface-sunken",
        size === "lg" ? "size-10" : "size-8",
      )}
    >
      <Truck className={cn("text-fg-subtle", size === "lg" ? "size-5" : "size-4")} />
    </span>
  );
}

/**
 * One truck somebody is going to act on.
 *
 * ★ THE WHOLE CARD IS THE LINK ★
 * Clicking anywhere opens that truck's own MT Loop page, through a stretched
 * anchor that covers the card at `z-1`. The action row sits above it at `z-2`,
 * so pressing "Read the reply" opens the reply over the board and does not
 * navigate. A button cannot be nested inside an anchor, which is exactly why
 * the anchor is a sibling that covers rather than a wrapper.
 *
 * Everything outside the action row is plain text with no interactive element,
 * so the covering anchor takes nothing away from a keyboard: one tab stop for
 * the truck, one for each button.
 */
function FullCard({
  card, busy, onOpenInline, onOpenActions,
}: {
  card: MtLoopCard;
  busy: boolean;
  onOpenInline: () => void;
  onOpenActions: () => void;
}) {
  // Anything that stops a dispatch is on the face of the card, always. The
  // explanation can be collapsed; the blocker cannot.
  const stopping = card.blockers.filter((b) => b.stopsDispatch);

  return (
    <li
      // The loop this row is about, so a caller can find one row among several
      // without matching on copy that is meant to change.
      data-loop-id={card.loopId}
      data-truck-unit={card.truckUnit}
      data-lane={card.lane}
      data-progress={card.progress.key}
      className="relative flex flex-col gap-2 rounded-md border border-border border-l-4 border-l-st-warning bg-surface-sunken px-3 py-2.5"
    >
      <Link
        href={`/dispatch/trucks/${card.truckId}`}
        aria-label={`Open unit ${card.truckUnit}`}
        className="absolute inset-0 z-1 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      />

      <div className="flex items-start gap-2.5">
        <TruckMark />
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[1rem] font-semibold text-fg">
            {card.truckUnit}
          </span>
          <span className="block text-[0.6875rem] text-fg-muted">
            {card.equipment.replace(/_/g, " ")} · {card.carrierName}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <Dwell card={card} />
          {card.position ? (
            <>
              <MiniMap position={card.position} />
              <PositionCaption position={card.position} />
            </>
          ) : null}
        </span>
      </div>

      {card.service ? <ServiceChip card={card} /> : null}

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge tone={progressTone(card.progress)}>
          {card.progress.key === "broker_replied" ? (
            <MessageSquare className="size-3" aria-hidden />
          ) : null}
          {card.progress.label}
        </Badge>
        <span className="text-[0.6875rem] text-fg-muted">{card.progress.note}</span>
        {card.progress.detail ? (
          <span className="text-[0.6875rem] text-fg-subtle">· {card.progress.detail}</span>
        ) : null}
      </div>

      <p className="text-[0.8125rem] leading-snug text-fg">{card.headline}</p>

      {/* Never collapsed, never behind a disclosure, whatever else is on the
          card. A dispatch-stopping conflict is the one thing that has to be
          readable without opening anything. */}
      {stopping.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {stopping.map((b) => {
            /*
             * The blocker always shows. Its SENTENCE does not, when the card
             * has just said it — the headline is written from the leading
             * stopping blocker, and the badge names an outstanding rate
             * confirmation in three words. Printing the paragraph again under
             * both is what made these cards unreadable. The full text is one
             * click away, in the panel, with the evidence beside it.
             */
            const echoed = b.detail === card.headline
              || (b.key === "unconfirmed_load"
                && (card.progress.key === "waiting_rate_con"
                  || card.progress.key === "rate_con_ready"));
            return (
              <li
                key={b.key}
                title={b.detail}
                className="text-[0.75rem] leading-relaxed text-st-danger"
              >
                <span className="font-medium">{b.label}</span>
                {echoed ? null : <>: {b.detail}</>}
              </li>
            );
          })}
        </ul>
      ) : null}

      <Responsibility card={card} />

      <div className="relative z-2 flex flex-wrap items-center gap-2">
        {card.inlineAction ? (
          <Button variant="primary" size="sm" disabled={busy} onClick={onOpenInline}>
            {card.inlineAction.label}
          </Button>
        ) : card.nextAction ? (
          <Button
            variant={card.nextAction.notYours ? "secondary" : "primary"}
            size="sm"
            asChild
            title={card.nextAction.reason}
          >
            <Link href={card.nextAction.href}>{card.nextAction.label}</Link>
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          aria-label={`Everything you can do to unit ${card.truckUnit}`}
          onClick={onOpenActions}
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </Button>
      </div>
    </li>
  );
}

/**
 * One truck that is either already moving or cannot move at all.
 *
 * Deliberately one line of substance. A rolling truck is not a decision, and a
 * truck nobody may dispatch is a decision somebody else has to make first — so
 * both get a unit, where they are, what state they are in, and a way in. The
 * clock keeps running on the ones that are not ready, which is the entire
 * reason they stay on the board.
 */
function CompactRow({
  card, onOpenActions,
}: {
  card: MtLoopCard;
  onOpenActions: () => void;
}) {
  const stopping = card.blockers.filter((b) => b.stopsDispatch);
  const lead = stopping[0];
  const rolling = card.lane === "rolling";
  const where = [card.position?.city, card.position?.state]
    .filter(Boolean)
    .join(", ")
    || [card.expectedEmptyCity, card.expectedEmptyState].filter(Boolean).join(", ");

  return (
    <li
      data-loop-id={card.loopId}
      data-truck-unit={card.truckUnit}
      data-lane={card.lane}
      data-progress={card.progress.key}
      className={cn(
        "relative flex flex-col gap-1 rounded-md border bg-surface-sunken px-2.5 py-2",
        rolling ? "border-border border-l-4 border-l-st-success" : "border-border",
      )}
    >
      <Link
        href={`/dispatch/trucks/${card.truckId}`}
        aria-label={`Open unit ${card.truckUnit}`}
        className="absolute inset-0 z-1 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      />

      {/*
        The identifying line. Everything that competes for horizontal space —
        the mark, the map, the way in — lives here, so the sentences below get
        the full width of a narrow lane instead of wrapping one word at a time.
      */}
      <div className="flex items-center gap-2">
        <TruckMark size="sm" />
        <span className="min-w-0 flex-1 font-mono text-[0.875rem] font-semibold text-fg">
          {card.truckUnit}
        </span>
        {card.position ? (
          <span className="shrink-0">
            <MiniMap position={card.position} width={44} height={26} />
          </span>
        ) : null}
        <span className="relative z-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Everything you can do to unit ${card.truckUnit}`}
            onClick={onOpenActions}
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </Button>
        </span>
      </div>

      {where ? (
        <span className="text-[0.6875rem] leading-snug text-fg-muted">{where}</span>
      ) : null}

      {/*
        The reason it is in this lane, in the words the blocker itself uses.
        A row that only said "Not ready" would move the question rather than
        answer it — and a rolling row leads with the fact that it is rolling,
        because a truck that has gone is not stopped by anything.
      */}
      <span
        className={cn(
          "text-[0.75rem] leading-snug",
          rolling ? "text-st-success" : "text-st-danger",
        )}
        title={rolling ? card.headline : lead?.detail ?? card.headline}
      >
        {rolling ? card.progress.label : lead?.label ?? card.progress.label}
        {card.emptyNow && !rolling ? (
          <span className="text-fg-muted"> · <Dwell card={card} compact /></span>
        ) : null}
      </span>

      {/*
        ★ STILL SHOWN ON A MOVING TRUCK ★
        A load that left without a signed rate confirmation coming back is
        rolling AND owed for. Dropping the line would be the honest-looking
        version of hiding it: the truck is not stopped, and somebody still has
        to chase the paper before the load can be billed.
      */}
      {rolling && lead ? (
        <span className="text-[0.6875rem] leading-snug text-st-warning" title={lead.detail}>
          {lead.label}
          {stopping.length > 1 ? ` and ${stopping.length - 1} more` : ""} — still outstanding
        </span>
      ) : null}

      <Responsibility card={card} compact />
    </li>
  );
}

/**
 * Service the Maintenance module says is falling due on this truck.
 *
 * On the card because a load booked onto a truck that is about to go into the
 * shop is a load somebody has to move again — and read from Maintenance, whose
 * intervals, meters and due arithmetic these are. Out of service is a different
 * colour and a different sentence, because it is a hard stop rather than a
 * warning, and it is why the cycle is in the Not ready lane.
 */
function ServiceChip({ card }: { card: MtLoopCard }) {
  const s = card.service!;
  const hard = s.outOfService || s.state === "overdue";
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[0.6875rem]",
        hard
          ? "border-st-danger/40 bg-st-danger-bg/50 text-st-danger"
          : "border-st-warning/40 bg-st-warning-bg/50 text-st-warning",
      )}
    >
      <Wrench className="size-3" aria-hidden />
      {s.outOfService
        ? `Out of service · ${s.title}`
        : `${s.title} ${s.due}`}
    </span>
  );
}

/**
 * ★ TWO FACTS, AND THE ORDER MATTERS ★
 *
 * Who is responsible comes from the Responsibility Engine and is the same
 * answer My work, Needs You and Home are showing. Whether anybody has ACCEPTED
 * it is this module's own fact, and it is second because it is the lesser
 * question: a loop nobody has picked up is still somebody's.
 *
 * This line used to read "Nobody is responsible for this yet" off a field on
 * the loop, about loops the engine had routed to a named dispatcher. That
 * sentence is why the distinction is kept.
 */
function Responsibility({ card, compact }: { card: MtLoopCard; compact?: boolean }) {
  return (
    <span
      className={cn(
        "block text-fg-subtle",
        compact ? "text-[0.6875rem] leading-snug" : "truncate text-[0.75rem]",
      )}
    >
      {card.responsible ? (
        <>
          <span className={card.isMine ? "font-medium text-fg-muted" : undefined}>
            {card.isMine ? "You are" : `${card.responsible.displayName} is`} responsible
          </span>
        </>
      ) : (
        <span className="text-st-warning">Could not read who is responsible</span>
      )}
      {card.claimed
        ? card.claimed.isMine
          ? " · you claimed it"
          : ` · claimed by ${card.claimed.displayName}`
        : " · not claimed yet"}
      {card.responsible?.noEligibleAssignee ? (
        <span className="text-st-warning"> · nobody here holds what this needs</span>
      ) : null}
    </span>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Trucks this carrier has handed to somebody else to dispatch.
 *
 * ★ THE OUTWARD HALF OF THE SAME IDEA ★
 * `HandledByOthers` summarises work a colleague is doing. This summarises work
 * another ORGANIZATION is doing, and it is shown on every scope — a carrier
 * looking at their complete board should still not be given operational cards
 * for trucks an agency is covering, because those cycles are not theirs to
 * work. They reach the carrier when the agency asks, and then they arrive as
 * an item in Needs You with a name and a reason on it.
 */
function DispatchedOut({ board }: { board: MtLoopBoard }) {
  const { count, byOrganization } = board.dispatchedOut;
  if (count === 0) return null;

  const who = byOrganization.length === 1
    ? byOrganization[0].name
    : byOrganization.length === 2
      ? `${byOrganization[0].name} and ${byOrganization[1].name}`
      : `${byOrganization.length} dispatch organizations`;

  return (
    <section
      aria-label="Dispatched by another organization"
      className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-dashed border-border px-3.5 py-2.5"
    >
      <p className="min-w-0 flex-1 text-[0.8125rem] leading-relaxed text-fg-muted">
        <span className="font-medium text-fg">
          {count} of your {count === 1 ? "trucks is" : "trucks are"} dispatched by {who}
        </span>
        . They will ask if they need you.
      </p>
      <Link
        href="/needs-you"
        className="text-[0.75rem] font-medium text-primary hover:underline"
      >
        Anything they have asked
      </Link>
    </section>
  );
}

/**
 * Everything the team is handling, as one line.
 *
 * ★ OVERSIGHT MOVED, NOT DELETED ★
 * This is the whole of a delegated loop's presence on a personal Home: a count,
 * who has them, and two links to the places built for looking. No card, no
 * buttons, nothing to act on — because acting on somebody else's healthy loop
 * from your Home screen is not oversight, it is interference, and the person
 * reading it has not been asked to do anything.
 *
 * The loops are all still there: on the dispatch board, in Team oversight, in
 * All organization. `/needs-you` is where the three views live and is the right
 * destination for "who is holding what"; `/dispatch` is the complete board.
 */
function HandledByOthers({ board }: { board: MtLoopBoard }) {
  const { count, holders } = board.handledByOthers;
  if (count === 0) return null;

  const who = holders.length === 1
    ? holders[0].displayName
    : holders.length === 2
      ? `${holders[0].displayName} and ${holders[1].displayName}`
      : "your dispatch team";

  return (
    <section
      aria-label="Handled by your team"
      className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-surface-sunken px-3.5 py-2.5"
    >
      <p className="min-w-0 flex-1 text-[0.8125rem] leading-relaxed text-fg-muted">
        <span className="font-medium text-fg">
          {count} Empty {count === 1 ? "Loop is" : "Loops are"} being handled by {who}
        </span>
        . Nothing there is waiting on you.
      </p>
      <span className="flex items-center gap-3">
        <Link
          href="/needs-you"
          className="text-[0.75rem] font-medium text-primary hover:underline"
        >
          Team oversight
        </Link>
        <Link
          href="/dispatch"
          className="text-[0.75rem] font-medium text-primary hover:underline"
        >
          All loops
        </Link>
      </span>
    </section>
  );
}
