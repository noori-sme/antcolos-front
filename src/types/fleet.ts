import type { AssetActivationState } from "./asset";
import type { TrailerAttachmentState, TrailerOperatingStatus, TrailerType } from "./trailer";
import type { TruckActivationState, TruckEquipmentType, TruckOperatingStatus } from "./truck";

/** One status vocabulary for power units and trailers alike. */
export type TruckStatus = TruckOperatingStatus;

/**
 * One organization's operational view of a permanent truck.
 *
 * This is a PROJECTION, not the truck. The truck itself lives in the permanent
 * registry keyed by `truckId`; this is what a particular organization sees of
 * it right now, assembled from that organization's relationship: its own unit
 * number, its own operating parameters, the driver it has assigned.
 *
 * It is derived, never stored, and never the source of truth. Two carriers
 * looking at the same truck get two different projections of one record — not
 * two trucks.
 */
export interface FleetTruck {
  /** The permanent truck this is a view of. */
  truckId: string;
  /** Same value as truckId. Kept so existing callers can key rows by `id`. */
  id: string;
  /** Whose view this is. Derived from the relationship, never trusted input. */
  organizationId: string;
  /** This organization's label for the truck. Belongs to the relationship. */
  unit: string;
  /** For dispatch organizations: the carrier that actually operates it. */
  carrierName?: string;
  equipment: TruckEquipmentType;
  status: TruckStatus;
  currentDriverId?: string;
  currentDriverName?: string;
  currentLoadId?: string;
  nextLoadId?: string;
  currentCity?: string;
  currentState?: string;
  /** When the truck is expected to go empty — the start of the MTloop. */
  estimatedEmptyAt?: string;
  minimumRatePerMileCents: number;
  maxDeadheadMiles: number;
  documentWarnings: number;
  /**
   * What THIS organization may do with the truck right now — approved, free to
   * activate, held by itself, or held by somebody else. Two carriers looking at
   * one truck can legitimately see different values here at the same moment.
   */
  activationState: TruckActivationState;
  /**
   * True when another carrier holds the operating lease. Carries no carrier name
   * and no load reference on purpose: the truck being busy is not confidential,
   * who has it and what they are hauling is.
   */
  lockedByAnotherCarrier: boolean;
  /** Set only for the carrier that holds the lease. Its own load reference. */
  myLoadReference?: string;
  /** Set only for the lease holder: the planned end. Reaching it frees nothing. */
  leaseExpectedEndAt?: string;
}

/**
 * One organization's operational view of a permanent trailer.
 *
 * Like FleetTruck, this is a PROJECTION and never the trailer. The trailer
 * lives in the permanent registry keyed by `trailerId`; this is what one
 * organization sees of it right now, assembled from that organization's own
 * relationship — its own unit number, and only the attachment, driver and load
 * information it is entitled to.
 */
export interface FleetTrailer {
  /** The permanent trailer this is a view of. */
  trailerId: string;
  /** Same value as trailerId. Kept so rows can be keyed by `id`. */
  id: string;
  /** Whose view this is. Derived from the relationship, never trusted input. */
  organizationId: string;
  /** This organization's label for the trailer. Belongs to the relationship. */
  unit: string;
  /** For dispatch organizations: the carrier whose freight it moves. */
  carrierName?: string;
  trailerType: TrailerType;
  status: TrailerOperatingStatus;
  attachmentState: TrailerAttachmentState;
  /** The power unit it is on, when this viewer is entitled to know. */
  attachedTruckId?: string;
  attachedTruckUnit?: string;
  currentCity?: string;
  currentState?: string;
  expectedAvailableAt?: string;
  documentWarnings: number;
  /**
   * What THIS organization may do with the trailer right now. Two carriers
   * looking at one trailer can legitimately see different values at once.
   */
  activationState: AssetActivationState;
  /** True when another carrier holds the operating lease. Names nobody. */
  lockedByAnotherCarrier: boolean;
  /** Set only for the lease holder. Its own load reference. */
  myLoadReference?: string;
}

export type DriverStatus = "available" | "driving" | "off_duty" | "inactive";

/**
 * The driver's operational record inside ONE organization. The person behind it
 * is a permanent User; this record never holds personal profile data.
 */
export interface Driver {
  id: string;
  organizationId: string;
  /** Present when the driver also signs in to Antcolos. */
  userId?: string;
  displayName: string;
  status: DriverStatus;
  phone?: string;
  currentTruckId?: string;
  currentLoadId?: string;
  telegramConnected: boolean;
  documentWarnings: number;
}

export interface Customer {
  id: string;
  organizationId: string;
  name: string;
  kind: "broker" | "shipper";
  contactName?: string;
  phone?: string;
  email?: string;
}
