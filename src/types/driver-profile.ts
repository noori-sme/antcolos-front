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

/* -------------------------------------------------------------------------- */
/* What a dispatcher sees of a driver                                          */
/* -------------------------------------------------------------------------- */

/**
 * Whether the person can take a load right now, and when they cannot.
 *
 * Separate from the truck's status on purpose: a truck can be sitting empty
 * while the driver on it is out of hours, at home, or has simply not been asked
 * yet. Collapsing the two is how a dispatcher books a load nobody can run.
 */
export interface DriverAvailability {
  status: DriverAvailabilityStatus;
  /** When they come back, for a driver who is not available now. */
  availableAt?: string;
  /** Hours-of-service in the driver's own words. Never computed here. */
  hoursNote?: string;
  homeTerminal?: string;
  /** Where the person actually is, when anybody has recorded it. */
  currentCity?: string;
  currentState?: string;
}

export type DriverAvailabilityStatus =
  | "available"
  | "driving"
  | "off_duty"
  | "time_off"
  | "inactive";

export const DRIVER_AVAILABILITY_LABEL: Record<DriverAvailabilityStatus, string> = {
  available: "Available",
  driving: "Driving",
  off_duty: "Off duty",
  time_off: "Time off",
  inactive: "Not working",
};

/**
 * What the driver has asked for.
 *
 * Preferences are not rules: a carrier rule stops a load, a driver preference
 * is something a dispatcher should know before they pick up the phone. Keeping
 * them apart is what lets milestone 4 refuse a load on a rule and merely warn
 * on a preference.
 */
export interface DriverPreferences {
  /** States the driver would rather run. Not a refusal. */
  preferredStates?: string[];
  /** States the driver has asked not to be sent to. */
  avoidStates?: string[];
  /** The longest they want to be away from home, in days. */
  maxDaysOut?: number;
  /** A day of the week they want to be home by, in the driver's words. */
  homeBy?: string;
  /** Endorsements the driver actually holds. */
  endorsements?: string[];
  runsTeam?: boolean;
  notes?: string;
}

/**
 * One workspace's view of one driver, right now.
 *
 * A projection, like FleetTruck and CarrierView: derived from the relationship
 * the viewer holds and never stored. The driver is a permanent person with one
 * profile that follows them between carriers; this is what a particular
 * workspace is entitled to see of them today.
 *
 * The narrowing that matters: documents travel only as far as the driver agreed
 * when they joined the carrier, and a dispatch agency working for that carrier
 * sees what the carrier sees and no more. The licence NUMBER is withheld from a
 * dispatch workspace outright — dispatch needs to know the licence is valid and
 * where it is from, never the number itself.
 */
export interface DriverView {
  driverProfileId: string;
  legalName: string;
  phone?: string;
  email?: string;
  /** Present only for the carrier that engaged the driver. */
  cdlNumber?: string;
  cdlState: string;
  cdlExpiresAt: string;
  medicalCardExpiresAt?: string;
  /**
   * Whether the medical card reached this viewer at all.
   *
   * Absent-because-withheld and absent-because-nobody-has-one look identical in
   * a date field, and they are not the same thing: one is the driver's choice
   * and the other is a gap somebody has to close. This says which.
   */
  medicalCardShared: boolean;
  availability: DriverAvailability;
  preferences: DriverPreferences;
  /** The carrier this view is through, and on what basis. */
  carrierOrganizationId: string;
  carrierName: string;
  engagementType: EngagementType;
  engagementStatus: RelationshipStatus;
  engagedSince?: string;
  /**
   * What the driver may do in Antcolos under this engagement.
   *
   * Snapshotted onto the engagement when the carrier invited them, so a later
   * role edit does not rewrite what they were given. A dispatcher needs it to
   * know what to expect of the person: whether they can mark themselves arrived,
   * whether they can upload a proof of delivery, or whether somebody else has
   * to do it for them.
   */
  permissions: PermissionKey[];
  /** Only the documents the driver agreed to share with that carrier. */
  documents: DriverDocument[];
  /** Requirements behind those documents, so a gap can be named. */
  requirements: DriverDocumentRequirement[];
  /** Why this viewer may see the driver at all. */
  reason: DriverAccessReason;
}

export type DriverAccessReason =
  /** The viewer is the carrier that engaged the driver. */
  | "engaging_carrier"
  /** The viewer dispatches for that carrier. */
  | "dispatch_access"
  /** The viewer is the driver. */
  | "self";
