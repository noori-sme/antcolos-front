import type {
  GeoPoint, IsoDateTime, LocationSignal, LocationSignalTransport, Provenance,
  TrackingSignalSourceDescriptor,
} from "@/types";
import {
  TRACKING_SIGNAL_SOURCES, dedupeSignals, signalSourceDescriptor,
  type LocationSignalAdapter,
} from "@/lib/tracking";
import type { ServiceContext } from "../contracts/context";
import { mockStore } from "./store";
import { readingHistory } from "./fleet-telemetry";
import { TRUCK_IDS } from "./truck-registry";
import { minutesFromNow } from "./time";

/**
 * ███ MOCK ONLY — NOT AN ELD, NOT A GPS TRACKER, NOT A PHONE ███
 *
 * THE location adapter. Singular, deliberately: there is exactly one place in
 * this build that produces a `LocationSignal`, and everything that reads a
 * position reads it through here. When a real ELD, a driver app, a Telegram
 * bot or a partner API is connected, it registers an adapter beside this one
 * and this file's fixtures stop being consulted. Nothing above it changes.
 *
 * It does NOT own a second store of positions. Three things feed it:
 *
 *   1. The fleet telemetry layer's readings — the existing, org-partitioned,
 *      append-only store from the Fleet milestone. Read, never copied.
 *   2. The load's own event timeline — `load.location_reported` and
 *      `load.eta_updated`, which the Load module already writes.
 *   3. This adapter's own labelled fixture inbox, which is what a real
 *      adapter's inbound queue would hold. Every row of it carries
 *      `mock: true`, an adapter name beginning `mock:`, and says so on screen.
 *
 * Nothing here was measured by a device. The coordinates are approximate city
 * centroids, used so that distance and geofence logic has something to run on
 * — they are not, and are never presented as, observed positions.
 */

const ADAPTER_NAME = "mock:antcolos_location_feed";

let seq = 0;
const rowId = () => `loc_${(++seq).toString(36)}${Date.now().toString(36)}`;

/* -------------------------------------------------------------------------- */
/* Approximate city centroids                                                  */
/* -------------------------------------------------------------------------- */

/**
 * City centroids, rounded, for the cities the fixtures use.
 *
 * A centroid is not a position. It is here so that "how far from the receiver"
 * and "inside the geofence" have numbers to work with in a build with no
 * device feed, and every value derived from one is labelled inferred with a
 * mock provenance. A real feed replaces these with actual coordinates and
 * nothing downstream notices.
 */
export const CITY_POINTS: Record<string, GeoPoint> = {
  "Chicago,IL": { latitude: 41.878, longitude: -87.63 },
  "Joliet,IL": { latitude: 41.525, longitude: -88.082 },
  "Rockford,IL": { latitude: 42.271, longitude: -89.094 },
  "Gary,IN": { latitude: 41.593, longitude: -87.346 },
  "Lafayette,IN": { latitude: 40.417, longitude: -86.875 },
  "Indianapolis,IN": { latitude: 39.768, longitude: -86.158 },
  "Dayton,OH": { latitude: 39.759, longitude: -84.192 },
  "Columbus,OH": { latitude: 39.961, longitude: -82.999 },
  "Cleveland,OH": { latitude: 41.505, longitude: -81.681 },
  "Milwaukee,WI": { latitude: 43.039, longitude: -87.906 },
  "Kansas City,MO": { latitude: 39.1, longitude: -94.579 },
  "St. Louis,MO": { latitude: 38.627, longitude: -90.199 },
  "Nashville,TN": { latitude: 36.163, longitude: -86.781 },
  "Memphis,TN": { latitude: 35.149, longitude: -90.049 },
  "Allentown,PA": { latitude: 40.608, longitude: -75.49 },
  "Harrisburg,PA": { latitude: 40.273, longitude: -76.885 },
  "Pittsburgh,PA": { latitude: 40.441, longitude: -79.996 },
  "Baltimore,MD": { latitude: 39.29, longitude: -76.612 },
  "Richmond,VA": { latitude: 37.541, longitude: -77.436 },
  "Charlotte,NC": { latitude: 35.227, longitude: -80.843 },
  "Raleigh,NC": { latitude: 35.779, longitude: -78.638 },
  "Greensboro,NC": { latitude: 36.073, longitude: -79.792 },
  "Newark,NJ": { latitude: 40.736, longitude: -74.172 },
  "Boston,MA": { latitude: 42.36, longitude: -71.058 },
  "Denver,CO": { latitude: 39.739, longitude: -104.99 },
  "Greeley,CO": { latitude: 40.423, longitude: -104.709 },
  "Colorado Springs,CO": { latitude: 38.834, longitude: -104.821 },
  "Pueblo,CO": { latitude: 38.254, longitude: -104.609 },
  "Grand Junction,CO": { latitude: 39.064, longitude: -108.551 },
  "Salt Lake City,UT": { latitude: 40.761, longitude: -111.891 },
  "Phoenix,AZ": { latitude: 33.448, longitude: -112.074 },
  "Albuquerque,NM": { latitude: 35.084, longitude: -106.651 },
  "Las Vegas,NV": { latitude: 36.171, longitude: -115.139 },
  "Cheyenne,WY": { latitude: 41.14, longitude: -104.82 },
  "Portland,OR": { latitude: 45.515, longitude: -122.678 },
  "Eugene,OR": { latitude: 44.052, longitude: -123.087 },
  "Olympia,WA": { latitude: 47.038, longitude: -122.9 },
  "Tacoma,WA": { latitude: 47.253, longitude: -122.444 },
  "Seattle,WA": { latitude: 47.606, longitude: -122.332 },
  "Spokane,WA": { latitude: 47.659, longitude: -117.426 },
  "Boise,ID": { latitude: 43.615, longitude: -116.202 },
};

/** The centroid for a city, or nothing. Never a guess at a nearby one. */
export function cityPoint(city?: string, state?: string): GeoPoint | undefined {
  if (!city || !state) return undefined;
  return CITY_POINTS[`${city},${state}`];
}

/* -------------------------------------------------------------------------- */
/* Provenance                                                                  */
/* -------------------------------------------------------------------------- */

function provenanceFor(transport: LocationSignalTransport, observedAt: IsoDateTime, confidence: number): Provenance {
  return {
    module: transport === "eld" ? "eld" : "telematics",
    adapter: ADAPTER_NAME,
    mock: true,
    observedAt,
    receivedAt: new Date().toISOString(),
    confidence,
  };
}

/* -------------------------------------------------------------------------- */
/* The adapter's own inbox                                                     */
/* -------------------------------------------------------------------------- */

interface InboxState {
  /** `${organizationId}:${truckId}` → positions, newest last. */
  rows: Map<string, LocationSignal[]>;
  /** Feeds a person has deliberately silenced, to exercise an outage. */
  muted: Set<string>;
}

let inbox: InboxState | null = null;

const inboxKey = (organizationId: string, truckId: string) => `${organizationId}:${truckId}`;

function db(): InboxState {
  if (!inbox) inbox = { rows: buildFixtures(), muted: new Set() };
  return inbox;
}

/** Test hook. Never called by the UI. */
export function resetTrackingSignals() {
  seq = 0;
  inbox = { rows: buildFixtures(), muted: new Set() };
}

function signal(input: {
  organizationId: string;
  truckId: string;
  loadId?: string;
  transport: LocationSignalTransport;
  minutesAgo: number;
  city?: string;
  state?: string;
  description?: string;
  point?: GeoPoint;
  speedMph?: number;
  confidence?: number;
}): LocationSignal {
  const observedAt = minutesFromNow(-input.minutesAgo);
  const confidence = input.confidence ?? 0.8;
  return {
    id: rowId(),
    truckId: input.truckId,
    loadId: input.loadId,
    organizationId: input.organizationId,
    transport: input.transport,
    city: input.city,
    state: input.state,
    description: input.description,
    point: input.point ?? cityPoint(input.city, input.state),
    speedMph: input.speedMph,
    observedAt,
    // Written up a minute or two after it was true, as a real feed is.
    receivedAt: minutesFromNow(-Math.max(0, input.minutesAgo - 1)),
    confidence,
    provenance: provenanceFor(input.transport, observedAt, confidence),
  };
}

/**
 * The fixture feeds.
 *
 * Deliberately uneven, for the same reason the fleet telemetry fixtures are: a
 * board where every truck reports every ten minutes is not a board anybody has
 * ever worked, and it would hide every state this module exists to show. So
 * one feed is healthy, one is parked at a receiver, one was working and
 * stopped, one is hours old, one comes from a dispatcher's phone call, and
 * several trucks have never reported at all.
 */
function buildFixtures(): Map<string, LocationSignal[]> {
  const rows = new Map<string, LocationSignal[]>();
  const put = (organizationId: string, truckId: string, signals: LocationSignal[]) => {
    rows.set(inboxKey(organizationId, truckId), signals);
  };

  const NL = "org_northline";
  const MD = "org_meridian";
  const SOLO = "org_solo";
  const CS = "org_cascade";

  /* --- Northline 104 on NL-24817, Chicago → Columbus. A healthy feed. ---- */
  put(NL, TRUCK_IDS.nl104, [
    signal({ organizationId: NL, truckId: TRUCK_IDS.nl104, transport: "fleet_telemetry", minutesAgo: 165, city: "Indianapolis", state: "IN", description: "I-70 eastbound", speedMph: 61 }),
    signal({ organizationId: NL, truckId: TRUCK_IDS.nl104, transport: "fleet_telemetry", minutesAgo: 120, city: "Indianapolis", state: "IN", description: "I-70 eastbound at the 90", speedMph: 63 }),
    signal({ organizationId: NL, truckId: TRUCK_IDS.nl104, transport: "fleet_telemetry", minutesAgo: 78, city: "Dayton", state: "OH", description: "I-70 eastbound", speedMph: 58 }),
    signal({ organizationId: NL, truckId: TRUCK_IDS.nl104, transport: "fleet_telemetry", minutesAgo: 36, city: "Dayton", state: "OH", description: "I-70 eastbound, past the I-75 split", speedMph: 62 }),
    signal({ organizationId: NL, truckId: TRUCK_IDS.nl104, transport: "fleet_telemetry", minutesAgo: 11, city: "Dayton", state: "OH", description: "I-70 eastbound, east of Springfield", speedMph: 60 }),
  ]);

  /* --- Northline 107 on NL-24816: sitting on the receiver's dock. -------- */
  const receiver = CITY_POINTS["Indianapolis,IN"];
  put(NL, TRUCK_IDS.nl107, [
    signal({ organizationId: NL, truckId: TRUCK_IDS.nl107, transport: "fleet_telemetry", minutesAgo: 190, city: "Indianapolis", state: "IN", description: "I-65 southbound", speedMph: 57 }),
    signal({ organizationId: NL, truckId: TRUCK_IDS.nl107, transport: "fleet_telemetry", minutesAgo: 158, point: receiver, city: "Indianapolis", state: "IN", description: "Receiving yard", speedMph: 2 }),
    signal({ organizationId: NL, truckId: TRUCK_IDS.nl107, transport: "fleet_telemetry", minutesAgo: 96, point: receiver, city: "Indianapolis", state: "IN", description: "Door 14", speedMph: 0 }),
    signal({ organizationId: NL, truckId: TRUCK_IDS.nl107, transport: "fleet_telemetry", minutesAgo: 22, point: receiver, city: "Indianapolis", state: "IN", description: "Door 14", speedMph: 0 }),
  ]);

  /* --- Meridian's Baxter tractor on MD-9042: was reporting, then stopped.  */
  put(MD, TRUCK_IDS.mdA12, [
    signal({ organizationId: MD, truckId: TRUCK_IDS.mdA12, transport: "api", minutesAgo: 320, city: "Allentown", state: "PA", description: "I-78 westbound", speedMph: 59 }),
    signal({ organizationId: MD, truckId: TRUCK_IDS.mdA12, transport: "api", minutesAgo: 305, city: "Harrisburg", state: "PA", description: "I-78 westbound", speedMph: 61 }),
    signal({ organizationId: MD, truckId: TRUCK_IDS.mdA12, transport: "api", minutesAgo: 290, city: "Harrisburg", state: "PA", description: "I-81 southbound", speedMph: 60 }),
    signal({ organizationId: MD, truckId: TRUCK_IDS.mdA12, transport: "api", minutesAgo: 274, city: "Harrisburg", state: "PA", description: "Turnpike westbound", speedMph: 62 }),
  ]);

  /* --- Meridian's Crosswind unit on MD-9038: one position, hours old. ---- */
  put(MD, TRUCK_IDS.crosswind, [
    signal({ organizationId: MD, truckId: TRUCK_IDS.crosswind, transport: "email", minutesAgo: 540, city: "Greensboro", state: "NC", description: "Check-call email", confidence: 0.4 }),
  ]);

  /* --- The solo dispatcher's Cascade van on SD-118: a phone call. -------- */
  put(SOLO, TRUCK_IDS.cs47, [
    signal({ organizationId: SOLO, truckId: TRUCK_IDS.cs47, transport: "dispatcher_entry", minutesAgo: 34, city: "Olympia", state: "WA", description: "Driver rang in from the Olympia rest area", confidence: 1 }),
  ]);

  /* --- Cascade's own view of the same truck on CS-3318. ------------------ */
  put(CS, TRUCK_IDS.cs47, [
    signal({ organizationId: CS, truckId: TRUCK_IDS.cs47, transport: "driver_report", minutesAgo: 41, city: "Olympia", state: "WA", description: "Reported by the driver", confidence: 1 }),
  ]);

  return rows;
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

const TRANSPORT_FOR_TELEMETRY: Record<string, LocationSignalTransport> = {
  manual_entry: "dispatcher_entry",
  dispatcher_entry: "dispatcher_entry",
  driver_report: "driver_report",
  mock_adapter: "fleet_telemetry",
  eld_integration: "eld",
  gps_integration: "fleet_telemetry",
  telematics_integration: "fleet_telemetry",
};

/**
 * Normalize the fleet layer's own readings into location signals.
 *
 * The readings stay where they are. This reads them through the fleet layer's
 * own org-partitioned accessor, so a workspace cannot see another carrier's
 * operational reporting here any more than it can on the fleet screen — the
 * rule is enforced once, in the layer that owns the data, and inherited.
 */
function fromFleetTelemetry(organizationId: string, truckId: string): LocationSignal[] {
  return readingHistory(truckId, organizationId, 40)
    .filter((r) => r.location)
    .map((r): LocationSignal => {
      const transport = TRANSPORT_FOR_TELEMETRY[r.source] ?? "fleet_telemetry";
      const confidence = transport === "driver_report" || transport === "dispatcher_entry" ? 1 : 0.7;
      return {
        id: `tel:${r.id}`,
        truckId,
        organizationId,
        transport,
        telemetrySource: r.source,
        city: r.location?.city,
        state: r.location?.state,
        description: r.location?.description,
        point: r.location?.latitude != null && r.location.longitude != null
          ? { latitude: r.location.latitude, longitude: r.location.longitude }
          : cityPoint(r.location?.city, r.location?.state),
        observedAt: r.observedAt,
        receivedAt: r.recordedAt,
        confidence,
        provenance: {
          module: "telematics",
          adapter: `mock:fleet_telemetry/${r.source}`,
          mock: true,
          observedAt: r.observedAt,
          receivedAt: r.recordedAt,
          confidence,
          externalId: r.id,
        },
      };
    });
}

/**
 * Positions the Load module already recorded on its own timeline.
 *
 * `load.location_reported` is a Load event and stays one. Reading it here
 * rather than duplicating it is the difference between consuming the Load
 * module and growing a second copy of it.
 */
function fromLoadTimeline(organizationId: string, loadId: string, truckId: string): LocationSignal[] {
  let org;
  try {
    org = mockStore.org(organizationId);
  } catch {
    return [];
  }
  return org.events
    .filter((e) => e.loadId === loadId && e.kind === "load.location_reported")
    .map((e): LocationSignal => {
      const transport: LocationSignalTransport =
        e.source === "eld" ? "eld"
          : e.source === "telegram" ? "telegram_location"
            : e.source === "api" ? "api"
              : e.source === "email" ? "email"
                : "dispatcher_entry";
      const confidence = transport === "dispatcher_entry" ? 1 : 0.65;
      return {
        id: `evt:${e.id}`,
        truckId,
        loadId,
        organizationId,
        transport,
        description: e.payload?.locationLabel ?? e.payload?.note,
        point: e.payload?.location,
        observedAt: e.occurredAt,
        receivedAt: e.recordedAt,
        confidence,
        provenance: {
          module: "telematics",
          adapter: "mock:load_timeline",
          mock: true,
          observedAt: e.occurredAt,
          receivedAt: e.recordedAt,
          confidence,
          externalId: e.id,
        },
      };
    });
}

/**
 * Every position this workspace may read for one truck, oldest first.
 *
 * Scope is inherited rather than re-decided: the fleet telemetry accessor is
 * org-partitioned, the load timeline is org-partitioned, and the fixture inbox
 * is keyed by organization. There is no code path here that reaches a position
 * recorded by another organization.
 */
export function locationSignalsFor(
  ctx: Pick<ServiceContext, "organizationId">,
  input: { truckId: string; loadId?: string; sinceAt?: IsoDateTime },
): LocationSignal[] {
  const key = inboxKey(ctx.organizationId, input.truckId);
  if (db().muted.has(key)) return [];

  const merged = [
    ...(db().rows.get(key) ?? []),
    ...fromFleetTelemetry(ctx.organizationId, input.truckId),
    ...(input.loadId ? fromLoadTimeline(ctx.organizationId, input.loadId, input.truckId) : []),
  ];

  const scoped = merged.filter(
    (s) => !input.sinceAt || s.observedAt >= input.sinceAt,
  );
  return dedupeSignals(scoped).map((s) => ({ ...s, loadId: s.loadId ?? input.loadId }));
}

/** The latest position only, or nothing. Never a stand-in. */
export function latestLocationSignal(
  ctx: Pick<ServiceContext, "organizationId">,
  input: { truckId: string; loadId?: string },
): LocationSignal | undefined {
  const all = locationSignalsFor(ctx, input);
  return all[all.length - 1];
}

/**
 * The ETA the Load module last recorded, if any.
 *
 * Read from `load.eta_updated`, which is the Load module's own event. This
 * module never computes an ETA: doing so from a straight-line distance and an
 * assumed speed would be a number that looked like a promise.
 */
export function reportedEta(organizationId: string, loadId: string): IsoDateTime | undefined {
  let org;
  try {
    org = mockStore.org(organizationId);
  } catch {
    return undefined;
  }
  const events = org.events
    .filter((e) => e.loadId === loadId && e.kind === "load.eta_updated" && e.payload?.etaAt)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  return events[events.length - 1]?.payload?.etaAt;
}

/* -------------------------------------------------------------------------- */
/* Development affordances                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Hand this adapter a position as if a device had produced one.
 *
 * Present ONLY on the mock adapter, and named so nobody mistakes it for a
 * feed. It is what the "mock signal" controls on the tracking screen call, and
 * what the tests use to put stale, duplicate, missing and pass-by situations
 * in front of the engine.
 */
export function simulatePosition(input: {
  organizationId: string;
  truckId: string;
  loadId?: string;
  transport?: LocationSignalTransport;
  city?: string;
  state?: string;
  description?: string;
  point?: GeoPoint;
  speedMph?: number;
  minutesAgo?: number;
  confidence?: number;
}): LocationSignal {
  const row = signal({
    organizationId: input.organizationId,
    truckId: input.truckId,
    loadId: input.loadId,
    transport: input.transport ?? "fleet_telemetry",
    minutesAgo: input.minutesAgo ?? 0,
    city: input.city,
    state: input.state,
    description: input.description ?? "Simulated by the mock location adapter",
    point: input.point,
    speedMph: input.speedMph,
    confidence: input.confidence,
  });
  const key = inboxKey(input.organizationId, input.truckId);
  db().rows.set(key, [...(db().rows.get(key) ?? []), row]);
  return row;
}

/** Silence a feed, to exercise an interruption. Reversible. */
export function simulateSignalOutage(organizationId: string, truckId: string, muted = true) {
  const key = inboxKey(organizationId, truckId);
  if (muted) db().muted.add(key);
  else db().muted.delete(key);
}

export function feedIsMuted(organizationId: string, truckId: string): boolean {
  return db().muted.has(inboxKey(organizationId, truckId));
}

/* -------------------------------------------------------------------------- */
/* The registered adapter                                                      */
/* -------------------------------------------------------------------------- */

export const mockLocationAdapter: LocationSignalAdapter = {
  transport: "fleet_telemetry",
  describe(): TrackingSignalSourceDescriptor {
    return signalSourceDescriptor("fleet_telemetry")!;
  },
  async positionsFor(input) {
    return locationSignalsFor({ organizationId: input.organizationId }, input);
  },
};

/** What is and is not connected, for a screen that has to say so. */
export function trackingSignalSources(): TrackingSignalSourceDescriptor[] {
  return TRACKING_SIGNAL_SOURCES.map((d) => ({ ...d }));
}
