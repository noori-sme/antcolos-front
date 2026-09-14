import type { DocumentStatus as UnifiedDocumentStatus } from "./document-center";
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

/**
 * A driver's paperwork uses THE document model, not one of its own.
 *
 * Driver documents used to have their own eight-value status vocabulary. They
 * do not any more: `DocumentStatus` below is the shared one, so a medical card
 * means the same thing on the driver's phone, in the carrier's Document Center
 * and in the Needs You queue.
 *
 * `DriverDocument` survives as the driver screens' row shape — a projection of
 * the unified record, carrying the browser-only upload progress the shared
 * record has no business storing.
 */
export type { DocumentStatus } from "./document-center";

/** Driver paperwork versus the paperwork only an owner-operator owes. */
export type DriverDocumentCategory = "driver" | "owner_operator";

export interface DriverDocument {
  requirementKey: string;
  /** The unified record this row projects, once one exists. */
  documentId?: string;
  status: UnifiedDocumentStatus;
  /**
   * UI-only: the browser is reading the chosen file. There is no upload and no
   * server, so this never reaches the shared record.
   */
  uploading?: boolean;
  fileName?: string;
  fileType?: string;
  sizeBytes?: number;
  /**
   * 0-100 while the browser reads the file. There is no upload and no server,
   * so this is a local progress indicator and nothing else.
   */
  progress?: number;
  expiresAt?: string;
  rejectionReason?: string;
  submittedAt?: string;
  updatedAt?: string;
}
