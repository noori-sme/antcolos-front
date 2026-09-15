import { isEscalated } from "./escalation";
import { attentionFor, isOversight, oversightIsWorrying } from "./attention";
import type {
  FleetProfile, ResponsibilityAssignment, ResponsibilityQueue,
  ResponsibilityQueueView,
} from "@/types";
import { ALWAYS_VISIBLE_QUEUES, QUEUE_DESCRIPTION, QUEUE_LABEL } from "@/types";

/**
 * Which queue a piece of work belongs in, for one viewer.
 *
 * ★ THE THREE THAT MATTER ★
 *
 *   my_needs_you      needs THIS person. Decided entirely by `attention.ts`,
 *                     which is a much narrower question than visibility.
 *   team_oversight    held by somebody they answer for. Watchable, never a
 *                     claim on their attention.
 *   all_organization  the complete inventory, for deliberate inspection.
 *
 * They are strictly separate: nothing is promoted from the third into the
 * second or from the second into the first. Work moves into `my_needs_you`
 * only when a recorded event puts it there — an escalation somebody performed,
 * a request for help, an approval, or the plain fact of holding it.
 *
 * Every other queue below is a LENS over the same work, and each is scoped to
 * what the viewer may legitimately see. That scoping is not decoration: before
 * it existed, a dispatcher with no `members:view` still saw seventy-four
 * escalated items from across the whole organization, because two of these
 * queues had no viewer filter at all.
 *
 * Absent and empty stay apart throughout: a queue the viewer may not see is
 * missing from the response, not empty, and the screen renders the difference.
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

const isOpen = (a: ResponsibilityAssignment) => !a.resolvedAt;

/** Work this viewer is entitled to look at, whatever queue is asking. */
function maySee(a: ResponsibilityAssignment, input: QueueInput): boolean {
  if (input.maySeeTeamWork) return true;
  // Somebody without the roster sees their own work and anything that has
  // reached them, and nothing else — not the organization's escalations, and
  // not its at-risk list.
  return attentionFor(a, input.viewerMembershipId).length > 0
    || isOversight(a, input.viewerMembershipId);
}

function matchesQueue(
  queue: ResponsibilityQueue,
  a: ResponsibilityAssignment,
  input: QueueInput,
): boolean {
  if (!isOpen(a)) return false;
  const needsMe = attentionFor(a, input.viewerMembershipId).length > 0;

  switch (queue) {
    case "my_needs_you":
      return needsMe && a.work.kind === "needs_you";

    case "my_mt_loop":
      return needsMe && a.work.kind === "mt_loop";

    case "team_oversight":
      // Held by somebody they answer for, and NOT already personal. An item
      // that has genuinely reached them is their work now; repeating it here
      // would make the two lists disagree about what it is.
      return !needsMe && isOversight(a, input.viewerMembershipId);

    case "all_organization":
      return true;

    case "escalated":
      // Somebody was actually brought in, by hand. A rung merely falling due
      // is pressure, not an escalation — see `attention.ts`.
      return maySee(a, input) && a.escalations.some(isEscalated)
        && a.timeline.some((t) => t.action === "escalated");

    case "at_risk":
      return maySee(a, input) && a.atRisk;

    case "owner_fallback":
      return a.assignmentState === "owner_fallback";

    case "needs_assignment":
      return a.assignmentState === "needs_assignment";
  }
}

/* -------------------------------------------------------------------------- */
/* Which queues this person gets                                               */
/* -------------------------------------------------------------------------- */

export function queueApplies(queue: ResponsibilityQueue, input: QueueInput): boolean {
  if (ALWAYS_VISIBLE_QUEUES.includes(queue)) return true;

  switch (queue) {
    case "team_oversight":
      // Needs both the authority to see other people's work and somebody to
      // oversee. A workspace of one has neither.
      return input.maySeeTeamWork && input.fleetProfile.teamQueuesEnabled;
    case "all_organization":
      return input.maySeeTeamWork;
    case "owner_fallback":
    case "needs_assignment":
      return input.mayMoveWork;
    case "escalated":
    case "at_risk":
      // Always available, even alone: an owner-operator whose own work is
      // overdue is exactly who needs to be told. Scoped by `maySee` above.
      return true;
    default:
      return true;
  }
}

const QUEUE_ORDER: readonly ResponsibilityQueue[] = [
  // The three, in the order the product reads them, before any lens.
  "my_needs_you", "team_oversight", "all_organization",
  "my_mt_loop", "escalated", "at_risk", "owner_fallback", "needs_assignment",
];

/**
 * Worst first, then soonest.
 *
 * Severity does not dominate here the way it does in Needs You, on purpose: a
 * breached low-severity item nobody has touched for two days is worth more of
 * somebody's attention than a critical one that opened a minute ago and is
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

/** Team oversight leads with what is actually wobbling, then the rest. */
function byConcern(a: ResponsibilityAssignment, b: ResponsibilityAssignment): number {
  const worry = Number(oversightIsWorrying(b)) - Number(oversightIsWorrying(a));
  return worry !== 0 ? worry : byUrgency(a, b);
}

export function buildQueues(input: QueueInput): ResponsibilityQueueView[] {
  return QUEUE_ORDER.filter((q) => queueApplies(q, input)).map((queue) => {
    const items = input.assignments
      .filter((a) => matchesQueue(queue, a, input))
      .sort(queue === "team_oversight" ? byConcern : byUrgency);
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
    mine: open.filter((a) => attentionFor(a, input.viewerMembershipId).length > 0).length,
    ownerFallback: open.filter((a) => a.assignmentState === "owner_fallback").length,
    needsAssignment: open.filter((a) => a.assignmentState === "needs_assignment").length,
    // Always zero: routing cannot produce work without a responsible
    // membership. Measured anyway — an invariant nobody counts is an invariant
    // nobody notices breaking.
    trulyUnassigned: open.filter((a) => !a.responsible.membershipId).length,
    escalated: open.filter(
      (a) => a.escalations.some(isEscalated) && a.timeline.some((t) => t.action === "escalated"),
    ).length,
    atRisk: open.filter((a) => a.atRisk).length,
    oversight: open.filter((a) => isOversight(a, input.viewerMembershipId)).length,
  };
}
