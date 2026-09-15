import type { GeoPoint } from "@/types";

/**
 * Distance, proximity and geofences.
 *
 * Everything here is straight-line. A great-circle distance is not a driving
 * distance and this module never pretends it is: the values it produces are
 * named `straightLineMiles` and `proximity`, and nothing downstream calls them
 * an ETA or a route. When a routing provider is connected it replaces these
 * functions; until then, calling them what they are is the whole discipline.
 */

const EARTH_RADIUS_MILES = 3_958.8;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle distance in miles. Straight line, never a road. */
export function straightLineMiles(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * How close a truck is to where it is going, in words a dispatcher uses.
 *
 * The bands are deliberately coarse. A number that says "37.2 miles out" from
 * a straight-line calculation invites a precision the data does not have.
 */
export type DeliveryProximity = "at_destination" | "close" | "approaching" | "en_route" | "far";

export const PROXIMITY_LABEL: Record<DeliveryProximity, string> = {
  at_destination: "At the receiver",
  close: "Within 25 miles",
  approaching: "Within 100 miles",
  en_route: "On the way",
  far: "A long way out",
};

/** Miles at which each band starts. Inclusive of the lower bound. */
export const PROXIMITY_BANDS = {
  atDestination: 3,
  close: 25,
  approaching: 100,
  enRoute: 400,
} as const;

export function proximityFor(miles: number): DeliveryProximity {
  if (miles <= PROXIMITY_BANDS.atDestination) return "at_destination";
  if (miles <= PROXIMITY_BANDS.close) return "close";
  if (miles <= PROXIMITY_BANDS.approaching) return "approaching";
  if (miles <= PROXIMITY_BANDS.enRoute) return "en_route";
  return "far";
}

/* -------------------------------------------------------------------------- */
/* Geofences                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A circle around a facility.
 *
 * Radius is a property of the FACILITY, not a global constant, because a
 * cross-dock in a city block and a distribution centre with a two-mile
 * approach road are not the same problem. Where nothing is known,
 * `DEFAULT_GEOFENCE_RADIUS_MILES` is used and the inference says so.
 */
export interface Geofence {
  /** The stop or facility this circle belongs to. */
  subjectId: string;
  label: string;
  centre: GeoPoint;
  radiusMiles: number;
}

export const DEFAULT_GEOFENCE_RADIUS_MILES = 1.5;

/**
 * Whether a geofence crossing should be believed.
 *
 * This is the guard against the single most common false positive in tracking:
 * a truck passing a receiver at highway speed on the interstate that runs
 * alongside it, producing an "arrived" that nobody did. Three tests, all of
 * which must pass:
 *
 *  1. INSIDE — the position is actually within the radius.
 *  2. SETTLED — the truck is not moving quickly. A vehicle doing 55 through a
 *     1.5-mile circle is on a road, not on a dock.
 *  3. DWELLED — it has been inside long enough to have stopped for a reason.
 *
 * A crossing that fails any of them is not discarded, it is REJECTED WITH A
 * REASON, and that reason is kept as disregarded evidence. "We saw this and
 * did not believe it, because the truck was doing 62mph" is the line that
 * settles the argument three weeks later.
 */
export interface GeofenceObservation {
  point?: GeoPoint;
  speedMph?: number;
  observedAt: string;
}

export type GeofenceVerdict =
  | { inside: true; believable: true; dwellMinutes: number; rationale: string }
  | { inside: boolean; believable: false; dwellMinutes: number; rejection: string };

/** Above this, a position inside the circle is a pass-by, not an arrival. */
export const GEOFENCE_MAX_SETTLED_MPH = 8;
/** Below this many minutes inside, an entry has not earned the word "arrived". */
export const GEOFENCE_MIN_DWELL_MINUTES = 12;

/**
 * Evaluate a run of observations against one geofence.
 *
 * Takes the whole run rather than the latest point because dwell cannot be
 * derived from a single reading, and a module that inferred arrival from one
 * ping would be exactly the false-positive machine this guard exists to stop.
 * Observations are expected oldest-first.
 */
export function evaluateGeofence(
  fence: Geofence,
  observations: readonly GeofenceObservation[],
  now: Date = new Date(),
): GeofenceVerdict {
  const positioned = observations.filter((o) => o.point);
  if (positioned.length === 0) {
    return { inside: false, believable: false, dwellMinutes: 0, rejection: "No position was reported at all." };
  }

  const latest = positioned[positioned.length - 1];
  const insideNow = straightLineMiles(latest.point!, fence.centre) <= fence.radiusMiles;
  if (!insideNow) {
    return { inside: false, believable: false, dwellMinutes: 0, rejection: `The last position is outside ${fence.label}.` };
  }

  if (latest.speedMph != null && latest.speedMph > GEOFENCE_MAX_SETTLED_MPH) {
    return {
      inside: true,
      believable: false,
      dwellMinutes: 0,
      rejection:
        `Inside ${fence.label} but moving at ${Math.round(latest.speedMph)} mph. `
        + "That is a truck passing, not a truck arriving.",
    };
  }

  // Walk backwards to the first observation of the current unbroken run inside.
  let entryAt = latest.observedAt;
  for (let i = positioned.length - 1; i >= 0; i -= 1) {
    const o = positioned[i];
    if (straightLineMiles(o.point!, fence.centre) > fence.radiusMiles) break;
    if (o.speedMph != null && o.speedMph > GEOFENCE_MAX_SETTLED_MPH) break;
    entryAt = o.observedAt;
  }

  const dwellMinutes = Math.max(
    0,
    Math.round((now.getTime() - Date.parse(entryAt)) / 60_000),
  );

  if (dwellMinutes < GEOFENCE_MIN_DWELL_MINUTES) {
    return {
      inside: true,
      believable: false,
      dwellMinutes,
      rejection:
        `Inside ${fence.label} for ${dwellMinutes} minute${dwellMinutes === 1 ? "" : "s"}, `
        + `which is under the ${GEOFENCE_MIN_DWELL_MINUTES}-minute dwell this build requires before it will call that an arrival.`,
    };
  }

  return {
    inside: true,
    believable: true,
    dwellMinutes,
    rationale:
      `Inside ${fence.label} for ${dwellMinutes} minutes, stationary or nearly so. `
      + "That is consistent with being on site — it is not a driver saying so.",
  };
}

/**
 * Whether the truck has left a fence it was previously inside.
 *
 * An exit needs a position OUTSIDE after a believable entry. A gap in the feed
 * is not an exit, which matters: a dead phone at a receiver must not read as a
 * truck that has loaded and gone.
 */
export function hasExited(
  fence: Geofence,
  observations: readonly GeofenceObservation[],
): { exited: boolean; at?: string; reason: string } {
  const positioned = observations.filter((o) => o.point);
  if (positioned.length === 0) return { exited: false, reason: "No positions to judge by." };

  let sawInside = false;
  for (const o of positioned) {
    const inside = straightLineMiles(o.point!, fence.centre) <= fence.radiusMiles;
    if (inside) {
      sawInside = true;
      continue;
    }
    if (sawInside) {
      return {
        exited: true,
        at: o.observedAt,
        reason: `A position outside ${fence.label} followed positions inside it.`,
      };
    }
  }
  return {
    exited: false,
    reason: sawInside
      ? `Still inside ${fence.label}, or the feed stopped while it was.`
      : `Never observed inside ${fence.label}.`,
  };
}
