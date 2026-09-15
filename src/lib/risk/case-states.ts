import type { RiskCaseState, RiskSeverity } from "@/types";
import { RISK_CASE_CLOSED_STATES } from "@/types";

/**
 * The case lifecycle, as a machine rather than a free-text status field.
 *
 * Reopening is allowed from every ending, and that is deliberate: a case closed
 * as "accepted risk" that turns out to have been something else must be able to
 * come back, with the original decision still on its timeline. Nothing is
 * rewritten when it does.
 */
export const RISK_CASE_TRANSITIONS: Record<RiskCaseState, readonly RiskCaseState[]> = {
  open: ["investigating", "action_required", "escalated", "dismissed", "accepted_risk", "resolved"],
  investigating: ["action_required", "escalated", "resolved", "accepted_risk", "dismissed", "open"],
  action_required: ["investigating", "escalated", "resolved", "accepted_risk", "dismissed"],
  escalated: ["investigating", "action_required", "resolved", "accepted_risk", "dismissed"],
  // Reopening an ending returns it to the queue rather than to a new state.
  resolved: ["open", "investigating"],
  accepted_risk: ["open", "investigating"],
  dismissed: ["open", "investigating"],
};

export function canTransition(from: RiskCaseState, to: RiskCaseState): boolean {
  return RISK_CASE_TRANSITIONS[from].includes(to);
}

export function isClosedState(state: RiskCaseState): boolean {
  return RISK_CASE_CLOSED_STATES.includes(state);
}

/** Closing a case is the decision an auditor reads first, so it needs a why. */
export function requiresRationale(to: RiskCaseState): boolean {
  return isClosedState(to) || to === "escalated";
}

/**
 * How long a case of this severity may sit before it is overdue.
 *
 * Policy, in one place, rather than a due date typed in per case: a critical
 * case that somebody gave a fortnight to is a critical case nobody is working.
 * A person may set a due date, and the service clamps it to this.
 */
export const RISK_CASE_MAX_AGE_HOURS: Record<RiskSeverity, number> = {
  critical: 24,
  high: 72,
  medium: 14 * 24,
  low: 30 * 24,
  informational: 90 * 24,
};

export function defaultDueAt(severity: RiskSeverity, from: number = Date.now()): string {
  return new Date(from + RISK_CASE_MAX_AGE_HOURS[severity] * 3_600_000).toISOString();
}

/** The latest a due date may be set to, for a case of this severity. */
export function latestDueAt(severity: RiskSeverity, from: number = Date.now()): string {
  return defaultDueAt(severity, from);
}
