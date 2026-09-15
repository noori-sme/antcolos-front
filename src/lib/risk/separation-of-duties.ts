import type { RiskCase, RiskSeverity } from "@/types";
import { RISK_ATTENTION_SEVERITIES } from "@/types";

/**
 * ★ NOBODY INVESTIGATES THEMSELVES ★
 *
 * A case about a person's own actions cannot be investigated, decided or closed
 * by that person — however senior they are, and including an Owner. An Owner
 * may see the case, open it, add a note and hand it to somebody else; they may
 * not be the independent review of their own action.
 *
 * Policy decides when independent review is required, not the person opening
 * the case, because a rule that can be switched off by the subject is not a
 * rule. On this branch: every high and critical case requires it.
 */

export function requiresIndependentReview(severity: RiskSeverity): boolean {
  return RISK_ATTENTION_SEVERITIES.includes(severity);
}

export function isSubjectOfCase(membershipId: string, riskCase: RiskCase): boolean {
  return riskCase.subjectMembershipIds.includes(membershipId);
}

export type SeparationVerdict =
  | { allowed: true }
  | { allowed: false; reason: string };

const CONFLICT_REASON =
  "This case is about your own actions. Somebody else has to look at it — you can add a note and hand it on, " +
  "but you cannot investigate, decide or close it.";

/**
 * May this membership do investigative work on the case — take it, move it,
 * record a decision, close it?
 */
export function mayInvestigate(
  membershipId: string,
  riskCase: RiskCase,
): SeparationVerdict {
  if (!riskCase.independentReviewRequired) return { allowed: true };
  if (isSubjectOfCase(membershipId, riskCase)) {
    return { allowed: false, reason: CONFLICT_REASON };
  }
  return { allowed: true };
}

/**
 * May this membership be given the case?
 *
 * Same rule, separated so the assignment screen can filter the list rather than
 * offering a person and then refusing the save.
 */
export function mayBeAssigned(
  membershipId: string,
  riskCase: RiskCase,
): SeparationVerdict {
  return mayInvestigate(membershipId, riskCase);
}

export class SeparationOfDutiesError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "SeparationOfDutiesError";
  }
}

export function assertMayInvestigate(membershipId: string, riskCase: RiskCase): void {
  const verdict = mayInvestigate(membershipId, riskCase);
  if (!verdict.allowed) throw new SeparationOfDutiesError(verdict.reason);
}
