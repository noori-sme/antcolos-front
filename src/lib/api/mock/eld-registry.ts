import type {
  EldBindingEndReason, EldBindingHistoryEntry, EldConnection, EldConnectionState,
  EldDevice, EldDriverBinding, EldPublishedSignal, EldRawPayload, EldShare,
  EldSignalClass, EldTransport, EldVehicleBinding, Provenance, TelemetryAttribution,
  TelemetryEvent, TelemetryIngestionOutcome, TelemetrySignalKind,
} from "@/types";
import {
  adapterFor, deriveConnectionState, dedupeKeyFor, hasAdapter, judgeCandidate,
  publishFor, type DeviceValidationFacts, type NormalizedCandidate, type RawDelivery,
} from "@/lib/eld";
import { carrierProfile } from "./carrier-registry";
import { buildEldFixtures } from "./eld-fixtures";
import { mockStore } from "./store";

/**
 * ███ MOCK ONLY — NOT A BACKEND, NOT A DEVICE, NOT AN ELD ███
 *
 * The store this module owns, and the ingestion pipeline that fills it.
 *
 * Everything here is genuinely new data: no existing Antcolos record knows what
 * a device is, which truck it was bolted to in March, or what the engine said
 * about itself at 04:12. So this file holds providers' deliveries, the events
 * normalized out of them, and the dated bindings that say what each event was
 * about — and it holds NOTHING that already exists. There is no truck here, no
 * trailer, no driver, no load, no carrier, no authority, no maintenance
 * requirement and no compliance record. Those are read, snapshotted onto the
 * event at ingestion, and never written.
 *
 * Four properties this store is built to guarantee, each of which has a test:
 *
 *   IDEMPOTENT      the same delivery, twice, produces the same events once.
 *   APPEND-ONLY     nothing is updated or deleted. A correction is a new row.
 *   PARTITIONED     every read takes an organizationId and there is no accessor
 *                   that can cross one.
 *   NON-DESTRUCTIVE a bad signal is flagged or rejected, and KEPT, alongside the
 *                   raw payload it came from.
 */

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

interface EldState {
  connections: EldConnection[];
  devices: EldDevice[];
  vehicleBindings: EldVehicleBinding[];
  driverBindings: EldDriverBinding[];
  bindingHistory: EldBindingHistoryEntry[];
  rawPayloads: EldRawPayload[];
  events: TelemetryEvent[];
  signals: EldPublishedSignal[];
  shares: EldShare[];
  sequence: number;
}

let state: EldState | null = null;
let idSeq = 0;

const id = (prefix: string) => {
  idSeq += 1;
  return `${prefix}_${idSeq.toString(36).padStart(4, "0")}`;
};

function db(): EldState {
  if (!state) {
    state = {
      connections: [], devices: [], vehicleBindings: [], driverBindings: [],
      bindingHistory: [], rawPayloads: [], events: [], signals: [], shares: [],
      sequence: 0,
    };
    seedFixtures();
  }
  return state;
}

/** Test hook. Never called by the UI. */
export function resetEldRegistry() {
  state = null;
  idSeq = 0;
  db();
}

/** The clock, in one place, so every test can pin it. */
let clock: (() => number) | null = null;

/** Test hook: freeze the module's idea of "now". */
export function setEldClock(fn: (() => number) | null) {
  clock = fn;
}

const nowMs = () => (clock ? clock() : Date.now());
const nowIso = () => new Date(nowMs()).toISOString();

/* -------------------------------------------------------------------------- */
/* Provenance                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Every record this module produces carries one of these, and `mock` is always
 * true. A screen reads it and says so out loud; a test asserts that nothing
 * from here is ever presented as a confirmed human action.
 */
function provenanceFor(input: {
  providerId: string;
  observedAt: string;
  receivedAt: string;
  confidence?: number;
  externalId?: string;
}): Provenance {
  return {
    module: "telematics",
    adapter: `mock:${input.providerId}`,
    mock: true,
    observedAt: input.observedAt,
    receivedAt: input.receivedAt,
    confidence: input.confidence,
    externalId: input.externalId,
  };
}

/* -------------------------------------------------------------------------- */
/* Interval helpers — the whole of the time-bound binding story                */
/* -------------------------------------------------------------------------- */

/**
 * Whether a dated interval covered an instant.
 *
 * Half-open on purpose: `[effectiveFrom, effectiveTo)`. Ending one binding at
 * exactly the moment the next begins must attribute the instant to exactly one
 * of them, and a closed interval on both ends would attribute it to both.
 */
function covers(
  interval: { effectiveFrom: string; effectiveTo?: string },
  atIso: string,
): boolean {
  if (atIso < interval.effectiveFrom) return false;
  return interval.effectiveTo == null || atIso < interval.effectiveTo;
}

/** The vehicle binding in force for a device at an instant. */
export function vehicleBindingAt(
  deviceId: string,
  atIso: string,
  organizationId: string,
): EldVehicleBinding | undefined {
  return db().vehicleBindings.find(
    (b) => b.deviceId === deviceId && b.organizationId === organizationId && covers(b, atIso),
  );
}

/** The driver binding in force for a device at an instant. */
export function driverBindingAt(
  deviceId: string,
  atIso: string,
  organizationId: string,
): EldDriverBinding | undefined {
  return db().driverBindings.find(
    (b) => b.deviceId === deviceId && b.organizationId === organizationId && covers(b, atIso),
  );
}

/* -------------------------------------------------------------------------- */
/* Attribution                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Who and what an event belonged to WHEN IT HAPPENED.
 *
 * Resolved once, at ingestion, and frozen onto the event. Every leg comes from
 * a dated record — the binding intervals above — rather than from "what is true
 * now", which is the difference between a telemetry history that survives a
 * device swap and one that quietly relabels last month.
 *
 * Where a leg cannot be resolved it is left absent and named in `gaps`. Saying
 * "we do not know who was driving" is always available, and always better than
 * reaching for today's driver.
 */
function attributionFor(input: {
  organizationId: string;
  organizationName: string;
  deviceId: string;
  sourceAtIso: string;
}): TelemetryAttribution {
  const gaps: string[] = [];
  const vehicle = vehicleBindingAt(input.deviceId, input.sourceAtIso, input.organizationId);
  const driver = driverBindingAt(input.deviceId, input.sourceAtIso, input.organizationId);

  if (!vehicle) gaps.push("No device-to-truck binding covered this moment.");
  if (!driver) gaps.push("No driver-to-device binding covered this moment.");

  const profile = carrierProfile(input.organizationId);
  if (!profile) {
    gaps.push("No carrier profile is on file, so the operating authority could not be read.");
  }

  const load = vehicle ? loadAt(input.organizationId, vehicle.truckId, input.sourceAtIso) : undefined;
  if (vehicle && !load) gaps.push("No load was running on this truck at that moment.");

  return {
    carrierOrganizationId: input.organizationId,
    carrierNameSnapshot: input.organizationName,
    truckId: vehicle?.truckId,
    truckUnitSnapshot: vehicle?.truckUnitSnapshot,
    driverProfileId: driver?.driverProfileId,
    driverNameSnapshot: driver?.driverNameSnapshot,
    // Read at ingestion, which is as close to event time as this module can
    // honestly get: the dated history of an authority belongs to the Operating
    // Authority module, and this one does not keep a second copy of it.
    operatingAuthorityStatus: profile?.authority.status,
    operatingAuthorityRef: profile
      ? { module: "assignment", externalId: input.organizationId, entityKind: "operating_authority" }
      : undefined,
    loadId: load?.id,
    loadReferenceSnapshot: load?.reference,
    gaps,
    resolvedAt: nowIso(),
  };
}

/**
 * The load running on a truck at an instant.
 *
 * Read from the Load records, never copied into this module. A load whose
 * assignment was created before the event and not removed until after it is the
 * one that was running — which is a dated question, asked of dated data, for
 * the same reason every other leg of attribution is.
 */
function loadAt(organizationId: string, truckId: string, atIso: string) {
  let org;
  try {
    org = mockStore.org(organizationId);
  } catch {
    return undefined;
  }
  return org.loads.find((l) => {
    const a = l.assignment;
    if (!a || a.truckId !== truckId) return false;
    if (a.assignedAt > atIso) return false;
    if (a.endedAt && a.endedAt <= atIso) return false;
    if (l.cancelledAt && l.cancelledAt <= atIso) return false;
    return true;
  });
}

/* -------------------------------------------------------------------------- */
/* Ingestion                                                                   */
/* -------------------------------------------------------------------------- */

export interface IngestInput {
  organizationId: string;
  organizationName: string;
  connectionId: string;
  transport: EldTransport;
  body: Record<string, unknown>;
  externalId?: string;
  /** The shared secret a webhook presented. The mock console sends none. */
  secret?: string;
}

export interface IngestOutput {
  raw: EldRawPayload;
  events: TelemetryEvent[];
  outcomes: TelemetryIngestionOutcome[];
  published: EldPublishedSignal[];
  deliveryRejectedReason?: string;
}

/**
 * The one way data gets into this module.
 *
 * The order is the whole design:
 *
 *   1. STORE THE RAW DELIVERY FIRST, always, before anything can fail. Even a
 *      delivery that is refused outright leaves a row, because "we never got
 *      it" and "we got it and threw it out" are different answers and only one
 *      of them is true.
 *   2. Ask the provider's adapter to translate. It may refuse rows; refusals
 *      come back as data.
 *   3. Judge each candidate against what this device has already told us.
 *   4. Attribute it to the truck, driver, carrier, authority and load that were
 *      in force AT EVENT TIME.
 *   5. Append. Never update, never delete.
 *   6. Publish typed signals for the modules that consume them — accepted rows
 *      only.
 */
export function ingestDelivery(input: IngestInput): IngestOutput {
  const receivedAt = nowIso();
  const connection = db().connections.find(
    (c) => c.id === input.connectionId && c.organizationId === input.organizationId,
  );

  // A delivery for a connection this organization does not hold is stored under
  // the organization that sent it and refused. It is never attached to whoever
  // happens to own that connection id.
  if (!connection) {
    const raw = appendRaw({
      organizationId: input.organizationId,
      providerId: "unknown",
      connectionId: input.connectionId,
      transport: input.transport,
      receivedAt,
      externalId: input.externalId,
      body: input.body,
      signature: "unsigned",
      rejectionReason: "No such connection in this organization.",
    });
    return {
      raw, events: [], outcomes: [], published: [],
      deliveryRejectedReason: raw.rejectionReason,
    };
  }

  if (!hasAdapter(connection.providerId)) {
    const raw = appendRaw({
      organizationId: input.organizationId,
      providerId: connection.providerId,
      connectionId: connection.id,
      transport: input.transport,
      receivedAt,
      externalId: input.externalId,
      body: input.body,
      signature: "unsigned",
      rejectionReason: `No adapter is registered for provider "${connection.providerId}".`,
    });
    return {
      raw, events: [], outcomes: [], published: [],
      deliveryRejectedReason: raw.rejectionReason,
    };
  }

  const adapter = adapterFor(connection.providerId);
  const delivery: RawDelivery = {
    organizationId: input.organizationId,
    providerId: connection.providerId,
    connectionId: connection.id,
    transport: input.transport,
    receivedAt,
    externalId: input.externalId,
    body: input.body,
    secret: input.secret,
  };

  const signature = adapter.verify(delivery);
  const raw = appendRaw({
    organizationId: input.organizationId,
    providerId: connection.providerId,
    connectionId: connection.id,
    transport: input.transport,
    receivedAt,
    externalId: input.externalId,
    body: input.body,
    signature,
    // An invalid signature refuses the delivery — but the body is already on
    // file above, which is exactly what somebody investigating a forged or
    // misconfigured webhook needs to look at.
    rejectionReason: signature === "invalid"
      ? "The delivery's signature did not verify."
      : !adapter.acceptsTransport(input.transport)
        ? `${adapter.describe().name} does not accept deliveries over ${input.transport}.`
        : undefined,
  });

  if (raw.rejectionReason) {
    return { raw, events: [], outcomes: [], published: [], deliveryRejectedReason: raw.rejectionReason };
  }

  const normalization = adapter.normalize(delivery);
  const outcomes: TelemetryIngestionOutcome[] = [];
  const events: TelemetryEvent[] = [];
  const published: EldPublishedSignal[] = [];

  // Fragments that never became events still get an outcome. A delivery that
  // reports three accepted rows and says nothing about the fourth is a delivery
  // nobody can audit.
  for (const u of normalization.unsupported) {
    outcomes.push({
      state: "rejected",
      anomalies: ["unsupported_signal"],
      note: u.reason,
    });
  }
  for (const m of normalization.malformed) {
    outcomes.push({ state: "rejected", anomalies: [], note: m.reason });
  }

  for (const candidate of normalization.candidates) {
    const result = ingestCandidate({
      candidate, connection, raw, input, receivedAt,
    });
    // Appended one at a time, deliberately.
    //
    // A batch that was appended only at the end would not see itself: the
    // second copy of a row inside one delivery would not be a duplicate, and
    // two positions in the same batch could not be measured against each other
    // for an impossible jump. Deduplication and physics have to hold WITHIN a
    // delivery as well as across deliveries, and a provider that sends the same
    // event twice in one payload is not a hypothetical.
    db().events.push(result.event);
    db().signals.push(...result.published);
    events.push(result.event);
    outcomes.push(result.outcome);
    published.push(...result.published);
  }

  raw.producedEvents = events.length;
  touchConnection(connection, events, receivedAt);

  return { raw, events, outcomes, published };
}

function ingestCandidate(args: {
  candidate: NormalizedCandidate;
  connection: EldConnection;
  raw: EldRawPayload;
  input: IngestInput;
  receivedAt: string;
}): { event: TelemetryEvent; outcome: TelemetryIngestionOutcome; published: EldPublishedSignal[] } {
  const { candidate, connection, raw, input, receivedAt } = args;

  const device = db().devices.find(
    (d) => d.organizationId === input.organizationId
      && d.connectionId === connection.id
      && d.externalRef.externalId === candidate.deviceExternalId,
  );

  const provisionalSourceAt = candidate.sourceAt;
  const facts = factsFor({
    organizationId: input.organizationId,
    providerId: connection.providerId,
    deviceId: device?.id,
    atIso: provisionalSourceAt,
    kind: candidate.kind,
  });

  const verdict = judgeCandidate(candidate, facts, nowMs());
  const sourceAt = verdict.sourceAtIso ?? provisionalSourceAt;

  const attribution = device
    ? attributionFor({
      organizationId: input.organizationId,
      organizationName: input.organizationName,
      deviceId: device.id,
      sourceAtIso: sourceAt,
    })
    : {
      carrierOrganizationId: input.organizationId,
      carrierNameSnapshot: input.organizationName,
      gaps: ["The device on this delivery is not registered on this connection."],
      resolvedAt: nowIso(),
    };

  db().sequence += 1;
  const event: TelemetryEvent = {
    id: id("evt"),
    organizationId: input.organizationId,
    providerId: connection.providerId,
    connectionId: connection.id,
    deviceId: device?.id ?? "unregistered",
    rawPayloadId: raw.id,
    kind: candidate.kind,
    value: candidate.value,
    sourceAt,
    receivedAt,
    normalizedAt: nowIso(),
    accuracyMeters: candidate.accuracyMeters,
    // A provider that expresses no confidence is taken at its word, not
    // downgraded: `provider_reported` already says whose word it is.
    confidence: candidate.reportedConfidence ?? 0.9,
    quality: "provider_reported",
    provenance: provenanceFor({
      providerId: connection.providerId,
      observedAt: sourceAt,
      receivedAt,
      confidence: candidate.reportedConfidence,
      externalId: candidate.externalEventId,
    }),
    attribution,
    ingestion: verdict.state,
    anomalies: verdict.anomalies,
    ingestionNote: verdict.note,
    dedupeKey: verdict.dedupeKey,
    sequence: db().sequence,
  };

  const published = device
    ? publishFor(event, {
      includeHos: true,
      previousMotion: facts.previousMotion,
      previousLocation: facts.lastPosition
        ? {
          kind: "location",
          latitude: facts.lastPosition.latitude,
          longitude: facts.lastPosition.longitude,
          city: facts.lastPositionCity,
          state: facts.lastPositionState,
        }
        : undefined,
    })
    : [];

  return {
    event,
    outcome: {
      eventId: event.id,
      kind: event.kind,
      state: event.ingestion,
      anomalies: event.anomalies,
      note: event.ingestionNote,
    },
    published,
  };
}

/** Everything the validator needs to know about a device's past. */
interface RegistryFacts extends DeviceValidationFacts {
  previousMotion?: boolean;
  lastPositionCity?: string;
  lastPositionState?: string;
}

function factsFor(args: {
  organizationId: string;
  providerId: string;
  deviceId?: string;
  atIso: string;
  kind: TelemetrySignalKind;
}): RegistryFacts {
  const { organizationId, providerId, deviceId, atIso } = args;
  const keys = new Set(
    db().events.filter((e) => e.organizationId === organizationId).map((e) => e.dedupeKey),
  );

  if (!deviceId) {
    return {
      providerId,
      deviceKnown: false,
      knownDedupeKeys: keys,
      driverBound: false,
      vehicleBound: false,
    };
  }

  const mine = db().events
    .filter((e) => e.deviceId === deviceId && e.organizationId === organizationId
      && e.ingestion === "accepted")
    .sort((a, b) => (a.sourceAt === b.sourceAt ? a.sequence - b.sequence
      : a.sourceAt.localeCompare(b.sourceAt)));

  const newest = mine[mine.length - 1];
  const lastLocation = [...mine].reverse().find((e) => e.value.kind === "location");
  const lastOdometer = [...mine].reverse().find((e) => e.value.kind === "odometer");
  const lastHours = [...mine].reverse().find((e) => e.value.kind === "engine_hours");
  const lastMotion = [...mine].reverse().find((e) => e.value.kind === "motion");

  const locationValue = lastLocation?.value.kind === "location" ? lastLocation.value : undefined;

  return {
    providerId,
    deviceKnown: true,
    knownDedupeKeys: keys,
    newestAcceptedSourceAt: newest?.sourceAt,
    lastPosition: locationValue
      ? {
        latitude: locationValue.latitude,
        longitude: locationValue.longitude,
        sourceAt: lastLocation!.sourceAt,
      }
      : undefined,
    lastPositionCity: locationValue?.city,
    lastPositionState: locationValue?.state,
    lastOdometerMiles: lastOdometer?.value.kind === "odometer" ? lastOdometer.value.miles : undefined,
    lastEngineHours: lastHours?.value.kind === "engine_hours" ? lastHours.value.hours : undefined,
    previousMotion: lastMotion?.value.kind === "motion" ? lastMotion.value.moving : undefined,
    driverBound: Boolean(driverBindingAt(deviceId, atIso, organizationId)),
    vehicleBound: Boolean(vehicleBindingAt(deviceId, atIso, organizationId)),
  };
}

function appendRaw(input: Omit<EldRawPayload, "id" | "bytes" | "producedEvents">): EldRawPayload {
  const raw: EldRawPayload = {
    ...input,
    id: id("raw"),
    bytes: JSON.stringify(input.body).length,
    producedEvents: 0,
  };
  db().rawPayloads.push(raw);
  return raw;
}

/**
 * Update the link's own liveness after a delivery.
 *
 * The one mutation in this file, and it is deliberately confined to the
 * connection's clock fields. It never touches an event, a raw payload or a
 * binding — those are append-only, and a connection that forgot when it last
 * heard anything would make every freshness answer in the module a lie.
 */
function touchConnection(connection: EldConnection, events: TelemetryEvent[], at: string) {
  connection.lastSyncAt = at;
  const accepted = events.filter((e) => e.ingestion === "accepted");
  if (!accepted.length) return;
  const newest = accepted.reduce((a, b) => (a.sourceAt > b.sourceAt ? a : b));
  if (!connection.lastEventAt || newest.sourceAt > connection.lastEventAt) {
    connection.lastEventAt = newest.sourceAt;
  }
  if (connection.state === "syncing" || connection.state === "connected") {
    connection.state = "connected";
  }
  // Per device, not per delivery: one healthy batch does not make every unit on
  // the account healthy, and a silent device on a busy connection is precisely
  // the thing worth being able to see.
  for (const device of db().devices) {
    if (device.organizationId !== connection.organizationId) continue;
    const mine = accepted.filter((e) => e.deviceId === device.id);
    if (!mine.length) continue;
    const newestForDevice = mine.reduce((a, b) => (a.sourceAt > b.sourceAt ? a : b));
    if (!device.lastEventAt || newestForDevice.sourceAt > device.lastEventAt) {
      device.lastEventAt = newestForDevice.sourceAt;
    }
    if (device.state === "syncing") device.state = "connected";
  }
}

/**
 * What a device is actually doing, as opposed to what its row last recorded.
 *
 * Derived rather than stored for the same reason the connection state is: a
 * device that has not reported for six hours did not update itself to say so.
 * A declared connection state wins — a device on a link somebody disconnected
 * is not "stale", it is off, and nobody should be chased about it.
 */
export function deviceStateOf(
  device: EldDevice, connection: EldConnection | undefined, at = nowMs(),
): { state: EldConnectionState; reason: string } {
  if (device.retiredAt) {
    return { state: "disconnected", reason: device.stateReason ?? "Retired by an operator." };
  }
  if (!connection) {
    return { state: "error", reason: "This device's connection is missing." };
  }
  const link = deriveConnectionState(connection, at);
  if (link.state === "disconnected" || link.state === "error" || link.state === "unsupported") {
    return link;
  }
  if (!device.lastEventAt) {
    return link.state === "syncing"
      ? { state: "syncing", reason: "Registered, and nothing has arrived from it yet." }
      : { state: "offline", reason: "Registered on a live link, and it has never reported." };
  }
  const minutes = Math.max(0, Math.floor((at - Date.parse(device.lastEventAt)) / 60_000));
  const expectation = Math.max(1, connection.freshnessExpectationMinutes);
  if (minutes <= expectation) {
    return { state: "connected", reason: `Last signal ${minutes} minutes ago.` };
  }
  if (minutes <= expectation * 4) {
    return {
      state: "stale",
      reason: `Last signal ${minutes} minutes ago, past the ${expectation}-minute expectation.`,
    };
  }
  return { state: "offline", reason: `Nothing from this device for ${minutes} minutes.` };
}

/* -------------------------------------------------------------------------- */
/* Writes: connections, devices, bindings                                      */
/* -------------------------------------------------------------------------- */

export function registerConnection(input: {
  organizationId: string;
  providerId: string;
  label: string;
  transport: EldTransport;
  freshnessExpectationMinutes: number;
  unsupportedSignals?: readonly TelemetrySignalKind[];
}): EldConnection {
  const at = nowIso();
  const connection: EldConnection = {
    id: id("conn"),
    organizationId: input.organizationId,
    providerId: input.providerId,
    label: input.label,
    // A brand-new link has heard nothing yet, and "connected" would be a claim
    // about data that has not arrived. It syncs until something does.
    state: "syncing",
    transport: input.transport,
    freshnessExpectationMinutes: input.freshnessExpectationMinutes,
    connectedAt: at,
    unsupportedSignals: input.unsupportedSignals,
    provenance: provenanceFor({ providerId: input.providerId, observedAt: at, receivedAt: at }),
  };
  db().connections.push(connection);
  return connection;
}

export function disconnectConnection(
  connectionId: string,
  organizationId: string,
  reason: string,
): EldConnection | undefined {
  const connection = db().connections.find(
    (c) => c.id === connectionId && c.organizationId === organizationId,
  );
  if (!connection) return undefined;
  connection.state = "disconnected";
  connection.disconnectedAt = nowIso();
  connection.disconnectedReason = reason;
  // Live bindings on this link's devices are closed, not deleted: the intervals
  // stay, with a reason, so every event already attributed to them still reads.
  for (const device of db().devices.filter((d) => d.connectionId === connectionId)) {
    closeBindingsForDevice(device.id, organizationId, "connection_disconnected", {
      membershipId: "system", name: "Antcolos",
    });
  }
  return connection;
}

export function registerDevice(input: {
  organizationId: string;
  connectionId: string;
  serialNumber: string;
  kind: EldDevice["kind"];
  externalId: string;
  model?: string;
  firmware?: string;
}): EldDevice {
  const connection = db().connections.find(
    (c) => c.id === input.connectionId && c.organizationId === input.organizationId,
  );
  if (!connection) throw new Error("No such connection in this organization.");
  const at = nowIso();
  const device: EldDevice = {
    id: id("dev"),
    organizationId: input.organizationId,
    connectionId: connection.id,
    providerId: connection.providerId,
    externalRef: {
      module: "telematics",
      externalId: input.externalId,
      entityKind: "device",
    },
    serialNumber: input.serialNumber,
    kind: input.kind,
    model: input.model,
    firmware: input.firmware,
    state: "syncing",
    registeredAt: at,
    provenance: provenanceFor({ providerId: connection.providerId, observedAt: at, receivedAt: at }),
  };
  db().devices.push(device);
  return device;
}

export interface BindActor { membershipId: string; name: string }

/**
 * Bind a device to a truck from a moment.
 *
 * Any binding already live for this device is CLOSED at the new interval's
 * start, not replaced: the old row keeps its dates, keeps its reason, and every
 * event that cites it still resolves. That is what makes "a binding change must
 * never rewrite historical telemetry" true by construction rather than by
 * discipline.
 */
export function bindDeviceToTruck(input: {
  organizationId: string;
  deviceId: string;
  truckId: string;
  truckUnit: string;
  effectiveFrom?: string;
  note?: string;
}, actor: BindActor): EldVehicleBinding {
  const from = input.effectiveFrom ?? nowIso();
  const device = db().devices.find(
    (d) => d.id === input.deviceId && d.organizationId === input.organizationId,
  );
  if (!device) throw new Error("No such device in this organization.");

  for (const live of db().vehicleBindings.filter(
    (b) => b.deviceId === input.deviceId && b.organizationId === input.organizationId && !b.effectiveTo,
  )) {
    closeVehicleBinding(live, from, "superseded", actor);
  }

  const binding: EldVehicleBinding = {
    id: id("vbind"),
    organizationId: input.organizationId,
    deviceId: input.deviceId,
    truckId: input.truckId,
    truckUnitSnapshot: input.truckUnit,
    effectiveFrom: from,
    createdByMembershipId: actor.membershipId,
    createdByName: actor.name,
    createdAt: nowIso(),
    note: input.note,
  };
  db().vehicleBindings.push(binding);
  appendBindingHistory(binding.id, "vehicle", "bound", input.organizationId, actor,
    `Device bound to unit ${input.truckUnit} from ${from}.`);
  return binding;
}

export function bindDriverToDevice(input: {
  organizationId: string;
  deviceId: string;
  driverProfileId: string;
  driverName: string;
  effectiveFrom?: string;
  note?: string;
}, actor: BindActor): EldDriverBinding {
  const from = input.effectiveFrom ?? nowIso();
  const device = db().devices.find(
    (d) => d.id === input.deviceId && d.organizationId === input.organizationId,
  );
  if (!device) throw new Error("No such device in this organization.");

  for (const live of db().driverBindings.filter(
    (b) => b.deviceId === input.deviceId && b.organizationId === input.organizationId && !b.effectiveTo,
  )) {
    closeDriverBinding(live, from, "superseded", actor);
  }

  const binding: EldDriverBinding = {
    id: id("dbind"),
    organizationId: input.organizationId,
    deviceId: input.deviceId,
    driverProfileId: input.driverProfileId,
    driverNameSnapshot: input.driverName,
    effectiveFrom: from,
    createdByMembershipId: actor.membershipId,
    createdByName: actor.name,
    createdAt: nowIso(),
    note: input.note,
  };
  db().driverBindings.push(binding);
  appendBindingHistory(binding.id, "driver", "bound", input.organizationId, actor,
    `${input.driverName} bound to this device from ${from}.`);
  return binding;
}

export function endVehicleBinding(
  bindingId: string,
  organizationId: string,
  reason: EldBindingEndReason,
  actor: BindActor,
  atIso?: string,
): EldVehicleBinding | undefined {
  const binding = db().vehicleBindings.find(
    (b) => b.id === bindingId && b.organizationId === organizationId,
  );
  if (!binding || binding.effectiveTo) return undefined;
  closeVehicleBinding(binding, atIso ?? nowIso(), reason, actor);
  return binding;
}

export function endDriverBinding(
  bindingId: string,
  organizationId: string,
  reason: EldBindingEndReason,
  actor: BindActor,
  atIso?: string,
): EldDriverBinding | undefined {
  const binding = db().driverBindings.find(
    (b) => b.id === bindingId && b.organizationId === organizationId,
  );
  if (!binding || binding.effectiveTo) return undefined;
  closeDriverBinding(binding, atIso ?? nowIso(), reason, actor);
  return binding;
}

function closeVehicleBinding(
  binding: EldVehicleBinding, at: string, reason: EldBindingEndReason, actor: BindActor,
) {
  binding.effectiveTo = at;
  binding.endReason = reason;
  appendBindingHistory(binding.id, "vehicle", "ended", binding.organizationId, actor,
    `Binding to unit ${binding.truckUnitSnapshot} ended at ${at}.`);
}

function closeDriverBinding(
  binding: EldDriverBinding, at: string, reason: EldBindingEndReason, actor: BindActor,
) {
  binding.effectiveTo = at;
  binding.endReason = reason;
  appendBindingHistory(binding.id, "driver", "ended", binding.organizationId, actor,
    `${binding.driverNameSnapshot} unbound from this device at ${at}.`);
}

function closeBindingsForDevice(
  deviceId: string, organizationId: string, reason: EldBindingEndReason, actor: BindActor,
) {
  const at = nowIso();
  for (const b of db().vehicleBindings.filter(
    (x) => x.deviceId === deviceId && x.organizationId === organizationId && !x.effectiveTo,
  )) closeVehicleBinding(b, at, reason, actor);
  for (const b of db().driverBindings.filter(
    (x) => x.deviceId === deviceId && x.organizationId === organizationId && !x.effectiveTo,
  )) closeDriverBinding(b, at, reason, actor);
}

function appendBindingHistory(
  bindingId: string,
  bindingKind: "vehicle" | "driver",
  action: EldBindingHistoryEntry["action"],
  organizationId: string,
  actor: BindActor,
  detail: string,
) {
  db().bindingHistory.push({
    id: id("bh"),
    organizationId,
    bindingId,
    bindingKind,
    action,
    at: nowIso(),
    actorMembershipId: actor.membershipId,
    actorName: actor.name,
    detail,
  });
}

export function retireDevice(
  deviceId: string, organizationId: string, actor: BindActor,
): EldDevice | undefined {
  const device = db().devices.find(
    (d) => d.id === deviceId && d.organizationId === organizationId,
  );
  if (!device) return undefined;
  device.retiredAt = nowIso();
  device.state = "disconnected";
  device.stateReason = "Retired by an operator.";
  closeBindingsForDevice(deviceId, organizationId, "device_retired", actor);
  return device;
}

/* -------------------------------------------------------------------------- */
/* Reads — every one of them takes an organizationId                           */
/* -------------------------------------------------------------------------- */

export const listConnections = (organizationId: string): EldConnection[] =>
  db().connections.filter((c) => c.organizationId === organizationId).map((c) => ({ ...c }));

export const listDevices = (organizationId: string): EldDevice[] =>
  db().devices.filter((d) => d.organizationId === organizationId).map((d) => ({ ...d }));

export const listVehicleBindings = (organizationId: string, deviceId?: string): EldVehicleBinding[] =>
  db().vehicleBindings
    .filter((b) => b.organizationId === organizationId && (!deviceId || b.deviceId === deviceId))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
    .map((b) => ({ ...b }));

export const listDriverBindings = (organizationId: string, deviceId?: string): EldDriverBinding[] =>
  db().driverBindings
    .filter((b) => b.organizationId === organizationId && (!deviceId || b.deviceId === deviceId))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
    .map((b) => ({ ...b }));

export const listBindingHistory = (
  organizationId: string, bindingIds?: readonly string[],
): EldBindingHistoryEntry[] =>
  db().bindingHistory
    .filter((h) => h.organizationId === organizationId
      && (!bindingIds || bindingIds.includes(h.bindingId)))
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((h) => ({ ...h }));

export const listRawPayloads = (organizationId: string, limit = 50): EldRawPayload[] =>
  db().rawPayloads
    .filter((r) => r.organizationId === organizationId)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    .slice(0, limit)
    .map((r) => ({ ...r }));

export const findRawPayload = (
  organizationId: string, rawPayloadId: string,
): EldRawPayload | undefined => {
  const row = db().rawPayloads.find(
    (r) => r.id === rawPayloadId && r.organizationId === organizationId,
  );
  return row ? { ...row } : undefined;
};

export interface EventQuery {
  deviceId?: string;
  truckId?: string;
  driverProfileId?: string;
  kinds?: readonly TelemetrySignalKind[];
  ingestion?: readonly TelemetryEvent["ingestion"][];
  sinceIso?: string;
  limit?: number;
}

export function listEvents(organizationId: string, query: EventQuery = {}): TelemetryEvent[] {
  return db().events
    .filter((e) => {
      if (e.organizationId !== organizationId) return false;
      if (query.deviceId && e.deviceId !== query.deviceId) return false;
      if (query.truckId && e.attribution.truckId !== query.truckId) return false;
      if (query.driverProfileId && e.attribution.driverProfileId !== query.driverProfileId) return false;
      if (query.kinds && !query.kinds.includes(e.kind)) return false;
      if (query.ingestion && !query.ingestion.includes(e.ingestion)) return false;
      if (query.sinceIso && e.sourceAt < query.sinceIso) return false;
      return true;
    })
    .sort((a, b) => (b.sourceAt === a.sourceAt ? b.sequence - a.sequence
      : b.sourceAt.localeCompare(a.sourceAt)))
    .slice(0, query.limit ?? 200)
    .map((e) => ({ ...e }));
}

export const listSignals = (organizationId: string, limit = 100): EldPublishedSignal[] =>
  db().signals
    .filter((s) => s.organizationId === organizationId)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, limit);

export function appendSignal(signal: EldPublishedSignal) {
  db().signals.push(signal);
}

export const connectionStateOf = (connection: EldConnection): EldConnectionState =>
  deriveConnectionState(connection, nowMs()).state;

export const connectionReasonOf = (connection: EldConnection): string =>
  deriveConnectionState(connection, nowMs()).reason;

/* -------------------------------------------------------------------------- */
/* Sharing with dispatch workspaces                                            */
/* -------------------------------------------------------------------------- */

export function listShares(input: {
  ownerOrganizationId?: string;
  viewerOrganizationId?: string;
}): EldShare[] {
  return db().shares
    .filter((s) => {
      if (s.revokedAt) return false;
      if (input.ownerOrganizationId && s.ownerOrganizationId !== input.ownerOrganizationId) return false;
      if (input.viewerOrganizationId && s.viewerOrganizationId !== input.viewerOrganizationId) return false;
      return true;
    })
    .map((s) => ({ ...s }));
}

/**
 * What a dispatch workspace may see of one truck, if anything.
 *
 * The default is nothing. A dispatch organization or an individual dispatcher
 * holds no telemetry access by being assigned work — the carrier has to have
 * granted it, for that truck, in those signal classes, and not revoked it.
 */
export function sharedClassesFor(
  viewerOrganizationId: string, truckId: string,
): EldSignalClass[] {
  const classes = new Set<EldSignalClass>();
  for (const share of liveSharesFor(viewerOrganizationId, truckId)) {
    for (const c of share.signalClasses) classes.add(c);
  }
  return [...classes];
}

/** Every unrevoked grant from any carrier to this viewer for this truck. */
function liveSharesFor(viewerOrganizationId: string, truckId: string): EldShare[] {
  return db().shares.filter(
    (share) => !share.revokedAt
      && share.viewerOrganizationId === viewerOrganizationId
      && share.truckId === truckId,
  );
}

/**
 * Whether this viewer may hold exact coordinates for THIS truck.
 *
 * Scoped to the one truck, never to the relationship: a carrier that shares
 * two trucks and withholds precision on one of them gets exactly that, and a
 * viewer granted precision on truck A learns nothing more about truck B.
 *
 * `false` when nothing is shared at all, which is the same answer a withheld
 * grant gives — a caller with no share has no business distinguishing "not
 * shared" from "shared without precision".
 */
export function precisePositionSharedFor(
  viewerOrganizationId: string, truckId: string,
): boolean {
  const shares = liveSharesFor(viewerOrganizationId, truckId);
  if (shares.length === 0) return false;
  // Any live grant carrying it is enough; a carrier that changes its mind
  // revokes or re-grants rather than leaving two contradictory rows standing.
  return shares.some((share) => share.precisePosition);
}

export function grantShare(input: {
  ownerOrganizationId: string;
  viewerOrganizationId: string;
  truckId: string;
  signalClasses: readonly EldSignalClass[];
  grantedByMembershipId: string;
  /**
   * Defaults to true when position is shared: a dispatcher covering a truck
   * needs to know how far out it is. The carrier withholds it by passing
   * `false`, and withholding leaves the viewer a city and a state.
   */
  precisePosition?: boolean;
  note?: string;
}): EldShare {
  const sharesPosition = input.signalClasses.includes("position");
  const share: EldShare = {
    id: id("share"),
    ownerOrganizationId: input.ownerOrganizationId,
    viewerOrganizationId: input.viewerOrganizationId,
    truckId: input.truckId,
    signalClasses: [...input.signalClasses],
    // Precision is meaningless without position, so it can never be granted
    // on its own — a share of meters alone carries no coordinates to withhold.
    precisePosition: sharesPosition && (input.precisePosition ?? true),
    grantedAt: nowIso(),
    grantedByMembershipId: input.grantedByMembershipId,
    note: input.note,
  };
  db().shares.push(share);
  return share;
}

export function revokeShare(shareId: string, ownerOrganizationId: string): EldShare | undefined {
  const share = db().shares.find(
    (s) => s.id === shareId && s.ownerOrganizationId === ownerOrganizationId,
  );
  if (!share || share.revokedAt) return undefined;
  share.revokedAt = nowIso();
  return share;
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The fixtures are DATA, in a sibling module, and they are applied through the
 * same write functions the app uses.
 *
 * That is worth being deliberate about. A seeder that hand-built event rows
 * would produce a store the pipeline had never seen — every anomaly in it would
 * be one somebody typed rather than one the validator found, and the first real
 * delivery would behave differently from everything already on screen. Feeding
 * fixture deliveries through `ingestDelivery` means the seeded duplicate really
 * was caught as a duplicate, and the seeded impossible jump really was measured.
 */
function setConnectionState(
  connectionId: string, organizationId: string,
  state: EldConnectionState, reason: string,
  unsupported?: readonly TelemetrySignalKind[],
) {
  const connection = db().connections.find(
    (c) => c.id === connectionId && c.organizationId === organizationId,
  );
  if (!connection) return;
  connection.state = state;
  connection.stateReason = reason;
  if (state === "disconnected") {
    connection.disconnectedAt = nowIso();
    connection.disconnectedReason = reason;
  }
  if (unsupported) connection.unsupportedSignals = unsupported;
}

function seedFixtures() {
  const at = nowMs();
  for (const org of buildEldFixtures(at)) {
    for (const c of org.connections) {
      const connection = registerConnection({
        organizationId: org.organizationId,
        providerId: c.providerId,
        label: c.label,
        transport: c.transport,
        freshnessExpectationMinutes: c.freshnessExpectationMinutes,
      });
      const deviceIds = new Map<string, string>();
      for (const d of c.devices) {
        const device = registerDevice({
          organizationId: org.organizationId,
          connectionId: connection.id,
          serialNumber: d.serialNumber,
          kind: d.kind,
          externalId: d.externalId,
          model: d.model,
          firmware: d.firmware,
        });
        deviceIds.set(d.externalId, device.id);
        for (const b of d.vehicleBindings) {
          const binding = bindDeviceToTruck({
            organizationId: org.organizationId,
            deviceId: device.id,
            truckId: b.truckId,
            truckUnit: b.truckUnit,
            effectiveFrom: b.effectiveFrom,
            note: b.note,
          }, SEED_ACTOR);
          if (b.effectiveTo) {
            endVehicleBinding(binding.id, org.organizationId,
              b.endReason ?? "unbound", SEED_ACTOR, b.effectiveTo);
          }
        }
        for (const b of d.driverBindings) {
          const binding = bindDriverToDevice({
            organizationId: org.organizationId,
            deviceId: device.id,
            driverProfileId: b.driverProfileId,
            driverName: b.driverName,
            effectiveFrom: b.effectiveFrom,
            note: b.note,
          }, SEED_ACTOR);
          if (b.effectiveTo) {
            endDriverBinding(binding.id, org.organizationId,
              b.endReason ?? "unbound", SEED_ACTOR, b.effectiveTo);
          }
        }
      }
      for (const delivery of c.deliveries) {
        ingestDelivery({
          organizationId: org.organizationId,
          organizationName: org.organizationName,
          connectionId: connection.id,
          transport: delivery.transport ?? c.transport,
          body: delivery.body,
          externalId: delivery.externalId,
        });
      }
      // Applied last, so a deliberately broken link is not healed by the
      // deliveries that were seeded through it.
      if (c.finalState) {
        setConnectionState(connection.id, org.organizationId,
          c.finalState.state, c.finalState.reason, c.finalState.unsupportedSignals);
      }
    }
    for (const share of org.shares) {
      grantShare({
        ownerOrganizationId: org.organizationId,
        viewerOrganizationId: share.viewerOrganizationId,
        truckId: share.truckId,
        signalClasses: share.signalClasses,
        precisePosition: share.precisePosition,
        grantedByMembershipId: SEED_ACTOR.membershipId,
        note: share.note,
      });
    }
  }
}

const SEED_ACTOR: BindActor = { membershipId: "mem_seed", name: "Antcolos setup" };

/** True while the module runs on mock providers. Always, in this build. */
export const ELD_IS_MOCKED = true;

/** The raw payload store, exposed only for the labelled developer console. */
export const rawPayloadCount = (organizationId: string): number =>
  db().rawPayloads.filter((r) => r.organizationId === organizationId).length;

export { covers as intervalCovers, dedupeKeyFor };
