export type TruckStatus = "available" | "on_load" | "out_of_service" | "maintenance";

/**
 * A truck is a PERMANENT entity. Carrier, owner and driver are relationships
 * that change over time; they are never fields that get overwritten.
 */
export interface Truck {
  id: string;
  organizationId: string;
  unit: string;
  /** For dispatch agencies: the carrier authority this truck runs under. */
  carrierName?: string;
  equipment: "cargo_van" | "sprinter" | "box_truck" | "dry_van" | "reefer" | "flatbed";
  status: TruckStatus;
  currentDriverId?: string;
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
