import type {
  ActorRef, Load, LoadEvent, LoadEventKind, LoadEventPayload, LoadStatus,
  Provenance, RateConfirmationRecord,
} from "@/types";
import { destinationStop, originStop } from "@/types";
import {
  buildDomainEvent, LOAD_FINALIZED_VERSION, propagationBus,
  type FinalizedParty, type FinalizedStop, type LoadFinalizedPayload,
} from "@/lib/propagation";
import { ambientCorrelationId } from "@/lib/audit/correlation";
import { mockStore } from "./store";
import { nowIso } from "./time";
// Side-effect import: wires every projection to the bus before anything is
// published. A publisher with no subscribers registered would drop events.
import "./projections";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The write side of the Loads module.
 *
 * Every canonical `Load` mutation in Antcolos goes through one of these. They
 * are kept out of `loads.ts` so the read side stays a read side, but they are
 * part of the same service and are reached only through `LoadsService`.
 *
 * Three rules hold the file together:
 *
 *  1. **Idempotency is real, not aspirational.** Every command takes a key and
 *     the key is remembered. A retried booking returns the load it already
 *     made; a re-applied rate confirmation returns the same finalization with
 *     `duplicate: true` and re-runs nothing.
 *  2. **The timeline is the record.** Nothing sets `status` without appending
 *     the event that justifies it. `Load.status` is a derived convenience — see
 *     `types/event.ts` — and a status with no event behind it is a lie a
 *     dispatcher cannot audit.
 *  3. **A command writes only what the Load owns.** It does not create a broker
 *     profile, does not open a tracking session, does not prepare an invoice and
 *     does not build a driver post. It publishes one event and the modules that
 *     own those records project from it.
 */

/* -------------------------------------------------------------------------- */
/* Idempotency                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * `idempotencyKey` → the load it produced.
 *
 * A module-level map for the same reason every mock store here is one: this is
 * what the backend will hold in a table with a unique index, and holding it per
 * caller would make retries safe only for whoever happened to retry.
 */
const commandResults = new Map<string, string>();

/** Test hook. Never called by the UI. */
export function resetLoadCommands() {
  commandResults.clear();
}

function remembered(key: string, organizationId: string): Load | undefined {
  const loadId = commandResults.get(key);
  if (!loadId) return undefined;
  return mockStore.org(organizationId).loads.find((l) => l.id === loadId);
}

/* -------------------------------------------------------------------------- */
/* The timeline                                                                */
/* -------------------------------------------------------------------------- */

let seq = 0;
const eventId = () => `evt_${(++seq).toString(36)}${Date.now().toString(36)}`;

/**
 * Append one timeline entry.
 *
 * Deliberately the only way these commands record anything. It returns the
 * event so a caller can reference it, and it never edits an existing one — a
 * mistake is corrected by appending a correcting event, which is what
 * `types/event.ts` promises.
 */
export function appendLoadEvent(
  organizationId: string,
  loadId: string,
  kind: LoadEventKind,
  actor: ActorRef,
  at: string,
  payload?: LoadEventPayload,
  source: LoadEvent["source"] = "web",
): LoadEvent {
  const event: LoadEvent = {
    id: eventId(),
    organizationId,
    loadId,
    kind,
    occurredAt: at,
    recordedAt: nowIso(),
    actor,
    source,
    payload,
  };
  mockStore.org(organizationId).events.unshift(event);
  return event;
}

/* -------------------------------------------------------------------------- */
/* Create                                                                     */
/* -------------------------------------------------------------------------- */

export interface CreateBookedLoadArgs {
  /**
   * The organization the load BELONGS to — always the carrier whose operating
   * authority it runs under, never the dispatch workspace that booked it.
   *
   * Callers must not pass `ctx.organizationId` blindly. Under delegation the
   * two differ, and the delegation guard is what derives this one.
   */
  organizationId: string;
  /**
   * The operating carrier proved by A6's `operatingContextAt` at booking time,
   * pinned onto the load so no later command re-derives it from whoever runs
   * the truck today. Defaults to `organizationId` for a carrier booking its own
   * freight, which is the same answer by a shorter route.
   */
  pinnedCarrierOrganizationId?: string;
  /** The lease that proved it, when a lease did. Pinned, never rewritten. */
  operatingLeaseId?: string;
  /** The provider that booked it. Attribution, never a grant. */
  dispatchedByOrganizationId?: string;
  actor: ActorRef;
  idempotencyKey: string;
  reference: string;
  customer: Load["customer"];
  stops: Load["stops"];
  assignment: Load["assignment"];
  equipment: Load["equipment"];
  weightLbs?: number;
  commodity?: string;
  documentRequirements: Load["documentRequirements"];
  financials?: Load["financials"];
  consent: "not_required" | "pending" | "accepted" | "declined";
  note?: string;
  at?: string;
  loadId: string;
}

/**
 * The load a booking agreed to.
 *
 * `status` starts at `offered` when the carrier requires the driver to accept
 * and `planned` when it does not — derived from the consent rule, never passed
 * in, because a caller that could pass `assigned` here could skip a driver's
 * consent by supplying a string.
 */
export function createBookedLoad(args: CreateBookedLoadArgs): Load {
  const existing = remembered(args.idempotencyKey, args.organizationId);
  if (existing) return existing;

  const at = args.at ?? nowIso();
  const org = mockStore.org(args.organizationId);

  const status: LoadStatus = args.consent === "pending" ? "offered" : "planned";
  const load: Load = {
    id: args.loadId,
    organizationId: args.organizationId,
    pinnedCarrierOrganizationId:
      args.pinnedCarrierOrganizationId ?? args.organizationId,
    operatingLeaseId: args.operatingLeaseId,
    dispatchedByOrganizationId: args.dispatchedByOrganizationId,
    reference: args.reference,
    status,
    customer: args.customer,
    stops: args.stops,
    assignment: args.assignment,
    equipment: args.equipment,
    weightLbs: args.weightLbs,
    commodity: args.commodity,
    documentRequirements: args.documentRequirements,
    financials: args.financials,
    createdAt: at,
    createdBy: args.actor,
    updatedAt: at,
  };

  org.loads.unshift(load);
  commandResults.set(args.idempotencyKey, load.id);

  appendLoadEvent(args.organizationId, load.id, "load.created", args.actor, at, {
    note: args.note,
    newValue: status,
  });
  if (args.assignment) {
    appendLoadEvent(args.organizationId, load.id, "assignment.created", args.actor, at, {
      driverId: args.assignment.driverId,
      truckId: args.assignment.truckId,
      trailerId: args.assignment.trailerId,
      note: args.consent === "pending"
        ? "Offered to the driver. The carrier requires them to accept."
        : undefined,
    });
  }

  return load;
}

/* -------------------------------------------------------------------------- */
/* Consent                                                                    */
/* -------------------------------------------------------------------------- */

export function recordLoadConsent(args: {
  organizationId: string;
  actor: ActorRef;
  idempotencyKey: string;
  loadId: string;
  answer: "accepted" | "declined";
  note?: string;
  at?: string;
}): Load {
  const remembered0 = remembered(args.idempotencyKey, args.organizationId);
  if (remembered0) return remembered0;

  const org = mockStore.org(args.organizationId);
  const load = org.loads.find((l) => l.id === args.loadId);
  if (!load) throw new Error("That load could not be read.");

  const at = args.at ?? nowIso();
  const previous = load.status;
  load.status = args.answer === "accepted" ? "assigned" : "offered";
  load.updatedAt = at;
  if (load.assignment) {
    load.assignment.consent = { status: args.answer, respondedAt: at };
  }

  appendLoadEvent(
    args.organizationId, load.id,
    args.answer === "accepted" ? "load.accepted" : "load.declined",
    args.actor, at,
    { previousValue: previous, newValue: load.status, note: args.note },
  );

  commandResults.set(args.idempotencyKey, load.id);
  return load;
}

/* -------------------------------------------------------------------------- */
/* Execution                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What a load does once it is somebody's to drive.
 *
 * ★ WHY THIS EXISTS AT ALL ★
 * Every other state in this mock is reached by a command. Execution was not: a
 * load could be BOOKED through the real path and then had to be written out by
 * hand in `seed.ts` to be in transit. So "a truck that is rolling" could only
 * ever be a fixture, and no seeder could walk one there the way a dispatcher's
 * week actually does.
 *
 * The transitions are deliberately few, and each one is a thing a driver or an
 * ELD genuinely reports. There is no `setStatus(anything)` here, because the
 * point is that a status is the CONSEQUENCE of something happening.
 */
export type LoadMilestone =
  /** Given to the driver. */
  | "dispatched"
  /** On the ground at the pickup. */
  | "at_pickup"
  /** Loaded and away. */
  | "departed_pickup"
  /** On the ground at the delivery. */
  | "at_delivery"
  /** Off, and the paperwork is next. */
  | "delivered";

const MILESTONE_STATUS: Record<LoadMilestone, LoadStatus> = {
  dispatched: "dispatched",
  at_pickup: "at_pickup",
  departed_pickup: "in_transit",
  at_delivery: "at_delivery",
  delivered: "delivered",
};

const MILESTONE_EVENT: Record<LoadMilestone, LoadEventKind> = {
  dispatched: "load.dispatched",
  at_pickup: "stop.arrived",
  departed_pickup: "stop.departed",
  at_delivery: "stop.arrived",
  delivered: "load.delivered",
};

export function recordLoadMilestone(args: {
  organizationId: string;
  actor: ActorRef;
  loadId: string;
  milestone: LoadMilestone;
  at?: string;
  note?: string;
  source?: LoadEvent["source"];
}): Load {
  const org = mockStore.org(args.organizationId);
  const load = org.loads.find((l) => l.id === args.loadId);
  if (!load) throw new Error("That load could not be read.");

  const at = args.at ?? nowIso();
  const previous = load.status;
  load.status = MILESTONE_STATUS[args.milestone];
  load.updatedAt = at;

  // The stop itself records the arrival, so a screen reading stops rather than
  // events gets the same answer. A milestone that only existed as an event
  // would leave the stop saying nobody had turned up.
  const stop = args.milestone === "at_pickup" || args.milestone === "departed_pickup"
    ? load.stops.find((st) => st.kind === "pickup")
    : args.milestone === "at_delivery" || args.milestone === "delivered"
      ? [...load.stops].reverse().find((st) => st.kind === "delivery")
      : undefined;
  if (stop) {
    if (args.milestone === "at_pickup" || args.milestone === "at_delivery") stop.arrivedAt = at;
    if (args.milestone === "departed_pickup" || args.milestone === "delivered") stop.departedAt = at;
  }

  appendLoadEvent(
    args.organizationId, load.id, MILESTONE_EVENT[args.milestone], args.actor, at,
    { previousValue: previous, newValue: load.status, note: args.note },
    args.source ?? "eld",
  );
  return load;
}

/**
 * Something has gone wrong with the timing.
 *
 * Kept apart from the milestones because a delay is not a step forward: the
 * load is exactly where it was and the appointment is now at risk, which is a
 * different sentence and a different colour on every screen that reads it.
 */
export function recordLoadDelay(args: {
  organizationId: string;
  actor: ActorRef;
  loadId: string;
  note: string;
  newEtaAt?: string;
  at?: string;
}): Load {
  const org = mockStore.org(args.organizationId);
  const load = org.loads.find((l) => l.id === args.loadId);
  if (!load) throw new Error("That load could not be read.");
  const at = args.at ?? nowIso();

  appendLoadEvent(
    args.organizationId, load.id, "exception.delay_reported", args.actor, at,
    { note: args.note }, "eld",
  );
  if (args.newEtaAt) {
    appendLoadEvent(
      args.organizationId, load.id, "load.eta_updated", args.actor, at,
      { etaAt: args.newEtaAt, note: args.note }, "eld",
    );
  }
  load.updatedAt = at;
  return load;
}

/* -------------------------------------------------------------------------- */
/* Finalize                                                                   */
/* -------------------------------------------------------------------------- */

/** Which committed rate confirmation already finalized which load. */
const finalizedBy = new Map<string, string>();

export function resetLoadFinalizations() {
  finalizedBy.clear();
}

export interface ApplyRateConfirmationArgs {
  organizationId: string;
  actor: ActorRef;
  idempotencyKey: string;
  loadId: string;
  record: RateConfirmationRecord;
  at?: string;
  /** The operational cycle, when the load came from one. */
  mtLoopId?: string;
  dispatchCycleId?: string;
  bookingId?: string;
  /** Driver, truck and trailer labels, where the caller knows them. */
  assignmentLabels?: {
    driverName?: string;
    truckUnit?: string;
    trailerUnit?: string;
  };
}

export interface ApplyRateConfirmationOutcome {
  load: Load;
  duplicate: boolean;
  eventId: string;
}

const loadProvenance = (at: string): Provenance => ({
  module: "rate_confirmation",
  adapter: "mock:rate-confirmation",
  mock: true,
  observedAt: at,
  receivedAt: nowIso(),
});

/**
 * Write the confirmed values onto the load, finalize it, and publish once.
 *
 * Every value written here comes off the IMMUTABLE canonical record, which only
 * exists once a person reviewed every required field, applied the authorized
 * carrier signature and confirmed the signed copy went back to the broker. There
 * is no path into this function that skips any of that.
 *
 * What is NOT done here, on purpose: no broker, shipper or receiver profile is
 * created or linked (the Directory owns matching and guessing makes duplicates),
 * no driver post, no tracking session, no invoice. Those are projections of the
 * event this publishes.
 */
export async function applyRateConfirmationToLoad(
  args: ApplyRateConfirmationArgs,
): Promise<ApplyRateConfirmationOutcome> {
  const org = mockStore.org(args.organizationId);
  const load = org.loads.find((l) => l.id === args.loadId);
  if (!load) throw new Error("That load could not be read.");

  const at = args.at ?? nowIso();
  const record = args.record;

  // Finalizing the same load from the same rate confirmation twice changes
  // nothing and re-runs nothing. The event id below is derived from the same
  // key, so the bus refuses it too — two locks on one door, deliberately.
  const already = finalizedBy.get(load.id);
  const key = `${record.rateConfirmationId}:v${record.version}`;
  const duplicate = already === key;

  const value = (fieldKey: string) =>
    record.facts.find((f) => f.key === fieldKey)?.confirmedValue;

  if (!duplicate) {
    /* ---- Only fields the Load owns -------------------------------------- */

    if (record.customerReference) load.customerReference = record.customerReference;

    const pickup = load.stops.find((s) => s.kind === "pickup");
    const delivery = [...load.stops].reverse().find((s) => s.kind === "delivery");
    if (pickup) {
      pickup.facilityName = value("pickup_facility") ?? pickup.facilityName;
      const line = value("pickup_address");
      if (line) pickup.address = { ...pickup.address, line1: line.split(",")[0]?.trim() };
    }
    if (delivery) {
      delivery.facilityName = value("delivery_facility") ?? delivery.facilityName;
      const line = value("delivery_address");
      if (line) delivery.address = { ...delivery.address, line1: line.split(",")[0]?.trim() };
    }

    const rate = parseMoney(value("rate_total"));
    if (rate !== undefined && load.financials) {
      load.financials.linehaulCents = rate;
      load.financials.totalRateCents = rate;
      load.financials.ratePerMileCents = Math.round(
        rate / Math.max(load.financials.loadedMiles, 1),
      );
    }

    // The requirement is satisfied by the SIGNED document. An unsigned
    // confirmation on file is not a confirmed load.
    const requirement = load.documentRequirements.find(
      (r) => r.kind === "rate_confirmation",
    );
    if (requirement) requirement.satisfiedByDocumentId = record.signedDocumentId;

    load.status = load.status === "offered" ? "offered" : "planned";
    load.updatedAt = at;

    /* ---- The timeline --------------------------------------------------- */

    appendLoadEvent(
      args.organizationId, load.id, "load.rate_confirmation_received",
      args.actor, record.returnedToBroker.at,
      {
        documentId: record.originalDocumentId,
        note: `Received from ${record.brokerName} as ${record.customerReference ?? "their load"}.`,
      },
      "email",
    );

    const corrections = record.facts.filter((f) => f.correctedValue !== undefined);
    appendLoadEvent(
      args.organizationId, load.id, "load.fields_extracted",
      args.actor, record.committedAt,
      {
        documentId: record.originalDocumentId,
        note: corrections.length > 0
          ? `${record.facts.length} fields read off the document, ${corrections.length} corrected by a person: ${corrections.map((c) => `${c.label} shown as "${c.extractedValue}", corrected to "${c.confirmedValue}"`).join("; ")}.`
          : `${record.facts.length} fields read off the document and confirmed as written.`,
      },
      "ocr",
    );

    appendLoadEvent(
      args.organizationId, load.id, "load.verified",
      args.actor, record.committedAt,
      {
        documentId: record.signedDocumentId,
        note: `Signed for ${record.carrierName} by ${record.signature.signedName}, authorized by ${record.signature.authorisedByName}, and returned to ${record.brokerName}. Rate confirmation ${record.rateConfirmationId} v${record.version}.`,
      },
    );

    finalizedBy.set(load.id, key);
  }

  /* ---- One event, for every authorized projection ---------------------- */

  const event = buildDomainEvent<LoadFinalizedPayload>({
    kind: "load.finalized",
    version: LOAD_FINALIZED_VERSION,
    scope: {
      organizationId: args.organizationId,
      carrierOrganizationId: record.carrierOrganizationId,
    },
    subjectId: load.id,
    subjectKind: "load",
    occurredAt: record.committedAt,
    actor: args.actor,
    // Derived from the rate confirmation, NOT from the caller's own key, so two
    // different callers finalizing the same confirmation still publish once.
    idempotencyKey: `load-finalized:${key}`,
    correlationId: record.correlationId || ambientCorrelationId(),
    provenance: loadProvenance(record.committedAt),
    payload: {
      loadId: load.id,
      loadReference: load.reference,
      customerReference: record.customerReference,
      rateConfirmationId: record.rateConfirmationId,
      rateConfirmationVersion: record.version,
      originalDocumentId: record.originalDocumentId,
      signedDocumentId: record.signedDocumentId,
      signature: {
        carrierOrganizationId: record.signature.carrierOrganizationId,
        carrierName: record.signature.carrierName,
        signedName: record.signature.signedName,
        signedAt: record.signature.signedAt,
        authorisedByName: record.signature.authorisedByName,
        authorisedByMembershipId: record.signature.authorisedByMembershipId,
      },
      returnedToBroker: {
        at: record.returnedToBroker.at,
        channel: record.returnedToBroker.channel,
      },
      parties: partiesFrom(record, load),
      stops: load.stops
        .slice()
        .sort((a, b) => a.sequence - b.sequence)
        .map(stopOf),
      equipment: load.equipment,
      weightLbs: load.weightLbs,
      commodity: load.commodity,
      financials: {
        currency: load.financials?.currency ?? "USD",
        linehaulCents: load.financials?.linehaulCents ?? 0,
        totalRateCents: load.financials?.totalRateCents ?? 0,
        ratePerMileCents: load.financials?.ratePerMileCents ?? 0,
        loadedMiles: load.financials?.loadedMiles ?? 0,
        deadheadMiles: load.financials?.deadheadMiles ?? 0,
        paymentTermsText: value("payment_terms"),
        detentionTermsText: value("detention_terms"),
        layoverTermsText: value("layover_terms"),
      },
      assignment: load.assignment
        ? {
          driverId: load.assignment.driverId,
          driverName: args.assignmentLabels?.driverName,
          truckId: load.assignment.truckId,
          truckUnit: args.assignmentLabels?.truckUnit,
          trailerId: load.assignment.trailerId,
          trailerUnit: args.assignmentLabels?.trailerUnit,
        }
        : undefined,
      documentRequirements: load.documentRequirements.map((r) => ({
        kind: r.kind,
        required: r.required,
        satisfiedByDocumentId: r.satisfiedByDocumentId,
      })),
      mtLoopId: args.mtLoopId,
      dispatchCycleId: args.dispatchCycleId,
      bookingId: args.bookingId,
      facts: record.facts,
    },
  });

  const published = await propagationBus.publish(event);

  return {
    load,
    duplicate: duplicate || published.duplicate,
    eventId: published.event.eventId,
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function stopOf(stop: Load["stops"][number]): FinalizedStop {
  return {
    stopId: stop.id,
    kind: stop.kind,
    sequence: stop.sequence,
    facilityName: stop.facilityName,
    city: stop.address.city,
    state: stop.address.state,
    timeZone: stop.timeZone,
    appointmentType: stop.appointmentType,
    appointmentAt: stop.appointmentAt,
    appointmentEndAt: stop.appointmentEndAt,
  };
}

/**
 * The companies on the confirmation, as CONFIRMED TEXT.
 *
 * Names, not profile ids. The Directory's matching rules decide which permanent
 * profile each of these is, and it requires a person to confirm — which is the
 * whole reason a rate confirmation cannot mint one.
 */
function partiesFrom(record: RateConfirmationRecord, load: Load): FinalizedParty[] {
  const value = (key: string) => record.facts.find((f) => f.key === key)?.confirmedValue;
  const pickup = originStop(load);
  const delivery = destinationStop(load);

  return [
    {
      role: "broker",
      name: value("broker_name") ?? record.brokerName,
      mcNumber: value("broker_mc"),
      contactName: value("broker_contact"),
      contactPhone: load.customer.contact?.phone,
      contactEmail: load.customer.contact?.email,
    },
    {
      role: "shipper",
      name: value("pickup_facility") ?? pickup.facilityName ?? pickup.address.city,
      facilityName: value("pickup_facility") ?? pickup.facilityName,
      addressLine: value("pickup_address") ?? pickup.address.line1,
      city: pickup.address.city,
      state: pickup.address.state,
      contactName: pickup.contact?.name,
      contactPhone: pickup.contact?.phone,
      contactEmail: pickup.contact?.email,
    },
    {
      role: "receiver",
      name: value("delivery_facility") ?? delivery.facilityName ?? delivery.address.city,
      facilityName: value("delivery_facility") ?? delivery.facilityName,
      addressLine: value("delivery_address") ?? delivery.address.line1,
      city: delivery.address.city,
      state: delivery.address.state,
      contactName: delivery.contact?.name,
      contactPhone: delivery.contact?.phone,
      contactEmail: delivery.contact?.email,
    },
  ];
}

function parseMoney(text?: string): number | undefined {
  if (!text) return undefined;
  const n = Number.parseFloat(text.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : undefined;
}
