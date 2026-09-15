import type {
  FleetAssetKind, FleetAssignmentRecord, FleetAssignmentTriad,
  FleetEquipmentFilters, FleetEquipmentRow, FleetFleetSummary,
  FleetRecordLinks, FleetStatusCounts, FleetTelemetryReading, FleetUtilizationSummary,
  PermissionKey, Trailer, TrailerAttachment, TrailerDocument, Truck, TruckDocument,
} from "@/types";
import {
  aggregateUtilization, deriveAuthorityLock, deriveOperationalStatus, deriveReadiness,
  deriveUtilization, telemetrySnapshot, UTILIZATION_WINDOW_DAYS,
  type FleetInterval, type FleetReadinessFacts,
} from "@/lib/fleet/operational-status";
import { FLEET_INTEGRATIONS } from "@/lib/fleet/integrations";
import { PermissionDeniedError, type ServiceContext } from "../contracts/context";
import type {
  FleetAssetDetail, FleetService, RecordTelemetryInput,
} from "../contracts/fleet";
import {
  fleetSync, getTruckProfile, truckContextFrom,
  type TruckContext, type TruckProfileView,
} from "./truck-registry";
import {
  getTrailerProfile, trailerFleetSync,
  type TrailerContext, type TrailerProfileView,
} from "./trailer-registry";
import {
  appendReading, latestReading, meterContributionFor, readingHistory,
} from "./fleet-telemetry";
import { contributeAndPublish, meterStateOf } from "./meter-ledger";
// Side-effect import: wires every projection to the bus before anything is
// published. A publisher with no subscribers registered would drop events.
import "./projections";
import { mockStore } from "./store";
import { fleetNeedsYouItems } from "./fleet-needs-you";
import { mockListCarrierDrivers } from "@/features/driver/mock-carrier-drivers";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The shared operational fleet layer.
 *
 * This adapter holds no equipment of its own. Every row it returns is assembled
 * on read from records that already exist:
 *
 *   the Truck and the Trailer      physical state, registration, specifications
 *   the carrier relationship       the unit number, and whether you may be here
 *   the operating-authority lease  who is running it right now, and until when
 *   the driver assignment          who is on the truck, since when
 *   the trailer attachment         what is hooked to it, since when
 *   the document records           what paperwork is in hand and what expired
 *   the load records               what it is currently working on
 *   the telemetry readings         where it is, per the last person who said
 *
 * Because of that, there is no possibility of this layer disagreeing with the
 * Trucks screen or the Trailers screen: they read the same registries through
 * the same access rules, and this file adds reconciliation, not storage.
 *
 * Access is not re-implemented here either. `fleetSync` and `trailerFleetSync`
 * already decide what an organization may see — a carrier sees what it is
 * onboarded on, a dispatch organization sees only what a carrier explicitly
 * shared with it, a driver sees the truck they are on and nothing else, and a
 * truck held under another carrier's authority is reported as busy without
 * naming who has it. Calling those is the whole of the isolation story; adding
 * a second rule set here is how the two would drift apart.
 */

const LATENCY_MS = 220;
const wait = (ms = LATENCY_MS) => new Promise<void>((r) => setTimeout(r, ms));

function require(ctx: ServiceContext, ...keys: PermissionKey[]) {
  const missing = keys.filter((k) => !ctx.permissions.has(k));
  if (missing.length) throw new PermissionDeniedError(missing);
}

/**
 * A trailer-registry context from a ServiceContext.
 *
 * The mirror of `truckContextFrom`, and built the same way: the organization
 * always comes from the authenticated membership, never from a route param or
 * a form field, so a screen cannot ask the registry to act as somebody else.
 */
export function trailerContextFrom(ctx: ServiceContext): TrailerContext {
  return {
    organizationId: ctx.organizationId,
    membershipId: ctx.membershipId,
    actorName: ctx.actor.displayNameSnapshot,
    permissions: ctx.permissions,
    driverProfileId: ctx.scope.loads === "assigned" ? ctx.driverProfileId : undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* Shared derivation helpers                                                   */
/* -------------------------------------------------------------------------- */

/** Activation states in which SOME lease holds the asset — mine or another's. */
const HOLDING_STATES = new Set([
  "activation_reserved", "active_operating_lease", "pending_release", "locked_by_other",
]);

const DOC_WARNING_STATUSES = new Set([
  "expired", "expiring_soon", "rejected", "missing",
]);

/** The newest document of a kind that has not been replaced. */
function currentDocument<D extends { kind: string; supersededByDocumentId?: string; createdAt: string }>(
  documents: D[],
  kind: string,
): D | undefined {
  return documents
    .filter((d) => d.kind === kind && !d.supersededByDocumentId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

/**
 * When the current down spell began, per the timeline.
 *
 * Read from the append-only event log rather than guessed. When the asset is
 * down and no event records the change, this returns nothing and the
 * utilization summary reports itself as not fully derived — which is the
 * truthful answer, and better than counting the downtime as zero.
 */
function downSince(events: Array<{ at: string; kind: string }>): string | undefined {
  return events
    .filter((e) => e.kind === "status_changed")
    .sort((a, b) => b.at.localeCompare(a.at))[0]?.at;
}

/** Only this organization's own leases. Another carrier's time is not yours. */
function ownLeaseIntervals(
  leases: Array<{ organizationId: string; activatedAt?: string; reservedAt?: string; createdAt: string; endedAt?: string }>,
  organizationId: string,
): FleetInterval[] {
  return leases
    .filter((l) => l.organizationId === organizationId)
    .map((l) => ({ startAt: l.activatedAt ?? l.reservedAt ?? l.createdAt, endAt: l.endedAt }));
}

/* -------------------------------------------------------------------------- */
/* Cross-module links                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The load this equipment is currently working, from the load records.
 *
 * Read from the organization's own load store, so a dispatch organization sees
 * the loads it manages and nothing else, and a load belonging to another
 * carrier is never reachable through an equipment row.
 */
function currentLoadFor(organizationId: string, truckId: string): { id: string; reference: string } | undefined {
  let org;
  try {
    org = mockStore.org(organizationId);
  } catch {
    return undefined;
  }
  const TERMINAL = new Set(["delivered", "invoiced", "paid", "cancelled"]);
  const found = org.loads.find(
    (l) => l.assignment?.truckId === truckId && !TERMINAL.has(l.status),
  );
  return found ? { id: found.id, reference: found.reference ?? found.id } : undefined;
}

/** driverProfileId -> the carrier's relationship id, which is what /people/drivers keys on. */
let driverRelationshipIds: Map<string, string> | null = null;
async function driverRelationshipId(driverProfileId: string): Promise<string | undefined> {
  if (!driverRelationshipIds) {
    const drivers = await mockListCarrierDrivers();
    driverRelationshipIds = new Map(drivers.map((d) => [d.driverProfileId, d.id]));
  }
  return driverRelationshipIds.get(driverProfileId);
}

function buildLinks(input: {
  assetKind: FleetAssetKind;
  assetId: string;
  pairedTruckId?: string;
  pairedTrailerId?: string;
  driverRelationshipId?: string;
  carrierName?: string;
  loadId?: string;
  expectedAvailableAt?: string;
}): FleetRecordLinks {
  const links: FleetRecordLinks = {};

  if (input.assetKind === "truck") {
    links.truck = { label: "Truck record", href: `/fleet/trucks/${input.assetId}` };
    if (input.pairedTrailerId) {
      links.trailer = { label: "Trailer record", href: `/fleet/trailers/${input.pairedTrailerId}` };
    }
  } else {
    links.trailer = { label: "Trailer record", href: `/fleet/trailers/${input.assetId}` };
    if (input.pairedTruckId) {
      links.truck = { label: "Power unit record", href: `/fleet/trucks/${input.pairedTruckId}` };
    }
  }

  if (input.driverRelationshipId) {
    links.driver = { label: "Driver record", href: `/people/drivers/${input.driverRelationshipId}` };
  }
  if (input.carrierName) {
    // The carrier's own organization record is not a screen a counterparty can
    // open, so this points at the equipment's relationships instead of
    // pretending a carrier profile exists.
    links.carrier = {
      label: `Carrier relationships (${input.carrierName})`,
      href: input.assetKind === "truck"
        ? `/fleet/trucks/${input.assetId}`
        : `/fleet/trailers/${input.assetId}`,
    };
  }
  links.documents = { label: "Documents", href: "/documents" };
  if (input.loadId) {
    links.load = { label: "Current load", href: `/loads/${input.loadId}` };
  }
  if (input.expectedAvailableAt) {
    links.mtLoop = { label: "MTloop — going empty", href: "/home", deferred: true };
  }
  // Compliance and maintenance are separate modules that are not built yet.
  // Rendering them as deferred is honest; hiding them would imply this layer
  // has nothing to say about paperwork or the shop, and it plainly does.
  links.compliance = { label: "Compliance", href: "/needs-you", deferred: true };
  links.maintenance = { label: "Maintenance", href: "/needs-you", deferred: true };
  return links;
}

/* -------------------------------------------------------------------------- */
/* Row assembly                                                                */
/* -------------------------------------------------------------------------- */

interface TruckRowInput {
  profile: TruckProfileView;
  unit: string;
  attachedTrailer?: { trailerId: string; unit: string; since: string };
  nowMs: number;
}

async function truckRow(ctx: ServiceContext, input: TruckRowInput): Promise<FleetEquipmentRow> {
  const { profile, unit, attachedTrailer, nowMs } = input;
  const truck: Truck = profile.truck;
  const hasLiveLease = HOLDING_STATES.has(profile.activationState);

  const derivation = deriveOperationalStatus({
    assetKind: "truck",
    recordStatus: truck.status,
    expectedAvailableAt: truck.availability.expectedAvailableAt,
    hasLiveLease,
    leaseIsMine: Boolean(profile.myLease),
    leaseStatus: profile.myLease?.status,
  }, nowMs);

  const authority = deriveAuthorityLock(
    profile.activationState, derivation.status, profile.operatingCarrierName,
  );

  const documents = profile.documents as TruckDocument[];
  const readiness = deriveReadiness({
    assetKind: "truck",
    plateNumber: truck.registration.plateNumber,
    plateState: truck.registration.plateState,
    plateExpiresAt: truck.registration.expiresAt,
    registrationDocument: currentDocument(documents, "registration"),
    permitDocument: currentDocument(documents, "cab_card"),
  } satisfies FleetReadinessFacts, nowMs);

  const assignment = profile.assignments.find(
    (a) => !a.endedAt && a.organizationId === ctx.organizationId,
  );
  const load = currentLoadFor(ctx.organizationId, truck.truckId);

  return {
    assetKind: "truck",
    assetId: truck.truckId,
    unit,
    truckEquipmentType: truck.equipmentType,
    recordStatus: truck.status,
    derivation,
    authority,
    // Location from this layer's own store; the meters from the one ledger.
    telemetry: telemetrySnapshot(
      latestReading(truck.truckId, ctx.organizationId), "truck", nowMs,
      meterStateOf(truck.truckId),
    ),
    readiness,
    driver: assignment
      ? {
        driverProfileId: assignment.driverProfileId,
        driverName: assignment.driverName,
        since: assignment.startedAt,
      }
      : undefined,
    pairedTrailer: attachedTrailer,
    carrierName: profile.operatingCarrierName,
    myLoadReference: profile.myLease?.loadReference,
    leaseExpectedEndAt: profile.myLease?.expectedEndAt,
    expectedAvailableAt: truck.availability.expectedAvailableAt,
    documentWarnings: documents.filter((d) => DOC_WARNING_STATUSES.has(d.status)).length,
    links: buildLinks({
      assetKind: "truck",
      assetId: truck.truckId,
      pairedTrailerId: attachedTrailer?.trailerId,
      driverRelationshipId: assignment
        ? await driverRelationshipId(assignment.driverProfileId)
        : undefined,
      carrierName: profile.operatingCarrierName,
      loadId: load?.id,
      expectedAvailableAt: truck.availability.expectedAvailableAt,
    }),
  };
}

interface TrailerRowInput {
  profile: TrailerProfileView;
  unit: string;
  pairedTruckUnit?: string;
  nowMs: number;
}

function trailerRow(ctx: ServiceContext, input: TrailerRowInput): FleetEquipmentRow {
  const { profile, unit, pairedTruckUnit, nowMs } = input;
  const trailer: Trailer = profile.trailer;
  const hasLiveLease = HOLDING_STATES.has(profile.activationState);

  const derivation = deriveOperationalStatus({
    assetKind: "trailer",
    recordStatus: trailer.status,
    expectedAvailableAt: trailer.availability.expectedAvailableAt,
    attachmentState: profile.attachmentState,
    hasLiveLease,
    leaseIsMine: Boolean(profile.myLease),
    leaseStatus: profile.myLease?.status,
  }, nowMs);

  const authority = deriveAuthorityLock(
    profile.activationState, derivation.status, profile.operatingCarrierName,
  );

  const documents = profile.documents as TrailerDocument[];
  const readiness = deriveReadiness({
    assetKind: "trailer",
    plateNumber: trailer.registration.plateNumber,
    plateState: trailer.registration.plateState,
    plateExpiresAt: trailer.registration.expiresAt,
    registrationDocument: currentDocument(documents, "registration"),
  } satisfies FleetReadinessFacts, nowMs);

  const attachment = profile.currentAttachment;

  return {
    assetKind: "trailer",
    assetId: trailer.trailerId,
    unit,
    trailerType: trailer.trailerType,
    recordStatus: trailer.status,
    attachmentState: profile.attachmentState,
    derivation,
    authority,
    telemetry: telemetrySnapshot(
      latestReading(trailer.trailerId, ctx.organizationId), "trailer", nowMs,
      meterStateOf(trailer.trailerId),
    ),
    readiness,
    pairedTruck: attachment
      ? {
        truckId: attachment.truckId,
        unit: pairedTruckUnit ?? attachment.truckUnitLabel,
        since: attachment.attachedAt ?? attachment.reservedAt ?? attachment.createdAt,
      }
      : undefined,
    carrierName: profile.operatingCarrierName,
    myLoadReference: profile.myLease?.loadReference,
    leaseExpectedEndAt: profile.myLease?.expectedEndAt,
    expectedAvailableAt: trailer.availability.expectedAvailableAt,
    documentWarnings: documents.filter((d) => DOC_WARNING_STATUSES.has(d.status)).length,
    links: buildLinks({
      assetKind: "trailer",
      assetId: trailer.trailerId,
      pairedTruckId: attachment?.truckId,
      carrierName: profile.operatingCarrierName,
      expectedAvailableAt: trailer.availability.expectedAvailableAt,
    }),
  };
}

/* -------------------------------------------------------------------------- */
/* Loading                                                                     */
/* -------------------------------------------------------------------------- */

interface LoadedFleet {
  rows: FleetEquipmentRow[];
  truckProfiles: Map<string, TruckProfileView>;
  trailerProfiles: Map<string, TrailerProfileView>;
  truckUnits: Map<string, string>;
}

/**
 * Every asset the caller may operationally see, with its permanent records.
 *
 * Trucks and trailers are gated separately and on purpose: `fleet:view` opens
 * this layer, but a membership still needs `trucks:view` to be shown trucks and
 * `trailers:view` to be shown trailers. The fleet dashboard grants no access
 * the equipment modules would not have granted on their own.
 */
async function loadFleet(ctx: ServiceContext, nowMs: number): Promise<LoadedFleet> {
  const truckCtx: TruckContext = truckContextFrom(ctx);
  const trailerCtx: TrailerContext = trailerContextFrom(ctx);

  const truckStubs = ctx.permissions.has("trucks:view") ? fleetSync(truckCtx) : [];
  const trailerStubs = ctx.permissions.has("trailers:view") ? trailerFleetSync(trailerCtx) : [];

  const [truckProfileList, trailerProfileList] = await Promise.all([
    Promise.all(truckStubs.map((t) => getTruckProfile(t.truckId, truckCtx))),
    Promise.all(trailerStubs.map((t) => getTrailerProfile(t.trailerId, trailerCtx))),
  ]);

  const truckUnits = new Map(truckStubs.map((t) => [t.truckId, t.unit]));
  const truckProfiles = new Map(truckProfileList.map((p) => [p.truck.truckId, p]));
  const trailerProfiles = new Map(trailerProfileList.map((p) => [p.trailer.trailerId, p]));

  // The pairing is read off the attachment records of the trailers this viewer
  // may see. A trailer on one of your trucks that you have no relationship with
  // is deliberately absent: you are not entitled to it just because it is hooked
  // to your power unit.
  const trailerByTruck = new Map<string, { trailerId: string; unit: string; since: string }>();
  trailerProfileList.forEach((p, i) => {
    const a = p.currentAttachment;
    if (!a) return;
    trailerByTruck.set(a.truckId, {
      trailerId: p.trailer.trailerId,
      unit: trailerStubs[i].unit,
      since: a.attachedAt ?? a.reservedAt ?? a.createdAt,
    });
  });

  const rows: FleetEquipmentRow[] = [];
  for (let i = 0; i < truckProfileList.length; i += 1) {
    rows.push(await truckRow(ctx, {
      profile: truckProfileList[i],
      unit: truckStubs[i].unit,
      attachedTrailer: trailerByTruck.get(truckProfileList[i].truck.truckId),
      nowMs,
    }));
  }
  trailerProfileList.forEach((profile, i) => {
    rows.push(trailerRow(ctx, {
      profile,
      unit: trailerStubs[i].unit,
      pairedTruckUnit: profile.currentAttachment
        ? truckUnits.get(profile.currentAttachment.truckId)
        : undefined,
      nowMs,
    }));
  });

  return { rows, truckProfiles, trailerProfiles, truckUnits };
}

/* -------------------------------------------------------------------------- */
/* Assignments                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The assignment history for one truck, from the records that ARE the history.
 *
 * A driver row is a TruckDriverAssignment and a trailer row is a
 * TrailerAttachment. Neither is copied into a store of this layer's own, so
 * "the history is immutable" is not a promise this file has to keep — it is a
 * property of the records it reads. Ending an assignment stamps `endedAt` on
 * the existing row and opens a new one; nothing is deleted, and the ended rows
 * come back here exactly as they were written.
 */
function assignmentsForTruck(
  truckId: string,
  truckUnit: string,
  profile: TruckProfileView | undefined,
  attachments: Array<{ attachment: TrailerAttachment; trailerUnit: string }>,
  organizationId: string,
): FleetAssignmentRecord[] {
  const rows: FleetAssignmentRecord[] = [];

  for (const a of profile?.assignments ?? []) {
    rows.push({
      id: `fa_drv_${a.id}`,
      kind: "driver_truck",
      organizationId: a.organizationId,
      truckId,
      truckUnit,
      driverProfileId: a.driverProfileId,
      driverName: a.driverName,
      effectiveFrom: a.startedAt,
      effectiveTo: a.endedAt,
      endReason: a.endReason,
      source: "truck_driver_assignment",
      sourceId: a.id,
    });
  }

  for (const { attachment, trailerUnit } of attachments) {
    if (attachment.truckId !== truckId) continue;
    rows.push({
      id: `fa_trl_${attachment.id}`,
      kind: "trailer_truck",
      organizationId: attachment.organizationId,
      truckId,
      truckUnit,
      trailerId: attachment.trailerId,
      trailerUnit,
      effectiveFrom: attachment.attachedAt ?? attachment.reservedAt ?? attachment.createdAt,
      effectiveTo: attachment.detachedAt,
      endReason: attachment.detachReason ?? attachment.blockedReason,
      source: "trailer_attachment",
      sourceId: attachment.id,
    });
  }

  return rows
    .filter((r) => r.organizationId === organizationId)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
}

/** Attachment rows from every trailer the viewer may see, with its own unit. */
function visibleAttachments(loaded: LoadedFleet): Array<{ attachment: TrailerAttachment; trailerUnit: string }> {
  const out: Array<{ attachment: TrailerAttachment; trailerUnit: string }> = [];
  for (const row of loaded.rows) {
    if (row.assetKind !== "trailer") continue;
    const profile = loaded.trailerProfiles.get(row.assetId);
    if (!profile) continue;
    for (const attachment of profile.attachments) {
      out.push({ attachment, trailerUnit: row.unit });
    }
  }
  return out;
}

/**
 * The live Driver–Truck–Trailer triads.
 *
 * One per power unit that has at least one live leg. A truck with a driver and
 * no trailer, or a trailer and no driver, is a real and common arrangement and
 * is reported as such rather than being suppressed for being incomplete — the
 * incomplete ones are usually the interesting ones.
 */
function buildTriads(loaded: LoadedFleet, organizationId: string): FleetAssignmentTriad[] {
  const attachments = visibleAttachments(loaded);
  const triads: FleetAssignmentTriad[] = [];

  for (const row of loaded.rows) {
    if (row.assetKind !== "truck") continue;
    const history = assignmentsForTruck(
      row.assetId, row.unit, loaded.truckProfiles.get(row.assetId), attachments, organizationId,
    );
    const driver = history.find((r) => r.kind === "driver_truck" && !r.effectiveTo);
    const trailer = history.find((r) => r.kind === "trailer_truck" && !r.effectiveTo);
    if (!driver && !trailer) continue;
    const dates = [driver?.effectiveFrom, trailer?.effectiveFrom].filter(Boolean) as string[];
    triads.push({
      truckId: row.assetId,
      truckUnit: row.unit,
      driver,
      trailer,
      effectiveFrom: dates.sort()[dates.length - 1],
    });
  }

  return triads.sort((a, b) => a.truckUnit.localeCompare(b.truckUnit, undefined, { numeric: true }));
}

/* -------------------------------------------------------------------------- */
/* Utilization                                                                 */
/* -------------------------------------------------------------------------- */

function utilizationFor(
  row: FleetEquipmentRow,
  loaded: LoadedFleet,
  organizationId: string,
  nowMs: number,
): FleetUtilizationSummary {
  const down = row.derivation.status === "maintenance" || row.derivation.status === "out_of_service";
  if (row.assetKind === "truck") {
    const p = loaded.truckProfiles.get(row.assetId);
    return deriveUtilization({
      leaseIntervals: ownLeaseIntervals(p?.leases ?? [], organizationId),
      currentlyDown: down,
      downSince: down ? downSince(p?.events ?? []) : undefined,
      recordsBeginAt: p?.myRelationship?.startedAt,
    }, UTILIZATION_WINDOW_DAYS, nowMs);
  }
  const p = loaded.trailerProfiles.get(row.assetId);
  return deriveUtilization({
    leaseIntervals: ownLeaseIntervals(p?.leases ?? [], organizationId),
    currentlyDown: down,
    downSince: down ? downSince(p?.events ?? []) : undefined,
    recordsBeginAt: p?.myRelationship?.startedAt,
  }, UTILIZATION_WINDOW_DAYS, nowMs);
}

/* -------------------------------------------------------------------------- */
/* Summaries and filtering                                                     */
/* -------------------------------------------------------------------------- */

const EMPTY_COUNTS = (): FleetStatusCounts => ({
  available: 0, assigned: 0, expected_available: 0,
  in_transit: 0, maintenance: 0, out_of_service: 0,
});

function summarize(rows: FleetEquipmentRow[]): FleetFleetSummary {
  const counts = EMPTY_COUNTS();
  for (const r of rows) counts[r.derivation.status] += 1;
  return {
    total: rows.length,
    counts,
    lockedByOtherAuthority: rows.filter((r) => r.authority.lockedByOtherAuthority).length,
    staleTelemetry: rows.filter((r) => r.telemetry.stale).length,
    readinessBlocking: rows.filter((r) => r.readiness.blocking > 0).length,
  };
}

function applyFilters(rows: FleetEquipmentRow[], f: FleetEquipmentFilters): FleetEquipmentRow[] {
  const q = f.search?.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.assetKind && r.assetKind !== f.assetKind) return false;
    if (f.status?.length && !f.status.includes(r.derivation.status)) return false;
    if (f.availableOnly && !r.authority.availableToOrganization) return false;
    if (f.staleOnly && !r.telemetry.stale) return false;
    if (!q) return true;
    const hay = [
      r.unit, r.driver?.driverName, r.pairedTrailer?.unit, r.pairedTruck?.unit,
      r.telemetry.reading?.location?.city, r.telemetry.reading?.location?.state,
      r.carrierName,
    ].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  });
}

function sortRows(rows: FleetEquipmentRow[]): FleetEquipmentRow[] {
  // Blocked equipment first, then stale, then by unit. The things somebody has
  // to do something about should not be below the things that are fine.
  const weight = (r: FleetEquipmentRow) =>
    (r.readiness.blocking > 0 ? 0 : 100)
    + (r.authority.availableToOrganization ? 20 : 0)
    + (r.telemetry.stale ? 0 : 10);
  return [...rows].sort(
    (a, b) => weight(a) - weight(b)
      || a.assetKind.localeCompare(b.assetKind)
      || a.unit.localeCompare(b.unit, undefined, { numeric: true }),
  );
}

/* -------------------------------------------------------------------------- */
/* The service                                                                 */
/* -------------------------------------------------------------------------- */

export const mockFleetService: FleetService = {
  async dashboard(ctx) {
    await wait();
    require(ctx, "fleet:view");
    const nowMs = Date.now();
    const loaded = await loadFleet(ctx, nowMs);

    const trucks = loaded.rows.filter((r) => r.assetKind === "truck");
    const trailers = loaded.rows.filter((r) => r.assetKind === "trailer");
    const utilizations = loaded.rows.map(
      (r) => utilizationFor(r, loaded, ctx.organizationId, nowMs),
    );

    return {
      organizationId: ctx.organizationId,
      generatedAt: new Date(nowMs).toISOString(),
      trucks: summarize(trucks),
      trailers: summarize(trailers),
      utilization: aggregateUtilization(utilizations, UTILIZATION_WINDOW_DAYS, nowMs),
      triads: buildTriads(loaded, ctx.organizationId),
      integrations: [...FLEET_INTEGRATIONS],
      // A dispatch organization holds no carrier relationship of its own on
      // this equipment: everything it can see arrived through a grant.
      viewerIsDispatchOrganization: loaded.rows.length > 0
        && loaded.rows.every((r) => r.authority.activationState === "ended"),
    };
  },

  async equipment(ctx, filters = {}) {
    await wait();
    require(ctx, "fleet:view");
    const loaded = await loadFleet(ctx, Date.now());
    return sortRows(applyFilters(loaded.rows, filters));
  },

  async asset(ctx, assetKind, assetId): Promise<FleetAssetDetail> {
    await wait();
    require(ctx, "fleet:view");
    const nowMs = Date.now();
    const loaded = await loadFleet(ctx, nowMs);
    const row = loaded.rows.find((r) => r.assetKind === assetKind && r.assetId === assetId);
    // Unknown and forbidden are deliberately the same answer, exactly as they
    // are in the registries this reads from.
    if (!row) throw new Error("Equipment not found");

    const attachments = visibleAttachments(loaded);
    const assignmentHistory = assetKind === "truck"
      ? assignmentsForTruck(
        assetId, row.unit, loaded.truckProfiles.get(assetId), attachments, ctx.organizationId,
      )
      : attachments
        .filter((a) => a.attachment.trailerId === assetId
          && a.attachment.organizationId === ctx.organizationId)
        .map(({ attachment, trailerUnit }) => ({
          id: `fa_trl_${attachment.id}`,
          kind: "trailer_truck" as const,
          organizationId: attachment.organizationId,
          truckId: attachment.truckId,
          truckUnit: loaded.truckUnits.get(attachment.truckId) ?? attachment.truckUnitLabel,
          trailerId: attachment.trailerId,
          trailerUnit,
          effectiveFrom: attachment.attachedAt ?? attachment.reservedAt ?? attachment.createdAt,
          effectiveTo: attachment.detachedAt,
          endReason: attachment.detachReason ?? attachment.blockedReason,
          source: "trailer_attachment" as const,
          sourceId: attachment.id,
        }))
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));

    return {
      row,
      utilization: utilizationFor(row, loaded, ctx.organizationId, nowMs),
      telemetryHistory: readingHistory(assetId, ctx.organizationId),
      assignmentHistory,
    };
  },

  async assignmentHistory(ctx, assetKind, assetId) {
    const detail = await this.asset(ctx, assetKind, assetId);
    return detail.assignmentHistory;
  },

  async recordTelemetry(ctx, input: RecordTelemetryInput): Promise<FleetTelemetryReading> {
    await wait();
    require(ctx, "fleet:view", "fleet:telemetry:record");
    // The asset must be one this organization can actually see. Going through
    // the loaded fleet means the answer comes from the registries' access rules
    // rather than from a second opinion held here.
    const loaded = await loadFleet(ctx, Date.now());
    const row = loaded.rows.find(
      (r) => r.assetKind === input.assetKind && r.assetId === input.assetId,
    );
    if (!row) throw new Error("Equipment not found");
    const reading = appendReading(input, {
      organizationId: ctx.organizationId,
      membershipId: ctx.membershipId,
      actorName: ctx.actor.displayNameSnapshot,
    });

    /*
     * The meters go to the canonical Equipment Meter Ledger, which is where
     * maintenance, fuel and every other reader gets the accepted odometer from.
     * The row above stays as this store's record of what was submitted; it is
     * not a second canonical value.
     */
    const contribution = meterContributionFor(reading);
    if (contribution) {
      await contributeAndPublish({ ...contribution, actor: ctx.actor });
    }
    return reading;
  },

  async integrations(ctx) {
    require(ctx, "fleet:view");
    return [...FLEET_INTEGRATIONS];
  },

  async needsYou(ctx) {
    require(ctx, "fleet:view");
    const loaded = await loadFleet(ctx, Date.now());
    return fleetNeedsYouItems(
      loaded.rows, buildTriads(loaded, ctx.organizationId), ctx.organizationId,
    );
  },
};

/** Read-only helper for the Needs You adapter, which needs rows without a UI. */
export async function fleetRowsFor(ctx: ServiceContext): Promise<{
  rows: FleetEquipmentRow[];
  triads: FleetAssignmentTriad[];
}> {
  if (!ctx.permissions.has("fleet:view")) return { rows: [], triads: [] };
  const loaded = await loadFleet(ctx, Date.now());
  return { rows: loaded.rows, triads: buildTriads(loaded, ctx.organizationId) };
}
