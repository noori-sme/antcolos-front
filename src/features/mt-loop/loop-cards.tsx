"use client";

import { AlertTriangle, MessageSquare, MoreHorizontal, Truck, Wrench } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { MtLoopCard, MtLoopProgress } from "@/types";
import { MiniMap, PositionCaption } from "./mini-map";
import { Tip } from "./tip";
import { cn, useNow } from "@/lib/utils";

/**
 * One truck, as a card — for the board and for the rail beside a truck's page.
 *
 * ★ ONE IMPLEMENTATION, TWO PLACES ★
 * The rail on a truck's own page is the board: the same lanes, the same cards,
 * so somebody working down a list can see what they would be switching to
 * without losing the detail that made them pick this one. Writing a second,
 * smaller card for the rail is how the two start disagreeing — the board says
 * a broker has come back and the rail says nothing, and the dispatcher
 * believes whichever they looked at last. So there is one of each, here.
 *
 * ★ WHAT A CARD IS ★
 * The conclusion, not the file. A truck's specification, a driver's paperwork
 * and a trailer's dimensions all have permanent records with pages of their
 * own; these read them and say what they MEAN right now — where the cycle has
 * got to, whose turn it is, what is in the way, and who is answerable.
 */

/* -------------------------------------------------------------------------- */
/* Cards                                                                       */
/* -------------------------------------------------------------------------- */

/** The badge tone. Coloured only when the ball is with the person reading. */
export function progressTone(progress: MtLoopProgress) {
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
export function Dwell({ card, compact }: { card: MtLoopCard; compact?: boolean }) {
  // The clock ticks, and "now" comes from a hydration-safe store so the server
  // and the client never disagree about how long a truck has been sitting.
  const now = useNow();

  /*
   * ★ THE CLOCK STOPS WHEN THE TRUCK ROLLS ★
   * `emptyNow` only means the expected empty time has passed, so a truck that
   * went empty this morning and is now loaded and moving kept counting: the
   * header read "Rolling · 6h empty" about a truck that had stopped costing
   * money hours ago. The empty clock is the one number on this board nobody
   * should have to second-guess.
   */
  if (card.lane === "rolling") {
    return (
      <span className={cn("font-medium text-st-success", compact ? "text-[0.75rem]" : "text-[0.8125rem]")}>
        clock stopped
      </span>
    );
  }

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
export function TruckMark({ size = "lg" }: { size?: "lg" | "sm" }) {
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
export function FullCard({
  card, busy, onOpenInline, onOpenActions, active, linkOnly,
}: {
  card: MtLoopCard;
  busy: boolean;
  onOpenInline?: () => void;
  onOpenActions?: () => void;
  /** This is the truck whose page is open. Marked, not made unclickable. */
  active?: boolean;
  /**
   * A way in and nothing else.
   *
   * Set on the rail beside a truck's own page: the inline panel and the
   * actions sheet both open OVER the page you are on, which is the wrong
   * place for them when the card is about a different truck. Not rendering
   * them is honest; rendering them and making them do something else is not.
   */
  linkOnly?: boolean;
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
      data-active={active ? "true" : undefined}
      className={cn(
        "relative flex flex-col gap-2 rounded-md border border-l-4 border-l-st-warning px-3 py-2.5",
        active
          ? "border-primary bg-surface ring-1 ring-primary/30"
          : "border-border bg-surface-sunken",
      )}
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

      {/* Facts, and only when they add something the badge has not said. */}
      {card.headline ? (
        card.headlineDetail ? (
          <Tip text={card.headlineDetail} className="w-fit no-underline">
            <span className="text-[0.8125rem] font-medium text-fg">{card.headline}</span>
          </Tip>
        ) : (
          <p className="text-[0.8125rem] font-medium text-fg">{card.headline}</p>
        )
      ) : null}

      {/* Never collapsed, never behind a disclosure, whatever else is on the
          card. A dispatch-stopping conflict is the one thing that has to be
          readable without opening anything. */}
      {/*
        ★ THE BLOCKER STAYS. ITS PARAGRAPH DOES NOT. ★
        Anything that stops a dispatch is on the face of the card, in red, by
        name — that rule has not moved. What moved is the SENTENCE behind it,
        into the tip and the actions panel, because printing it under a
        headline that already said it is what made these cards unreadable.
      */}
      {stopping.length > 0 ? (
        <ul className="flex flex-wrap gap-x-3 gap-y-1">
          {stopping.map((b) => (
            <li key={b.key} className="flex items-center gap-1 text-[0.75rem] text-st-danger">
              <AlertTriangle className="size-3 shrink-0" aria-hidden />
              <Tip text={b.detail}>
                <span className="font-medium">{b.label}</span>
              </Tip>
            </li>
          ))}
        </ul>
      ) : null}

      <Responsibility card={card} />

      {linkOnly ? null : (
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
      )}
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
export function CompactRow({
  card, onOpenActions, active, linkOnly,
}: {
  card: MtLoopCard;
  onOpenActions?: () => void;
  /** This is the truck whose page is open. Marked, not made unclickable. */
  active?: boolean;
  /** A way in and nothing else. See `FullCard`. */
  linkOnly?: boolean;
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
      data-active={active ? "true" : undefined}
      className={cn(
        "relative flex flex-col gap-1 rounded-md border px-2.5 py-2",
        rolling ? "border-l-4 border-l-st-success" : "",
        active
          ? "border-primary bg-surface ring-1 ring-primary/30"
          : "border-border bg-surface-sunken",
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
        {linkOnly ? null : (
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
        )}
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
export function ServiceChip({ card }: { card: MtLoopCard }) {
  const s = card.service!;
  const hard = s.outOfService || s.state === "overdue";
  return (
    <span
      title={s.outOfService
        ? `${s.title}. The truck may not move until the hold is lifted.`
        : `${s.title} — ${s.due}. Read from the Maintenance module.`}
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[0.6875rem]",
        hard
          ? "border-st-danger/40 bg-st-danger-bg/50 text-st-danger"
          : "border-st-warning/40 bg-st-warning-bg/50 text-st-warning",
      )}
    >
      <Wrench className="size-3" aria-hidden />
      {s.outOfService ? "Out of service" : `${s.title}: ${s.due}`}
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
export function Responsibility({ card, compact }: { card: MtLoopCard; compact?: boolean }) {
  return (
    /*
     * ★ TWO FACTS, AND THE ORDER STILL MATTERS — IN FOUR WORDS ★
     * "Paige Ellery is responsible · not claimed yet" is eight words for two
     * facts: whose it is, and whether they have picked it up. The name carries
     * the first; the dot carries the second; the tip carries the distinction
     * for anybody who needs it spelled out.
     */
    <Tip
      className={cn("block no-underline", compact ? "text-[0.6875rem]" : "text-[0.75rem]")}
      text={card.responsible
        ? `${card.responsible.displayName} is responsible for this cycle`
          + (card.claimed ? " and has accepted it." : " and has not accepted it yet.")
          + (card.responsible.noEligibleAssignee
            ? " Nobody in this workspace holds what this needs."
            : "")
        : "The responsibility layer could not be read for this cycle."}
    >
      <span className="flex items-center gap-1 text-fg-subtle">
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            card.claimed ? "bg-st-success" : "bg-st-warning",
          )}
        />
        <span className={cn("truncate", card.isMine && "text-fg-muted")}>
          {card.responsible
            ? card.isMine ? "You" : card.responsible.displayName
            : "Unknown"}
        </span>
      </span>
    </Tip>
  );
}

