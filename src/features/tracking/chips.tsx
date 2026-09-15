import {
  BadgeCheck, CircleHelp, Radio, Sparkles, WifiOff, ZapOff,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  AVAILABILITY_STATE_LABEL, TRACKING_HEALTH_LABEL, TRACKING_LINK_STATE_LABEL,
  TRACKING_UPDATE_STATE_LABEL, type AvailabilityBasis, type AvailabilityState,
  type TrackingLinkState, type TrackingSignalHealth, type TrackingUpdateState,
} from "@/types";
import { cn } from "@/lib/utils";

/**
 * The chips.
 *
 * Every one of them is a projection of a service decision, and none of them
 * computes anything. The important one is `BasisChip`: it appears next to
 * anything the system worked out for itself, and it is what stops a page full
 * of inferences reading like a page full of facts.
 */

const HEALTH_TONE: Record<TrackingSignalHealth, "success" | "warning" | "danger" | "neutral"> = {
  live: "success",
  stale: "warning",
  offline: "danger",
  interrupted: "danger",
  unavailable: "neutral",
};

const HEALTH_ICON = {
  live: Radio,
  stale: Radio,
  offline: WifiOff,
  interrupted: ZapOff,
  unavailable: CircleHelp,
} as const;

export function HealthChip({ health, className }: { health: TrackingSignalHealth; className?: string }) {
  const Icon = HEALTH_ICON[health];
  return (
    <Badge tone={HEALTH_TONE[health]} className={className}>
      <Icon className="size-3.5" aria-hidden />
      {TRACKING_HEALTH_LABEL[health]}
    </Badge>
  );
}

const AVAILABILITY_TONE: Record<AvailabilityState, "success" | "info" | "progress" | "warning" | "neutral"> = {
  empty_confirmed: "success",
  likely_available: "progress",
  expected_available: "info",
  availability_uncertain: "warning",
  unavailable: "neutral",
};

export function AvailabilityChip({
  state, className,
}: { state: AvailabilityState; className?: string }) {
  return (
    <Badge tone={AVAILABILITY_TONE[state]} className={className}>
      {AVAILABILITY_STATE_LABEL[state]}
    </Badge>
  );
}

/**
 * Confirmed, or inferred.
 *
 * Deliberately not a subtle visual difference. "A person recorded this" and
 * "a machine thinks this" are the two halves of the whole module, and a
 * dispatcher deciding whether to book against a truck needs to know which one
 * they are looking at without hovering over anything.
 */
export function BasisChip({
  basis, confidence, className,
}: { basis: AvailabilityBasis; confidence?: number; className?: string }) {
  if (basis === "confirmed") {
    return (
      <Badge tone="success" className={className}>
        <BadgeCheck className="size-3.5" aria-hidden />
        Confirmed by a person
      </Badge>
    );
  }
  return (
    <Badge tone="warning" className={className}>
      <Sparkles className="size-3.5" aria-hidden />
      Inferred
      {confidence != null ? (
        <span className="tnum opacity-80">{Math.round(confidence * 100)}%</span>
      ) : null}
    </Badge>
  );
}

const LINK_TONE: Record<TrackingLinkState, "success" | "warning" | "danger" | "neutral"> = {
  active: "success",
  expired: "warning",
  revoked: "danger",
  completed: "neutral",
  cancelled: "neutral",
  relationship_ended: "danger",
};

export function LinkStateChip({ state }: { state: TrackingLinkState }) {
  return <Badge tone={LINK_TONE[state]}>{TRACKING_LINK_STATE_LABEL[state]}</Badge>;
}

const UPDATE_TONE: Record<TrackingUpdateState, "info" | "success" | "progress" | "neutral"> = {
  draft: "info",
  approved: "success",
  queued: "progress",
  discarded: "neutral",
};

export function UpdateStateChip({ state }: { state: TrackingUpdateState }) {
  return <Badge tone={UPDATE_TONE[state]}>{TRACKING_UPDATE_STATE_LABEL[state]}</Badge>;
}

/**
 * The standing statement about where the data comes from.
 *
 * On every tracking surface, not tucked into an About page. A dispatcher
 * looking at a moving dot deserves to be told, on that screen, that nothing
 * behind it is a device.
 */
export function MockSourceNotice({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "rounded-md border border-st-warning/40 bg-st-warning-bg/50 px-3.5 py-2.5 text-[0.75rem] leading-relaxed text-fg-muted",
        className,
      )}
    >
      <span className="font-medium text-fg">Mock data.</span>{" "}
      No ELD, GPS tracker, telematics provider, phone, Telegram bot, email or SMS gateway is
      connected to this build. Every position here was produced by a labelled mock adapter, and
      every conclusion drawn from one is marked inferred until a person confirms it.
    </p>
  );
}
