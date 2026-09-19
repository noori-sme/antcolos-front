"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  MT_LOOP_LANE_LABEL,
  type MtLoopBoard, type MtLoopCard, type MtLoopLane,
} from "@/types";
import {
  assignLoop, blockLoop, claimLoop, closeLoopById, escalateLoopToCarrier,
  pauseLoop, releaseLoop, resumeLoop, unblockLoop,
  type MtLoopContext, type MtLoopOutcome,
} from "@/lib/api/mock/mt-loop";
import {
  BrokerReplyDialog, LoopActionsDialog, RateConDialog, type LoopActionHandlers,
} from "./loop-dialogs";
// One card implementation, shared with the rail beside a truck's own page.
import { CompactRow, FullCard } from "./loop-cards";
import { cn } from "@/lib/utils";

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
