import type { TruckEquipmentType, TruckOperatingStatus } from "./truck";

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
}

export interface Trailer {
  id: string;
  organizationId: string;
  unit: string;
  kind: "dry_van" | "reefer" | "flatbed";
  status: TruckStatus;
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
