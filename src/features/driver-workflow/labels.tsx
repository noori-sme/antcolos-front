"use client";

import {
  AlertTriangle, BedDouble, CircleParking, ClipboardCheck, Clock3, CloudRain,
  FileCheck2, FileText, Flag, Fuel, Hourglass, MapPin, PackageCheck,
  PackageOpen, Play, Scale, ShieldAlert, ThumbsUp, TrafficCone, Wrench,
  type LucideIcon,
} from "lucide-react";
import type { badgeVariants } from "@/components/ui/badge";
import { Badge } from "@/components/ui/badge";
import type {
  ActivityKind, ConfirmationState, CounterofferKind, MilestoneKind,
  MilestoneState, ProposalStatus, WorkflowStatus,
} from "@/types";

type Tone = NonNullable<Parameters<typeof badgeVariants>[0]>["tone"];

/**
 * Presentation for the workflow vocabulary. The vocabulary itself lives in
 * `lib/driver-workflow/catalog.ts`, which has no icons and no React, so the
 * Telegram bot can read the same labels without importing a component library.
 */

export const MILESTONE_ICON: Record<MilestoneKind, LucideIcon> = {
  start_rolling: Play,
  arrived_at_shipper: MapPin,
  waiting_for_loading: Hourglass,
  loading_started: PackageOpen,
  loaded: PackageCheck,
  bol_uploaded: FileText,
  waiting_for_broker_approval: Clock3,
  good_to_go: ThumbsUp,
  arrived_at_receiver: MapPin,
  waiting_for_unloading: Hourglass,
  unloading_started: PackageOpen,
  pod_uploaded: FileCheck2,
  delivered_and_unloaded: PackageCheck,
  trip_completed: Flag,
};

export const ACTIVITY_ICON: Record<ActivityKind, LucideIcon> = {
  rest: BedDouble,
  fuel: Fuel,
  pre_trip_inspection: ClipboardCheck,
  post_trip_inspection: ClipboardCheck,
  traffic_ahead: TrafficCone,
  scale: Scale,
  delay: Clock3,
  detention: CircleParking,
  damage: ShieldAlert,
  breakdown: Wrench,
  weather: CloudRain,
  note: AlertTriangle,
};

export const PROPOSAL_STATUS: Record<ProposalStatus, { label: string; tone: Tone }> = {
  awaiting_driver_response: { label: "Awaiting your answer", tone: "warning" },
  paused: { label: "Paused", tone: "info" },
  approved: { label: "Approved to keep negotiating", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  withdrawn: { label: "Withdrawn by dispatch", tone: "neutral" },
  expired: { label: "Expired", tone: "neutral" },
  unavailable: { label: "Unavailable", tone: "neutral" },
  finalized: { label: "Finalized", tone: "success" },
};

export function ProposalStatusBadge({ status }: { status: ProposalStatus }) {
  const meta = PROPOSAL_STATUS[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export const WORKFLOW_STATUS: Record<WorkflowStatus, { label: string; tone: Tone }> = {
  active: { label: "In progress", tone: "progress" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export function TripStatusBadge({ status }: { status: WorkflowStatus }) {
  const meta = WORKFLOW_STATUS[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export const MILESTONE_STATE: Record<MilestoneState, { label: string; tone: Tone }> = {
  not_reached: { label: "Not yet", tone: "neutral" },
  recorded: { label: "Recorded", tone: "success" },
  inferred: { label: "Inferred", tone: "warning" },
  skipped: { label: "Skipped", tone: "warning" },
};

/** How a milestone came to be believed. Never softened into "done". */
export const CONFIRMATION_LABEL: Record<ConfirmationState, string> = {
  driver_confirmed: "You recorded this",
  inferred: "A signal suggests this — not confirmed",
  confirmed_from_inference: "Suggested by a signal, confirmed by you",
  rejected_inference: "You said this did not happen",
  system: "Recorded by Antcolos",
};

export const COUNTEROFFER_LABEL: Record<CounterofferKind, string> = {
  rate: "Rate",
  accessorial: "Accessorial",
  schedule: "Schedule",
  route: "Route",
  home_time: "Home time",
  hos: "Hours of service",
  pickup: "Pickup",
  delivery: "Delivery",
  equipment: "Equipment",
  condition: "Condition",
  other: "Something else",
};

export const COUNTEROFFER_HINT: Record<CounterofferKind, string> = {
  rate: "What the load would need to pay for you to run it.",
  accessorial: "Detention, tarp, lumper or another charge.",
  schedule: "The appointment times as they stand.",
  route: "The way the trip is planned.",
  home_time: "When this puts you home.",
  hos: "How it lands against your hours.",
  pickup: "Something about the shipper or the pickup.",
  delivery: "Something about the receiver or the delivery.",
  equipment: "The truck or trailer this needs.",
  condition: "A condition you would need agreed.",
  other: "Anything else dispatch should weigh up.",
};

export const HANDOFF_STATE_LABEL: Record<string, string> = {
  pending_integration: "Waiting for the receiving module",
  delivered: "Delivered",
  rejected: "Rejected by the receiving module",
};
