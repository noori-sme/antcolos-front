import type {
  EldConnectionState, TelemetryDataQuality, TelemetryDiagnosticSeverity, TelemetryEvent,
  TelemetryIngestionState, TelemetryMeasurement,
} from "@/types";

/**
 * The words this module uses on screen, in one file.
 *
 * Two of these maps are doing real work rather than formatting. `QUALITY_TONE`
 * is why an inferred value can never be mistaken for a confirmed one at a
 * glance, and `INGESTION_TONE` is why a flagged row reads as "we kept this and
 * do not trust it" rather than as an error the user caused.
 */

export const CONNECTION_TONE: Record<EldConnectionState, string> = {
  connected: "bg-st-success-bg text-st-success",
  syncing: "bg-st-progress-bg text-st-progress",
  stale: "bg-st-warning-bg text-st-warning",
  offline: "bg-st-warning-bg text-st-warning",
  // Somebody did this on purpose. It is not a fault and must not read as one.
  disconnected: "bg-st-neutral-bg text-st-neutral",
  error: "bg-st-danger-bg text-st-danger",
  // A capability this provider does not have. Also not a fault.
  unsupported: "bg-st-neutral-bg text-st-neutral",
};

export const QUALITY_TONE: Record<TelemetryDataQuality, string> = {
  confirmed: "bg-st-success-bg text-st-success",
  provider_reported: "bg-st-info-bg text-st-info",
  // Deliberately the same weight as a warning. An inference is not a fact, and
  // the colour is the fastest way to say so.
  inferred: "bg-st-warning-bg text-st-warning",
  corrected: "bg-st-progress-bg text-st-progress",
  missing: "bg-st-neutral-bg text-st-neutral",
};

export const INGESTION_TONE: Record<TelemetryIngestionState, string> = {
  accepted: "bg-st-success-bg text-st-success",
  flagged: "bg-st-warning-bg text-st-warning",
  rejected: "bg-st-danger-bg text-st-danger",
};

export const INGESTION_LABEL: Record<TelemetryIngestionState, string> = {
  accepted: "Accepted",
  flagged: "Flagged",
  rejected: "Rejected",
};

export const INGESTION_DESCRIPTION: Record<TelemetryIngestionState, string> = {
  accepted: "Normalized, attributed and published to the modules that consume it.",
  flagged: "Kept and readable. Not trusted enough to move a snapshot or reach another module.",
  rejected: "Kept for the record, and excluded from everything derived. Nothing was deleted.",
};

export const DIAGNOSTIC_TONE: Record<TelemetryDiagnosticSeverity, string> = {
  info: "bg-st-neutral-bg text-st-neutral",
  warning: "bg-st-warning-bg text-st-warning",
  critical: "bg-st-danger-bg text-st-danger",
};

const DUTY_LABEL: Record<string, string> = {
  off_duty: "Off duty",
  sleeper: "Sleeper berth",
  driving: "Driving",
  on_duty_not_driving: "On duty, not driving",
};

export function formatHoursMinutes(seconds?: number): string {
  if (seconds == null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

export function formatAge(hours?: number): string {
  if (hours == null) return "never";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min ago`;
  if (hours < 48) return `${Math.round(hours)} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export function formatMiles(miles?: number): string {
  return miles == null ? "—" : `${Math.round(miles).toLocaleString()} mi`;
}

/**
 * A measurement in the words an operator uses.
 *
 * A position with `precise: false` renders as the city and says the
 * coordinates were withheld — never as a blank, which would read as a provider
 * that sent nothing, and never as 0, 0, which is a place in the ocean.
 */
export function formatMeasurement(value?: TelemetryMeasurement): string {
  if (!value) return "—";
  switch (value.kind) {
    case "location":
      return [value.city, value.state].filter(Boolean).join(", ")
        || value.description
        || `${value.latitude.toFixed(4)}, ${value.longitude.toFixed(4)}`;
    case "speed": return `${Math.round(value.milesPerHour)} mph`;
    case "heading": return `${Math.round(value.degrees)}°`;
    case "odometer": return formatMiles(value.miles);
    case "engine_hours": return `${Math.round(value.hours).toLocaleString()} h`;
    case "ignition": return value.on ? "On" : "Off";
    case "motion": return value.moving ? "Moving" : "Stopped";
    case "fuel_level": return `${Math.round(value.percent)}%`;
    case "diagnostic":
      return `${value.code}${value.description ? ` — ${value.description}` : ""}`;
    case "hos_summary":
      return `${DUTY_LABEL[value.dutyStatus] ?? value.dutyStatus} · `
        + `${formatHoursMinutes(value.driveSecondsRemaining)} drive left`;
  }
}

export const DUTY_STATUS_LABEL = DUTY_LABEL;

/** The one-line summary of an event, for a dense list. */
export function eventSummary(event: TelemetryEvent): string {
  return formatMeasurement(event.value);
}
