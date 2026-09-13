import type {
  AssetActivationState, CarrierRelationshipStatus, CompatibilityVerdict,
  OperatingLeaseStatus, OwnershipClaimStatus, TrailerAttachmentState,
  TrailerDocumentStatus, TrailerOperatingStatus,
} from "@/types";
import { COMPATIBILITY_LABEL } from "@/lib/fleet/compatibility";
import {
  ATTACHMENT_STATE_LABEL, TRAILER_ACTIVATION_LABEL, TRAILER_CARRIER_STATUS_LABEL,
  TRAILER_CLAIM_STATUS_LABEL, TRAILER_DOCUMENT_STATUS_LABEL, TRAILER_LEASE_STATUS_LABEL,
  TRAILER_STATUS_LABEL,
} from "./trailer-labels";
import { cn } from "@/lib/utils";

const CHIP = "shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium";

const STATUS_TONE: Record<TrailerOperatingStatus, string> = {
  available: "bg-st-success-bg text-st-success",
  attached: "bg-st-info-bg text-st-info",
  loaded: "bg-st-progress-bg text-st-progress",
  expected_available: "bg-st-info-bg text-st-info",
  maintenance: "bg-st-warning-bg text-st-warning",
  out_of_service: "bg-st-danger-bg text-st-danger",
};

export function TrailerStatusChip({ status, className }: { status: TrailerOperatingStatus; className?: string }) {
  return <span className={cn(CHIP, STATUS_TONE[status], className)}>{TRAILER_STATUS_LABEL[status]}</span>;
}

const ATTACH_TONE: Record<TrailerAttachmentState, string> = {
  unattached: "bg-st-neutral-bg text-st-neutral",
  reserved_for_attachment: "bg-st-info-bg text-st-info",
  attached: "bg-st-success-bg text-st-success",
  in_active_movement: "bg-st-progress-bg text-st-progress",
  pending_detachment: "bg-st-warning-bg text-st-warning",
  blocked: "bg-st-danger-bg text-st-danger",
  out_of_service: "bg-st-danger-bg text-st-danger",
};

export function AttachmentStateChip({ state, className }: { state: TrailerAttachmentState; className?: string }) {
  return <span className={cn(CHIP, ATTACH_TONE[state], className)}>{ATTACHMENT_STATE_LABEL[state]}</span>;
}

const CARRIER_TONE: Record<CarrierRelationshipStatus, string> = {
  onboarding: "bg-st-progress-bg text-st-progress",
  pending_approval: "bg-st-info-bg text-st-info",
  approved: "bg-st-success-bg text-st-success",
  suspended: "bg-st-warning-bg text-st-warning",
  ended: "bg-st-neutral-bg text-st-neutral",
};

export function TrailerCarrierStatusChip({ status, className }: { status: CarrierRelationshipStatus; className?: string }) {
  return <span className={cn(CHIP, CARRIER_TONE[status], className)}>{TRAILER_CARRIER_STATUS_LABEL[status]}</span>;
}

const LEASE_TONE: Record<OperatingLeaseStatus, string> = {
  reserved: "bg-st-info-bg text-st-info",
  active: "bg-st-success-bg text-st-success",
  pending_release: "bg-st-warning-bg text-st-warning",
  ended: "bg-st-neutral-bg text-st-neutral",
};

export function TrailerLeaseStatusChip({ status, className }: { status: OperatingLeaseStatus; className?: string }) {
  return <span className={cn(CHIP, LEASE_TONE[status], className)}>{TRAILER_LEASE_STATUS_LABEL[status]}</span>;
}

const ACTIVATION_TONE: Record<AssetActivationState, string> = {
  onboarding: "bg-st-progress-bg text-st-progress",
  pending_approval: "bg-st-info-bg text-st-info",
  approved: "bg-st-info-bg text-st-info",
  available_for_activation: "bg-st-success-bg text-st-success",
  activation_reserved: "bg-st-info-bg text-st-info",
  active_operating_lease: "bg-st-progress-bg text-st-progress",
  locked_by_other: "bg-st-neutral-bg text-st-neutral",
  pending_release: "bg-st-warning-bg text-st-warning",
  ended: "bg-st-neutral-bg text-st-neutral",
  suspended: "bg-st-warning-bg text-st-warning",
};

export function TrailerActivationChip({ state, className }: { state: AssetActivationState; className?: string }) {
  return <span className={cn(CHIP, ACTIVATION_TONE[state], className)}>{TRAILER_ACTIVATION_LABEL[state]}</span>;
}

const DOC_TONE: Record<TrailerDocumentStatus, string> = {
  missing: "bg-st-neutral-bg text-st-neutral",
  selected_local: "bg-st-info-bg text-st-info",
  pending_review: "bg-st-progress-bg text-st-progress",
  approved: "bg-st-success-bg text-st-success",
  rejected: "bg-st-danger-bg text-st-danger",
  expiring_soon: "bg-st-warning-bg text-st-warning",
  expired: "bg-st-danger-bg text-st-danger",
  superseded: "bg-st-neutral-bg text-st-neutral",
};

export function TrailerDocumentChip({ status, className }: { status: TrailerDocumentStatus; className?: string }) {
  return <span className={cn(CHIP, DOC_TONE[status], className)}>{TRAILER_DOCUMENT_STATUS_LABEL[status]}</span>;
}

const CLAIM_TONE: Record<OwnershipClaimStatus, string> = {
  pending: "bg-st-info-bg text-st-info",
  accepted: "bg-st-success-bg text-st-success",
  rejected: "bg-st-danger-bg text-st-danger",
  manual_review: "bg-st-warning-bg text-st-warning",
};

export function TrailerClaimChip({ status, className }: { status: OwnershipClaimStatus; className?: string }) {
  return <span className={cn(CHIP, CLAIM_TONE[status], className)}>{TRAILER_CLAIM_STATUS_LABEL[status]}</span>;
}

/**
 * A compatibility verdict.
 *
 * "Not enough information" gets its own warning tone rather than a green or a
 * red, because it is genuinely neither: nothing is wrong, and nothing has been
 * confirmed either.
 */
const COMPAT_TONE: Record<CompatibilityVerdict, string> = {
  compatible: "bg-st-success-bg text-st-success",
  incompatible: "bg-st-danger-bg text-st-danger",
  missing_required_data: "bg-st-warning-bg text-st-warning",
  already_attached: "bg-st-neutral-bg text-st-neutral",
  reserved: "bg-st-info-bg text-st-info",
  locked_by_other_carrier: "bg-st-neutral-bg text-st-neutral",
  carrier_not_approved: "bg-st-warning-bg text-st-warning",
  power_unit_unavailable: "bg-st-neutral-bg text-st-neutral",
  trailer_unavailable: "bg-st-neutral-bg text-st-neutral",
  unauthorized: "bg-st-neutral-bg text-st-neutral",
};

export function CompatibilityChip({ verdict, className }: { verdict: CompatibilityVerdict; className?: string }) {
  return <span className={cn(CHIP, COMPAT_TONE[verdict], className)}>{COMPATIBILITY_LABEL[verdict]}</span>;
}
