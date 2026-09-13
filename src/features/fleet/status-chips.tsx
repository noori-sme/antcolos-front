import type {
  CarrierRelationshipStatus, OperatingLeaseStatus, OwnershipClaimStatus, TruckActivationState,
  TruckDocumentStatus, TruckOperatingStatus, TruckRelationshipStatus,
} from "@/types";
import {
  ACTIVATION_STATE_LABEL, CARRIER_STATUS_LABEL, CLAIM_STATUS_LABEL, DOCUMENT_STATUS_LABEL,
  LEASE_STATUS_LABEL, RELATIONSHIP_STATUS_LABEL, TRUCK_STATUS_LABEL,
} from "./fleet-labels";
import { cn } from "@/lib/utils";

const CHIP = "shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium";

const TRUCK_TONE: Record<TruckOperatingStatus, string> = {
  available: "bg-st-success-bg text-st-success",
  loaded: "bg-st-progress-bg text-st-progress",
  expected_available: "bg-st-info-bg text-st-info",
  unavailable: "bg-st-neutral-bg text-st-neutral",
  maintenance: "bg-st-warning-bg text-st-warning",
};

export function TruckStatusChip({ status, className }: { status: TruckOperatingStatus; className?: string }) {
  return <span className={cn(CHIP, TRUCK_TONE[status], className)}>{TRUCK_STATUS_LABEL[status]}</span>;
}

const REL_TONE: Record<TruckRelationshipStatus, string> = {
  pending: "bg-st-info-bg text-st-info",
  active: "bg-st-success-bg text-st-success",
  suspended: "bg-st-warning-bg text-st-warning",
  ended: "bg-st-neutral-bg text-st-neutral",
};

export function RelationshipStatusChip({ status, className }: { status: TruckRelationshipStatus; className?: string }) {
  return <span className={cn(CHIP, REL_TONE[status], className)}>{RELATIONSHIP_STATUS_LABEL[status]}</span>;
}

const CARRIER_TONE: Record<CarrierRelationshipStatus, string> = {
  onboarding: "bg-st-progress-bg text-st-progress",
  pending_approval: "bg-st-info-bg text-st-info",
  approved: "bg-st-success-bg text-st-success",
  suspended: "bg-st-warning-bg text-st-warning",
  ended: "bg-st-neutral-bg text-st-neutral",
};

export function CarrierStatusChip({ status, className }: { status: CarrierRelationshipStatus; className?: string }) {
  return <span className={cn(CHIP, CARRIER_TONE[status], className)}>{CARRIER_STATUS_LABEL[status]}</span>;
}

const LEASE_TONE: Record<OperatingLeaseStatus, string> = {
  reserved: "bg-st-info-bg text-st-info",
  active: "bg-st-success-bg text-st-success",
  pending_release: "bg-st-warning-bg text-st-warning",
  ended: "bg-st-neutral-bg text-st-neutral",
};

export function LeaseStatusChip({ status, className }: { status: OperatingLeaseStatus; className?: string }) {
  return <span className={cn(CHIP, LEASE_TONE[status], className)}>{LEASE_STATUS_LABEL[status]}</span>;
}

const ACTIVATION_TONE: Record<TruckActivationState, string> = {
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

export function ActivationStateChip({ state, className }: { state: TruckActivationState; className?: string }) {
  return <span className={cn(CHIP, ACTIVATION_TONE[state], className)}>{ACTIVATION_STATE_LABEL[state]}</span>;
}

const DOC_TONE: Record<TruckDocumentStatus, string> = {
  missing: "bg-st-neutral-bg text-st-neutral",
  selected_local: "bg-st-info-bg text-st-info",
  pending_review: "bg-st-progress-bg text-st-progress",
  approved: "bg-st-success-bg text-st-success",
  rejected: "bg-st-danger-bg text-st-danger",
  expiring_soon: "bg-st-warning-bg text-st-warning",
  expired: "bg-st-danger-bg text-st-danger",
  superseded: "bg-st-neutral-bg text-st-neutral",
};

export function DocumentStatusChip({ status, className }: { status: TruckDocumentStatus; className?: string }) {
  return <span className={cn(CHIP, DOC_TONE[status], className)}>{DOCUMENT_STATUS_LABEL[status]}</span>;
}

const CLAIM_TONE: Record<OwnershipClaimStatus, string> = {
  pending: "bg-st-info-bg text-st-info",
  accepted: "bg-st-success-bg text-st-success",
  rejected: "bg-st-danger-bg text-st-danger",
  manual_review: "bg-st-warning-bg text-st-warning",
};

export function ClaimStatusChip({ status, className }: { status: OwnershipClaimStatus; className?: string }) {
  return <span className={cn(CHIP, CLAIM_TONE[status], className)}>{CLAIM_STATUS_LABEL[status]}</span>;
}
