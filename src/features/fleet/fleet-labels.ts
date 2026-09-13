import type {
  CarrierRelationshipType, OwnershipClaimStatus, TruckDocumentStatus,
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

export const RELATIONSHIP_STATUS_LABEL: Record<TruckRelationshipStatus, string> = {
  pending: "Pending",
  active: "Active",
  suspended: "Suspended",
  ended: "Ended",
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
