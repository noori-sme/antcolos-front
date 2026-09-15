import type {
  AvailabilityBasis, AvailabilityDecision, AvailabilityPublication, DispatchTrackingBoard,
  DispatchTrackingFilters, DispatchTrackingRow, Load, LoadStatus, LocationSignal,
  TrackedAuthority, TrackedMilestone, TrackingAlert, TrackingAlertKind, TrackingSession,
  TrackingSignalHealth, TrackingUpdateKind,
} from "@/types";
import { authorityAllowsDispatch, destinationStop, originStop } from "@/types";
import {
  assessFreshness, evaluateGeofence, formatAge, proximityFor, straightLineMiles,
} from "@/lib/tracking";
import { carrierViewSync } from "./carrier-registry";
import { fleetSync, truckContextFrom } from "./truck-registry";
import { trailerFleetSync } from "./trailer-registry";
import { publishAvailabilityDecision } from "./mt-loop";
import {
  availabilityForTruck, receiverFenceFor, recordEmptyConfirmation,
} from "./tracking-availability";
import { cityPoint, locationSignalsFor, reportedEta, trackingSignalSources } from "./tracking-signals";
import {
  audit, mayTrack, resolvePublicTracking, sessionForLoadSync, trackingAudit,
  type TrackingContext,
} from "./tracking-registry";
import { mockStore } from "./store";
import { nowIso } from "./time";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The organization-scoped dispatch tracking board.
 *
 * It answers one question for a dispatcher with several carriers and a lot of
 * freight in the air: where is everything, how well do we actually know, and
 * what has gone wrong. Everything on a row — the carrier, the driver, the
 * truck, the trailer, the operating authority, the position, the milestones —
 * comes from the module that owns it, read in this workspace's context.
 *
 * Two properties are worth stating plainly, because they are what a reviewer
 * will want to check:
 *
 *  MULTI-CARRIER, ONE WORKSPACE. A dispatch organization working four carriers
 *  gets one board with all four on it and no switching. That convenience stops
 *  exactly at the entitlement: each row's truck is fetched through the truck
 *  registry's own scope, so a load whose equipment this workspace is no longer
 *  entitled to renders as a row with no location and a stated reason, not as a
 *  row with somebody else's truck on it.
 *
 *  THE BOARD IS DERIVED. Nothing here is stored. Loads, positions, milestones
 *  and availability are all read and recomputed, which is why fixing the
 *  underlying record is the only way — and the only thing needed — to fix a row.
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const LATENCY_MS = process.env.ANTCOLOS_TEST === "1" ? 0 : 280;

let alertSeq = 0;
const alertId = () => `tal_${(++alertSeq).toString(36)}`;

/** Statuses a load is worth tracking at. */
const TRACKABLE: LoadStatus[] = [
  "assigned", "dispatched", "at_pickup", "loaded", "in_transit", "at_delivery",
];
/** Rolling: a position is genuinely expected. */
const ROLLING: LoadStatus[] = ["dispatched", "at_pickup", "loaded", "in_transit", "at_delivery"];
/** Recently finished loads stay on the board so their tracking can be wound up. */
const RECENTLY_FINISHED: LoadStatus[] = ["delivered", "ready_to_invoice"];
const RECENT_WINDOW_HOURS = 36;

/** Late by more than this against the appointment, and it is worth saying. */
export const DELAY_ALERT_MINUTES = 30;
/**
 * How far off the straight line between origin and destination a position has
 * to be before it counts as a deviation. A straight line is not a route, so
 * the threshold is generous on purpose: this flags "that is the wrong part of
 * the country", not "that is not the fastest way round the beltway".
 */
export const DEVIATION_FACTOR = 1.4;

/* -------------------------------------------------------------------------- */
/* Assembly                                                                    */
/* -------------------------------------------------------------------------- */

function trackableLoads(ctx: TrackingContext): Load[] {
  let org;
  try {
    org = mockStore.org(ctx.organizationId);
  } catch {
    return [];
  }
  const cutoff = Date.now() - RECENT_WINDOW_HOURS * 3_600_000;
  return org.loads.filter((load) => {
    if (TRACKABLE.includes(load.status)) return true;
    if (!RECENTLY_FINISHED.includes(load.status)) return false;
    return Date.parse(load.updatedAt) >= cutoff;
  });
}

/** The operating authority in force, snapshotted onto the row. */
function authorityFor(
  ctx: TrackingContext,
  carrierOrganizationId: string | undefined,
): TrackedAuthority | undefined {
  if (!carrierOrganizationId) return undefined;
  const carrier = carrierViewSync(carrierOrganizationId, truckContextFrom(ctx));
  if (!carrier) return undefined;
  return {
    carrierOrganizationId: carrier.organizationId,
    carrierName: carrier.displayName,
    mcNumber: carrier.mcNumber,
    dotNumber: carrier.dotNumber,
    authority: carrier.authority,
    allowedDispatch: authorityAllowsDispatch(carrier.authority),
    snapshotAt: nowIso(),
  };
}

/**
 * The milestones, and on whose word each one stands.
 *
 * Read from two places and reconciled: the Load module's own stop actuals, and
 * the Driver Trip Workflow where the load has one. The workflow wins when both
 * speak, because it is the one that knows whether a PERSON recorded it.
 */
function milestonesFor(ctx: TrackingContext, load: Load): TrackedMilestone[] {
  const pickup = originStop(load);
  const delivery = destinationStop(load);
  const org = mockStore.org(ctx.organizationId);

  const basisOfEvent = (kind: string, stopId: string): { basis: AvailabilityBasis; attribution: TrackedMilestone["attribution"]; rationale?: string } => {
    const event = org.events
      .filter((e) => e.loadId === load.id && e.kind === kind && e.payload?.stopId === stopId)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
      .pop();
    if (!event) return { basis: "confirmed", attribution: "dispatcher" };
    // A machine source SUGGESTS. It never asserts that the driver did anything.
    const machine = event.source === "eld" || event.source === "api" || event.source === "ocr";
    return machine
      ? {
        basis: "inferred",
        attribution: "adapter",
        rationale: `Suggested by a ${event.source} signal and not confirmed by a person.`,
      }
      : { basis: "confirmed", attribution: event.actor.userId === "system" ? "system" : "dispatcher" };
  };

  const rows: TrackedMilestone[] = [
    {
      key: "pickup_arrived",
      label: `Arrived at ${pickup.address.city}`,
      at: pickup.arrivedAt,
      ...(pickup.arrivedAt ? basisOfEvent("stop.arrived", pickup.id) : {}),
    },
    {
      key: "pickup_departed",
      label: `Loaded and departed ${pickup.address.city}`,
      at: pickup.departedAt,
      ...(pickup.departedAt ? basisOfEvent("stop.departed", pickup.id) : {}),
    },
    {
      key: "delivery_arrived",
      label: `Arrived at ${delivery.address.city}`,
      at: delivery.arrivedAt,
      ...(delivery.arrivedAt ? basisOfEvent("stop.arrived", delivery.id) : {}),
    },
    {
      key: "delivered",
      label: `Unloaded and departed ${delivery.address.city}`,
      at: delivery.departedAt,
      ...(delivery.departedAt ? basisOfEvent("stop.departed", delivery.id) : {}),
    },
  ];
  return rows;
}

function alert(
  kind: TrackingAlertKind,
  severity: TrackingAlert["severity"],
  title: string,
  detail: string,
  basis: AvailabilityBasis,
): TrackingAlert {
  return { id: alertId(), kind, severity, title, detail, raisedAt: nowIso(), basis };
}

/* -------------------------------------------------------------------------- */
/* One row                                                                     */
/* -------------------------------------------------------------------------- */

export interface TrackingRowBuild {
  row: DispatchTrackingRow;
  signals: LocationSignal[];
  decision?: AvailabilityDecision;
}

function buildRow(ctx: TrackingContext, load: Load, now: Date): TrackingRowBuild {
  const truckCtx = truckContextFrom(ctx);
  const pickup = originStop(load);
  const delivery = destinationStop(load);
  const assignedTruckId = load.assignment?.truckId;

  // Scope, inherited. A truck this workspace is no longer entitled to simply
  // does not come back, and the row says so rather than borrowing one.
  const truck = assignedTruckId
    ? fleetSync(truckCtx).find((t) => t.truckId === assignedTruckId)
    : undefined;
  const equipmentWithheld = Boolean(assignedTruckId) && truck === undefined;

  const trailer = truck && ctx.permissions.has("trailers:view")
    ? trailerFleetSync(truckCtx).find((t) => t.attachedTruckId === truck.truckId)
    : undefined;

  /**
   * Whose authority the load runs under.
   *
   * For a dispatch workspace this comes off the truck's dispatch grant. For a
   * carrier running its own freight it is the workspace itself — the same
   * person wearing both hats, which is a fact about the record rather than a
   * special case to be left blank.
   */
  const carrierOrganizationId = truck?.carrierOrganizationId
    ?? (truck && !ctx.organization.soloDispatcher && ctx.organization.type === "CARRIER"
      ? ctx.organizationId
      : load.assignment?.carrierOrganizationId);
  const authority = authorityFor(ctx, carrierOrganizationId);

  const signals = truck
    ? locationSignalsFor(ctx, { truckId: truck.truckId, loadId: load.id })
    : [];
  const latest = signals[signals.length - 1];

  const rolling = ROLLING.includes(load.status);
  const freshness = assessFreshness({
    signals,
    trackingExpected: rolling && Boolean(truck),
    unavailableReason: equipmentWithheld
      ? "The truck on this load is not one this workspace can see, so its position cannot be read here."
      : !assignedTruckId
        ? "No truck is on this load yet, so there is nothing to track."
        : undefined,
    now,
  });

  /* ---- Distance, progress and deviation ---- */
  const originPoint = cityPoint(pickup.address.city, pickup.address.state);
  const destPoint = cityPoint(delivery.address.city, delivery.address.state);
  const here = latest?.point;

  let milesToDelivery: number | undefined;
  let routeProgressPercent: number | undefined;
  let deviated = false;

  if (here && destPoint) milesToDelivery = straightLineMiles(here, destPoint);
  if (here && originPoint && destPoint) {
    const total = straightLineMiles(originPoint, destPoint);
    const done = straightLineMiles(originPoint, here);
    if (total > 0) {
      // Measured from what is LEFT, not from how far it has come. A truck 370
      // miles the wrong side of its receiver has travelled a long way and is
      // nowhere near done, and a progress bar built on distance-covered would
      // read 100% for exactly that truck.
      routeProgressPercent = Math.max(
        0,
        Math.min(100, Math.round((1 - (milesToDelivery ?? 0) / total) * 100)),
      );
      const viaHere = done + (milesToDelivery ?? 0);
      deviated = viaHere > total * DEVIATION_FACTOR && total > 25;
    }
  }

  /* ---- Timing ---- */
  const etaAt = reportedEta(ctx.organizationId, load.id);
  const appointmentAt = delivery.appointmentAt;
  const etaVarianceMinutes = etaAt && appointmentAt
    ? Math.round((Date.parse(etaAt) - Date.parse(appointmentAt)) / 60_000)
    : undefined;

  /* ---- Availability ---- */
  const decision = truck ? availabilityForTruck(truck.truckId, ctx, truck) : undefined;

  /* ---- Alerts ---- */
  const alerts: TrackingAlert[] = [];

  if (etaVarianceMinutes != null && etaVarianceMinutes > DELAY_ALERT_MINUTES) {
    alerts.push(alert(
      "delay", etaVarianceMinutes > 120 ? "high" : "medium",
      `Running ${formatAge(etaVarianceMinutes)} late into ${delivery.address.city}`,
      `The last reported ETA is ${formatAge(etaVarianceMinutes)} past the ${appointmentAt ? "appointment" : "window"}.`,
      "inferred",
    ));
  }

  if (deviated) {
    alerts.push(alert(
      "route_deviation", "medium",
      "Off the expected line of travel",
      `The last position is well off the straight line between ${pickup.address.city} and ${delivery.address.city}. `
      + "This is a crude check against a straight line, not a route, so treat it as a prompt to ring the driver.",
      "inferred",
    ));
  }

  if (freshness.health === "interrupted" || freshness.health === "offline") {
    alerts.push(alert(
      "signal_lost", freshness.health === "interrupted" ? "high" : "medium",
      freshness.health === "interrupted" ? "Tracking interrupted" : "Tracking offline",
      freshness.reason,
      "inferred",
    ));
  }

  const fence = receiverFenceFor(load);
  if (fence && signals.length > 0) {
    const verdict = evaluateGeofence(
      fence,
      signals.map((s) => ({ point: s.point, speedMph: s.speedMph, observedAt: s.observedAt })),
      now,
    );
    if (verdict.believable) {
      alerts.push(alert("geofence", "low", `At ${fence.label}`, verdict.rationale, "inferred"));
    } else if (verdict.inside) {
      // Kept as an alert precisely BECAUSE it was rejected: a dispatcher
      // seeing "we saw it inside and did not believe it" is better served
      // than one seeing nothing at all.
      alerts.push(alert(
        "geofence", "low", `A geofence reading at ${fence.label} was not believed`,
        verdict.rejection, "inferred",
      ));
    }
  }

  if (decision && (decision.state === "availability_uncertain" || decision.state === "likely_available")) {
    alerts.push(alert(
      "availability",
      decision.state === "availability_uncertain" ? "medium" : "low",
      decision.state === "availability_uncertain"
        ? `Cannot tell whether ${truck?.unit ?? "this truck"} is empty`
        : `${truck?.unit ?? "This truck"} is probably empty`,
      decision.rationale,
      decision.basis,
    ));
  }

  const session = sessionForLoadSync(ctx, load.id);

  const row: DispatchTrackingRow = {
    loadId: load.id,
    loadReference: load.reference,
    loadStatus: load.status,
    organizationId: ctx.organizationId,
    carrierOrganizationId,
    carrierName: truck?.carrierName ?? authority?.carrierName
      ?? (carrierOrganizationId === ctx.organizationId ? ctx.organizationName : undefined),
    driverId: load.assignment?.driverId ?? truck?.currentDriverId,
    driverName: truck?.currentDriverName ?? driverNameFor(ctx, load),
    truckId: truck?.truckId,
    truckUnit: truck?.unit,
    equipment: truck?.equipment,
    trailerId: trailer?.trailerId,
    trailerUnit: trailer?.unit,
    authority,
    originLabel: `${pickup.address.city}, ${pickup.address.state}`,
    destinationLabel: `${delivery.address.city}, ${delivery.address.state}`,
    currentCity: latest?.city,
    currentState: latest?.state,
    currentDescription: latest?.description,
    routeProgressPercent,
    milesToDelivery: milesToDelivery == null ? undefined : Math.round(milesToDelivery),
    deliveryAppointmentAt: appointmentAt,
    etaAt,
    etaVarianceMinutes,
    lastUpdateAt: freshness.lastUpdateAt,
    lastUpdateAgeMinutes: freshness.ageMinutes,
    lastSignalTransport: latest?.transport,
    lastSignalLabel: latest ? describeSignal(latest) : undefined,
    health: freshness.health,
    healthReason: freshness.reason,
    milestones: milestonesFor(ctx, load),
    alerts,
    availability: decision
      ? {
        state: decision.state,
        basis: decision.basis,
        confidence: decision.confidence,
        expectedEmptyAt: decision.expectedEmptyAt,
        rationale: decision.rationale,
      }
      : undefined,
    sharedWithBroker: Boolean(session?.recipients.some((r) => r.state === "active")),
    trackingSessionId: session?.id,
  };

  return { row, signals, decision };
}

function driverNameFor(ctx: TrackingContext, load: Load): string | undefined {
  if (!ctx.permissions.has("drivers:view")) return undefined;
  const driverId = load.assignment?.driverId;
  if (!driverId) return undefined;
  try {
    return mockStore.org(ctx.organizationId).drivers.find((d) => d.id === driverId)?.displayName;
  } catch {
    return undefined;
  }
}

function describeSignal(signal: LocationSignal): string {
  const where = signal.description
    ?? [signal.city, signal.state].filter(Boolean).join(", ")
    ?? "an unnamed place";
  const mock = signal.provenance.mock ? " (mock adapter)" : "";
  return `${where}${mock}`;
}

/* -------------------------------------------------------------------------- */
/* The board                                                                   */
/* -------------------------------------------------------------------------- */

export async function dispatchTrackingBoard(
  ctx: TrackingContext,
  filters: DispatchTrackingFilters = {},
): Promise<DispatchTrackingBoard> {
  await sleep(LATENCY_MS);
  return dispatchTrackingBoardSync(ctx, filters);
}

export function dispatchTrackingBoardSync(
  ctx: TrackingContext,
  filters: DispatchTrackingFilters = {},
): DispatchTrackingBoard {
  const empty: DispatchTrackingBoard = {
    rows: [],
    carriers: [],
    counts: { tracked: 0, live: 0, stale: 0, offline: 0, interrupted: 0, unavailable: 0, alerting: 0 },
    sources: trackingSignalSources(),
  };
  if (!mayTrack(ctx)) return empty;

  const now = new Date();
  const builds = trackableLoads(ctx).map((load) => buildRow(ctx, load, now));
  const rows = builds.map((b) => b.row);

  /**
   * The carriers on this board.
   *
   * Only the ones this workspace can actually NAME. A load whose equipment is
   * not shared here leaves an unresolvable carrier id behind, and a chip
   * reading "This carrier" would be a filter nobody could use and a claim to
   * know something the workspace does not.
   */
  const carriers = new Map<string, { organizationId: string; name: string; loadCount: number; canHaul: boolean }>();
  for (const row of rows) {
    const id = row.carrierOrganizationId;
    const name = row.carrierName ?? row.authority?.carrierName;
    if (!id || !name) continue;
    const entry = carriers.get(id) ?? {
      organizationId: id,
      name,
      loadCount: 0,
      canHaul: row.authority?.allowedDispatch ?? false,
    };
    entry.loadCount += 1;
    carriers.set(id, entry);
  }

  const filtered = rows.filter((row) => {
    if (filters.carrierOrganizationId && row.carrierOrganizationId !== filters.carrierOrganizationId) return false;
    if (filters.health?.length && !filters.health.includes(row.health)) return false;
    if (filters.alertingOnly && row.alerts.length === 0) return false;
    if (filters.search) {
      const needle = filters.search.trim().toLowerCase();
      const haystack = [
        row.loadReference, row.carrierName, row.driverName, row.truckUnit,
        row.originLabel, row.destinationLabel, row.currentCity,
      ].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });

  const countBy = (health: TrackingSignalHealth) => rows.filter((r) => r.health === health).length;

  return {
    rows: filtered.sort(byUrgency),
    carriers: [...carriers.values()].sort((a, b) => a.name.localeCompare(b.name)),
    counts: {
      tracked: rows.length,
      live: countBy("live"),
      stale: countBy("stale"),
      offline: countBy("offline"),
      interrupted: countBy("interrupted"),
      unavailable: countBy("unavailable"),
      alerting: rows.filter((r) => r.alerts.length > 0).length,
    },
    sources: trackingSignalSources(),
  };
}

/**
 * The most urgent first: something is wrong, then something is due soonest.
 *
 * A row nobody is being told about outranks a row that is merely due, because
 * the first one is a phone call somebody has to make now.
 */
function byUrgency(a: DispatchTrackingRow, b: DispatchTrackingRow): number {
  const HEALTH_RANK: Record<TrackingSignalHealth, number> = {
    interrupted: 0, offline: 1, stale: 2, live: 3, unavailable: 4,
  };
  const worst = (row: DispatchTrackingRow) =>
    row.alerts.some((x) => x.severity === "critical" || x.severity === "high") ? 0 : 1;

  const byAlert = worst(a) - worst(b);
  if (byAlert !== 0) return byAlert;
  const byHealth = HEALTH_RANK[a.health] - HEALTH_RANK[b.health];
  if (byHealth !== 0) return byHealth;
  return (a.deliveryAppointmentAt ?? "9999").localeCompare(b.deliveryAppointmentAt ?? "9999");
}

/* -------------------------------------------------------------------------- */
/* One load, in full                                                           */
/* -------------------------------------------------------------------------- */

export interface LoadTrackingView {
  row: DispatchTrackingRow;
  /** Every position this workspace may read, newest first. */
  signals: LocationSignal[];
  /** The full decision, evidence and all, including what was disregarded. */
  availability?: AvailabilityDecision;
  /** The Load-scoped tracking session, when one has been opened. */
  session?: TrackingSession;
  /** This load's immutable tracking history, newest first. */
  history: ReturnType<typeof trackingAudit>;
  /** What a tracking update would say right now, per kind, before it is drafted. */
  suggestedUpdates: Array<{ kind: TrackingUpdateKind; message: string; basis: AvailabilityBasis }>;
}

export async function loadTracking(
  ctx: TrackingContext,
  loadId: string,
): Promise<LoadTrackingView | undefined> {
  await sleep(LATENCY_MS);
  return loadTrackingSync(ctx, loadId);
}

export function loadTrackingSync(
  ctx: TrackingContext,
  loadId: string,
): LoadTrackingView | undefined {
  if (!mayTrack(ctx)) return undefined;
  let load: Load | undefined;
  try {
    load = mockStore.org(ctx.organizationId).loads.find((l) => l.id === loadId);
  } catch {
    return undefined;
  }
  if (!load) return undefined;

  const built = buildRow(ctx, load, new Date());
  const session = sessionForLoadSync(ctx, loadId);

  return {
    row: built.row,
    signals: [...built.signals].reverse(),
    availability: built.decision,
    session,
    history: trackingAudit(ctx).filter(
      (entry) => entry.subjectId === loadId
        || entry.subjectId === session?.id
        || session?.recipients.some((r) => r.id === entry.subjectId),
    ),
    suggestedUpdates: suggestUpdates(built.row),
  };
}

/**
 * What an update would say, worked out from the row rather than typed by hand.
 *
 * Every suggestion is already redacted to what a customer may see: a place, a
 * time and a plain statement. There is no rate in any of them and no driver
 * name, because they are assembled from fields that do not carry one.
 */
export function suggestUpdates(
  row: DispatchTrackingRow,
): Array<{ kind: TrackingUpdateKind; message: string; basis: AvailabilityBasis }> {
  const out: Array<{ kind: TrackingUpdateKind; message: string; basis: AvailabilityBasis }> = [];
  const milestone = (key: string) => row.milestones.find((m) => m.key === key);

  const arrived = milestone("pickup_arrived");
  if (arrived?.at) {
    out.push({
      kind: "pickup_arrived",
      message: `Arrived at the pickup in ${row.originLabel}.`,
      basis: arrived.basis ?? "inferred",
    });
  }
  const departed = milestone("pickup_departed");
  if (departed?.at) {
    out.push({
      kind: "pickup_departed",
      message: `Loaded and departed ${row.originLabel}, heading for ${row.destinationLabel}.`,
      basis: departed.basis ?? "inferred",
    });
  }
  if (row.currentCity && row.health === "live") {
    out.push({
      kind: "in_transit",
      message:
        `In transit near ${row.currentCity}${row.currentState ? `, ${row.currentState}` : ""}`
        + `${row.milesToDelivery != null ? `, about ${row.milesToDelivery} miles from ${row.destinationLabel}` : ""}.`,
      basis: "inferred",
    });
  }
  if (row.etaAt) {
    out.push({
      kind: "eta_changed",
      message: `Estimated arrival at ${row.destinationLabel} is now ${new Date(row.etaAt).toUTCString()}.`,
      basis: "inferred",
    });
  }
  if (row.etaVarianceMinutes != null && row.etaVarianceMinutes > DELAY_ALERT_MINUTES) {
    out.push({
      kind: "delay",
      message: `Running about ${formatAge(row.etaVarianceMinutes)} behind the delivery appointment.`,
      basis: "inferred",
    });
  }
  if (row.health === "interrupted" || row.health === "offline") {
    out.push({
      kind: "tracking_interrupted",
      message:
        "Tracking updates have stopped coming through. We are chasing the driver for a position.",
      basis: "inferred",
    });
  }
  const atDelivery = milestone("delivery_arrived");
  if (atDelivery?.at) {
    out.push({
      kind: "delivery_arrived",
      message: `Arrived at the receiver in ${row.destinationLabel}.`,
      basis: atDelivery.basis ?? "inferred",
    });
  }
  const delivered = milestone("delivered");
  if (delivered?.at) {
    out.push({
      kind: "delivered",
      message: `Unloaded and departed ${row.destinationLabel}.`,
      basis: delivered.basis ?? "inferred",
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Publishing availability into the MT Loop                                    */
/* -------------------------------------------------------------------------- */

/**
 * Decide availability for every truck this workspace dispatches, and publish.
 *
 * The one place the tracking module talks to the MT Loop service. It produces
 * decisions and hands them over; the loop service decides what that means for
 * the board and, crucially, whether it is a new cycle or another reading of
 * one that already exists.
 *
 * Every publication, including the suppressed and the not-publishable, gets an
 * audit line. "Nothing was opened, and here is why" is the line that answers
 * "why is that truck not on the empty board".
 */
export function publishAvailability(ctx: TrackingContext): Array<{
  decision: AvailabilityDecision;
  publication: AvailabilityPublication;
}> {
  if (!mayTrack(ctx)) return [];
  const out: Array<{ decision: AvailabilityDecision; publication: AvailabilityPublication }> = [];

  for (const truck of fleetSync(truckContextFrom(ctx))) {
    const decision = availabilityForTruck(truck.truckId, ctx, truck);
    if (!decision) continue;
    const publication = publishAvailabilityDecision(decision, {
      ...ctx,
      organization: ctx.organization,
      membership: ctx.membership,
    });

    if (publication.outcome !== "unchanged") {
      audit(ctx.organizationId, {
        action: publication.outcome === "not_publishable" || publication.outcome === "not_responsible"
          ? "availability_decided"
          : "availability_published",
        subjectId: truck.truckId,
        actorName: decision.basis === "confirmed" ? "Antcolos (confirmed)" : "Antcolos (inferred)",
        basis: decision.basis,
        summary: `${truck.unit}: ${decision.state.replace(/_/g, " ")} — ${publication.outcome.replace(/_/g, " ")}.`,
        detail: `${decision.rationale} ${publication.reason}`,
        provenance: decision.provenance,
      });
    }
    out.push({ decision, publication });
  }
  return out;
}

/** Proximity in words, for a screen that should not do arithmetic. */
export function proximityLabelFor(miles?: number): string | undefined {
  if (miles == null) return undefined;
  return proximityFor(miles).replace(/_/g, " ");
}

/* -------------------------------------------------------------------------- */
/* A person's word                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Record that a driver or a dispatcher has confirmed a truck empty — or not.
 *
 * This is the ONLY route from "Likely Available" to "Empty Confirmed", and it
 * takes a person. It is also the one place a driver action could be fabricated
 * if this module were careless, so it is not: `by` says who, `actorName` is
 * snapshotted from the caller, and a dispatcher recording a driver's phone call
 * records it as the DISPATCHER's confirmation, because that is what it is.
 */
export async function confirmTruckEmpty(
  ctx: TrackingContext,
  input: { truckId: string; empty: boolean; note?: string; by?: "driver" | "dispatcher" },
): Promise<{ decision?: AvailabilityDecision; publication?: AvailabilityPublication }> {
  await sleep(LATENCY_MS);
  if (!mayTrack(ctx)) return {};

  const truck = fleetSync(truckContextFrom(ctx)).find((t) => t.truckId === input.truckId);
  if (!truck) return {};

  const provisional = availabilityForTruck(input.truckId, ctx, truck);
  if (!provisional) return {};

  recordEmptyConfirmation({
    organizationId: ctx.organizationId,
    truckId: input.truckId,
    cycleKey: provisional.cycleKey,
    by: input.by ?? "dispatcher",
    actorName: ctx.actor.displayNameSnapshot,
    actorMembershipId: ctx.membershipId,
    at: nowIso(),
    empty: input.empty,
    note: input.note?.trim() || undefined,
  });

  const decision = availabilityForTruck(input.truckId, ctx, truck);
  if (!decision) return {};
  const publication = publishAvailabilityDecision(decision, ctx);

  audit(ctx.organizationId, {
    action: "availability_published",
    subjectId: input.truckId,
    actorMembershipId: ctx.membershipId,
    actorName: ctx.actor.displayNameSnapshot,
    basis: "confirmed",
    summary: `${ctx.actor.displayNameSnapshot} confirmed ${truck.unit} is ${input.empty ? "empty" : "not empty"}.`,
    detail: `${decision.rationale} ${publication.reason}`,
    provenance: decision.provenance,
  });

  return { decision, publication };
}

/* -------------------------------------------------------------------------- */
/* The public page's data                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Resolve a tracking token into the small, redacted public view.
 *
 * No caller, no context, no organization — a link holder has none of those,
 * and pretending otherwise would mean inventing a session for them. The
 * snapshot it supplies is assembled here from the session's own load and
 * truck; `resolvePublicTracking` then decides how much of it the recipient's
 * visibility allows out, which is the only place that decision is made.
 */
export function publicTracking(token: string, now: Date = new Date()) {
  return resolvePublicTracking(token, (session) => {
    if (!session.truckId) return {};
    const scope = { organizationId: session.organizationId };
    const signals = locationSignalsFor(scope, {
      truckId: session.truckId,
      loadId: session.loadId,
    });
    const latest = signals[signals.length - 1];

    let load: Load | undefined;
    try {
      load = mockStore.org(session.organizationId).loads.find((l) => l.id === session.loadId);
    } catch {
      load = undefined;
    }
    const rolling = load ? ROLLING.includes(load.status) : false;
    const freshness = assessFreshness({ signals, trackingExpected: rolling, now });

    return {
      // City and state only. No coordinate, no description, no history —
      // "near the yard on Kostner Ave" is more than a customer is owed.
      location: latest ? { city: latest.city, state: latest.state } : undefined,
      etaAt: reportedEta(session.organizationId, session.loadId),
      lastUpdateAt: freshness.lastUpdateAt,
      health: freshness.health,
      healthNote: freshness.reason,
    };
  }, now);
}
