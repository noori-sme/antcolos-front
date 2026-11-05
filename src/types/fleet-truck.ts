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

export const TRUCK_ASSIGNMENT_TYPES = ["DRIVER", "DISPATCHER"] as const;
export type TruckAssignmentType = (typeof TRUCK_ASSIGNMENT_TYPES)[number];

export const TRUCK_ASSIGNMENT_STATUSES = ["ASSIGNED", "REMOVED", "REPLACED"] as const;
export type TruckAssignmentStatus = (typeof TRUCK_ASSIGNMENT_STATUSES)[number];

/** `GET /trucks/lookup?vin=` (contract §1b): physical identity only. */
export interface TruckLookup {
  id: string;
  vin: string;
  year?: number;
  make?: string;
  model?: string;
  color?: string;
  equipmentType?: TruckEquipmentType;
  licensePlate?: string;
  licensePlateState?: string;
  /** This organization already has the truck on its fleet list. */
  alreadyOnFleet: boolean;
  /** Archived trucks cannot be attached. */
  archived: boolean;
  /** This organization's unit number, only when `alreadyOnFleet`. */
  unitNumber?: string;
}

/** Assignment history row (contract §Assignment row). */
export interface TruckAssignmentRow {
  id: string;
  truckId: string;
  userId: string;
  userName: string;
  type?: TruckAssignmentType;
  coverage?: TruckDispatcherCoverage;
  status?: TruckAssignmentStatus;
  startAt?: string;
  endAt: string | null;
  assignedByUserId?: string;
  endedByUserId: string | null;
  replacedByAssignmentId: string | null;
  createdAt?: string;
}

/** Ownership history row (contract §12): the owner snapshot plus row ids. */
export interface TruckOwnershipRow extends TruckLegalOwner {
  id: string;
  truckId?: string;
  createdByUserId?: string;
  endedByUserId: string | null;
}

/** Operating history row (contract §11): the operating snapshot plus row ids. */
export interface TruckOperatingRow extends TruckOperating {
  id: string;
  truckId?: string;
  createdByUserId?: string;
  endedByUserId: string | null;
}

/** `POST /trucks` body (contract §1). The owner is always this organization (plan 02). */
export interface CreateTruckInput {
  vin: string;
  unitNumber: string;
  equipmentType: TruckEquipmentType;
  licensePlate?: string;
  licensePlateState?: string;
  year?: number;
  make?: string;
  model?: string;
  color?: string;
  ownershipType?: TruckOwnershipType;
  homeTerminalCity?: string;
  homeTerminalState?: string;
  registrationExpiresAt?: string;
  insuranceExpiresAt?: string;
  notes?: string;
}

/**
 * `PATCH /trucks/:id` body (contract §4). Omitted = unchanged; `null` clears an
 * optional field. Identity fields need the legal owner, operating fields this
 * organization's operating row.
 */
export interface UpdateTruckInput {
  licensePlate?: string | null;
  licensePlateState?: string | null;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  color?: string | null;
  registrationExpiresAt?: string | null;
  insuranceExpiresAt?: string | null;
  eldProvider?: string | null;
  eldDeviceId?: string | null;
  unitNumber?: string;
  homeTerminalCity?: string | null;
  homeTerminalState?: string | null;
  notes?: string | null;
}

/** `POST /trucks/:id/assignments` body (contract §8). */
export interface AssignTruckInput {
  userId: string;
  type: TruckAssignmentType;
  /** DISPATCHER only; the server defaults to PRIMARY. */
  coverage?: TruckDispatcherCoverage;
}

/** `POST /trucks/:id/assignments/:assignmentId/replace` body (contract §9). */
export interface ReplaceAssignmentInput {
  userId: string;
  coverage?: TruckDispatcherCoverage;
}

/** `POST /trucks/:id/ownership/:ownershipId/replace` body (contract §12). */
export type ReplaceOwnershipInput =
  | { ownerType: "USER"; ownerUserId: string; ownershipType?: TruckOwnershipType }
  | { ownerType: "ORGANIZATION"; ownerOrganizationId: string; ownershipType?: TruckOwnershipType };

export type { Paginated } from "./common";
