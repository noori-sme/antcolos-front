import type {
  CoverageEvaluation, CoverageEvaluationInput, CoverageEvaluationOutcome,
  CoverageNearMiss, CoverageStatus, InsuranceCoverage, InsurancePolicy,
  InsurancePolicyStatus, IsoDateTime, PolicySubject,
} from "@/types";

/**
 * Coverage, read at a moment in time.
 *
 * Every function here takes the instant it is asked about and answers for THAT
 * instant. None of them reads the clock unless the caller omits the time, and
 * none of them mutates anything. That is what makes the answer to "was this
 * truck covered on 3 March?" survive a renewal, a sale, a driver leaving and
 * the operating authority moving to a different carrier.
 *
 * The module is deliberately pure and free of service, registry and React
 * imports, so the rules can be tested directly rather than through a screen.
 */

/** How close to expiry a policy has to be before it reads as "expiring". */
export const EXPIRING_WINDOW_DAYS = 30;

const DAY_MS = 86_400_000;
const EXPIRING_WINDOW_MS = EXPIRING_WINDOW_DAYS * DAY_MS;

const ms = (iso: IsoDateTime) => new Date(iso).getTime();

/** Whole days from `at` until `iso`. Negative once it has passed. */
export function daysUntil(iso: IsoDateTime, at: IsoDateTime | number = Date.now()): number {
  const from = typeof at === "number" ? at : ms(at);
  return Math.floor((ms(iso) - from) / DAY_MS);
}

/* -------------------------------------------------------------------------- */
/* Lifecycle states                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The policy's state AS AT a given instant.
 *
 * Derived rather than stored, so a policy row can never disagree with its own
 * dates. Note the ordering: a policy superseded in June was not superseded in
 * March, so the terminal states are gated on their own timestamps rather than
 * on the recorded status alone.
 */
export function policyStateAt(
  policy: InsurancePolicy,
  at: IsoDateTime | number = Date.now(),
): InsurancePolicyStatus {
  const t = typeof at === "number" ? at : ms(at);

  // Never bound. It answers for nothing, on any date.
  if (policy.recordedStatus === "pending") return "pending";

  if (policy.recordedStatus === "cancelled") {
    if (!policy.cancelledAt || t >= ms(policy.cancelledAt)) return "cancelled";
  }
  if (policy.recordedStatus === "superseded") {
    if (!policy.supersededAt || t >= ms(policy.supersededAt)) return "superseded";
  }

  if (t < ms(policy.effectiveFrom)) return "pending";
  if (t > ms(policy.expiresAt)) return "expired";
  if (ms(policy.expiresAt) - t <= EXPIRING_WINDOW_MS) return "expiring";
  return "active";
}

/** In force = actually answering for a loss. "Expiring" still answers. */
export function policyInForceAt(
  policy: InsurancePolicy,
  at: IsoDateTime | number = Date.now(),
): boolean {
  const state = policyStateAt(policy, at);
  return state === "active" || state === "expiring";
}

export function coverageStateAt(
  coverage: InsuranceCoverage,
  at: IsoDateTime | number = Date.now(),
): CoverageStatus {
  const t = typeof at === "number" ? at : ms(at);

  if (coverage.recordedStatus === "pending") return "pending";
  if (coverage.recordedStatus === "cancelled") {
    if (!coverage.cancelledAt || t >= ms(coverage.cancelledAt)) return "cancelled";
  }
  if (coverage.recordedStatus === "superseded") {
    if (!coverage.supersededAt || t >= ms(coverage.supersededAt)) return "superseded";
  }

  if (t < ms(coverage.effectiveFrom)) return "pending";
  if (t > ms(coverage.expiresAt)) return "expired";
  if (ms(coverage.expiresAt) - t <= EXPIRING_WINDOW_MS) return "expiring";
  return "active";
}

export function coverageInForceAt(
  coverage: InsuranceCoverage,
  at: IsoDateTime | number = Date.now(),
): boolean {
  const state = coverageStateAt(coverage, at);
  return state === "active" || state === "expiring";
}

/**
 * Was this unit on the policy's schedule at that moment?
 *
 * `removedAt` is exclusive: a truck taken off the schedule at noon was covered
 * up to noon and not after it.
 */
export function subjectScheduledAt(
  subject: PolicySubject,
  at: IsoDateTime | number = Date.now(),
): boolean {
  const t = typeof at === "number" ? at : ms(at);
  if (t < ms(subject.addedAt)) return false;
  return subject.removedAt === undefined || t < ms(subject.removedAt);
}

/* -------------------------------------------------------------------------- */
/* Evaluation                                                                  */
/* -------------------------------------------------------------------------- */

/** The records the evaluation reads. Supplied by the caller, never fetched. */
export interface CoverageEvaluationData {
  policies: readonly InsurancePolicy[];
  coverages: readonly InsuranceCoverage[];
  subjects: readonly PolicySubject[];
}

/**
 * Least to most specific. When nothing covers the event, the reason reported is
 * the one closest to having answered — "the truck was not on the schedule that
 * day" is far more useful to an operator than "no policy".
 */
const OUTCOME_SPECIFICITY: CoverageEvaluationOutcome[] = [
  "no_policy",
  "coverage_type_absent",
  "not_scheduled",
  "policy_cancelled",
  "outside_policy_term",
  "outside_coverage_term",
];

function moreSpecific(
  a: CoverageEvaluationOutcome,
  b: CoverageEvaluationOutcome,
): CoverageEvaluationOutcome {
  return OUTCOME_SPECIFICITY.indexOf(a) >= OUTCOME_SPECIFICITY.indexOf(b) ? a : b;
}

interface PolicyVerdict {
  outcome: CoverageEvaluationOutcome;
  reason: string;
  coverage?: InsuranceCoverage;
  subjectLabel?: string;
}

/**
 * How one policy answers for one event.
 *
 * A blanket schedule row (`subjectKind: "carrier"`) stands in for a unit when
 * the coverage line itself says it reaches that kind of unit — which is how a
 * fleet cargo policy with no per-truck schedule genuinely works.
 */
function evaluatePolicy(
  policy: InsurancePolicy,
  input: CoverageEvaluationInput,
  data: CoverageEvaluationData,
): PolicyVerdict {
  const at = input.at;
  const lines = data.coverages.filter(
    (c) => c.policyId === policy.policyId && c.coverageType === input.coverageType,
  );
  if (lines.length === 0) {
    return {
      outcome: "coverage_type_absent",
      reason: `Policy ${policy.policyNumber} carries no ${input.coverageType.replace(/_/g, " ")} line.`,
    };
  }

  const rows = data.subjects.filter((s) => s.policyId === policy.policyId);
  // A unit can appear on one policy's schedule several times over its life —
  // taken off when it went to a shop, put back when it returned. Every row is
  // considered, and the one that was open at the time wins.
  const exactRows = rows.filter(
    (s) => s.subjectKind === input.subjectKind && s.subjectId === input.subjectId,
  );
  const blanketRows = rows.filter(
    (s) => s.subjectKind === "carrier" && s.subjectId === policy.carrierOrganizationId,
  );

  const exactOnSchedule = exactRows.find((s) => subjectScheduledAt(s, at));
  const blanketOnSchedule = blanketRows.find((s) => subjectScheduledAt(s, at));
  // For the explanation when nothing answered: the row that was closed most
  // recently before the event is the one that tells the operator what changed.
  const lastClosed = exactRows
    .filter((s) => s.removedAt)
    .sort((a, b) => ms(b.removedAt!) - ms(a.removedAt!))[0];

  const usableLines = lines.filter((line) => {
    if (exactOnSchedule) return true;
    // Once a policy names a unit, the blanket row stops speaking for it — a
    // truck deliberately taken off a schedule has not quietly stayed covered
    // by an "any auto" line on the same policy.
    if (exactRows.length > 0) return false;
    if (!blanketOnSchedule) return false;
    // A blanket row only reaches a unit when the line says it does. Without
    // that, a general-liability policy would silently "cover" a truck.
    return (
      input.subjectKind === "carrier" ||
      (line.appliesToSubjectKinds?.includes(input.subjectKind) ?? false)
    );
  });

  if (usableLines.length === 0) {
    if (lastClosed?.removedAt) {
      return {
        outcome: "not_scheduled",
        reason: `Taken off policy ${policy.policyNumber}'s schedule on ${lastClosed.removedAt.slice(0, 10)}${lastClosed.removalReason ? ` — ${lastClosed.removalReason}` : "."}`,
      };
    }
    return {
      outcome: "not_scheduled",
      reason: exactRows.length > 0
        ? `Not on policy ${policy.policyNumber}'s schedule on that date.`
        : `Policy ${policy.policyNumber} does not schedule this unit.`,
    };
  }

  const subjectLabel = exactOnSchedule?.subjectLabel ?? blanketOnSchedule?.subjectLabel;


  if (!policyInForceAt(policy, at)) {
    const state = policyStateAt(policy, at);
    return {
      outcome: state === "cancelled" ? "policy_cancelled" : "outside_policy_term",
      reason:
        state === "cancelled"
          ? `Policy ${policy.policyNumber} was cancelled before that date.`
          : `Policy ${policy.policyNumber} was ${state} on that date (term ${policy.effectiveFrom.slice(0, 10)} to ${policy.expiresAt.slice(0, 10)}).`,
      subjectLabel,
    };
  }

  const live = usableLines.find((line) => coverageInForceAt(line, at));
  if (!live) {
    return {
      outcome: "outside_coverage_term",
      reason: `Policy ${policy.policyNumber} was in force, but its ${input.coverageType.replace(/_/g, " ")} line was not.`,
      subjectLabel,
    };
  }

  return { outcome: "covered", reason: "Covered.", coverage: live, subjectLabel };
}

/**
 * Was this subject covered for this kind of loss, at this instant, under this
 * carrier's authority?
 *
 * The carrier is an input rather than something looked up, because the right
 * carrier is whoever held operating authority WHEN THE EVENT HAPPENED. Reading
 * it from today's relationships is exactly the bug this module exists to
 * prevent.
 */
export function evaluateCoverage(
  input: CoverageEvaluationInput,
  data: CoverageEvaluationData,
): CoverageEvaluation {
  // Newest in-force policy first. Two things depend on this order: which
  // policy answers when several could, and — when none does — which policy's
  // reason is reported. "Unit 118 came off this schedule on the 30th" is
  // worth far more to an operator than "last year's policy never listed it".
  const candidates = data.policies
    .filter((p) => p.carrierOrganizationId === input.carrierOrganizationId)
    .sort((a, b) => {
      const inForce = Number(policyInForceAt(b, input.at)) - Number(policyInForceAt(a, input.at));
      if (inForce !== 0) return inForce;
      return ms(b.effectiveFrom) - ms(a.effectiveFrom);
    });

  if (candidates.length === 0) {
    return {
      input,
      outcome: "no_policy",
      covered: false,
      reason: "No policy of any kind is recorded for this carrier.",
      nearMisses: [],
    };
  }

  const nearMisses: CoverageNearMiss[] = [];
  let best: CoverageEvaluationOutcome = "no_policy";

  for (const policy of candidates) {
    const verdict = evaluatePolicy(policy, input, data);
    if (verdict.outcome === "covered" && verdict.coverage) {
      return {
        input,
        outcome: "covered",
        covered: true,
        reason: `Covered by ${policy.insurer.name} policy ${policy.policyNumber}.`,
        policyId: policy.policyId,
        policyNumber: policy.policyNumber,
        policyVersionNumber: policy.versionNumber,
        insurerName: policy.insurer.name,
        coverageId: verdict.coverage.coverageId,
        limitPerOccurrence: verdict.coverage.limitPerOccurrence,
        deductible: verdict.coverage.deductible,
        subjectLabel: verdict.subjectLabel,
        nearMisses,
      };
    }
    nearMisses.push({
      policyId: policy.policyId,
      policyNumber: policy.policyNumber,
      outcome: verdict.outcome,
      reason: verdict.reason,
    });
    best = moreSpecific(best, verdict.outcome);
  }

  const leading = nearMisses.find((n) => n.outcome === best);
  return {
    input,
    outcome: best,
    covered: false,
    reason: leading?.reason ?? "No coverage answered for this event.",
    nearMisses,
  };
}
