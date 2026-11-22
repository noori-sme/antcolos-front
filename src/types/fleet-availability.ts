import type { TruckEquipmentType, TruckOperationalStatus } from "./fleet-truck";

/**
 * Truck availability (F2.5): ../antcolos/docs/requirements/fleet-api-contract.md
 * §Truck availability (backend plan 47, M2.10).
 */
export const AVAILABILITY_BUCKETS = [
  "AVAILABLE_NOW", "WITHIN_5H", "LATER_TODAY", "LATER", "UNKNOWN", "MAINTENANCE", "UNAVAILABLE",
] as const;
export type AvailabilityBucket = (typeof AVAILABILITY_BUCKETS)[number];

export interface TruckAvailability {
  truckId: string;
  unitNumber: string | null;
  equipmentType: TruckEquipmentType | undefined;
  operationalStatus: TruckOperationalStatus | undefined;
  bucket: AvailabilityBucket;
  /** When the truck should be empty; null when it is empty now or the time is unknown. */
  estimatedEmptyAt: string | null;
  emptyCity: string | null;
  emptyState: string | null;
  activeLoadId: string | null;
}

export interface AvailabilityQuery {
  bucket?: AvailabilityBucket;
  page: number;
  pageSize: number;
}
