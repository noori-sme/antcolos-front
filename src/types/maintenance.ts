import type { Cents, IsoDateTime, Money } from "./common";
import type { MeterSourceKind } from "./meter";
import type { ActorRef } from "./user";

/**
 * Maintenance.
 *
 * The one rule this module is built around: **maintenance history belongs to
 * the equipment, not to whoever happens to be running it.** A truck sold to a
 * new owner, moved to a new carrier or re-plated is the same physical machine
 * with the same brake job behind it, so every record here hangs off the
 * permanent `truckId` / `trailerId` UUID and nothing else. Ownership and
 * operating-authority changes end relationships; they never edit, re-key or
 * delete a single line of what follows.
 *
 * Four record kinds, deliberately separate and deliberately linked:
 *
 *   MaintenanceRequirement  What the equipment is due for, and when.
 *   ReportedDefect          What somebody found wrong with it.
 *   RepairOrder             The work being organised to put it right.
 *   ServiceRecord           What was actually done. Append-only, forever.
 *
 * They are not merged because they answer different questions, are created by
 * different people at different times, and have different lifetimes. A defect
 * may never produce a repair order. A repair order may cover three
 * requirements and two defects at once. A service record outlives all of them.
 *
 * What this module is NOT, in this build: connected to anything. No ELD, no
 * telematics odometer, no engine-hour feed, no repair shop, no parts catalogue,
 * no warranty registry, no roadside network. Every meter reading here was typed
 * in by a person. The extension points at the bottom of this file describe what
 * those integrations would have to supply; none of them is implemented, and
 * nothing in the UI claims otherwise.
 */

/* -------------------------------------------------------------------------- */
/* Equipment reference                                                         */
/* -------------------------------------------------------------------------- */

/** Trucks and trailers are separate registries and never the same record. */
export type MaintenanceEquipmentKind = "truck" | "trailer";

/**
 * A pointer to a permanent piece of equipment.
 *
 * `equipmentId` is the registry's immutable UUID — `Truck.truckId` or
 * `Trailer.trailerId`. It is never a unit number, a VIN, a plate or an
 * organization-scoped code, because all four of those change while the machine
 * stays the same, and a history that re-keys itself is not a history.
 */
export interface MaintenanceEquipmentRef {
  kind: MaintenanceEquipmentKind;
  equipmentId: string;
}

/**
 * What a viewer is told about the equipment a record points at.
 *
 * Resolved through the truck and trailer registries at read time, so it shows
 * the CURRENT carrier's unit number and never a stale label baked in when the
 * record was written. A viewer entitled to the record but not to the equipment
 * gets `label: "Equipment"` and nothing more.
 */
export interface MaintenanceEquipmentSummary {
  kind: MaintenanceEquipmentKind;
  equipmentId: string;
  /** This organization's label for it, e.g. "Unit 104". */
  unit: string;
  /** "Tractor", "Dry van" — the equipment type in plain words. */
  typeLabel: string;
  /** Where the equipment profile lives, for deep links. */
  href: string;
  /** True while any organization holds this equipment out of service. */
  outOfService: boolean;
}

/* -------------------------------------------------------------------------- */
/* Meters                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Where a meter reading came from.
 *
 * Only `manual` and `driver_report` occur in this build — a person typed the
 * number. The rest are declared so the feed that eventually supplies them has a
 * value to use and the UI already has a word for it, NOT because anything is
 * connected. A reading never silently changes source.
 */
export type MeterSource =
  /**
   * Maintenance's own word for a reading typed into a maintenance screen. The
   * Equipment Meter Ledger calls the same thing `manual_entry`; both are kept
   * because this one is what the screens and the tests have always said.
   */
  | "manual"
  /** Everything else comes straight from the canonical ledger's vocabulary. */
  | MeterSourceKind;

/**
 * Odometer and engine hours as of one moment.
 *
 * Both are optional because they are genuinely independent: a trailer has
 * neither, a tractor has both, and a reading that captured only one must not
 * be completed with a guess at the other. An absent value is absent.
 */
export interface MeterReading {
  /** Whole miles. */
  odometerMiles?: number;
  /** Engine hours to one decimal place, as the hour meter shows them. */
  engineHours?: number;
  /** When the meter actually read this — not when it was typed in. */
  readAt: IsoDateTime;
  source: MeterSource;
  recordedBy?: ActorRef;
  note?: string;
}

/**
 * The latest reading Antcolos holds for one piece of equipment.
 *
 * `staleAfterDays` exists because a mileage-triggered requirement computed from
 * a three-month-old odometer reading is a guess, and the UI says so rather than
 * presenting it as a due date.
 */
export interface EquipmentMeter {
  equipment: MaintenanceEquipmentRef;
  latest?: MeterReading;
  /** Readings beyond this age are shown as out of date, never as current. */
  staleAfterDays: number;
}

/* -------------------------------------------------------------------------- */
/* Requirements                                                                */
/* -------------------------------------------------------------------------- */

/**
 * What makes a requirement come due.
 *
 * Four triggers, because equipment wears out in four different ways: by the
 * calendar (an annual inspection), by distance (an oil change), by running time
 * (a reefer unit service) and by something breaking (a defect somebody
 * reported). They are a discriminated union rather than four optional fields so
 * a requirement cannot be half-configured.
 */
export type MaintenanceTriggerKind = "date" | "mileage" | "engine_hours" | "defect";

export interface DateTrigger {
  kind: "date";
  /** When it is next due. */
  dueAt: IsoDateTime;
  /** Set when it recurs; absent for a one-off. */
  intervalDays?: number;
  /** How many days ahead it starts reading as "due soon". */
  warnDays: number;
}

export interface MileageTrigger {
  kind: "mileage";
  /** Odometer reading at which it falls due. */
  dueAtMiles: number;
  intervalMiles?: number;
  /** How many miles out it starts reading as "due soon". */
  warnMiles: number;
}

export interface EngineHoursTrigger {
  kind: "engine_hours";
  dueAtHours: number;
  intervalHours?: number;
  warnHours: number;
}

/**
 * Raised because somebody reported a defect.
 *
 * There is no interval: this requirement exists once, for this fault, and is
 * finished when the fault is. The deadline is whatever a person set during
 * triage — nothing here invents one.
 */
export interface DefectTrigger {
  kind: "defect";
  defectId: string;
  /** Copied at triage so the requirement still reads correctly later. */
  reportedSeverity: DefectSeverity;
  /** Set by a person during triage. Absent means "no deadline agreed". */
  dueAt?: IsoDateTime;
}

export type MaintenanceTrigger =
  | DateTrigger
  | MileageTrigger
  | EngineHoursTrigger
  | DefectTrigger;

/**
 * Where a requirement is in its life.
 *
 * `in_service` is a state of the requirement, not of the equipment: the work is
 * under way. Equipment being out of service is a separate record
 * (`EquipmentServiceHold`) because a truck can be parked for a reason that has
 * no requirement behind it at all.
 */
export type MaintenanceState =
  | "upcoming"
  | "due_soon"
  | "overdue"
  | "in_service"
  | "completed"
  | "deferred";

/** Grouping for the dashboard. Free-form categories would not sort. */
export type MaintenanceCategory =
  | "inspection"
  | "preventive"
  | "brakes"
  | "tires"
  | "engine"
  | "transmission"
  | "electrical"
  | "reefer"
  | "body"
  | "other";

/**
 * A deliberate, recorded decision to let something run past its due point.
 *
 * Deferral is not snoozing. It carries who decided, why, and until when, and it
 * never applies to a defect that put the equipment out of service — that
 * restriction is enforced in the service layer, not by hoping nobody tries.
 */
export interface MaintenanceDeferral {
  reason: string;
  until?: IsoDateTime;
  deferredAt: IsoDateTime;
  deferredBy: ActorRef;
}

/**
 * One thing a piece of equipment is due for.
 *
 * Attached to the permanent equipment UUID, and recorded by an organization —
 * `organizationId` says who is keeping this schedule, not who may read it.
 * Read access is decided by the caller's CURRENT relationship with the
 * equipment, every time, in the service layer.
 */
export interface MaintenanceRequirement {
  id: string;
  equipment: MaintenanceEquipmentRef;
  /** The organization keeping this schedule. Never a grant of access. */
  organizationId: string;
  title: string;
  description?: string;
  category: MaintenanceCategory;
  trigger: MaintenanceTrigger;
  /** How bad it is to run past due. Drives Needs You severity. */
  criticality: MaintenanceCriticality;
  /** Set while the work is being done, so the state reads `in_service`. */
  activeRepairOrderId?: string;
  /** Set once, when the work is finished. A completed requirement is closed. */
  completedAt?: IsoDateTime;
  /** The immutable record produced by completing it. */
  completedServiceRecordId?: string;
  deferral?: MaintenanceDeferral;
  /** The membership answerable for it. Name resolved at read time. */
  responsibleMembershipId?: string;
  /** Documents already in the Documents system. Never a second copy. */
  documentIds: string[];
  notes?: string;
  createdAt: IsoDateTime;
  createdBy: ActorRef;
}

/**
 * How much it matters that this is late.
 *
 * Separate from defect severity: a missed annual inspection is a compliance
 * problem with no symptom, while a cracked mirror is a visible fault that stops
 * nothing. The two scales do not convert into one another.
 */
export type MaintenanceCriticality = "routine" | "important" | "safety_critical";

/**
 * A requirement plus everything the UI needs to render it, computed at read
 * time. Never stored: it depends on today's date and today's meter.
 */
export interface MaintenanceRequirementView {
  requirement: MaintenanceRequirement;
  equipment: MaintenanceEquipmentSummary;
  state: MaintenanceState;
  due: MaintenanceDueSummary;
  /** Resolved from the membership, or undefined when nobody is named. */
  responsibleName?: string;
  /** Set when the requirement came from a defect the viewer may also see. */
  defect?: ReportedDefect;
}

/**
 * How far off the due point is, in whatever unit the trigger uses.
 *
 * Negative remaining values mean overdue by that much. `unknown` is honest:
 * a mileage trigger with no odometer reading cannot be answered, and the UI
 * shows "no reading" rather than inventing a number.
 */
export interface MaintenanceDueSummary {
  kind: MaintenanceTriggerKind;
  /** A short phrase for a table cell: "in 12 days", "1,200 mi over". */
  label: string;
  /** True when nothing recorded can answer the question. */
  unknown: boolean;
  /** True when the meter behind a distance/hours answer is out of date. */
  meterStale?: boolean;
  remainingDays?: number;
  remainingMiles?: number;
  remainingHours?: number;
  dueAt?: IsoDateTime;
}

/* -------------------------------------------------------------------------- */
/* Driver-reported defects                                                     */
/* -------------------------------------------------------------------------- */

/**
 * How bad the fault is.
 *
 * `out_of_service` is the one that must not be softened by a later edit: it is
 * the driver saying this equipment should not move. The service layer treats it
 * as a hard stop — it cannot be deferred, and it raises a critical Needs You
 * item whatever else is going on.
 */
export type DefectSeverity = "minor" | "major" | "critical" | "out_of_service";

/**
 * What the fault does to the equipment's usefulness.
 *
 * Recorded separately from severity because they genuinely differ: a failed
 * reefer unit is `out_of_service` for reefer freight and perfectly fine as a
 * dry van, and a dispatcher needs that distinction to plan.
 */
export type EquipmentAvailabilityImpact =
  | "none"
  | "reduced"
  | "out_of_service";

/** Where on the equipment the fault is. Drives filtering and routing. */
export type DefectArea =
  | "brakes"
  | "tires_wheels"
  | "lights_electrical"
  | "steering_suspension"
  | "engine"
  | "transmission_driveline"
  | "coupling"
  | "reefer_unit"
  | "body_doors"
  | "safety_equipment"
  | "other";

export type DefectState =
  | "reported"
  | "acknowledged"
  | "in_repair"
  | "resolved"
  | "dismissed";

/**
 * Something a driver (or anybody else) found wrong.
 *
 * Attached to the equipment, never to the load it happened on and never to the
 * driver's record — the truck keeps the fault history when the driver leaves.
 * `reportedByName` is a snapshot so it still reads correctly afterwards.
 */
export interface ReportedDefect {
  id: string;
  equipment: MaintenanceEquipmentRef;
  /** The organization the reporter was acting inside. */
  organizationId: string;
  area: DefectArea;
  severity: DefectSeverity;
  availabilityImpact: EquipmentAvailabilityImpact;
  summary: string;
  detail?: string;
  state: DefectState;
  reportedAt: IsoDateTime;
  reportedBy: ActorRef;
  /** Set when a driver reported it, so their own reports can be shown back. */
  reportedByDriverProfileId?: string;
  /** Snapshot: survives the person leaving the organization. */
  reportedByName: string;
  /** The load being run when it was found, when there was one. */
  loadId?: string;
  /** Meter as it read when the fault was found. */
  meterAtReport?: MeterReading;
  /** Photographs and paperwork, held in the Documents system. */
  documentIds: string[];
  /** The requirement raised from it during triage, when one was. */
  requirementId?: string;
  repairOrderId?: string;
  resolvedAt?: IsoDateTime;
  resolutionNote?: string;
  /** Append-only. Every acknowledgement, hand-off and note, in order. */
  history: MaintenanceHistoryEntry[];
}

/* -------------------------------------------------------------------------- */
/* Vendors, cost and downtime                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Who did the work.
 *
 * A plain record typed in by the carrier. It is NOT a shop integration, a
 * directory lookup or a verified business: nothing here was checked against
 * anything, and the UI never implies it was.
 */
export interface MaintenanceVendor {
  id: string;
  organizationId: string;
  name: string;
  kind: MaintenanceVendorKind;
  phone?: string;
  city?: string;
  state?: string;
  notes?: string;
  createdAt: IsoDateTime;
}

export type MaintenanceVendorKind =
  | "in_house"
  | "dealer"
  | "independent_shop"
  | "mobile_service"
  | "tire_service"
  | "roadside";

/**
 * The vendor as it read when the work was done.
 *
 * Service history keeps this snapshot rather than a live reference, so renaming
 * or deleting a vendor cannot rewrite what a record says happened.
 */
export interface MaintenanceVendorSnapshot {
  vendorId?: string;
  name: string;
  kind: MaintenanceVendorKind;
  city?: string;
  state?: string;
}

/**
 * What it cost.
 *
 * Every figure is integer minor units through `Money`, so nothing in the money
 * path is a float. Estimate and actual are both kept: the gap between them is
 * the thing a fleet owner wants to see.
 */
export interface MaintenanceCost {
  estimate?: Money;
  actual?: Money;
  parts?: Money;
  labor?: Money;
  tax?: Money;
}

/**
 * How long the equipment was unusable.
 *
 * `hours` is recorded rather than derived from the timestamps, because a
 * machine sitting in a yard over a weekend waiting for a part was not being
 * worked on for 48 hours, and a clock cannot tell the difference.
 */
export interface MaintenanceDowntime {
  startedAt?: IsoDateTime;
  endedAt?: IsoDateTime;
  /** Hours the equipment was actually unavailable, as recorded by a person. */
  hours?: number;
}

/* -------------------------------------------------------------------------- */
/* Repair orders                                                               */
/* -------------------------------------------------------------------------- */

export type RepairOrderStatus =
  | "draft"
  | "open"
  | "scheduled"
  | "in_progress"
  | "awaiting_parts"
  | "completed"
  | "cancelled";

/** One line of work or one part. Deliberately simple in this milestone. */
export interface RepairOrderLine {
  id: string;
  kind: "labor" | "part" | "fee";
  description: string;
  quantity?: number;
  unitCostCents?: Cents;
  totalCents: Cents;
}

/**
 * The work being organised.
 *
 * A repair order is the *plan and its progress*; the `ServiceRecord` it
 * produces is the *record of what happened*. Keeping them apart is what lets a
 * repair order be edited, re-costed, rescheduled and cancelled while history
 * stays immutable.
 *
 * One repair order can answer several requirements and several defects at once,
 * which is why those are arrays and not single ids.
 */
export interface RepairOrder {
  id: string;
  /** Human-readable, e.g. "RO-1043". Unique inside the organization. */
  number: string;
  equipment: MaintenanceEquipmentRef;
  organizationId: string;
  status: RepairOrderStatus;
  title: string;
  vendor?: MaintenanceVendorSnapshot;
  lines: RepairOrderLine[];
  cost: MaintenanceCost;
  downtime: MaintenanceDowntime;
  /** The membership answerable for this work. */
  responsibleMembershipId?: string;
  /** Snapshot, so it still reads correctly after they leave. */
  responsibleName?: string;
  scheduledFor?: IsoDateTime;
  openedAt: IsoDateTime;
  openedBy: ActorRef;
  completedAt?: IsoDateTime;
  cancelledAt?: IsoDateTime;
  cancellationReason?: string;
  /** What this work is answering. Both may be empty for ad-hoc work. */
  requirementIds: string[];
  defectIds: string[];
  documentIds: string[];
  notes?: string;
  /** Append-only resolution history. Never edited, never reordered. */
  history: MaintenanceHistoryEntry[];
  /** The immutable record produced on completion. */
  serviceRecordId?: string;
}

/* -------------------------------------------------------------------------- */
/* Service history — immutable                                                 */
/* -------------------------------------------------------------------------- */

/**
 * What was actually done to this machine.
 *
 * **This is the permanent record and it is never mutated.** There is no update
 * and no delete anywhere in the service layer for a `ServiceRecord`; a mistake
 * is corrected by appending a correcting record that points back with
 * `correctsServiceRecordId`, exactly as the load event timeline does.
 *
 * Everything a later reader needs is snapshotted here — the organization, the
 * vendor, the cost, the person answerable, the requirement's title. That is
 * what makes the history survive the equipment being sold: the carrier that did
 * the work is named in the record even after its relationship has ended, and
 * nothing has to be looked up in a relationship that no longer exists.
 */
export interface ServiceRecord {
  id: string;
  equipment: MaintenanceEquipmentRef;
  /** When the work was done in the real world. History is ordered by this. */
  performedAt: IsoDateTime;
  /** When Antcolos learned about it. Differs for work recorded after the fact. */
  recordedAt: IsoDateTime;
  category: MaintenanceCategory;
  title: string;
  summary?: string;
  /**
   * The organization the work was done for, snapshotted by id AND name.
   * A later ownership or carrier change never rewrites either.
   */
  performedForOrganizationId: string;
  performedForOrganizationName: string;
  vendor?: MaintenanceVendorSnapshot;
  cost?: MaintenanceCost;
  downtimeHours?: number;
  /** Odometer and hours as they read when the work was done. */
  meter?: MeterReading;
  /** Snapshot of whoever was answerable. Not a live membership reference. */
  responsibleName?: string;
  responsibleMembershipId?: string;
  /** What it answered, by id and by snapshotted title. */
  requirementId?: string;
  requirementTitle?: string;
  repairOrderId?: string;
  repairOrderNumber?: string;
  defectIds: string[];
  documentIds: string[];
  notes?: string;
  recordedBy: ActorRef;
  /** Set on a correcting record. The original is never touched. */
  correctsServiceRecordId?: string;
}

/* -------------------------------------------------------------------------- */
/* Out of service                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Equipment held out of service.
 *
 * A separate record from any defect or repair order, because the reasons do not
 * always line up: equipment can be parked pending an inspection with no fault
 * reported, and a serious fault can be reported on equipment already parked for
 * something else. Placing and releasing are both recorded with who did it.
 */
export interface EquipmentServiceHold {
  id: string;
  equipment: MaintenanceEquipmentRef;
  organizationId: string;
  reason: string;
  placedAt: IsoDateTime;
  placedBy: ActorRef;
  releasedAt?: IsoDateTime;
  releasedBy?: ActorRef;
  releaseNote?: string;
  /** What put it here, when something did. */
  sourceDefectId?: string;
  sourceRepairOrderId?: string;
}

/* -------------------------------------------------------------------------- */
/* History entries                                                             */
/* -------------------------------------------------------------------------- */

export type MaintenanceHistoryAction =
  | "created"
  | "acknowledged"
  | "assigned"
  | "state_changed"
  | "scheduled"
  | "deferred"
  | "deferral_cleared"
  | "cost_recorded"
  | "vendor_assigned"
  | "document_linked"
  | "placed_out_of_service"
  | "returned_to_service"
  | "resolved"
  | "reopened"
  | "cancelled"
  | "note";

/**
 * One line of a record's resolution history. Append-only: entries are never
 * edited, reordered or removed, on any record kind that carries them.
 */
export interface MaintenanceHistoryEntry {
  id: string;
  at: IsoDateTime;
  actor: ActorRef;
  action: MaintenanceHistoryAction;
  note?: string;
  /** For state changes, what it was and what it became. */
  previousValue?: string;
  newValue?: string;
}

/* -------------------------------------------------------------------------- */
/* Sharing with dispatch organizations                                         */
/* -------------------------------------------------------------------------- */

/**
 * What a dispatch organization may see of a carrier's maintenance.
 *
 * Dispatch organizations and individual dispatchers plan freight; they do not
 * run the shop. Holding dispatch access to a truck is deliberately NOT enough
 * to see its maintenance — a carrier must share it explicitly, and even then
 * the default scope is the only thing a dispatcher actually needs: whether the
 * equipment can take a load and when it is free again.
 */
export type MaintenanceShareScope =
  /** Out-of-service state and expected return only. No schedule, no money. */
  | "availability_only"
  /** The above plus what is due and when. Still no cost, vendor or notes. */
  | "availability_and_schedule";

export type MaintenanceShareStatus = "active" | "suspended" | "ended";

export interface MaintenanceShare {
  id: string;
  equipment: MaintenanceEquipmentRef;
  /** The carrier giving the access. */
  grantedByOrganizationId: string;
  grantedByOrganizationName: string;
  /** The dispatch organization receiving it. */
  sharedWithOrganizationId: string;
  scope: MaintenanceShareScope;
  status: MaintenanceShareStatus;
  /** Why this was shared. Required, so a grant is never unexplained. */
  reason: string;
  startedAt: IsoDateTime;
  endedAt?: IsoDateTime;
  createdBy: ActorRef;
}

/**
 * The reduced view a shared-with dispatch organization gets.
 *
 * Note what is not on it: no cost, no vendor, no notes, no defect detail, no
 * driver name. It answers "can I put a load on this?" and stops there.
 */
export interface SharedMaintenanceView {
  equipment: MaintenanceEquipmentSummary;
  scope: MaintenanceShareScope;
  outOfService: boolean;
  outOfServiceReason?: string;
  expectedBackAt?: IsoDateTime;
  /** Only under "availability_and_schedule", and only state plus due label. */
  openRequirements?: Array<{
    id: string;
    title: string;
    state: MaintenanceState;
    dueLabel: string;
  }>;
  /** Count only. A dispatcher is told there are faults, not what they are. */
  openDefectCount: number;
  sharedByOrganizationName: string;
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                   */
/* -------------------------------------------------------------------------- */

/** The counts across everything the caller may actually see. */
export interface MaintenanceSummary {
  overdue: number;
  dueSoon: number;
  upcoming: number;
  inService: number;
  deferred: number;
  completedLast30Days: number;
  openDefects: number;
  criticalDefects: number;
  openRepairOrders: number;
  equipmentOutOfService: number;
  /** Only when the caller holds the cost permission; otherwise absent. */
  costLast30Days?: Money;
  /** Only when the caller holds the cost permission; otherwise absent. */
  downtimeHoursLast30Days?: number;
}

/* -------------------------------------------------------------------------- */
/* Extension points for integrations that do not exist yet                     */
/* -------------------------------------------------------------------------- */

/**
 * Everything maintenance will eventually want to talk to.
 *
 * These are TYPES ONLY. Not one of them is implemented, connected, configured
 * or stubbed with plausible data. They are here so that the milestone that
 * builds each one has a contract to build against, and so the integrations
 * screen can list them honestly as "not connected" rather than inventing a
 * status.
 */
export type MaintenanceIntegrationKind =
  | "eld"
  | "odometer_feed"
  | "engine_hours_feed"
  | "shop"
  | "parts"
  | "tire"
  | "warranty"
  | "roadside";

/**
 * The only status any of these has in this build.
 *
 * There is deliberately no "connected" member: a value the code cannot produce
 * cannot be rendered by accident. When an integration is genuinely built, this
 * union gains the states that adapter can actually reach.
 */
export type MaintenanceIntegrationStatus = "not_connected";

export interface MaintenanceIntegrationPoint {
  kind: MaintenanceIntegrationKind;
  label: string;
  /** What it would do, in the operator's words. */
  description: string;
  /** What the adapter must supply before it can be switched on. */
  provides: string;
  status: MaintenanceIntegrationStatus;
}

/**
 * A feed that reports odometer or engine hours without a person typing them.
 * ELD, telematics and odometer-feed adapters all implement this one shape.
 */
export interface MeterFeedAdapter {
  readonly kind: Extract<
    MaintenanceIntegrationKind,
    "eld" | "odometer_feed" | "engine_hours_feed"
  >;
  /** Latest reading for one machine, or null when the feed has none. */
  readMeter(equipment: MaintenanceEquipmentRef): Promise<MeterReading | null>;
}

/** A repair shop that can accept, schedule and report back on work. */
export interface ShopAdapter {
  readonly kind: Extract<MaintenanceIntegrationKind, "shop">;
  submitRepairOrder(order: RepairOrder): Promise<{ externalId: string }>;
  fetchStatus(externalId: string): Promise<RepairOrderStatus>;
}

/** A parts catalogue and availability lookup. */
export interface PartsAdapter {
  readonly kind: Extract<MaintenanceIntegrationKind, "parts">;
  lookUpPart(partNumber: string): Promise<{
    partNumber: string;
    description: string;
    priceCents?: Cents;
    availableQuantity?: number;
  } | null>;
}

/** Tire-specific telemetry and tread/pressure history. */
export interface TireAdapter {
  readonly kind: Extract<MaintenanceIntegrationKind, "tire">;
  readPositions(equipment: MaintenanceEquipmentRef): Promise<Array<{
    position: string;
    treadDepth32nds?: number;
    pressurePsi?: number;
    readAt: IsoDateTime;
  }>>;
}

/** Whether a given repair is covered, and by whom. */
export interface WarrantyAdapter {
  readonly kind: Extract<MaintenanceIntegrationKind, "warranty">;
  checkCoverage(
    equipment: MaintenanceEquipmentRef,
    component: string,
  ): Promise<{ covered: boolean; expiresAt?: IsoDateTime; provider?: string }>;
}

/** Emergency roadside dispatch for a breakdown. */
export interface RoadsideAdapter {
  readonly kind: Extract<MaintenanceIntegrationKind, "roadside">;
  requestAssistance(input: {
    equipment: MaintenanceEquipmentRef;
    defectId?: string;
    note: string;
  }): Promise<{ ticketId: string }>;
}

/**
 * The adapter set the maintenance service would consult.
 *
 * Every member is `null` in this build and the type says so — `null` is part of
 * each member's type, so a caller is forced to handle "not connected" and
 * cannot write code that assumes a feed exists.
 */
export interface MaintenanceAdapters {
  eld: MeterFeedAdapter | null;
  odometer: MeterFeedAdapter | null;
  engineHours: MeterFeedAdapter | null;
  shop: ShopAdapter | null;
  parts: PartsAdapter | null;
  tire: TireAdapter | null;
  warranty: WarrantyAdapter | null;
  roadside: RoadsideAdapter | null;
}
