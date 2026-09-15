import type {
  AttentionReason, ResponsibilityAssignment, ResponsibilityTimelineEntry,
} from "@/types";
import { VISIBILITY_ONLY_TRIGGERS } from "@/config/responsibility";

/**
 * ★ WHOSE PROBLEM IS THIS, RIGHT NOW? ★
 *
 * The one question that decides whether a piece of work belongs in somebody's
 * PERSONAL queue. It is a much narrower question than "can they see it", "do
 * they answer for it" or "do they manage whoever is doing it", and the first
 * version of this module got it wrong by conflating all four: a Carrier Owner
 * ended up with 119 of their workspace's 145 items in their own list, because
 * they are the derived accountable membership for everything.
 *
 * Being accountable in an organizational sense is oversight. Oversight belongs
 * in Team oversight and All organization. A personal queue is a list of things
 * that stop if THIS person does not act.
 *
 * ── WHAT PUTS WORK IN A PERSONAL QUEUE ────────────────────────────────────
 *
 *   responsible             you are the one doing it
 *   owner_fallback          nobody qualified, so it fell to you
 *   needs_assignment        nobody in the workspace can do it at all
 *   explicit_accountable    a PERSON named you accountable, by hand
 *   approval_required       you are the approver and it is waiting on you
 *   escalation_reached_you  a recorded escalation actually named you
 *   help_requested          whoever holds it asked you, by hand
 *
 * ── WHAT DOES NOT, HOWEVER TRUE ───────────────────────────────────────────
 *
 *   • You hold every permission in the workspace.
 *   • You may view the organization.
 *   • You manage the person doing it.
 *   • It is high or critical severity but somebody is on it and inside SLA.
 *   • You are a destination the escalation ladder has NOT yet reached.
 *   • You "answer for" the team in the org-chart sense.
 *
 * ── WHY "REACHED" IS A RECORDED FACT, NOT A COMPUTED LEVEL ────────────────
 *
 * `escalation.ts` computes which rungs are DUE from the clock. That is
 * pressure, and it is shown as pressure — on the row, in Team oversight, in At
 * risk. It is not delivery, because this is a frontend: nothing is scheduled
 * and no reminder, approval request or escalation is sent anywhere. Treating a
 * due rung as though somebody had been told would be the same lie the SLA
 * comments are careful not to tell, and it is what put eighty-two items back
 * into an Owner's lap.
 *
 * So an escalation reaches a person when a PERSON escalates it — the
 * `escalate()` service call, which appends a timeline entry naming them — or
 * when the assignee asks for help. Both are real events with an actor, and both
 * survive in the history. When the backend grows real escalation jobs, it will
 * append the same kind of entry, and nothing here changes.
 */

/** The timeline actions that record somebody actually being brought in. */
const REACHES_A_PERSON: ReadonlySet<ResponsibilityTimelineEntry["action"]> = new Set([
  "escalated",
  "help_requested",
  "approval_requested",
]);

/**
 * Whether a recorded event named this membership.
 *
 * Read off the timeline rather than the computed escalation state, for the
 * reason in the header. `subjectMembershipId` is who the event was aimed at —
 * the accountable manager an item was escalated to, the person whose help was
 * asked for — and the actor is who did it, which is deliberately not the same
 * field.
 */
function wasReached(
  assignment: ResponsibilityAssignment,
  membershipId: string,
  action?: ResponsibilityTimelineEntry["action"],
): boolean {
  return assignment.timeline.some(
    (entry) =>
      entry.subjectMembershipId === membershipId
      && (action ? entry.action === action : REACHES_A_PERSON.has(entry.action)),
  );
}

/**
 * Every reason this work needs THIS person, personally. Empty means it does
 * not — however much of it they can see.
 */
export function attentionFor(
  assignment: ResponsibilityAssignment,
  membershipId: string,
): AttentionReason[] {
  if (assignment.resolvedAt) return [];

  const reasons: AttentionReason[] = [];
  const isResponsible = assignment.responsible.membershipId === membershipId;

  if (isResponsible) {
    // Why they hold it changes what the row should say, so the fallback cases
    // are their own reasons rather than a flag on this one.
    if (assignment.assignmentState === "needs_assignment") {
      reasons.push("needs_assignment");
    } else if (assignment.assignmentState === "owner_fallback") {
      reasons.push("owner_fallback");
    } else {
      reasons.push("responsible");
    }
  }

  // A person put them in the accountable seat by hand. Derived accountability —
  // "you are the Owner, so everything rolls up to you" — deliberately does not
  // qualify, and that distinction is the whole point of this module's rewrite.
  if (
    assignment.accountable.membershipId === membershipId
    && assignment.accountable.source === "manual"
  ) {
    reasons.push("explicit_accountable");
  }

  if (
    assignment.approver?.membershipId === membershipId
    && assignment.approvalState === "requested"
  ) {
    reasons.push("approval_required");
  }

  if (!isResponsible && wasReached(assignment, membershipId, "escalated")) {
    reasons.push("escalation_reached_you");
  }

  if (!isResponsible && wasReached(assignment, membershipId, "help_requested")) {
    reasons.push("help_requested");
  }

  return reasons;
}

export function requiresPersonalAttention(
  assignment: ResponsibilityAssignment,
  membershipId: string,
): boolean {
  return attentionFor(assignment, membershipId).length > 0;
}

/* -------------------------------------------------------------------------- */
/* Oversight                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Work this person oversees but is not personally doing.
 *
 * The other half of the split. It is deliberately generous — anything held by
 * somebody they answer for — because oversight is meant to be complete. What it
 * must never do is leak into the personal queue, which is why the two functions
 * are separate and why `teamOversightFor` excludes anything already personal.
 */
export function isOversight(
  assignment: ResponsibilityAssignment,
  membershipId: string,
): boolean {
  if (assignment.resolvedAt) return false;
  if (assignment.responsible.membershipId === membershipId) return false;
  // Accountable for it, or watching it. Both are oversight, neither is action.
  if (assignment.accountable.membershipId === membershipId) return true;
  return assignment.watchers.some((w) => w.membershipId === membershipId);
}

/**
 * True when a piece of oversight work is worth a manager's eye right now.
 *
 * Used to sort and badge Team oversight — NOT to promote anything into a
 * personal queue. An item can be screaming and still be entirely the assignee's
 * to fix.
 */
export function oversightIsWorrying(assignment: ResponsibilityAssignment): boolean {
  if (assignment.sla.worst === "breached" || assignment.sla.worst === "due_soon") return true;
  return assignment.escalations.some(
    (e) => e.level > 0 && !VISIBILITY_ONLY_TRIGGERS.includes(e.trigger),
  );
}
