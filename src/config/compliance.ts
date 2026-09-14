import type { badgeVariants } from "@/components/ui/badge";
import type {
  ComplianceEvidenceState, ComplianceEvidenceSystem, ComplianceHistoryAction,
  ComplianceRenewalBasis, ComplianceResolutionMethod, ComplianceResponsibilityKind,
  ComplianceSeverity, ComplianceStatus, ComplianceSubjectKind,
  ComplianceVerificationBasis,
} from "@/types";

type Tone = NonNullable<Parameters<typeof badgeVariants>[0]>["tone"];

export const COMPLIANCE_STATUS: Record<
  ComplianceStatus,
  { label: string; tone: Tone; description: string }
> = {
  compliant: {
    label: "Compliant",
    tone: "success",
    description: "Satisfied, and not near its next due date.",
  },
  action_required: {
    label: "Action required",
    tone: "danger",
    description: "Nothing on file satisfies it, or the evidence was rejected.",
  },
  expiring: {
    label: "Expiring",
    tone: "warning",
    description: "Satisfied, but inside the warning window before it lapses.",
  },
  expired: {
    label: "Expired",
    tone: "danger",
    description: "The due date has passed.",
  },
  suspended: {
    label: "Suspended",
    tone: "neutral",
    description: "Deliberately paused while the subject is not operating.",
  },
  not_applicable: {
    label: "Not applicable",
    tone: "outline",
    description: "This requirement does not reach this subject, and says why.",
  },
};

export const COMPLIANCE_SEVERITY: Record<ComplianceSeverity, { label: string; tone: Tone }> = {
  critical: { label: "Critical", tone: "danger" },
  high: { label: "High", tone: "warning" },
  medium: { label: "Medium", tone: "info" },
  low: { label: "Low", tone: "neutral" },
};

export const COMPLIANCE_SUBJECT_LABEL: Record<ComplianceSubjectKind, string> = {
  carrier: "Organization",
  driver: "Driver",
  truck: "Truck",
  trailer: "Trailer",
};

export const COMPLIANCE_SUBJECT_PLURAL: Record<ComplianceSubjectKind, string> = {
  carrier: "Organization",
  driver: "Drivers",
  truck: "Trucks",
  trailer: "Trailers",
};

export const RENEWAL_BASIS_LABEL: Record<ComplianceRenewalBasis, string> = {
  none: "One time — does not renew",
  fixed_interval: "Fixed interval",
  document_expiry: "Follows the document's own expiry",
  event_driven: "Driven by events Antcolos does not track yet",
};

export const RESPONSIBILITY_LABEL: Record<ComplianceResponsibilityKind, string> = {
  organization: "The organization",
  membership: "A named person in this organization",
  driver: "The driver",
  equipment_owner: "The recorded owner of the equipment",
};

export const EVIDENCE_SYSTEM_LABEL: Record<ComplianceEvidenceSystem, string> = {
  document_center: "Document Center",
  driver_document: "Driver documents",
  truck_document: "Truck documents",
  trailer_document: "Trailer documents",
  recorded_attestation: "Recorded by a person — no file",
};

export const EVIDENCE_STATE: Record<ComplianceEvidenceState, { label: string; tone: Tone }> = {
  missing: { label: "Nothing on file", tone: "neutral" },
  pending_review: { label: "Awaiting review", tone: "warning" },
  approved: { label: "Accepted", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  expiring_soon: { label: "Expiring soon", tone: "warning" },
  expired: { label: "Expired", tone: "danger" },
  superseded: { label: "Replaced", tone: "neutral" },
};

/**
 * What Antcolos is willing to say about where a date came from.
 *
 * One value, because there is one truth: somebody typed it in, or uploaded a
 * document that carried it. Nothing here is checked against FMCSA, the
 * Clearinghouse, a state agency, an insurer, an ELD or any monitoring service.
 */
export const VERIFICATION_BASIS_LABEL: Record<ComplianceVerificationBasis, string> = {
  recorded_in_antcolos: "Recorded in Antcolos — not verified with any outside service",
};

export const HISTORY_ACTION_LABEL: Record<ComplianceHistoryAction, string> = {
  requirement_created: "Requirement created",
  became_applicable: "Became applicable",
  became_not_applicable: "No longer applicable",
  status_changed: "Status changed",
  evidence_linked: "Evidence linked",
  evidence_cleared: "Evidence cleared",
  due_date_set: "Due date set",
  renewed: "Renewed",
  responsibility_assigned: "Responsibility assigned",
  note_added: "Note added",
  waived: "Waived",
  waiver_revoked: "Waiver revoked",
  suspended: "Suspended",
  reinstated: "Reinstated",
  access_ended: "Access ended",
  snapshot_taken: "Snapshot taken",
};

export const RESOLUTION_METHOD_LABEL: Record<ComplianceResolutionMethod, string> = {
  evidence_accepted: "Evidence accepted",
  renewed: "Renewed",
  corrected: "Corrected",
  waived: "Waived",
  no_longer_applicable: "No longer applicable",
};
