import type { LoadRecordStatus } from "@/types/load-record";

/**
 * The release-1 trip in the backend's order (loads-api-contract.md §6,
 * plan 29). CANCELLED is off the path.
 */
export const LOAD_TRIP: readonly LoadRecordStatus[] = [
  "booked",
  "rc_received",
  "driver_assigned",
  "driver_accepted",
  "en_route_pickup",
  "arrived_pickup",
  "loaded",
  "awaiting_broker_release",
  "in_transit",
  "arrived_delivery",
  "delivered",
  "pod_received",
  "invoice_ready",
];

const STEP_LABEL: Partial<Record<LoadRecordStatus, string>> = {
  en_route_pickup: "Start trip to pickup",
  arrived_pickup: "Arrived at pickup",
  loaded: "Loaded",
  awaiting_broker_release: "Waiting for broker release",
  in_transit: "In transit",
  arrived_delivery: "Arrived at delivery",
  delivered: "Delivered",
};

/** The button text for moving a load to `to`. */
export function stepLabel(to: LoadRecordStatus): string {
  return STEP_LABEL[to] ?? to.replace(/_/g, " ");
}

/**
 * Splits the API's allowedTransitions into trip steps (in trip order) and
 * whether the load may be cancelled. The screen never adds a step itself.
 */
export function stepActions(allowed: readonly LoadRecordStatus[]): {
  steps: LoadRecordStatus[];
  canCancel: boolean;
} {
  return {
    steps: LOAD_TRIP.filter((status) => allowed.includes(status)),
    canCancel: allowed.includes("cancelled"),
  };
}

/** Earlier trip states, nearest first: what a status correction may move back to. */
export function correctionTargets(current: LoadRecordStatus): LoadRecordStatus[] {
  const index = LOAD_TRIP.indexOf(current);
  return index > 0 ? LOAD_TRIP.slice(0, index).reverse() : [];
}
