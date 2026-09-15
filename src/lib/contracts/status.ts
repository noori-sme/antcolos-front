import {
  CONTRACT_IN_FORCE_STATUSES, CONTRACT_TERMINAL_STATUSES,
  type Contract, type ContractStatus, type ContractVersion, type IsoDateTime,
} from "@/types";

/**
 * The contract status machine.
 *
 * Two kinds of status live in one enum, and keeping them straight is the point
 * of this file:
 *
 *   STORED    draft, pending_review, awaiting_signature, active, terminated,
 *             cancelled, superseded — somebody did something.
 *   DERIVED   expiring, expired — time passed.
 *
 * `deriveContractStatus` is applied on every read. A contract therefore cannot
 * sit at "active" a month after its end date because no scheduled job ran, and
 * "expiring" cannot be stale because nothing stores it.
 */

/**
 * Which stored status may follow which.
 *
 * `expiring` and `expired` are absent as SOURCES on purpose: a contract in
 * either is stored as `active`, and the transitions available to it are
 * `active`'s. They appear as targets nowhere, because nothing transitions into
 * them — they are worked out.
 */
const ALLOWED: Record<ContractStatus, readonly ContractStatus[]> = {
  draft: ["pending_review", "awaiting_signature", "cancelled"],
  // Review can send it back to draft, or straight out for signature.
  pending_review: ["draft", "awaiting_signature", "cancelled"],
  // Signatures complete it, or it is abandoned. It cannot fall back to draft:
  // the issued version is locked, and reopening would mean editing terms a
  // party may already have signed.
  awaiting_signature: ["active", "cancelled"],
  active: ["terminated", "superseded"],
  // Derived. Both behave as `active` for transition purposes.
  expiring: ["terminated", "superseded"],
  expired: ["superseded", "terminated"],
  terminated: [],
  cancelled: [],
  superseded: [],
};

export class ContractStatusError extends Error {
  constructor(readonly from: ContractStatus, readonly to: ContractStatus) {
    super(`A contract cannot move from ${from} to ${to}.`);
    this.name = "ContractStatusError";
  }
}

export function canTransition(from: ContractStatus, to: ContractStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function assertTransition(from: ContractStatus, to: ContractStatus): void {
  if (!canTransition(from, to)) throw new ContractStatusError(from, to);
}

export function isTerminalStatus(status: ContractStatus): boolean {
  return CONTRACT_TERMINAL_STATUSES.includes(status);
}

export function isInForce(status: ContractStatus): boolean {
  return CONTRACT_IN_FORCE_STATUSES.includes(status);
}

/**
 * Whole days from `from` to `to`, rounded towards zero.
 *
 * Used for "days until this ends", so it has to be stable across time zones:
 * both sides are UTC instants and the result is a difference, never a calendar
 * subtraction, because a calendar subtraction would shift by one on the day the
 * clocks change.
 */
export function daysBetween(from: IsoDateTime, to: IsoDateTime): number {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Math.trunc(ms / 86_400_000);
}

/**
 * What the contract's status actually is, right now.
 *
 * The stored status wins whenever somebody decided it — terminated, cancelled,
 * superseded, and every state before the agreement takes effect. Only an
 * `active` contract is re-read against the clock, and only in two ways:
 *
 *   past its end date            -> expired
 *   inside its reminder window   -> expiring
 *
 * An open-ended agreement (no end date) stays active forever, which is correct:
 * there is nothing to expire.
 */
export function deriveContractStatus(
  contract: Pick<Contract, "status">,
  version: Pick<ContractVersion, "terms">,
  now: IsoDateTime,
): ContractStatus {
  if (contract.status !== "active") return contract.status;

  const { to } = version.terms.effective;
  if (!to) return "active";

  const daysLeft = daysBetween(now, to);
  if (daysLeft < 0) return "expired";

  const window = version.terms.renewal.reminderDays;
  if (window > 0 && daysLeft <= window) return "expiring";
  return "active";
}

/**
 * Whether the contract may go active.
 *
 * Three things, all required, and the reasons are returned rather than a
 * boolean so the screen can say which one is missing instead of greying out a
 * button with no explanation.
 */
export function activationBlockers(input: {
  version: Pick<ContractVersion, "status" | "terms">;
  signaturesOutstanding: number;
  blockingRequirementsOpen: number;
  now: IsoDateTime;
}): string[] {
  const reasons: string[] = [];
  if (input.version.status !== "issued" && input.version.status !== "signed") {
    reasons.push("The version has not been issued for signature yet.");
  }
  if (input.signaturesOutstanding > 0) {
    reasons.push(
      input.signaturesOutstanding === 1
        ? "One party has still to sign."
        : `${input.signaturesOutstanding} parties have still to sign.`,
    );
  }
  if (input.blockingRequirementsOpen > 0) {
    reasons.push(
      input.blockingRequirementsOpen === 1
        ? "One required item is still outstanding."
        : `${input.blockingRequirementsOpen} required items are still outstanding.`,
    );
  }
  return reasons;
}
