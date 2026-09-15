import type {
  AvailabilityDecision, ConfirmationState, FleetTruck, IsoDateTime, Load, Provenance,
} from "@/types";
import { destinationStop } from "@/types";
import {
  DEFAULT_GEOFENCE_RADIUS_MILES, decideAvailability,
  type AvailabilityInput, type Geofence, type MilestoneObservation,
} from "@/lib/tracking";
import { mockStore } from "./store";
import { driverWorkflowStore } from "./driver-workflow-store";
import { cityPoint, locationSignalsFor, reportedEta } from "./tracking-signals";
import { fleetSync, truckContextFrom } from "./truck-registry";
import type { MtLoopContext } from "./mt-loop";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * Gathering the evidence, and nothing else.
 *
 * The rules live in `@/lib/tracking/availability`, which is pure and has no
 * idea this file exists. This file's whole job is to go to the module that
 * OWNS each fact and ask it — the truck registry for the equipment status, the
 * Load module for the stops and the appointment, the ELD/telematics boundary
 * for positions, the Driver Trip Workflow for milestones, the Document Center
 * for the POD — and hand the lot to the engine.
 *
 * Kept apart on purpose. A service that both fetched and decided would be a
 * service where a fixture quietly became a rule, and where the only way to
 * test "POD present but the truck is 300 miles away" would be to build that
 * situation out of seed data.
 */

const ADAPTER = "mock:antcolos_availability";

function provenance(): Provenance {
  const at = new Date().toISOString();
  return {
    module: "telematics",
    adapter: ADAPTER,
    mock: true,
    observedAt: at,
    receivedAt: at,
  };
}

/* -------------------------------------------------------------------------- */
/* Explicit human confirmations                                                */
/* -------------------------------------------------------------------------- */

/**
 * A person saying, in as many words, whether a truck is empty.
 *
 * Genuinely new data — nothing else in Antcolos records it, because until now
 * nothing needed a human answer to a machine's question. Partitioned by
 * organization like every other mock collection, and append-only: a later
 * confirmation supersedes an earlier one by being later, never by editing it.
 */
export interface EmptyConfirmation {
  id: string;
  organizationId: string;
  truckId: string;
  /** The cycle it was given about, so a stale confirmation cannot carry over. */
  cycleKey: string;
  by: "driver" | "dispatcher";
  actorName: string;
  actorMembershipId?: string;
  at: IsoDateTime;
  empty: boolean;
  note?: string;
}

let confirmationSeq = 0;
const confirmations = new Map<string, EmptyConfirmation[]>();

/** Test hook. Never called by the UI. */
export function resetEmptyConfirmations() {
  confirmationSeq = 0;
  confirmations.clear();
}

function confirmationBucket(organizationId: string): EmptyConfirmation[] {
  let rows = confirmations.get(organizationId);
  if (!rows) {
    rows = [];
    confirmations.set(organizationId, rows);
  }
  return rows;
}

export function recordEmptyConfirmation(input: Omit<EmptyConfirmation, "id">): EmptyConfirmation {
  confirmationSeq += 1;
  const row: EmptyConfirmation = { ...input, id: `ecf_${confirmationSeq.toString(36)}` };
  confirmationBucket(input.organizationId).push(row);
  return row;
}

/**
 * The newest confirmation for THIS cycle, if any.
 *
 * Scoped to the cycle deliberately: somebody confirming a truck empty on
 * Tuesday says nothing about the load it picked up on Wednesday, and a
 * confirmation that carried across cycles would be the one way a stale human
 * answer could masquerade as a current fact.
 */
export function latestConfirmation(
  organizationId: string,
  truckId: string,
  cycleKey: string,
): EmptyConfirmation | undefined {
  let best: EmptyConfirmation | undefined;
  for (const row of confirmationBucket(organizationId)) {
    if (row.truckId !== truckId || row.cycleKey !== cycleKey) continue;
    if (!best || row.at > best.at) best = row;
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/* Reading the other modules                                                   */
/* -------------------------------------------------------------------------- */

/** The live load on a truck, as this organization can see it. */
export function liveLoadForTruck(organizationId: string, truckId: string): Load | undefined {
  let org;
  try {
    org = mockStore.org(organizationId);
  } catch {
    return undefined;
  }
  const candidates = org.loads.filter(
    (l) => l.assignment?.truckId === truckId && !l.assignment.endedAt && l.status !== "cancelled",
  );
  // The one still running wins; failing that, the most recently finished, so a
  // truck that delivered an hour ago is still judged against that delivery.
  const running = candidates.find(
    (l) => !["delivered", "ready_to_invoice", "invoiced", "paid"].includes(l.status),
  );
  if (running) return running;
  return [...candidates].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

/**
 * The receiver's geofence.
 *
 * Built from the delivery stop's city centroid, because no facility in this
 * build has surveyed coordinates. The radius is the default, and the label
 * says which facility it is about, so every inference drawn from it can be
 * read back to a named circle rather than "a geofence".
 */
export function receiverFenceFor(load: Load | undefined): Geofence | undefined {
  if (!load) return undefined;
  const stop = destinationStop(load);
  const centre = cityPoint(stop.address.city, stop.address.state);
  if (!centre) return undefined;
  return {
    subjectId: stop.id,
    label: stop.facilityName ?? `${stop.address.city}, ${stop.address.state}`,
    centre,
    radiusMiles: DEFAULT_GEOFENCE_RADIUS_MILES,
  };
}

/** How a workflow event's confirmation state maps onto an availability basis. */
function observationFrom(
  at: IsoDateTime,
  confirmation: ConfirmationState,
  rationale?: string,
  confidence?: number,
): MilestoneObservation | undefined {
  switch (confirmation) {
    case "driver_confirmed":
    case "confirmed_from_inference":
      return { at, basis: "confirmed", attribution: "driver", confidence: 1 };
    case "inferred":
      return { at, basis: "inferred", attribution: "adapter", confidence: confidence ?? 0.6, rationale };
    case "system":
      // The system wrote it. It makes no claim about the driver, so it can
      // never be treated as a driver's action.
      return { at, basis: "inferred", attribution: "system", confidence: 0.5, rationale };
    case "rejected_inference":
      return undefined;
    default:
      return undefined;
  }
}

/**
 * What the Driver Trip Workflow recorded for this load.
 *
 * Read from the workflow's own append-only events. Nothing is written back and
 * no milestone is created here — this module reads the workflow, it does not
 * get to act inside it.
 */
export function workflowObservationsFor(
  organizationId: string,
  loadId: string,
): AvailabilityInput["workflow"] {
  const org = driverWorkflowStore.org(organizationId);
  const events = org.workflowEvents
    .filter((e) => e.loadId === loadId && e.milestone)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  if (events.length === 0) return undefined;

  const pick = (milestone: string) => {
    const hit = [...events].reverse().find((e) => e.milestone === milestone);
    if (!hit) return undefined;
    return observationFrom(
      hit.occurredAt,
      hit.confirmation,
      hit.inference?.rationale,
      hit.inference?.confidence,
    );
  };

  const out = {
    arrivedAtReceiver: pick("arrived_at_receiver"),
    unloadingStarted: pick("unloading_started"),
    unloaded: pick("delivered_and_unloaded"),
    tripCompleted: pick("trip_completed"),
    podUploaded: pick("pod_uploaded"),
  };
  return Object.values(out).some(Boolean) ? out : undefined;
}

/** Proof of delivery, as the Document Center holds it for this load. */
export function podStatusFor(
  organizationId: string,
  loadId: string,
): AvailabilityInput["pod"] {
  let org;
  try {
    org = mockStore.org(organizationId);
  } catch {
    return { present: false, verified: false };
  }
  const pod = org.documents.find(
    (d) => d.kind === "proof_of_delivery"
      && d.links.some((l) => l.entityKind === "load" && l.entityId === loadId),
  );
  if (!pod) return { present: false, verified: false };
  return {
    present: true,
    verified: pod.verification.state === "verified",
    at: pod.verification.verifiedAt ?? pod.uploadedAt,
  };
}

/* -------------------------------------------------------------------------- */
/* The decision                                                                */
/* -------------------------------------------------------------------------- */

const STATUS_MAP: Record<string, AvailabilityInput["equipmentStatus"]> = {
  available: "available",
  loaded: "loaded",
  expected_available: "expected_available",
  unavailable: "unavailable",
  maintenance: "maintenance",
};

/**
 * Assemble the facts for one truck and decide.
 *
 * Every read below is through the accessor that owns the data, in this
 * workspace's context, so there is no path here that reaches a record the
 * caller is not entitled to. When the workspace cannot see the truck at all,
 * the answer is `undefined` — never a decision built from nothing.
 */
export function availabilityForTruck(
  truckId: string,
  ctx: MtLoopContext,
  fleetTruck?: FleetTruck,
): AvailabilityDecision | undefined {
  const truck = fleetTruck
    ?? fleetSync(truckContextFrom(ctx)).find((t) => t.truckId === truckId);
  if (!truck) return undefined;

  const load = liveLoadForTruck(ctx.organizationId, truckId);
  const stop = load ? destinationStop(load) : undefined;
  const signals = locationSignalsFor(ctx, { truckId, loadId: load?.id });

  const input: AvailabilityInput = {
    truckId,
    truckUnit: truck.unit,
    organizationId: ctx.organizationId,
    carrierOrganizationId: truck.carrierOrganizationId,
    equipmentStatus: STATUS_MAP[truck.status] ?? "expected_available",
    load: load && stop
      ? {
        id: load.id,
        reference: load.reference,
        status: load.status,
        deliveryCity: stop.address.city,
        deliveryState: stop.address.state,
        deliveryPoint: cityPoint(stop.address.city, stop.address.state),
        deliveryFacilityName: stop.facilityName,
        deliveryAppointmentAt: stop.appointmentAt,
        deliveryArrivedAt: stop.arrivedAt,
        deliveryDepartedAt: stop.departedAt,
      }
      : undefined,
    signals,
    etaAt: load ? reportedEta(ctx.organizationId, load.id) : undefined,
    receiverFence: receiverFenceFor(load),
    workflow: load ? workflowObservationsFor(ctx.organizationId, load.id) : undefined,
    pod: load ? podStatusFor(ctx.organizationId, load.id) : undefined,
    provenance: provenance(),
  };

  // Decided once without the confirmation so the cycle key is known, then
  // again with the confirmation that belongs to THAT cycle. A confirmation
  // given about a previous cycle must not leak into this one, and the cycle
  // key is what keeps them apart.
  const provisional = decideAvailability(input);
  const confirmation = latestConfirmation(ctx.organizationId, truckId, provisional.cycleKey);
  if (!confirmation) return provisional;

  return decideAvailability({
    ...input,
    confirmation: {
      by: confirmation.by,
      actorName: confirmation.actorName,
      at: confirmation.at,
      empty: confirmation.empty,
      note: confirmation.note,
    },
  });
}

/** Every truck this workspace dispatches, decided. Ordered by soonest empty. */
export function availabilityForWorkspace(ctx: MtLoopContext): AvailabilityDecision[] {
  const trucks = fleetSync(truckContextFrom(ctx));
  return trucks
    .map((truck) => availabilityForTruck(truck.truckId, ctx, truck))
    .filter((d): d is AvailabilityDecision => d !== undefined)
    .sort((a, b) => (a.expectedEmptyAt ?? "9999").localeCompare(b.expectedEmptyAt ?? "9999"));
}
