import type { GeoPoint, IsoDateTime } from "./common";
import type { OperatingAuthority } from "./carrier";
import type { FleetTelemetrySource } from "./fleet-operations";
import type { Provenance } from "./integration";
import type { LoadStatus } from "./load";
import type { TruckEquipmentType } from "./truck";

/**
 * GPS-driven availability, dispatch tracking and Load-scoped broker visibility.
 *
 * Three ideas hold this module together, and every type below exists to keep
 * one of them honest:
 *
 *  1. GPS ALONE NEVER CONFIRMS AN EMPTY TRUCK. A position is one piece of
 *     evidence among seven, and no combination of machine evidence produces
 *     "Empty Confirmed" — only a person does. Everything a machine concluded
 *     stays `inferred`, with its source, its time, its confidence and the
 *     evidence it stood on, until somebody says otherwise.
 *
 *  2. A DRIVER ACTION IS NEVER FABRICATED. An inference is attributed to the
 *     adapter that produced it. There is nowhere in these types to record a
 *     driver as having done something they did not do, which is deliberate:
 *     `attribution` is a closed union and "driver" is only reachable from a
 *     command a driver actually issued.
 *
 *  3. WHAT IS SHOWN OUTSIDE IS A SEPARATE, SMALLER THING. The broker-facing
 *     view is its own type with its own fields, assembled by redaction from
 *     the inside. It is not the dispatcher's row with flags on it, because a
 *     shape that *could* carry a rate or a phone number eventually will.
 */

/* -------------------------------------------------------------------------- */
/* 1. Normalized location signals                                              */
/* -------------------------------------------------------------------------- */

/**
 * Where a normalized location signal entered Antcolos.
 *
 * These are TRANSPORTS, not truth. `mock_adapter` is the only one that
 * produces anything today and every fixture says so on screen. The rest are
 * declared so the adapter that fills them later is a registration, not a
 * migration — see `TRACKING_SIGNAL_SOURCES`.
 */
export type LocationSignalTransport =
  /** A reading that came through the existing fleet telemetry boundary. */
  | "fleet_telemetry"
  /** An electronic logging device, through the ELD boundary. */
  | "eld"
  /** A phone in the cab, reporting its own position. */
  | "mobile_gps"
  /** A location a driver shared in a Telegram chat. */
  | "telegram_location"
  /** A partner or customer system pushing positions over an API. */
  | "api"
  /** A position parsed out of an inbound email. */
  | "email"
  /** A position parsed out of an inbound SMS. */
  | "sms"
  /** Somebody in the office typed it in after a phone call. */
  | "dispatcher_entry"
  /** The driver said where they were. A person, not a device. */
  | "driver_report";

/**
 * One position, normalized.
 *
 * Deliberately narrow. A signal says where something was and how sure the
 * source is; it does not say what the driver did, because there is no field
 * for that. Turning a run of these into "they arrived" is an inference, made
 * elsewhere, recorded as an inference.
 */
export interface LocationSignal {
  id: string;
  /** The truck the position is about. Never a driver. */
  truckId: string;
  /** The load it was observed against, when the truck was on one. */
  loadId?: string;
  organizationId: string;
  transport: LocationSignalTransport;
  /** The fleet telemetry source this maps back to, where one applies. */
  telemetrySource?: FleetTelemetrySource;
  city?: string;
  state?: string;
  /** Free text as recorded — a yard, a customer, a mile marker. */
  description?: string;
  point?: GeoPoint;
  /** Miles per hour, where the source reports it. Absent is not zero. */
  speedMph?: number;
  /** When the position was true in the world. Staleness is measured on this. */
  observedAt: IsoDateTime;
  /** When Antcolos was told. Differs for batched and offline reports. */
  receivedAt: IsoDateTime;
  /** 0–1, as the source expresses it. A source with none has no business inferring. */
  confidence: number;
  provenance: Provenance;
}

/**
 * A provider this module is shaped to accept, and whether it is connected.
 *
 * Every descriptor below reports `not_connected` today. The list is here so a
 * screen can say exactly what would populate what, instead of implying a feed
 * exists because a row on the page moved.
 */
export interface TrackingSignalSourceDescriptor {
  transport: LocationSignalTransport;
  label: string;
  /** What it would supply, in the words of the dispatcher who would want it. */
  description: string;
  status: "connected" | "not_connected";
  /** Which fields on a tracking row it would populate. */
  wouldPopulate: string[];
  /** The branch or team that would own the real implementation. */
  ownedBy: string;
}

/* -------------------------------------------------------------------------- */
/* 2. Evidence-based availability                                              */
/* -------------------------------------------------------------------------- */

/**
 * What Antcolos is willing to say about whether a truck is free.
 *
 * Five states, and the distance between the middle three is the whole point.
 * A dispatcher who is told "Likely Available" and books against it has made a
 * judgement; one who is told "Empty Confirmed" has been told a fact. Collapsing
 * them into a boolean is how a truck gets double-booked on a geofence ping.
 */
export type AvailabilityState =
  /** Not empty yet. The ETA and the destination say it will be, and roughly when. */
  | "expected_available"
  /** The evidence says it probably is, and no person has confirmed it. */
  | "likely_available"
  /** A person confirmed it. The only state a machine cannot reach. */
  | "empty_confirmed"
  /** The signals are missing, stale or disagree. Honest, and never silent. */
  | "availability_uncertain"
  /** Known not to be free — loaded, in the shop, or stood down by the carrier. */
  | "unavailable";

export const AVAILABILITY_STATE_LABEL: Record<AvailabilityState, string> = {
  expected_available: "Expected available",
  likely_available: "Likely available",
  empty_confirmed: "Empty confirmed",
  availability_uncertain: "Availability uncertain",
  unavailable: "Unavailable",
};

export const AVAILABILITY_STATE_DESCRIPTION: Record<AvailabilityState, string> = {
  expected_available:
    "Still on a load. The delivery appointment and the truck's progress towards it say when it should come free.",
  likely_available:
    "The evidence points at an empty truck, but nobody has confirmed it. Treat it as a lead, not a fact.",
  empty_confirmed:
    "A person confirmed the truck is empty. This is the only state a device can never produce on its own.",
  availability_uncertain:
    "Antcolos cannot tell. The signals are missing, too old, or they disagree with each other.",
  unavailable: "The truck is not free — it is loaded, in the shop, or the carrier has stood it down.",
};

/**
 * Whether a conclusion rests on a machine or on a person.
 *
 * `inferred` is not a lesser kind of confirmed. It is a different claim: "this
 * is what the evidence suggests", never "this is what happened".
 */
export type AvailabilityBasis = "inferred" | "confirmed";

/** The seven kinds of evidence availability is allowed to be derived from. */
export type AvailabilityEvidenceKind =
  /** Where the truck is, and how far that is from where it is going. */
  | "gps_location"
  /** Whether it is moving, and how fast. */
  | "gps_movement"
  /** The delivery appointment on the load's final stop. */
  | "delivery_appointment"
  /** The estimated time of arrival, as last reported. */
  | "eta"
  /** The truck entered the receiver's geofence. */
  | "geofence_entry"
  /** The truck left the receiver's geofence. */
  | "geofence_exit"
  /** A milestone from the Driver Trip Workflow. */
  | "driver_workflow_event"
  /** Unloading started, finished, or has not begun. */
  | "unloading_status"
  /** Whether proof of delivery exists, and whether a person has verified it. */
  | "pod_status"
  /** A driver or a dispatcher said so, in as many words. */
  | "human_confirmation"
  /** The carrier's own record: in the shop, out of service, stood down. */
  | "equipment_status";

export const AVAILABILITY_EVIDENCE_LABEL: Record<AvailabilityEvidenceKind, string> = {
  gps_location: "Location",
  gps_movement: "Movement",
  delivery_appointment: "Delivery appointment",
  eta: "ETA",
  geofence_entry: "Geofence entry",
  geofence_exit: "Geofence exit",
  driver_workflow_event: "Driver workflow",
  unloading_status: "Unloading",
  pod_status: "Proof of delivery",
  human_confirmation: "Confirmation",
  equipment_status: "Equipment status",
};

/**
 * Who or what is behind a piece of evidence.
 *
 * A closed union, and the reason nothing here can fabricate a driver action:
 * `driver` is only ever written from a command a driver issued, and an adapter
 * has no way to produce one — it can only write `adapter`.
 */
export type AvailabilityAttribution = "driver" | "dispatcher" | "carrier" | "adapter" | "system";

/**
 * One reason to believe something, kept whole.
 *
 * The rationale is written for the dispatcher who has to decide whether to
 * trust it, so it says what was observed rather than what was concluded.
 */
export interface AvailabilityEvidence {
  kind: AvailabilityEvidenceKind;
  basis: AvailabilityBasis;
  attribution: AvailabilityAttribution;
  /** When the underlying fact was true, not when it was read. */
  observedAt: IsoDateTime;
  /** 0–1. What the SOURCE claims, never rounded up by the engine. */
  confidence: number;
  /** Plain language, shown next to the state. */
  summary: string;
  /** Present when the evidence came from outside this module. */
  provenance?: Provenance;
  /** The signal, event or document this stands on, for reconciliation. */
  sourceRecordId?: string;
  /**
   * Set when the engine looked at this and declined to use it — a geofence
   * ping at highway speed, a position that contradicts a later one. Kept
   * rather than dropped, because "we saw this and did not believe it" is the
   * most useful line in the whole record when somebody asks why.
   */
  disregardedReason?: string;
}

/**
 * The typed decision, which is what gets published to the MT Loop service.
 *
 * It is a VALUE, not a record: nothing owns it, the engine recomputes it from
 * the evidence on every read, and two callers looking at one truck at one
 * moment get the same answer. What persists is the MT Loop entry it produced
 * and the audit line that says it did.
 */
export interface AvailabilityDecision {
  truckId: string;
  /** The workspace the decision was made for. Availability is never global. */
  organizationId: string;
  /** The carrier whose authority the truck runs under. */
  carrierOrganizationId?: string;
  state: AvailabilityState;
  basis: AvailabilityBasis;
  /** 0–1, bounded below `CONFIRMED_CONFIDENCE` for anything inferred. */
  confidence: number;
  /**
   * The one operational cycle this decision is about.
   *
   * Two decisions with the same key are two readings of one cycle and must
   * never produce two MT Loop entries. See `operationalCycleKey`.
   */
  cycleKey: string;
  /** The load the truck is finishing, when there is one. */
  loadId?: string;
  loadReference?: string;
  /** When the truck is — or was — expected to come free. */
  expectedEmptyAt?: IsoDateTime;
  expectedEmptyCity?: string;
  expectedEmptyState?: string;
  decidedAt: IsoDateTime;
  /** Every reason, including the ones that were looked at and set aside. */
  evidence: AvailabilityEvidence[];
  /** One sentence a dispatcher can read without opening the evidence list. */
  rationale: string;
  /** What would move this to Empty Confirmed. Absent once it is. */
  awaiting?: string;
  provenance: Provenance;
}

/** What publishing a decision to the MT Loop service actually did. */
export type AvailabilityPublicationOutcome =
  /** A new loop was opened for this truck and cycle. */
  | "loop_opened"
  /** The existing loop for this cycle was brought up to date. */
  | "loop_updated"
  /** Same cycle, same state — nothing to write, and no second entry. */
  | "unchanged"
  /** A loop already ran for this exact cycle. A second one is not opened. */
  | "duplicate_suppressed"
  /** The state does not warrant a loop: unavailable, or simply not known. */
  | "not_publishable"
  /** Another workspace is responsible for this truck. */
  | "not_responsible";

export interface AvailabilityPublication {
  outcome: AvailabilityPublicationOutcome;
  /** The ONE loop this cycle has, when there is one. */
  loopId?: string;
  /** Why, in words, for the audit line and the screen. */
  reason: string;
}

/* -------------------------------------------------------------------------- */
/* 3. Dispatch tracking                                                        */
/* -------------------------------------------------------------------------- */

/**
 * How well Antcolos is actually being told where a truck is.
 *
 * Five states, because "no update" has four different meanings and a
 * dispatcher needs to know which one they have: a feed that is working, one
 * that has gone quiet, one that has stopped, one that was cut off mid-load,
 * and a truck nobody is entitled to track at all.
 */
export type TrackingSignalHealth =
  /** Updating inside the expectation. */
  | "live"
  /** Late, but not yet gone. Shown with its age, never silently.  */
  | "stale"
  /** Nothing for long enough that the feed should be treated as down. */
  | "offline"
  /** Was live on this load and stopped. Different from never having started. */
  | "interrupted"
  /** No tracking is possible or permitted — and saying so is not a failure. */
  | "unavailable";

export const TRACKING_HEALTH_LABEL: Record<TrackingSignalHealth, string> = {
  live: "Live",
  stale: "Stale",
  offline: "Offline",
  interrupted: "Interrupted",
  unavailable: "Unavailable",
};

/** A milestone as the tracking view shows it: what happened, and on whose word. */
export interface TrackedMilestone {
  key: string;
  label: string;
  /** Absent when it has not happened. */
  at?: IsoDateTime;
  basis?: AvailabilityBasis;
  attribution?: AvailabilityAttribution;
  /** 0–1, for an inferred milestone. Absent when a person recorded it. */
  confidence?: number;
  /** Why the machine thought so. Absent for a confirmed milestone. */
  inferenceRationale?: string;
}

export type TrackingAlertKind =
  | "delay"
  | "route_deviation"
  | "geofence"
  | "availability"
  | "signal_lost";

export const TRACKING_ALERT_LABEL: Record<TrackingAlertKind, string> = {
  delay: "Running late",
  route_deviation: "Off the expected route",
  geofence: "Geofence",
  availability: "Availability",
  signal_lost: "Tracking interrupted",
};

export interface TrackingAlert {
  id: string;
  kind: TrackingAlertKind;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  detail: string;
  raisedAt: IsoDateTime;
  /** An alert raised from an inference says so, rather than asserting a fact. */
  basis: AvailabilityBasis;
}

/**
 * The operating authority in force AT THE TIME, carried on the row.
 *
 * Snapshotted rather than looked up on render, because "which authority was
 * this load running under" is a question asked months later, about a
 * relationship that may since have ended.
 */
export interface TrackedAuthority {
  carrierOrganizationId: string;
  carrierName: string;
  mcNumber?: string;
  dotNumber?: string;
  authority: OperatingAuthority;
  /** True when the authority allowed dispatch at the moment of the snapshot. */
  allowedDispatch: boolean;
  snapshotAt: IsoDateTime;
}

/** One live load, as the dispatch tracking board shows it. */
export interface DispatchTrackingRow {
  loadId: string;
  loadReference: string;
  loadStatus: LoadStatus;
  organizationId: string;

  /* Who and what, at the time */
  carrierOrganizationId?: string;
  carrierName?: string;
  driverId?: string;
  driverName?: string;
  truckId?: string;
  truckUnit?: string;
  equipment?: TruckEquipmentType;
  trailerId?: string;
  trailerUnit?: string;
  authority?: TrackedAuthority;

  /* Where */
  originLabel: string;
  destinationLabel: string;
  currentCity?: string;
  currentState?: string;
  currentDescription?: string;
  /** 0–100. Derived from remaining distance, never from the status badge. */
  routeProgressPercent?: number;
  /** Straight-line miles to the final stop. Not a driving distance. */
  milesToDelivery?: number;

  /* When */
  deliveryAppointmentAt?: IsoDateTime;
  etaAt?: IsoDateTime;
  /** Minutes late against the appointment. Negative is early. */
  etaVarianceMinutes?: number;
  lastUpdateAt?: IsoDateTime;
  lastUpdateAgeMinutes?: number;
  lastSignalTransport?: LocationSignalTransport;
  lastSignalLabel?: string;

  /* How well we are being told */
  health: TrackingSignalHealth;
  healthReason: string;

  milestones: TrackedMilestone[];
  alerts: TrackingAlert[];

  /** The truck's availability decision, where one applies to this row. */
  availability?: {
    state: AvailabilityState;
    basis: AvailabilityBasis;
    confidence: number;
    expectedEmptyAt?: IsoDateTime;
    rationale: string;
  };

  /** True when a Load-scoped tracking session exists and is live. */
  sharedWithBroker: boolean;
  trackingSessionId?: string;
}

export interface DispatchTrackingBoard {
  rows: DispatchTrackingRow[];
  /**
   * The carriers represented on this board, so one dispatcher can work several
   * without switching workspace. Derived from the rows, never from a picker.
   */
  carriers: Array<{
    organizationId: string;
    name: string;
    loadCount: number;
    /** True when this carrier may legally haul right now. */
    canHaul: boolean;
  }>;
  counts: {
    tracked: number;
    live: number;
    stale: number;
    offline: number;
    interrupted: number;
    unavailable: number;
    alerting: number;
  };
  /** What is and is not connected, so the screen can tell the truth about it. */
  sources: TrackingSignalSourceDescriptor[];
}

export interface DispatchTrackingFilters {
  carrierOrganizationId?: string;
  health?: TrackingSignalHealth[];
  alertingOnly?: boolean;
  search?: string;
}

/* -------------------------------------------------------------------------- */
/* 4. Load-scoped tracking sessions                                            */
/* -------------------------------------------------------------------------- */

/**
 * Who a tracking link was issued to.
 *
 * Three audiences, three different amounts of information, configured
 * separately. A receiver has no business seeing the pickup and a shipper has
 * no business seeing the delivery appointment, and defaulting all three to the
 * same view is how a broker's customer list leaks sideways.
 */
export type TrackingAudience = "broker" | "shipper" | "receiver";

export const TRACKING_AUDIENCE_LABEL: Record<TrackingAudience, string> = {
  broker: "Broker",
  shipper: "Shipper",
  receiver: "Receiver",
};

/**
 * What one recipient may see.
 *
 * Every field defaults to OFF in `defaultVisibility`, and the fields that are
 * never configurable — rates, driver contact details, hours of service,
 * internal notes, anything about another load or another carrier — are simply
 * absent from this type. There is no flag to turn them on.
 */
export interface TrackingVisibility {
  /** Pickup stop city/state, appointment and arrival/departure. */
  pickupProgress: boolean;
  /** Delivery stop city/state, appointment and arrival/departure. */
  deliveryProgress: boolean;
  /** City and state of the truck. Never a coordinate, never a history. */
  truckLocation: boolean;
  /** The estimated arrival and when the position was last updated. */
  etaAndFreshness: boolean;
  /** Arrived and departed signals as they are recorded. */
  arrivalSignals: boolean;
  /** Delay and tracking-interrupted status. */
  exceptionStatus: boolean;
  /** The equipment type — "dry van" — and nothing that identifies the unit. */
  equipmentType: boolean;
  /** The carrier's business name. Off by default: it is the carrier's to give. */
  carrierName: boolean;
}

/** Why a tracking link stopped working. Never silent, never a 404. */
export type TrackingLinkState =
  | "active"
  | "expired"
  | "revoked"
  /** The load delivered and the configured grace period ran out. */
  | "completed"
  /** The load was cancelled. */
  | "cancelled"
  /** The carrier relationship behind it ended. */
  | "relationship_ended";

export const TRACKING_LINK_STATE_LABEL: Record<TrackingLinkState, string> = {
  active: "Active",
  expired: "Expired",
  revoked: "Revoked",
  completed: "Closed after delivery",
  cancelled: "Closed — load cancelled",
  relationship_ended: "Closed — carrier relationship ended",
};

/**
 * A revocable, expiring link.
 *
 * The token is opaque and single-purpose: it names one recipient on one load,
 * and resolving it yields that recipient's view or a stated refusal. It is
 * never a session, never a login, and it grants nothing beyond the one view.
 */
export interface TrackingLink {
  token: string;
  issuedAt: IsoDateTime;
  /** The configured timeout. Always set — a link with no end is not a link. */
  expiresAt: IsoDateTime;
  revokedAt?: IsoDateTime;
  revokedReason?: string;
  /** How many times the link has been opened. Access itself is audited. */
  accessCount: number;
  lastAccessedAt?: IsoDateTime;
}

export interface TrackingRecipient {
  id: string;
  sessionId: string;
  audience: TrackingAudience;
  /** The organization or company name, as the dispatcher entered it. */
  partyName: string;
  /** Who the link went to. Held for the audit trail, never shown publicly. */
  contactName?: string;
  contactEmail?: string;
  visibility: TrackingVisibility;
  link: TrackingLink;
  /** Derived on read from the link, the load and the relationship. */
  state: TrackingLinkState;
}

/**
 * How updates reach the broker.
 *
 * Two policies, and the difference is who is accountable for what goes out.
 * Under `draft_for_approval` nothing leaves without a dispatcher pressing the
 * button. Under `automatic_mock_handoff` the update is queued the moment it is
 * produced — and queued is the operative word: nothing is delivered, because
 * there is no delivery channel connected.
 */
export type TrackingUpdatePolicy = "draft_for_approval" | "automatic_mock_handoff";

export const TRACKING_UPDATE_POLICY_LABEL: Record<TrackingUpdatePolicy, string> = {
  draft_for_approval: "Draft for dispatcher approval",
  automatic_mock_handoff: "Automatic (mock handoff)",
};

export type TrackingUpdateKind =
  | "pickup_arrived"
  | "pickup_departed"
  | "in_transit"
  | "eta_changed"
  | "delay"
  | "tracking_interrupted"
  | "delivery_arrived"
  | "delivered";

export const TRACKING_UPDATE_KIND_LABEL: Record<TrackingUpdateKind, string> = {
  pickup_arrived: "Arrived at pickup",
  pickup_departed: "Departed pickup",
  in_transit: "In transit",
  eta_changed: "ETA changed",
  delay: "Running late",
  tracking_interrupted: "Tracking interrupted",
  delivery_arrived: "Arrived at delivery",
  delivered: "Delivered",
};

/**
 * The state of one outbound update.
 *
 * There is no `delivered`. Nothing in this build sends anything to a broker,
 * and a state that said otherwise would be the single most misleading word on
 * the screen.
 */
export type TrackingUpdateState =
  /** Written, waiting for a dispatcher. */
  | "draft"
  /** A dispatcher approved it. It is queued, not sent. */
  | "approved"
  /** Queued by the automatic policy, with no person in the loop. */
  | "queued"
  /** A dispatcher decided it should not go. Kept, with the reason. */
  | "discarded";

export const TRACKING_UPDATE_STATE_LABEL: Record<TrackingUpdateState, string> = {
  draft: "Draft — needs approval",
  approved: "Approved — queued for handoff",
  queued: "Queued for handoff",
  discarded: "Discarded",
};

/** One entry in the broker update history. Append-only; never edited. */
export interface TrackingUpdate {
  id: string;
  sessionId: string;
  loadId: string;
  kind: TrackingUpdateKind;
  audience: TrackingAudience[];
  state: TrackingUpdateState;
  /** What the broker would read. Already redacted for the audience. */
  message: string;
  /** Whether the fact behind it was confirmed or inferred. */
  basis: AvailabilityBasis;
  createdAt: IsoDateTime;
  createdByName: string;
  approvedAt?: IsoDateTime;
  approvedByName?: string;
  discardedAt?: IsoDateTime;
  discardReason?: string;
  /** Why nothing was actually sent. Always populated, always honest. */
  handoffNote: string;
  provenance: Provenance;
}

export type TrackingSessionStatus = "active" | "closed";

/**
 * ONE tracking session per load.
 *
 * Load-scoped on purpose: a session is the load's visibility, not a broker's
 * subscription. Recipients come and go inside it, links are minted and revoked
 * inside it, and there is exactly one place to look for "who can see this
 * load" — which is the question that actually gets asked.
 */
export interface TrackingSession {
  id: string;
  loadId: string;
  loadReference: string;
  /** The workspace that owns the load and the session. */
  organizationId: string;
  /** The carrier whose truck is being tracked. */
  carrierOrganizationId?: string;
  carrierName?: string;
  /**
   * The truck on the load when tracking was opened.
   *
   * Held on the session so that "has the relationship behind this link ended"
   * can be answered without a caller — which is exactly the position the
   * public resolver is in.
   */
  truckId?: string;
  status: TrackingSessionStatus;
  updatePolicy: TrackingUpdatePolicy;
  /** Hours a newly minted link stays valid for. */
  linkTimeoutHours: number;
  /** Hours after delivery before every link on this session closes. */
  postDeliveryGraceHours: number;
  createdAt: IsoDateTime;
  createdByName: string;
  closedAt?: IsoDateTime;
  closedReason?: string;
  recipients: TrackingRecipient[];
  updates: TrackingUpdate[];
  /** Append-only. Every mint, access, revoke, approval and expiry. */
  audit: TrackingAuditEntry[];
}

export type TrackingAuditAction =
  | "session_opened"
  | "recipient_added"
  | "link_issued"
  | "link_reissued"
  | "link_revoked"
  | "link_expired"
  | "link_accessed"
  | "link_access_refused"
  | "visibility_changed"
  | "policy_changed"
  | "update_drafted"
  | "update_approved"
  | "update_queued"
  | "update_discarded"
  | "session_closed"
  | "availability_decided"
  | "availability_published"
  | "signal_recorded"
  | "inference_disregarded";

export const TRACKING_AUDIT_LABEL: Record<TrackingAuditAction, string> = {
  session_opened: "Tracking opened",
  recipient_added: "Recipient added",
  link_issued: "Link issued",
  link_reissued: "Link reissued",
  link_revoked: "Link revoked",
  link_expired: "Link expired",
  link_accessed: "Link opened",
  link_access_refused: "Link refused",
  visibility_changed: "Visibility changed",
  policy_changed: "Update policy changed",
  update_drafted: "Update drafted",
  update_approved: "Update approved",
  update_queued: "Update queued",
  update_discarded: "Update discarded",
  session_closed: "Tracking closed",
  availability_decided: "Availability decided",
  availability_published: "Availability published to MT Loop",
  signal_recorded: "Location signal recorded",
  inference_disregarded: "Inference disregarded",
};

/**
 * One immutable line of history.
 *
 * Provenance travels on it rather than being reconstructed later: which system
 * said it, when it observed it, how sure it was, and whether it was a person.
 */
export interface TrackingAuditEntry {
  id: string;
  at: IsoDateTime;
  action: TrackingAuditAction;
  /** The load, session, recipient or truck it is about. */
  subjectId: string;
  summary: string;
  detail?: string;
  /** Absent when the system did it rather than a person. */
  actorMembershipId?: string;
  actorName: string;
  basis?: AvailabilityBasis;
  provenance?: Provenance;
}

/* -------------------------------------------------------------------------- */
/* 5. The public view                                                          */
/* -------------------------------------------------------------------------- */

/** Why a token did not resolve. Always stated; never a blank page. */
export type PublicTrackingRefusal =
  | "unknown_token"
  | "revoked"
  | "expired"
  | "completed"
  | "cancelled"
  | "relationship_ended";

export const PUBLIC_REFUSAL_MESSAGE: Record<PublicTrackingRefusal, string> = {
  unknown_token: "This tracking link is not recognised.",
  revoked: "This tracking link was withdrawn by the carrier.",
  expired: "This tracking link has expired.",
  completed: "This shipment has delivered and tracking has closed.",
  cancelled: "This load was cancelled and tracking has closed.",
  relationship_ended: "The carrier relationship behind this link has ended.",
};

/** One stop, as a recipient outside the organization may see it. */
export interface PublicTrackingStop {
  kind: "pickup" | "delivery";
  city: string;
  state: string;
  /** The facility name, only when the dispatcher chose to include it. */
  facilityName?: string;
  appointmentAt?: IsoDateTime;
  arrivedAt?: IsoDateTime;
  departedAt?: IsoDateTime;
  /** Whether those timestamps came from a person or from an inference. */
  basis?: AvailabilityBasis;
}

/**
 * Everything a broker, shipper or receiver is ever shown.
 *
 * A separate, smaller type — not the dispatcher's row with fields hidden.
 * There is no rate here, no driver name, no phone number, no hours of service,
 * no internal note, no other load and no other carrier, because there is
 * nowhere to put them.
 */
export interface PublicTrackingView {
  audience: TrackingAudience;
  /** The customer's own reference where one exists, else the carrier's. */
  reference: string;
  /** Present only when `visibility.carrierName` was switched on. */
  carrierName?: string;
  /** "Dry van". Never a unit number, a plate or a VIN. */
  equipmentType?: string;
  stops: PublicTrackingStop[];
  /** City and state only, and only while the session is live. */
  truckLocation?: { city?: string; state?: string };
  etaAt?: IsoDateTime;
  lastUpdateAt?: IsoDateTime;
  /** Live, stale, offline or interrupted — said plainly. */
  health?: TrackingSignalHealth;
  healthNote?: string;
  /** Delay and interruption only. Never an internal exception. */
  status: Array<{ kind: TrackingUpdateKind; message: string; at: IsoDateTime; basis: AvailabilityBasis }>;
  /** When the link stops working. Shown so nobody is surprised by it. */
  expiresAt: IsoDateTime;
  /** The honest statement about what this page is and is not. */
  disclosure: string;
}

export type PublicTrackingResult =
  | { ok: true; view: PublicTrackingView }
  | { ok: false; refusal: PublicTrackingRefusal; message: string };
