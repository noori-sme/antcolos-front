import type {
  CoverageGapSeverity, CoverageType, PolicySubjectKind,
} from "@/types";

/**
 * What a carrier is expected to carry, per kind of unit.
 *
 * Held as data rather than as branches so a carrier's own requirements can be
 * configured later without a release, and so the gap detector, the dashboard
 * and the Needs You queue all read the same list instead of three drifting
 * copies of it.
 *
 * These are ANTCOLOS DEFAULTS, not a legal minimum and not filed limits.
 * Nothing here is checked against FMCSA, a state filing or an insurer.
 */
export interface CoverageRequirement {
  subjectKind: PolicySubjectKind;
  coverageType: CoverageType;
  /** Missing required cover is a gap; missing recommended cover is advice. */
  required: boolean;
  severity: CoverageGapSeverity;
  /** Written for a carrier owner, not for an underwriter. */
  why: string;
}

export const COVERAGE_REQUIREMENTS: readonly CoverageRequirement[] = [
  {
    subjectKind: "carrier", coverageType: "general_liability", required: true,
    severity: "high",
    why: "Brokers and facilities ask for general liability before they will tender freight.",
  },
  {
    subjectKind: "truck", coverageType: "auto_liability", required: true,
    severity: "critical",
    why: "A power unit on the road without auto liability is the single largest exposure a carrier has.",
  },
  {
    subjectKind: "truck", coverageType: "cargo", required: true,
    severity: "critical",
    why: "Freight on an uninsured truck leaves the carrier paying the customer's loss out of pocket.",
  },
  {
    subjectKind: "truck", coverageType: "physical_damage", required: false,
    severity: "medium",
    why: "Repairs to your own truck are not paid by liability cover.",
  },
  {
    subjectKind: "trailer", coverageType: "physical_damage", required: true,
    severity: "high",
    why: "Damage to the trailer itself is not covered by the power unit's liability policy.",
  },
  {
    subjectKind: "trailer", coverageType: "trailer_interchange", required: false,
    severity: "medium",
    why: "Needed whenever you pull a trailer somebody else owns under an interchange agreement.",
  },
  {
    subjectKind: "driver", coverageType: "occupational_accident", required: false,
    severity: "medium",
    why: "Owner-operators are not covered by workers' compensation and usually carry this instead.",
  },
] as const;

export function requirementsFor(subjectKind: PolicySubjectKind): CoverageRequirement[] {
  return COVERAGE_REQUIREMENTS.filter((r) => r.subjectKind === subjectKind);
}

export function requiredCoverageTypes(subjectKind: PolicySubjectKind): CoverageType[] {
  return requirementsFor(subjectKind).filter((r) => r.required).map((r) => r.coverageType);
}
