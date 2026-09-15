import {
  OWNER_ALWAYS_SEES, OWNER_PERSONAL_QUEUE_SEVERITIES,
  OWNER_SEES_DELEGATED_WHEN_AT_RISK, OWNER_SEES_DELEGATED_WHEN_ESCALATED,
} from "@/config/responsibility";
import { isEscalated } from "./escalation";
import type {
  FleetProfile, ResponsibilityAssignment, ResponsibilityQueue,
  ResponsibilityQueueView,
} from "@/types";
import { ALWAYS_VISIBLE_QUEUES, QUEUE_DESCRIPTION, QUEUE_LABEL } from "@/types";

/**
 * The seven views, and which of them this person gets.
 *
 * Simple daily work first. `My MT Loop` and `My Needs You` are always there,
 * however small the workspace, because a lone owner-operator still has a day to
 * work. Everything structural — hierarchy, policy editing, SLA configuration,
 * advanced routing — is behind settings and is never on this surface.
 *
 * ★ THE OWNER PROBLEM ★
 * The milestone asks for two things that pull in opposite directions: the Owner
 * must keep organization-wide oversight after delegating, AND must not receive
 * every routine item in their personal queue. Both are true here because they
 * are answered by different queues:
 *
 *   accountable for everything  →  `all_organization`, `escalated`, `at_risk`,
 *                                  and the `oversight` count
 *   personally responsible      →  `my_mt_loop` and `my_needs_you`, which admit
 *                                  work the Owner actually holds, plus only the
 *                                  severities and triggers in the config
 *
 * So a delegated, medium-severity document item never reaches the Owner's own
 * list, while the critical one two desks away does — and the Owner can still
 * see, and take over, absolutely everything from `all_organization`.
 *
 * Absent and empty are kept apart throughout, the same convention the dispatch
 * workspace uses: a queue the viewer may not see is missing, not empty, and the
 * screen renders the difference.
 */

export interface QueueInput {
  assignments: readonly ResponsibilityAssignment[];
  viewerMembershipId: string;
  viewerIsOwner: boolean;
  /** True when the viewer may see work held by other people. */
  maySeeTeamWork: boolean;
  /** True when the viewer may hand work to somebody else. */
  mayMoveWork: boolean;
  fleetProfile: FleetProfile;
}

/* -------------------------------------------------------------------------- */
/* Membership of one queue                                                     */
/* -------------------------------------------------------------------------- */

const isOpen = (a: ResponsibilityAssignment) => !a.resolvedAt;

/**
 * Whether a piece of work belongs in THIS person's own daily list.
 *
 * For everybody except an Owner, the answer is simply "are you responsible for
 * it". The Owner is the exception, and the exception is the whole reason this
 * function exists rather than a one-line filter.
 */
function inPersonalQueue(
  assignment: ResponsibilityAssignment,
  input: QueueInput,
): boolean {
  const mine = assignment.responsible.membershipId === input.viewerMembershipId;

  if (!input.viewerIsOwner) return mine;

  // An Owner who is genuinely holding the work sees it, exactly like anybody
  // else. A one-person carrier's whole day is this branch.
  if (mine) return true;

  // Delegated away. From here on the Owner sees it personally only for the four
  // reasons the milestone names — never merely because it exists. A routine
  // item somebody else is handling, on track, is absent from this list and
  // present in `all_organization`, which is the whole point.
  const accountable = assignment.accountable.membershipId === input.viewerMembershipId;
  if (!accountable) return false;

  if (OWNER_PERSONAL_QUEUE_SEVERITIES.includes(assignment.severity)) return true;
  if (OWNER_SEES_DELEGATED_WHEN_AT_RISK && assignment.atRisk) return true;

  if (OWNER_SEES_DELEGATED_WHEN_ESCALATED && assignment.escalations.some(isEscalated)) {
    return true;
  }

  return assignment.escalations.some(
    (e) => e.level > 0 && OWNER_ALWAYS_SEES.includes(e.trigger),
  );
}

function matchesQueue(
  queue: ResponsibilityQueue,
  assignment: ResponsibilityAssignment,
  input: QueueInput,
): boolean {
  switch (queue) {
    case "my_mt_loop":
      return isOpen(assignment)
        && assignment.work.kind === "mt_loop"
        && inPersonalQueue(assignment, input);

    case "my_needs_you":
      return isOpen(assignment)
        && assignment.work.kind === "needs_you"
        && inPersonalQueue(assignment, input);

    case "team":
      // Everybody else's work. Deliberately excludes the viewer's own, because
      // a team queue that repeats your own list is a list you stop reading.
      return isOpen(assignment)
        && assignment.responsible.membershipId !== input.viewerMembershipId;

    case "unassigned":
      // Work sitting with the Owner ONLY because nothing else resolved. Not the
      // same as "the Owner is working it" — a one-person carrier's work is
      // owned, not unassigned, and must never appear here.
      return isOpen(assignment) && assignment.responsible.source === "fallback";

    case "escalated":
      // A rung that involves somebody else has fired — a reminder to the person
      // already holding it is not an escalation. The original assignee is still
      // responsible, which is why this queue shows who holds it rather than
      // moving it anywhere.
      return isOpen(assignment) && assignment.escalations.some(isEscalated);

    case "at_risk":
      return isOpen(assignment) && assignment.atRisk;

    case "all_organization":
      return isOpen(assignment);
  }
}

/* -------------------------------------------------------------------------- */
/* Which queues this person gets                                               */
/* -------------------------------------------------------------------------- */

/**
 * Whether a queue exists for this viewer at all.
 *
 * A workspace of one has no team queue and no unassigned queue — not because
 * they are forbidden, but because they are meaningless with one person in the
 * room. That is the same judgement `resolveWorkspace` already makes about the
 * dispatch dashboard, made the same way, rather than a second opinion about the
 * same question.
 */
export function queueApplies(queue: ResponsibilityQueue, input: QueueInput): boolean {
  if (ALWAYS_VISIBLE_QUEUES.includes(queue)) return true;

  switch (queue) {
    case "team":
      return input.fleetProfile.teamQueuesEnabled && input.maySeeTeamWork;
    case "unassigned":
      return input.mayMoveWork;
    case "escalated":
    case "at_risk":
      // Always available, even alone: an owner-operator whose own work is
      // overdue is exactly who needs to be told.
      return true;
    case "all_organization":
      return input.maySeeTeamWork;
    default:
      return true;
  }
}

const QUEUE_ORDER: readonly ResponsibilityQueue[] = [
  "my_mt_loop", "my_needs_you", "team", "unassigned", "escalated", "at_risk",
  "all_organization",
];

/**
 * Worst first, then soonest.
 *
 * Severity does not dominate here the way it does in Needs You, on purpose: a
 * breached low-severity item that nobody has touched for two days is worth more
 * of somebody's attention than a critical one that opened a minute ago and is
 * already being worked.
 */
function byUrgency(a: ResponsibilityAssignment, b: ResponsibilityAssignment): number {
  const rank = (x: ResponsibilityAssignment) => {
    if (x.sla.worst === "breached") return 0;
    if (x.escalations.some(isEscalated)) return 1;
    if (x.sla.worst === "due_soon") return 2;
    return 3;
  };
  const byRank = rank(a) - rank(b);
  if (byRank !== 0) return byRank;

  const at = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  const bt = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  if (at !== bt) return at - bt;
  return a.openedAt.localeCompare(b.openedAt);
}

export function buildQueues(input: QueueInput): ResponsibilityQueueView[] {
  return QUEUE_ORDER.filter((q) => queueApplies(q, input)).map((queue) => {
    const items = input.assignments
      .filter((a) => matchesQueue(queue, a, input))
      .sort(byUrgency);
    return {
      queue,
      label: QUEUE_LABEL[queue],
      description: QUEUE_DESCRIPTION[queue],
      count: items.length,
      applicable: true,
      items,
    };
  });
}

/**
 * The headline numbers, computed over everything rather than over the queues.
 *
 * Counting from the queues would make `mine` depend on which queues the viewer
 * happens to be shown, which is the sort of quiet inconsistency that makes a
 * badge disagree with the list underneath it.
 */
export function queueCounts(input: QueueInput) {
  const open = input.assignments.filter(isOpen);
  return {
    total: open.length,
    mine: open.filter((a) => a.responsible.membershipId === input.viewerMembershipId).length,
    unassigned: open.filter((a) => a.responsible.source === "fallback").length,
    escalated: open.filter((a) => a.escalations.some(isEscalated)).length,
    atRisk: open.filter((a) => a.atRisk).length,
    // Work this person answers for but is not doing. The oversight number an
    // Owner actually wants, and the one that stays honest after delegation.
    oversight: open.filter(
      (a) => a.accountable.membershipId === input.viewerMembershipId
        && a.responsible.membershipId !== input.viewerMembershipId,
    ).length,
  };
}
