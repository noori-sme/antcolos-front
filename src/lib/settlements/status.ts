import type { SettlementStatus } from "@/types";

/**
 * THE settlement status machine.
 *
 * Every status change in the module goes through `canTransition`. Nothing
 * assigns `settlement.status` directly, so there is one place to read to learn
 * what a settlement can do next — and one place a reviewer can check that
 * "approved settlements are not silently edited" is actually true.
 */

/**
 * Legal transitions. Absent pairs are illegal, including same-status "changes":
 * re-approving an approved settlement is a bug, not a no-op.
 */
const TRANSITIONS: Record<SettlementStatus, readonly SettlementStatus[]> = {
  // Still being built. Recalculates freely.
  draft: ["needs_review", "voided"],
  // Complete, waiting for a human. Recalculation is still allowed here.
  needs_review: ["draft", "approved", "disputed", "voided"],
  // Signed off. The snapshot is frozen; corrections are new records.
  approved: ["ready_for_payment", "disputed", "voided"],
  // Somebody disagrees. Resolution returns it to where it came from.
  disputed: ["needs_review", "approved", "ready_for_payment", "partially_paid", "paid", "voided"],
  // Queued for payment elsewhere. Antcolos does not move the money.
  ready_for_payment: ["partially_paid", "paid", "disputed", "voided"],
  partially_paid: ["paid", "disputed", "voided"],
  // A paid settlement can still be disputed. It can never be edited or voided:
  // the money has moved, so the only honest correction is an adjustment.
  paid: ["disputed"],
  // Terminal. A voided settlement stays visible, with its reason.
  voided: [],
};

export function canTransition(from: SettlementStatus, to: SettlementStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: SettlementStatus): readonly SettlementStatus[] {
  return TRANSITIONS[from];
}

/** Thrown rather than returned, so an illegal transition cannot be ignored. */
export class IllegalSettlementTransitionError extends Error {
  constructor(readonly from: SettlementStatus, readonly to: SettlementStatus) {
    super(`A settlement cannot move from ${from} to ${to}`);
    this.name = "IllegalSettlementTransitionError";
  }
}

export function assertTransition(from: SettlementStatus, to: SettlementStatus): void {
  if (!canTransition(from, to)) throw new IllegalSettlementTransitionError(from, to);
}

/* -------------------------------------------------------------------------- */
/* What may be changed, and when                                               */
/* -------------------------------------------------------------------------- */

/**
 * The only two statuses in which a settlement's money may be edited in place.
 *
 * Everything else — approved, disputed, queued, partly paid, paid, voided — is
 * closed to editing. This is the rule the whole module is built around: once a
 * settlement has been signed off, the figures on it are a record of what was
 * agreed, and a record that can be edited is not a record.
 */
const EDITABLE: readonly SettlementStatus[] = ["draft", "needs_review"];

/** True when lines, adjustments and the calculation may still be changed. */
export function isEditable(status: SettlementStatus): boolean {
  return EDITABLE.includes(status);
}

/**
 * True once the settlement is closed to editing. A correction to one of these
 * must be an adjustment or a new version — never an edit.
 */
export function requiresAdjustmentToCorrect(status: SettlementStatus): boolean {
  return !isEditable(status) && status !== "voided";
}

/** A settlement whose calculation snapshot must be frozen. */
export function shouldFreezeSnapshot(status: SettlementStatus): boolean {
  return !isEditable(status);
}

/** Nothing further happens to these. */
export function isTerminal(status: SettlementStatus): boolean {
  return status === "paid" || status === "voided";
}

/** Money may only be recorded against a settlement that has been signed off. */
export function acceptsPayment(status: SettlementStatus): boolean {
  return status === "ready_for_payment" || status === "partially_paid";
}

/** A settlement is only overdue if somebody is actually still owed money. */
export function canBeOverdue(status: SettlementStatus): boolean {
  return status === "approved" || status === "ready_for_payment" || status === "partially_paid";
}

/* -------------------------------------------------------------------------- */
/* Payment-driven status                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Where a settlement lands after a payment is recorded.
 *
 * Derived from the amounts rather than chosen by the caller, so "partially
 * paid" can never be claimed for a settlement that is fully paid, or the other
 * way round.
 */
export function statusAfterPayment(
  netPayCents: number,
  amountPaidCents: number,
  current: SettlementStatus,
): SettlementStatus {
  if (amountPaidCents <= 0) return current;
  // A net of zero is settled the moment it is queued — there is nothing to pay.
  if (amountPaidCents >= netPayCents) return "paid";
  return "partially_paid";
}
