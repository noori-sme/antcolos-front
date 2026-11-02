/**
 * Trucks as the NestJS fleet API returns them. Import from "@/types/fleet-truck"
 * directly: several names here already mean something else in "@/types".
 *
 * (../antcolos/docs/requirements/fleet-api-contract.md §Truck).
 *
 * Enum values keep the backend's spelling because the fleet screens already
 * key labels and filters on it; the http adapter checks each value against
 * these lists rather than casting. Nullable identity fields become undefined.
 */

export const TRUCK_EQUIPMENT_TYPES = [
  "DRY_VAN", "REEFER", "FLATBED", "STEP_DECK", "POWER_ONLY", "TANKER", "OTHER",
] as const;
export type TruckEquipmentType = (typeof TRUCK_EQUIPMENT_TYPES)[number];

export const TRUCK_OPERATIONAL_STATUSES = ["UNAVAILABLE", "AVAILABLE", "MAINTENANCE"] as const;
export type TruckOperationalStatus = (typeof TRUCK_OPERATIONAL_STATUSES)[number];

export const TRUCK_OWNERSHIP_TYPES = ["COMPANY", "OWNER_OPERATOR", "LEASED"] as const;
export type TruckOwnershipType = (typeof TRUCK_OWNERSHIP_TYPES)[number];

export const TRUCK_OWNER_TYPES = ["USER", "ORGANIZATION"] as const;
export type TruckOwnerType = (typeof TRUCK_OWNER_TYPES)[number];

export const TRUCK_VERIFICATION_STATUSES = ["UNVERIFIED", "PENDING", "VERIFIED", "REJECTED"] as const;
export type TruckVerificationStatus = (typeof TRUCK_VERIFICATION_STATUSES)[number];

export const TRUCK_FUEL_TYPES = ["DIESEL", "GASOLINE", "CNG", "ELECTRIC", "OTHER"] as const;
export type TruckFuelType = (typeof TRUCK_FUEL_TYPES)[number];

export const TRUCK_CAB_TYPES = ["SLEEPER", "DAY_CAB", "UNKNOWN"] as const;
export type TruckCabType = (typeof TRUCK_CAB_TYPES)[number];

export const TRUCK_DISPATCHER_COVERAGES = ["PRIMARY", "TEMPORARY"] as const;
export type TruckDispatcherCoverage = (typeof TRUCK_DISPATCHER_COVERAGES)[number];

/** `currentDriver` (no coverage) or one of `currentDispatchers`. */
export interface TruckAssignment {
  assignmentId: string;
  userId: string;
  name: string;
  startAt?: string;
  coverage?: TruckDispatcherCoverage;
}

export interface TruckLegalOwner {
  ownershipId?: string;
  ownerType?: TruckOwnerType;
  ownerOrganizationId?: string | null;
  ownerUserId?: string | null;
  ownershipType?: TruckOwnershipType;
  verificationStatus?: TruckVerificationStatus;
  startAt?: string;
  endAt?: string | null;
}

/** This organization's operating row. */
export interface TruckOperating {
  operatingId?: string;
  organizationId?: string;
  unitNumber?: string;
  homeTerminalCity?: string;
  homeTerminalState?: string;
  notes?: string;
  operationalStatus?: TruckOperationalStatus;
  verificationStatus?: TruckVerificationStatus;
  startAt?: string;
  endAt?: string | null;
}

/** List items and detail share this shape. There is no organizationId on it. */
export interface FleetTruck {
  id: string;
  vin: string;
  licensePlate?: string;
  licensePlateState?: string;
  year?: number;
  make?: string;
  model?: string;
  color?: string;
  equipmentType?: TruckEquipmentType;
  trailerLengthFt?: number;
  trailerNumber?: string;
  payloadLbs?: number;
  gvwrLbs?: number;
  registrationExpiresAt?: string;
  insuranceExpiresAt?: string;
  eldProvider?: string;
  eldDeviceId?: string;
  fuelType?: TruckFuelType;
  axleCount?: number;
  cabType?: TruckCabType;
  archivedAt?: string | null;
  legalOwner?: TruckLegalOwner | null;
  operating?: TruckOperating | null;
  unitNumber?: string;
  homeTerminalCity?: string;
  homeTerminalState?: string;
  notes?: string;
  ownershipType?: TruckOwnershipType;
  operationalStatus?: TruckOperationalStatus;
  currentDriver?: TruckAssignment | null;
  currentDispatchers?: TruckAssignment[];
  createdByUserId?: string;
  updatedByUserId?: string;
  source?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** `GET /trucks` query (contract §2). */
export interface TruckListFilters {
  page?: number;
  pageSize?: number;
  sortBy?: "createdAt" | "unitNumber" | "operationalStatus";
  sortOrder?: "asc" | "desc";
  operationalStatus?: TruckOperationalStatus;
  equipmentType?: TruckEquipmentType;
  q?: string;
  assignedUserId?: string;
  includeArchived?: boolean;
}

/** The list envelope every paginated backend endpoint returns. */
export interface Paginated<T> {
  data: T[];
  meta: { page: number; pageSize: number; totalItems: number; totalPages: number };
}
