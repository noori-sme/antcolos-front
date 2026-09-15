import type { badgeVariants } from "@/components/ui/badge";
import type {
  CertificateHolderKind, CertificateStatus, ClaimCostKind,
  ClaimEvidenceKind, ClaimResponsibilityKind, ClaimSeverity, ClaimThirdPartyRole,
  ClaimType, CoverageEvaluationOutcome, CoverageStatus, CoverageType,
  InsuranceDisclosureLevel, InsurancePolicyStatus, PolicyReplacementReason,
  PolicySubjectKind,
} from "@/types";

type Tone = NonNullable<Parameters<typeof badgeVariants>[0]>["tone"];

/** One vocabulary for insurance, used by every screen. Nothing is inlined. */

export const COVERAGE_TYPE_LABEL: Record<CoverageType, string> = {
  auto_liability: "Auto liability",
  general_liability: "General liability",
  cargo: "Cargo",
  physical_damage: "Physical damage",
  trailer_interchange: "Trailer interchange",
  non_trucking_liability: "Non-trucking liability",
  workers_compensation: "Workers' compensation",
  occupational_accident: "Occupational accident",
  reefer_breakdown: "Reefer breakdown",
  umbrella: "Umbrella",
  other: "Other",
};

export const COVERAGE_TYPE_DESCRIPTION: Record<CoverageType, string> = {
  auto_liability: "Injury and damage you cause to other people with the vehicle.",
  general_liability: "Injury and damage arising from the business itself, away from the vehicle.",
  cargo: "Loss or damage to the freight you are hauling.",
  physical_damage: "Damage to your own truck or trailer, however it happened.",
  trailer_interchange: "Damage to a trailer you are pulling but do not own.",
  non_trucking_liability: "Cover while the truck is being used off dispatch.",
  workers_compensation: "Injury to employees, as required by the state.",
  occupational_accident: "Injury cover for owner-operators, who are not employees.",
  reefer_breakdown: "Freight spoiled because the reefer unit failed.",
  umbrella: "Extra limit sitting above the underlying policies.",
  other: "Cover that does not fit the standard lines.",
};

export const POLICY_STATUS_LABEL: Record<InsurancePolicyStatus, string> = {
  active: "Active",
  pending: "Pending",
  expiring: "Expiring",
  expired: "Expired",
  cancelled: "Cancelled",
  superseded: "Superseded",
};

export const POLICY_STATUS_TONE: Record<InsurancePolicyStatus, Tone> = {
  active: "success",
  pending: "info",
  expiring: "warning",
  expired: "danger",
  cancelled: "danger",
  superseded: "neutral",
};

export const COVERAGE_STATUS_LABEL: Record<CoverageStatus, string> = POLICY_STATUS_LABEL;
export const COVERAGE_STATUS_TONE: Record<CoverageStatus, Tone> = POLICY_STATUS_TONE;

export const CLAIM_TYPE_LABEL: Record<ClaimType, string> = {
  accident: "Accident",
  cargo_damage: "Cargo damage",
  property_damage: "Property damage",
  bodily_injury: "Bodily injury",
  theft: "Theft",
  vandalism: "Vandalism",
  weather: "Weather",
  equipment_damage: "Equipment damage",
  other: "Other",
};

export const CLAIM_STATUS_TONE: Record<string, Tone> = {
  reported: "info",
  under_review: "warning",
  submitted: "progress",
  investigating: "progress",
  approved: "success",
  denied: "danger",
  paid: "success",
  closed: "neutral",
};

export const CLAIM_SEVERITY_LABEL: Record<ClaimSeverity, string> = {
  minor: "Minor",
  moderate: "Moderate",
  major: "Major",
  catastrophic: "Catastrophic",
};

export const CLAIM_SEVERITY_TONE: Record<ClaimSeverity, Tone> = {
  minor: "neutral",
  moderate: "info",
  major: "warning",
  catastrophic: "danger",
};

export const CERTIFICATE_STATUS_LABEL: Record<CertificateStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  expired: "Expired",
  revoked: "Revoked",
  superseded: "Superseded",
};

export const CERTIFICATE_STATUS_TONE: Record<CertificateStatus, Tone> = {
  draft: "neutral",
  issued: "success",
  expired: "danger",
  revoked: "danger",
  superseded: "neutral",
};

export const CERTIFICATE_HOLDER_LABEL: Record<CertificateHolderKind, string> = {
  broker: "Broker",
  shipper: "Shipper",
  facility: "Facility",
  carrier: "Carrier",
  dispatch_organization: "Dispatch organization",
  other: "Other",
};

export const SUBJECT_KIND_LABEL: Record<PolicySubjectKind, string> = {
  carrier: "Whole operation",
  truck: "Truck",
  trailer: "Trailer",
  driver: "Driver",
};

export const CLAIM_COST_LABEL: Record<ClaimCostKind, string> = {
  reserve: "Reserve",
  repair: "Repair",
  towing: "Towing",
  cargo_loss: "Cargo loss",
  property_damage: "Property damage",
  medical: "Medical",
  legal: "Legal",
  adjuster: "Adjuster",
  rental: "Replacement vehicle",
  salvage_credit: "Salvage credit",
  other: "Other",
};

export const CLAIM_EVIDENCE_LABEL: Record<ClaimEvidenceKind, string> = {
  photo: "Photos",
  police_report: "Police report",
  repair_estimate: "Repair estimate",
  bill_of_lading: "Bill of lading",
  proof_of_delivery: "Proof of delivery",
  dashcam: "Dashcam footage",
  telematics_export: "Telematics export",
  witness_statement: "Witness statement",
  medical_report: "Medical report",
  other: "Other",
};

export const THIRD_PARTY_ROLE_LABEL: Record<ClaimThirdPartyRole, string> = {
  other_driver: "Other driver",
  other_carrier: "Other carrier",
  property_owner: "Property owner",
  cargo_owner: "Cargo owner",
  witness: "Witness",
  police: "Police",
  adjuster: "Adjuster",
  repair_shop: "Repair shop",
  attorney: "Attorney",
  other: "Other",
};

export const RESPONSIBILITY_LABEL: Record<ClaimResponsibilityKind, string> = {
  our_driver: "Our driver",
  third_party: "A third party",
  shared: "Shared",
  no_fault: "No fault",
  undetermined: "Not determined",
};

export const REPLACEMENT_REASON_LABEL: Record<PolicyReplacementReason, string> = {
  renewal: "Renewal",
  rewrite: "Rewritten mid-term",
  insurer_change: "Moved to a new insurer",
  coverage_change: "Coverage changed",
  correction: "Correction",
};

/** Plain language for why coverage did or did not answer. */
export const COVERAGE_OUTCOME_LABEL: Record<CoverageEvaluationOutcome, string> = {
  covered: "Covered",
  no_policy: "No policy on record",
  not_scheduled: "Not on the schedule",
  outside_policy_term: "Outside the policy term",
  outside_coverage_term: "Outside the coverage term",
  policy_cancelled: "Policy cancelled",
  coverage_type_absent: "Coverage line not carried",
};

export const COVERAGE_OUTCOME_TONE: Record<CoverageEvaluationOutcome, Tone> = {
  covered: "success",
  no_policy: "danger",
  not_scheduled: "danger",
  outside_policy_term: "danger",
  outside_coverage_term: "danger",
  policy_cancelled: "danger",
  coverage_type_absent: "warning",
};

export const DISCLOSURE_LABEL: Record<InsuranceDisclosureLevel, string> = {
  full: "Full access",
  shared_summary: "Shared summary",
  none: "No access",
};

/** Short, unambiguous dates. Insurance arguments are about days, not minutes. */
export function insuranceDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  }).format(new Date(iso));
}

export function insuranceDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZone: "UTC",
  }).format(new Date(iso));
}

/** "in 24 days" / "18 days ago" / "today" — how an expiry actually reads. */
export function expiryLabel(days: number): string {
  if (days === 0) return "today";
  if (days > 0) return `in ${days} ${days === 1 ? "day" : "days"}`;
  const past = Math.abs(days);
  return `${past} ${past === 1 ? "day" : "days"} ago`;
}
