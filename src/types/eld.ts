import type { IsoDateTime } from "./common";
import type { ExternalRef, IdempotencyKey, Provenance } from "./integration";
import type { PermissionKey } from "./permission";

/**
 * ★ ELD & TELEMATICS — THE FOUNDATION ★
 *
 * Antcolos already holds the permanent records: the Truck, the Trailer, the
 * Driver, the Assignment, the Operating Authority, the Fleet layer, the Trip
 * Workflow, Maintenance, Fuel/IFTA, Compliance, Permissions, the Audit trail
 * and the Needs You queue. None of them is recreated here, and none of them is
 * written to from here.
 *
 * What was missing is the layer BELOW all of them: the machine that says where
 * a truck is, how fast, how far, how many hours, whether the key is on, what
 * the engine is complaining about and how much clock a driver has left. This
 * file is that layer's vocabulary.
 *
 * Five rules the types themselves enforce, so a mistake is a compile error
 * rather than a bad screen:
 *
 *  1. RAW IS NOT NORMALIZED. `EldRawPayload` holds exactly what a provider
 *     sent, untouched. `TelemetryEvent` is Antcolos's own normalized record,
 *     and it always points back at the raw row it came from.
 *  2. EVERY SIGNAL CARRIES ITS PAPERS. Source time, received time, provider,
 *     accuracy, confidence and provenance are required on the event, not
 *     optional decoration — because a position with no accuracy and no clock is
 *     not evidence of anything.
 *  3. INFERRED IS NEVER CONFIRMED. `TelemetryDataQuality` keeps "Confirmed",
 *     "Provider reported", "Inferred", "Corrected" and "Missing" apart, and no
 *     value in this module may be shown without one.
 *  4. HISTORY IS IMMUTABLE. Bindings are time-bound intervals that close, never
 *     rows that are edited. Re-binding a device tomorrow does not change who
 *     the truck belonged to yesterday, because attribution is snapshotted onto
 *     every event AT EVENT TIME.
 *  5. NOTHING PRETENDS. Every provider in this build is a mock, says so in its
 *     type (`mock: true`), says so at runtime and says so on screen. No ELD,
 *     GPS receiver, vehicle, FMCSA system or compliance service is connected.
 */

/* -------------------------------------------------------------------------- */
/* 1. Providers                                                                */
/* -------------------------------------------------------------------------- */

/** What a provider is, in the shape of the data it produces. */
export type EldProviderKind =
  /** Hours of service and driver logs. */
  | "eld"
  /** Vehicle position, meters and faults. */
  | "telematics"
  /** Both, from one account. */
  | "hybrid";

/** How data arrives from a provider. Each has its own boundary in this module. */
export type EldTransport =
  /** The provider POSTs to us. Idempotency is the provider's key plus ours. */
  | "webhook"
  /** We fetch on a schedule. */
  | "poll"
  /** A person uploads a file the provider exported. */
  | "import"
  /** A developer pushed one by hand, through the labelled mock console. */
  | "simulated";

/**
 * The normalized signal vocabulary.
 *
 * Deliberately narrow and deliberately flat: a provider that reports twenty
 * proprietary fields is normalized into these, and what it reports that does
 * not map is kept on the raw payload rather than smuggled in as a made-up kind.
 */
export type TelemetrySignalKind =
  | "location"
  | "speed"
  | "heading"
  | "odometer"
  | "engine_hours"
  | "ignition"
  | "motion"
  | "fuel_level"
  | "diagnostic"
  | "hos_summary";

/**
 * Signal classes, for sharing and permission decisions.
 *
 * Coarser than the signal kind on purpose. A carrier sharing "where is my
 * truck" with a dispatch agency is a different decision from sharing "what is
 * this engine complaining about" or "how much clock has this person got left",
 * and the class is the unit that decision is made in.
 */
export type EldSignalClass =
  /** Position, speed, heading, motion, ignition. */
  | "position"
  /** Odometer, engine hours, fuel level. */
  | "meters"
  /** Fault and diagnostic codes. */
  | "diagnostics"
  /** Hours-of-service availability summaries. Personal to the driver. */
  | "hos";

export const SIGNAL_CLASS_OF: Record<TelemetrySignalKind, EldSignalClass> = {
  location: "position",
  speed: "position",
  heading: "position",
  ignition: "position",
  motion: "position",
  odometer: "meters",
  engine_hours: "meters",
  fuel_level: "meters",
  diagnostic: "diagnostics",
  hos_summary: "hos",
};

/**
 * A provider Antcolos knows how to speak to.
 *
 * `mock` is `true` for every provider in this build and the type says so: the
 * field is the literal `true`, not `boolean`, so a fixture cannot quietly claim
 * to be a live integration. When a real provider is built it changes this type,
 * which forces every screen that reads it to be looked at again.
 */
export interface EldProvider {
  id: string;
  /** Shown to operators. Always carries the word "Mock" in this build. */
  name: string;
  kind: EldProviderKind;
  /** Always true here. Real adapters will widen this to `boolean`. */
  mock: true;
  /** One line, in an operator's words, about what this provider would give. */
  description: string;
  /** Signal kinds this provider's adapter can normalize. */
  supports: readonly TelemetrySignalKind[];
  /** Transports the adapter accepts. An import-only provider has no webhook. */
  transports: readonly EldTransport[];
  /** Whether the provider stamps its own event ids — the idempotency anchor. */
  emitsExternalIds: boolean;
}

/* -------------------------------------------------------------------------- */
/* 2. Connections                                                              */
/* -------------------------------------------------------------------------- */

/**
 * What a link to a provider is doing, right now.
 *
 * Seven states, and the distinctions between them are the ones an operator
 * actually acts on differently:
 *
 *   connected    healthy, fresh data arriving
 *   syncing      a backfill or first sync is in flight; gaps are expected
 *   stale        still linked, but nothing has arrived inside the expectation
 *   offline      the device is not reporting — usually ignition off, no signal
 *   disconnected somebody took the link down on purpose. Not a fault.
 *   error        the provider or the adapter refused. Carries the reason.
 *   unsupported  the provider cannot give what was asked of it at all.
 */
export type EldConnectionState =
  | "connected"
  | "syncing"
  | "stale"
  | "offline"
  | "disconnected"
  | "error"
  | "unsupported";

/** States in which data is expected to keep arriving. */
export const HEALTHY_CONNECTION_STATES: readonly EldConnectionState[] = [
  "connected", "syncing",
] as const;

/**
 * One organization's link to one provider.
 *
 * Organization-scoped, always: a connection belongs to the carrier that made
 * it, and no other organization can read it, list it or bind a device through
 * it. There is no global connection and no shared account.
 */
export interface EldConnection {
  id: string;
  organizationId: string;
  providerId: string;
  /** What the operator called it — "Mock ELD — main yard account". */
  label: string;
  state: EldConnectionState;
  /**
   * How data comes in on this link. Reads honestly: an `import` connection is
   * not "offline" when nobody has uploaded a file, it is simply an import.
   */
  transport: EldTransport;
  /**
   * How fresh this link's data is expected to be, in minutes.
   *
   * Beyond it the connection is derived as `stale`. Stored per connection
   * because a webhook link and a nightly import have wildly different honest
   * expectations, and one global number would libel the slower of the two.
   */
  freshnessExpectationMinutes: number;
  connectedAt: IsoDateTime;
  /** Last time the link itself did anything — a poll, a webhook, an upload. */
  lastSyncAt?: IsoDateTime;
  /** Last time a normalized event actually came out of it. */
  lastEventAt?: IsoDateTime;
  /** Set when `state` is "error" or "unsupported". Always populated for those. */
  stateReason?: string;
  disconnectedAt?: IsoDateTime;
  disconnectedReason?: string;
  /**
   * Signal kinds this connection was asked for but the provider cannot serve.
   * Kept rather than dropped so a screen can say WHAT is unsupported.
   */
  unsupportedSignals?: readonly TelemetrySignalKind[];
  /** Never absent, and `mock` is always true in this build. */
  provenance: Provenance;
}

/* -------------------------------------------------------------------------- */
/* 3. Devices                                                                  */
/* -------------------------------------------------------------------------- */

export type EldDeviceKind =
  /** Plugged into the diagnostic port. */
  | "obd_dongle"
  /** Hard-wired telematics unit. */
  | "hardwired_gateway"
  /** Trailer tracker, battery or line powered. */
  | "asset_tracker"
  /** The driver's phone, running the provider's app. */
  | "mobile_app";

/**
 * A physical (well — mock) unit reporting through a connection.
 *
 * The device is the thing telemetry actually comes from. It is NOT the truck:
 * a device moves between trucks, is swapped when it fails, and spends time in a
 * drawer bound to nothing. That is exactly why bindings are dated intervals and
 * why an event records the truck it was bound to when it fired, rather than
 * asking the device what truck it is on today.
 */
export interface EldDevice {
  id: string;
  organizationId: string;
  connectionId: string;
  providerId: string;
  /** The provider's own identifier for the unit. Kept verbatim. */
  externalRef: ExternalRef;
  serialNumber: string;
  kind: EldDeviceKind;
  model?: string;
  firmware?: string;
  /**
   * Whether the device itself is reporting. Distinct from its connection's
   * state: a healthy connection can carry one silent device.
   */
  state: EldConnectionState;
  stateReason?: string;
  registeredAt: IsoDateTime;
  lastEventAt?: IsoDateTime;
  retiredAt?: IsoDateTime;
  provenance: Provenance;
}

/* -------------------------------------------------------------------------- */
/* 4. Bindings — time-bound, closed, never rewritten                           */
/* -------------------------------------------------------------------------- */

/** Why a binding interval ended. "superseded" means a newer binding replaced it. */
export type EldBindingEndReason =
  | "unbound"
  | "superseded"
  | "device_retired"
  | "connection_disconnected"
  | "correction";

/**
 * A dated interval during which one device reported for one truck.
 *
 * Closed, never deleted and never edited in place. Ending one sets
 * `effectiveTo` and appends a history entry; the row stays exactly as it was,
 * because every event already attributed to it must stay explicable.
 */
export interface EldVehicleBinding {
  id: string;
  organizationId: string;
  deviceId: string;
  /** The permanent Truck id. This module never creates a Truck. */
  truckId: string;
  /**
   * The truck's unit number as it read when the binding was made.
   *
   * Snapshotted, exactly like `ActorRef.displayNameSnapshot` elsewhere in
   * Antcolos: renaming a unit next year must not silently rewrite what a
   * two-year-old event says it was about.
   */
  truckUnitSnapshot: string;
  effectiveFrom: IsoDateTime;
  /** Absent while live. Set once, when the interval closes. */
  effectiveTo?: IsoDateTime;
  endReason?: EldBindingEndReason;
  createdByMembershipId: string;
  createdByName: string;
  createdAt: IsoDateTime;
  note?: string;
}

/** A dated interval during which one driver was the operator of one device. */
export interface EldDriverBinding {
  id: string;
  organizationId: string;
  deviceId: string;
  /** The permanent Driver profile id. This module never creates a Driver. */
  driverProfileId: string;
  /** The driver's name as it read when the binding was made. Snapshotted. */
  driverNameSnapshot: string;
  effectiveFrom: IsoDateTime;
  effectiveTo?: IsoDateTime;
  endReason?: EldBindingEndReason;
  createdByMembershipId: string;
  createdByName: string;
  createdAt: IsoDateTime;
  note?: string;
}

export type EldBindingAction = "bound" | "ended" | "corrected";

/**
 * The immutable audit of binding changes.
 *
 * Separate from the binding rows themselves so that even a correction — the one
 * operation that revises what a binding claimed — leaves both the original
 * claim and the correction standing. Nothing in this module deletes a row.
 */
export interface EldBindingHistoryEntry {
  id: string;
  organizationId: string;
  bindingId: string;
  bindingKind: "vehicle" | "driver";
  action: EldBindingAction;
  at: IsoDateTime;
  actorMembershipId: string;
  actorName: string;
  /** What changed, in the operator's words. Never a diff of internal fields. */
  detail: string;
}

/* -------------------------------------------------------------------------- */
/* 5. Raw provider payloads                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Exactly what the provider sent, kept apart from anything Antcolos made of it.
 *
 * This is the evidence. Normalization is an opinion about the evidence, and the
 * two are never stored in the same record — so a normalization bug is
 * re-runnable rather than a permanent loss, and a dispute can be settled by
 * looking at what actually arrived.
 */
export interface EldRawPayload {
  id: string;
  organizationId: string;
  providerId: string;
  connectionId: string;
  transport: EldTransport;
  /** When Antcolos received it. The only clock Antcolos can vouch for. */
  receivedAt: IsoDateTime;
  /** The provider's own id for the delivery, when it stamps one. */
  externalId?: string;
  /** The body, verbatim and unparsed by anything but the adapter. */
  body: Record<string, unknown>;
  /** Byte size as received, for the boundary's own diagnostics. */
  bytes: number;
  /**
   * Whether the delivery's signature verified.
   *
   * "unsigned" is honest and common — the mock console does not sign. It is not
   * dressed up as "verified".
   */
  signature: "verified" | "unsigned" | "invalid";
  /** Number of normalized events this delivery produced. May be zero. */
  producedEvents: number;
  /** Populated when the delivery as a whole was refused. */
  rejectionReason?: string;
}

/* -------------------------------------------------------------------------- */
/* 6. Data quality — the distinction the whole module turns on                 */
/* -------------------------------------------------------------------------- */

/**
 * How much Antcolos is willing to stand behind a value.
 *
 * This is the most important type in the file. A GPS position that puts a truck
 * inside a receiver's fence is NOT a driver saying they arrived, and the
 * product must never let the two be confused — not in a screen, not in a
 * downstream module, not in a report.
 *
 *   confirmed         a person in Antcolos asserted it, or confirmed the
 *                     machine's suggestion. Only ever set by a human act.
 *   provider_reported the provider said it. Faithfully normalized, not judged.
 *   inferred          Antcolos worked it out from signals. Always carries the
 *                     rationale and a confidence, and never reads as an action.
 *   corrected         a person overrode an earlier value. The earlier one is
 *                     kept; this is the one in force.
 *   missing           nobody has said. A first-class answer, never a zero.
 */
export type TelemetryDataQuality =
  | "confirmed"
  | "provider_reported"
  | "inferred"
  | "corrected"
  | "missing";

/** The qualities a machine may produce on its own. A human act is required for the rest. */
export const MACHINE_QUALITIES: readonly TelemetryDataQuality[] = [
  "provider_reported", "inferred",
] as const;

/* -------------------------------------------------------------------------- */
/* 7. Measurements                                                             */
/* -------------------------------------------------------------------------- */

export interface TelemetryLocationValue {
  kind: "location";
  latitude: number;
  longitude: number;
  /** Reverse-geocoded by the provider, when it offers one. Never invented. */
  city?: string;
  state?: string;
  description?: string;
}

/**
 * A position as a given viewer is allowed to see it.
 *
 * A DIFFERENT TYPE from `TelemetryLocationValue` on purpose. The event always
 * holds real coordinates; what a viewer gets may not. Modelling the reduced
 * form as the same type with nullable fields would mean every screen had to
 * remember that a missing latitude might be a privacy decision rather than a
 * provider that sent nothing — so the reduced form says which, in `precise`.
 */
export interface SnapshotLocationValue {
  kind: "location";
  latitude?: number;
  longitude?: number;
  city?: string;
  state?: string;
  description?: string;
  /** False when exact coordinates were withheld. The city is still true. */
  precise: boolean;
}

export interface TelemetrySpeedValue { kind: "speed"; milesPerHour: number }
export interface TelemetryHeadingValue { kind: "heading"; degrees: number }
export interface TelemetryOdometerValue { kind: "odometer"; miles: number }
export interface TelemetryEngineHoursValue { kind: "engine_hours"; hours: number }
export interface TelemetryIgnitionValue { kind: "ignition"; on: boolean }
export interface TelemetryMotionValue { kind: "motion"; moving: boolean }
export interface TelemetryFuelLevelValue { kind: "fuel_level"; percent: number }

export type TelemetryDiagnosticSeverity = "info" | "warning" | "critical";

/**
 * A fault the vehicle reported.
 *
 * The code and its text are carried; they are NOT interpreted. Deciding that an
 * aftertreatment fault means "schedule a service" is a Maintenance decision and
 * belongs to Maintenance — this module hands over the signal and stops.
 */
export interface TelemetryDiagnosticValue {
  kind: "diagnostic";
  code: string;
  /** The provider's own wording. Antcolos does not write fault descriptions. */
  description?: string;
  severity: TelemetryDiagnosticSeverity;
  /** True while the fault is still asserted, per the provider. */
  active: boolean;
  /** SAE J1939 fields when the provider speaks them. Carried, never parsed. */
  spn?: number;
  fmi?: number;
}

export type EldDutyStatus = "off_duty" | "sleeper" | "driving" | "on_duty_not_driving";

/**
 * A summary of a driver's clock, as the provider reports it.
 *
 * A SUMMARY, and the type will not let it be anything else: there are no log
 * edits here, no certifications, no unassigned-driving reassignment, no
 * malfunction codes and no day-by-day grid. Full HOS logs are a later module,
 * and modelling half of one here would produce something that looks like a
 * record of duty status and is not one.
 */
export interface TelemetryHosSummaryValue {
  kind: "hos_summary";
  dutyStatus: EldDutyStatus;
  driveSecondsRemaining?: number;
  shiftSecondsRemaining?: number;
  cycleSecondsRemaining?: number;
  /** True when the provider flags the movement as personal, not work. */
  personalConveyance?: boolean;
}

export type TelemetryMeasurement =
  | TelemetryLocationValue
  | TelemetrySpeedValue
  | TelemetryHeadingValue
  | TelemetryOdometerValue
  | TelemetryEngineHoursValue
  | TelemetryIgnitionValue
  | TelemetryMotionValue
  | TelemetryFuelLevelValue
  | TelemetryDiagnosticValue
  | TelemetryHosSummaryValue;

/* -------------------------------------------------------------------------- */
/* 8. Attribution, as at event time                                            */
/* -------------------------------------------------------------------------- */

/**
 * Who and what this event belonged to WHEN IT HAPPENED.
 *
 * Snapshotted onto the event and never recomputed. Re-binding a device to
 * another truck next week, moving a driver to another carrier, or ending an
 * operating-authority lease does not reach backwards and change who was driving
 * on Tuesday — which is the entire reason this is a snapshot and not a join.
 *
 * Every leg is optional and `resolvedAt`/`gaps` say which ones could not be
 * resolved, because "we do not know who was driving" is a real answer and much
 * better than guessing at today's driver.
 */
export interface TelemetryAttribution {
  /** The carrier organization that owned the data at event time. */
  carrierOrganizationId: string;
  carrierNameSnapshot: string;
  /** The device's bound truck at event time, per the binding interval. */
  truckId?: string;
  truckUnitSnapshot?: string;
  /** The device's bound driver at event time. */
  driverProfileId?: string;
  driverNameSnapshot?: string;
  /**
   * The carrier's operating-authority status at event time, snapshotted.
   * A signal produced while authority was not active is still recorded — and
   * still says so, forever.
   */
  operatingAuthorityStatus?: string;
  operatingAuthorityRef?: ExternalRef;
  /** The load in progress at event time, when one could be resolved. */
  loadId?: string;
  loadReferenceSnapshot?: string;
  /** Which legs could not be resolved, and why. Never silently empty. */
  gaps: readonly string[];
  /** When attribution was computed. Always at ingestion, never on read. */
  resolvedAt: IsoDateTime;
}

/* -------------------------------------------------------------------------- */
/* 9. Anomalies and ingestion outcome                                          */
/* -------------------------------------------------------------------------- */

/**
 * What was wrong with a signal.
 *
 * Nothing flagged here is deleted. A rejected event is stored as a rejected
 * event, with its raw payload still on file, because an ingestion pipeline that
 * quietly drops what it does not like is a pipeline nobody can debug and
 * nobody should trust with a compliance question.
 */
export type TelemetryAnomaly =
  /** The same provider event arrived twice. */
  | "duplicate"
  /** No parseable source timestamp at all. */
  | "invalid_timestamp"
  /** Source timestamp is in the future beyond the allowed skew. */
  | "future_timestamp"
  /** Source timestamp precedes a signal already accepted for this device. */
  | "out_of_order"
  /** The implied speed between two positions is not physically possible. */
  | "impossible_jump"
  /** An odometer that went backwards. */
  | "odometer_regression"
  /** Engine hours that went backwards. */
  | "engine_hours_regression"
  /** The provider sent a signal kind its adapter does not support. */
  | "unsupported_signal"
  /** No device binding covered the event time, so the truck is unknown. */
  | "missing_vehicle_binding"
  /** No driver binding covered the event time. */
  | "missing_driver_binding"
  /** The device id is not registered to this connection. */
  | "unknown_device";

export const ANOMALY_LABEL: Record<TelemetryAnomaly, string> = {
  duplicate: "Duplicate of a signal already received",
  invalid_timestamp: "No usable source timestamp",
  future_timestamp: "Source timestamp is in the future",
  out_of_order: "Arrived after a newer signal from the same device",
  impossible_jump: "Implies a physically impossible movement",
  odometer_regression: "Odometer went backwards",
  engine_hours_regression: "Engine hours went backwards",
  unsupported_signal: "The provider does not support this signal",
  missing_vehicle_binding: "No device-to-truck binding covered this time",
  missing_driver_binding: "No driver-to-device binding covered this time",
  unknown_device: "The device is not registered on this connection",
};

/**
 * What became of a signal.
 *
 *   accepted  normalized, attributed, and published to downstream signals
 *   flagged   kept and readable, but not trusted enough to publish
 *   rejected  kept for the record, and excluded from everything derived
 */
export type TelemetryIngestionState = "accepted" | "flagged" | "rejected";

/* -------------------------------------------------------------------------- */
/* 10. The normalized event                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One normalized Antcolos telemetry event.
 *
 * Append-only. A correction is a new event marked `corrected` that names the
 * event it supersedes; the superseded row stays, and the raw payload behind it
 * stays too.
 */
export interface TelemetryEvent {
  id: string;
  organizationId: string;
  providerId: string;
  connectionId: string;
  deviceId: string;
  /** The raw delivery this was normalized out of. Never absent. */
  rawPayloadId: string;
  kind: TelemetrySignalKind;
  value: TelemetryMeasurement;

  /** When the provider says the fact was true. */
  sourceAt: IsoDateTime;
  /** When Antcolos received the delivery. */
  receivedAt: IsoDateTime;
  /** When this normalized row was written. */
  normalizedAt: IsoDateTime;

  /**
   * Reported accuracy, in meters, for positional signals. Absent means the
   * provider did not say — which is different from "accurate".
   */
  accuracyMeters?: number;
  /** 0–1, as the provider expressed it or as normalization assessed it. */
  confidence: number;
  quality: TelemetryDataQuality;
  provenance: Provenance;

  attribution: TelemetryAttribution;

  ingestion: TelemetryIngestionState;
  anomalies: readonly TelemetryAnomaly[];
  /** Plain language, shown next to a flagged or rejected row. */
  ingestionNote?: string;

  /**
   * The key that makes ingestion idempotent: same key, same event, once.
   * Built from provider + device + kind + source time + the provider's own id.
   */
  dedupeKey: IdempotencyKey;
  /** Monotonic receive order within the organization, for stable ordering. */
  sequence: number;
  /** Set on a corrected event: the event id this one replaces. */
  supersedesEventId?: string;
}

/* -------------------------------------------------------------------------- */
/* 11. The derived snapshot                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One field of a snapshot: the value, and everything needed to disbelieve it.
 *
 * A snapshot field is DERIVED on read from the accepted events. It is never
 * stored, never written back over the events, and never overwrites raw history
 * — which is why the snapshot can be recomputed from scratch at any time and
 * why a normalization fix does not need a data migration.
 */
export interface SnapshotField<V> {
  value?: V;
  quality: TelemetryDataQuality;
  sourceAt?: IsoDateTime;
  receivedAt?: IsoDateTime;
  providerId?: string;
  providerName?: string;
  confidence?: number;
  accuracyMeters?: number;
  /** The event this value came from, so a screen can show its papers. */
  eventId?: string;
  /** Hours since `sourceAt`. Absent when there is no value. */
  ageHours?: number;
  /** True when older than the connection's freshness expectation. */
  stale: boolean;
}

/** Everything currently known about one truck, derived from its events. */
export interface EquipmentTelemetrySnapshot {
  organizationId: string;
  truckId: string;
  truckUnit: string;
  /** The device bound right now, when there is one and the caller may know. */
  deviceId?: string;
  deviceSerial?: string;
  /**
   * True when a device IS bound and this viewer was not told which.
   *
   * The same distinction `precise` makes on a position: "no device" and "a
   * device you may not know about" are different facts, and a screen that
   * showed both as an empty field would report the second as the first.
   */
  deviceWithheld?: boolean;
  connectionState: EldConnectionState;
  location: SnapshotField<SnapshotLocationValue>;
  speed: SnapshotField<TelemetrySpeedValue>;
  heading: SnapshotField<TelemetryHeadingValue>;
  odometer: SnapshotField<TelemetryOdometerValue>;
  engineHours: SnapshotField<TelemetryEngineHoursValue>;
  ignition: SnapshotField<TelemetryIgnitionValue>;
  motion: SnapshotField<TelemetryMotionValue>;
  fuelLevel: SnapshotField<TelemetryFuelLevelValue>;
  /** Active diagnostics, newest first. Empty is a real and common answer. */
  diagnostics: readonly (TelemetryDiagnosticValue & {
    sourceAt: IsoDateTime; eventId: string; quality: TelemetryDataQuality;
  })[];
  /** Present only when the caller is entitled to the driver's clock. */
  hos?: SnapshotField<TelemetryHosSummaryValue> & { driverProfileId?: string };
  /** The driver bound right now, when the caller may know. */
  driverProfileId?: string;
  driverName?: string;
  generatedAt: IsoDateTime;
  /** How many accepted events this was built from. */
  eventsConsidered: number;
}

/* -------------------------------------------------------------------------- */
/* 12. Published signals — the typed handoff to existing modules               */
/* -------------------------------------------------------------------------- */

/**
 * The modules this layer publishes to.
 *
 * Publishing means: a typed record is produced, addressed to that module, and
 * queued. It does NOT mean anything was written to that module's records, and
 * this module has no way to write to them — none of these targets is imported
 * here, and none of the payloads below is that module's canonical shape.
 */
export type EldSignalTarget =
  | "fleet"
  | "trip_workflow"
  | "mt_loop"
  | "hos"
  | "maintenance"
  | "fuel_ifta"
  | "compliance";

export interface EldSignalBase {
  id: string;
  organizationId: string;
  target: EldSignalTarget;
  /** The destination's operation name, agreed in the port contract. */
  operation: string;
  /** Same key, same effect, exactly once — safe to replay. */
  idempotencyKey: IdempotencyKey;
  /**
   * The normalized events this was computed from.
   *
   * Empty for the alerts that are about the ABSENCE of data — a device that
   * stopped reporting produces no event to cite, and inventing one would be a
   * lie about where the alert came from.
   */
  sourceEventIds: readonly string[];
  /** Attribution as at the events' time, carried through unchanged. */
  attribution: TelemetryAttribution;
  quality: TelemetryDataQuality;
  confidence: number;
  provenance: Provenance;
  publishedAt: IsoDateTime;
  /** Always "pending_integration" here: nothing is transmitted anywhere. */
  state: "pending_integration";
  stateReason: string;
}

export interface FleetLocationSignal extends EldSignalBase {
  target: "fleet";
  operation: "fleet.location_availability";
  payload: {
    truckId: string;
    location?: TelemetryLocationValue;
    speedMph?: number;
    moving?: boolean;
    ignitionOn?: boolean;
    observedAt: IsoDateTime;
  };
}

/**
 * A SUGGESTION that a trip milestone happened.
 *
 * The wording of every field is deliberate. `suggests`, not `records`;
 * `rationale`, not `note`. The Trip Workflow decides whether a person is asked
 * to confirm it, and only a person can confirm it. Nothing in this payload can
 * express "the driver arrived", because the type has nowhere to say so.
 */
export interface TripInferenceSignal extends EldSignalBase {
  target: "trip_workflow";
  operation: "trip.arrival_departure_inferred";
  payload: {
    truckId: string;
    loadId?: string;
    stopRef?: ExternalRef;
    suggests: "arrival" | "departure";
    observedAt: IsoDateTime;
    location?: TelemetryLocationValue;
    /** Why the machine thinks so, in words a driver will read. */
    rationale: string;
  };
}

export interface MtLoopEtaSignal extends EldSignalBase {
  target: "mt_loop";
  operation: "mt_loop.eta_updated";
  payload: {
    truckId: string;
    loadId?: string;
    /** Where it is now, which is all this module can honestly contribute. */
    location?: TelemetryLocationValue;
    speedMph?: number;
    observedAt: IsoDateTime;
    /**
     * Absent, always, in this build. Routing is not built here, and an ETA
     * invented from a straight line would be worse than no ETA at all.
     */
    etaAt?: IsoDateTime;
    etaBasis: "not_computed";
  };
}

export interface HosAvailabilitySignal extends EldSignalBase {
  target: "hos";
  operation: "hos.availability_reported";
  payload: {
    driverProfileId: string;
    truckId?: string;
    summary: TelemetryHosSummaryValue;
    observedAt: IsoDateTime;
    /** Says out loud that this is a summary and not a record of duty status. */
    isFullLog: false;
  };
}

export interface MaintenanceMeterSignal extends EldSignalBase {
  target: "maintenance";
  operation: "maintenance.meter_reported";
  payload: {
    truckId: string;
    odometerMiles?: number;
    engineHours?: number;
    observedAt: IsoDateTime;
  };
}

export interface MaintenanceDiagnosticSignal extends EldSignalBase {
  target: "maintenance";
  operation: "maintenance.diagnostic_reported";
  payload: {
    truckId: string;
    diagnostic: TelemetryDiagnosticValue;
    observedAt: IsoDateTime;
    /** Never a recommendation. This module does not diagnose. */
    interpretation: "none";
  };
}

export interface FuelJurisdictionSignal extends EldSignalBase {
  target: "fuel_ifta";
  operation: "fuel.jurisdiction_mileage_observed";
  payload: {
    truckId: string;
    /** The jurisdiction the position fell in, per the provider's geocode. */
    jurisdiction?: string;
    odometerMiles?: number;
    observedAt: IsoDateTime;
    /**
     * Whether this is a filing-grade number. Always false: jurisdiction
     * mileage for an IFTA return is computed by the Fuel/IFTA module from its
     * own records, and one position is an observation, not a return.
     */
    filingGrade: false;
  };
}

export interface ComplianceAlertSignal extends EldSignalBase {
  target: "compliance";
  operation: "compliance.telematics_alert";
  payload: {
    truckId?: string;
    driverProfileId?: string;
    alert:
      | "device_disconnected"
      | "data_stale"
      | "critical_diagnostic"
      | "authority_inactive_at_event";
    observedAt: IsoDateTime;
    detail: string;
  };
}

export type EldPublishedSignal =
  | FleetLocationSignal
  | TripInferenceSignal
  | MtLoopEtaSignal
  | HosAvailabilitySignal
  | MaintenanceMeterSignal
  | MaintenanceDiagnosticSignal
  | FuelJurisdictionSignal
  | ComplianceAlertSignal;

/* -------------------------------------------------------------------------- */
/* 13. Sharing with dispatch workspaces                                        */
/* -------------------------------------------------------------------------- */

/**
 * An explicit grant from a carrier to a dispatch workspace.
 *
 * Dispatch organizations and individual dispatchers see NOTHING from this
 * module by default. Not a truck, not a device, not a position. They see what a
 * carrier deliberately shared, for the trucks it named, in the signal classes
 * it chose, for as long as the grant stands — and the grant is a record with a
 * date on it, not a checkbox on a settings page.
 */
export interface EldShare {
  id: string;
  /** The carrier that owns the data. */
  ownerOrganizationId: string;
  /** The dispatch organization or individual dispatcher receiving it. */
  viewerOrganizationId: string;
  truckId: string;
  signalClasses: readonly EldSignalClass[];
  /**
   * Whether this viewer may hold exact coordinates for THIS truck.
   *
   * A dispatcher covering a truck needs to know how far out it is, so sharing
   * `position` grants this by default — but it is the carrier's to withhold,
   * per truck, and withholding it leaves the viewer with a city and a state.
   *
   * It is a property of the SHARE rather than of the viewer's permissions
   * because it is the carrier's call, and the carrier cannot edit another
   * organization's memberships. A dispatcher holding
   * `eld:location:precise:view` still gets coordinates only for the trucks
   * whose carriers granted them: the permission says what the person may hold,
   * the share says which trucks it reaches, and both must agree.
   */
  precisePosition: boolean;
  grantedAt: IsoDateTime;
  grantedByMembershipId: string;
  revokedAt?: IsoDateTime;
  note?: string;
}

/* -------------------------------------------------------------------------- */
/* 14. Dashboard shapes                                                        */
/* -------------------------------------------------------------------------- */

export type EldConnectionCounts = Record<EldConnectionState, number>;

export interface EldDashboardSummary {
  devices: number;
  connections: number;
  connectionCounts: EldConnectionCounts;
  /** Devices with no live truck binding. */
  unboundDevices: number;
  /** Trucks the caller can see that have no device bound. */
  trucksWithoutDevice: number;
  /** Accepted events in the last 24 hours. */
  eventsLast24h: number;
  flaggedLast24h: number;
  rejectedLast24h: number;
  /** Snapshots whose newest position is past its freshness expectation. */
  staleSnapshots: number;
  activeCriticalDiagnostics: number;
}

export interface EldDashboard {
  organizationId: string;
  generatedAt: IsoDateTime;
  summary: EldDashboardSummary;
  connections: readonly EldConnection[];
  devices: readonly EldDeviceView[];
  snapshots: readonly EquipmentTelemetrySnapshot[];
  /** Signals queued for other modules. Nothing has been transmitted. */
  publishedSignals: readonly EldPublishedSignal[];
  providers: readonly EldProvider[];
  /** True for the whole module, in this build, always. */
  allProvidersAreMock: true;
}

/** A device with its live bindings resolved, as a screen needs it. */
export interface EldDeviceView {
  device: EldDevice;
  providerName: string;
  connectionLabel: string;
  connectionState: EldConnectionState;
  /** How this device's link delivers. A file import is not a broken webhook. */
  connectionTransport: EldTransport;
  /** The live vehicle binding, when there is one. */
  vehicleBinding?: EldVehicleBinding;
  truckUnit?: string;
  /** The live driver binding, when there is one and the caller may see it. */
  driverBinding?: EldDriverBinding;
  driverName?: string;
  lastEventAt?: IsoDateTime;
  /** Accepted events in the last 24 hours from this device. */
  eventsLast24h: number;
}

/** A device in full: its bindings, their history, and its recent events. */
export interface EldDeviceDetail {
  view: EldDeviceView;
  vehicleBindings: readonly EldVehicleBinding[];
  driverBindings: readonly EldDriverBinding[];
  bindingHistory: readonly EldBindingHistoryEntry[];
  /** Newest first. Includes flagged and rejected rows, labelled as such. */
  recentEvents: readonly TelemetryEvent[];
  snapshot?: EquipmentTelemetrySnapshot;
}

/* -------------------------------------------------------------------------- */
/* 15. Ingestion result                                                        */
/* -------------------------------------------------------------------------- */

export interface TelemetryIngestionOutcome {
  /**
   * The normalized event this outcome refers to.
   *
   * Absent for a fragment that never became an event — a row the adapter could
   * not read, or a signal kind the provider is not contracted for. Those still
   * get an outcome, with a reason, because a delivery that reports "3 accepted"
   * and says nothing about the fourth row is a delivery nobody can audit.
   */
  eventId?: string;
  kind?: TelemetrySignalKind;
  state: TelemetryIngestionState;
  anomalies: readonly TelemetryAnomaly[];
  note?: string;
}

export interface EldIngestionResult {
  rawPayloadId: string;
  organizationId: string;
  connectionId: string;
  receivedAt: IsoDateTime;
  accepted: number;
  flagged: number;
  rejected: number;
  outcomes: readonly TelemetryIngestionOutcome[];
  /** Signals published as a result of the accepted events. */
  published: readonly EldPublishedSignal[];
  /** Set when the whole delivery was refused before normalization. */
  deliveryRejectedReason?: string;
}

/* -------------------------------------------------------------------------- */
/* 16. Labels                                                                  */
/* -------------------------------------------------------------------------- */

export const CONNECTION_STATE_LABEL: Record<EldConnectionState, string> = {
  connected: "Connected",
  syncing: "Syncing",
  stale: "Stale",
  offline: "Offline",
  disconnected: "Disconnected",
  error: "Error",
  unsupported: "Unsupported",
};

export const CONNECTION_STATE_DESCRIPTION: Record<EldConnectionState, string> = {
  connected: "Linked, and data is arriving inside the freshness expectation.",
  syncing: "A first sync or a backfill is in flight. Gaps are expected.",
  stale: "Still linked, but nothing has arrived recently enough to trust.",
  offline: "The device is not reporting. Usually the key is off or there is no signal.",
  disconnected: "Somebody took this link down on purpose. Not a fault.",
  error: "The provider or the adapter refused. The reason is recorded.",
  unsupported: "This provider cannot give what was asked of it.",
};

export const SIGNAL_KIND_LABEL: Record<TelemetrySignalKind, string> = {
  location: "Location",
  speed: "Speed",
  heading: "Heading",
  odometer: "Odometer",
  engine_hours: "Engine hours",
  ignition: "Ignition",
  motion: "Motion",
  fuel_level: "Fuel level",
  diagnostic: "Diagnostic",
  hos_summary: "HOS summary",
};

export const SIGNAL_CLASS_LABEL: Record<EldSignalClass, string> = {
  position: "Position and movement",
  meters: "Odometer, hours and fuel level",
  diagnostics: "Engine diagnostics",
  hos: "Hours-of-service availability",
};

export const DATA_QUALITY_LABEL: Record<TelemetryDataQuality, string> = {
  confirmed: "Confirmed",
  provider_reported: "Provider reported",
  inferred: "Inferred",
  corrected: "Corrected",
  missing: "Missing",
};

export const DATA_QUALITY_DESCRIPTION: Record<TelemetryDataQuality, string> = {
  confirmed: "A person in Antcolos asserted or confirmed this. Never set by a machine.",
  provider_reported: "The provider reported it. Normalized faithfully, not judged.",
  inferred: "Worked out from signals. Not a record of anything anybody did.",
  corrected: "A person overrode an earlier value. The earlier one is still on file.",
  missing: "Nobody has said. Not zero, and not an assumption.",
};

export const SIGNAL_TARGET_LABEL: Record<EldSignalTarget, string> = {
  fleet: "Fleet",
  trip_workflow: "Trip workflow",
  mt_loop: "MT Loop and ETA",
  hos: "HOS availability",
  maintenance: "Maintenance",
  fuel_ifta: "Fuel and IFTA",
  compliance: "Safety and Compliance",
};

export const DEVICE_KIND_LABEL: Record<EldDeviceKind, string> = {
  obd_dongle: "OBD dongle",
  hardwired_gateway: "Hard-wired gateway",
  asset_tracker: "Asset tracker",
  mobile_app: "Driver phone app",
};

export const TRANSPORT_LABEL: Record<EldTransport, string> = {
  webhook: "Webhook",
  poll: "Scheduled poll",
  import: "File import",
  simulated: "Mock console",
};

export const BINDING_END_REASON_LABEL: Record<EldBindingEndReason, string> = {
  unbound: "Unbound by an operator",
  superseded: "Replaced by a newer binding",
  device_retired: "Device retired",
  connection_disconnected: "Connection was disconnected",
  correction: "Corrected — the interval was wrong",
};

/** Permission keys this module reads. Listed once, so a screen cannot drift. */
export const ELD_PERMISSIONS = {
  view: "eld:view",
  devicesManage: "eld:devices:manage",
  bindingsManage: "eld:bindings:manage",
  ingest: "eld:ingest",
  preciseLocation: "eld:location:precise:view",
  diagnostics: "eld:diagnostics:view",
  hos: "eld:hos:view",
  raw: "eld:raw:view",
} as const satisfies Record<string, PermissionKey>;
