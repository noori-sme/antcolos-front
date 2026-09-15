import { DRIVER_ELIGIBLE_FUNCTIONS, ROUTING_WEIGHTS } from "@/config/responsibility";
import type {
  EligibilityFailure, EligibilityVerdict, ResponsibilityContext,
} from "@/types";
import type { CandidateWorkload, ResponsibilityCandidate } from "./candidate";

/**
 * Is this membership allowed to do this work, and how good a match are they?
 *
 * The milestone's hardest instruction lives in this file: "Do not assign work
 * based only on role names. Use Membership permissions, relationship scope,
 * asset assignment, work assignment, and availability." So those five are
 * exactly what is checked, in that order, and there is no sixth check that
 * quietly reads a title.
 *
 * Both halves matter and they are different questions. ELIGIBILITY is a hard
 * gate — a person who cannot do the work must never be routed it, whatever
 * their score. SCORE only orders the people who passed, and it is worked out
 * separately so that a strong signal can never smuggle somebody through the
 * gate.
 *
 * Every verdict is returned, refusals included, because an Owner asking "why
 * did this land on me?" is owed the list of who was considered and why each
 * was passed over. That is what `routing.ts` puts on the record as the reason.
 */

export interface EligibilityInput {
  context: ResponsibilityContext;
  /** What this membership already holds, for the continuity signal. */
  workload?: CandidateWorkload;
  /** True when the workspace's tier has supervisors switched on. */
  supervisorsEnabled?: boolean;
}

/* -------------------------------------------------------------------------- */
/* The gate                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Whether a candidate is narrowed to a set of carriers, and whether this work
 * is inside it.
 *
 * An EMPTY list means "not narrowed", not "narrowed to nothing". That
 * distinction is the whole of cross-carrier isolation inside a dispatch
 * workspace: Lane holds Baxter and Inés holds Cascade, so neither is eligible
 * for the other's work — while the operations lead, narrowed to nobody, is
 * eligible for both.
 */
function carrierMismatch(
  candidate: ResponsibilityCandidate,
  context: ResponsibilityContext,
): boolean {
  if (!context.carrierOrganizationId) return false;
  if (candidate.carrierOrganizationIds.length === 0) return false;
  return !candidate.carrierOrganizationIds.includes(context.carrierOrganizationId);
}

/** The same rule for trucks: empty means not narrowed. */
function truckMismatch(
  candidate: ResponsibilityCandidate,
  context: ResponsibilityContext,
): boolean {
  if (!context.truckId) return false;
  if (candidate.truckIds.length === 0) return false;
  return !candidate.truckIds.includes(context.truckId);
}

/**
 * Whether a membership scoped to its own records can take this.
 *
 * A driver membership is not a lesser dispatcher. It can be responsible for its
 * own actions, its own documents, its own compliance and a defect on its own
 * truck — and for nothing else, whatever permissions happen to be on it. The
 * list is configuration, not a check written here.
 */
function outOfRecordScope(
  candidate: ResponsibilityCandidate,
  context: ResponsibilityContext,
): boolean {
  if (candidate.scope.loads !== "assigned") return false;
  if (!DRIVER_ELIGIBLE_FUNCTIONS.includes(context.functionKey)) return true;
  // Scoped to their own records means exactly that: work about somebody else's
  // driver record is not theirs, even when the function is one they can do.
  if (context.driverProfileId && candidate.driverProfileId !== context.driverProfileId) {
    return true;
  }
  return false;
}

/**
 * Work that names a driver belongs to that driver.
 *
 * Nobody else is eligible for it — not their dispatcher, not the Owner — until
 * a person explicitly reassigns it. A dispatcher cannot sign a driver's
 * inspection for them, and routing the item to somebody who physically cannot
 * complete it is worse than leaving it where it is.
 */
function wrongDriver(
  candidate: ResponsibilityCandidate,
  context: ResponsibilityContext,
): boolean {
  if (!context.driverProfileId) return false;
  if (context.functionKey !== "driver_action") return false;
  return candidate.driverProfileId !== context.driverProfileId;
}

export function evaluateCandidate(
  candidate: ResponsibilityCandidate,
  input: EligibilityInput,
): EligibilityVerdict {
  const { context } = input;
  const failures: EligibilityFailure[] = [];

  if (candidate.organizationId !== context.organizationId) {
    failures.push("wrong_organization");
  }
  if (candidate.status !== "active") failures.push("not_active");
  if (!candidate.takesWork && candidate.status === "active") failures.push("not_available");

  const missing = context.requires.filter((key) => !candidate.permissions.has(key));
  if (missing.length > 0) failures.push("missing_permission");

  if (outOfRecordScope(candidate, context)) failures.push("out_of_scope");
  if (wrongDriver(candidate, context)) failures.push("not_assigned_to_asset");
  if (carrierMismatch(candidate, context) || truckMismatch(candidate, context)) {
    failures.push("out_of_scope");
  }

  const eligible = failures.length === 0;
  const { score, reasons } = scoreCandidate(candidate, input, eligible);

  return {
    membershipId: candidate.membershipId,
    displayName: candidate.displayName,
    title: candidate.title,
    eligible,
    failures: [...new Set(failures)],
    score,
    reasons,
  };
}

/* -------------------------------------------------------------------------- */
/* The score                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * How good a match, for candidates that already passed the gate.
 *
 * Always zero for an ineligible candidate: a score on somebody who may not do
 * the work is a number waiting to be compared by mistake.
 *
 * The weights are in `config/responsibility.ts` and the ordering they produce
 * is the product decision worth reading:
 *
 *   the driver of record        beats everything, and is decisive
 *   somebody given this truck   beats somebody given this carrier
 *   somebody given this carrier beats somebody declared for this function
 *   any of those                beats the Owner, always
 *
 * The Owner's weight is 1 — deliberately the smallest non-zero number in the
 * table. The Owner is the fallback when nobody else fits, never the default
 * when somebody does, and that is the difference between an Owner who keeps
 * oversight and an Owner drowning in routine work.
 */
function scoreCandidate(
  candidate: ResponsibilityCandidate,
  input: EligibilityInput,
  eligible: boolean,
): { score: number; reasons: string[] } {
  if (!eligible) return { score: 0, reasons: [] };

  const { context, workload } = input;
  const reasons: string[] = [];
  let score = 0;

  if (context.driverProfileId && candidate.driverProfileId === context.driverProfileId) {
    score += ROUTING_WEIGHTS.driverOfRecord;
    reasons.push("Is the driver this work is waiting on.");
  }

  if (context.truckId && candidate.truckIds.includes(context.truckId)) {
    score += ROUTING_WEIGHTS.assignedToTruck;
    reasons.push("Has been given this truck.");
  }

  if (
    context.carrierOrganizationId
    && candidate.carrierOrganizationIds.includes(context.carrierOrganizationId)
  ) {
    score += ROUTING_WEIGHTS.carrierDelegation;
    reasons.push("Holds the delegation for this carrier.");
  }

  if (candidate.functions.includes(context.functionKey)) {
    score += ROUTING_WEIGHTS.functionMatch;
    reasons.push("Works on this kind of thing.");
  }

  if (workload) {
    const sameTruck = context.truckId && workload.truckIds.includes(context.truckId);
    const sameLoad = context.loadId && workload.loadIds.includes(context.loadId);
    if (sameTruck || sameLoad) {
      score += ROUTING_WEIGHTS.continuity;
      reasons.push("Already working this truck.");
    }
  }

  if (input.supervisorsEnabled && !candidate.supervisorMembershipId && !candidate.isOwner) {
    score += ROUTING_WEIGHTS.supervisor;
    reasons.push("Oversees this desk.");
  }

  // Comfortably qualified rather than exactly qualified. Small, because holding
  // more permissions is not the same as being the right person.
  if (context.requires.length > 0 && candidate.permissions.size > context.requires.length * 4) {
    score += ROUTING_WEIGHTS.permissionHeadroom;
  }

  if (candidate.isOwner) {
    score += ROUTING_WEIGHTS.owner;
    if (reasons.length === 0) reasons.push("Owns the workspace.");
  }

  // The tie-break, and it has to be a fact rather than array order: two
  // dispatchers with identical claims on a piece of work must produce the same
  // answer on every read, or the board reshuffles itself while somebody reads
  // it. Whoever is holding less work wins; the id settles a true draw, in
  // `routing.ts`.
  if (workload) score -= Math.min(workload.openCount, 50) / 100;

  return { score, reasons };
}

/* -------------------------------------------------------------------------- */
/* The whole field                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Everybody weighed, best first, refusals last.
 *
 * Ordering is by score, then by membership id, so the answer is stable across
 * reads of identical state.
 */
export function rankCandidates(
  candidates: readonly ResponsibilityCandidate[],
  input: EligibilityInput,
  workloads?: ReadonlyMap<string, CandidateWorkload>,
): EligibilityVerdict[] {
  return candidates
    .map((c) => evaluateCandidate(c, {
      ...input,
      workload: workloads?.get(c.membershipId) ?? input.workload,
    }))
    .sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      if (b.score !== a.score) return b.score - a.score;
      return a.membershipId.localeCompare(b.membershipId);
    });
}
