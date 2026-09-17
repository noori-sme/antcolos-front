import {
  RETENTION_MAPPING_UNVERIFIED, RETENTION_PROTECTED_STATES,
  type QualificationRecord, type QualificationRecordCategory,
  type QualificationRetention, type QualificationRetentionState,
  type RetentionPolicy,
} from "@/types";

/**
 * ★ RETENTION, AS FAR AS THIS BUILD HONESTLY KNOWS IT ★
 *
 * Which retention rule governs a driving licence, a medical certificate, a
 * motor vehicle record or a drug and alcohol test result is a question about
 * the applicable regulation, the exact record category and the jurisdiction.
 *
 * ███ ANTCOLOS HAS NOT VERIFIED ANY OF THOSE MAPPINGS ███
 * So this file asserts none of them. Every category below carries
 * `mappingVerified: false` and NO basis. There is no period, no date, and no
 * statement about when a clock starts or stops.
 *
 * An earlier version of this file cited a regulation and assigned each category
 * a retention basis. Both were written from memory and neither was checked
 * against the official regulatory text. Removing the citation while leaving
 * "kept for a period from the date it was received" on screen would have been
 * the same claim with the footnote taken off, so the assignments are gone too.
 *
 * What the module still does, and can defend:
 *
 *   • It records OBSERVED FACTS — when a record was received, when a
 *     relationship ended, when one adoption superseded another.
 *   • It keeps every retained record, and refuses to destroy one.
 *   • It fails CLOSED: with no verified mapping and no backend policy, nothing
 *     ever becomes eligible for disposal and disposal is always refused.
 *
 * Turning any of that into a date is the backend's, and only after the mapping
 * has been verified and legal holds are actually enforced. Nothing here is
 * legal advice and this build is not a compliant qualification-file system.
 */

export type { RetentionPolicy };

/**
 * The categories, and what is known about each. Which is, deliberately, only
 * that the mapping has not been verified.
 *
 * The rows exist so a backend policy has a stable key to attach a verified
 * mapping to — not so this build can imply one it has not done.
 */
export const RETENTION_POLICIES: readonly RetentionPolicy[] = ([
  "commercial_licence",
  "medical_certificate",
  "motor_vehicle_record",
  "annual_mvr_review",
  "employment_application",
  "road_test_certificate",
  "drug_alcohol_test_result",
  "clearinghouse_query",
  "background_check",
  "handbook_acknowledgement",
  "carrier_qualification_decision",
  "other",
] as const).map((category): RetentionPolicy => ({
  key: `ret_${category}`,
  category,
  // Absent, on purpose. See the header.
  basis: undefined,
  mappingVerified: false,
}));

const BY_CATEGORY = new Map(RETENTION_POLICIES.map((p) => [p.category, p]));

export function retentionPolicyFor(category: QualificationRecordCategory): RetentionPolicy {
  return BY_CATEGORY.get(category) ?? BY_CATEGORY.get("other")!;
}

/**
 * The retention block for a newly adopted record.
 *
 * No basis, no clock, no end date — only the policy key the record maps to and
 * the state it is in. `receivedAt` already lives on the record itself, so the
 * one fact a backend needs to start a receipt-based clock is not lost.
 */
export function initialRetention(
  category: QualificationRecordCategory,
  receivedAt: string,
): QualificationRetention {
  void receivedAt;
  return {
    policyKey: retentionPolicyFor(category).key,
    basis: undefined,
    retainUntil: undefined,
    state: "active",
    legalHold: false,
  };
}

/**
 * Records that the working relationship ended.
 *
 * It DELETES NOTHING and starts nothing: the date below is an observed fact
 * about the relationship, not the beginning of a period this build claims to
 * know. What changes is the state, so the record reads as retained-after-
 * departure rather than as live evidence.
 */
export function retentionOnRelationshipEnd(
  retention: QualificationRetention,
  endedAt: string,
): QualificationRetention {
  return {
    ...retention,
    state: "relationship_ended_retained",
    relationshipEndedAt: endedAt,
    stateReason:
      "The working relationship ended. The record is kept; ordinary operational "
      + "access to it has ended.",
  };
}

/** A record the carrier replaced with a newer adoption. Kept, not deleted. */
export function retentionOnSuperseded(
  retention: QualificationRetention,
  supersededAt: string,
): QualificationRetention {
  void supersededAt;
  return {
    ...retention,
    state: "superseded_retained",
    stateReason: "A newer version was adopted. This record shows what was relied on before.",
  };
}

/**
 * The state, with whatever clock exists applied.
 *
 * `eligible_for_disposal` is unreachable in this build: it needs a
 * backend-supplied `retainUntil`, which nothing here ever sets.
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
 * States the observed facts — what happened and when — and then says plainly
 * that the applicable schedule is not configured. It never names a regulation
 * and never implies a period.
 */
export function retentionExplanation(
  record: Pick<QualificationRecord, "retention" | "category" | "receivedAt">,
  at: Date = new Date(),
): string {
  const { retention } = record;
  const state = effectiveRetentionState(retention, at);

  if (state === "disposed") {
    return `Disposed on ${retention.disposedAt?.slice(0, 10)}. The disposal is recorded; the record's content is not.`;
  }

  const facts = [`Received ${record.receivedAt.slice(0, 10)}.`];
  if (retention.relationshipEndedAt) {
    facts.push(`The working relationship ended ${retention.relationshipEndedAt.slice(0, 10)}.`);
  }
  if (retention.retainUntil) {
    facts.push(`A policy has set retention to ${retention.retainUntil.slice(0, 10)}.`);
    return facts.join(" ");
  }
  return `${facts.join(" ")} ${RETENTION_MAPPING_UNVERIFIED}`;
}
