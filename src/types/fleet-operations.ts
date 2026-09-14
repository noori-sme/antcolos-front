import type { AssetActivationState } from "./asset";
import type { TrailerAttachmentState, TrailerOperatingStatus, TrailerType } from "./trailer";
import type { TruckEquipmentType, TruckOperatingStatus } from "./truck";

/**
 * The shared operational fleet layer.
 *
 * Antcolos already holds the permanent records: the Truck, the Trailer, the
 * Driver, the Carrier relationship, the operating-authority lease, the
 * documents and the compliance paperwork. What it did not have was one place
 * that answers the operational question — *what is actually going on with this
 * equipment right now* — without inventing a second copy of any of it.
 *
 * So nothing here is a new source of truth. Every type in this file is either
 *
 *   DERIVED   computed on read from the permanent records, carrying the
 *             provenance of what it was computed from, or
 *   OBSERVED  a dated reading somebody or something recorded, carrying its
 *             source and the time it was observed.
 *
 * There is deliberately no new status column. A truck's physical state lives on
 * the Truck, the operating authority lives on the lease, the driver lives on
 * the assignment, the trailer's pairing lives on the attachment. This layer
 * reads those five and reconciles them; it never writes a status of its own,
 * because two status fields that can disagree is the bug this layer exists to
 * prevent.
 */

/* -------------------------------------------------------------------------- */
/* Operational status                                                          */
/* -------------------------------------------------------------------------- */

/**
 * One operational vocabulary for power units and trailers alike.
 *
 * This is NOT stored anywhere and is never written back to the Truck or the
 * Trailer. It is the reconciliation of the authoritative records, recomputed on
 * every read, and it is always accompanied by the derivation that produced it.
 */
export type FleetOperationalStatus =
  | "available"
  | "assigned"
  | "expected_available"
  | "in_transit"
  | "maintenance"
  | "out_of_service";

/** Which permanent record decided the status. */
export type FleetStatusSource =
  | "truck_record"
  | "trailer_record"
  | "operating_lease"
  | "trailer_attachment"
  | "availability_record";

/** One fact that was consulted, and what it said. */
export interface FleetStatusInput {
  source: FleetStatusSource;
  /** The raw value on the authoritative record, unmodified. */
  value: string;
  label: string;
}

/**
 * The status, and the audit trail of how it was reached.
 *
 * `inputs` lists every record consulted in the order it was consulted, so a
 * dispatcher who disagrees with the answer can see exactly which record to go
 * and fix — rather than finding two screens that disagree and no way to tell
 * which one is lying.
 */
export interface FleetStatusDerivation {
  status: FleetOperationalStatus;
  /** The record that settled it. */
  decidedBy: FleetStatusSource;
  /** Plain language, in the words an operator would use. */
  reason: string;
  inputs: FleetStatusInput[];
}

/**
 * Whether this organization may operate the equipment right now.
 *
 * Deliberately separate from the status. A truck held under another carrier's
 * operating authority is not broken and not in maintenance — it is simply not
 * yours this week. Collapsing the two into one field is what produces the
 * "why does it say out of service when it is sitting right there" problem.
 *
 * When another carrier holds it, `blockedReason` says so and names nobody:
 * that the equipment is busy is not confidential, who has it is.
 */
export interface FleetAuthorityLock {
  availableToOrganization: boolean;
  /** True only when the block comes from somebody else's active authority. */
  lockedByOtherAuthority: boolean;
  blockedReason?: string;
  /** The viewer's own activation state, straight from the registry. */
  activationState: AssetActivationState;
  /** Named ONLY when this viewer is entitled to know. */
  operatingCarrierName?: string;
}

/* -------------------------------------------------------------------------- */
/* Observed telemetry                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Where a reading came from.
 *
 * Every value in this build is entered by a person or produced by the seeded
 * mock adapter. There is no ELD, GPS, telematics, fuel-card or toll connection,
 * and `mock_adapter` says exactly that rather than dressing a fixture up as a
 * feed. The integration-backed sources exist in the type so the shape does not
 * change when a real one is connected — not because one is.
 */
export type FleetTelemetrySource =
  | "manual_entry"
  | "driver_report"
  | "dispatcher_entry"
  | "mock_adapter"
  | "eld_integration"
  | "gps_integration"
  | "telematics_integration";

export interface FleetLocationReading {
  city?: string;
  state?: string;
  /** Free text as recorded — a yard, a customer, a mile marker. */
  description?: string;
  latitude?: number;
  longitude?: number;
}

/**
 * A dated reading about one asset. Append-only: a correction is a new reading,
 * never an edit, so the history of what was believed and when survives.
 *
 * `observedAt` and `recordedAt` are different on purpose. A driver who calls in
 * at 06:00 and is written up at 09:00 produces one reading with two times, and
 * staleness is measured against the observation, never against the paperwork.
 */
export interface FleetTelemetryReading {
  id: string;
  assetKind: FleetAssetKind;
  assetId: string;
  /** The organization that recorded it. Readings are never shared across orgs. */
  organizationId: string;
  location?: FleetLocationReading;
  odometerMiles?: number;
  engineHours?: number;
  source: FleetTelemetrySource;
  /** The provider a future integration named. Absent for hand-entered rows. */
  providerLabel?: string;
  /** When the fact was true in the world. */
  observedAt: string;
  /** When Antcolos was told. */
  recordedAt: string;
  recordedByMembershipId?: string;
  recordedByName?: string;
  note?: string;
}

/**
 * The latest reading for an asset, plus how old it is.
 *
 * `reading` being absent is a first-class answer and reads as "nobody has ever
 * told us", not as zero miles at the depot.
 */
export interface FleetTelemetrySnapshot {
  reading?: FleetTelemetryReading;
  /** Hours since `observedAt`. Absent when there is no reading at all. */
  ageHours?: number;
  /** True when the reading is older than the freshness expectation below. */
  stale: boolean;
  /** How fresh a reading has to be before this layer stops trusting it. */
  freshnessExpectationHours: number;
}

export type FleetAssetKind = "truck" | "trailer";

/* -------------------------------------------------------------------------- */
/* Assignments                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * One time-bound assignment row, projected from the permanent record that IS it.
 *
 * This layer owns no assignment store. A driver-on-truck row is a
 * TruckDriverAssignment; a trailer-on-truck row is a TrailerAttachment. Both
 * already carry dates and neither is ever deleted, so the immutable history the
 * fleet layer shows is the registry's own history, re-shaped for reading.
 *
 * That is why `sourceId` is here: every row can be traced back to the exact
 * permanent record it came from, and there is nothing to reconcile.
 */
export interface FleetAssignmentRecord {
  id: string;
  kind: "driver_truck" | "trailer_truck";
  organizationId: string;
  truckId: string;
  truckUnit: string;
  driverProfileId?: string;
  driverName?: string;
  trailerId?: string;
  trailerUnit?: string;
  /** Start of the dated interval. Never null — an assignment always began. */
  effectiveFrom: string;
  /** Absent while live. Set when it ended; the row itself is never removed. */
  effectiveTo?: string;
  endReason?: string;
  source: "truck_driver_assignment" | "trailer_attachment";
  sourceId: string;
}

/**
 * The current Driver–Truck–Trailer triad for one power unit.
 *
 * Composed rather than stored. A truck with a driver and no trailer is a
 * perfectly normal triad with one empty leg, and so is a truck with a trailer
 * and nobody on it — which is a thing worth being told about, not a thing to
 * hide by requiring all three.
 */
export interface FleetAssignmentTriad {
  truckId: string;
  truckUnit: string;
  driver?: FleetAssignmentRecord;
  trailer?: FleetAssignmentRecord;
  /** The later of the two effective dates — when this triad became current. */
  effectiveFrom?: string;
}

/* -------------------------------------------------------------------------- */
/* Readiness                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * What Antcolos can honestly say about a piece of paperwork.
 *
 * `not_tracked` and `unknown` are different answers and both are kept.
 * `unknown` means the record exists and we do not have the date; `not_tracked`
 * means Antcolos does not hold this at all, which is the truthful answer for
 * IFTA today — there is no state integration and nothing is being filed.
 */
export type FleetReadinessState =
  | "ready"
  | "expiring_soon"
  | "expired"
  | "missing"
  | "unknown"
  | "not_tracked";

export type FleetReadinessKind = "registration" | "plate" | "permit" | "ifta";

export interface FleetReadinessItem {
  kind: FleetReadinessKind;
  label: string;
  state: FleetReadinessState;
  /** Plain language. Says what is missing, not merely that something is. */
  detail: string;
  expiresAt?: string;
  /**
   * Which record answered. `not_connected` is the honest source for anything
   * that would need an integration Antcolos does not have.
   */
  source: "registration_record" | "document_record" | "not_connected";
}

export interface FleetReadinessSummary {
  items: FleetReadinessItem[];
  /** Items that are expired or missing. The ones that stop a truck at a scale. */
  blocking: number;
  /** Items expiring inside the warning window. */
  warning: number;
}

/* -------------------------------------------------------------------------- */
/* Utilization                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * How the equipment spent a window of time.
 *
 * Derived by walking the dated operating-lease intervals that overlap the
 * window, so the hours add up to the window and every hour is attributable to a
 * record somebody wrote. Nothing is modelled, smoothed or estimated.
 *
 * `fullyDerived` is false when part of the window predates the records we hold
 * — a truck onboarded ten days ago has no thirty-day history, and reporting
 * 67% utilization for it would be arithmetic on nothing.
 */
export interface FleetUtilizationSummary {
  windowDays: number;
  windowStartAt: string;
  windowEndAt: string;
  /** Hours committed to an operating lease — reserved, active or releasing. */
  operatingHours: number;
  /** Hours available and uncommitted. The cost of an idle asset. */
  idleHours: number;
  /** Hours unusable: maintenance or out of service. */
  downtimeHours: number;
  /** operating / (window - downtime), as a percentage. */
  utilizationPct: number;
  /** (window - downtime) / window, as a percentage. */
  availabilityPct: number;
  fullyDerived: boolean;
  /** What the numbers were computed from, stated for the person reading them. */
  basis: string;
}

/* -------------------------------------------------------------------------- */
/* The equipment row                                                           */
/* -------------------------------------------------------------------------- */

/** Where to find the permanent records behind an operational row. */
export interface FleetRecordLink {
  label: string;
  href: string;
  /** Set when the destination module is not built yet. Rendered, not hidden. */
  deferred?: boolean;
}

export interface FleetRecordLinks {
  truck?: FleetRecordLink;
  trailer?: FleetRecordLink;
  driver?: FleetRecordLink;
  carrier?: FleetRecordLink;
  documents?: FleetRecordLink;
  compliance?: FleetRecordLink;
  maintenance?: FleetRecordLink;
  load?: FleetRecordLink;
  mtLoop?: FleetRecordLink;
}

/**
 * One organization's operational view of one permanent asset.
 *
 * A projection, exactly like FleetTruck and FleetTrailer, and for the same
 * reason: two carriers looking at one truck get two different rows from one
 * record, not two trucks. Where FleetTruck answers "what is in my fleet", this
 * answers "what is this equipment doing, and what is stopping it".
 */
export interface FleetEquipmentRow {
  assetKind: FleetAssetKind;
  /** The permanent truckId or trailerId. Never a row id or a unit number. */
  assetId: string;
  /** This organization's label for it. Belongs to the carrier relationship. */
  unit: string;
  /** Power units only. */
  truckEquipmentType?: TruckEquipmentType;
  /** Trailers only. */
  trailerType?: TrailerType;
  /** The raw physical state from the permanent record, unreconciled. */
  recordStatus: TruckOperatingStatus | TrailerOperatingStatus;
  /** Trailers only: the pairing state from the attachment record. */
  attachmentState?: TrailerAttachmentState;
  derivation: FleetStatusDerivation;
  authority: FleetAuthorityLock;
  telemetry: FleetTelemetrySnapshot;
  readiness: FleetReadinessSummary;
  /** The live triad leg for this asset, when there is one. */
  driver?: { driverProfileId: string; driverName: string; since: string };
  pairedTruck?: { truckId: string; unit: string; since: string };
  pairedTrailer?: { trailerId: string; unit: string; since: string };
  /** The carrier whose authority it runs under, when the viewer may know. */
  carrierName?: string;
  /** Set only for the lease holder: its own reference and planned end. */
  myLoadReference?: string;
  leaseExpectedEndAt?: string;
  /** When the asset is expected to come free — the start of the MTloop. */
  expectedAvailableAt?: string;
  documentWarnings: number;
  links: FleetRecordLinks;
}

/* -------------------------------------------------------------------------- */
/* The dashboard                                                               */
/* -------------------------------------------------------------------------- */

/** Counts per operational status. Always the full vocabulary, zeros included. */
export type FleetStatusCounts = Record<FleetOperationalStatus, number>;

export interface FleetFleetSummary {
  total: number;
  counts: FleetStatusCounts;
  /** Assets this organization cannot operate because somebody else holds them. */
  lockedByOtherAuthority: number;
  /** Assets whose newest reading is older than the freshness expectation. */
  staleTelemetry: number;
  /** Assets with an expired or missing registration, plate or permit. */
  readinessBlocking: number;
}

export interface FleetDashboard {
  organizationId: string;
  generatedAt: string;
  trucks: FleetFleetSummary;
  trailers: FleetFleetSummary;
  /** Fleet-wide utilization over the window, averaged across assets. */
  utilization: FleetUtilizationSummary;
  /** Current triads, one per power unit that has at least one live leg. */
  triads: FleetAssignmentTriad[];
  /** The integrations this layer is built to accept. None are connected. */
  integrations: FleetIntegrationDescriptor[];
  /**
   * True when this organization operates no equipment of its own and is
   * looking at equipment shared with it through carrier relationships.
   */
  viewerIsDispatchOrganization: boolean;
}

export interface FleetEquipmentFilters {
  assetKind?: FleetAssetKind;
  status?: FleetOperationalStatus[];
  /** Only equipment this organization may operate right now. */
  availableOnly?: boolean;
  staleOnly?: boolean;
  search?: string;
}

/* -------------------------------------------------------------------------- */
/* Integration extension points                                                */
/* -------------------------------------------------------------------------- */

/**
 * The outside systems this layer is shaped to accept later.
 *
 * Listed so the seam is typed and visible, NOT because any of them is
 * connected. Every descriptor below reports `not_connected`, and every adapter
 * throws rather than returning a plausible-looking fixture — a screen that
 * silently rendered invented hours of service would be worse than one that says
 * nothing is connected.
 */
export type FleetIntegrationKind =
  | "eld"
  | "gps"
  | "telematics"
  | "fuel_card"
  | "toll"
  | "state_registration";

export type FleetIntegrationStatus = "not_connected";

export interface FleetIntegrationDescriptor {
  kind: FleetIntegrationKind;
  label: string;
  /** What it would supply, in the words of the operator who would want it. */
  description: string;
  status: FleetIntegrationStatus;
  /** Which fields on this layer it would populate once connected. */
  wouldPopulate: string[];
  /** The telemetry source rows from it would carry. */
  telemetrySource?: FleetTelemetrySource;
}
