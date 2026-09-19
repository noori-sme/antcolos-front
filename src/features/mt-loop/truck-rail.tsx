"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import {
  MT_LOOP_LANE_LABEL,
  type MtLoopBoard, type MtLoopCard, type MtLoopLane,
} from "@/types";
import { CompactRow, FullCard } from "./loop-cards";
import { InfoTip } from "./tip";
import { cn } from "@/lib/utils";

/**
 * The board, kept beside the truck you opened from it.
 *
 * ★ WHY THE LIST DOES NOT GO AWAY ★
 * Opening a truck used to replace the board, so choosing a different one meant
 * going back, finding your place and reading the lane again. A dispatcher works
 * a list: they open the most expensive truck, find it is waiting on a broker,
 * and move to the next one. The rail is that list, still there, with the truck
 * they are on marked.
 *
 * ★ AND IT IS THE SAME CARD, NOT A SMALLER ONE ★
 * `Needs a load` keeps the whole card — the clock, the map, the badge, the
 * sentence, the blocker — because that is the lane somebody might switch INTO,
 * and a stripped-down version would mean deciding on less than the board
 * showed. `Rolling` and `Not ready` are one line each, because those are
 * trucks being watched rather than worked. Both come from `loop-cards`, so
 * the rail and the board cannot drift apart.
 *
 * The rail is hidden below the extra-large breakpoint. On a narrower screen
 * the truck's own page is the whole job, and a list squeezed beside it would
 * make both unreadable — "Back to MT Loop" is the way out there.
 */
export function TruckRail({
  board, activeTruckId,
}: {
  board?: MtLoopBoard;
  /** The truck whose page this is, marked in the list. */
  activeTruckId: string;
}) {
  if (!board || board.loops.length === 0) return null;

  const lanes: Record<MtLoopLane, MtLoopCard[]> = {
    needs_load: board.loops.filter((c) => c.lane === "needs_load"),
    rolling: board.loops.filter((c) => c.lane === "rolling"),
    not_ready: board.loops.filter((c) => c.lane === "not_ready"),
  };

  return (
    /*
     * Its own scrollbar, not the page's.
     *
     * A dispatcher scans this list while reading the panel beside it; one
     * shared scrollbar meant moving one to see the other. The height comes from
     * the parent, which pins the row to the viewport — see `TruckDispatchScreen`.
     */
    <aside
      aria-label="Empty trucks"
      className="hidden min-h-0 w-[22rem] shrink-0 flex-col gap-3 overflow-y-auto pr-1 pb-4 xl:flex"
    >
      <div>
        <Link
          href="/dispatch/loops"
          className="inline-flex items-center gap-1.5 text-[0.75rem] text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ArrowLeft className="size-3" aria-hidden />
          MT Loop
        </Link>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[0.9375rem] font-semibold text-fg">
          Empty trucks
          {/* Counts, not a sentence about counts. */}
          <span className="text-[0.6875rem] font-normal text-st-warning tabular-nums">
            {lanes.needs_load.length} load
          </span>
          <span className="text-[0.6875rem] font-normal text-st-success tabular-nums">
            {lanes.rolling.length} rolling
          </span>
          <span className="text-[0.6875rem] font-normal text-fg-muted tabular-nums">
            {lanes.not_ready.length} held
          </span>
        </p>
      </div>

      <RailLane lane="needs_load" cards={lanes.needs_load} activeTruckId={activeTruckId}>
        {lanes.needs_load.map((card) => (
          <FullCard
            key={card.loopId}
            card={card}
            busy={false}
            active={card.truckId === activeTruckId}
            /*
             * ★ NO PANELS FROM THE RAIL ★
             * The inline action and the actions sheet both open something over
             * the page you are already on, which is the wrong place for them
             * when that page is a DIFFERENT truck. From here a card is a way in
             * and nothing else, so its buttons are not rendered rather than
             * rendered and made to do something surprising.
             */
            linkOnly
          />
        ))}
      </RailLane>

      <RailLane lane="rolling" cards={lanes.rolling} activeTruckId={activeTruckId}>
        {lanes.rolling.map((card) => (
          <CompactRow
            key={card.loopId}
            card={card}
            active={card.truckId === activeTruckId}
            linkOnly
          />
        ))}
      </RailLane>

      <RailLane lane="not_ready" cards={lanes.not_ready} activeTruckId={activeTruckId}>
        {lanes.not_ready.map((card) => (
          <CompactRow
            key={card.loopId}
            card={card}
            active={card.truckId === activeTruckId}
            linkOnly
          />
        ))}
      </RailLane>

    </aside>
  );
}

const LANE_ACCENT: Record<MtLoopLane, string> = {
  needs_load: "border-st-warning text-st-warning",
  rolling: "border-st-success text-st-success",
  not_ready: "border-border-strong text-fg-muted",
};

function RailLane({
  lane, cards, children,
}: {
  lane: MtLoopLane;
  cards: MtLoopCard[];
  activeTruckId: string;
  children: React.ReactNode;
}) {
  if (cards.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className={cn("flex items-center gap-2 border-b-2 pb-1", LANE_ACCENT[lane])}>
        <span className="text-[0.6875rem] font-semibold tracking-wide uppercase">
          {MT_LOOP_LANE_LABEL[lane]}
        </span>
        <span className="text-[0.6875rem] tabular-nums">{cards.length}</span>
        <span className="flex-1" />
        {/* Why these lanes look different, for anybody who wonders. */}
        {lane === "needs_load" ? (
          <InfoTip text="The lane you might switch into, so these keep their whole card. Rolling and Not ready are one line each — you are watching them, not working them." />
        ) : null}
      </div>
      <ul className="flex flex-col gap-1.5">{children}</ul>
    </div>
  );
}
