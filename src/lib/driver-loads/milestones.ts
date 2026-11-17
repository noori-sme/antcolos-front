import type { DriverLoad, NextMilestone } from "@/types/driver-load";
import type { LoadRecordStatus, LoadRecordStop } from "@/types/load-record";

/**
 * What the driver sees on the buttons and in the stop list (F1.4, plan 16).
 * Pure: the backend decides which milestones are possible (`nextMilestones`).
 */

/** "Pickup 1", "Delivery 2": numbered within their type, as on the Rate Con. */
export function stopName(stops: LoadRecordStop[], sequence: number): string {
  const stop = stops.find((s) => s.sequence === sequence);
  if (!stop) return `Stop ${sequence}`;
  const ordinal = stops.filter((s) => s.type === stop.type && s.sequence <= sequence).length;
  return `${stop.type === "pickup" ? "Pickup" : "Delivery"} ${ordinal}`;
}

const place = (stop: LoadRecordStop | undefined) =>
  stop ? `${stop.city}, ${stop.state}` : "";

/** The button label for a milestone the driver can record now. */
export function milestoneLabel(next: NextMilestone, stops: LoadRecordStop[]): string {
  const stop = next.stopSequence != null ? stops.find((s) => s.sequence === next.stopSequence) : undefined;
  const name = next.stopSequence != null ? stopName(stops, next.stopSequence) : "";
  switch (next.milestone) {
    case "start_trip":
      return "Start trip";
    case "awaiting_release":
      return "Waiting for broker release";
    case "released":
      return "Cleared to depart";
    case "arrived":
      return `Arrived at ${name.toLowerCase()} · ${place(stop)}`;
    case "loaded":
      return `Loaded at ${name.toLowerCase()}`;
    case "departed":
      return `Departed ${name.toLowerCase()}`;
    case "delivered":
      return `Delivered at ${name.toLowerCase()}`;
  }
}

/** One line to confirm before recording, so a mis-tap is caught. */
export function milestoneConfirm(next: NextMilestone, stops: LoadRecordStop[]): string {
  switch (next.milestone) {
    case "start_trip":
      return "Dispatch sees you are on the way to the first pickup.";
    case "awaiting_release":
      return "Dispatch sees the load is loaded and waiting for the broker to release it.";
    case "released":
      return "The broker released the load; you are cleared to leave.";
    default:
      return `This records the time now for ${stopName(stops, next.stopSequence ?? 0).toLowerCase()}.`;
  }
}

/** Statuses where the driver is on the road with this load. */
const ON_TRIP: readonly LoadRecordStatus[] = [
  "en_route_pickup", "arrived_pickup", "loaded", "awaiting_broker_release",
  "in_transit", "arrived_delivery",
];

export const isOnTrip = (status: LoadRecordStatus) => ON_TRIP.includes(status);

/** The load to show first: one on the road, else the earliest still to start. */
export function activeLoad(loads: DriverLoad[]): DriverLoad | null {
  return loads.find((l) => isOnTrip(l.status)) ?? loads[0] ?? null;
}

/** Mirrors the backend windows (contract §13): when a BOL / POD can be uploaded. */
const BOL_WINDOW: readonly LoadRecordStatus[] = [
  "arrived_pickup", "loaded", "awaiting_broker_release", "in_transit", "arrived_delivery",
  "delivered", "pod_received",
];
const POD_WINDOW: readonly LoadRecordStatus[] = ["delivered", "pod_received"];

export function canUpload(status: LoadRecordStatus, type: "bol" | "pod"): boolean {
  return (type === "bol" ? BOL_WINDOW : POD_WINDOW).includes(status);
}

/** The next stop the driver is heading to or at: the first without a departure. */
export function currentStop(load: DriverLoad): LoadRecordStop | null {
  return load.stops.find((s) => !s.actualDepartureAt) ?? null;
}
