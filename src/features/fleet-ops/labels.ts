import type {
  FleetOperationalStatus, FleetReadinessKind, FleetReadinessState, FleetStatusSource,
  FleetTelemetrySource,
} from "@/types";

/** One place the operational vocabulary is spelled for people. */

export const OPERATIONAL_STATUS_LABEL: Record<FleetOperationalStatus, string> = {
  available: "Available",
  assigned: "Assigned",
  expected_available: "Expected available",
  in_transit: "In transit",
  maintenance: "Maintenance",
  out_of_service: "Out of service",
};

/** The reading order on the dashboard: usable first, unusable last. */
export const OPERATIONAL_STATUS_ORDER: readonly FleetOperationalStatus[] = [
  "available", "expected_available", "assigned", "in_transit",
  "maintenance", "out_of_service",
] as const;

export const STATUS_SOURCE_LABEL: Record<FleetStatusSource, string> = {
  truck_record: "Truck record",
  trailer_record: "Trailer record",
  operating_lease: "Operating authority lease",
  trailer_attachment: "Trailer attachment",
  availability_record: "Availability record",
};

export const READINESS_STATE_LABEL: Record<FleetReadinessState, string> = {
  ready: "In order",
  expiring_soon: "Expiring soon",
  expired: "Expired",
  missing: "Missing",
  unknown: "Not recorded",
  not_tracked: "Not tracked",
};

export const READINESS_KIND_LABEL: Record<FleetReadinessKind, string> = {
  registration: "Registration",
  plate: "Plate",
  permit: "Permit",
  ifta: "IFTA",
};

/**
 * How a reading got here, said plainly.
 *
 * The integration sources are spelled out even though none of them can occur
 * in this build: if one ever does appear on screen, it should read as what it
 * is rather than as a code.
 */
export const TELEMETRY_SOURCE_LABEL: Record<FleetTelemetrySource, string> = {
  manual_entry: "Entered by hand",
  driver_report: "Reported by the driver",
  dispatcher_entry: "Entered by dispatch",
  mock_adapter: "Seeded sample data",
  eld_integration: "ELD",
  gps_integration: "GPS tracker",
  telematics_integration: "Telematics",
};

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

export function formatDateTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function formatDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** "4 hours ago", "3 days ago". Never "just now" for something hours old. */
export function formatAge(hours?: number): string {
  if (hours == null) return "never recorded";
  if (hours < 1) return "under an hour ago";
  if (hours < 48) {
    const h = Math.round(hours);
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  }
  const d = Math.round(hours / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

export function formatMiles(miles?: number): string {
  return miles == null ? "—" : `${miles.toLocaleString()} mi`;
}

export function formatEngineHours(hours?: number): string {
  return hours == null ? "—" : `${hours.toLocaleString()} h`;
}

export function formatPlace(location?: { city?: string; state?: string; description?: string }): string {
  if (!location) return "—";
  const place = [location.city, location.state].filter(Boolean).join(", ");
  if (place && location.description) return `${place} · ${location.description}`;
  return place || location.description || "—";
}

export function formatHours(hours: number): string {
  return `${Math.round(hours).toLocaleString()} h`;
}
