import type {
  CarrierRelationshipStatus, CarrierRelationshipType, OperatingLeaseStatus,
  OwnershipClaimStatus, TruckActivationState, TruckDocumentStatus,
  TruckOperatingStatus, TruckRelationshipStatus,
} from "@/types";

export const TRUCK_STATUS_LABEL: Record<TruckOperatingStatus, string> = {
  available: "Available",
  loaded: "Loaded",
  expected_available: "Expected available",
  unavailable: "Unavailable",
  maintenance: "Maintenance",
};

export const RELATIONSHIP_TYPE_LABEL: Record<CarrierRelationshipType, string> = {
  carrier_owned: "Carrier-owned",
  leased_owner_operator: "Leased Owner-Operator",
};

export const RELATIONSHIP_TYPE_DESCRIPTION: Record<CarrierRelationshipType, string> = {
  carrier_owned: "Your organization owns this truck and runs it on your authority.",
  leased_owner_operator: "An owner-operator owns it; you run it on your authority.",
};

/** Dispatch access has the simpler lifecycle. */
export const RELATIONSHIP_STATUS_LABEL: Record<TruckRelationshipStatus, string> = {
  pending: "Pending",
  active: "Active",
  suspended: "Suspended",
  ended: "Ended",
};

/** A carrier's onboarding progress with a truck. Eligibility, not operation. */
export const CARRIER_STATUS_LABEL: Record<CarrierRelationshipStatus, string> = {
  onboarding: "Onboarding",
  pending_approval: "Pending approval",
  approved: "Approved",
  suspended: "Suspended",
  ended: "Ended",
};

export const CARRIER_STATUS_DESCRIPTION: Record<CarrierRelationshipStatus, string> = {
  onboarding: "Paperwork for this carrier is still being put together.",
  pending_approval: "Sent for review. Nothing can be activated until it is approved.",
  approved: "Allowed to run this truck when no other carrier holds it.",
  suspended: "On hold. Activation is not possible while suspended.",
  ended: "Finished. Kept as history and never deleted.",
};

export const LEASE_STATUS_LABEL: Record<OperatingLeaseStatus, string> = {
  reserved: "Reserved",
  active: "Active",
  pending_release: "Pending release",
  ended: "Ended",
};

/** What one carrier can do about one truck, right now. */
export const ACTIVATION_STATE_LABEL: Record<TruckActivationState, string> = {
  onboarding: "Onboarding",
  pending_approval: "Pending approval",
  approved: "Approved",
  available_for_activation: "Available for activation",
  activation_reserved: "Activation reserved",
  active_operating_lease: "Active operating lease",
  locked_by_other: "Temporarily unavailable",
  pending_release: "Pending release",
  ended: "Ended",
  suspended: "Suspended",
};

export const ACTIVATION_STATE_DESCRIPTION: Record<TruckActivationState, string> = {
  onboarding: "Finish onboarding this truck with your organization first.",
  pending_approval: "Your onboarding is waiting for review. Activation is not possible yet.",
  approved: "You are approved for this truck. Activation opens when it is free.",
  available_for_activation:
    "No carrier holds this truck. You can take operating authority for a period of time.",
  activation_reserved:
    "You have reserved activation. Nobody else can take the truck while the reservation stands.",
  active_operating_lease:
    "You hold operating authority for this truck. No other carrier can activate it.",
  locked_by_other:
    "This truck is under another carrier's active operating lease. It becomes available again when that lease ends.",
  pending_release:
    "Release has been requested. The truck stays under your authority until every release requirement is recorded.",
  ended: "Your relationship with this truck has ended.",
  suspended: "Your relationship with this truck is suspended.",
};

export const DOCUMENT_STATUS_LABEL: Record<TruckDocumentStatus, string> = {
  missing: "Missing",
  selected_local: "Selected, not uploaded",
  pending_review: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  expiring_soon: "Expiring soon",
  expired: "Expired",
  superseded: "Replaced",
};

export const CLAIM_STATUS_LABEL: Record<OwnershipClaimStatus, string> = {
  pending: "Pending",
  accepted: "Accepted",
  rejected: "Rejected",
  manual_review: "Manual review",
};

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
}

export function formatInches(value?: number): string {
  if (value === undefined) return "—";
  const feet = Math.floor(value / 12);
  const inches = value % 12;
  return feet > 0 ? `${feet}' ${inches}"` : `${inches}"`;
}

export function formatNumber(value?: number, unit?: string): string {
  if (value === undefined) return "—";
  return `${value.toLocaleString()}${unit ? ` ${unit}` : ""}`;
}
