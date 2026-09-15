"use client";

import { ChevronRight, MapPin, RefreshCw, Truck, User } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ASSIGNMENT_SOURCE_LABEL,
  FACT_VERIFICATION_LABEL, MT_LOOP_STAGE_LABEL, MT_LOOP_STATUS_LABEL,
  type FactVerification, type MtLoopBoard, type MtLoopCard, type MtLoopStage,
} from "@/types";
import {
  assignLoop, blockLoop, claimLoop, closeLoopById, escalateLoopToCarrier,
  pauseLoop, releaseLoop, resumeLoop, unblockLoop,
  type MtLoopContext, type MtLoopOutcome,
} from "@/lib/api/mock/mt-loop";
import { AvailabilityChip, BasisChip } from "@/features/tracking/chips";
import { cn } from "@/lib/utils";

/**
 * The MT Loop board.
 *
 * First thing on the dispatch dashboard, in every dispatch workspace and for a
 * carrier owner who dispatches their own trucks — because an empty truck is the
 * most expensive thing on the screen, and the longer it stays empty the more it
 * costs.
 *
 * The panel renders what the service gives it and decides nothing. Every button
 * on a row comes from that row's `can`, which the service worked out beside the
 * records; the screen never asks whether somebody is an owner and never checks a
 * role name. Each action is re-checked inside the service too, so a board left
 * open in a tab cannot be used to do something the person may no longer do.
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
   * What this screen renders as a full card.
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
            <span>{shown.filter((c) => c.emptyNow).length} empty now</span>
            <span>{shown.filter((c) => !c.claimed).length} not claimed</span>
            {shown.filter((c) => c.status === "blocked").length > 0 ? (
              <span className="text-st-danger">
                {shown.filter((c) => c.status === "blocked").length} blocked
              </span>
            ) : null}
            {shown.filter((c) => c.status === "paused").length > 0 ? (
              <span>{shown.filter((c) => c.status === "paused").length} paused</span>
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
          <ul className="space-y-2">
            {shown.map((loop) => (
              <LoopRow
                key={loop.loopId}
                loop={loop}
                assignableTo={board.assignableTo}
                busy={busyLoopId === loop.loopId}
                onClaim={() => run(loop.loopId, () => claimLoop(loop.loopId, ctx!), "It is yours now.")}
                onRelease={() =>
                  run(loop.loopId, () => releaseLoop(loop.loopId, ctx!), "Handed back to the queue.")}
                onAssign={(membershipId, name) =>
                  run(loop.loopId, () => assignLoop(loop.loopId, membershipId, name, ctx!), `Given to ${name}.`)}
                onPause={(reason) =>
                  run(loop.loopId, () => pauseLoop(loop.loopId, reason, 8, ctx!), "Paused for 8 hours.")}
                onResume={() => run(loop.loopId, () => resumeLoop(loop.loopId, ctx!), "Back on it.")}
                onBlock={(reason) =>
                  run(loop.loopId, () => blockLoop(loop.loopId, reason, ctx!), "Blocked.")}
                onUnblock={() => run(loop.loopId, () => unblockLoop(loop.loopId, ctx!), "Unblocked.")}
                onClose={(reason) =>
                  run(loop.loopId, () => closeLoopById(loop.loopId, reason, ctx!), "This cycle is closed.")}
                onEscalateToCarrier={(reason) =>
                  run(
                    loop.loopId,
                    () => escalateLoopToCarrier(loop.loopId, reason, ctx!),
                    "The carrier has been asked. You still have the truck.",
                  )}
              />
            ))}
          </ul>
        )}
      </div>

      {personal ? <HandledByOthers board={board} /> : null}
      <DispatchedOut board={board} />

      <p className="mt-3 text-[0.75rem] leading-relaxed text-fg-subtle">
        Open a truck to search for a load for it. Contacting brokers and negotiating rates are not
        built yet: messages can be prepared and read, but nothing is sent. What is real here is the
        cycle itself — who is responsible, what is standing in the way, and what happened to it —
        all of it kept on the loop and none of it overwritten.
      </p>
    </section>
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

/* -------------------------------------------------------------------------- */

const STATUS_TONE: Record<string, "neutral" | "info" | "progress" | "success" | "warning" | "danger"> = {
  unclaimed: "warning",
  working: "info",
  covered: "progress",
  running: "progress",
  paused: "neutral",
  blocked: "danger",
  closed: "neutral",
};

/**
 * Stage tones, read as a progression: something wrong, something waiting,
 * something moving, something done. `empty_unworked` is a warning because an
 * empty truck nobody has picked up is the most expensive thing on the screen.
 */
const STAGE_TONE: Record<MtLoopStage, "neutral" | "info" | "progress" | "success" | "warning" | "danger"> = {
  stopped: "danger",
  empty_unworked: "warning",
  going_empty: "info",
  finding_work: "info",
  booked_unconfirmed: "warning",
  confirmed: "success",
  dispatched: "progress",
  running: "progress",
};

/**
 * How much one piece of evidence is worth, at a glance.
 *
 * `inferred` is deliberately not a success tone: a geofence suggesting a truck is
 * empty and a driver saying so are different things to book a load against.
 */
const EVIDENCE_TONE: Record<FactVerification, "neutral" | "info" | "success" | "warning" | "danger"> = {
  confirmed: "success",
  corrected: "success",
  inferred: "info",
  extracted: "info",
  pending: "warning",
  rejected: "danger",
  failed: "danger",
};

/** The three actions that need a reason before they are allowed to happen. */
type ReasonAction = "pause" | "block" | "close" | "escalateToCarrier";

const REASON_PROMPT: Record<ReasonAction, { title: string; placeholder: string; confirm: string }> = {
  pause: {
    title: "Why are you putting this down?",
    placeholder: "Waiting on the carrier to call back",
    confirm: "Pause for 8 hours",
  },
  block: {
    title: "What is standing in the way?",
    placeholder: "Insurance lapsed on the carrier side",
    confirm: "Block this loop",
  },
  close: {
    title: "Why are you closing this cycle?",
    placeholder: "Carrier took the truck back",
    confirm: "Close this loop",
  },
  escalateToCarrier: {
    // The one action that crosses an organization boundary, so the wording
    // says out loud what it does and what it does not do.
    title: "What do you need the carrier to decide?",
    placeholder: "Broker wants $200 over your floor. Your call.",
    confirm: "Escalate to the carrier",
  },
};

function LoopRow({
  loop, assignableTo, busy,
  onClaim, onRelease, onAssign, onPause, onResume, onBlock, onUnblock, onClose,
  onEscalateToCarrier,
}: {
  loop: MtLoopCard;
  assignableTo?: Array<{ membershipId: string; name: string }>;
  busy: boolean;
  onClaim: () => void;
  onRelease: () => void;
  onAssign: (membershipId: string, name: string) => void;
  onPause: (reason: string) => void;
  onResume: () => void;
  onBlock: (reason: string) => void;
  onEscalateToCarrier: (reason: string) => void;
  onUnblock: () => void;
  onClose: (reason: string) => void;
}) {
  const [asking, setAsking] = useState<ReasonAction | null>(null);
  const [reason, setReason] = useState("");
  const [handing, setHanding] = useState(false);

  const where = [loop.expectedEmptyCity, loop.expectedEmptyState].filter(Boolean).join(", ");
  const others = (assignableTo ?? []).filter(
    (p) => p.membershipId !== loop.claimed?.membershipId,
  );

  function submitReason() {
    const action = asking;
    const text = reason.trim();
    if (!action || !text) return;
    setAsking(null);
    setReason("");
    if (action === "pause") onPause(text);
    else if (action === "block") onBlock(text);
    else if (action === "escalateToCarrier") onEscalateToCarrier(text);
    else onClose(text);
  }

  return (
    <li
      // The loop this row is about, so a caller can find one row among several
      // without matching on copy that is meant to change.
      data-loop-id={loop.loopId}
      data-truck-unit={loop.truckUnit}
      className={cn(
        "rounded-md border bg-surface-sunken px-3.5 py-3",
        loop.status === "blocked" ? "border-st-danger/40" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium text-fg">
            {/* The unit opens this truck's dispatch workspace. The carrier
                context comes from the records there — nothing to switch. */}
            <Link
              href={`/dispatch/trucks/${loop.truckId}`}
              className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Truck className="size-3.5 text-fg-subtle" aria-hidden />
              Unit {loop.truckUnit}
              <ChevronRight className="size-3.5 text-fg-subtle" aria-hidden />
            </Link>
            {/* Stage is about the TRUCK's progress through this cycle; status is
                about the WORK. A loop can be "being worked" and "finding work"
                at once, and collapsing the two loses the difference between
                nobody looking and somebody looking and finding nothing. */}
            <Badge tone={STAGE_TONE[loop.stage]}>{MT_LOOP_STAGE_LABEL[loop.stage]}</Badge>
            <Badge tone={STATUS_TONE[loop.status] ?? "neutral"}>
              {MT_LOOP_STATUS_LABEL[loop.status]}
            </Badge>
            {loop.emptyNow ? <Badge tone="warning">Empty now</Badge> : null}
            {/* The availability decision that opened or last moved this cycle.
                Shown beside the status because "expected available" and "a
                person confirmed it is empty" are different amounts of certainty
                to book against, and the board should not flatten them. */}
            {loop.availability ? (
              <>
                <AvailabilityChip state={loop.availability.state} />
                <BasisChip
                  basis={loop.availability.basis}
                  confidence={loop.availability.confidence}
                />
              </>
            ) : null}
            <span className="text-[0.75rem] font-normal text-fg-muted">
              {loop.equipment.replace(/_/g, " ")} · {loop.carrierName}
            </span>
          </p>

          {loop.availability ? (
            <p className="mt-1 text-[0.75rem] leading-relaxed text-fg-muted">
              {loop.availability.rationale}
            </p>
          ) : null}

          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.75rem] text-fg-subtle">
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3" aria-hidden />
              {where || "Location not recorded"}
            </span>
            <span>
              {loop.expectedEmptyAt
                ? `Empty ${new Date(loop.expectedEmptyAt).toLocaleString(undefined, {
                    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                  })}`
                : "Empty time not recorded"}
            </span>
            {loop.driverName ? (
              <span className="inline-flex items-center gap-1">
                <User className="size-3" aria-hidden />
                {loop.driverName}
              </span>
            ) : null}
            {loop.trailerRequired ? (
              <span>{loop.trailerUnit ? `Trailer ${loop.trailerUnit}` : "No trailer on it"}</span>
            ) : null}
            {loop.loadReference ? <span>{loop.loadReference}</span> : null}
          </p>

          {/*
            ★ TWO FACTS, AND THE ORDER MATTERS ★
            Who is responsible comes from the Responsibility Engine and is the
            same answer My work, Needs You and Home are showing. Whether
            anybody has ACCEPTED it is this module's own fact, and it is second
            because it is the lesser question: a loop nobody has picked up is
            still somebody's.

            This line used to read "Nobody is responsible for this yet" off a
            field on the loop, about loops the engine had routed to a named
            dispatcher. That sentence is why this change exists.
          */}
          <p className="mt-1 text-[0.75rem] text-fg-muted">
            {loop.responsible ? (
              <>
                <span className={loop.isMine ? "font-medium text-fg" : undefined}>
                  {loop.isMine ? "You are" : `${loop.responsible.displayName} is`} responsible
                </span>
                <span className="text-fg-subtle">
                  {" "}· {ASSIGNMENT_SOURCE_LABEL[loop.responsible.source].toLowerCase()}
                </span>
              </>
            ) : (
              <span className="text-st-warning">
                Could not read who is responsible
              </span>
            )}
            {loop.claimed
              ? ` · ${loop.claimed.isMine ? "you claimed it" : `claimed by ${loop.claimed.displayName}`}`
              : " · not claimed yet"}
            {loop.handoffCount > 1 ? ` · ${loop.handoffCount} hands so far` : ""}
          </p>
          {loop.responsible?.noEligibleAssignee ? (
            <p className="mt-0.5 text-[0.75rem] text-st-warning">
              Nobody in this workspace holds what this needs yet.
            </p>
          ) : null}

          {/* Everything unresolved, not only whichever one stopped the loop. A
              cycle can be workable and still owe two things, and a board that
              shows one hides the other until the first is fixed. */}
          {loop.blockers.length > 0 ? (
            <ul className="mt-2 space-y-0.5">
              {loop.blockers.map((b) => (
                <li
                  key={b.key}
                  className={cn(
                    "text-[0.75rem] leading-relaxed",
                    b.stopsDispatch ? "text-st-danger" : "text-fg-muted",
                  )}
                >
                  <span className="font-medium">{b.label}:</span>{" "}
                  {b.href ? (
                    <Link href={b.href} className="underline-offset-4 hover:underline">
                      {b.detail}
                    </Link>
                  ) : (
                    b.detail
                  )}
                </li>
              ))}
            </ul>
          ) : null}

          {/* Why the board says what it says. Kept collapsed so a scan stays a
              scan, and every line says how much it is worth. */}
          {loop.evidence.length > 0 ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-[0.75rem] text-fg-subtle underline-offset-4 hover:underline">
                Evidence ({loop.evidence.length})
              </summary>
              <ul className="mt-1 space-y-0.5">
                {loop.evidence.map((e) => (
                  <li key={e.label + e.detail} className="flex flex-wrap items-baseline gap-x-2 text-[0.75rem] leading-relaxed">
                    <span className="font-medium text-fg">{e.label}</span>
                    <Badge tone={EVIDENCE_TONE[e.verification]}>
                      {FACT_VERIFICATION_LABEL[e.verification]}
                    </Badge>
                    <span className="text-fg-muted">
                      {e.href ? (
                        <Link href={e.href} className="underline-offset-4 hover:underline">
                          {e.detail}
                        </Link>
                      ) : (
                        e.detail
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* One next thing, deep-linked. A board that offers six options at
              every stage is a board nobody works from. */}
          {loop.nextAction ? (
            <Button
              variant={loop.nextAction.notYours ? "ghost" : "primary"}
              size="sm"
              asChild
              title={loop.nextAction.reason}
            >
              <Link href={loop.nextAction.href}>{loop.nextAction.label}</Link>
            </Button>
          ) : null}
          {loop.can.claim ? (
            <Button variant="secondary" size="sm" disabled={busy} onClick={onClaim}>
              Take it
            </Button>
          ) : null}
          {loop.isMine ? (
            <Button variant="ghost" size="sm" disabled={busy} onClick={onRelease}>
              Let it go
            </Button>
          ) : null}
          {(loop.can.assign || loop.can.reassign) && others.length > 0 ? (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setHanding((v) => !v)}>
              {loop.can.reassign ? "Hand over" : "Give to…"}
            </Button>
          ) : null}
          {loop.can.resume ? (
            <Button variant="secondary" size="sm" disabled={busy} onClick={onResume}>
              Resume
            </Button>
          ) : null}
          {loop.can.pause ? (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setAsking("pause")}>
              Pause
            </Button>
          ) : null}
          {loop.can.unblock ? (
            <Button variant="secondary" size="sm" disabled={busy} onClick={onUnblock}>
              Unblock
            </Button>
          ) : null}
          {loop.can.block ? (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setAsking("block")}>
              Block
            </Button>
          ) : null}
          {loop.can.escalateToCarrier ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setAsking("escalateToCarrier")}
            >
              Ask the carrier
            </Button>
          ) : null}
          {loop.can.close ? (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setAsking("close")}>
              Close
            </Button>
          ) : null}
        </div>
      </div>

      {handing && others.length > 0 ? (
        <div className="mt-3 rounded-md border border-border bg-surface px-3 py-2.5">
          <p className="text-[0.75rem] font-medium text-fg">Hand this loop to</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {others.map((person) => (
              <Button
                key={person.membershipId}
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setHanding(false);
                  onAssign(person.membershipId, person.name);
                }}
              >
                {person.name}
              </Button>
            ))}
            <Button variant="ghost" size="sm" onClick={() => setHanding(false)}>
              Not now
            </Button>
          </div>
        </div>
      ) : null}

      {asking ? (
        <div className="mt-3 rounded-md border border-border bg-surface px-3 py-2.5">
          <label
            htmlFor={`reason-${loop.loopId}`}
            className="text-[0.75rem] font-medium text-fg"
          >
            {REASON_PROMPT[asking].title}
          </label>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input
              id={`reason-${loop.loopId}`}
              value={reason}
              placeholder={REASON_PROMPT[asking].placeholder}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitReason();
                }
              }}
              className="max-w-sm"
            />
            <Button
              variant="primary"
              size="sm"
              disabled={busy || !reason.trim()}
              onClick={submitReason}
            >
              {REASON_PROMPT[asking].confirm}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setAsking(null);
                setReason("");
              }}
            >
              Cancel
            </Button>
          </div>
          <p className="mt-1.5 text-[0.75rem] leading-relaxed text-fg-subtle">
            The reason is kept on the loop with your name and the time, and it is never overwritten.
          </p>
        </div>
      ) : null}
    </li>
  );
}
