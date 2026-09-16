import {
  RETENTION_POLICY_NOT_CONFIGURED, RETENTION_PROTECTED_STATES,
  type QualificationRecord, type QualificationRecordCategory,
  type QualificationRetention, type QualificationRetentionBasis,
  type QualificationRetentionState, type RetentionPolicy,
} from "@/types";

/**
 * ★ RETENTION, BASIS FIRST ★
 *
 * 49 CFR §391.51 requires a motor carrier to keep a driver qualification file
 * for each driver it employs, and the rule is NOT one clock: some records are
 * kept while the driver is employed plus a further period, others run from the
 * date they were made, and a superseded record has its own schedule. That SHAPE
 * is a real modelling decision and it is what this file encodes.
 *
 * ███ WHAT THIS FILE DELIBERATELY DOES NOT CONTAIN ███
 * A number. Not one period, not one date, not one "three years".
 *
 * The applicable period depends on the exact record category, the jurisdiction
 * and the current text of the regulation, and none of that is knowable in a
 * browser. A retention date rendered by a frontend looks exactly as
 * authoritative as one a compliance team signed off, and a carrier that acted
 * on a number this build invented would have been misled by us. So the basis is
 * declared, the date is left to the backend policy, and where a date would go
 * the product says `RETENTION_POLICY_NOT_CONFIGURED` out loud.
 *
 * The consequences are deliberate and they fail safe:
 *   • With no policy configured, nothing ever becomes `eligible_for_disposal`.
 *   • So disposal is refused, because a record whose obligation nobody can
 *     compute is a record still under obligation.
 *
 * Nothing here is legal advice, and this build is not a compliant DQ-file
 * system.
 */

export type { RetentionPolicy };

const P = (
  category: QualificationRecordCategory,
  basis: QualificationRetentionBasis,
  rationale: string,
): RetentionPolicy => ({ key: `ret_${category}`, category, basis, rationale });

/**
 * The basis for each category. No periods — see the header.
 *
 * Exhaustive over `QualificationRecordCategory` by the lookup below falling
 * back to `other`, which is itself a declared row rather than an invented one.
 */
export const RETENTION_POLICIES: readonly RetentionPolicy[] = [
  P("commercial_licence", "engagement_plus_period",
    "Part of the qualification file: kept while the driver works here, then for a further period the policy sets."),
  P("medical_certificate", "engagement_plus_period",
    "The medical certification record belongs to the qualification file and is kept beyond the last day worked."),
  P("motor_vehicle_record", "fixed_period_from_receipt",
    "A driving record is evidence of what was checked on a date, so its period runs from the date it was received."),
  P("annual_mvr_review", "fixed_period_from_receipt",
    "The annual review is a dated act; each year's review is kept from the date it was made."),
  P("employment_application", "engagement_plus_period",
    "The application is a qualification-file record and is kept beyond the last day worked."),
  P("road_test_certificate", "engagement_plus_period",
    "The road test, or the accepted equivalent, is a qualification-file record."),
  P("drug_alcohol_test_result", "fixed_period_from_receipt",
    "Testing programme records have their own schedule, separate from the general qualification-file one."),
  P("clearinghouse_query", "fixed_period_from_receipt",
    "A query record proves a check was made on a date."),
  P("background_check", "fixed_period_from_receipt",
    "Evidence of a check made on a date, kept from that date."),
  P("handbook_acknowledgement", "engagement_plus_period",
    "An acknowledgement is about the period the person worked here."),
  P("carrier_qualification_decision", "engagement_plus_period",
    "The carrier's own decision is the record it will be asked to produce."),
  P("other", "engagement_plus_period",
    "No specific basis is recorded for this category. The backend policy decides."),
];

const BY_CATEGORY = new Map(RETENTION_POLICIES.map((p) => [p.category, p]));

export function retentionPolicyFor(category: QualificationRecordCategory): RetentionPolicy {
  return BY_CATEGORY.get(category) ?? BY_CATEGORY.get("other")!;
}

/**
 * The retention block for a newly adopted record.
 *
 * A `fixed_period_from_receipt` record's clock STARTS at receipt — that much is
 * knowable — but it has no `retainUntil`, because how long it runs is not.
 * An `engagement_plus_period` record has not even started.
 */
export function initialRetention(
  category: QualificationRecordCategory,
  receivedAt: string,
): QualificationRetention {
  const policy = retentionPolicyFor(category);
  return {
    policyKey: policy.key,
    basis: policy.basis,
    clockStartedAt: policy.basis === "fixed_period_from_receipt" ? receivedAt : undefined,
    // Never computed here. Only a backend policy sets this.
    retainUntil: undefined,
    state: "active",
    legalHold: false,
  };
}

/**
 * Starts the clock that could not start earlier.
 *
 * Called when the working relationship ends, which is the event
 * `engagement_plus_period` has been waiting for. It DELETES NOTHING: every
 * record stays with its pinned evidence, and what changes is that the
 * obligation now has a start it could not have while the person was working.
 * A `fixed_period_from_receipt` clock is NOT restarted — that record's period
 * has been running since the day it arrived.
 */
export function retentionOnRelationshipEnd(
  retention: QualificationRetention,
  endedAt: string,
): QualificationRetention {
  return {
    ...retention,
    state: "relationship_ended_retained",
    clockStartedAt: retention.basis === "engagement_plus_period"
      ? endedAt
      : retention.clockStartedAt,
    stateReason:
      "The working relationship ended. The record is kept; ordinary operational "
      + "access to it has ended and only an authorized holder may read it.",
  };
}

/** A record the carrier replaced with a newer adoption. Kept, not deleted. */
export function retentionOnSuperseded(
  retention: QualificationRetention,
  supersededAt: string,
): QualificationRetention {
  return {
    ...retention,
    state: "superseded_retained",
    clockStartedAt: retention.basis === "superseded_plus_period"
      ? supersededAt
      : retention.clockStartedAt,
    stateReason: "A newer version was adopted. This record shows what was relied on before.",
  };
}

/**
 * The state with whatever clock exists applied.
 *
 * `eligible_for_disposal` is reachable ONLY through a backend-supplied
 * `retainUntil`. With none — which is every record in this build — the record
 * stays retained, and that is the safe direction to fail in.
 */
export function effectiveRetentionState(
  retention: QualificationRetention,
  at: Date = new Date(),
): QualificationRetentionState {
  if (retention.state === "disposed") return "disposed";
  if (retention.legalHold) return retention.state;
  if (!retention.retainUntil) return retention.state;
  return new Date(retention.retainUntil).getTime() <= at.getTime()
    ? "eligible_for_disposal"
    : retention.state;
}

/** True while nobody may dispose of the record, whatever permission they hold. */
export function isUnderRetention(
  retention: QualificationRetention,
  at: Date = new Date(),
): boolean {
  if (retention.legalHold) return true;
  return RETENTION_PROTECTED_STATES.includes(effectiveRetentionState(retention, at));
}

/**
 * Why this record is kept, and the honest answer about until when.
 *
 * The basis is stated as a fact; the date is stated as missing. Both halves
 * matter: the basis is what this build genuinely knows, and the missing date is
 * what it genuinely does not.
 */
export function retentionExplanation(
  record: Pick<QualificationRecord, "retention" | "category">,
  at: Date = new Date(),
): string {
  const { retention } = record;
  const policy = retentionPolicyFor(record.category);
  const state = effectiveRetentionState(retention, at);

  if (state === "disposed") {
    return `Disposed on ${retention.disposedAt?.slice(0, 10)}. The disposal is recorded; the record's content is not.`;
  }
  const started = retention.clockStartedAt
    ? `The period has been running since ${retention.clockStartedAt.slice(0, 10)}.`
    : retention.basis === "engagement_plus_period"
      ? "The period has not started: it runs from the day the working relationship ends."
      : "The period has not started.";
  const until = retention.retainUntil
    ? `It runs to ${retention.retainUntil.slice(0, 10)}.`
    : RETENTION_POLICY_NOT_CONFIGURED;
  return `${policy.rationale} ${started} ${until}`;
}
