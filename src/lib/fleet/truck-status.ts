import type { ManualTruckStatus, TruckOperationalStatus } from "@/types/fleet-truck";

/**
 * A truck's operational status on the real API (fleet contract, plan 31): three
 * manual statuses, and the trip statuses that follow the truck's load.
 */
const MANUAL: readonly ManualTruckStatus[] = ["AVAILABLE", "UNAVAILABLE", "MAINTENANCE"];

/** While booked or on the road, a truck's status moves only with its load. */
const ON_TRIP: readonly TruckOperationalStatus[] = [
  "LOAD_BOOKED", "EN_ROUTE_PICKUP", "AT_PICKUP", "LOADED_IN_TRANSIT", "AT_DELIVERY",
];

export function isOnTrip(status: TruckOperationalStatus | undefined): boolean {
  return status !== undefined && ON_TRIP.includes(status);
}

/**
 * The manual statuses a person may set from `status`: the backend allows them
 * from the manual statuses and from DELIVERED, never during a trip.
 */
export function manualStatusTargets(
  status: TruckOperationalStatus | undefined,
): ManualTruckStatus[] {
  if (isOnTrip(status)) return [];
  return MANUAL.filter((target) => target !== status);
}
