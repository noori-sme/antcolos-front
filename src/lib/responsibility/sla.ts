import {
  BLOCKED_PAUSES_RESOLUTION_CLOCK, DEFAULT_SLA_BY_SEVERITY, SLA_WARNING_FRACTION,
} from "@/config/responsibility";
import type {
  EscalationPolicy, IsoDateTime, ResponsibilityContext, ResponsibilitySeverity,
  SlaReading, SlaState, SlaStatus, SlaTarget,
} from "@/types";

/**
 * Two clocks, read from the records and the current time.
 *
 * ███ FRONTEND ONLY — THESE ARE NOT TIMERS ███
 * Nothing in this file schedules anything. There is no `setTimeout`, no
 * interval, no background job, and a tab that is closed misses nothing because
 * there was never anything to miss. The state of an SLA is COMPUTED from
 * `openedAt`, `acknowledgedAt`, `resolvedAt` and the clock, every single time
 * it is read. Real timers, real escalation jobs and real reminder delivery
 * belong to the backend; this is what a screen can honestly say in the
 * meantime.
 *
 * Why two clocks rather than one "overdue" number: they fail differently and
 * the fix is different. Nobody has picked this up is a ROUTING problem — the
 * work went to the wrong person, or to nobody. Somebody has it and it is still
 * not done is a CAPACITY problem. An Owner looking at one combined number
 * cannot tell which of those they have, and would fix the wrong one.
 */

/* -------------------------------------------------------------------------- */
/* Targets                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The target for one piece of work.
 *
 * A policy's own target wins where it sets one; otherwise the severity default
 * applies. Both live in `config/responsibility.ts`, so a workspace changes its
 * targets by editing a policy and never by editing code.
 */
export function targetFor(
  severity: ResponsibilitySeverity,
  policy?: Pick<EscalationPolicy, "sla">,
): SlaTarget {
  return policy?.sla ?? DEFAULT_SLA_BY_SEVERITY[severity];
}

/* -------------------------------------------------------------------------- */
/* Readings                                                                    */
/* -------------------------------------------------------------------------- */

const MINUTE_MS = 60_000;

function minutesBetween(from: IsoDateTime, toMs: number): number {
  return (toMs - new Date(from).getTime()) / MINUTE_MS;
}

function addMinutes(from: IsoDateTime, minutes: number): IsoDateTime {
  return new Date(new Date(from).getTime() + minutes * MINUTE_MS).toISOString();
}

function stateFor(minutesRemaining: number, targetMinutes: number): SlaState {
  if (minutesRemaining < 0) return "breached";
  const elapsedFraction = 1 - minutesRemaining / Math.max(targetMinutes, 1);
  return elapsedFraction >= SLA_WARNING_FRACTION ? "due_soon" : "on_track";
}

/**
 * The acknowledgement clock: has anybody picked this up?
 *
 * Stops the moment somebody acknowledges, and it is "met" from then on even if
 * the resolution later runs long — because those are two different failures and
 * the first one did not happen.
 *
 * It keeps running while the work is BLOCKED, deliberately. Somebody still has
 * to pick it up and say it is blocked; a blocker nobody has acknowledged is the
 * exact case that goes unnoticed for a day.
 */
function acknowledgeReading(
  context: Pick<ResponsibilityContext, "openedAt" | "acknowledgedAt" | "resolvedAt">,
  target: SlaTarget,
  nowMs: number,
): SlaReading {
  if (context.acknowledgedAt || context.resolvedAt) {
    return { clock: "acknowledge", state: "met" };
  }
  const dueAt = addMinutes(context.openedAt, target.acknowledgeMinutes);
  const minutesRemaining = minutesBetween(dueAt, nowMs) * -1;
  return {
    clock: "acknowledge",
    state: stateFor(minutesRemaining, target.acknowledgeMinutes),
    dueAt,
    minutesRemaining: Math.round(minutesRemaining),
  };
}

/**
 * The resolution clock: is it done?
 *
 * Pauses while the work is blocked, because holding somebody to a deadline for
 * work they cannot do is how an SLA stops meaning anything. The pause is
 * configurable and being blocked is itself an escalation trigger, so nothing
 * disappears — it moves from "this is late" to "this is stuck", which is a more
 * useful thing for a manager to be told.
 *
 * Where the work carries its own operational deadline — a truck that goes empty
 * at 14:00 — that deadline wins over the policy's target when it is sooner. A
 * policy target is a service promise; a `dueAt` is physics.
 */
function resolveReading(
  context: Pick<
    ResponsibilityContext, "openedAt" | "resolvedAt" | "dueAt" | "blocked" | "blockedReason"
  >,
  target: SlaTarget,
  nowMs: number,
): SlaReading {
  if (context.resolvedAt) return { clock: "resolve", state: "met" };

  if (context.blocked && BLOCKED_PAUSES_RESOLUTION_CLOCK) {
    return {
      clock: "resolve",
      state: "paused",
      pausedReason: context.blockedReason
        ?? "The work is blocked, so the resolution clock is not running.",
    };
  }

  const policyDue = addMinutes(context.openedAt, target.resolveMinutes);
  const dueAt = context.dueAt && new Date(context.dueAt) < new Date(policyDue)
    ? context.dueAt
    : policyDue;

  const minutesRemaining = minutesBetween(dueAt, nowMs) * -1;
  const windowMinutes = Math.max(
    minutesBetween(context.openedAt, new Date(dueAt).getTime()),
    1,
  );
  return {
    clock: "resolve",
    state: stateFor(minutesRemaining, windowMinutes),
    dueAt,
    minutesRemaining: Math.round(minutesRemaining),
  };
}

/* -------------------------------------------------------------------------- */
/* The status                                                                  */
/* -------------------------------------------------------------------------- */

/** Worst first, so `worst` is a real ordering rather than a guess. */
const STATE_RANK: Record<SlaState, number> = {
  breached: 0, due_soon: 1, on_track: 2, paused: 3, met: 4,
};

export function slaFor(
  context: Pick<
    ResponsibilityContext,
    "openedAt" | "acknowledgedAt" | "resolvedAt" | "dueAt" | "blocked" | "blockedReason" | "severity"
  >,
  policy?: Pick<EscalationPolicy, "sla">,
  now: Date = new Date(),
): SlaStatus {
  const target = targetFor(context.severity, policy);
  const nowMs = now.getTime();
  const acknowledge = acknowledgeReading(context, target, nowMs);
  const resolve = resolveReading(context, target, nowMs);

  const worst = STATE_RANK[acknowledge.state] <= STATE_RANK[resolve.state]
    ? acknowledge.state
    : resolve.state;

  return { target, acknowledge, resolve, worst };
}

/** True when either clock is close or already missed. Drives the At risk queue. */
export function isAtRisk(sla: SlaStatus): boolean {
  return sla.worst === "breached" || sla.worst === "due_soon";
}

/**
 * A reading in words, for a card that has one line to say it in.
 *
 * Deliberately says "no target" rather than inventing one, and says how long
 * ago rather than rounding a breach away.
 */
export function describeReading(reading: SlaReading): string {
  switch (reading.state) {
    case "met":
      return reading.clock === "acknowledge" ? "Acknowledged" : "Done";
    case "paused":
      return reading.pausedReason ?? "Clock paused";
    case "breached": {
      const over = Math.abs(reading.minutesRemaining ?? 0);
      return `${describeMinutes(over)} over the ${reading.clock === "acknowledge" ? "acknowledgement" : "resolution"} target`;
    }
    default: {
      const left = reading.minutesRemaining ?? 0;
      return `${describeMinutes(left)} left to ${reading.clock === "acknowledge" ? "acknowledge" : "resolve"}`;
    }
  }
}

function describeMinutes(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  if (safe < 60) return `${safe} min`;
  const hours = Math.round(safe / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} days`;
}
