import type {
  AssetActivationState, AssetDocumentSnapshot, CarrierRelationshipStatus,
  CarrierRelationshipType, DocumentLifecycleStatus, LeaseTermination,
  OperatingLeaseStatus, OwnerType, OwnershipClaimStatus, OwnershipRecordStatus,
  ScopedAccessStatus,
} from "./asset";

export type {
  CarrierRelationshipStatus, CarrierRelationshipType, LeaseTermination,
  OperatingLeaseStatus, OwnerType, OwnershipClaimStatus, OwnershipRecordStatus,
} from "./asset";

/**
 * The permanent Truck.
 *
 * A truck is not a row belonging to a carrier. It is a physical vehicle with
 * one permanent record in Antcolos, and everything that changes about it over
 * its life — who owns it, who operates it, who drives it, what paperwork it
 * carries — hangs off that record as a dated relationship.
 *
 * Three identifiers, three jobs, and they are not interchangeable:
 *
 *   truckId  Antcolos's own permanent identity. An immutable UUID, assigned
 *            once at creation and never reused, rewritten or regenerated —
 *            not by an ownership transfer, not by a carrier change.
 *   vin      The real world's identity for the vehicle. Used for matching and
 *            duplicate detection, so two people cannot create two records for
 *            one truck.
 *   unit     An operational label ("104", "A-12"). It belongs to the carrier
 *            relationship, not to the truck, and changes when the truck moves
 *            between carriers.
 */
export interface Truck {
  /** Immutable UUID. Never a unit number, VIN, row id or org-scoped code. */
  truckId: string;
  /** Normalized, 17 characters. The real-world key. */
  vin: string;
  equipmentType: TruckEquipmentType;
  year: number;
  make: string;
  model: string;
  color?: string;
  registration: TruckRegistration;
  specs: TruckSpecs;
  /** Physical state of the vehicle — not of any one carrier's view of it. */
  status: TruckOperatingStatus;
  availability: TruckAvailability;
  notes?: string;
  createdAt: string;
  /**
   * Audit provenance only: who first registered the truck. It confers no
   * access whatsoever — visibility is derived from relationships alone, so
   * that a carrier which later ends its relationship loses the truck even
   * though it created the record.
   */
  createdByOrganizationId: string;
}

/**
 * Power units only. Trailers are a separate entity with their own permission
 * module and are never represented as a truck.
 */
export type TruckEquipmentType =
  | "cargo_van"
  | "sprinter_van"
  | "box_truck"
  | "hotshot"
  | "tractor";

export type TruckOperatingStatus =
  | "available"
  | "loaded"
  | "expected_available"
  | "unavailable"
  | "maintenance";

export interface TruckRegistration {
  plateNumber: string;
  plateState: string;
  expiresAt: string;
  /** As printed on the registration. Not proof of legal ownership by itself. */
  registeredOwnerName: string;
}

export interface TruckAvailability {
  expectedAvailableAt?: string;
  city?: string;
  state?: string;
  homeTerminal?: string;
}

/**
 * Capacity and equipment detail. Every field is optional because a cargo van
 * has no sleeper and a tractor has no cargo box — the form asks only what the
 * chosen equipment type can actually answer.
 */
export interface TruckSpecs {
  gvwrLbs?: number;
  emptyWeightLbs?: number;
  /** What the truck can carry itself. NOT what it can tow. */
  maxPayloadLbs?: number;
  /**
   * The heaviest trailer this power unit may pull, when anybody has recorded
   * it. Absent for vehicles that do not tow, and absent when simply unknown —
   * the compatibility service treats those two cases differently.
   */
  maxTowableWeightLbs?: number;
  cargoLengthIn?: number;
  cargoWidthIn?: number;
  cargoHeightIn?: number;
  doorWidthIn?: number;
  doorHeightIn?: number;
  palletCapacity?: number;
  axleCount?: number;
  fuelType?: "diesel" | "gasoline" | "electric" | "hybrid";
  hasSleeper?: boolean;
  hasLiftgate?: boolean;
  isDockHeight?: boolean;
  hasReefer?: boolean;
  hazmatCapable?: boolean;
  constraints?: string;
}

/* -------------------------------------------------------------------------- */
/* Legal ownership                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Who legally owns the truck, and when.
 *
 * Ownership is a relationship attached to the permanent truckId, never part of
 * the truck's identity. A transfer ends one record and opens another; it never
 * touches the truck, its VIN, its specifications, its documents or any other
 * history.
 */
export interface TruckOwnershipRecord {
  id: string;
  truckId: string;
  ownerType: OwnerType;
  ownerName: string;
  /** Organization or driver-profile id when the owner exists in Antcolos. */
  ownerRef?: string;
  startedAt: string;
  endedAt?: string;
  status: OwnershipRecordStatus;
  /** Filenames only — see the mock registry; nothing is uploaded or verified. */
  evidence: TruckDocumentSnapshot[];
  createdByMembershipId: string;
  createdByName: string;
  createdAt: string;
}

/** Someone asserting they own a truck that already exists in Antcolos. */
export interface TruckOwnershipClaim {
  id: string;
  truckId: string;
  claimantOrganizationId: string;
  claimantName: string;
  claimedOwnerType: OwnerType;
  claimedOwnerName: string;
  status: OwnershipClaimStatus;
  evidence: TruckDocumentSnapshot[];
  note?: string;
  createdAt: string;
  resolvedAt?: string;
  resolutionNote?: string;
}

/* -------------------------------------------------------------------------- */
/* Carrier operating relationship                                              */
/* -------------------------------------------------------------------------- */


/** Kept for dispatch-access records, which have a simpler lifecycle. */
export type TruckRelationshipStatus = ScopedAccessStatus;

/**
 * Which carrier OPERATES the truck, and on what basis.
 *
 * Operating is not owning: a carrier runs an owner-operator's truck under its
 * own authority without ever holding the title. Exactly one operating carrier
 * relationship may be active at a time — a truck cannot run under two
 * authorities at once.
 *
 * The unit number lives here, because it is this carrier's label for the
 * vehicle and follows the relationship rather than the truck.
 */
export interface TruckCarrierRelationship {
  id: string;
  truckId: string;
  organizationId: string;
  organizationName: string;
  relationshipType: CarrierRelationshipType;
  unitNumber: string;
  status: CarrierRelationshipStatus;
  /** Per-carrier onboarding evidence. Never shared with another carrier. */
  insuranceEvidence?: TruckDocumentSnapshot[];
  leaseAgreement?: TruckDocumentSnapshot;
  approvedAt?: string;
  startedAt: string;
  endedAt?: string;
  endReason?: string;
  initiatedByOrganizationId: string;
  createdAt: string;
  /** Operating parameters this carrier sets for the truck. */
  minimumRatePerMileCents?: number;
  maxDeadheadMiles?: number;
}

/* -------------------------------------------------------------------------- */
/* Operating authority lease                                                   */
/* -------------------------------------------------------------------------- */


/**
 * Exclusive operating authority over a truck, for a period of time.
 *
 * A truck can be onboarded and approved with any number of carriers, but it can
 * only physically run under ONE authority at a time — so exactly one lease may
 * be reserved or active for a truck at any moment. Everyone else who is
 * approved simply waits.
 *
 * The lease is what locks the truck, and only the lease releases it.
 */
export interface TruckOperatingLease {
  id: string;
  truckId: string;
  organizationId: string;
  organizationName: string;
  /** The approved onboarding relationship that entitled this carrier to it. */
  relationshipId: string;
  status: OperatingLeaseStatus;
  /**
   * The carrier's own reference for the work. Confidential: never shown to
   * another carrier, who sees only that the truck is unavailable.
   */
  loadReference?: string;
  /** Set when this lease is one half of a truck-and-trailer activation. */
  combinationId?: string;
  /** The trailer the movement was activated with, when there was one. */
  trailerId?: string;
  reservedAt?: string;
  activatedAt?: string;
  /** Planned end. Reaching it does NOT release the truck — see the checklist. */
  expectedEndAt?: string;
  releaseRequestedAt?: string;
  endedAt?: string;
  termination: LeaseTermination;
  createdAt: string;
  initiatedByMembershipId: string;
  initiatedByName: string;
}


/**
 * What one carrier sees when it looks at one truck.
 *
 * Derived from that carrier's own relationship plus whatever lease is live on
 * the truck — never stored, because it differs per carrier and changes the
 * moment somebody else activates.
 */
export type TruckActivationState = AssetActivationState;

/* -------------------------------------------------------------------------- */
/* Dispatch organization access                                                */
/* -------------------------------------------------------------------------- */

/**
 * A dispatch organization's access to a truck — the third, separate kind of
 * relationship.
 *
 * A dispatch agency is a service provider. It neither owns the truck nor runs
 * it under its own authority; it books and manages freight on it on behalf of
 * the operating carrier, and its access is granted by that carrier. Modelling
 * this as a carrier relationship would make a dispatcher look like an operator,
 * and modelling it as ownership would be plainly wrong.
 *
 * Ownership, the operating carrier relationship and dispatch access may all be
 * active at the same time on one permanent truck — three relationships, three
 * different organizations, still one truckId.
 */
export interface TruckDispatchAccess {
  id: string;
  truckId: string;
  dispatchOrganizationId: string;
  dispatchOrganizationName: string;
  /** The operating carrier whose freight this dispatcher moves. */
  grantedByCarrierOrganizationId: string;
  grantedByCarrierName: string;
  /** The dispatcher's own label for the truck, if they use one. */
  unitLabel?: string;
  status: TruckRelationshipStatus;
  startedAt: string;
  endedAt?: string;
  endReason?: string;
  initiatedByOrganizationId: string;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* Driver assignment                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Which driver is on the truck, for which carrier, and when.
 *
 * Ending an assignment never alters the driver's permanent profile, and a
 * carrier can only assign drivers from its own organization.
 */
export interface TruckDriverAssignment {
  id: string;
  truckId: string;
  organizationId: string;
  driverProfileId: string;
  driverName: string;
  startedAt: string;
  endedAt?: string;
  endReason?: string;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

export type TruckDocumentStatus = DocumentLifecycleStatus;

export type TruckDocumentKind =
  | "registration"
  | "title"
  | "insurance"
  | "annual_inspection"
  | "cab_card"
  | "lease_agreement"
  | "other";

export interface TruckDocumentRequirement {
  kind: TruckDocumentKind;
  label: string;
  description: string;
  required: boolean;
  expires: boolean;
  /** Limits the requirement to particular equipment types when set. */
  equipmentTypes?: TruckEquipmentType[];
}

/**
 * A document record. `selected_local` is the honest state for this build: the
 * browser told us a filename, a type and a size, and nothing else happened.
 */
export interface TruckDocument {
  id: string;
  truckId: string;
  kind: TruckDocumentKind;
  status: TruckDocumentStatus;
  fileName?: string;
  fileType?: string;
  sizeBytes?: number;
  expiresAt?: string;
  rejectionReason?: string;
  /**
   * Set when the document was added for one carrier's onboarding rather than
   * for the truck itself. Only that carrier sees it.
   */
  carrierOrganizationId?: string;
  /** Set when a newer document replaced this one. The old record survives. */
  supersededByDocumentId?: string;
  addedByOrganizationId: string;
  createdAt: string;
  updatedAt: string;
}

/** What a carrier keeps after a document is replaced or a relationship ends. */
export type TruckDocumentSnapshot = AssetDocumentSnapshot<TruckDocumentKind>;

/* -------------------------------------------------------------------------- */
/* Timeline                                                                    */
/* -------------------------------------------------------------------------- */

export type TruckEventKind =
  | "created"
  | "status_changed"
  | "availability_changed"
  | "ownership_started"
  | "ownership_ended"
  | "ownership_claim_opened"
  | "ownership_claim_resolved"
  | "relationship_requested"
  | "relationship_started"
  | "relationship_ended"
  | "relationship_suspended"
  | "dispatch_access_requested"
  | "dispatch_access_started"
  | "dispatch_access_ended"
  | "relationship_approved"
  | "activation_reserved"
  | "lease_activated"
  | "lease_locked_others"
  | "lease_release_requested"
  | "lease_termination_step"
  | "lease_ended"
  | "activation_refused"
  | "driver_assigned"
  | "driver_unassigned"
  | "document_added"
  | "document_reviewed"
  | "profile_updated";

/** Append-only. Events are never edited or removed. */
export interface TruckEvent {
  id: string;
  truckId: string;
  at: string;
  kind: TruckEventKind;
  summary: string;
  detail?: string;
  /** The organization whose action it was, when there was one. */
  organizationId?: string;
  actorName?: string;
}
