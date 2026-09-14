import type { ActivityKind, MilestoneKind } from "@/types";

/**
 * The vocabulary of the trip, in one place — and deliberately with no icons,
 * no React and no imports from the UI. Telegram will render this vocabulary as
 * keyboard buttons and the dashboard renders it as cards; both read this file.
 *
 * Order here drives suggestions and skipped-step warnings and NOTHING else.
 * No code anywhere may read this order to decide whether an event is allowed.
 */

export type MilestonePhase = "start" | "pickup" | "transit" | "delivery" | "close";

export interface MilestoneMeta {
  kind: MilestoneKind;
  label: string;
  /** The button a driver taps, in their words. */
  actionLabel: string;
  /** One line of context under the action. */
  hint: string;
  /** Which leg of the trip it belongs to, for grouping the rail. */
  phase: MilestonePhase;
  /** Set when the milestone really means "this document now exists". */
  documentKind?: "bill_of_lading" | "proof_of_delivery";
}

export const MILESTONES: readonly MilestoneMeta[] = [
  { kind: "start_rolling", label: "Start Rolling", actionLabel: "Start rolling", hint: "You are moving toward the shipper.", phase: "start" },
  { kind: "arrived_at_shipper", label: "Arrived at Shipper", actionLabel: "I have arrived at the shipper", hint: "You are on the shipper's property.", phase: "pickup" },
  { kind: "waiting_for_loading", label: "Waiting for Loading", actionLabel: "Waiting to be loaded", hint: "Checked in, nothing is moving yet.", phase: "pickup" },
  { kind: "loading_started", label: "Loading Started", actionLabel: "Loading has started", hint: "They have started putting freight on.", phase: "pickup" },
  { kind: "loaded", label: "Loaded", actionLabel: "I am loaded", hint: "Freight is on and the doors are closed.", phase: "pickup" },
  { kind: "bol_uploaded", label: "BOL Uploaded", actionLabel: "Upload the BOL", hint: "Photograph or pick the bill of lading.", phase: "pickup", documentKind: "bill_of_lading" },
  { kind: "waiting_for_broker_approval", label: "Waiting for Broker Approval", actionLabel: "Waiting on the broker", hint: "Paperwork is in; they have not released you.", phase: "pickup" },
  { kind: "good_to_go", label: "Good to Go", actionLabel: "I am good to go", hint: "Released. Back on the road.", phase: "transit" },
  { kind: "arrived_at_receiver", label: "Arrived at Receiver", actionLabel: "I have arrived at the receiver", hint: "You are on the receiver's property.", phase: "delivery" },
  { kind: "waiting_for_unloading", label: "Waiting for Unloading", actionLabel: "Waiting to be unloaded", hint: "Checked in at delivery, still waiting.", phase: "delivery" },
  { kind: "unloading_started", label: "Unloading Started", actionLabel: "Unloading has started", hint: "They have started taking freight off.", phase: "delivery" },
  { kind: "pod_uploaded", label: "POD Uploaded", actionLabel: "Upload the POD", hint: "Photograph or pick the signed delivery receipt.", phase: "delivery", documentKind: "proof_of_delivery" },
  { kind: "delivered_and_unloaded", label: "Delivered and Unloaded", actionLabel: "Delivered and unloaded", hint: "Empty and clear of the dock.", phase: "delivery" },
  { kind: "trip_completed", label: "Trip Completed", actionLabel: "Complete this trip", hint: "Closes the workflow. The record is kept in full.", phase: "close" },
] as const;

const MILESTONE_BY_KIND = new Map<MilestoneKind, MilestoneMeta>(
  MILESTONES.map((m) => [m.kind, m]),
);

export const MILESTONE_ORDER: readonly MilestoneKind[] = MILESTONES.map((m) => m.kind);

export function milestoneMeta(kind: MilestoneKind): MilestoneMeta {
  const meta = MILESTONE_BY_KIND.get(kind);
  if (!meta) throw new Error(`Unknown milestone: ${kind}`);
  return meta;
}

export function isMilestoneKind(value: string): value is MilestoneKind {
  return MILESTONE_BY_KIND.has(value as MilestoneKind);
}

/** Position in the canonical order. Suggestions and warnings only. */
export function milestoneIndex(kind: MilestoneKind): number {
  return MILESTONE_ORDER.indexOf(kind);
}

export interface ActivityMeta {
  kind: ActivityKind;
  label: string;
  hint: string;
  /** Whether the form asks for a duration. */
  hasDuration?: boolean;
  /** Whether a receipt may be attached. */
  allowsReceipt?: boolean;
  /** Whether the form asks for an amount and gallons. */
  hasAmount?: boolean;
  /** Whether the form asks for a weight. */
  hasWeight?: boolean;
  /** Renders with the exception tone in the timeline. */
  exception?: boolean;
}

export const ACTIVITIES: readonly ActivityMeta[] = [
  { kind: "pre_trip_inspection", label: "Pre-trip inspection", hint: "Recorded as done, with anything you found." },
  { kind: "post_trip_inspection", label: "Post-trip inspection", hint: "End-of-day walkaround." },
  { kind: "rest", label: "Rest", hint: "A break. Repeatable — log every one.", hasDuration: true },
  { kind: "fuel", label: "Fuel", hint: "Fuel stop, with a receipt if you have one.", allowsReceipt: true, hasAmount: true },
  { kind: "scale", label: "Scale", hint: "Weighed. Attach the scale ticket.", allowsReceipt: true, hasWeight: true },
  { kind: "traffic_ahead", label: "Traffic ahead", hint: "Slowed down; the appointment may move." },
  { kind: "delay", label: "Delay", hint: "Something is holding you up.", hasDuration: true, exception: true },
  { kind: "detention", label: "Detention", hint: "Held at a facility beyond free time.", hasDuration: true, exception: true },
  { kind: "damage", label: "Damage", hint: "Freight or equipment damage. Photograph it.", allowsReceipt: true, exception: true },
  { kind: "breakdown", label: "Breakdown", hint: "The truck or trailer is not running.", hasDuration: true, exception: true },
  { kind: "weather", label: "Weather", hint: "Conditions worth putting on the record.", exception: true },
  { kind: "note", label: "Note", hint: "Anything else dispatch should know." },
] as const;

const ACTIVITY_BY_KIND = new Map<ActivityKind, ActivityMeta>(
  ACTIVITIES.map((a) => [a.kind, a]),
);

export function activityMeta(kind: ActivityKind): ActivityMeta {
  const meta = ACTIVITY_BY_KIND.get(kind);
  if (!meta) throw new Error(`Unknown activity: ${kind}`);
  return meta;
}

export function isActivityKind(value: string): value is ActivityKind {
  return ACTIVITY_BY_KIND.has(value as ActivityKind);
}

export const PHASE_LABEL: Record<MilestonePhase, string> = {
  start: "Getting rolling",
  pickup: "At the shipper",
  transit: "On the road",
  delivery: "At the receiver",
  close: "Closing out",
};
