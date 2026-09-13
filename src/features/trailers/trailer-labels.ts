import type {
  AssetActivationState, CarrierRelationshipStatus, CarrierRelationshipType,
  OperatingLeaseStatus, OwnershipClaimStatus, TrailerAttachmentState,
  TrailerDocumentStatus, TrailerOperatingStatus,
} from "@/types";

export const TRAILER_STATUS_LABEL: Record<TrailerOperatingStatus, string> = {
  available: "Available",
  attached: "Attached",
  loaded: "Loaded",
  expected_available: "Expected available",
  maintenance: "Maintenance",
  out_of_service: "Out of service",
};

export const TRAILER_STATUS_DESCRIPTION: Record<TrailerOperatingStatus, string> = {
  available: "Free and ready to be hooked up.",
  attached: "Hooked to a power unit but not on a movement.",
  loaded: "Carrying freight.",
  expected_available: "Committed now, free at the time shown.",
  maintenance: "In the shop. Cannot be attached until it comes out.",
  out_of_service: "Withdrawn from service. Cannot be attached at all.",
};

/** Where the trailer is in its relationship with a power unit. */
export const ATTACHMENT_STATE_LABEL: Record<TrailerAttachmentState, string> = {
  unattached: "Unattached",
  reserved_for_attachment: "Reserved for attachment",
  attached: "Attached",
  in_active_movement: "In active movement",
  pending_detachment: "Pending detachment",
  blocked: "Blocked",
  out_of_service: "Out of service",
};

export const ATTACHMENT_STATE_DESCRIPTION: Record<TrailerAttachmentState, string> = {
  unattached: "Not on a power unit. It can be hooked to any compatible one.",
  reserved_for_attachment: "Committed to a power unit. Nobody else can take it while the reservation stands.",
  attached: "Hooked to a power unit and ready to work.",
  in_active_movement: "Out on a movement. It cannot be unhooked until the movement is finished.",
  pending_detachment: "Detachment has been asked for. It comes off once nothing is in motion.",
  blocked: "Something is stopping this pairing. The reason is on the attachment panel.",
  out_of_service: "Withdrawn from service. It cannot be attached to anything.",
};

/** A carrier's onboarding progress with a trailer. Eligibility, not operation. */
export const TRAILER_CARRIER_STATUS_LABEL: Record<CarrierRelationshipStatus, string> = {
  onboarding: "Onboarding",
  pending_approval: "Pending approval",
  approved: "Approved",
  suspended: "Suspended",
  ended: "Ended",
};

export const TRAILER_CARRIER_STATUS_DESCRIPTION: Record<CarrierRelationshipStatus, string> = {
  onboarding: "Paperwork for this carrier is still being put together.",
  pending_approval: "Sent for review. Nothing can be activated until it is approved.",
  approved: "Allowed to run this trailer when no other carrier holds it.",
  suspended: "On hold. Activation is not possible while suspended.",
  ended: "Finished. Kept as history and never deleted.",
};

export const TRAILER_LEASE_STATUS_LABEL: Record<OperatingLeaseStatus, string> = {
  reserved: "Reserved",
  active: "Active",
  pending_release: "Pending release",
  ended: "Ended",
};

/** What one carrier can do about one trailer, right now. */
export const TRAILER_ACTIVATION_LABEL: Record<AssetActivationState, string> = {
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

export const TRAILER_ACTIVATION_DESCRIPTION: Record<AssetActivationState, string> = {
  onboarding: "Finish onboarding this trailer with your organization first.",
  pending_approval: "Your onboarding is waiting for review. Activation is not possible yet.",
  approved: "You are approved for this trailer. Activation opens when it is free.",
  available_for_activation:
    "No carrier holds this trailer. You can take operating authority for a period of time.",
  activation_reserved:
    "You have reserved activation. Nobody else can take the trailer while the reservation stands.",
  active_operating_lease:
    "You hold operating authority for this trailer. No other carrier can activate it.",
  locked_by_other:
    "This trailer is under another carrier's active operating lease. It becomes available again when that lease ends.",
  pending_release:
    "Release has been requested. The trailer stays under your authority until every release requirement is recorded.",
  ended: "Your relationship with this trailer has ended.",
  suspended: "Your relationship with this trailer is suspended.",
};

export const TRAILER_RELATIONSHIP_TYPE_LABEL: Record<CarrierRelationshipType, string> = {
  carrier_owned: "Carrier-owned",
  leased_owner_operator: "Leased Owner-Operator",
};

export const TRAILER_DOCUMENT_STATUS_LABEL: Record<TrailerDocumentStatus, string> = {
  missing: "Missing",
  selected_local: "Selected, not uploaded",
  pending_review: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  expiring_soon: "Expiring soon",
  expired: "Expired",
  superseded: "Replaced",
};

export const TRAILER_CLAIM_STATUS_LABEL: Record<OwnershipClaimStatus, string> = {
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

/** Inches read as feet and inches, because that is how a yard talks. */
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

/** A masked VIN, so a shoulder-surfer cannot read a whole one off a screen. */
export function maskTrailerVin(vin: string): string {
  if (vin.length < 10) return vin;
  return `${vin.slice(0, 3)}${"•".repeat(vin.length - 9)}${vin.slice(-6)}`;
}
