import type {
  EldConnectionState, EquipmentTelemetrySnapshot, SnapshotField, SnapshotLocationValue,
  TelemetryDataQuality, TelemetryDiagnosticValue, TelemetryEvent, TelemetryHosSummaryValue,
  TelemetryLocationValue, TelemetryMeasurement, TelemetrySignalKind,
} from "@/types";

/**
 * ★ THE SNAPSHOT IS DERIVED, AND THE HISTORY IS UNTOUCHED ★
 *
 * "What does this truck look like right now" is a question with an obvious wrong
 * answer: keep a row per truck and write the newest value over it. That row is
 * then the only copy, a bad normalization is permanent, a late-arriving signal
 * silently rewrites yesterday, and nobody can ever reconstruct what was known at
 * the moment a decision was made.
 *
 * So there is no such row. A snapshot is computed on read from the accepted
 * events, every field carries the event it came from, and recomputing it after
 * a normalization fix costs nothing and loses nothing. The events are never
 * written to by this file — it takes them as a readonly array and returns a
 * value.
 *
 * Three rules the fields keep:
 *
 *  1. Missing is a value. A truck nobody has heard from has a `location` with
 *     quality "missing" — not a blank, not a zero, not last week's position
 *     shown as if it were current.
 *  2. Every field says how old it is and whether that is too old. Freshness is
 *     judged per field, because an odometer from this morning is fine and a
 *     position from this morning is not.
 *  3. Only accepted events count. Flagged and rejected rows are readable on the
 *     device screen and are deliberately absent here: a snapshot built from
 *     signals the pipeline distrusted would launder them into fact.
 */

const HOUR_MS = 3_600_000;

/** A field nobody has reported. The honest default, and never a zero. */
function missing<V>(): SnapshotField<V> {
  return { quality: "missing", stale: false };
}

/**
 * Later wins, and "later" means when the fact was TRUE, not when it arrived.
 *
 * The sequence tie-break matters for a file import, where a dozen rows share a
 * timestamp to the second: without it the "newest" value would depend on array
 * order, which is a bug that only shows up in production.
 */
function newerThan(a: TelemetryEvent, b: TelemetryEvent | undefined): boolean {
  if (!b) return true;
  if (a.sourceAt !== b.sourceAt) return a.sourceAt > b.sourceAt;
  return a.sequence > b.sequence;
}

export interface SnapshotInput {
  organizationId: string;
  truckId: string;
  truckUnit: string;
  /**
   * Accepted, flagged and rejected events for this truck. Filtering is done
   * here rather than by the caller so that no caller can accidentally build a
   * snapshot out of rows the pipeline refused.
   */
  events: readonly TelemetryEvent[];
  deviceId?: string;
  deviceSerial?: string;
  connectionState: EldConnectionState;
  /** Per-field staleness is judged against this, in minutes. */
  freshnessExpectationMinutes: number;
  driverProfileId?: string;
  driverName?: string;
  providerNameOf: (providerId: string) => string;
  /**
   * Whether the caller may see the driver's clock. False strips the HOS field
   * entirely rather than returning it empty — an absent field and a field the
   * viewer is not allowed cannot be told apart by a screen, and should not be.
   */
  includeHos: boolean;
  /** Whether the caller may see fault codes. */
  includeDiagnostics: boolean;
  /**
   * Whether the caller may see exact coordinates. When false the position is
   * kept but reduced to the city and state the provider geocoded, because
   * "somewhere near Joliet" is operationally useful and a person's precise
   * whereabouts is not everyone's business.
   */
  includePreciseLocation: boolean;
  nowMs: number;
}

export function buildSnapshot(input: SnapshotInput): EquipmentTelemetrySnapshot {
  const accepted = input.events.filter((e) => e.ingestion === "accepted");

  // A correction supersedes exactly one earlier event, and the superseded row
  // stays on file — it is only kept out of the snapshot.
  const superseded = new Set(
    accepted.map((e) => e.supersedesEventId).filter((id): id is string => Boolean(id)),
  );
  const live = accepted.filter((e) => !superseded.has(e.id));

  const newest = new Map<TelemetrySignalKind, TelemetryEvent>();
  for (const event of live) {
    if (newerThan(event, newest.get(event.kind))) newest.set(event.kind, event);
  }

  const field = <V extends TelemetryMeasurement>(kind: TelemetrySignalKind): SnapshotField<V> => {
    const event = newest.get(kind);
    if (!event) return missing<V>();
    const ageHours = (input.nowMs - Date.parse(event.sourceAt)) / HOUR_MS;
    return {
      value: event.value as V,
      quality: event.quality,
      sourceAt: event.sourceAt,
      receivedAt: event.receivedAt,
      providerId: event.providerId,
      providerName: input.providerNameOf(event.providerId),
      confidence: event.confidence,
      accuracyMeters: event.accuracyMeters,
      eventId: event.id,
      ageHours,
      stale: ageHours * 60 > input.freshnessExpectationMinutes,
    };
  };

  // Position is the one field whose SHAPE depends on the viewer.
  //
  // Reduced, never rounded: a rounded coordinate still tracks somebody, it just
  // tracks them less well and looks exact while doing it. The city the provider
  // geocoded is a different fact, it is the one an operator actually needs, and
  // `precise: false` says plainly that the rest was withheld.
  const rawLocation = newest.get("location");
  const locationField = field<TelemetryLocationValue>("location");
  const location: SnapshotField<SnapshotLocationValue> = {
    ...locationField,
    value: undefined,
  };
  if (rawLocation && rawLocation.value.kind === "location") {
    const v = rawLocation.value;
    location.value = input.includePreciseLocation
      ? { ...v, precise: true }
      : {
        kind: "location",
        city: v.city,
        state: v.state,
        description: v.description,
        precise: false,
      };
    if (!input.includePreciseLocation) location.accuracyMeters = undefined;
  }

  // The newest report for each code wins, so a fault that cleared does not sit
  // on the screen forever behind a stale "active" flag.
  const byCode = new Map<string, TelemetryEvent & { value: TelemetryDiagnosticValue }>();
  if (input.includeDiagnostics) {
    for (const event of live) {
      if (event.value.kind !== "diagnostic") continue;
      const typed = event as TelemetryEvent & { value: TelemetryDiagnosticValue };
      const existing = byCode.get(typed.value.code);
      if (!existing || newerThan(typed, existing)) byCode.set(typed.value.code, typed);
    }
  }

  const activeDiagnostics = [...byCode.values()]
    .filter((e) => e.value.active)
    .sort((a, b) => b.sourceAt.localeCompare(a.sourceAt))
    .map((e) => ({ ...e.value, sourceAt: e.sourceAt, eventId: e.id, quality: e.quality }));

  const snapshot: EquipmentTelemetrySnapshot = {
    organizationId: input.organizationId,
    truckId: input.truckId,
    truckUnit: input.truckUnit,
    deviceId: input.deviceId,
    deviceSerial: input.deviceSerial,
    connectionState: input.connectionState,
    location,
    speed: field("speed"),
    heading: field("heading"),
    odometer: field("odometer"),
    engineHours: field("engine_hours"),
    ignition: field("ignition"),
    motion: field("motion"),
    fuelLevel: field("fuel_level"),
    diagnostics: activeDiagnostics,
    driverProfileId: input.driverProfileId,
    driverName: input.driverName,
    generatedAt: new Date(input.nowMs).toISOString(),
    eventsConsidered: live.length,
  };

  if (input.includeHos) {
    snapshot.hos = {
      ...field<TelemetryHosSummaryValue>("hos_summary"),
      driverProfileId: input.driverProfileId,
    };
  }

  return snapshot;
}

/**
 * Whether a snapshot is stale enough to be worth telling somebody about.
 *
 * Position only. An odometer that has not moved since Tuesday on a truck that
 * has been in the shop since Tuesday is correct, and raising it would be noise.
 */
export function snapshotIsStale(snapshot: EquipmentTelemetrySnapshot): boolean {
  return snapshot.location.quality !== "missing" && snapshot.location.stale;
}

/** The quality of the whole snapshot: the weakest thing it is built on. */
export function snapshotQuality(snapshot: EquipmentTelemetrySnapshot): TelemetryDataQuality {
  const fields = [snapshot.location, snapshot.odometer, snapshot.engineHours];
  if (fields.every((f) => f.quality === "missing")) return "missing";
  if (fields.some((f) => f.quality === "inferred")) return "inferred";
  if (fields.some((f) => f.quality === "corrected")) return "corrected";
  return "provider_reported";
}
