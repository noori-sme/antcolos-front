import type { LocationSignal, LocationSignalTransport } from "@/types";

/**
 * Normalization and deduplication for inbound location signals.
 *
 * Every transport this module will ever accept — an ELD push, a phone, a
 * Telegram location, an API poll, a parsed email — retries. A webhook fires
 * twice, a poll overlaps its predecessor, a driver taps "share location"
 * again. Recording the same position twice is not harmless: a doubled run of
 * pings halves the apparent cadence, which makes a real interruption look
 * normal, and it inflates the dwell an arrival is inferred from.
 *
 * So identity is defined here, once, for every transport.
 */

/**
 * The identity of an observation.
 *
 * The source's own record id wins when it gives one — that is the only
 * identifier that survives a position being re-sent with a different received
 * time. Failing that, two readings from one transport, for one truck, at one
 * instant, about one place, are one reading.
 */
export function signalIdentity(signal: LocationSignal): string {
  const external = signal.provenance?.externalId;
  if (external) return `${signal.transport}:${external}`;

  const place = signal.point
    // Five decimal places is about a metre. Finer than that is noise from the
    // device, not a different place.
    ? `${signal.point.latitude.toFixed(5)},${signal.point.longitude.toFixed(5)}`
    : `${signal.city ?? ""}/${signal.state ?? ""}/${signal.description ?? ""}`;

  return `${signal.transport}:${signal.truckId}:${signal.observedAt}:${place}`;
}

/**
 * Collapse repeats, keeping the FIRST copy of each observation.
 *
 * First rather than last on purpose: the earliest arrival of a duplicate is
 * the one whose `receivedAt` reflects when Antcolos genuinely learned the
 * position, and overwriting it with a retry's later timestamp would make the
 * system look slower at hearing things than it was.
 *
 * Returns the signals oldest-first, which is the order everything downstream
 * — cadence, dwell, geofence runs — assumes.
 */
export function dedupeSignals(signals: readonly LocationSignal[]): LocationSignal[] {
  const seen = new Set<string>();
  const kept: LocationSignal[] = [];
  for (const signal of [...signals].sort((a, b) => {
    const byObserved = a.observedAt.localeCompare(b.observedAt);
    return byObserved !== 0 ? byObserved : a.receivedAt.localeCompare(b.receivedAt);
  })) {
    const id = signalIdentity(signal);
    if (seen.has(id)) continue;
    seen.add(id);
    kept.push(signal);
  }
  return kept;
}

/** How many repeats a run contained. Reported rather than hidden. */
export function duplicateCount(signals: readonly LocationSignal[]): number {
  return signals.length - dedupeSignals(signals).length;
}

export const TRANSPORT_LABEL: Record<LocationSignalTransport, string> = {
  fleet_telemetry: "Fleet telemetry",
  eld: "ELD",
  mobile_gps: "Driver phone GPS",
  telegram_location: "Telegram location",
  api: "Partner API",
  email: "Email",
  sms: "SMS",
  dispatcher_entry: "Entered by dispatch",
  driver_report: "Reported by the driver",
};

/**
 * Whether a transport is a machine or a person.
 *
 * It decides attribution, and attribution decides whether a conclusion can
 * ever be more than inferred. A dispatcher typing in a location after a phone
 * call is a person's statement; an ELD push is not, however precise it is.
 */
export function isHumanTransport(transport: LocationSignalTransport): boolean {
  return transport === "dispatcher_entry" || transport === "driver_report";
}

/** The most recent signal, or undefined. Assumes nothing about input order. */
export function latestSignal(signals: readonly LocationSignal[]): LocationSignal | undefined {
  let best: LocationSignal | undefined;
  for (const s of signals) {
    if (!best || s.observedAt > best.observedAt) best = s;
  }
  return best;
}
