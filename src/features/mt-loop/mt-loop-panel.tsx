"use client";

import { ChevronRight, MapPin, RefreshCw, Truck, User } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MT_LOOP_STATUS_LABEL, type MtLoopCard, type MtLoopBoard } from "@/types";
import {
  assignLoop, blockLoop, claimLoop, closeLoopById, pauseLoop, releaseLoop,
  resumeLoop, unblockLoop, type MtLoopContext, type MtLoopOutcome,
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
export function MtLoopPanel({
  board, ctx, onChanged,
}: {
  board: MtLoopBoard;
  ctx: MtLoopContext | null;
  /** Called after any successful change so the caller can refetch. */
  onChanged: () => void;
}) {
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
              {board.counts.open}
            </span>
          </h2>
          <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
            Every truck you are responsible for that is empty or about to be, from the moment it
            goes empty until its next load has run.
          </p>
        </div>
        {board.counts.open > 0 ? (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.75rem] text-fg-subtle">
            <span>{board.counts.emptyNow} empty now</span>
            <span>{board.counts.unassigned} with nobody on them</span>
            {board.counts.blocked > 0 ? (
              <span className="text-st-danger">{board.counts.blocked} blocked</span>
            ) : null}
            {board.counts.paused > 0 ? <span>{board.counts.paused} paused</span> : null}
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
        {board.loops.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-3.5 py-4 text-center">
            <p className="text-[0.8125rem] font-medium text-fg">No trucks going empty</p>
            <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
              A loop opens by itself the moment one of your trucks becomes available or is expected
              to go empty. Nothing here is waiting on you.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {board.loops.map((loop) => (
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
              />
            ))}
          </ul>
        )}
      </div>

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

const STATUS_TONE: Record<string, "neutral" | "info" | "progress" | "success" | "warning" | "danger"> = {
  unassigned: "warning",
  working: "info",
  covered: "progress",
  running: "progress",
  paused: "neutral",
  blocked: "danger",
  closed: "neutral",
};

/** The three actions that need a reason before they are allowed to happen. */
type ReasonAction = "pause" | "block" | "close";

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
};

function LoopRow({
  loop, assignableTo, busy,
  onClaim, onRelease, onAssign, onPause, onResume, onBlock, onUnblock, onClose,
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
  onUnblock: () => void;
  onClose: (reason: string) => void;
}) {
  const [asking, setAsking] = useState<ReasonAction | null>(null);
  const [reason, setReason] = useState("");
  const [handing, setHanding] = useState(false);

  const where = [loop.expectedEmptyCity, loop.expectedEmptyState].filter(Boolean).join(", ");
  const others = (assignableTo ?? []).filter((p) => p.membershipId !== loop.responsibleMembershipId);

  function submitReason() {
    const action = asking;
    const text = reason.trim();
    if (!action || !text) return;
    setAsking(null);
    setReason("");
    if (action === "pause") onPause(text);
    else if (action === "block") onBlock(text);
    else onClose(text);
  }

  return (
    <li
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

          <p className="mt-1 text-[0.75rem] text-fg-muted">
            {loop.responsibleName
              ? `${loop.isMine ? "You are" : `${loop.responsibleName} is`} responsible`
              : "Nobody is responsible for this yet"}
            {loop.handoffCount > 1 ? ` · ${loop.handoffCount} hands so far` : ""}
          </p>

          {loop.blockReason ? (
            <p className="mt-1 text-[0.75rem] leading-relaxed text-st-danger">{loop.blockReason}</p>
          ) : null}
          {loop.pauseReason ? (
            <p className="mt-1 text-[0.75rem] leading-relaxed text-fg-muted">
              Paused: {loop.pauseReason}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
