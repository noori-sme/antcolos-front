import type { PermissionKey } from "./permission";

/**
 * The carrier decides this when it sends the invitation, and the driver cannot
 * change it: it determines what paperwork is required and how the driver is
 * paid, so it is not the driver's to pick.
 */
export type EngagementType = "company_driver" | "owner_operator";

/**
 * A driver's account and a driver's work for a carrier are different things.
 *
 * `DriverProfile` is the person: it belongs to them, follows them between
 * carriers, and is never deleted when a relationship ends.
 * `CarrierRelationship` is one carrier's engagement with that person. Ending it
 * ends the carrier's access, and nothing else.
 */
export interface DriverProfile {
  id: string;
  /** The Antcolos account behind the profile. One account, many carriers. */
  userId: string;
  username: string;
  legalName: string;
  email: string;
  phone?: string;
  cdlNumber: string;
  cdlState: string;
  cdlExpiresAt: string;
  /** Learned from the medical card document rather than typed at signup. */
  medicalCardExpiresAt?: string;
  createdAt: string;
}

export type RelationshipStatus =
  | "invited"
  | "onboarding"
  | "active"
  | "suspended"
  | "ended";

export interface CarrierRelationship {
  id: string;
  driverProfileId: string;
  carrierId: string;
  carrierName: string;
  engagementType: EngagementType;
  /** Snapshotted from the invitation, so later role edits do not rewrite history. */
  roleName: string;
  permissions: PermissionKey[];
  invitedAt: string;
  startedAt?: string;
  status: RelationshipStatus;
  endedAt?: string;
  endReason?: string;
  /**
   * What the driver agreed to share with THIS carrier. A snapshot: the carrier
   * keeps what it was given, and stops receiving updates when the relationship
   * ends.
   */
  sharedDocumentKeys: string[];
  assignedTruckId?: string;
}

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

export type DocumentStatus =
  | "not_started"
  | "uploading"
  | "uploaded"
  | "under_review"
  | "approved"
  | "rejected"
  | "expired"
  | "expiring_soon";

/** Driver paperwork versus the paperwork only an owner-operator owes. */
export type DriverDocumentCategory = "driver" | "owner_operator";

/**
 * What a carrier asks for. Held as data rather than code so different carriers
 * can require different things without a release.
 */
export interface DriverDocumentRequirement {
  key: string;
  label: string;
  description: string;
  category: DriverDocumentCategory;
  required: boolean;
  /** Whether the document carries an expiry the driver must supply. */
  expires: boolean;
  /** True when this carrier added it beyond the standard set. */
  carrierSpecific?: boolean;
}

export interface DriverDocument {
  requirementKey: string;
  status: DocumentStatus;
  fileName?: string;
  fileType?: string;
  sizeBytes?: number;
  /** 0-100 while uploading. */
  progress?: number;
  expiresAt?: string;
  rejectionReason?: string;
  submittedAt?: string;
  updatedAt?: string;
}
