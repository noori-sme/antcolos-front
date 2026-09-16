import type { WorkforceEngagementState } from "@/types";

/**
 * The engagement lifecycle, as a table rather than as a pile of `if`s.
 *
 * Written down in one pure module because a lifecycle spread across a service
 * is a lifecycle nobody can read, and because these are exactly the rules a
 * backend has to reimplement: a table is portable, a set of guard clauses is
 * not.
 *
 * Every transition not listed here is refused. That is deliberate — `ended`
 * never goes back to `active` (a person who returns gets a NEW engagement, and
 * the old one stays in history), and `prospective` never jumps straight to
 * `active` without somebody choosing to onboard them, because onboarding is
 * where the other modules are consulted.
 */
export const WORKFORCE_TRANSITIONS: Readonly<
  Record<WorkforceEngagementState, readonly WorkforceEngagementState[]>
> = {
  // Somebody being considered. They may be taken forward, turned down, or
  // withdraw. They may NOT become active directly.
  prospective: ["onboarding", "rejected", "withdrawn"],
  // Onboarding may also end without a relationship, from either side.
  onboarding: ["active", "rejected", "withdrawn"],
  active: ["suspended", "ended"],
  // A suspension is temporary by definition. It restores, or it ends.
  suspended: ["active", "ended"],
  // Terminal. An engagement that ended is kept and is never reopened.
  ended: [],
  rejected: [],
  withdrawn: [],
};

export function canTransition(
  from: WorkforceEngagementState,
  to: WorkforceEngagementState,
): boolean {
  return WORKFORCE_TRANSITIONS[from].includes(to);
}

/**
 * Refusing an illegal transition, with a sentence somebody can act on.
 *
 * The message names both states and what is allowed instead, because "invalid
 * transition" tells an operator nothing and tells a developer only slightly
 * more.
 */
export class InvalidEngagementTransitionError extends Error {
  constructor(
    readonly from: WorkforceEngagementState,
    readonly to: WorkforceEngagementState,
  ) {
    const allowed = WORKFORCE_TRANSITIONS[from];
    super(
      allowed.length === 0
        ? `This engagement is ${from} and cannot change state. Create a new engagement instead.`
        : `An engagement that is ${from} cannot become ${to}. It can become: ${allowed.join(", ")}.`,
    );
    this.name = "InvalidEngagementTransitionError";
  }
}

export function assertTransition(
  from: WorkforceEngagementState,
  to: WorkforceEngagementState,
): void {
  if (!canTransition(from, to)) throw new InvalidEngagementTransitionError(from, to);
}
