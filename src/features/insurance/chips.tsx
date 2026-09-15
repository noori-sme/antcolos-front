import { Badge } from "@/components/ui/badge";
import {
  CERTIFICATE_STATUS_LABEL, CERTIFICATE_STATUS_TONE, CLAIM_SEVERITY_LABEL,
  CLAIM_SEVERITY_TONE, CLAIM_STATUS_TONE, CLAIM_TYPE_LABEL,
  COVERAGE_OUTCOME_LABEL, COVERAGE_OUTCOME_TONE, COVERAGE_STATUS_LABEL,
  COVERAGE_STATUS_TONE, COVERAGE_TYPE_LABEL, POLICY_STATUS_LABEL,
  POLICY_STATUS_TONE,
} from "@/lib/insurance/labels";
import { CLAIM_STATUS_LABEL } from "@/lib/insurance/claim-states";
import type {
  CertificateStatus, ClaimSeverity, ClaimStatus, ClaimType,
  CoverageEvaluationOutcome, CoverageStatus, CoverageType,
  InsuranceDisclosureLevel, InsurancePolicyStatus,
} from "@/types";

/** One badge vocabulary for insurance. No screen picks its own colours. */

export function PolicyStatusChip({ status }: { status: InsurancePolicyStatus }) {
  return <Badge tone={POLICY_STATUS_TONE[status]}>{POLICY_STATUS_LABEL[status]}</Badge>;
}

export function CoverageStatusChip({ status }: { status: CoverageStatus }) {
  return <Badge tone={COVERAGE_STATUS_TONE[status]}>{COVERAGE_STATUS_LABEL[status]}</Badge>;
}

export function CoverageTypeChip({ type }: { type: CoverageType }) {
  return <Badge tone="outline">{COVERAGE_TYPE_LABEL[type]}</Badge>;
}

export function ClaimStatusChip({ status }: { status: ClaimStatus }) {
  return <Badge tone={CLAIM_STATUS_TONE[status]}>{CLAIM_STATUS_LABEL[status]}</Badge>;
}

export function ClaimTypeChip({ type }: { type: ClaimType }) {
  return <Badge tone="outline">{CLAIM_TYPE_LABEL[type]}</Badge>;
}

export function ClaimSeverityChip({ severity }: { severity: ClaimSeverity }) {
  return <Badge tone={CLAIM_SEVERITY_TONE[severity]}>{CLAIM_SEVERITY_LABEL[severity]}</Badge>;
}

export function CertificateStatusChip({ status }: { status: CertificateStatus }) {
  return <Badge tone={CERTIFICATE_STATUS_TONE[status]}>{CERTIFICATE_STATUS_LABEL[status]}</Badge>;
}

export function CoverageOutcomeChip({ outcome }: { outcome: CoverageEvaluationOutcome }) {
  return <Badge tone={COVERAGE_OUTCOME_TONE[outcome]}>{COVERAGE_OUTCOME_LABEL[outcome]}</Badge>;
}

/**
 * Says out loud when a viewer is looking at a shared summary rather than the
 * whole record — so nobody reads a missing premium as a premium of zero.
 */
export function DisclosureNotice({ level }: { level: InsuranceDisclosureLevel }) {
  if (level !== "shared_summary") return null;
  return (
    <p className="rounded-md border border-st-info/35 bg-st-info-bg/40 px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-fg-muted">
      <span className="font-medium text-fg">Shared with you.</span>{" "}
      The carrier has given your organization a summary for a stated purpose. Premiums,
      deductibles, private notes and anything to do with claim money stay with the carrier
      and are not hidden from you here — they were never sent.
    </p>
  );
}

/**
 * The honest state of insurer verification.
 *
 * Nothing in this build has been checked with an insurer, and the badge says
 * exactly that rather than leaving a blank space that reads as approval.
 */
export function VerificationChip({ state }: { state: string }) {
  if (state === "verified") return <Badge tone="success">Verified with insurer</Badge>;
  return <Badge tone="warning">Not verified with the insurer</Badge>;
}
