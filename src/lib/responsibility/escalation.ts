import {
  DEFAULT_LADDER, ESCALATED_FROM_LEVEL, KEEP_QUIETS_REMINDER_MINUTES,
  REPEATED_FAILURE_THRESHOLD, SCOPE_ENDING_WARNING_MINUTES, TRIGGER_LEAD_ACTION,
  TRIGGER_STARTS_AT_LEVEL, VISIBILITY_ONLY_STEP, VISIBILITY_ONLY_TRIGGERS,
} from "@/config/responsibility";
import type {
  EscalationPolicy, EscalationState, EscalationStep, EscalationTrigger,
  FleetProfile, IsoDateTime, ResponsibilityContext, SlaStatus,
} from "@/types";
import { ESCALATION_ACTION_MOVES_WORK } from "@/types";
import type { ResponsibilityCandidate } from "./candidate";

/**
 * ★ ESCALATION IS NOT REASSIGNMENT ★
 *
 * The rule this whole file exists to keep. When a trigger fires, the original
 * assignee is STILL RESPONSIBLE. What changes is that somebody above them can
 * see it, and that a person now has a decision to make. Nothing moves unless a
 * policy explicitly says it should, or an authorized person says so — and no
 * default policy in `config/responsibility.ts` includes a step that moves work,
 * because moving it unattended is exactly what the milestone forbids.
 *
 * `ESCALATION_ACTION_MOVES_WORK` is the machine-readable version of that
 * sentence, and `movesWork()` below is the only place anything asks the
 * question. A caller that wants to know whether to reassign asks there rather
 * than checking a level number.
 *
 * ███ FRONTEND ONLY — NOTHING HERE FIRES ███
 * An escalation state is computed from records and the clock on every read.
 * Nothing is scheduled, nothing is delivered, and no reminder is sent anywhere:
 * a `reminder` step produces a line on a card saying a reminder is due, which
 * is the honest frontend of a backend job that does not exist yet.
 */

export interface EscalationInput {
  context: ResponsibilityContext;
  policy: EscalationPolicy;
  sla: SlaStatus;
  fleetProfile: FleetProfile;
  /** Whoever currently holds the work. Absent means nobody does. */
  responsible?: ResponsibilityCandidate;
  /** True when the routing engine found nobody eligible. */
  noEligibleAssignee?: boolean;
  /** When the current holder last said "this is mine, I am on it". */
  keptAt?: IsoDateTime;
  now?: Date;
}

/* -------------------------------------------------------------------------- */
/* The ladder                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The rungs this workspace actually uses, for this trigger.
 *
 * Three things narrow the default ladder, and each of them exists for a
 * different reason:
 *
 *  1. The FLEET TIER caps how many rungs there are. A workspace of one gets
 *     one, because every rung above it points back at the same person.
 *  2. Some triggers START HIGHER. Reminding somebody who is on leave, or who
 *     has lost the permission the work needs, is noise: they cannot act. Those
 *     begin at manager visibility.
 *  3. Some triggers LEAD WITH a different action — an approval request rather
 *     than a nudge.
 *
 * A policy's own steps, where it has them, replace the default ladder entirely.
 */
export function ladderFor(
  trigger: EscalationTrigger,
  policy: EscalationPolicy,
  fleetProfile: FleetProfile,
): EscalationStep[] {
  // A standing condition gets one rung and stops. See VISIBILITY_ONLY_TRIGGERS.
  if (VISIBILITY_ONLY_TRIGGERS.includes(trigger)) return [{ ...VISIBILITY_ONLY_STEP }];

  const base = policy.steps.length > 0 ? policy.steps : [...DEFAULT_LADDER];
  const startAt = TRIGGER_STARTS_AT_LEVEL[trigger] ?? 1;
  const lead = TRIGGER_LEAD_ACTION[trigger];

  const trimmed = base
    .filter((s) => s.level >= startAt)
    .filter((s) => s.level <= Math.max(startAt, fleetProfile.escalationLevels));

  // A trigger that starts above the tier's cap still gets its first rung. A
  // suspended assignee in a one-person workspace must not silently produce no
  // escalation at all.
  const steps = trimmed.length > 0
    ? trimmed
    : base.filter((s) => s.level === startAt).slice(0, 1);

  if (!lead || steps.length === 0) return steps;
  return steps.map((s, i) => (i === 0 ? { ...s, action: lead } : s));
}

/** The one question anything should ask about a step. */
export function movesWork(step: EscalationStep): boolean {
  return ESCALATION_ACTION_MOVES_WORK[step.action];
}

/* -------------------------------------------------------------------------- */
/* Triggers                                                                    */
/* -------------------------------------------------------------------------- */

const MINUTE_MS = 60_000;

interface LiveTrigger {
  trigger: EscalationTrigger;
  since: IsoDateTime;
  detail: string;
}

/**
 * Which triggers are true right now, and since when.
 *
 * `since` is the important half. Every rung is measured from the moment the
 * trigger became true, not from when the work opened — so a step written for
 * "30 minutes after it goes overdue" means that, and a piece of work that has
 * existed for three days but only just went overdue is on rung one.
 */
function liveTriggers(input: EscalationInput): LiveTrigger[] {
  const { context, policy, sla, responsible } = input;
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const live: LiveTrigger[] = [];

  const enabled = new Set(policy.triggers);
  const add = (trigger: EscalationTrigger, since: IsoDateTime, detail: string) => {
    if (enabled.has(trigger)) live.push({ trigger, since, detail });
  };

  // Resolved work escalates about nothing. Everything below is about work that
  // is still open.
  if (context.resolvedAt) return [];

  if (sla.acknowledge.state === "breached" && sla.acknowledge.dueAt) {
    add(
      "not_acknowledged",
      sla.acknowledge.dueAt,
      responsible
        ? `${responsible.displayName} has not acknowledged this.`
        : "Nobody has picked this up.",
    );
  }

  if (sla.resolve.state === "breached" && sla.resolve.dueAt) {
    add("resolution_overdue", sla.resolve.dueAt, "The resolution target has passed.");
  }

  // High and critical work is visible to the accountable manager from the
  // start rather than after a delay. Nothing moves — this is the whole point
  // of `manager_visibility` being a separate action from `reassign`.
  if (context.severity === "critical" || context.severity === "high") {
    add(
      "high_severity",
      context.openedAt,
      `This is ${context.severity} severity, so it is visible above the desk from the start.`,
    );
  }

  if (context.blocked) {
    add(
      "blocked",
      context.openedAt,
      context.blockedReason ?? "Something is stopping this that the assignee cannot clear.",
    );
  }

  // The person holding it can no longer do what it asks. Checked against the
  // work's own permission list rather than against a role, so a permission
  // change made this morning is reflected this afternoon.
  if (responsible) {
    const missing = context.requires.filter((k) => !responsible.permissions.has(k));
    if (missing.length > 0) {
      add(
        "missing_permission",
        context.openedAt,
        `${responsible.displayName} no longer holds ${missing.join(", ")}.`,
      );
    }
    if (!responsible.takesWork || responsible.status !== "active") {
      add(
        "assignee_unavailable",
        context.openedAt,
        responsible.status !== "active"
          ? `${responsible.displayName} is no longer an active member.`
          : `${responsible.displayName} is not available to take work.`,
      );
    }
  }

  if ((context.reopenCount ?? 0) >= REPEATED_FAILURE_THRESHOLD) {
    add(
      "repeated_failure",
      context.openedAt,
      `This has come back ${context.reopenCount} times.`,
    );
  }

  if (context.approvalRequired) {
    add("approval_required", context.openedAt, "This cannot be finished without an approval.");
  }

  if (input.noEligibleAssignee) {
    add(
      "no_eligible_assignee",
      context.openedAt,
      "Nobody in this workspace can do this yet.",
    );
  }

  if (context.scopeEndsAt) {
    const endsMs = new Date(context.scopeEndsAt).getTime();
    const warnFromMs = endsMs - SCOPE_ENDING_WARNING_MINUTES * MINUTE_MS;
    if (nowMs >= warnFromMs) {
      add(
        "scope_ending",
        new Date(warnFromMs).toISOString(),
        "The relationship or assignment behind this is about to end.",
      );
    }
  }

  return live;
}

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Where each live trigger has got to on its ladder.
 *
 * Nothing here is stored. A stored escalation level would go stale the moment
 * somebody acknowledged the work in another tab, and a card claiming "escalated
 * to the Owner" about work that was picked up ten minutes ago is worse than no
 * card at all.
 */
export function escalationsFor(input: EscalationInput): EscalationState[] {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const keptUntilMs = input.keptAt
    ? new Date(input.keptAt).getTime() + KEEP_QUIETS_REMINDER_MINUTES * MINUTE_MS
    : 0;

  return liveTriggers(input).map(({ trigger, since, detail }) => {
    const ladder = ladderFor(trigger, input.policy, input.fleetProfile);
    const sinceMs = new Date(since).getTime();

    const reached: EscalationStep[] = [];
    let next: EscalationState["next"];

    for (const step of ladder) {
      const dueMs = sinceMs + step.afterMinutes * MINUTE_MS;

      // A person who has explicitly kept the work silences the reminder rung,
      // and only that rung. Saying you are on it is not the same as doing it,
      // so the manager-visibility and escalate rungs are untouched — and the
      // resolution clock never stopped.
      const quieted = step.action === "reminder" && nowMs < keptUntilMs;

      if (dueMs <= nowMs && !quieted) {
        reached.push(step);
        continue;
      }
      if (!next) next = { step, dueAt: new Date(dueMs).toISOString() };
    }

    return {
      trigger,
      since,
      reached,
      next,
      level: reached.length > 0 ? reached[reached.length - 1].level : 0,
      detail,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Reading them                                                                */
/* -------------------------------------------------------------------------- */

/**
 * True when something has actually GONE WRONG and a rung fired for it.
 *
 * Two exclusions, and both matter. A reminder to whoever already holds the work
 * is not an escalation, so the bar is `ESCALATED_FROM_LEVEL`. And a standing
 * condition — "this is critical" — is not something going wrong, so the
 * visibility-only triggers do not count however long they have been true.
 *
 * `isEscalated` is exported so the queue builder and the service ask the one
 * question through the one function rather than each comparing a level.
 */
export function isEscalated(state: EscalationState): boolean {
  if (VISIBILITY_ONLY_TRIGGERS.includes(state.trigger)) return false;
  return state.level >= ESCALATED_FROM_LEVEL;
}

export function hasEscalated(states: readonly EscalationState[]): boolean {
  return states.some(isEscalated);
}

/** The highest level reached across every live trigger. */
export function topLevel(states: readonly EscalationState[]): number {
  return states.reduce((max, s) => Math.max(max, s.level), 0);
}

/**
 * The steps that would move the work, among those already reached.
 *
 * Almost always empty, and that is the correct behaviour rather than an
 * oversight: only a policy a Carrier deliberately edited produces one. A caller
 * acts on this list and on nothing else — never on a level number, never on a
 * trigger name.
 */
export function pendingMoves(
  states: readonly EscalationState[],
): Array<{ trigger: EscalationTrigger; step: EscalationStep }> {
  return states.flatMap((s) =>
    s.reached.filter(movesWork).map((step) => ({ trigger: s.trigger, step })),
  );
}

/** One sentence for a card with room for one. */
export function describeEscalation(state: EscalationState): string {
  if (state.level === 0) {
    return state.next
      ? `${state.detail} Next step at level ${state.next.step.level}.`
      : state.detail;
  }
  const last = state.reached[state.reached.length - 1];
  const moved = movesWork(last)
    ? ""
    : " Whoever holds it is still responsible.";
  return `${state.detail} ${last.detail}${moved}`;
}
