import type { MilestoneKind } from "@/types";

/**
 * Every refusal this module can make, as a named type.
 *
 * They exist so a caller — the dashboard, the future Telegram bot, a test —
 * can tell "you may not do that" from "that already happened" from "someone
 * changed it under you", and say something useful instead of "failed".
 *
 * Note what is NOT here: there is no "milestone out of order" error. Recording
 * a milestone whose predecessors are missing is legitimate and always accepted.
 */

export class WorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The command names a state the record is not in. */
export class InvalidTransitionError extends WorkflowError {
  constructor(
    readonly action: string,
    readonly currentStatus: string,
    reason?: string,
  ) {
    super(
      reason ??
        `"${action}" is not available while this is ${currentStatus.replace(/_/g, " ")}.`,
    );
  }
}

/**
 * The same thing, submitted twice, without an idempotency key to prove it was
 * the same submission. With a key, a repeat is not an error — it returns the
 * original result.
 */
export class DuplicateSubmissionError extends WorkflowError {
  constructor(readonly what: string) {
    super(`${what} has already been recorded. Nothing was recorded twice.`);
  }
}

/**
 * A pause action that refers to a pause which has expired, been resumed, or
 * been replaced. The proposal has moved on; acting on the old one would
 * silently rewind it.
 */
export class StalePauseError extends WorkflowError {
  constructor(readonly pauseId: string, reason: string) {
    super(`That pause is no longer current: ${reason}`);
  }
}

/** Optimistic concurrency: the record changed since the caller last read it. */
export class StaleVersionError extends WorkflowError {
  constructor(readonly expected: number, readonly actual: number) {
    super(
      `This was updated somewhere else (you had version ${expected}, it is now ${actual}). Open it again to see the change.`,
    );
  }
}

/** Carrier policy, not permissions: what this engagement type may not do. */
export class PolicyDeniedError extends WorkflowError {
  constructor(readonly rule: string, message: string) {
    super(message);
  }
}

/** Money a driver may not see. Raised before the value is ever assembled. */
export class FinancialAccessError extends WorkflowError {
  constructor(readonly field: string) {
    super(`Carrier policy does not share ${field} with you on this load.`);
  }
}

/** The rate confirmation is not finished, so there is nothing to post yet. */
export class FinalizationBlockedError extends WorkflowError {
  constructor(readonly missing: string[]) {
    super(
      `This load cannot be finalized yet: ${missing.join("; ")}.`,
    );
  }
}

/** A completed workflow is closed. Its history stays; nothing new lands on it. */
export class WorkflowClosedError extends WorkflowError {
  constructor(readonly workflowId: string) {
    super(
      "This trip is completed. Its timeline, documents and comments are kept, but no new updates can be added to it.",
    );
  }
}

/**
 * The single genuine operational block in the trip: closing a trip that has no
 * proof of delivery, for a carrier whose policy bills on one. It is refusable
 * rather than advisory because a settled trip without a POD is a billing and
 * legal problem, not an inconvenience — and it can still be completed by
 * recording the reason.
 */
export class CompletionBlockedError extends WorkflowError {
  constructor(readonly milestone: MilestoneKind, message: string) {
    super(message);
  }
}

/**
 * The record exists and the caller holds the permission, but it is not theirs:
 * another driver's proposal, another driver's trip. Distinct from a permission
 * failure because the fix is different — nobody should be granted anything.
 */
export class NotYourRecordError extends WorkflowError {
  constructor(readonly what: string) {
    super(`This ${what} belongs to another driver. Only the driver it was sent to can act on it.`);
  }
}
