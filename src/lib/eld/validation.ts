import type {
  TelemetryAnomaly, TelemetryIngestionState, TelemetryMeasurement, TelemetrySignalKind,
} from "@/types";
import type { NormalizedCandidate } from "./adapters";

/**
 * ★ INGESTION IS IDEMPOTENT, AND NOTHING IS EVER SILENTLY DROPPED ★
 *
 * Five things go wrong with real telemetry, constantly, and a pipeline that
 * pretends otherwise produces a system whose numbers nobody trusts:
 *
 *   the same event arrives twice        a retry, a replayed webhook, a file
 *                                       somebody uploaded for the second time
 *   the timestamp is unusable           empty, unparseable, or in the future
 *   signals arrive out of order         a device that was offline flushes its
 *                                       buffer, newest first
 *   the position is impossible          a truck in Chicago and then, ninety
 *                                       seconds later, in Denver
 *   a meter goes backwards              a device swap, a reset, a bad row
 *
 * Every one of them is DETECTED and RECORDED here. None of them causes a delete.
 * A duplicate is kept as a rejected row so the second delivery is explicable; a
 * jump is kept as a flagged row so somebody can look at it; an out-of-order
 * signal is kept, flagged, and left out of the derived snapshot rather than
 * quietly rewriting history that later signals already depend on.
 *
 * "Rejected" and "flagged" are different on purpose:
 *   rejected  the row is not evidence of anything. Excluded from every
 *             derivation, still readable, still linked to its raw payload.
 *   flagged   the row is probably real but is not trusted enough to publish to
 *             another module or to move a snapshot.
 */

/** How far ahead of Antcolos's clock a source timestamp may be before it is refused. */
export const MAX_CLOCK_SKEW_MINUTES = 5;

/**
 * The fastest a truck is allowed to have travelled between two positions.
 *
 * Generous on purpose — 120 mph is well above any legal road speed, so a flag
 * means something genuinely impossible happened (a device swap, a provider
 * mixing up two units, a bad geocode) rather than somebody speeding.
 */
export const MAX_PLAUSIBLE_MPH = 120;

/** Below this gap, two positions are too close in time to judge speed from. */
export const MIN_JUMP_SECONDS = 20;

/** Odometers wobble. Anything beyond this going backwards is a real disagreement. */
export const ODOMETER_TOLERANCE_MILES = 1;

/** Engine-hour meters wobble less, but a device swap shows up here first. */
export const ENGINE_HOURS_TOLERANCE = 0.5;

/**
 * How far two independent odometer sources may disagree before it is an
 * exception somebody has to reconcile. A day of running is ~600 miles, so 50 is
 * comfortably past "one of them is stale" and into "these are different trucks".
 */
export const ODOMETER_CONFLICT_MILES = 50;

/* -------------------------------------------------------------------------- */
/* The idempotency key                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The key that makes ingestion exactly-once.
 *
 * When the provider stamps its own event id, that id IS the identity and the
 * key is built from it — two deliveries carrying the same provider event are
 * the same event however they arrived.
 *
 * When the provider stamps nothing (Gamma's nightly export does not), identity
 * has to be derived, and the derivation must include the signal KIND: one
 * export row produces a position, an odometer and an hours reading that share a
 * device and a timestamp, and a key without the kind would collapse all three
 * into one and throw two of them away as duplicates.
 */
export function dedupeKeyFor(input: {
  providerId: string;
  deviceExternalId: string;
  kind: TelemetrySignalKind;
  sourceAt: string;
  externalEventId?: string;
}): string {
  const { providerId, deviceExternalId, kind, sourceAt, externalEventId } = input;
  return externalEventId
    ? `${providerId}:${deviceExternalId}:${kind}:ext:${externalEventId}`
    : `${providerId}:${deviceExternalId}:${kind}:at:${sourceAt}`;
}

/* -------------------------------------------------------------------------- */
/* Timestamps                                                                  */
/* -------------------------------------------------------------------------- */

export interface TimestampVerdict {
  /** The normalized ISO string, when the input was usable. */
  iso?: string;
  anomaly?: Extract<TelemetryAnomaly, "invalid_timestamp" | "future_timestamp">;
  note?: string;
}

/**
 * A source timestamp is either usable or it is not, and "not" is never repaired
 * by substituting the time of receipt.
 *
 * Doing that would be the single most damaging shortcut available here: an
 * event stamped with its arrival time looks perfectly ordered, sorts correctly,
 * and is wrong about when the truck was where it says it was — which is the one
 * fact the whole module exists to record.
 */
export function checkTimestamp(sourceAt: string, nowMs: number): TimestampVerdict {
  const trimmed = sourceAt?.trim?.() ?? "";
  if (!trimmed) {
    return { anomaly: "invalid_timestamp", note: "The provider sent no source timestamp." };
  }
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    return {
      anomaly: "invalid_timestamp",
      note: `"${trimmed}" is not a timestamp Antcolos can read.`,
    };
  }
  if (parsed > nowMs + MAX_CLOCK_SKEW_MINUTES * 60_000) {
    return {
      iso: new Date(parsed).toISOString(),
      anomaly: "future_timestamp",
      note:
        `The provider says this happened at ${new Date(parsed).toISOString()}, which is `
        + `more than ${MAX_CLOCK_SKEW_MINUTES} minutes ahead of now.`,
    };
  }
  return { iso: new Date(parsed).toISOString() };
}

/* -------------------------------------------------------------------------- */
/* Geography                                                                   */
/* -------------------------------------------------------------------------- */

const EARTH_RADIUS_MILES = 3958.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in miles. Straight-line, which understates road miles. */
export function distanceMiles(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** True when the coordinates are not a point on Earth at all. */
export function coordinatesAreImpossible(v: { latitude: number; longitude: number }): boolean {
  return (
    !Number.isFinite(v.latitude) || !Number.isFinite(v.longitude)
    || Math.abs(v.latitude) > 90 || Math.abs(v.longitude) > 180
    // 0,0 is in the Gulf of Guinea. No truck in this product is there, and
    // every provider that loses a fix reports it, so it is treated as a
    // null island rather than a position.
    || (v.latitude === 0 && v.longitude === 0)
  );
}

/* -------------------------------------------------------------------------- */
/* Per-device state the checks run against                                     */
/* -------------------------------------------------------------------------- */

/**
 * What is already known about a device, gathered before a candidate is judged.
 *
 * Deliberately a plain value rather than a store handle: validation is a pure
 * function of (candidate, facts), which is what makes every rule in this file
 * testable without seeding a registry.
 */
export interface DeviceValidationFacts {
  /** The provider the delivery came from. Part of the identity of a signal. */
  providerId: string;
  /** False when the device id on the delivery is not registered here. */
  deviceKnown: boolean;
  /** Dedupe keys already accepted, flagged or rejected for this organization. */
  knownDedupeKeys: ReadonlySet<string>;
  /** The newest accepted source time for this device, any kind. */
  newestAcceptedSourceAt?: string;
  /** The newest accepted position for this device, for jump detection. */
  lastPosition?: { latitude: number; longitude: number; sourceAt: string };
  lastOdometerMiles?: number;
  lastEngineHours?: number;
  /** True when a driver binding covered the event time. */
  driverBound: boolean;
  /** True when a vehicle binding covered the event time. */
  vehicleBound: boolean;
}

export interface CandidateVerdict {
  state: TelemetryIngestionState;
  anomalies: TelemetryAnomaly[];
  /** Plain language, shown beside the row. Always set when not simply accepted. */
  note?: string;
  /** The normalized source time. Absent only when the timestamp was unusable. */
  sourceAtIso?: string;
  dedupeKey: string;
}

/** Anomalies that make a row not-evidence. Everything else is a flag. */
const REJECTING: readonly TelemetryAnomaly[] = [
  "duplicate", "invalid_timestamp", "future_timestamp", "unknown_device",
] as const;

/**
 * Judge one candidate.
 *
 * Order matters and is deliberate: identity first (is this the same event we
 * already have?), then the clock (can we place it in time at all?), then
 * physics (does it agree with what this device already told us?). A duplicate
 * is never also reported as out-of-order, because it is not a new observation
 * at all — it is the same one, again.
 */
export function judgeCandidate(
  candidate: NormalizedCandidate,
  facts: DeviceValidationFacts,
  nowMs: number,
): CandidateVerdict {
  const anomalies: TelemetryAnomaly[] = [];
  const notes: string[] = [];

  const time = checkTimestamp(candidate.sourceAt, nowMs);
  const dedupeKey = dedupeKeyFor({
    providerId: facts.providerId,
    deviceExternalId: candidate.deviceExternalId,
    kind: candidate.kind,
    sourceAt: time.iso ?? candidate.sourceAt,
    externalEventId: candidate.externalEventId,
  });

  if (!facts.deviceKnown) {
    anomalies.push("unknown_device");
    notes.push(
      "This device is not registered on the connection the delivery arrived on. "
      + "The row is kept so the mismatch can be investigated, and is excluded from everything derived.",
    );
  }

  if (facts.knownDedupeKeys.has(dedupeKey)) {
    anomalies.push("duplicate");
    notes.push("An identical signal has already been received. This copy is kept, and ignored.");
  }

  if (time.anomaly) {
    anomalies.push(time.anomaly);
    if (time.note) notes.push(time.note);
  }

  // Physics only runs when there is a time to hang it on and the row is not
  // already known to be a copy — comparing a duplicate against itself would
  // report an impossible jump of zero miles in zero seconds.
  const physicsWorthRunning =
    Boolean(time.iso) && !anomalies.includes("duplicate") && !anomalies.includes("unknown_device");

  if (physicsWorthRunning && time.iso) {
    if (facts.newestAcceptedSourceAt && time.iso < facts.newestAcceptedSourceAt) {
      anomalies.push("out_of_order");
      notes.push(
        `This is older than a signal already accepted from the same device `
        + `(${facts.newestAcceptedSourceAt}). It is kept, and it does not move the snapshot backwards.`,
      );
    }
    pushPhysics(candidate.value, facts, time.iso, anomalies, notes);
  }

  if (candidate.kind === "hos_summary" && !facts.driverBound) {
    anomalies.push("missing_driver_binding");
    notes.push(
      "No driver was bound to this device at that moment, so the clock cannot be "
      + "attributed to anybody. It is recorded and not published.",
    );
  }

  if (candidate.kind !== "hos_summary" && !facts.vehicleBound && facts.deviceKnown) {
    anomalies.push("missing_vehicle_binding");
    notes.push(
      "No truck was bound to this device at that moment, so this signal is not "
      + "about any piece of equipment Antcolos knows.",
    );
  }

  const state: TelemetryIngestionState = anomalies.some((a) => REJECTING.includes(a))
    ? "rejected"
    : anomalies.length
      ? "flagged"
      : "accepted";

  return {
    state,
    anomalies,
    note: notes.length ? notes.join(" ") : undefined,
    sourceAtIso: time.iso,
    dedupeKey,
  };
}

function pushPhysics(
  value: TelemetryMeasurement,
  facts: DeviceValidationFacts,
  sourceAtIso: string,
  anomalies: TelemetryAnomaly[],
  notes: string[],
) {
  if (value.kind === "location") {
    if (coordinatesAreImpossible(value)) {
      anomalies.push("impossible_jump");
      notes.push("The coordinates are not a position on Earth, or are a lost fix reported as 0, 0.");
      return;
    }
    const previous = facts.lastPosition;
    if (!previous) return;
    const seconds = (Date.parse(sourceAtIso) - Date.parse(previous.sourceAt)) / 1000;
    if (seconds < MIN_JUMP_SECONDS) return;
    const miles = distanceMiles(previous, value);
    const mph = miles / (seconds / 3600);
    if (mph > MAX_PLAUSIBLE_MPH) {
      anomalies.push("impossible_jump");
      notes.push(
        `${miles.toFixed(0)} miles in ${Math.round(seconds / 60)} minutes is `
        + `${Math.round(mph)} mph, which nothing on a road does. Usually a device `
        + "reporting for the wrong unit.",
      );
    }
    return;
  }

  if (value.kind === "odometer" && facts.lastOdometerMiles != null) {
    if (value.miles < facts.lastOdometerMiles - ODOMETER_TOLERANCE_MILES) {
      anomalies.push("odometer_regression");
      notes.push(
        `The odometer reads ${value.miles.toFixed(0)} miles, below the `
        + `${facts.lastOdometerMiles.toFixed(0)} already recorded for this device.`,
      );
    }
    return;
  }

  if (value.kind === "engine_hours" && facts.lastEngineHours != null) {
    if (value.hours < facts.lastEngineHours - ENGINE_HOURS_TOLERANCE) {
      anomalies.push("engine_hours_regression");
      notes.push(
        `Engine hours read ${value.hours.toFixed(1)}, below the `
        + `${facts.lastEngineHours.toFixed(1)} already recorded for this device.`,
      );
    }
  }
}
