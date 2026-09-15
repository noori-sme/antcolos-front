import type {
  ActorRef,
  DefectArea,
  DefectSeverity,
  DefectState,
  EquipmentAvailabilityImpact,
  EquipmentMeter,
  EquipmentServiceHold,
  MaintenanceCategory,
  MaintenanceCriticality,
  MaintenanceDeferral,
  MaintenanceEquipmentKind,
  MaintenanceEquipmentRef,
  MaintenanceEquipmentSummary,
  MaintenanceHistoryEntry,
  MaintenanceRequirement,
  MaintenanceRequirementView,
  MaintenanceShare,
  MaintenanceShareScope,
  MaintenanceState,
  MaintenanceSummary,
  MaintenanceTrigger,
  MaintenanceVendor,
  MeterReading,
  Money,
  NeedsYouItem,
  NeedsYouSeverity,
  PermissionKey,
  RepairOrder,
  RepairOrderLine,
  RepairOrderStatus,
  ReportedDefect,
  ServiceRecord,
  SharedMaintenanceView,
} from "@/types";
import {
  dueSummary, nextTriggerAfterCompletion, requirementState, urgencyScore,
} from "@/lib/maintenance/triggers";
import { MAINTENANCE_CATEGORY_LABEL } from "@/lib/maintenance/labels";
import { accessReason, fleetSync, type TruckContext } from "./truck-registry";
import {
  trailerAccessReason, trailerFleetSync, type TrailerContext,
} from "./trailer-registry";
import { TRUCK_IDS } from "./truck-registry";
import { TRAILER_IDS } from "./trailer-registry";
import { contributeMeterReading, meterReadings, meterStateOf } from "./meter-ledger";
import { EQUIPMENT_LABEL } from "@/lib/fleet/equipment";
import { TRAILER_TYPE_LABEL } from "@/lib/fleet/trailer-equipment";

/**
 * ███ MOCK ONLY — NOT A BACKEND, AND NOT CONNECTED TO ANYTHING ███
 *
 * THE maintenance registry.
 *
 * Like the truck and trailer registries it is deliberately NOT partitioned by
 * organization, because maintenance history belongs to the machine. Records are
 * keyed by the permanent `truckId` / `trailerId` UUID and nothing else, so an
 * ownership transfer or a carrier change cannot touch a single line of what
 * happened to the equipment. What those changes DO affect is who can read it,
 * and that is recomputed from current relationships on every single call.
 *
 * Four questions this file answers, in this order, for every read and write:
 *
 *   1. Does the caller hold the permission?          -> requirePermissions
 *   2. Can they see this equipment at all, today?    -> equipmentAccess
 *   3. Is this record their organization's?          -> own-org filters
 *   4. How much of it are they entitled to?          -> projections / redaction
 *
 * Screens do none of that. Hiding a button is a courtesy; this is the boundary.
 *
 * Nothing here reads an ELD, a telematics feed, a shop system, a parts
 * catalogue, a tire sensor, a warranty registry or a roadside network. Every
 * meter reading in the fixtures was "typed in by a person", and the records say
 * so. See `@/lib/maintenance/integrations` for the extension points.
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const LATENCY_MS = 320;

const now = () => new Date();
const iso = (d: Date) => d.toISOString();
const daysFromNow = (n: number) => {
  const d = now();
  d.setDate(d.getDate() + n);
  return iso(d);
};
const daysAgo = (n: number) => daysFromNow(-n);
const hoursAgo = (n: number) => iso(new Date(Date.now() - n * 3_600_000));

let seq = 0;
const rowId = (prefix: string) => `${prefix}_${(++seq).toString(36)}${Date.now().toString(36)}`;

const usd = (dollars: number): Money => ({ amount: Math.round(dollars * 100), currency: "USD" });

const SYSTEM_ACTOR: ActorRef = {
  userId: "system",
  membershipId: "system",
  displayNameSnapshot: "Antcolos",
  source: "system",
};

/* -------------------------------------------------------------------------- */
/* Context and errors                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The caller. An organization plus the permissions of the membership acting
 * inside it — never a user, and never an organization a form supplied.
 */
export interface MaintenanceContext {
  organizationId: string;
  organizationName: string;
  membershipId: string;
  actor: ActorRef;
  permissions: ReadonlySet<PermissionKey>;
  /** Set when the membership is scoped to its own records. */
  driverProfileId?: string;
}

export class MaintenancePermissionError extends Error {
  constructor(readonly required: PermissionKey[]) {
    super(`Missing permission: ${required.join(", ")}`);
    this.name = "MaintenancePermissionError";
  }
}

/**
 * A record the caller may not see and a record that does not exist are the same
 * answer. Anything else turns an id field into a directory of other carriers'
 * shop bills.
 */
export class MaintenanceNotFoundError extends Error {
  constructor(what = "Maintenance record") {
    super(`${what} not found`);
    this.name = "MaintenanceNotFoundError";
  }
}

/** Raised when a rule — not a permission — forbids the write. */
export class MaintenanceRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaintenanceRuleError";
  }
}

function requirePermissions(ctx: MaintenanceContext, ...keys: PermissionKey[]) {
  const missing = keys.filter((k) => !ctx.permissions.has(k));
  if (missing.length) throw new MaintenancePermissionError(missing);
}

/**
 * Builds a maintenance context from the same shape every other service takes.
 *
 * The organization comes from the authenticated membership and nowhere else.
 */
export function maintenanceContextFrom(ctx: {
  organizationId: string;
  organizationName?: string;
  membershipId: string;
  permissions: ReadonlySet<PermissionKey>;
  actor: ActorRef;
  driverProfileId?: string;
  scope?: { loads: "all" | "assigned" };
}): MaintenanceContext {
  return {
    organizationId: ctx.organizationId,
    organizationName: ctx.organizationName ?? ctx.organizationId,
    membershipId: ctx.membershipId,
    actor: ctx.actor,
    permissions: ctx.permissions,
    driverProfileId: ctx.scope?.loads === "assigned" ? ctx.driverProfileId : undefined,
  };
}

/** The equipment registries take their own context shape. Derived, never stored. */
function truckCtx(ctx: MaintenanceContext): TruckContext {
  return {
    organizationId: ctx.organizationId,
    membershipId: ctx.membershipId,
    actorName: ctx.actor.displayNameSnapshot,
    permissions: ctx.permissions,
    driverProfileId: ctx.driverProfileId,
  };
}

function trailerCtx(ctx: MaintenanceContext): TrailerContext {
  return {
    organizationId: ctx.organizationId,
    membershipId: ctx.membershipId,
    actorName: ctx.actor.displayNameSnapshot,
    permissions: ctx.permissions,
    driverProfileId: ctx.driverProfileId,
  };
}

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

interface RegistryState {
  requirements: MaintenanceRequirement[];
  defects: ReportedDefect[];
  repairOrders: RepairOrder[];
  /** Append-only. Nothing in this file ever mutates or removes an entry. */
  serviceRecords: ServiceRecord[];
  holds: EquipmentServiceHold[];
  vendors: MaintenanceVendor[];
  shares: MaintenanceShare[];
  /** Per-item workflow state for the Needs You items maintenance derives. */
  needsYouOverlay: Record<string, NeedsYouOverlay>;
}

let registry: RegistryState | null = null;

function db(): RegistryState {
  if (!registry) registry = buildFixtures();
  return registry;
}

/** Test hook. Never called by the UI. */
export function resetMaintenanceRegistry() {
  seq = 0;
  registry = buildFixtures();
}

/* -------------------------------------------------------------------------- */
/* Equipment access                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Why — if at all — this caller may see this equipment's maintenance.
 *
 * Note what `dispatch_access` does NOT give: being allowed to dispatch a truck
 * is not being allowed to read its shop history. A dispatch organization gets
 * maintenance only where a carrier has explicitly shared it, and then only the
 * reduced view. That is the whole rule, in one branch.
 */
export type MaintenanceAccess =
  /** Carrier running it, or its recorded owner. Full maintenance. */
  | { kind: "operator" }
  /** The driver on the truck. Their own reports and safety-relevant state. */
  | { kind: "assigned_driver" }
  /** A dispatch organization a carrier has shared this equipment with. */
  | { kind: "shared_dispatch"; share: MaintenanceShare };

export function equipmentAccess(
  ref: MaintenanceEquipmentRef,
  ctx: MaintenanceContext,
): MaintenanceAccess | null {
  const reason =
    ref.kind === "truck"
      ? accessReason(ref.equipmentId, truckCtx(ctx))
      : trailerAccessReason(ref.equipmentId, trailerCtx(ctx));

  if (reason === null) return null;
  // A relationship that has only been asked for is not a relationship yet.
  if (reason === "pending_relationship") return null;

  if (reason === "operating_carrier" || reason === "owner") {
    // A driver membership never gets the operator view of the whole fleet, even
    // though their organization runs it. Their scope is the truck they are on,
    // which `fleetSync` already narrows for us.
    if (ctx.driverProfileId) {
      return isDriverEquipment(ref, ctx) ? { kind: "assigned_driver" } : null;
    }
    return { kind: "operator" };
  }

  if (reason === "assigned_driver") return { kind: "assigned_driver" };

  if (reason === "dispatch_access") {
    const share = activeShare(ref, ctx.organizationId);
    return share ? { kind: "shared_dispatch", share } : null;
  }

  return null;
}

/** The equipment this driver membership is actually on, per the registries. */
function isDriverEquipment(ref: MaintenanceEquipmentRef, ctx: MaintenanceContext): boolean {
  if (ref.kind === "truck") {
    return fleetSync(truckCtx(ctx)).some((t) => t.truckId === ref.equipmentId);
  }
  return trailerFleetSync(trailerCtx(ctx)).some((t) => t.trailerId === ref.equipmentId);
}

function activeShare(ref: MaintenanceEquipmentRef, dispatchOrganizationId: string) {
  return db().shares.find(
    (s) =>
      sameEquipment(s.equipment, ref) &&
      s.sharedWithOrganizationId === dispatchOrganizationId &&
      s.status === "active",
  );
}

export function sameEquipment(a: MaintenanceEquipmentRef, b: MaintenanceEquipmentRef): boolean {
  return a.kind === b.kind && a.equipmentId === b.equipmentId;
}

/**
 * Full maintenance access, or nothing. Used by every operator-only read.
 *
 * Throws not-found rather than forbidden: see `MaintenanceNotFoundError`.
 */
function requireOperator(ref: MaintenanceEquipmentRef, ctx: MaintenanceContext) {
  const access = equipmentAccess(ref, ctx);
  if (access?.kind !== "operator") throw new MaintenanceNotFoundError("Equipment");
  return access;
}

/* -------------------------------------------------------------------------- */
/* Equipment projection                                                        */
/* -------------------------------------------------------------------------- */

/**
 * What the caller is told about the equipment a record points at.
 *
 * Resolved through the fleet projections, so it always shows THIS
 * organization's current unit number rather than a label frozen into the
 * maintenance record when it was written. Equipment the caller cannot see
 * resolves to a deliberately blank summary — a record is never allowed to leak
 * a unit number sideways.
 */
export function equipmentSummary(
  ref: MaintenanceEquipmentRef,
  ctx: MaintenanceContext,
): MaintenanceEquipmentSummary {
  const outOfService = isOutOfService(ref);

  if (ref.kind === "truck") {
    const truck = fleetSync(truckCtx(ctx)).find((t) => t.truckId === ref.equipmentId);
    return {
      kind: "truck",
      equipmentId: ref.equipmentId,
      unit: truck ? `Unit ${truck.unit}` : "Equipment",
      typeLabel: truck ? EQUIPMENT_LABEL[truck.equipment] : "Truck",
      href: `/fleet/trucks/${ref.equipmentId}`,
      outOfService,
    };
  }

  const trailer = trailerFleetSync(trailerCtx(ctx)).find((t) => t.trailerId === ref.equipmentId);
  return {
    kind: "trailer",
    equipmentId: ref.equipmentId,
    unit: trailer ? `Unit ${trailer.unit}` : "Equipment",
    typeLabel: trailer ? TRAILER_TYPE_LABEL[trailer.trailerType] : "Trailer",
    href: `/fleet/trailers/${ref.equipmentId}`,
    outOfService,
  };
}

/**
 * What this caller is, to maintenance.
 *
 * Derived from relationships rather than from whether any records happen to
 * exist, so a dispatch organization with nothing shared yet still gets the
 * dispatch answer instead of an empty carrier dashboard implying it could run
 * a shop. A carrier that has onboarded equipment but recorded nothing is still
 * an operator, and its screen should say so.
 */
export type MaintenanceRole = "operator" | "assigned_driver" | "dispatch_viewer";

export function maintenanceRole(ctx: MaintenanceContext): MaintenanceRole {
  const accesses = [
    ...fleetSync(truckCtx(ctx)).map(
      (t) => equipmentAccess({ kind: "truck", equipmentId: t.truckId }, ctx),
    ),
    ...trailerFleetSync(trailerCtx(ctx)).map(
      (t) => equipmentAccess({ kind: "trailer", equipmentId: t.trailerId }, ctx),
    ),
  ];

  if (accesses.some((a) => a?.kind === "operator")) return "operator";
  if (accesses.some((a) => a?.kind === "assigned_driver")) return "assigned_driver";
  return "dispatch_viewer";
}

/** Every piece of equipment this caller may keep maintenance on. */
export function maintainableEquipment(ctx: MaintenanceContext): MaintenanceEquipmentRef[] {
  const refs: MaintenanceEquipmentRef[] = [
    ...fleetSync(truckCtx(ctx)).map(
      (t): MaintenanceEquipmentRef => ({ kind: "truck", equipmentId: t.truckId }),
    ),
    ...trailerFleetSync(trailerCtx(ctx)).map(
      (t): MaintenanceEquipmentRef => ({ kind: "trailer", equipmentId: t.trailerId }),
    ),
  ];
  return refs.filter((ref) => equipmentAccess(ref, ctx) !== null);
}

/* -------------------------------------------------------------------------- */
/* Meters                                                                      */
/* -------------------------------------------------------------------------- */

const DEFAULT_METER_STALE_DAYS = 21;

/**
 * Maintenance's view of the equipment's meter — a PROJECTION, not a store.
 *
 * Maintenance used to keep its own `EquipmentMeter` per truck, which is how one
 * physical odometer came to have two values: this registry's and the fleet
 * telemetry store's. It keeps none now. The accepted odometer and engine hours
 * come from the canonical Equipment Meter Ledger, which every contributor —
 * maintenance, fleet operations, fuel receipts, and later an ELD — appends to.
 *
 * Which is why an oil change now comes due from a fuel receipt with nobody
 * typing mileage in twice: the receipt's odometer is a reading, the ledger
 * accepts it, and `requirementState` reads the ledger's answer.
 *
 * Returns `undefined` when nothing has ever been reported. That is a
 * first-class answer, and the trigger logic turns it into "no odometer
 * reading" rather than guessing.
 */
export function meterFor(ref: MaintenanceEquipmentRef): EquipmentMeter | undefined {
  const state = meterStateOf(ref.equipmentId);
  if (!state.odometer && !state.engineHours) return undefined;

  // The reading that supplied whichever meter was read most recently carries
  // the attribution a screen shows.
  const newest = [state.odometer, state.engineHours]
    .filter((v) => v !== undefined)
    .sort((a, b) => Date.parse(b!.readAt) - Date.parse(a!.readAt))[0]!;
  // Attribution comes off the reading itself. Unscoped on purpose: whether this
  // caller may see the equipment at all was decided before we got here, and the
  // odometer of a physical truck is one number whoever reported it.
  const reading = meterReadings(ref.equipmentId)
    .find((r) => r.readingId === newest.readingId);

  return {
    equipment: ref,
    latest: {
      odometerMiles: state.odometer?.value,
      engineHours: state.engineHours?.value,
      readAt: newest.readAt,
      source: newest.source === "manual_entry" ? "manual" : newest.source,
      recordedBy: reading?.recordedBy,
      note: reading?.note,
    },
    staleAfterDays: DEFAULT_METER_STALE_DAYS,
  };
}

/** How maintenance describes a reading it is contributing to the ledger. */
function maintenanceScope(ctx: MaintenanceContext) {
  return {
    organizationId: ctx.organizationId,
    carrierOrganizationId: ctx.organizationId,
  };
}

const MAINTENANCE_PROVENANCE = (at: string) => ({
  module: "telematics" as const,
  adapter: "mock:maintenance-registry",
  mock: true,
  observedAt: at,
  receivedAt: at,
});

/**
 * Record an odometer or hour-meter reading.
 *
 * Manual by definition in this build. The reading carries its source and who
 * entered it, and the UI shows both, so nobody mistakes a typed number for a
 * feed. A reading that goes backwards is refused: meters do not run down, and
 * silently accepting one would quietly un-due every mileage requirement.
 */
export async function recordMeterReading(
  ref: MaintenanceEquipmentRef,
  reading: { odometerMiles?: number; engineHours?: number; readAt?: string; note?: string },
  ctx: MaintenanceContext,
): Promise<EquipmentMeter> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "maintenance:view", "maintenance:manage");
  requireOperator(ref, ctx);

  if (reading.odometerMiles === undefined && reading.engineHours === undefined) {
    throw new MaintenanceRuleError("Enter an odometer reading, engine hours, or both.");
  }

  const existing = meterFor(ref);
  const previous = existing?.latest;
  if (
    previous?.odometerMiles !== undefined &&
    reading.odometerMiles !== undefined &&
    reading.odometerMiles < previous.odometerMiles
  ) {
    throw new MaintenanceRuleError(
      `The odometer cannot go backwards. The last reading was ${previous.odometerMiles.toLocaleString()} mi.`,
    );
  }
  if (
    previous?.engineHours !== undefined &&
    reading.engineHours !== undefined &&
    reading.engineHours < previous.engineHours
  ) {
    throw new MaintenanceRuleError(
      `The hour meter cannot go backwards. The last reading was ${previous.engineHours.toLocaleString()} h.`,
    );
  }

  const readAt = reading.readAt ?? iso(now());

  /*
   * The reading goes to the canonical Equipment Meter Ledger, not to a store of
   * maintenance's own. Maintenance reads it straight back through `meterFor`,
   * and so does fleet operations, and so does anything else that needs to know
   * how far this truck has been — which is the whole point: nobody types it
   * twice.
   */
  contributeMeterReading({
    equipmentKind: ref.kind,
    equipmentId: ref.equipmentId,
    equipmentLabel: equipmentSummary(ref, ctx)?.unit,
    odometerMiles: reading.odometerMiles,
    engineHours: reading.engineHours,
    readAt,
    source: ctx.driverProfileId ? "driver_report" : "manual_entry",
    contributor: "maintenance",
    scope: maintenanceScope(ctx),
    verification: "confirmed",
    recordedBy: ctx.actor,
    note: reading.note?.trim() || undefined,
    idempotencyKey: `maintenance:reading:${ref.equipmentId}:${readAt}:${reading.odometerMiles ?? "-"}:${reading.engineHours ?? "-"}`,
    provenance: MAINTENANCE_PROVENANCE(readAt),
  });

  return meterFor(ref)!;
}

/* -------------------------------------------------------------------------- */
/* Out of service                                                              */
/* -------------------------------------------------------------------------- */

export function activeHold(ref: MaintenanceEquipmentRef): EquipmentServiceHold | undefined {
  return db().holds.find((h) => sameEquipment(h.equipment, ref) && !h.releasedAt);
}

/**
 * True when ANY organization holds this equipment out of service.
 *
 * Not scoped to the caller on purpose: a trailer another carrier has parked as
 * unsafe is unsafe for everybody, and a carrier that could not see that would
 * put a load on it.
 */
export function isOutOfService(ref: MaintenanceEquipmentRef): boolean {
  return activeHold(ref) !== undefined;
}

export async function placeOutOfService(
  ref: MaintenanceEquipmentRef,
  input: { reason: string; sourceDefectId?: string; sourceRepairOrderId?: string },
  ctx: MaintenanceContext,
): Promise<EquipmentServiceHold> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "maintenance:view", "maintenance:outofservice:manage");
  requireOperator(ref, ctx);
  if (!input.reason.trim()) {
    throw new MaintenanceRuleError("Say why the equipment is being parked.");
  }
  const existing = activeHold(ref);
  if (existing) return existing;

  const hold: EquipmentServiceHold = {
    id: rowId("hold"),
    equipment: ref,
    organizationId: ctx.organizationId,
    reason: input.reason.trim(),
    placedAt: iso(now()),
    placedBy: ctx.actor,
    sourceDefectId: input.sourceDefectId,
    sourceRepairOrderId: input.sourceRepairOrderId,
  };
  db().holds.push(hold);
  return hold;
}

/**
 * Put it back on the road.
 *
 * Refused while a defect that stops the equipment is still open. Returning
 * equipment to service is a safety decision, and it cannot be made by ignoring
 * the report that parked it.
 */
export async function returnToService(
  ref: MaintenanceEquipmentRef,
  note: string,
  ctx: MaintenanceContext,
): Promise<EquipmentServiceHold> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "maintenance:view", "maintenance:outofservice:manage");
  requireOperator(ref, ctx);

  const hold = activeHold(ref);
  if (!hold) throw new MaintenanceNotFoundError("Out-of-service record");
  // Only the organization that parked it may release it.
  if (hold.organizationId !== ctx.organizationId) {
    throw new MaintenanceRuleError(
      "Another organization placed this equipment out of service. Only they can return it.",
    );
  }

  const blocking = db().defects.filter(
    (d) =>
      sameEquipment(d.equipment, ref) &&
      d.severity === "out_of_service" &&
      d.state !== "resolved" &&
      d.state !== "dismissed",
  );
  if (blocking.length > 0) {
    throw new MaintenanceRuleError(
      `${blocking.length} unresolved defect${blocking.length === 1 ? "" : "s"} still say this equipment should not be driven. Close ${blocking.length === 1 ? "it" : "them"} first.`,
    );
  }

  hold.releasedAt = iso(now());
  hold.releasedBy = ctx.actor;
  hold.releaseNote = note.trim() || undefined;
  return hold;
}

/* -------------------------------------------------------------------------- */
/* Requirements                                                                */
/* -------------------------------------------------------------------------- */

function evaluate(requirement: MaintenanceRequirement, at = now()) {
  const meter = meterFor(requirement.equipment);
  const input = {
    trigger: requirement.trigger,
    meter: meter?.latest,
    meterStaleAfterDays: meter?.staleAfterDays,
    completedAt: requirement.completedAt,
    inService: Boolean(requirement.activeRepairOrderId),
    deferred: Boolean(requirement.deferral),
    deferredUntil: requirement.deferral?.until,
    now: at,
  };
  return { state: requirementState(input), due: dueSummary(input) };
}

export function requirementStateOf(requirement: MaintenanceRequirement, at = now()): MaintenanceState {
  return evaluate(requirement, at).state;
}

function projectRequirement(
  requirement: MaintenanceRequirement,
  ctx: MaintenanceContext,
  at = now(),
): MaintenanceRequirementView {
  const { state, due } = evaluate(requirement, at);
  const defect = requirement.trigger.kind === "defect"
    ? db().defects.find((d) => d.id === (requirement.trigger as { defectId: string }).defectId)
    : undefined;
  return {
    requirement,
    equipment: equipmentSummary(requirement.equipment, ctx),
    state,
    due,
    responsibleName: requirement.responsibleMembershipId
      ? memberName(requirement.responsibleMembershipId)
      : undefined,
    // Only ever the caller's own organization's defect: a requirement is
    // org-scoped, so its defect is too.
    defect: defect?.organizationId === ctx.organizationId ? defect : undefined,
  };
}

/**
 * Membership id to a readable name.
 *
 * A snapshot table rather than a directory lookup: the mock has no membership
 * service, and a name that cannot be resolved is shown as the id rather than as
 * a guess.
 */
const MEMBER_NAMES: Record<string, string> = {
  mem_northline_owner: "Sam Murtaza",
  mem_baxter_owner: "Sam Murtaza",
  mem_summit_owner: "Sam Murtaza",
  mem_meridian_dispatcher: "Sam Murtaza",
  mem_cascade_driver: "Sam Murtaza",
  mem_nl_safety: "Priya Raman",
  mem_nl_shop: "Curtis Vogel",
  mem_bx_shop: "Renata Alves",
};

function memberName(membershipId: string): string {
  return MEMBER_NAMES[membershipId] ?? membershipId;
}

export interface RequirementFilters {
  equipment?: MaintenanceEquipmentRef;
  equipmentKind?: MaintenanceEquipmentKind;
  state?: MaintenanceState[];
  triggerKind?: MaintenanceTrigger["kind"][];
  category?: MaintenanceCategory[];
  /** "me" resolves to the caller's membership. */
  responsible?: "all" | "me" | "unassigned";
  search?: string;
}

/**
 * The organization's service schedule.
 *
 * Two filters are applied that a caller cannot turn off: the requirement must
 * belong to the caller's organization, and the caller must still have a live
 * relationship with the equipment. A carrier that ends its relationship stops
 * seeing its own schedule for that machine — the records stay, the access goes.
 */
export async function listRequirements(
  ctx: MaintenanceContext,
  filters: RequirementFilters = {},
): Promise<MaintenanceRequirementView[]> {
  await sleep(LATENCY_MS);
  return listRequirementsSync(ctx, filters);
}

export function listRequirementsSync(
  ctx: MaintenanceContext,
  filters: RequirementFilters = {},
): MaintenanceRequirementView[] {
  if (!ctx.permissions.has("maintenance:view")) return [];

  const at = now();
  return db().requirements
    .filter((r) => r.organizationId === ctx.organizationId)
    .filter((r) => equipmentAccess(r.equipment, ctx)?.kind === "operator")
    .filter((r) => (filters.equipment ? sameEquipment(r.equipment, filters.equipment) : true))
    .filter((r) => (filters.equipmentKind ? r.equipment.kind === filters.equipmentKind : true))
    .filter((r) => (filters.category?.length ? filters.category.includes(r.category) : true))
    .filter((r) => (filters.triggerKind?.length ? filters.triggerKind.includes(r.trigger.kind) : true))
    .filter((r) => {
      if (filters.responsible === "me") return r.responsibleMembershipId === ctx.membershipId;
      if (filters.responsible === "unassigned") return !r.responsibleMembershipId;
      return true;
    })
    .map((r) => projectRequirement(r, ctx, at))
    .filter((v) => (filters.state?.length ? filters.state.includes(v.state) : true))
    .filter((v) => {
      if (!filters.search?.trim()) return true;
      const q = filters.search.trim().toLowerCase();
      const hay = `${v.requirement.title} ${v.requirement.description ?? ""} ${v.equipment.unit} ${MAINTENANCE_CATEGORY_LABEL[v.requirement.category]}`;
      return hay.toLowerCase().includes(q);
    })
    .sort((a, b) => urgencyScore(a.state, a.due) - urgencyScore(b.state, b.due));
}

export async function getRequirement(
  requirementId: string,
  ctx: MaintenanceContext,
): Promise<MaintenanceRequirementView> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "maintenance:view");
  const found = db().requirements.find((r) => r.id === requirementId);
  if (
    !found ||
    found.organizationId !== ctx.organizationId ||
    equipmentAccess(found.equipment, ctx)?.kind !== "operator"
  ) {
    throw new MaintenanceNotFoundError("Requirement");
  }
  return projectRequirement(found, ctx);
}

export interface CreateRequirementInput {
  equipment: MaintenanceEquipmentRef;
  title: string;
  description?: string;
  category: MaintenanceCategory;
  criticality: MaintenanceCriticality;
  trigger: MaintenanceTrigger;
  responsibleMembershipId?: string;
  documentIds?: string[];
  notes?: string;
}

export async function createRequirement(
  input: CreateRequirementInput,
  ctx: MaintenanceContext,
): Promise<MaintenanceRequirementView> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "maintenance:view", "maintenance:manage");
  requireOperator(input.equipment, ctx);
  if (!input.title.trim()) throw new MaintenanceRuleError("Give the requirement a title.");

  const requirement: MaintenanceRequirement = {
    id: rowId("req"),
    equipment: input.equipment,
    organizationId: ctx.organizationId,
    title: input.title.trim(),
    description: input.description?.trim() || undefined,
    category: input.category,
    criticality: input.criticality,
    trigger: input.trigger,
    responsibleMembershipId: input.responsibleMembershipId,
    documentIds: input.documentIds ?? [],
    notes: input.notes?.trim() || undefined,
    createdAt: iso(now()),
    createdBy: ctx.actor,
  };
  db().requirements.push(requirement);
  return projectRequirement(requirement, ctx);
}

/**
 * Record a decision to run past due.
 *
 * Refused outright for anything raised by a defect that stops the equipment.
 * That is the one case where "we will get to it" is not a decision somebody is
 * allowed to record, so the rule lives here and not in a dialog.
 */
export async function deferRequirement(
  requirementId: string,
  input: { reason: string; until?: string },
  ctx: MaintenanceContext,
): Promise<MaintenanceRequirementView> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "maintenance:view", "maintenance:manage");
  const requirement = ownRequirementOrThrow(requirementId, ctx);

  if (!input.reason.trim()) {
    throw new MaintenanceRuleError("A deferral needs a reason. It is a decision, not a snooze.");
  }
  if (
    requirement.trigger.kind === "defect" &&
    requirement.trigger.reportedSeverity === "out_of_service"
  ) {
    throw new MaintenanceRuleError(
      "This was raised by a defect saying the equipment should not be driven. It cannot be deferred.",
    );
  }
  if (requirement.criticality === "safety_critical" && !input.until) {
    throw new MaintenanceRuleError(
      "A safety-critical requirement can only be deferred to a date, never indefinitely.",
    );
  }

  const deferral: MaintenanceDeferral = {
    reason: input.reason.trim(),
    until: input.until,
    deferredAt: iso(now()),
    deferredBy: ctx.actor,
  };
  requirement.deferral = deferral;
  return projectRequirement(requirement, ctx);
}

export async function clearDeferral(
  requirementId: string,
  ctx: MaintenanceContext,
): Promise<MaintenanceRequirementView> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "maintenance:view", "maintenance:manage");
  const requirement = ownRequirementOrThrow(requirementId, ctx);
  requirement.deferral = undefined;
  return projectRequirement(requirement, ctx);
}

function ownRequirementOrThrow(
  requirementId: string,
  ctx: MaintenanceContext,
): MaintenanceRequirement {
  const found = db().requirements.find((r) => r.id === requirementId);
  if (
    !found ||
    found.organizationId !== ctx.organizationId ||
    equipmentAccess(found.equipment, ctx)?.kind !== "operator"
  ) {
    throw new MaintenanceNotFoundError("Requirement");
  }
  return found;
}

/* -------------------------------------------------------------------------- */
/* Defects                                                                     */
/* -------------------------------------------------------------------------- */

export interface ReportDefectInput {
  equipment: MaintenanceEquipmentRef;
  area: DefectArea;
  severity: DefectSeverity;
  availabilityImpact: EquipmentAvailabilityImpact;
  summary: string;
  detail?: string;
  loadId?: string;
  documentIds?: string[];
  /** Optional reading taken at the same time. */
  meterAtReport?: { odometerMiles?: number; engineHours?: number };
}

/**
 * Report a fault.
 *
 * Open to anybody who can see the equipment and holds the reporting permission
 * — a driver on the truck as much as the shop. A report that says the equipment
 * should not be driven parks it immediately: the hold is created here, in the
 * same call, rather than left to a second action somebody might not take.
 */
export async function reportDefect(
  input: ReportDefectInput,
  ctx: MaintenanceContext,
): Promise<ReportedDefect> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "maintenance:view", "maintenance:defects:report");

  const access = equipmentAccess(input.equipment, ctx);
  // A driver may report on the equipment they are on; an operator on anything
  // it runs. A shared-with dispatch organization reports on nothing — it is not
  // their equipment and they are not looking at it.
  if (access?.kind !== "operator" && access?.kind !== "assigned_driver") {
    throw new MaintenanceNotFoundError("Equipment");
  }
  if (!input.summary.trim()) {
    throw new MaintenanceRuleError("Say what is wrong with it.");
  }
  if (input.severity === "out_of_service" && input.availabilityImpact !== "out_of_service") {
    throw new MaintenanceRuleError(
      "A defect that says the equipment should not be driven must also be marked as unusable.",
    );
  }

  const at = iso(now());
  const meterAtReport: MeterReading | undefined =
    input.meterAtReport?.odometerMiles !== undefined ||
    input.meterAtReport?.engineHours !== undefined
      ? {
          odometerMiles: input.meterAtReport.odometerMiles,
          engineHours: input.meterAtReport.engineHours,
          readAt: at,
          source: ctx.driverProfileId ? "driver_report" : "manual",
          recordedBy: ctx.actor,
        }
      : undefined;

  const defect: ReportedDefect = {
    id: rowId("dfc"),
    equipment: input.equipment,
    organizationId: ctx.organizationId,
    area: input.area,
    severity: input.severity,
    availabilityImpact: input.availabilityImpact,
    summary: input.summary.trim(),
    detail: input.detail?.trim() || undefined,
    state: "reported",
    reportedAt: at,
    reportedBy: ctx.actor,
    reportedByDriverProfileId: ctx.driverProfileId,
    reportedByName: ctx.actor.displayNameSnapshot,
    loadId: input.loadId,
    meterAtReport,
    documentIds: input.documentIds ?? [],
    history: [
      {
        id: rowId("mh"),
        at,
        actor: ctx.actor,
        action: "created",
        note: input.summary.trim(),
      },
    ],
  };
  db().defects.push(defect);

  // A reading taken with a defect report is a reading. It goes to the canonical
  // ledger, attributed to whoever took it, and is kept on the defect too because
  // "what the meter said when this fault was found" is part of the defect.
  if (meterAtReport) {
    contributeMeterReading({
      equipmentKind: input.equipment.kind,
      equipmentId: input.equipment.equipmentId,
      equipmentLabel: equipmentSummary(input.equipment, ctx)?.unit,
      odometerMiles: meterAtReport.odometerMiles,
      engineHours: meterAtReport.engineHours,
      readAt: meterAtReport.readAt,
      source: ctx.driverProfileId ? "driver_report" : "manual_entry",
      contributor: "maintenance",
      scope: maintenanceScope(ctx),
      verification: "confirmed",
      recordedBy: ctx.actor,
      note: `Reported with defect ${defect.id}.`,
      idempotencyKey: `maintenance:defect:${defect.id}`,
      provenance: MAINTENANCE_PROVENANCE(at),
    });
  }

  // "Should not be driven" parks the equipment now, not after a triage meeting.
  if (input.severity === "out_of_service" && !activeHold(input.equipment)) {
    db().holds.push({
      id: rowId("hold"),
      equipment: input.equipment,
      organizationId: ctx.organizationId,
      reason: `Defect reported: ${defect.summary}`,
      placedAt: at,
      placedBy: ctx.actor,
      sourceDefectId: defect.id,
    });
    defect.history.push({
      id: rowId("mh"),
      at,
      actor: SYSTEM_ACTOR,
      action: "placed_out_of_service",
      note: "Reported as unsafe to drive, so the equipment was parked automatically.",
    });
  }

  return defect;
}

export interface DefectFilters {
  equipment?: MaintenanceEquipmentRef;
  state?: DefectState[];
  severity?: DefectSeverity[];
  area?: DefectArea[];
  /** Only defects this driver reported. Resolved from the context, not input. */
  mineOnly?: boolean;
  search?: string;
}

/**
 * Reported defects.
 *
 * A driver membership sees exactly what it should: faults on the equipment it
 * is on. That is narrower than the organization's list and wider than "only
 * mine", because a driver taking over a truck needs to know what the last
 * driver reported on it.
 */
export async function listDefects(
  ctx: MaintenanceContext,
  filters: DefectFilters = {},
): Promise<ReportedDefect[]> {
  await sleep(LATENCY_MS);
  return listDefectsSync(ctx, filters);
}

export function listDefectsSync(
  ctx: MaintenanceContext,
  filters: DefectFilters = {},
): ReportedDefect[] {
  if (!ctx.permissions.has("maintenance:view")) return [];

  return db().defects
    .filter((d) => d.organizationId === ctx.organizationId)
    .filter((d) => {
      const access = equipmentAccess(d.equipment, ctx);
      if (access?.kind === "operator") return true;
      // The driver on the equipment sees its faults, whoever reported them.
      if (access?.kind === "assigned_driver") return true;
      return false;
    })
    .filter((d) => (filters.mineOnly ? d.reportedByDriverProfileId === ctx.driverProfileId : true))
    .filter((d) => (filters.equipment ? sameEquipment(d.equipment, filters.equipment) : true))
    .filter((d) => (filters.state?.length ? filters.state.includes(d.state) : true))
    .filter((d) => (filters.severity?.length ? filters.severity.includes(d.severity) : true))
    .filter((d) => (filters.area?.length ? filters.area.includes(d.area) : true))
    .filter((d) => {
      if (!filters.search?.trim()) return true;
      const q = filters.search.trim().toLowerCase();
      return `${d.summary} ${d.detail ?? ""} ${d.reportedByName}`.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      const rank = DEFECT_SEVERITY_RANK[a.severity] - DEFECT_SEVERITY_RANK[b.severity];
      if (rank !== 0) return rank;
      return b.reportedAt.localeCompare(a.reportedAt);
    });
}

const DEFECT_SEVERITY_RANK: Record<DefectSeverity, number> = {
  out_of_service: 0, critical: 1, major: 2, minor: 3,
};

export async function getDefect(defectId: string, ctx: MaintenanceContext): Promise<ReportedDefect> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "maintenance:view");
  const found = listDefectsSync(ctx).find((d) => d.id === defectId);
  if (!found) throw new MaintenanceNotFoundError("Defect");
  return found;
}

/**
 * Move a defect along.
 *
 * `resolved` and `dismissed` both need a note — closing a reported fault
 * without saying what happened is how a fleet loses the thread. The history is
 * appended to, never rewritten.
 */
export async function updateDefectState(
  defectId: string,
  state: DefectState,
  note: string | undefined,
  ctx: MaintenanceContext,
): Promise<ReportedDefect> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "maintenance:view", "maintenance:defects:manage");
  const defect = ownDefectOrThrow(defectId, ctx);

  if ((state === "resolved" || state === "dismissed") && !note?.trim()) {
    throw new MaintenanceRuleError(
      state === "resolved"
        ? "Say what was done to fix it."
        : "Say why this is being closed without work.",
    );
  }
  if (state === "dismissed" && defect.severity === "out_of_service") {
    throw new MaintenanceRuleError(
      "A defect saying the equipment should not be driven cannot be dismissed. Resolve it with what was done, or leave it open.",
    );
  }

  const previous = defect.state;
  defect.state = state;
  if (state === "resolved" || state === "dismissed") {
    defect.resolvedAt = iso(now());
    defect.resolutionNote = note?.trim();
  } else {
    defect.resolvedAt = undefined;
    defect.resolutionNote = undefined;
  }
  defect.history.push({
    id: rowId("mh"),
    at: iso(now()),
    actor: ctx.actor,
    action:
      state === "acknowledged" ? "acknowledged"
      : state === "resolved" ? "resolved"
      : state === "reported" ? "reopened"
      : "state_changed",
    previousValue: previous,
    newValue: state,
    note: note?.trim() || undefined,
  });
  return defect;
}

/** Add a note without changing anything. Append-only, like every entry. */
export async function addDefectNote(
  defectId: string,
  note: string,
  ctx: MaintenanceContext,
): Promise<ReportedDefect> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "maintenance:view", "maintenance:defects:manage");
  const defect = ownDefectOrThrow(defectId, ctx);
  if (!note.trim()) throw new MaintenanceRuleError("Write something to add a note.");
  defect.history.push({
    id: rowId("mh"), at: iso(now()), actor: ctx.actor, action: "note", note: note.trim(),
  });
  return defect;
}

/**
 * Raise a service requirement from a reported fault.
 *
 * This is the link between the two record kinds, and it is one-way: the
 * requirement points back at the defect, the defect records which requirement
 * came out of it, and neither is folded into the other.
 */
export async function raiseRequirementFromDefect(
  defectId: string,
  input: { title?: string; category: MaintenanceCategory; dueAt?: string; responsibleMembershipId?: string },
  ctx: MaintenanceContext,
): Promise<MaintenanceRequirementView> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "maintenance:view", "maintenance:manage", "maintenance:defects:manage");
  const defect = ownDefectOrThrow(defectId, ctx);
  if (defect.requirementId) {
    throw new MaintenanceRuleError("A requirement has already been raised from this defect.");
  }

  const requirement: MaintenanceRequirement = {
    id: rowId("req"),
    equipment: defect.equipment,
    organizationId: ctx.organizationId,
    title: input.title?.trim() || defect.summary,
    description: defect.detail,
    category: input.category,
    criticality:
      defect.severity === "out_of_service" || defect.severity === "critical"
        ? "safety_critical"
        : defect.severity === "major" ? "important" : "routine",
    trigger: {
      kind: "defect",
      defectId: defect.id,
      reportedSeverity: defect.severity,
      dueAt: input.dueAt,
    },
    responsibleMembershipId: input.responsibleMembershipId,
    documentIds: [],
    createdAt: iso(now()),
    createdBy: ctx.actor,
  };
  db().requirements.push(requirement);

  defect.requirementId = requirement.id;
  if (defect.state === "reported") defect.state = "acknowledged";
  defect.history.push({
    id: rowId("mh"),
    at: iso(now()),
    actor: ctx.actor,
    action: "acknowledged",
    note: `Raised service requirement "${requirement.title}".`,
  });

  return projectRequirement(requirement, ctx);
}

function ownDefectOrThrow(defectId: string, ctx: MaintenanceContext): ReportedDefect {
  const found = db().defects.find((d) => d.id === defectId);
  if (
    !found ||
    found.organizationId !== ctx.organizationId ||
    equipmentAccess(found.equipment, ctx)?.kind !== "operator"
  ) {
    throw new MaintenanceNotFoundError("Defect");
  }
  return found;
}

/* -------------------------------------------------------------------------- */
/* Vendors                                                                     */
/* -------------------------------------------------------------------------- */

export async function listVendors(ctx: MaintenanceContext): Promise<MaintenanceVendor[]> {
  await sleep(180);
  if (!ctx.permissions.has("maintenance:view")) return [];
  return db().vendors
    .filter((v) => v.organizationId === ctx.organizationId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createVendor(
  input: Omit<MaintenanceVendor, "id" | "organizationId" | "createdAt">,
  ctx: MaintenanceContext,
): Promise<MaintenanceVendor> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "maintenance:view", "maintenance:repairs:manage");
  if (!input.name.trim()) throw new MaintenanceRuleError("Give the vendor a name.");
  const vendor: MaintenanceVendor = {
    ...input,
    name: input.name.trim(),
    id: rowId("ven"),
    organizationId: ctx.organizationId,
    createdAt: iso(now()),
  };
  db().vendors.push(vendor);
  return vendor;
}

/* -------------------------------------------------------------------------- */
/* Repair orders                                                               */
/* -------------------------------------------------------------------------- */

/**
 * What a caller is allowed to see of a repair order.
 *
 * Cost is a separate permission from the work, so a dispatcher or a driver can
 * be told the truck is in the shop until Thursday without being shown the bill.
 * The figures are REMOVED, not zeroed or hidden in the UI — a caller without
 * `maintenance:costs:view` never receives them.
 */
function projectRepairOrder(order: RepairOrder, ctx: MaintenanceContext): RepairOrder {
  if (ctx.permissions.has("maintenance:costs:view")) return order;
  return {
    ...order,
    cost: {},
    lines: order.lines.map((l) => ({ ...l, unitCostCents: undefined, totalCents: 0 })),
  };
}

export interface RepairOrderFilters {
  equipment?: MaintenanceEquipmentRef;
  status?: RepairOrderStatus[];
  search?: string;
}

export async function listRepairOrders(
  ctx: MaintenanceContext,
  filters: RepairOrderFilters = {},
): Promise<RepairOrder[]> {
  await sleep(LATENCY_MS);
  return listRepairOrdersSync(ctx, filters);
}

export function listRepairOrdersSync(
  ctx: MaintenanceContext,
  filters: RepairOrderFilters = {},
): RepairOrder[] {
  if (!ctx.permissions.has("maintenance:view")) return [];

  return db().repairOrders
    .filter((o) => o.organizationId === ctx.organizationId)
    .filter((o) => equipmentAccess(o.equipment, ctx)?.kind === "operator")
    .filter((o) => (filters.equipment ? sameEquipment(o.equipment, filters.equipment) : true))
    .filter((o) => (filters.status?.length ? filters.status.includes(o.status) : true))
    .filter((o) => {
      if (!filters.search?.trim()) return true;
      const q = filters.search.trim().toLowerCase();
      return `${o.number} ${o.title} ${o.vendor?.name ?? ""}`.toLowerCase().includes(q);
    })
    .map((o) => projectRepairOrder(o, ctx))
    .sort((a, b) => b.openedAt.localeCompare(a.openedAt));
}

export async function getRepairOrder(
  repairOrderId: string,
  ctx: MaintenanceContext,
): Promise<RepairOrder> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "maintenance:view");
  const found = db().repairOrders.find((o) => o.id === repairOrderId);
  if (
    !found ||
    found.organizationId !== ctx.organizationId ||
    equipmentAccess(found.equipment, ctx)?.kind !== "operator"
  ) {
    throw new MaintenanceNotFoundError("Repair order");
  }
  return projectRepairOrder(found, ctx);
}

export interface OpenRepairOrderInput {
  equipment: MaintenanceEquipmentRef;
  title: string;
  vendorId?: string;
  requirementIds?: string[];
  defectIds?: string[];
  scheduledFor?: string;
  responsibleMembershipId?: string;
  estimate?: Money;
  notes?: string;
}

/**
 * Open a repair order.
 *
 * Linking it to a requirement moves that requirement to `in_service`, and
 * linking it to a defect moves that defect to `in_repair`. Both are done here
 * rather than left to the caller, so the three records cannot drift apart.
 */
export async function openRepairOrder(
  input: OpenRepairOrderInput,
  ctx: MaintenanceContext,
): Promise<RepairOrder> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "maintenance:view", "maintenance:repairs:manage");
  requireOperator(input.equipment, ctx);
  if (!input.title.trim()) throw new MaintenanceRuleError("Give the repair order a title.");

  const requirementIds = (input.requirementIds ?? []).filter((id) => {
    const r = db().requirements.find((x) => x.id === id);
    return r && r.organizationId === ctx.organizationId && sameEquipment(r.equipment, input.equipment);
  });
  const defectIds = (input.defectIds ?? []).filter((id) => {
    const d = db().defects.find((x) => x.id === id);
    return d && d.organizationId === ctx.organizationId && sameEquipment(d.equipment, input.equipment);
  });

  const vendor = input.vendorId
    ? db().vendors.find((v) => v.id === input.vendorId && v.organizationId === ctx.organizationId)
    : undefined;

  const at = iso(now());
  const order: RepairOrder = {
    id: rowId("ro"),
    number: nextRepairOrderNumber(ctx.organizationId),
    equipment: input.equipment,
    organizationId: ctx.organizationId,
    status: input.scheduledFor ? "scheduled" : "open",
    title: input.title.trim(),
    vendor: vendor
      ? { vendorId: vendor.id, name: vendor.name, kind: vendor.kind, city: vendor.city, state: vendor.state }
      : undefined,
    lines: [],
    cost: input.estimate ? { estimate: input.estimate } : {},
    downtime: {},
    responsibleMembershipId: input.responsibleMembershipId,
    responsibleName: input.responsibleMembershipId
      ? memberName(input.responsibleMembershipId)
      : undefined,
    scheduledFor: input.scheduledFor,
    openedAt: at,
    openedBy: ctx.actor,
    requirementIds,
    defectIds,
    documentIds: [],
    notes: input.notes?.trim() || undefined,
    history: [{ id: rowId("mh"), at, actor: ctx.actor, action: "created", note: input.title.trim() }],
  };
  db().repairOrders.push(order);

  for (const id of requirementIds) {
    const requirement = db().requirements.find((r) => r.id === id)!;
    requirement.activeRepairOrderId = order.id;
  }
  for (const id of defectIds) {
    const defect = db().defects.find((d) => d.id === id)!;
    defect.repairOrderId = order.id;
    if (defect.state === "reported" || defect.state === "acknowledged") defect.state = "in_repair";
    defect.history.push({
      id: rowId("mh"), at, actor: ctx.actor, action: "state_changed",
      newValue: "in_repair", note: `Repair order ${order.number} opened.`,
    });
  }

  return projectRepairOrder(order, ctx);
}

function nextRepairOrderNumber(organizationId: string): string {
  const mine = db().repairOrders.filter((o) => o.organizationId === organizationId);
  const highest = mine.reduce((max, o) => {
    const n = Number.parseInt(o.number.replace(/\D/g, ""), 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 1000);
  return `RO-${highest + 1}`;
}

export async function updateRepairOrderStatus(
  repairOrderId: string,
  status: RepairOrderStatus,
  note: string | undefined,
  ctx: MaintenanceContext,
): Promise<RepairOrder> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "maintenance:view", "maintenance:repairs:manage");
  const order = ownRepairOrderOrThrow(repairOrderId, ctx);

  if (order.status === "completed") {
    throw new MaintenanceRuleError(
      "This repair order is completed and its service record is permanent. Open a new one instead.",
    );
  }
  if (status === "completed") {
    throw new MaintenanceRuleError(
      "Complete a repair order by recording the service that was done, so the permanent record is written.",
    );
  }
  if (status === "cancelled" && !note?.trim()) {
    throw new MaintenanceRuleError("Say why the repair order is being cancelled.");
  }

  const previous = order.status;
  order.status = status;
  if (status === "in_progress" && !order.downtime.startedAt) {
    order.downtime.startedAt = iso(now());
  }
  if (status === "cancelled") {
    order.cancelledAt = iso(now());
    order.cancellationReason = note?.trim();
    // Cancelling releases whatever it was holding — nothing was done, so
    // nothing should read as in service.
    for (const id of order.requirementIds) {
      const requirement = db().requirements.find((r) => r.id === id);
      if (requirement?.activeRepairOrderId === order.id) requirement.activeRepairOrderId = undefined;
    }
    for (const id of order.defectIds) {
      const defect = db().defects.find((d) => d.id === id);
      if (defect?.state === "in_repair") defect.state = "acknowledged";
    }
  }
  order.history.push({
    id: rowId("mh"), at: iso(now()), actor: ctx.actor,
    action: status === "cancelled" ? "cancelled" : status === "scheduled" ? "scheduled" : "state_changed",
    previousValue: previous, newValue: status, note: note?.trim() || undefined,
  });
  return projectRepairOrder(order, ctx);
}

export async function addRepairOrderLine(
  repairOrderId: string,
  line: Omit<RepairOrderLine, "id">,
  ctx: MaintenanceContext,
): Promise<RepairOrder> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "maintenance:view", "maintenance:repairs:manage", "maintenance:costs:view");
  const order = ownRepairOrderOrThrow(repairOrderId, ctx);
  if (order.status === "completed") {
    throw new MaintenanceRuleError("A completed repair order cannot be changed.");
  }
  if (!line.description.trim()) throw new MaintenanceRuleError("Describe the line.");

  order.lines.push({ ...line, description: line.description.trim(), id: rowId("rol") });
  const total = order.lines.reduce((sum, l) => sum + l.totalCents, 0);
  const parts = order.lines.filter((l) => l.kind === "part").reduce((s, l) => s + l.totalCents, 0);
  const labor = order.lines.filter((l) => l.kind === "labor").reduce((s, l) => s + l.totalCents, 0);
  order.cost = {
    ...order.cost,
    actual: { amount: total, currency: "USD" },
    parts: { amount: parts, currency: "USD" },
    labor: { amount: labor, currency: "USD" },
  };
  order.history.push({
    id: rowId("mh"), at: iso(now()), actor: ctx.actor, action: "cost_recorded",
    note: line.description.trim(),
  });
  return projectRepairOrder(order, ctx);
}

export async function addRepairOrderNote(
  repairOrderId: string,
  note: string,
  ctx: MaintenanceContext,
): Promise<RepairOrder> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "maintenance:view", "maintenance:repairs:manage");
  const order = ownRepairOrderOrThrow(repairOrderId, ctx);
  if (!note.trim()) throw new MaintenanceRuleError("Write something to add a note.");
  order.history.push({
    id: rowId("mh"), at: iso(now()), actor: ctx.actor, action: "note", note: note.trim(),
  });
  return projectRepairOrder(order, ctx);
}

function ownRepairOrderOrThrow(repairOrderId: string, ctx: MaintenanceContext): RepairOrder {
  const found = db().repairOrders.find((o) => o.id === repairOrderId);
  if (
    !found ||
    found.organizationId !== ctx.organizationId ||
    equipmentAccess(found.equipment, ctx)?.kind !== "operator"
  ) {
    throw new MaintenanceNotFoundError("Repair order");
  }
  return found;
}

/* -------------------------------------------------------------------------- */
/* Service history — append only                                               */
/* -------------------------------------------------------------------------- */

export interface RecordServiceInput {
  repairOrderId: string;
  performedAt?: string;
  summary?: string;
  downtimeHours?: number;
  meter?: { odometerMiles?: number; engineHours?: number };
  notes?: string;
  documentIds?: string[];
}

/**
 * Complete a repair order and write the permanent record.
 *
 * This is the ONLY way a `ServiceRecord` comes into existence, and there is no
 * function anywhere in this file that edits or deletes one. Everything a later
 * reader needs is snapshotted into the record here — the organization's name,
 * the vendor, the cost, the person answerable, the requirement's title — so the
 * history still reads correctly years later, under a different owner, for a
 * carrier that no longer exists.
 *
 * Completing also rolls recurring requirements forward from the date the work
 * was actually done, and resolves the defects the order was answering.
 */
export async function recordCompletedService(
  input: RecordServiceInput,
  ctx: MaintenanceContext,
): Promise<ServiceRecord> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "maintenance:view", "maintenance:service:record");
  const order = ownRepairOrderOrThrow(input.repairOrderId, ctx);

  if (order.status === "completed") {
    throw new MaintenanceRuleError("This repair order has already been completed.");
  }
  if (order.status === "cancelled") {
    throw new MaintenanceRuleError("A cancelled repair order cannot be completed.");
  }

  const performedAt = input.performedAt ?? iso(now());
  if (new Date(performedAt).getTime() > Date.now() + 60_000) {
    throw new MaintenanceRuleError("Service cannot be recorded as happening in the future.");
  }

  const at = iso(now());
  const meter: MeterReading | undefined =
    input.meter?.odometerMiles !== undefined || input.meter?.engineHours !== undefined
      ? {
          odometerMiles: input.meter.odometerMiles,
          engineHours: input.meter.engineHours,
          readAt: performedAt,
          source: "service_record",
          recordedBy: ctx.actor,
        }
      : meterFor(order.equipment)?.latest;

  const firstRequirement = order.requirementIds
    .map((id) => db().requirements.find((r) => r.id === id))
    .find(Boolean);

  const record: ServiceRecord = {
    id: rowId("svc"),
    equipment: order.equipment,
    performedAt,
    recordedAt: at,
    category: firstRequirement?.category ?? "other",
    title: order.title,
    summary: input.summary?.trim() || undefined,
    // Snapshots. Nothing below is ever resolved through a live relationship.
    performedForOrganizationId: ctx.organizationId,
    performedForOrganizationName: ctx.organizationName,
    vendor: order.vendor,
    cost: order.cost,
    downtimeHours: input.downtimeHours ?? order.downtime.hours,
    meter,
    responsibleName: order.responsibleName,
    responsibleMembershipId: order.responsibleMembershipId,
    requirementId: firstRequirement?.id,
    requirementTitle: firstRequirement?.title,
    repairOrderId: order.id,
    repairOrderNumber: order.number,
    defectIds: [...order.defectIds],
    documentIds: [...order.documentIds, ...(input.documentIds ?? [])],
    notes: input.notes?.trim() || undefined,
    recordedBy: ctx.actor,
  };
  db().serviceRecords.push(record);

  order.status = "completed";
  order.completedAt = at;
  order.serviceRecordId = record.id;
  order.downtime.endedAt = at;
  if (input.downtimeHours !== undefined) order.downtime.hours = input.downtimeHours;
  order.history.push({
    id: rowId("mh"), at, actor: ctx.actor, action: "resolved",
    previousValue: "in_progress", newValue: "completed",
    note: "Service recorded. The record is permanent and cannot be changed.",
  });

  // The meter at the moment the work was done. The next interval is measured
  // from here, so this reading matters more than most — and it is one reading in
  // one ledger, not a number the shop has to repeat on a second screen.
  if (meter && (meter.odometerMiles !== undefined || meter.engineHours !== undefined)) {
    contributeMeterReading({
      equipmentKind: order.equipment.kind,
      equipmentId: order.equipment.equipmentId,
      equipmentLabel: equipmentSummary(order.equipment, ctx)?.unit,
      odometerMiles: meter.odometerMiles,
      engineHours: meter.engineHours,
      readAt: meter.readAt,
      source: meter.source === "manual" ? "manual_entry" : meter.source,
      contributor: "maintenance",
      scope: maintenanceScope(ctx),
      verification: "confirmed",
      recordedBy: ctx.actor,
      note: `Read when repair order ${order.number} was completed.`,
      idempotencyKey: `maintenance:service:${order.id}`,
      provenance: MAINTENANCE_PROVENANCE(at),
    });
  }

  // Close what the work answered.
  for (const id of order.requirementIds) {
    const requirement = db().requirements.find((r) => r.id === id);
    if (!requirement) continue;
    requirement.activeRepairOrderId = undefined;

    const next = nextTriggerAfterCompletion(requirement.trigger, {
      at: new Date(performedAt),
      meter,
    });
    if (next) {
      // Recurring: it rolls forward from what was actually done, and the
      // deferral that may have been on it is spent.
      requirement.trigger = next;
      requirement.deferral = undefined;
    } else {
      requirement.completedAt = performedAt;
      requirement.completedServiceRecordId = record.id;
      requirement.deferral = undefined;
    }
  }

  for (const id of order.defectIds) {
    const defect = db().defects.find((d) => d.id === id);
    if (!defect || defect.state === "resolved") continue;
    defect.state = "resolved";
    defect.resolvedAt = at;
    defect.resolutionNote = input.summary?.trim() || `Repaired under ${order.number}.`;
    defect.history.push({
      id: rowId("mh"), at, actor: ctx.actor, action: "resolved",
      note: `Repaired under ${order.number}.`,
    });
  }

  return record;
}

/**
 * What a caller may read of a service record somebody else's organization
 * wrote.
 *
 * The record is not hidden — the point of equipment history is that it survives
 * a change of hands, and a carrier taking on a truck is entitled to know it had
 * its brakes relined in March. What it is NOT entitled to is another carrier's
 * invoice, its vendor relationships, its people or its notes. Those are stripped
 * here, and the record is marked so the UI can say plainly whose it was.
 */
function redactForeignRecord(record: ServiceRecord): ServiceRecord {
  return {
    ...record,
    vendor: undefined,
    cost: undefined,
    responsibleName: undefined,
    responsibleMembershipId: undefined,
    notes: undefined,
    documentIds: [],
    defectIds: [],
    repairOrderNumber: undefined,
    summary: undefined,
  };
}

export interface ServiceHistoryEntry {
  record: ServiceRecord;
  /** False when the record was written by another organization. */
  ownRecord: boolean;
  /** True when detail has been removed because it was another carrier's. */
  redacted: boolean;
}

/**
 * The equipment's whole service history.
 *
 * Every record for this machine, whoever did the work — because that is what a
 * service history IS. Ownership transfers and carrier changes do not filter it,
 * do not re-key it and do not delete from it. What they change is only how much
 * of each foreign record is legible, and that is decided here on every read.
 */
export async function listServiceHistory(
  ref: MaintenanceEquipmentRef,
  ctx: MaintenanceContext,
): Promise<ServiceHistoryEntry[]> {
  await sleep(LATENCY_MS);
  return listServiceHistorySync(ref, ctx);
}

export function listServiceHistorySync(
  ref: MaintenanceEquipmentRef,
  ctx: MaintenanceContext,
): ServiceHistoryEntry[] {
  if (!ctx.permissions.has("maintenance:view")) return [];
  const access = equipmentAccess(ref, ctx);
  // History is for whoever runs the machine. A driver sees that it was
  // serviced; a shared-with dispatcher sees none of it.
  if (access?.kind !== "operator" && access?.kind !== "assigned_driver") return [];

  const canSeeCost = ctx.permissions.has("maintenance:costs:view");

  return db().serviceRecords
    .filter((r) => sameEquipment(r.equipment, ref))
    .sort((a, b) => b.performedAt.localeCompare(a.performedAt))
    .map((record) => {
      const ownRecord = record.performedForOrganizationId === ctx.organizationId;
      if (!ownRecord) {
        return { record: redactForeignRecord(record), ownRecord: false, redacted: true };
      }
      if (access.kind === "assigned_driver" || !canSeeCost) {
        // Their own organization's record, but not their money to see.
        return {
          record: { ...record, cost: undefined },
          ownRecord: true,
          redacted: true,
        };
      }
      return { record, ownRecord: true, redacted: false };
    });
}

/** The organization's own completed service, newest first, across all equipment. */
export function listOwnServiceRecordsSync(ctx: MaintenanceContext): ServiceRecord[] {
  if (!ctx.permissions.has("maintenance:view")) return [];
  const canSeeCost = ctx.permissions.has("maintenance:costs:view");
  return db().serviceRecords
    .filter((r) => r.performedForOrganizationId === ctx.organizationId)
    .filter((r) => equipmentAccess(r.equipment, ctx)?.kind === "operator")
    .map((r) => (canSeeCost ? r : { ...r, cost: undefined }))
    .sort((a, b) => b.performedAt.localeCompare(a.performedAt));
}

export async function listOwnServiceRecords(ctx: MaintenanceContext): Promise<ServiceRecord[]> {
  await sleep(LATENCY_MS);
  return listOwnServiceRecordsSync(ctx);
}

/* -------------------------------------------------------------------------- */
/* Sharing with dispatch organizations                                         */
/* -------------------------------------------------------------------------- */

export async function listShares(ctx: MaintenanceContext): Promise<MaintenanceShare[]> {
  await sleep(200);
  if (!ctx.permissions.has("maintenance:view")) return [];
  return db().shares.filter(
    (s) =>
      s.grantedByOrganizationId === ctx.organizationId ||
      s.sharedWithOrganizationId === ctx.organizationId,
  );
}

export async function shareMaintenance(
  input: {
    equipment: MaintenanceEquipmentRef;
    sharedWithOrganizationId: string;
    scope: MaintenanceShareScope;
    reason: string;
  },
  ctx: MaintenanceContext,
): Promise<MaintenanceShare> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "maintenance:view", "maintenance:share:manage");
  requireOperator(input.equipment, ctx);
  if (!input.reason.trim()) {
    throw new MaintenanceRuleError("Say why this dispatch organization needs it.");
  }

  const existing = db().shares.find(
    (s) =>
      sameEquipment(s.equipment, input.equipment) &&
      s.sharedWithOrganizationId === input.sharedWithOrganizationId &&
      s.status === "active",
  );
  if (existing) {
    existing.scope = input.scope;
    existing.reason = input.reason.trim();
    return existing;
  }

  const share: MaintenanceShare = {
    id: rowId("shr"),
    equipment: input.equipment,
    grantedByOrganizationId: ctx.organizationId,
    grantedByOrganizationName: ctx.organizationName,
    sharedWithOrganizationId: input.sharedWithOrganizationId,
    scope: input.scope,
    status: "active",
    reason: input.reason.trim(),
    startedAt: iso(now()),
    createdBy: ctx.actor,
  };
  db().shares.push(share);
  return share;
}

export async function endShare(shareId: string, ctx: MaintenanceContext): Promise<MaintenanceShare> {
  await sleep(LATENCY_MS);
  requirePermissions(ctx, "maintenance:view", "maintenance:share:manage");
  const share = db().shares.find(
    (s) => s.id === shareId && s.grantedByOrganizationId === ctx.organizationId,
  );
  if (!share) throw new MaintenanceNotFoundError("Share");
  share.status = "ended";
  share.endedAt = iso(now());
  return share;
}

/**
 * What a dispatch organization actually sees.
 *
 * Built from the share, not from the records: there is no path in this function
 * that can reach a cost, a vendor, a note, a defect description or a person's
 * name. A dispatcher is told whether the equipment can take a load, roughly
 * when it is back, and — only at the wider scope — what it is due for.
 */
export async function listSharedWithMe(ctx: MaintenanceContext): Promise<SharedMaintenanceView[]> {
  await sleep(LATENCY_MS);
  return listSharedWithMeSync(ctx);
}

export function listSharedWithMeSync(ctx: MaintenanceContext): SharedMaintenanceView[] {
  if (!ctx.permissions.has("maintenance:view")) return [];

  const at = now();
  return db().shares
    .filter((s) => s.sharedWithOrganizationId === ctx.organizationId && s.status === "active")
    // The share is not enough on its own: the dispatch relationship with the
    // equipment must still be live too. Ending one ends the access.
    .filter((s) => equipmentAccess(s.equipment, ctx)?.kind === "shared_dispatch")
    .map((share): SharedMaintenanceView => {
      const hold = activeHold(share.equipment);
      const openRequirements = db().requirements
        .filter((r) => sameEquipment(r.equipment, share.equipment))
        .filter((r) => r.organizationId === share.grantedByOrganizationId)
        .map((r) => ({ r, ev: evaluate(r, at) }))
        .filter(({ ev }) => ev.state !== "completed")
        .sort((a, b) => urgencyScore(a.ev.state, a.ev.due) - urgencyScore(b.ev.state, b.ev.due));

      const inService = db().repairOrders.find(
        (o) =>
          sameEquipment(o.equipment, share.equipment) &&
          (o.status === "in_progress" || o.status === "awaiting_parts" || o.status === "scheduled"),
      );

      return {
        equipment: equipmentSummary(share.equipment, ctx),
        scope: share.scope,
        outOfService: Boolean(hold),
        // The reason is the carrier's own words, which they chose to share by
        // sharing at all. Nothing else from the hold travels.
        outOfServiceReason: hold?.reason,
        expectedBackAt: inService?.scheduledFor,
        openRequirements:
          share.scope === "availability_and_schedule"
            ? openRequirements.map(({ r, ev }) => ({
                id: r.id,
                title: r.title,
                state: ev.state,
                dueLabel: ev.due.label,
              }))
            : undefined,
        openDefectCount: db().defects.filter(
          (d) =>
            sameEquipment(d.equipment, share.equipment) &&
            d.state !== "resolved" &&
            d.state !== "dismissed",
        ).length,
        sharedByOrganizationName: share.grantedByOrganizationName,
      };
    })
    .sort((a, b) => Number(b.outOfService) - Number(a.outOfService));
}

/* -------------------------------------------------------------------------- */
/* Dashboard summary                                                           */
/* -------------------------------------------------------------------------- */

export async function maintenanceSummary(ctx: MaintenanceContext): Promise<MaintenanceSummary> {
  await sleep(LATENCY_MS);
  return maintenanceSummarySync(ctx);
}

export function maintenanceSummarySync(ctx: MaintenanceContext): MaintenanceSummary {
  const requirements = listRequirementsSync(ctx);
  const defects = listDefectsSync(ctx);
  const orders = listRepairOrdersSync(ctx);
  const thirtyDaysAgo = Date.now() - 30 * 86_400_000;

  const recentRecords = listOwnServiceRecordsSync(ctx).filter(
    (r) => new Date(r.performedAt).getTime() >= thirtyDaysAgo,
  );

  const equipment = maintainableEquipment(ctx).filter(
    (ref) => equipmentAccess(ref, ctx)?.kind === "operator",
  );

  const summary: MaintenanceSummary = {
    overdue: requirements.filter((r) => r.state === "overdue").length,
    dueSoon: requirements.filter((r) => r.state === "due_soon").length,
    upcoming: requirements.filter((r) => r.state === "upcoming").length,
    inService: requirements.filter((r) => r.state === "in_service").length,
    deferred: requirements.filter((r) => r.state === "deferred").length,
    completedLast30Days: recentRecords.length,
    openDefects: defects.filter((d) => d.state !== "resolved" && d.state !== "dismissed").length,
    criticalDefects: defects.filter(
      (d) =>
        (d.severity === "critical" || d.severity === "out_of_service") &&
        d.state !== "resolved" &&
        d.state !== "dismissed",
    ).length,
    openRepairOrders: orders.filter(
      (o) => o.status !== "completed" && o.status !== "cancelled",
    ).length,
    equipmentOutOfService: equipment.filter((ref) => isOutOfService(ref)).length,
  };

  // Money only where the permission is held. Absent, not zero.
  if (ctx.permissions.has("maintenance:costs:view")) {
    summary.costLast30Days = {
      amount: recentRecords.reduce((sum, r) => sum + (r.cost?.actual?.amount ?? 0), 0),
      currency: "USD",
    };
    summary.downtimeHoursLast30Days = recentRecords.reduce(
      (sum, r) => sum + (r.downtimeHours ?? 0),
      0,
    );
  }

  return summary;
}

/* -------------------------------------------------------------------------- */
/* Needs You                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Maintenance raises REAL Needs You items.
 *
 * They are derived from the live records on every read rather than seeded as
 * fixtures, which is what makes them honest: resolve the defect and the item is
 * gone, because the condition that produced it is gone. There is no second
 * alerts table, and no maintenance item exists that is not backed by a record
 * somebody can open.
 *
 * The workflow a person applies on top — assign, snooze, escalate, resolve —
 * lives in `needsYouOverlay`, keyed by the derived item's id and tied to a
 * fingerprint of the underlying state. When the record moves, the fingerprint
 * changes and the overlay is dropped, so acknowledging "overdue by 3 days" does
 * not silently also acknowledge "overdue by 30".
 */
interface NeedsYouOverlay {
  fingerprint: string;
  status?: NeedsYouItem["status"];
  snoozedUntil?: string;
  snoozeReason?: string;
  resolvedAt?: string;
  resolutionNote?: string;
  assigneeMembershipId?: string;
  history: NeedsYouItem["history"];
}

const MAINTENANCE_NEEDS_YOU_PREFIX = "mny_";

export function isMaintenanceNeedsYouId(id: string): boolean {
  return id.startsWith(MAINTENANCE_NEEDS_YOU_PREFIX);
}

export function maintenanceNeedsYouItems(ctx: MaintenanceContext): NeedsYouItem[] {
  if (!ctx.permissions.has("maintenance:view")) return [];

  const items: NeedsYouItem[] = [
    ...overdueServiceItems(ctx),
    ...criticalDefectItems(ctx),
    ...unresolvedRepairItems(ctx),
    ...outOfServiceItems(ctx),
  ];
  return items.map((item) => applyOverlay(item));
}

function applyOverlay(item: NeedsYouItem): NeedsYouItem {
  const overlay = db().needsYouOverlay[item.id];
  // A fingerprint mismatch means the underlying record moved on. The old
  // workflow state no longer applies to what the item now says.
  if (!overlay || overlay.fingerprint !== fingerprintOf(item)) return item;

  const snoozeExpired =
    overlay.status === "snoozed" &&
    overlay.snoozedUntil !== undefined &&
    new Date(overlay.snoozedUntil).getTime() <= Date.now();

  return {
    ...item,
    status: snoozeExpired ? "open" : overlay.status ?? item.status,
    snoozedUntil: snoozeExpired ? undefined : overlay.snoozedUntil,
    snoozeReason: snoozeExpired ? undefined : overlay.snoozeReason,
    resolvedAt: overlay.resolvedAt,
    resolutionNote: overlay.resolutionNote,
    assigneeMembershipId: overlay.assigneeMembershipId,
    history: [...item.history, ...overlay.history],
  };
}

/**
 * A short description of the state an item is reporting.
 *
 * Deliberately coarse: it changes when the SITUATION changes, not when a clock
 * ticks, so a snooze is not thrown away a second after it is set.
 */
function fingerprintOf(item: NeedsYouItem): string {
  return `${item.category}:${item.entity.id}:${item.severity}:${item.detail ?? ""}`;
}

/** Persist the workflow state a person applied to a derived item. */
export function putMaintenanceNeedsYouItem(item: NeedsYouItem): NeedsYouItem {
  const base = maintenanceNeedsYouBase(item.id);
  if (!base) throw new MaintenanceNotFoundError("Needs You item");

  // Everything past the derived item's own history is what people have added.
  const baseHistoryLength = base.history.length;

  db().needsYouOverlay[item.id] = {
    fingerprint: fingerprintOf(base),
    status: item.status,
    snoozedUntil: item.snoozedUntil,
    snoozeReason: item.snoozeReason,
    resolvedAt: item.resolvedAt,
    resolutionNote: item.resolutionNote,
    assigneeMembershipId: item.assigneeMembershipId,
    history: item.history.slice(baseHistoryLength),
  };
  return item;
}

/** The item as maintenance derives it, before any overlay. */
function maintenanceNeedsYouBase(itemId: string): NeedsYouItem | undefined {
  // Rebuilt across every organization that could have produced it: the caller
  // has already been checked by the time this is used for a write.
  for (const ctx of overlayLookupContexts()) {
    const found = [
      ...overdueServiceItems(ctx),
      ...criticalDefectItems(ctx),
      ...unresolvedRepairItems(ctx),
      ...outOfServiceItems(ctx),
    ].find((i) => i.id === itemId);
    if (found) return found;
  }
  return undefined;
}

/**
 * The contexts an overlay write may be resolved against.
 *
 * Set by the needs-you service immediately before it writes, so a derived item
 * is always rebuilt as the organization that is actually looking at it.
 */
let overlayContexts: MaintenanceContext[] = [];
function overlayLookupContexts(): MaintenanceContext[] {
  return overlayContexts;
}

export function withOverlayContext<T>(ctx: MaintenanceContext, fn: () => T): T {
  const previous = overlayContexts;
  overlayContexts = [ctx];
  try {
    return fn();
  } finally {
    overlayContexts = previous;
  }
}

const SEVERITY_FOR_CRITICALITY: Record<MaintenanceCriticality, NeedsYouSeverity> = {
  safety_critical: "critical",
  important: "high",
  routine: "medium",
};

function overdueServiceItems(ctx: MaintenanceContext): NeedsYouItem[] {
  return listRequirementsSync(ctx, { state: ["overdue"] }).map((view) => {
    const { requirement, equipment, due } = view;
    return {
      id: `${MAINTENANCE_NEEDS_YOU_PREFIX}svc_${requirement.id}`,
      organizationId: ctx.organizationId,
      category: "overdue_service",
      severity: SEVERITY_FOR_CRITICALITY[requirement.criticality],
      status: "open",
      title: `${equipment.unit}: ${requirement.title} is overdue`,
      reason: `${requirement.title} is ${due.label.toLowerCase()} on ${equipment.unit} (${equipment.typeLabel}).`,
      detail: requirement.description,
      entity: {
        kind: equipment.kind === "truck" ? "truck" : "trailer",
        id: equipment.equipmentId,
        label: `${equipment.unit} · ${equipment.typeLabel}`,
        href: `/maintenance/${equipment.kind}/${equipment.equipmentId}`,
      },
      relatedEntities: [
        {
          kind: "maintenance_requirement",
          id: requirement.id,
          label: requirement.title,
          href: `/maintenance/${equipment.kind}/${equipment.equipmentId}`,
        },
      ],
      recommendedAction: {
        kind: "schedule_service",
        label: "Open a repair order",
        requires: ["maintenance:repairs:manage"],
      },
      dueAt: due.dueAt,
      source: "system",
      requires: ["maintenance:view"],
      createdAt: requirement.createdAt,
      history: [
        {
          id: `${requirement.id}_h0`,
          at: requirement.createdAt,
          actor: SYSTEM_ACTOR,
          action: "created",
          note: "Raised because the requirement passed its due point.",
        },
      ],
    };
  });
}

function criticalDefectItems(ctx: MaintenanceContext): NeedsYouItem[] {
  return listDefectsSync(ctx, { severity: ["critical", "out_of_service"] })
    .filter((d) => d.state !== "resolved" && d.state !== "dismissed")
    .map((defect) => {
      const equipment = equipmentSummary(defect.equipment, ctx);
      return {
        id: `${MAINTENANCE_NEEDS_YOU_PREFIX}dfc_${defect.id}`,
        organizationId: ctx.organizationId,
        category: "critical_defect",
        severity: "critical",
        status: "open",
        title: `${equipment.unit}: ${defect.summary}`,
        reason:
          defect.severity === "out_of_service"
            ? `${defect.reportedByName} reported this as unsafe to drive. The equipment is parked until it is resolved.`
            : `${defect.reportedByName} reported a critical fault on ${equipment.unit}.`,
        detail: defect.detail,
        entity: {
          kind: "defect",
          id: defect.id,
          label: defect.summary,
          href: `/maintenance/${equipment.kind}/${equipment.equipmentId}`,
        },
        relatedEntities: [
          {
            kind: equipment.kind === "truck" ? "truck" : "trailer",
            id: equipment.equipmentId,
            label: `${equipment.unit} · ${equipment.typeLabel}`,
            href: equipment.href,
          },
        ],
        recommendedAction: {
          kind: "review_defect",
          label: "Review the defect",
          requires: ["maintenance:defects:manage"],
        },
        source: "system",
        requires: ["maintenance:view"],
        createdAt: defect.reportedAt,
        history: [
          {
            id: `${defect.id}_h0`,
            at: defect.reportedAt,
            actor: defect.reportedBy,
            action: "created",
            note: defect.summary,
          },
        ],
      };
    });
}

/**
 * Repair orders that have stopped moving.
 *
 * Two honest definitions of stuck: a booked date that has passed with the work
 * still not started, or an order open for more than a week. Neither is a guess
 * about the shop — both are facts about the record.
 */
const STUCK_AFTER_DAYS = 7;

function unresolvedRepairItems(ctx: MaintenanceContext): NeedsYouItem[] {
  const nowMs = Date.now();
  return listRepairOrdersSync(ctx)
    .filter((o) => o.status !== "completed" && o.status !== "cancelled")
    .filter((o) => {
      const bookedAndPassed =
        o.scheduledFor !== undefined &&
        new Date(o.scheduledFor).getTime() < nowMs &&
        (o.status === "scheduled" || o.status === "open");
      const openTooLong =
        nowMs - new Date(o.openedAt).getTime() > STUCK_AFTER_DAYS * 86_400_000;
      return bookedAndPassed || openTooLong;
    })
    .map((order) => {
      const equipment = equipmentSummary(order.equipment, ctx);
      const ageDays = Math.floor((nowMs - new Date(order.openedAt).getTime()) / 86_400_000);
      const passedBooking =
        order.scheduledFor !== undefined && new Date(order.scheduledFor).getTime() < nowMs;
      return {
        id: `${MAINTENANCE_NEEDS_YOU_PREFIX}ro_${order.id}`,
        organizationId: ctx.organizationId,
        category: "unresolved_repair",
        severity: equipment.outOfService ? "high" : "medium",
        status: "open",
        title: `${order.number} on ${equipment.unit} is not moving`,
        reason: passedBooking
          ? `${order.number} was booked for ${new Date(order.scheduledFor!).toLocaleDateString()} and has not started.`
          : `${order.number} has been open for ${ageDays} days.`,
        detail: order.title,
        entity: {
          kind: "repair_order",
          id: order.id,
          label: `${order.number} · ${order.title}`,
          href: `/maintenance/${equipment.kind}/${equipment.equipmentId}`,
        },
        relatedEntities: [
          {
            kind: equipment.kind === "truck" ? "truck" : "trailer",
            id: equipment.equipmentId,
            label: `${equipment.unit} · ${equipment.typeLabel}`,
            href: equipment.href,
          },
        ],
        recommendedAction: {
          kind: "open_repair_order",
          label: "Chase the repair order",
          requires: ["maintenance:repairs:manage"],
        },
        dueAt: order.scheduledFor,
        source: "system",
        requires: ["maintenance:view"],
        createdAt: order.openedAt,
        history: [
          {
            id: `${order.id}_h0`,
            at: order.openedAt,
            actor: order.openedBy,
            action: "created",
            note: order.title,
          },
        ],
      };
    });
}

function outOfServiceItems(ctx: MaintenanceContext): NeedsYouItem[] {
  return maintainableEquipment(ctx)
    .filter((ref) => equipmentAccess(ref, ctx)?.kind === "operator")
    .map((ref) => ({ ref, hold: activeHold(ref) }))
    .filter((row): row is { ref: MaintenanceEquipmentRef; hold: EquipmentServiceHold } =>
      row.hold !== undefined)
    // Another organization's hold is visible on the equipment but is not this
    // organization's work item — they cannot release it.
    .filter(({ hold }) => hold.organizationId === ctx.organizationId)
    .map(({ ref, hold }) => {
      const equipment = equipmentSummary(ref, ctx);
      const days = Math.floor((Date.now() - new Date(hold.placedAt).getTime()) / 86_400_000);
      return {
        id: `${MAINTENANCE_NEEDS_YOU_PREFIX}oos_${hold.id}`,
        organizationId: ctx.organizationId,
        category: "equipment_out_of_service",
        severity: "critical",
        status: "open",
        title: `${equipment.unit} is out of service`,
        reason: `${equipment.unit} (${equipment.typeLabel}) has been parked for ${days === 0 ? "less than a day" : days === 1 ? "1 day" : `${days} days`}. It cannot take a load.`,
        detail: hold.reason,
        entity: {
          kind: equipment.kind === "truck" ? "truck" : "trailer",
          id: equipment.equipmentId,
          label: `${equipment.unit} · ${equipment.typeLabel}`,
          href: `/maintenance/${equipment.kind}/${equipment.equipmentId}`,
        },
        recommendedAction: {
          kind: "return_to_service",
          label: "Review and return to service",
          requires: ["maintenance:outofservice:manage"],
        },
        source: "system",
        requires: ["maintenance:view"],
        createdAt: hold.placedAt,
        history: [
          {
            id: `${hold.id}_h0`,
            at: hold.placedAt,
            actor: hold.placedBy,
            action: "created",
            note: hold.reason,
          },
        ],
      };
    });
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const T = TRUCK_IDS;
const TR = TRAILER_IDS;

const truckRef = (equipmentId: string): MaintenanceEquipmentRef => ({ kind: "truck", equipmentId });
const trailerRef = (equipmentId: string): MaintenanceEquipmentRef => ({ kind: "trailer", equipmentId });

function actor(membershipId: string): ActorRef {
  return {
    userId: "usr_sam",
    membershipId,
    displayNameSnapshot: memberName(membershipId),
    source: "web",
  };
}

function historyEntry(
  at: string,
  who: ActorRef,
  action: MaintenanceHistoryEntry["action"],
  note?: string,
): MaintenanceHistoryEntry {
  return { id: rowId("mh"), at, actor: who, action, note };
}

/**
 * Honest fixtures.
 *
 * Every number here is something a person would have typed into the product.
 * Meter readings carry `manual` or `driver_report` and nothing else, because
 * nothing else could have produced them. The data is arranged so that every
 * state the module can reach is reachable by looking at the screen: an overdue
 * mileage job, one that cannot be evaluated because nobody has read the
 * odometer, a deferral with a reason, a truck parked by a driver's report, a
 * repair order stuck waiting for parts, and a service record written by a
 * DIFFERENT carrier on a truck this one now runs.
 */
function buildFixtures(): RegistryState {
  const nlOwner = actor("mem_northline_owner");
  const nlShop = actor("mem_nl_shop");
  const bxOwner = actor("mem_baxter_owner");
  const csDriver = actor("mem_cascade_driver");

  const vendors: MaintenanceVendor[] = [
    { id: "ven_nl_halsted", organizationId: "org_northline", name: "Halsted Truck Center", kind: "dealer", phone: "+1 (312) 555-0190", city: "Chicago", state: "IL", createdAt: daysAgo(400) },
    { id: "ven_nl_midway", organizationId: "org_northline", name: "Midway Trailer Repair", kind: "independent_shop", phone: "+1 (773) 555-0122", city: "Bedford Park", state: "IL", createdAt: daysAgo(300) },
    { id: "ven_nl_yard", organizationId: "org_northline", name: "Northline yard shop", kind: "in_house", city: "Chicago", state: "IL", createdAt: daysAgo(380) },
    { id: "ven_nl_roadside", organizationId: "org_northline", name: "Interstate Mobile Repair", kind: "mobile_service", phone: "+1 (815) 555-0177", createdAt: daysAgo(120) },
    { id: "ven_bx_keystone", organizationId: "org_baxter", name: "Keystone Tire & Service", kind: "tire_service", phone: "+1 (610) 555-0143", city: "Allentown", state: "PA", createdAt: daysAgo(260) },
    { id: "ven_bx_lehigh", organizationId: "org_baxter", name: "Lehigh Diesel", kind: "independent_shop", city: "Bethlehem", state: "PA", createdAt: daysAgo(240) },
    { id: "ven_cs_portland", organizationId: "org_cascade", name: "Portland Fleet Service", kind: "independent_shop", city: "Portland", state: "OR", createdAt: daysAgo(200) },
  ];

  /*
   * -- Meters -------------------------------------------------------------- *
   * There is no meter fixture here any more, and no meter store.
   *
   * Maintenance used to keep an `EquipmentMeter` per truck. The fleet telemetry
   * store kept odometer readings about the same trucks, and the two disagreed:
   * unit NL-104 read 118,450 here and 118,442 there, unit CS-47 was 11,000 miles
   * apart. One physical truck, two canonical values, and mileage typed in on two
   * screens.
   *
   * The seeded history now lives once, in `meter-seed.ts`, behind the canonical
   * Equipment Meter Ledger. `meterFor()` projects from it, and every reading this
   * registry takes — a typed reading, a defect report, a completed service — is
   * contributed to it. Nothing here holds a competing value.
   */

  /* -- Defects ------------------------------------------------------------- */
  const defects: ReportedDefect[] = [];

  const nl115Brakes: ReportedDefect = {
    id: "dfc_nl115_brakes",
    equipment: truckRef(T.nl115),
    organizationId: "org_northline",
    area: "brakes",
    severity: "out_of_service",
    availabilityImpact: "out_of_service",
    summary: "Audible air leak at the front axle service chamber",
    detail: "Pressure drops about 12 psi a minute with the parking brake set. Found on the pre-trip in Memphis.",
    state: "in_repair",
    reportedAt: daysAgo(6),
    reportedBy: { userId: "usr_amir", membershipId: "mem_nl_amir", displayNameSnapshot: "Amir Haddad", source: "telegram" },
    reportedByDriverProfileId: "dp_amir",
    reportedByName: "Amir Haddad",
    meterAtReport: { odometerMiles: 611_980, engineHours: 18_236, readAt: daysAgo(6), source: "driver_report" },
    documentIds: [],
    repairOrderId: "ro_nl_1043",
    history: [
      historyEntry(daysAgo(6), { userId: "usr_amir", membershipId: "mem_nl_amir", displayNameSnapshot: "Amir Haddad", source: "telegram" }, "created", "Audible air leak at the front axle service chamber"),
      historyEntry(daysAgo(6), SYSTEM_ACTOR, "placed_out_of_service", "Reported as unsafe to drive, so the equipment was parked automatically."),
      historyEntry(daysAgo(6), nlShop, "acknowledged", "Towed to Halsted. Booked in for the same afternoon."),
      historyEntry(daysAgo(5), nlShop, "state_changed", "Repair order RO-1043 opened."),
    ],
  };
  defects.push(nl115Brakes);

  const oosTrailer: ReportedDefect = {
    id: "dfc_oos602_floor",
    equipment: trailerRef(TR.oos602),
    organizationId: "org_northline",
    area: "body_doors",
    severity: "out_of_service",
    availabilityImpact: "out_of_service",
    summary: "Floor cross-members cracked near the rear frame",
    detail: "Two cross-members are visibly cracked and the floor flexes under a pallet jack. Not safe to load.",
    state: "in_repair",
    reportedAt: daysAgo(14),
    reportedBy: nlShop,
    reportedByName: "Curtis Vogel",
    documentIds: [],
    repairOrderId: "ro_nl_1041",
    history: [
      historyEntry(daysAgo(14), nlShop, "created", "Floor cross-members cracked near the rear frame"),
      historyEntry(daysAgo(14), SYSTEM_ACTOR, "placed_out_of_service", "Reported as unsafe to load, so the trailer was parked automatically."),
      historyEntry(daysAgo(12), nlShop, "state_changed", "Repair order RO-1041 opened with Midway."),
    ],
  };
  defects.push(oosTrailer);

  defects.push({
    id: "dfc_nl107_abs",
    equipment: truckRef(T.nl107),
    organizationId: "org_northline",
    area: "lights_electrical",
    severity: "critical",
    availabilityImpact: "reduced",
    summary: "ABS warning lamp stays on after start-up",
    detail: "Lamp used to clear after a few minutes and now stays lit. Brakes feel normal.",
    state: "reported",
    reportedAt: hoursAgo(9),
    reportedBy: { userId: "usr_marisol", membershipId: "mem_nl_marisol", displayNameSnapshot: "Marisol Ortiz", source: "telegram" },
    reportedByDriverProfileId: "dp_marisol",
    reportedByName: "Marisol Ortiz",
    meterAtReport: { odometerMiles: 96_320, readAt: hoursAgo(9), source: "driver_report" },
    documentIds: [],
    history: [
      historyEntry(hoursAgo(9), { userId: "usr_marisol", membershipId: "mem_nl_marisol", displayNameSnapshot: "Marisol Ortiz", source: "telegram" }, "created", "ABS warning lamp stays on after start-up"),
    ],
  });

  defects.push({
    id: "dfc_nl104_mirror",
    equipment: truckRef(T.nl104),
    organizationId: "org_northline",
    area: "body_doors",
    severity: "minor",
    availabilityImpact: "none",
    summary: "Driver's side mirror glass cracked",
    detail: "Cracked across the bottom corner. Still usable but worth replacing before the next inspection.",
    state: "reported",
    reportedAt: daysAgo(2),
    reportedBy: { userId: "usr_dmitri", membershipId: "mem_nl_dmitri", displayNameSnapshot: "Dmitri Kovalenko", source: "telegram" },
    reportedByDriverProfileId: "dp_dmitri",
    reportedByName: "Dmitri Kovalenko",
    documentIds: [],
    history: [
      historyEntry(daysAgo(2), { userId: "usr_dmitri", membershipId: "mem_nl_dmitri", displayNameSnapshot: "Dmitri Kovalenko", source: "telegram" }, "created", "Driver's side mirror glass cracked"),
    ],
  });

  defects.push({
    id: "dfc_mt501_reefer",
    equipment: trailerRef(TR.mt501),
    organizationId: "org_northline",
    area: "reefer_unit",
    severity: "major",
    availabilityImpact: "reduced",
    summary: "Reefer unit shutting down on a high-pressure fault",
    detail: "Runs for about 40 minutes then faults out. Fine as a dry van in the meantime.",
    state: "in_repair",
    reportedAt: daysAgo(9),
    reportedBy: nlShop,
    reportedByName: "Curtis Vogel",
    documentIds: [],
    repairOrderId: "ro_nl_1038",
    history: [
      historyEntry(daysAgo(9), nlShop, "created", "Reefer unit shutting down on a high-pressure fault"),
      historyEntry(daysAgo(8), nlShop, "state_changed", "Booked with Midway for a diagnostic."),
    ],
  });

  defects.push({
    id: "dfc_nl111_lamp",
    equipment: truckRef(T.nl111),
    organizationId: "org_northline",
    area: "lights_electrical",
    severity: "minor",
    availabilityImpact: "none",
    summary: "Marker lamp out on the passenger side",
    state: "resolved",
    reportedAt: daysAgo(32),
    reportedBy: nlOwner,
    reportedByName: "Sam Murtaza",
    documentIds: [],
    repairOrderId: "ro_nl_1021",
    resolvedAt: daysAgo(30),
    resolutionNote: "Lamp and pigtail replaced in the yard.",
    history: [
      historyEntry(daysAgo(32), nlOwner, "created", "Marker lamp out on the passenger side"),
      historyEntry(daysAgo(31), nlShop, "acknowledged", "Parts on the shelf. Doing it with the next PM."),
      historyEntry(daysAgo(30), nlShop, "resolved", "Lamp and pigtail replaced in the yard."),
    ],
  });

  defects.push({
    id: "dfc_mdA12_tandem",
    equipment: truckRef(T.mdA12),
    organizationId: "org_baxter",
    area: "coupling",
    severity: "major",
    availabilityImpact: "reduced",
    summary: "Fifth wheel release handle sticking",
    detail: "Takes two hands and a bar to release. Needs cleaning and greasing before it seizes.",
    state: "acknowledged",
    reportedAt: daysAgo(4),
    reportedBy: bxOwner,
    reportedByName: "Sam Murtaza",
    documentIds: [],
    history: [
      historyEntry(daysAgo(4), bxOwner, "created", "Fifth wheel release handle sticking"),
      historyEntry(daysAgo(3), bxOwner, "acknowledged", "Booking it in with Lehigh next week."),
    ],
  });

  // Reported by the Cascade driver — the same person, in their driver membership.
  defects.push({
    id: "dfc_cs47_latch",
    equipment: truckRef(T.cs47),
    organizationId: "org_cascade",
    area: "body_doors",
    severity: "major",
    availabilityImpact: "reduced",
    summary: "Rear door latch not catching on the first pull",
    detail: "Has to be slammed twice to seal. Worried it will pop open on a rough road.",
    state: "reported",
    reportedAt: daysAgo(1),
    reportedBy: csDriver,
    reportedByDriverProfileId: "drv_cascade_0192",
    reportedByName: "Sam Murtaza",
    meterAtReport: { odometerMiles: 143_770, readAt: daysAgo(1), source: "driver_report" },
    documentIds: [],
    history: [
      historyEntry(daysAgo(1), csDriver, "created", "Rear door latch not catching on the first pull"),
    ],
  });

  /* -- Requirements -------------------------------------------------------- */
  const requirements: MaintenanceRequirement[] = [
    // Overdue on mileage: the odometer has run past the due point.
    req("req_nl104_oil", truckRef(T.nl104), "org_northline", "Engine oil and filter", "preventive", "important",
      { kind: "mileage", dueAtMiles: 117_000, intervalMiles: 15_000, warnMiles: 1_500 },
      nlShop, daysAgo(120), { responsibleMembershipId: "mem_nl_shop" }),

    // Overdue on a date, and safety critical — the loudest thing on the board.
    req("req_nl118_dot", truckRef(T.nl118), "org_northline", "Annual DOT inspection", "inspection", "safety_critical",
      { kind: "date", dueAt: daysAgo(9), intervalDays: 365, warnDays: 30 },
      nlOwner, daysAgo(370), { responsibleMembershipId: "mem_nl_safety" }),

    // In service: the work is happening right now under RO-1043.
    req("req_nl115_dot", truckRef(T.nl115), "org_northline", "Annual DOT inspection", "inspection", "safety_critical",
      { kind: "date", dueAt: daysAgo(4), intervalDays: 365, warnDays: 30 },
      nlOwner, daysAgo(369), { activeRepairOrderId: "ro_nl_1043", responsibleMembershipId: "mem_nl_shop" }),

    // Due soon on a date.
    req("req_nl107_brakes", truckRef(T.nl107), "org_northline", "Brake inspection and adjustment", "brakes", "important",
      { kind: "date", dueAt: daysFromNow(5), intervalDays: 180, warnDays: 14 },
      nlShop, daysAgo(175), { responsibleMembershipId: "mem_nl_shop" }),

    // Due soon on mileage.
    req("req_nl111_tires", truckRef(T.nl111), "org_northline", "Tire rotation and pressure check", "tires", "routine",
      { kind: "mileage", dueAtMiles: 216_000, intervalMiles: 20_000, warnMiles: 2_000 },
      nlShop, daysAgo(90), {}),

    // Comfortably upcoming.
    req("req_nl131_pm", truckRef(T.nl131), "org_northline", "Preventive service A", "preventive", "routine",
      { kind: "mileage", dueAtMiles: 50_000, intervalMiles: 25_000, warnMiles: 2_500 },
      nlShop, daysAgo(60), {}),

    // Deferred, with a recorded reason and an end date.
    req("req_nl104_cabin", truckRef(T.nl104), "org_northline", "Cabin air filter", "preventive", "routine",
      { kind: "date", dueAt: daysAgo(3), intervalDays: 180, warnDays: 14 },
      nlShop, daysAgo(183), {
        deferral: {
          reason: "Filter is on back order. Truck is on short local runs until it arrives.",
          until: daysFromNow(17),
          deferredAt: daysAgo(3),
          deferredBy: nlShop,
        },
      }),

    // Engine hours, on a reefer unit rather than a power unit — and overdue.
    req("req_rf114_reefer", trailerRef(TR.rf114), "org_northline", "Reefer unit 3,000-hour service", "reefer", "important",
      { kind: "engine_hours", dueAtHours: 9_000, intervalHours: 3_000, warnHours: 150 },
      nlShop, daysAgo(200), { responsibleMembershipId: "mem_nl_shop" }),

    // Unanswerable: nobody has ever read this truck's odometer.
    req("req_nl127_trans", truckRef(T.claimed), "org_northline", "Transmission service", "transmission", "important",
      { kind: "mileage", dueAtMiles: 300_000, intervalMiles: 100_000, warnMiles: 5_000 },
      nlShop, daysAgo(45), {}),

    // Raised from a defect, tied to the fault that caused it.
    req("req_mt501_reefer_fault", trailerRef(TR.mt501), "org_northline", "Diagnose reefer high-pressure fault", "reefer", "important",
      { kind: "defect", defectId: "dfc_mt501_reefer", reportedSeverity: "major", dueAt: daysFromNow(3) },
      nlShop, daysAgo(9), { activeRepairOrderId: "ro_nl_1038" }),

    // Baxter's own schedule, on Baxter's own equipment.
    req("req_mdA12_pm", truckRef(T.mdA12), "org_baxter", "Preventive service B", "preventive", "important",
      { kind: "mileage", dueAtMiles: 390_000, intervalMiles: 25_000, warnMiles: 2_000 },
      bxOwner, daysAgo(70), { responsibleMembershipId: "mem_bx_shop" }),

    req("req_mdA18_dot", truckRef(T.mdA18), "org_baxter", "Annual DOT inspection", "inspection", "safety_critical",
      { kind: "date", dueAt: daysAgo(2), intervalDays: 365, warnDays: 30 },
      bxOwner, daysAgo(367), { responsibleMembershipId: "mem_bx_shop" }),

    // Cascade's schedule on the truck its driver is on.
    req("req_cs47_oil", truckRef(T.cs47), "org_cascade", "Engine oil and filter", "preventive", "important",
      { kind: "mileage", dueAtMiles: 145_000, intervalMiles: 15_000, warnMiles: 1_500 },
      csDriver, daysAgo(100), {}),
  ];

  /* -- Repair orders ------------------------------------------------------- */
  const repairOrders: RepairOrder[] = [
    {
      id: "ro_nl_1043", number: "RO-1043", equipment: truckRef(T.nl115), organizationId: "org_northline",
      status: "in_progress", title: "Front axle air leak and annual inspection",
      vendor: { vendorId: "ven_nl_halsted", name: "Halsted Truck Center", kind: "dealer", city: "Chicago", state: "IL" },
      lines: [
        { id: "rol_1", kind: "part", description: "Service chamber, front axle", quantity: 2, unitCostCents: 18_400, totalCents: 36_800 },
        { id: "rol_2", kind: "labor", description: "Diagnose and replace service chambers", quantity: 3.5, unitCostCents: 14_500, totalCents: 50_750 },
      ],
      cost: { estimate: usd(2_450), actual: usd(875.5), parts: usd(368), labor: usd(507.5) },
      downtime: { startedAt: daysAgo(5) },
      responsibleMembershipId: "mem_nl_shop", responsibleName: "Curtis Vogel",
      scheduledFor: daysAgo(5), openedAt: daysAgo(5), openedBy: nlShop,
      requirementIds: ["req_nl115_dot"], defectIds: ["dfc_nl115_brakes"], documentIds: [],
      notes: "Doing the annual at the same time since it is on the lift.",
      history: [
        historyEntry(daysAgo(5), nlShop, "created", "Front axle air leak and annual inspection"),
        historyEntry(daysAgo(5), nlShop, "vendor_assigned", "Halsted Truck Center."),
        historyEntry(daysAgo(4), nlShop, "state_changed", "On the lift. Chambers on order from the counter."),
      ],
    },
    {
      id: "ro_nl_1041", number: "RO-1041", equipment: trailerRef(TR.oos602), organizationId: "org_northline",
      status: "awaiting_parts", title: "Replace cracked floor cross-members",
      vendor: { vendorId: "ven_nl_midway", name: "Midway Trailer Repair", kind: "independent_shop", city: "Bedford Park", state: "IL" },
      lines: [],
      cost: { estimate: usd(3_800) },
      downtime: { startedAt: daysAgo(12) },
      responsibleMembershipId: "mem_nl_shop", responsibleName: "Curtis Vogel",
      openedAt: daysAgo(12), openedBy: nlShop,
      requirementIds: [], defectIds: ["dfc_oos602_floor"], documentIds: [],
      notes: "Cross-members are a two-week lead time. Trailer stays parked.",
      history: [
        historyEntry(daysAgo(12), nlShop, "created", "Replace cracked floor cross-members"),
        historyEntry(daysAgo(11), nlShop, "state_changed", "Waiting on cross-members. Two week lead time quoted."),
      ],
    },
    {
      id: "ro_nl_1038", number: "RO-1038", equipment: trailerRef(TR.mt501), organizationId: "org_northline",
      status: "scheduled", title: "Reefer high-pressure fault diagnostic",
      vendor: { vendorId: "ven_nl_midway", name: "Midway Trailer Repair", kind: "independent_shop", city: "Bedford Park", state: "IL" },
      lines: [],
      cost: { estimate: usd(650) },
      downtime: {},
      responsibleMembershipId: "mem_nl_shop", responsibleName: "Curtis Vogel",
      // Booked for a date that has already passed and still not started.
      scheduledFor: daysAgo(3), openedAt: daysAgo(8), openedBy: nlShop,
      requirementIds: ["req_mt501_reefer_fault"], defectIds: ["dfc_mt501_reefer"], documentIds: [],
      history: [
        historyEntry(daysAgo(8), nlShop, "created", "Reefer high-pressure fault diagnostic"),
        historyEntry(daysAgo(8), nlShop, "scheduled", "Booked with Midway."),
      ],
    },
    {
      id: "ro_nl_1030", number: "RO-1030", equipment: truckRef(T.nl107), organizationId: "org_northline",
      status: "completed", title: "Engine oil and filter service",
      vendor: { vendorId: "ven_nl_yard", name: "Northline yard shop", kind: "in_house", city: "Chicago", state: "IL" },
      lines: [
        { id: "rol_10", kind: "part", description: "Oil filter and 12 qt 15W-40", totalCents: 14_940 },
        { id: "rol_11", kind: "labor", description: "PM service", quantity: 1.5, unitCostCents: 16_000, totalCents: 24_000 },
      ],
      cost: { estimate: usd(400), actual: usd(389.4), parts: usd(149.4), labor: usd(240) },
      downtime: { startedAt: daysAgo(20), endedAt: daysAgo(20), hours: 4 },
      responsibleMembershipId: "mem_nl_shop", responsibleName: "Curtis Vogel",
      openedAt: daysAgo(21), openedBy: nlShop, completedAt: daysAgo(20),
      requirementIds: [], defectIds: [], documentIds: [], serviceRecordId: "svc_nl107_oil",
      history: [
        historyEntry(daysAgo(21), nlShop, "created", "Engine oil and filter service"),
        historyEntry(daysAgo(20), nlShop, "resolved", "Service recorded. The record is permanent and cannot be changed."),
      ],
    },
    {
      id: "ro_nl_1021", number: "RO-1021", equipment: truckRef(T.nl111), organizationId: "org_northline",
      status: "completed", title: "Marker lamp replacement",
      vendor: { vendorId: "ven_nl_yard", name: "Northline yard shop", kind: "in_house", city: "Chicago", state: "IL" },
      lines: [{ id: "rol_20", kind: "part", description: "Marker lamp and pigtail", totalCents: 3_400 }],
      cost: { actual: usd(84), parts: usd(34), labor: usd(50) },
      downtime: { startedAt: daysAgo(30), endedAt: daysAgo(30), hours: 1.5 },
      openedAt: daysAgo(31), openedBy: nlShop, completedAt: daysAgo(30),
      requirementIds: [], defectIds: ["dfc_nl111_lamp"], documentIds: [], serviceRecordId: "svc_nl111_lamp",
      history: [
        historyEntry(daysAgo(31), nlShop, "created", "Marker lamp replacement"),
        historyEntry(daysAgo(30), nlShop, "resolved", "Service recorded. The record is permanent and cannot be changed."),
      ],
    },
  ];

  /* -- Service history. Append-only, and it outlives relationships. --------- */
  const serviceRecords: ServiceRecord[] = [
    svc("svc_nl107_oil", truckRef(T.nl107), daysAgo(20), "preventive", "Engine oil and filter service", {
      org: ["org_northline", "Northline Freight"],
      vendor: { vendorId: "ven_nl_yard", name: "Northline yard shop", kind: "in_house", city: "Chicago", state: "IL" },
      cost: { estimate: usd(400), actual: usd(389.4), parts: usd(149.4), labor: usd(240) },
      downtimeHours: 4,
      meter: { odometerMiles: 92_100, readAt: daysAgo(20), source: "service_record" },
      repairOrder: ["ro_nl_1030", "RO-1030"],
      responsible: ["mem_nl_shop", "Curtis Vogel"],
      recordedBy: nlShop,
      summary: "Oil, filter and a full walk-around. Nothing else found.",
    }),

    svc("svc_nl111_lamp", truckRef(T.nl111), daysAgo(30), "electrical", "Marker lamp replacement", {
      org: ["org_northline", "Northline Freight"],
      vendor: { vendorId: "ven_nl_yard", name: "Northline yard shop", kind: "in_house", city: "Chicago", state: "IL" },
      cost: { actual: usd(84), parts: usd(34), labor: usd(50) },
      downtimeHours: 1.5,
      meter: { odometerMiles: 211_400, readAt: daysAgo(30), source: "service_record" },
      repairOrder: ["ro_nl_1021", "RO-1021"],
      defectIds: ["dfc_nl111_lamp"],
      recordedBy: nlShop,
      summary: "Lamp and pigtail replaced. Connector was corroded.",
    }),

    svc("svc_nl115_brakes", truckRef(T.nl115), daysAgo(145), "brakes", "Brake relining, all axles", {
      org: ["org_northline", "Northline Freight"],
      vendor: { vendorId: "ven_nl_halsted", name: "Halsted Truck Center", kind: "dealer", city: "Chicago", state: "IL" },
      cost: { actual: usd(3_214), parts: usd(1_890), labor: usd(1_324) },
      downtimeHours: 26,
      meter: { odometerMiles: 588_300, engineHours: 17_610, readAt: daysAgo(145), source: "service_record" },
      responsible: ["mem_nl_shop", "Curtis Vogel"],
      recordedBy: nlShop,
      summary: "Shoes, drums and hardware on all three axles.",
    }),

    svc("svc_nl104_dot", truckRef(T.nl104), daysAgo(200), "inspection", "Annual DOT inspection", {
      org: ["org_northline", "Northline Freight"],
      vendor: { vendorId: "ven_nl_yard", name: "Northline yard shop", kind: "in_house", city: "Chicago", state: "IL" },
      cost: { actual: usd(180), labor: usd(180) },
      downtimeHours: 3,
      meter: { odometerMiles: 101_200, readAt: daysAgo(200), source: "service_record" },
      recordedBy: nlOwner,
      summary: "Passed with no defects noted.",
    }),

    /**
     * The cross-organization case, and the reason this whole module is keyed by
     * equipment id.
     *
     * Baxter is also approved to run nl104 under its own authority, and did
     * this work under it. The record belongs to the TRUCK. Northline sees that
     * it happened, on what date, at what odometer, and by whom — and sees none
     * of Baxter's cost, vendor or notes.
     */
    svc("svc_nl104_baxter_tire", truckRef(T.nl104), daysAgo(62), "tires", "Roadside tire replacement, drive axle", {
      org: ["org_baxter", "Baxter Transit LLC"],
      vendor: { vendorId: "ven_bx_keystone", name: "Keystone Tire & Service", kind: "tire_service", city: "Allentown", state: "PA" },
      cost: { actual: usd(612), parts: usd(486), labor: usd(126) },
      downtimeHours: 5,
      meter: { odometerMiles: 109_880, readAt: daysAgo(62), source: "service_record" },
      responsible: ["mem_baxter_owner", "Sam Murtaza"],
      recordedBy: bxOwner,
      summary: "Blowout on I-78. Replaced with a matched recap.",
      notes: "Claimed against the roadside policy.",
    }),

    svc("svc_mdA12_pm", truckRef(T.mdA12), daysAgo(75), "preventive", "Preventive service A", {
      org: ["org_baxter", "Baxter Transit LLC"],
      vendor: { vendorId: "ven_bx_lehigh", name: "Lehigh Diesel", kind: "independent_shop", city: "Bethlehem", state: "PA" },
      cost: { actual: usd(742.15), parts: usd(310.15), labor: usd(432) },
      downtimeHours: 7,
      meter: { odometerMiles: 365_000, engineHours: 10_980, readAt: daysAgo(75), source: "service_record" },
      recordedBy: bxOwner,
      summary: "Full PM. Air dryer cartridge replaced at the same time.",
    }),

    svc("svc_cs47_oil", truckRef(T.cs47), daysAgo(45), "preventive", "Engine oil and filter", {
      org: ["org_cascade", "Cascade Haul"],
      vendor: { vendorId: "ven_cs_portland", name: "Portland Fleet Service", kind: "independent_shop", city: "Portland", state: "OR" },
      cost: { actual: usd(296.8) },
      downtimeHours: 2,
      meter: { odometerMiles: 130_100, readAt: daysAgo(45), source: "service_record" },
      recordedBy: csDriver,
    }),
  ];

  /* -- Out-of-service holds ------------------------------------------------ */
  const holds: EquipmentServiceHold[] = [
    {
      id: "hold_nl115", equipment: truckRef(T.nl115), organizationId: "org_northline",
      reason: "Defect reported: audible air leak at the front axle service chamber",
      placedAt: daysAgo(6), placedBy: nl115Brakes.reportedBy,
      sourceDefectId: "dfc_nl115_brakes", sourceRepairOrderId: "ro_nl_1043",
    },
    {
      id: "hold_oos602", equipment: trailerRef(TR.oos602), organizationId: "org_northline",
      reason: "Defect reported: floor cross-members cracked near the rear frame",
      placedAt: daysAgo(14), placedBy: nlShop,
      sourceDefectId: "dfc_oos602_floor", sourceRepairOrderId: "ro_nl_1041",
    },
  ];

  /**
   * Sharing.
   *
   * Baxter shares two of its trucks with Meridian, which dispatches them. Note
   * what is deliberately NOT here: Meridian also holds dispatch access to
   * Ridgeway's B-04 and Crosswind's C-31, and sees no maintenance at all for
   * either — because neither carrier shared it. That absence is the rule
   * working, not missing fixture data.
   */
  const shares: MaintenanceShare[] = [
    {
      id: "shr_mdA12_meridian", equipment: truckRef(T.mdA12),
      grantedByOrganizationId: "org_baxter", grantedByOrganizationName: "Baxter Transit LLC",
      sharedWithOrganizationId: "org_meridian", scope: "availability_and_schedule", status: "active",
      reason: "Meridian books this tractor daily and needs to plan around shop time.",
      startedAt: daysAgo(90), createdBy: bxOwner,
    },
    {
      id: "shr_mdA18_meridian", equipment: truckRef(T.mdA18),
      grantedByOrganizationId: "org_baxter", grantedByOrganizationName: "Baxter Transit LLC",
      sharedWithOrganizationId: "org_meridian", scope: "availability_only", status: "active",
      reason: "So Meridian stops offering loads while the van is parked.",
      startedAt: daysAgo(40), createdBy: bxOwner,
    },
  ];

  return {
    requirements, defects, repairOrders, serviceRecords, holds, vendors, shares,
    needsYouOverlay: {},
  };
}

/* -- Fixture helpers ------------------------------------------------------- */

function req(
  id: string,
  equipment: MaintenanceEquipmentRef,
  organizationId: string,
  title: string,
  category: MaintenanceCategory,
  criticality: MaintenanceCriticality,
  trigger: MaintenanceTrigger,
  createdBy: ActorRef,
  createdAt: string,
  extra: Partial<MaintenanceRequirement>,
): MaintenanceRequirement {
  return {
    id, equipment, organizationId, title, category, criticality, trigger,
    documentIds: [], createdAt, createdBy, ...extra,
  };
}

function svc(
  id: string,
  equipment: MaintenanceEquipmentRef,
  performedAt: string,
  category: MaintenanceCategory,
  title: string,
  input: {
    org: [string, string];
    vendor?: ServiceRecord["vendor"];
    cost?: ServiceRecord["cost"];
    downtimeHours?: number;
    meter?: MeterReading;
    repairOrder?: [string, string];
    requirement?: [string, string];
    responsible?: [string, string];
    defectIds?: string[];
    recordedBy: ActorRef;
    summary?: string;
    notes?: string;
  },
): ServiceRecord {
  return {
    id, equipment, performedAt, recordedAt: performedAt, category, title,
    summary: input.summary,
    performedForOrganizationId: input.org[0],
    performedForOrganizationName: input.org[1],
    vendor: input.vendor,
    cost: input.cost,
    downtimeHours: input.downtimeHours,
    meter: input.meter,
    responsibleMembershipId: input.responsible?.[0],
    responsibleName: input.responsible?.[1],
    requirementId: input.requirement?.[0],
    requirementTitle: input.requirement?.[1],
    repairOrderId: input.repairOrder?.[0],
    repairOrderNumber: input.repairOrder?.[1],
    defectIds: input.defectIds ?? [],
    documentIds: [],
    notes: input.notes,
    recordedBy: input.recordedBy,
  };
}
