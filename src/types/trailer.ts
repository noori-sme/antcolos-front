import type {
  AssetActivationState, AssetDocumentSnapshot, CarrierRelationshipStatus,
  CarrierRelationshipType, DocumentLifecycleStatus, LeaseTermination,
  OperatingLeaseStatus, OwnerType, OwnershipClaimStatus, OwnershipRecordStatus,
  ScopedAccessStatus,
} from "./asset";

/**
 * The permanent Trailer.
 *
 * A trailer is not a truck with a different label. It has no engine, no driver
 * and no authority of its own: it is freight-carrying equipment that becomes
 * operable only when it is attached to a compatible power unit that is itself
 * running under an approved carrier. So where a truck has a driver assignment,
 * a trailer has a power-unit attachment — a different relationship, to a
 * different kind of thing, with its own rules about how many can be live at
 * once.
 *
 * What it shares with a truck is everything about identity and paperwork, and
 * those primitives are imported rather than copied:
 *
 *   trailerId  Antcolos's own permanent identity. An immutable UUID, assigned
 *              once and never reused, rewritten or regenerated — not by an
 *              ownership transfer, not by a carrier change, not by moving to
 *              another power unit.
 *   vin        The real world's identity. Used for matching and duplicate
 *              detection, so two people cannot create two records for one
 *              trailer.
 *   unit       An operational label ("V-220", "R-14"). It belongs to the
 *              carrier relationship, not to the trailer.
 */
export interface Trailer {
  /** Immutable UUID. Never a unit number, VIN, plate, row id or org code. */
  trailerId: string;
  /** Normalized, 17 characters. The real-world key. */
  vin: string;
  trailerType: TrailerType;
  year: number;
  make: string;
  model: string;
  color?: string;
  registration: TrailerRegistration;
  specs: TrailerSpecs;
  /** Equipment detail that only makes sense for this trailer's type. */
  configuration: TrailerConfiguration;
  /** Physical state of the equipment — not of any one carrier's view of it. */
  status: TrailerOperatingStatus;
  availability: TrailerAvailability;
  notes?: string;
  createdAt: string;
  /**
   * Audit provenance only: who first registered the trailer. It confers no
   * access whatsoever — visibility is derived from relationships alone.
   */
  createdByOrganizationId: string;
}

/**
 * Non-powered equipment only.
 *
 * Cargo vans, box trucks, tractors and pickups are power units and live in the
 * truck registry; none of them is ever a trailer type. New types can be added
 * here without touching identity, ownership or relationships, because none of
 * those depend on the type.
 */
export type TrailerType =
  | "dry_van"
  | "reefer"
  | "flatbed"
  | "step_deck"
  | "gooseneck"
  | "car_hauler"
  | "other";

/**
 * Operational state of the equipment.
 *
 * Deliberately separate from ownership status, carrier onboarding status,
 * operating-authority state, document readiness and attachment state. A trailer
 * can be in maintenance while still owned, still onboarded with three carriers
 * and still attached to a power unit; those are five different facts.
 */
export type TrailerOperatingStatus =
  | "available"
  | "attached"
  | "loaded"
  | "expected_available"
  | "maintenance"
  | "out_of_service";

export interface TrailerRegistration {
  plateNumber: string;
  plateState: string;
  expiresAt?: string;
  /** As printed on the registration. Not proof of title, and not the owner. */
  registeredOwnerName?: string;
}

export interface TrailerAvailability {
  city?: string;
  state?: string;
  /** Where it is expected to be free, when that differs from where it is. */
  expectedCity?: string;
  expectedState?: string;
  expectedAvailableAt?: string;
  /** Why it cannot be used, in the words of whoever set the status. */
  unavailableReason?: string;
  notes?: string;
}

/* -------------------------------------------------------------------------- */
/* Specifications                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Measured facts about the equipment. Every dimension is in inches and every
 * weight in pounds, so nothing has to be guessed at from a bare number.
 *
 * Anything absent is absent. A missing value is never filled in with a typical
 * figure for the type, because a dispatcher booking a load would read that as
 * measured.
 */
export interface TrailerSpecs {
  overallLengthIn?: number;
  overallWidthIn?: number;
  overallHeightIn?: number;
  /** Interior dimensions only apply to enclosed equipment. */
  interiorLengthIn?: number;
  interiorWidthIn?: number;
  interiorHeightIn?: number;
  rearDoorWidthIn?: number;
  rearDoorHeightIn?: number;
  sideDoorWidthIn?: number;
  sideDoorHeightIn?: number;
  gvwrLbs?: number;
  emptyWeightLbs?: number;
  maxPayloadLbs?: number;
  axleCount?: number;
  suspension?: TrailerSuspension;
  tireSize?: string;
}

export type TrailerSuspension = "air_ride" | "spring" | "torsion" | "walking_beam";

/**
 * Type-specific equipment.
 *
 * One optional field per thing that can genuinely differ, grouped by the type
 * it belongs to. A dry van never shows a reefer's temperature range, and a
 * flatbed never shows a pallet count — `configFieldsFor` decides what appears.
 */
export interface TrailerConfiguration {
  /* Dry van */
  rearDoorStyle?: "swing" | "roll_up";
  hasSideDoor?: boolean;
  hasETrack?: boolean;
  hasLogisticPosts?: boolean;
  hasAirRide?: boolean;
  hasLiftgate?: boolean;
  palletCapacity?: number;

  /* Reefer */
  reeferUnitMake?: string;
  reeferUnitModel?: string;
  reeferFuelType?: "diesel" | "electric" | "hybrid";
  minTemperatureF?: number;
  maxTemperatureF?: number;
  multiTemperature?: boolean;
  /** Last recorded state of the unit. Nothing here is monitored live. */
  reeferUnitStatus?: ReeferUnitStatus;
  reeferLastServicedAt?: string;
  airflow?: "air_chute" | "floor_channels" | "none";

  /* Flatbed */
  deckLengthIn?: number;
  deckWidthIn?: number;
  hasTarps?: boolean;
  strapCount?: number;
  chainCount?: number;
  binderCount?: number;
  hasCoilRacks?: boolean;
  hasDunnage?: boolean;
  hasHeadacheRack?: boolean;

  /* Step deck */
  upperDeckLengthIn?: number;
  lowerDeckLengthIn?: number;
  upperDeckHeightIn?: number;
  lowerDeckHeightIn?: number;
  hasRamps?: boolean;
  hasLoadLevelers?: boolean;
  securementNotes?: string;

  /* Gooseneck */
  hitchType?: TrailerHitchType;
  couplerRatingLbs?: number;
  rampType?: "slide_in" | "fold_down" | "beavertail" | "none";
  hasWinch?: boolean;

  /* Car hauler */
  vehicleCapacity?: number;
  deckConfiguration?: "single" | "double" | "stinger";
  maxVehicleLengthIn?: number;
  maxVehicleHeightIn?: number;
  enclosed?: boolean;
}

/** Last recorded state of a reefer unit. Recorded by a person, not measured. */
export type ReeferUnitStatus = "operational" | "needs_service" | "down";

/**
 * How the trailer couples to a power unit.
 *
 * This is the single most important compatibility fact: a fifth-wheel trailer
 * cannot be pulled by a pickup with a bumper hitch however willing everybody
 * is, and no amount of paperwork changes that.
 */
export type TrailerHitchType = "fifth_wheel" | "gooseneck_ball" | "pintle" | "bumper_pull";

/* -------------------------------------------------------------------------- */
/* Legal ownership                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Who legally owns the trailer, and when.
 *
 * Ownership hangs off the permanent trailerId and is never part of it. A
 * transfer ends one record and opens another; it never touches the trailer, its
 * VIN, its specifications, its documents, its carrier relationships, its
 * attachment history or any other history.
 */
export interface TrailerOwnershipRecord {
  id: string;
  trailerId: string;
  ownerType: OwnerType;
  ownerName: string;
  /** Organization or driver-profile id when the owner exists in Antcolos. */
  ownerRef?: string;
  startedAt: string;
  endedAt?: string;
  status: OwnershipRecordStatus;
  /** Filenames only. Nothing is uploaded, stored, read or verified. */
  evidence: TrailerDocumentSnapshot[];
  createdByMembershipId: string;
  createdByName: string;
  createdAt: string;
}

/** Someone asserting they own a trailer that already exists in Antcolos. */
export interface TrailerOwnershipClaim {
  id: string;
  trailerId: string;
  claimantOrganizationId: string;
  claimantName: string;
  claimedOwnerType: OwnerType;
  claimedOwnerName: string;
  status: OwnershipClaimStatus;
  evidence: TrailerDocumentSnapshot[];
  note?: string;
  createdAt: string;
  resolvedAt?: string;
  resolutionNote?: string;
}

/* -------------------------------------------------------------------------- */
/* Carrier relationships                                                       */
/* -------------------------------------------------------------------------- */

/**
 * One carrier's onboarding of one trailer.
 *
 * Several of these can be approved on the same trailer at the same time, each
 * with its own unit number, insurance evidence, lease agreement and history.
 * None of them means the carrier is running it — that is the lease.
 */
export interface TrailerCarrierRelationship {
  id: string;
  trailerId: string;
  organizationId: string;
  organizationName: string;
  relationshipType: CarrierRelationshipType;
  unitNumber: string;
  status: CarrierRelationshipStatus;
  /** Per-carrier onboarding evidence. Never shared with another carrier. */
  insuranceEvidence?: TrailerDocumentSnapshot[];
  leaseAgreement?: TrailerDocumentSnapshot;
  approvedAt?: string;
  startedAt: string;
  endedAt?: string;
  endReason?: string;
  initiatedByOrganizationId: string;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* Operating authority                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Exclusive operating authority over a trailer, for a period of time.
 *
 * Exactly one may be reserved, active or pending release at any moment. When
 * the lease was taken as half of a truck-and-trailer movement, `combinationId`
 * ties the two leases together so they can only ever be activated and released
 * as one thing — an attached truck and trailer cannot run under two different
 * authorities for the same movement.
 */
export interface TrailerOperatingLease {
  id: string;
  trailerId: string;
  organizationId: string;
  organizationName: string;
  relationshipId: string;
  status: OperatingLeaseStatus;
  /**
   * The carrier's own reference for the work. Confidential: never shown to
   * another carrier, who sees only that the trailer is unavailable.
   */
  loadReference?: string;
  /** Set when this lease is one half of a truck-and-trailer activation. */
  combinationId?: string;
  /** The power unit the movement was activated with, when there was one. */
  truckId?: string;
  reservedAt?: string;
  activatedAt?: string;
  /** Planned end. Reaching it does NOT release the trailer. */
  expectedEndAt?: string;
  releaseRequestedAt?: string;
  endedAt?: string;
  termination: LeaseTermination;
  createdAt: string;
  initiatedByMembershipId: string;
  initiatedByName: string;
}

export type TrailerActivationState = AssetActivationState;

/* -------------------------------------------------------------------------- */
/* Power-unit attachment                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Where a trailer physically is in its relationship with a power unit.
 *
 * `reserved` exists because attaching is not instantaneous in the real world:
 * somebody commits a trailer to a truck before the two are in the same yard,
 * and nobody else may take it in the meantime. `blocked` is the honest answer
 * when the pairing cannot proceed — an incompatible hitch, a carrier that is
 * not approved, an asset out of service.
 */
export type AttachmentStatus =
  | "reserved"
  | "attached"
  | "in_movement"
  | "pending_detachment"
  | "detached"
  | "blocked";

/**
 * A dated link between one permanent trailerId and one permanent truckId.
 *
 * Stored as its own record referencing both by UUID, never as a trailer nested
 * inside a truck: the two assets have separate lives, separate owners and
 * separate histories, and either can be sold without disturbing the other.
 */
export interface TrailerAttachment {
  id: string;
  trailerId: string;
  truckId: string;
  /** Snapshot for history, so an ended attachment still reads sensibly. */
  truckUnitLabel: string;
  /** The carrier whose operation this pairing belongs to. */
  organizationId: string;
  organizationName: string;
  status: AttachmentStatus;
  reservedAt?: string;
  attachedAt?: string;
  detachRequestedAt?: string;
  detachedAt?: string;
  detachReason?: string;
  blockedReason?: string;
  createdByMembershipId: string;
  createdByName: string;
  createdAt: string;
}

/**
 * What one organization may do about attaching one trailer right now.
 *
 * `out_of_service` and `maintenance` are separate from `unattached` because the
 * answer to "why can't I hook this up?" is different, and a screen that says
 * only "unavailable" is no use to the person standing in the yard.
 */
export type TrailerAttachmentState =
  | "unattached"
  | "reserved_for_attachment"
  | "attached"
  | "in_active_movement"
  | "pending_detachment"
  | "blocked"
  | "out_of_service";

/* -------------------------------------------------------------------------- */
/* Compatibility                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Why a trailer and a power unit can or cannot be put together.
 *
 * `missing_required_data` is a first-class answer, not an error: Antcolos
 * frequently does not know a pickup's tow rating, and saying "compatible"
 * without it would be a claim nobody checked.
 */
export type CompatibilityVerdict =
  | "compatible"
  | "incompatible"
  | "missing_required_data"
  | "already_attached"
  | "reserved"
  | "locked_by_other_carrier"
  | "carrier_not_approved"
  | "power_unit_unavailable"
  | "trailer_unavailable"
  | "unauthorized";

export interface CompatibilityResult {
  verdict: CompatibilityVerdict;
  /** Plain-language reasons, in the order a person would want to read them. */
  reasons: string[];
  /** What Antcolos does not know, when that is what is stopping it. */
  missing: string[];
  /**
   * True only when every mechanical fact needed was actually present. A
   * `compatible` verdict with this false means "nothing rules it out", which is
   * not the same as "checked".
   */
  fullyChecked: boolean;
}

/* -------------------------------------------------------------------------- */
/* Dispatch organization access                                                */
/* -------------------------------------------------------------------------- */

/**
 * A dispatch organization's scoped access to one trailer.
 *
 * The third kind of relationship, and neither of the other two: a dispatcher
 * does not own the trailer and does not run it under its own authority. Its
 * access is granted by an authorized carrier, scoped to that carrier's trailers,
 * and ends without touching ownership, carrier relationships, attachments, the
 * profile or any history.
 */
export interface TrailerDispatchAccess {
  id: string;
  trailerId: string;
  dispatchOrganizationId: string;
  dispatchOrganizationName: string;
  grantedByCarrierOrganizationId: string;
  grantedByCarrierName: string;
  unitLabel?: string;
  status: ScopedAccessStatus;
  startedAt: string;
  endedAt?: string;
  endReason?: string;
  initiatedByOrganizationId: string;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

export type TrailerDocumentStatus = DocumentLifecycleStatus;

export type TrailerDocumentKind =
  | "registration"
  | "title"
  | "insurance"
  | "annual_inspection"
  | "lease_agreement"
  | "reefer_service_record"
  | "tarp_securement_inventory"
  | "other";

export interface TrailerDocumentRequirement {
  kind: TrailerDocumentKind;
  label: string;
  description: string;
  required: boolean;
  expires: boolean;
  /** Limits the requirement to particular trailer types when set. */
  trailerTypes?: TrailerType[];
}

export interface TrailerDocument {
  id: string;
  trailerId: string;
  kind: TrailerDocumentKind;
  status: TrailerDocumentStatus;
  fileName?: string;
  fileType?: string;
  sizeBytes?: number;
  expiresAt?: string;
  rejectionReason?: string;
  /**
   * Set when the document was added for one carrier's onboarding rather than
   * for the trailer itself. Only that carrier sees it.
   */
  carrierOrganizationId?: string;
  /** Set when a newer document replaced this one. The old record survives. */
  supersededByDocumentId?: string;
  addedByOrganizationId: string;
  createdAt: string;
  updatedAt: string;
}

export type TrailerDocumentSnapshot = AssetDocumentSnapshot<TrailerDocumentKind>;

/* -------------------------------------------------------------------------- */
/* Operational history                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The foundation for load history on a trailer.
 *
 * Deliberately thin: this milestone records that a movement happened, under
 * which carrier and with which power unit, so that later load work has
 * somewhere to attach without changing the trailer's identity model.
 */
export interface TrailerMovementRecord {
  id: string;
  trailerId: string;
  truckId?: string;
  organizationId: string;
  organizationName: string;
  /** The carrier's own reference. Never shown to another carrier. */
  loadReference?: string;
  startedAt: string;
  endedAt?: string;
  originCity?: string;
  originState?: string;
  destinationCity?: string;
  destinationState?: string;
}

/* -------------------------------------------------------------------------- */
/* Timeline                                                                    */
/* -------------------------------------------------------------------------- */

export type TrailerEventKind =
  | "created"
  | "status_changed"
  | "availability_changed"
  | "profile_updated"
  | "ownership_started"
  | "ownership_ended"
  | "ownership_claim_opened"
  | "ownership_claim_resolved"
  | "relationship_requested"
  | "relationship_approved"
  | "relationship_started"
  | "relationship_ended"
  | "relationship_suspended"
  | "dispatch_access_started"
  | "dispatch_access_ended"
  | "activation_reserved"
  | "lease_activated"
  | "lease_locked_others"
  | "lease_release_requested"
  | "lease_termination_step"
  | "lease_ended"
  | "activation_refused"
  | "combination_activated"
  | "combination_refused"
  | "attachment_reserved"
  | "attachment_reservation_cancelled"
  | "attached"
  | "detach_requested"
  | "detached"
  | "attachment_blocked"
  | "document_added"
  | "document_reviewed";

/** Append-only. Events are never edited or removed. */
export interface TrailerEvent {
  id: string;
  trailerId: string;
  at: string;
  kind: TrailerEventKind;
  summary: string;
  detail?: string;
  /** The organization whose action it was, when there was one. */
  organizationId?: string;
  actorName?: string;
}
