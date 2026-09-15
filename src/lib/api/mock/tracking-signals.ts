import type {
  GeoPoint, IsoDateTime, LocationPrecision, LocationSignal, LocationSignalTransport,
  Provenance, TelemetryEvent, TrackingSignalSourceDescriptor,
} from "@/types";
import {
  TRACKING_SIGNAL_SOURCES, dedupeSignals, signalSourceDescriptor,
  type LocationSignalAdapter,
} from "@/lib/tracking";
import type { ServiceContext } from "../contracts/context";
import { mockStore } from "./store";
import { readingHistory } from "./fleet-telemetry";
import { eldTelemetryForTruckSync, type EldTelemetryRead } from "./eld";
import { TRUCK_IDS } from "./truck-registry";
import { minutesFromNow } from "./time";

/**
 * ███ MOCK ONLY — NOT AN ELD, NOT A GPS TRACKER, NOT A PHONE ███
 *
 * THE location adapter, and the one gate every position passes through.
 *
 * ★ THE ELD MODULE DECIDES WHO MAY SEE A POSITION ★
 *
 * That is the rule this file exists to enforce, and it is enforced ONCE, at the
 * top of `locationSignalsFor`, before any source is consulted. The ELD &
 * Telematics module owns the question "may this workspace know where this truck
 * is": it holds the carrier's explicit per-truck share records, it knows which
 * signal classes were granted, and it knows whether this membership may hold
 * coordinates or only a city name. Tracking does not re-derive any of that and
 * has no path around it.
 *
 * Which matters most for the sources that are NOT the ELD. A dispatcher's
 * check-call and the Load module's own `load.location_reported` events are
 * legitimate positions and they stay — but they are gated by the same answer.
 * A dispatch workspace with no share on a truck gets nothing from any source,
 * including its own hand-typed readings, because a carrier that declined to
 * share a truck's position did not thereby agree to it being reconstructed from
 * the notes somebody took on the phone.
 *
 * Precedence, once the gate is passed:
 *
 *   1. ELD & Telematics — a device, normalized, with provider provenance.
 *   2. Fleet telemetry readings — what a person called in or typed.
 *   3. The Load module's own location events.
 *   4. This adapter's simulation inbox, for the mock controls and the tests.
 *
 * Every one is labelled with its transport, so a dispatcher reading a row knows
 * whether a machine or a colleague is the reason they think the truck is in
 * Dayton. Nothing here was measured by a device: no provider is connected, and
 * every fixture says so.
 */

const ADAPTER_NAME = "mock:antcolos_location_feed";

let seq = 0;
const rowId = () => `loc_${(++seq).toString(36)}${Date.now().toString(36)}`;

/* -------------------------------------------------------------------------- */
/* Approximate city centroids                                                  */
/* -------------------------------------------------------------------------- */

/**
 * City centroids, rounded, for the cities the non-ELD fixtures use.
 *
 * A centroid is not a position. It is here so that distance and geofence logic
 * has something to run on for a hand-entered reading in a build with no
 * provider feed, and every value derived from one is labelled inferred with a
 * mock provenance. ELD observations carry the provider's own coordinates and
 * never touch this table.
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
/* The gate                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Whether this workspace may read this truck's position at all, and how
 * precisely — answered by the ELD module, for every source.
 */
export interface LocationScope {
  scoped: boolean;
  precision: LocationPrecision;
  /** Why nothing came back, when nothing did. Written for a dispatcher. */
  refusal?: string;
  eld?: EldTelemetryRead;
}

export function locationScopeFor(
  ctx: Pick<ServiceContext, "organizationId" | "permissions" | "workspaceKind" | "membershipId" | "actor" | "scope" | "driverProfileId">,
  truckId: string,
): LocationScope {
  if (!ctx.permissions.has("eld:view")) {
    return {
      scoped: false,
      precision: "city_only",
      refusal:
        "Positions are read through the ELD & Telematics module, and this membership does not "
        + "hold eld:view. No other source is consulted, because none may be used to work around it.",
    };
  }

  const eld = eldTelemetryForTruckSync(ctx as ServiceContext, truckId);
  if (!eld) {
    return {
      scoped: false,
      precision: "city_only",
      refusal:
        "This truck's position is not shared with this workspace. A carrier shares telemetry "
        + "per truck and per signal class, and no share covers this one.",
    };
  }

  return { scoped: true, precision: eld.precise ? "exact" : "city_only", eld };
}

/**
 * Reduce a position to what the scope permits.
 *
 * The one place coordinates are attached, so there is no source that can slip
 * one past the precision rule.
 */
function atPrecision(
  precision: LocationPrecision,
  point: GeoPoint | undefined,
): GeoPoint | undefined {
  return precision === "exact" ? point : undefined;
}

/* -------------------------------------------------------------------------- */
/* Provenance                                                                  */
/* -------------------------------------------------------------------------- */

function provenanceFor(
  transport: LocationSignalTransport,
  observedAt: IsoDateTime,
  confidence: number,
): Provenance {
  return {
    module: transport === "eld" || transport === "eld_telemetry" ? "eld" : "telematics",
    adapter: ADAPTER_NAME,
    mock: true,
    observedAt,
    receivedAt: new Date().toISOString(),
    confidence,
  };
}

/* -------------------------------------------------------------------------- */
/* 1. ELD & Telematics — the canonical source                                  */
/* -------------------------------------------------------------------------- */

/**
 * Normalize the ELD module's own observations.
 *
 * The events arrive already scoped and already redacted by that module. This
 * maps them into the one shape Tracking reads and adds nothing: no coordinate
 * is recovered, no confidence is raised, and the provider's own quality rating
 * travels through as the signal's confidence rather than being replaced by a
 * number this file made up.
 */
function fromEld(read: EldTelemetryRead, precision: LocationPrecision): LocationSignal[] {
  const speedByInstant = new Map<string, number>();
  const motionByInstant = new Map<string, boolean>();
  for (const event of read.observations) {
    if (event.value.kind === "speed") speedByInstant.set(event.sourceAt, event.value.milesPerHour);
    if (event.value.kind === "motion") motionByInstant.set(event.sourceAt, event.value.moving);
  }

  return read.observations
    .filter((e): e is TelemetryEvent & { value: { kind: "location" } } => e.value.kind === "location")
    .map((event): LocationSignal => {
      const value = event.value as {
        kind: "location"; latitude: number; longitude: number;
        city?: string; state?: string; description?: string;
      };
      // The ELD module zeroes coordinates it withholds rather than dropping
      // them, so that an event still reads as a location event. Carrying a
      // 0,0 into a distance calculation would put the truck in the Atlantic.
      const point = precision === "exact"
        ? { latitude: value.latitude, longitude: value.longitude }
        : undefined;
      const moving = motionByInstant.get(event.sourceAt);

      return {
        id: `eld:${event.id}`,
        truckId: read.truckId,
        organizationId: read.ownerOrganizationId,
        transport: "eld_telemetry",
        city: value.city,
        state: value.state,
        description: value.description,
        point,
        precision,
        speedMph: speedByInstant.get(event.sourceAt)
          ?? (moving === false ? 0 : undefined),
        observedAt: event.sourceAt,
        receivedAt: event.receivedAt,
        // The provider's own quality rating, carried rather than re-scored.
        confidence: event.quality === "confirmed" ? 1 : event.quality === "corrected" ? 0.9 : 0.75,
        provenance: {
          module: "eld",
          adapter: `mock:eld/${event.providerId ?? "provider"}`,
          mock: true,
          observedAt: event.sourceAt,
          receivedAt: event.receivedAt,
          confidence: event.quality === "confirmed" ? 1 : 0.75,
          externalId: event.id,
        },
      };
    });
}

/* -------------------------------------------------------------------------- */
/* 2. Fleet telemetry readings                                                 */
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
 * What a person called in, from the fleet layer's own store.
 *
 * Still read through the fleet layer's org-partitioned accessor — a workspace
 * never sees another organization's operational reporting — and now also behind
 * the ELD scope, so a dispatch workspace with no share cannot reconstruct a
 * position from a colleague's phone notes.
 */
function fromFleetTelemetry(
  organizationId: string,
  truckId: string,
  precision: LocationPrecision,
): LocationSignal[] {
  return readingHistory(truckId, organizationId, 40)
    .filter((r) => r.location)
    .map((r): LocationSignal => {
      const transport = TRANSPORT_FOR_TELEMETRY[r.source] ?? "fleet_telemetry";
      const confidence = transport === "driver_report" || transport === "dispatcher_entry" ? 1 : 0.7;
      const raw = r.location?.latitude != null && r.location.longitude != null
        ? { latitude: r.location.latitude, longitude: r.location.longitude }
        : cityPoint(r.location?.city, r.location?.state);
      return {
        id: `tel:${r.id}`,
        truckId,
        organizationId,
        transport,
        telemetrySource: r.source,
        city: r.location?.city,
        state: r.location?.state,
        description: r.location?.description,
        point: atPrecision(precision, raw),
        precision,
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

/* -------------------------------------------------------------------------- */
/* 3. The Load module's own timeline                                           */
/* -------------------------------------------------------------------------- */

/**
 * Positions the Load module already recorded on its own timeline.
 *
 * `load.location_reported` is a Load event and stays one. Reading it here
 * rather than duplicating it is the difference between consuming the Load
 * module and growing a second copy of it — and it is gated like every other
 * source, so a load event cannot carry a position past a missing share.
 */
function fromLoadTimeline(
  organizationId: string,
  loadId: string,
  truckId: string,
  precision: LocationPrecision,
): LocationSignal[] {
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
        point: atPrecision(precision, e.payload?.location),
        precision,
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

/* -------------------------------------------------------------------------- */
/* 4. The adapter's simulation inbox                                           */
/* -------------------------------------------------------------------------- */

interface InboxState {
  /** `${organizationId}:${truckId}` → simulated positions, newest last. */
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
    // Stored at full precision; reduced on the way out, per caller.
    precision: "exact",
    speedMph: input.speedMph,
    observedAt,
    receivedAt: minutesFromNow(-Math.max(0, input.minutesAgo - 1)),
    confidence,
    provenance: provenanceFor(input.transport, observedAt, confidence),
  };
}

/**
 * The fixture feeds this adapter holds itself.
 *
 * Much smaller than it was: the ELD module now supplies richer, properly
 * attributed observations for every truck that has a device, so these exist
 * only for the trucks it does not cover and for the mock controls to write
 * into. Deliberately uneven, for the same reason the fleet telemetry fixtures
 * are — a board where every truck reports every ten minutes is not a board
 * anybody has ever worked.
 */
function buildFixtures(): Map<string, LocationSignal[]> {
  const rows = new Map<string, LocationSignal[]>();
  const put = (organizationId: string, truckId: string, signals: LocationSignal[]) => {
    rows.set(inboxKey(organizationId, truckId), signals);
  };

  const SOLO = "org_solo";
  const CS = "org_cascade";

  /* --- The solo dispatcher's Cascade van: a phone call, not a device.
     Cascade has NOT shared this truck's telemetry with the solo workspace, so
     this reading is deliberately unreachable from there. It is kept because
     that is the point: a check-call somebody typed into their own workspace
     must not become a way around a share the carrier never granted. ------- */
  put(SOLO, TRUCK_IDS.cs47, [
    signal({ organizationId: SOLO, truckId: TRUCK_IDS.cs47, transport: "dispatcher_entry", minutesAgo: 34, city: "Olympia", state: "WA", description: "Driver rang in from the Olympia rest area", confidence: 1 }),
  ]);

  /* --- Cascade's own view of the same truck. ----------------------------- */
  put(CS, TRUCK_IDS.cs47, [
    signal({ organizationId: CS, truckId: TRUCK_IDS.cs47, transport: "driver_report", minutesAgo: 41, city: "Olympia", state: "WA", description: "Reported by the driver", confidence: 1 }),
  ]);

  return rows;
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Every position this workspace may read for one truck, oldest first.
 *
 * The ELD gate is applied first and governs every source. Nothing below it can
 * return a position the ELD module would have withheld, and nothing below it
 * can return a coordinate at a precision this membership may not hold.
 */
export function locationSignalsFor(
  ctx: Pick<ServiceContext, "organizationId" | "permissions" | "workspaceKind" | "membershipId" | "actor" | "scope" | "driverProfileId">,
  input: { truckId: string; loadId?: string; sinceAt?: IsoDateTime; scope?: LocationScope },
): LocationSignal[] {
  const scope = input.scope ?? locationScopeFor(ctx, input.truckId);
  if (!scope.scoped) return [];

  const key = inboxKey(ctx.organizationId, input.truckId);
  if (db().muted.has(key)) return [];

  const simulated = (db().rows.get(key) ?? []).map((s) => ({
    ...s,
    precision: scope.precision,
    point: atPrecision(scope.precision, s.point),
  }));

  const merged = [
    ...(scope.eld ? fromEld(scope.eld, scope.precision) : []),
    ...fromFleetTelemetry(ctx.organizationId, input.truckId, scope.precision),
    ...(input.loadId
      ? fromLoadTimeline(ctx.organizationId, input.loadId, input.truckId, scope.precision)
      : []),
    ...simulated,
  ];

  const scoped = merged.filter((s) => !input.sinceAt || s.observedAt >= input.sinceAt);
  return dedupeSignals(scoped).map((s) => ({ ...s, loadId: s.loadId ?? input.loadId }));
}

/** The latest position only, or nothing. Never a stand-in. */
export function latestLocationSignal(
  ctx: Pick<ServiceContext, "organizationId" | "permissions" | "workspaceKind" | "membershipId" | "actor" | "scope" | "driverProfileId">,
  input: { truckId: string; loadId?: string },
): LocationSignal | undefined {
  const all = locationSignalsFor(ctx, input);
  return all[all.length - 1];
}

/**
 * The ETA the Load module last recorded, if any.
 *
 * ★ WHO OWNS THE ETA ★
 *
 * Nobody computes one yet, and this module will not be the first to guess.
 * The division is deliberate and is worth stating where a reader will find it:
 *
 *   ELD & Telematics owns RAW OBSERVATIONS. Its `mt_loop.eta_updated` signal
 *   carries a position and `etaBasis: "not_computed"`, because routing is not
 *   built there and an ETA from a straight line would be planned against.
 *
 *   A future Trip / Route Intelligence module owns the COMPUTED ETA.
 *
 *   Tracking is the CONSUMER. It reads whatever ETA exists, attributes it, and
 *   publishes availability decisions from it.
 *
 * Until that module exists, the ETA is the Load module's own
 * `load.eta_updated` event, and the delivery appointment when there is none.
 * Both are attributed on screen so nobody mistakes either for a calculation.
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
 * Present ONLY on the mock adapter, and named so nobody mistakes it for a feed.
 * It writes into this adapter's own inbox, which means it is still read back
 * through the ELD gate: simulating a position for a truck this workspace has no
 * share on produces nothing, exactly as a real unshared device would.
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
  transport: "eld_telemetry",
  describe(): TrackingSignalSourceDescriptor {
    return signalSourceDescriptor("eld_telemetry")!;
  },
  async positionsFor() {
    // The adapter contract takes no caller, and a position may not be read
    // without one: who may see a truck depends on the workspace asking. A
    // caller with a context uses `locationSignalsFor`; this exists so the
    // registry shape is honoured and refuses rather than leaking.
    return [];
  },
};

/** What is and is not connected, for a screen that has to say so. */
export function trackingSignalSources(): TrackingSignalSourceDescriptor[] {
  return TRACKING_SIGNAL_SOURCES.map((d) => ({ ...d }));
}
