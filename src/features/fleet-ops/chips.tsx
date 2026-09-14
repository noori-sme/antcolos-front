import type {
  FleetOperationalStatus, FleetReadinessState, FleetTelemetrySource,
} from "@/types";
import {
  OPERATIONAL_STATUS_LABEL, READINESS_STATE_LABEL, TELEMETRY_SOURCE_LABEL,
} from "./labels";
import { cn } from "@/lib/utils";

const CHIP = "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium";

const STATUS_TONE: Record<FleetOperationalStatus, string> = {
  available: "bg-st-success-bg text-st-success",
  assigned: "bg-st-info-bg text-st-info",
  expected_available: "bg-st-info-bg text-st-info",
  in_transit: "bg-st-progress-bg text-st-progress",
  maintenance: "bg-st-warning-bg text-st-warning",
  out_of_service: "bg-st-danger-bg text-st-danger",
};

export function OperationalStatusChip({
  status, className,
}: { status: FleetOperationalStatus; className?: string }) {
  return (
    <span className={cn(CHIP, STATUS_TONE[status], className)}>
      {OPERATIONAL_STATUS_LABEL[status]}
    </span>
  );
}

const READINESS_TONE: Record<FleetReadinessState, string> = {
  ready: "bg-st-success-bg text-st-success",
  expiring_soon: "bg-st-warning-bg text-st-warning",
  expired: "bg-st-danger-bg text-st-danger",
  missing: "bg-st-danger-bg text-st-danger",
  unknown: "bg-st-neutral-bg text-st-neutral",
  // Not tracked is neutral on purpose. It is not a warning — it is Antcolos
  // saying it does not hold this, which is a different thing from a problem.
  not_tracked: "bg-st-neutral-bg text-st-neutral",
};

export function ReadinessChip({
  state, className,
}: { state: FleetReadinessState; className?: string }) {
  return (
    <span className={cn(CHIP, READINESS_TONE[state], className)}>
      {READINESS_STATE_LABEL[state]}
    </span>
  );
}

/**
 * Where a reading came from, always shown next to the reading.
 *
 * Never hidden behind a tooltip: whether a location came off a device or out of
 * somebody's memory changes how much weight to put on it, and that belongs on
 * the same line as the location.
 */
export function TelemetrySourceChip({
  source, stale, className,
}: { source: FleetTelemetrySource; stale?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        CHIP,
        stale ? "bg-st-warning-bg text-st-warning" : "bg-surface-sunken text-fg-muted",
        className,
      )}
    >
      {TELEMETRY_SOURCE_LABEL[source]}
    </span>
  );
}
