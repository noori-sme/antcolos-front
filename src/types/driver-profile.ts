import type { DocumentRequirement, DocumentStatus as UnifiedDocumentStatus } from "./document-center";
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
  /**
   * When the person opened the invitation and said yes.
   *
   * ★ ACCEPTING IS NOT STARTING ★
   * These are two different facts and the product must not collapse them. A
   * driver who accepts on Tuesday has agreed to work for this carrier; they
   * have not yet driven for it, and in most cases cannot until the paperwork
   * is in. `acceptedAt` is what Antcolos OBSERVED. `startedAt` is when the
   * working relationship actually began, which for a genuinely new driver
   * nobody knows yet — so it stays ABSENT rather than being filled in with the
   * acceptance date because a date field looked empty.
   *
   * The one case where `startedAt` legitimately precedes `acceptedAt` is an
   * IMPORTED relationship: a carrier asserting that somebody has driven for
   * them since March. That is the carrier's assertion, carried as such, and
   * accepting an invitation never converts it into something Antcolos saw.
   */
  acceptedAt?: string;
  startedAt?: string;
  /**
   * WHERE `startedAt` CAME FROM. Absent whenever `startedAt` is.
   *
   * `observed` — Antcolos watched it happen: somebody activated the
   *   relationship here, on this date, and the event is in the ledger.
   * `carrier_asserted` — the carrier told us, typically on import. It may well
   *   be true and it is not ours to contradict, but it is a claim rather than
   *   something we saw, and every surface that shows it says whose claim.
   *
   * Nothing promotes `carrier_asserted` to `observed`. Accepting an invitation
   * certainly does not: the person agreeing to work here today says nothing
   * about what a spreadsheet claimed about last March.
   */
  startedAtBasis?: "observed" | "carrier_asserted";
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
  requirements: DocumentRequirement[];
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
