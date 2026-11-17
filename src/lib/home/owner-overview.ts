import type { FleetTruck, TruckOperationalStatus } from "@/types/fleet-truck";

/** Truck statuses that follow a booked load (plan 31): the truck is working. */
export const ON_TRIP: readonly TruckOperationalStatus[] = [
  "LOAD_BOOKED", "EN_ROUTE_PICKUP", "AT_PICKUP", "LOADED_IN_TRANSIT", "AT_DELIVERY", "DELIVERED",
];

export interface TruckCounts {
  total: number;
  onTrip: number;
  available: number;
  maintenance: number;
  unavailable: number;
}

/** The owner's fleet at a glance (F1.6). Archived trucks are not counted. */
export function truckCounts(trucks: FleetTruck[]): TruckCounts {
  const active = trucks.filter((t) => !t.archivedAt);
  const count = (pred: (s: TruckOperationalStatus | undefined) => boolean) =>
    active.filter((t) => pred(t.operationalStatus)).length;
  return {
    total: active.length,
    onTrip: count((s) => s !== undefined && ON_TRIP.includes(s)),
    available: count((s) => s === "AVAILABLE"),
    maintenance: count((s) => s === "MAINTENANCE"),
    unavailable: count((s) => s === "UNAVAILABLE"),
  };
}

/** "3" or "—" while unknown; a number shown on a tile. */
export const tileValue = (n: number | undefined) => (n === undefined ? "—" : n.toLocaleString("en-US"));
