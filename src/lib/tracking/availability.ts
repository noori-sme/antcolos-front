import type {
  AvailabilityAttribution, AvailabilityBasis, AvailabilityDecision,
  AvailabilityEvidence, AvailabilityEvidenceKind, AvailabilityState, GeoPoint,
  IsoDateTime, LoadStatus, LocationSignal, Provenance,
} from "@/types";
import { operationalCycleKey } from "./cycle";
import { evaluateGeofence, hasExited, proximityFor, straightLineMiles, type Geofence } from "./geo";
import { AVAILABILITY_TRUST_WINDOW_MINUTES, formatAge, positionIsTrustworthy } from "./freshness";
import { dedupeSignals, isHumanTransport, latestSignal } from "./signals";

/**
 * ★ THE AVAILABILITY ENGINE ★
 *
 * One pure function, `decideAvailability`, and one rule it exists to enforce:
 *
 *   NO AMOUNT OF MACHINE EVIDENCE PRODUCES "EMPTY CONFIRMED".
 *
 * Not a geofence exit. Not a POD sitting in the Document Center. Not a
 * position parked at the receiver for six hours with the engine off. Every one
 * of those is a reason to believe, and believing is what "Likely Available"
 * means. Confirmation comes from a person — a driver recording that they are
 * unloaded, or a dispatcher saying so — and from nothing else.
 *
 * The function is pure. It reads a bag of facts the service gathered from the
 * modules that own them — the ELD/telematics boundary, the Load, the Driver
 * Trip Workflow, the Document Center, the truck registry — and returns a
 * decision. It fetches nothing, writes nothing and remembers nothing, so the
 * same facts always yield the same answer, and a test can put any situation in
 * front of it without a fixture.
 *
 * Everything it looked at comes back in `evidence`, INCLUDING what it looked
 * at and refused to use. A geofence ping rejected because the truck was doing
 * 62mph is kept with that sentence on it, because "why does it say uncertain"
 * is the question this module will actually be asked.
 */

/** Anything inferred is capped here. The gap to 1 is not a rounding error. */
export const MAX_INFERRED_CONFIDENCE = 0.85;
export const CONFIRMED_CONFIDENCE = 1;

/** How long a receiver is assumed to take, when nobody has said. */
export const DEFAULT_UNLOAD_ALLOWANCE_MINUTES = 90;

/** A milestone as one of the owning modules reported it. */
export interface MilestoneObservation {
  at: IsoDateTime;
  /** `confirmed` only when a PERSON recorded it. */
  basis: AvailabilityBasis;
  attribution: AvailabilityAttribution;
  confidence?: number;
  rationale?: string;
}

/**
 * Everything the engine is allowed to know.
 *
 * Assembled by the service from the systems that own each fact. Nothing here
 * is optional-because-convenient: every absent field is a real "nobody has
 * told us", and the engine says so rather than assuming a default.
 */
export interface AvailabilityInput {
  truckId: string;
  truckUnit?: string;
  organizationId: string;
  carrierOrganizationId?: string;

  /** The carrier's own operating status for the equipment. A person set this. */
  equipmentStatus: "available" | "loaded" | "expected_available" | "unavailable" | "maintenance";
  /** Why, when the carrier has stood the truck down. */
  equipmentStatusNote?: string;

  /** The load the truck is finishing, when there is one. */
  load?: {
    id: string;
    reference: string;
    status: LoadStatus;
    deliveryCity: string;
    deliveryState: string;
    deliveryPoint?: GeoPoint;
    deliveryFacilityName?: string;
    deliveryAppointmentAt?: IsoDateTime;
    /** Actuals off the stop, written by events. Null until they arrive. */
    deliveryArrivedAt?: IsoDateTime;
    deliveryDepartedAt?: IsoDateTime;
  };

  /** Positions for this truck. Order does not matter; duplicates are collapsed. */
  signals: readonly LocationSignal[];
  /** The last reported estimate of arrival. */
  etaAt?: IsoDateTime;
  /** The receiver's circle, where the facility has coordinates. */
  receiverFence?: Geofence;

  /** What the Driver Trip Workflow says about this trip, if it has a workflow. */
  workflow?: {
    arrivedAtReceiver?: MilestoneObservation;
    unloadingStarted?: MilestoneObservation;
    unloaded?: MilestoneObservation;
    tripCompleted?: MilestoneObservation;
    podUploaded?: MilestoneObservation;
  };

  /** Proof of delivery, as the Document Center holds it. */
  pod?: { present: boolean; verified: boolean; at?: IsoDateTime };

  /** A person's explicit word. The only route to Empty Confirmed. */
  confirmation?: {
    by: "driver" | "dispatcher";
    actorName: string;
    at: IsoDateTime;
    empty: boolean;
    note?: string;
  };

  unloadAllowanceMinutes?: number;
  /** Stamped onto the decision. The adapter that supplied the signals. */
  provenance: Provenance;
  now?: Date;
}

/* -------------------------------------------------------------------------- */
/* Evidence building                                                           */
/* -------------------------------------------------------------------------- */

function evidence(
  kind: AvailabilityEvidenceKind,
  basis: AvailabilityBasis,
  attribution: AvailabilityAttribution,
  observedAt: IsoDateTime,
  confidence: number,
  summary: string,
  extra: Partial<AvailabilityEvidence> = {},
): AvailabilityEvidence {
  return {
    kind,
    basis,
    attribution,
    observedAt,
    // Belt and braces: an inferred conclusion cannot claim certainty even if a
    // source hands one up. The cap is enforced where evidence is MADE, not
    // only where it is read.
    confidence: basis === "confirmed"
      ? Math.min(CONFIRMED_CONFIDENCE, Math.max(0, confidence))
      : Math.min(MAX_INFERRED_CONFIDENCE, Math.max(0, confidence)),
    summary,
    ...extra,
  };
}

const minutesBetween = (a: number, b: number) => Math.round((a - b) / 60_000);

/* -------------------------------------------------------------------------- */
/* The decision                                                                */
/* -------------------------------------------------------------------------- */

export function decideAvailability(input: AvailabilityInput): AvailabilityDecision {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const signals = dedupeSignals(input.signals);
  const latest = latestSignal(signals);
  const found: AvailabilityEvidence[] = [];

  const duplicatesDropped = input.signals.length - signals.length;

  /* ---- 1. What the equipment record says. A person set it. -------------- */
  found.push(
    evidence(
      "equipment_status",
      "confirmed",
      "carrier",
      nowIso,
      CONFIRMED_CONFIDENCE,
      equipmentSummary(input),
    ),
  );

  /* ---- 2. Where it is, and whether that is fresh enough to lean on ------ */
  const positionTrusted = positionIsTrustworthy(latest, now);
  let milesToDelivery: number | undefined;

  if (latest) {
    const age = minutesBetween(now.getTime(), Date.parse(latest.observedAt));
    if (latest.point && input.load?.deliveryPoint) {
      milesToDelivery = straightLineMiles(latest.point, input.load.deliveryPoint);
    }
    const where = placeOf(latest);
    const proximityNote = milesToDelivery == null
      ? ""
      : ` — ${Math.round(milesToDelivery)} straight-line miles from ${input.load?.deliveryCity ?? "the receiver"}`;

    found.push(
      evidence(
        "gps_location",
        isHumanTransport(latest.transport) ? "confirmed" : "inferred",
        isHumanTransport(latest.transport)
          ? (latest.transport === "driver_report" ? "driver" : "dispatcher")
          : "adapter",
        latest.observedAt,
        positionTrusted ? latest.confidence : Math.min(latest.confidence, 0.3),
        `Last reported ${where}${proximityNote}, ${formatAge(age)} ago.`,
        {
          provenance: latest.provenance,
          sourceRecordId: latest.id,
          disregardedReason: positionTrusted
            ? undefined
            : `Older than the ${AVAILABILITY_TRUST_WINDOW_MINUTES}-minute window this engine will decide availability on.`,
        },
      ),
    );

    if (latest.speedMph != null) {
      found.push(
        evidence(
          "gps_movement",
          "inferred",
          "adapter",
          latest.observedAt,
          positionTrusted ? 0.7 : 0.2,
          latest.speedMph > 5
            ? `Moving at about ${Math.round(latest.speedMph)} mph.`
            : "Stationary, or as near as the source can tell.",
          { provenance: latest.provenance, sourceRecordId: latest.id },
        ),
      );
    }
  } else {
    found.push(
      evidence("gps_location", "inferred", "adapter", nowIso, 0,
        "No position has been reported for this truck.",
        { disregardedReason: "There is nothing to read." }),
    );
  }

  if (duplicatesDropped > 0) {
    found.push(
      evidence("gps_location", "inferred", "adapter", nowIso, 0,
        `${duplicatesDropped} duplicate position${duplicatesDropped === 1 ? "" : "s"} arrived and ${duplicatesDropped === 1 ? "was" : "were"} collapsed.`,
        { disregardedReason: "A repeat of an observation already held." }),
    );
  }

  /* ---- 3. The appointment and the estimate ------------------------------ */
  if (input.load?.deliveryAppointmentAt) {
    found.push(
      evidence("delivery_appointment", "confirmed", "system", input.load.deliveryAppointmentAt, CONFIRMED_CONFIDENCE,
        `Delivery appointment at ${input.load.deliveryCity}, ${input.load.deliveryState} is ${new Date(input.load.deliveryAppointmentAt).toISOString()}.`),
    );
  }
  if (input.etaAt) {
    found.push(
      evidence("eta", "inferred", "adapter", input.etaAt, 0.6,
        `Last reported ETA ${new Date(input.etaAt).toISOString()}.`),
    );
  }

  /* ---- 4. The geofence, with the pass-by guard in front of it ----------- */
  let believableEntry = false;
  let believableExit = false;

  if (input.receiverFence) {
    const verdict = evaluateGeofence(
      input.receiverFence,
      signals.map((s) => ({ point: s.point, speedMph: s.speedMph, observedAt: s.observedAt })),
      now,
    );
    if (verdict.believable) {
      believableEntry = true;
      found.push(
        evidence("geofence_entry", "inferred", "adapter", latest?.observedAt ?? nowIso,
          Math.min(MAX_INFERRED_CONFIDENCE, 0.7),
          verdict.rationale, { provenance: latest?.provenance }),
      );
    } else {
      found.push(
        evidence("geofence_entry", "inferred", "adapter", latest?.observedAt ?? nowIso, 0,
          `No believable entry into ${input.receiverFence.label}.`,
          { disregardedReason: verdict.rejection, provenance: latest?.provenance }),
      );
    }

    const exit = hasExited(
      input.receiverFence,
      signals.map((s) => ({ point: s.point, speedMph: s.speedMph, observedAt: s.observedAt })),
    );
    if (exit.exited) {
      believableExit = true;
      found.push(
        evidence("geofence_exit", "inferred", "adapter", exit.at ?? nowIso, 0.65, exit.reason,
          { provenance: latest?.provenance }),
      );
    }
  }

  /* ---- 5. What the Driver Trip Workflow recorded ------------------------ */
  const wf = input.workflow;
  for (const [key, label] of [
    ["arrivedAtReceiver", "Arrived at the receiver"],
    ["unloadingStarted", "Unloading started"],
    ["unloaded", "Delivered and unloaded"],
    ["tripCompleted", "Trip completed"],
    ["podUploaded", "Proof of delivery uploaded"],
  ] as const) {
    const observation = wf?.[key];
    if (!observation) continue;
    found.push(
      evidence(
        key === "podUploaded" ? "pod_status"
          : key === "unloadingStarted" || key === "unloaded" ? "unloading_status"
            : "driver_workflow_event",
        observation.basis,
        observation.attribution,
        observation.at,
        observation.confidence ?? (observation.basis === "confirmed" ? CONFIRMED_CONFIDENCE : 0.6),
        observation.basis === "confirmed"
          ? `${label} — recorded by a person.`
          : `${label} — suggested by a signal, not confirmed. ${observation.rationale ?? ""}`.trim(),
      ),
    );
  }

  /* ---- 6. Proof of delivery in the Document Center ---------------------- */
  if (input.pod?.present) {
    found.push(
      evidence("pod_status", input.pod.verified ? "confirmed" : "inferred",
        input.pod.verified ? "dispatcher" : "adapter",
        input.pod.at ?? nowIso,
        input.pod.verified ? CONFIRMED_CONFIDENCE : 0.6,
        input.pod.verified
          ? "Proof of delivery is on file and a person has verified it."
          : "Proof of delivery is on file but nobody has verified it yet."),
    );
  }

  /* ---- 7. A person's word ----------------------------------------------- */
  if (input.confirmation) {
    const c = input.confirmation;
    found.push(
      evidence("human_confirmation", "confirmed", c.by === "driver" ? "driver" : "dispatcher", c.at,
        CONFIRMED_CONFIDENCE,
        `${c.actorName} confirmed the truck is ${c.empty ? "empty" : "not empty"}.${c.note ? ` ${c.note}` : ""}`),
    );
  }

  /* ---- Now decide --------------------------------------------------------
   * Ordered most-certain first. Each branch names what it stood on, and no
   * branch below the confirmation ones can reach "empty_confirmed".
   */
  const usable = found.filter((e) => !e.disregardedReason);
  const verdict = classify(input, {
    now, signals, latest, positionTrusted, milesToDelivery, believableEntry, believableExit, usable,
  });

  const expectedEmptyAt = expectedEmpty(input, verdict.state, now);

  return {
    truckId: input.truckId,
    organizationId: input.organizationId,
    carrierOrganizationId: input.carrierOrganizationId,
    state: verdict.state,
    basis: verdict.basis,
    confidence: verdict.basis === "confirmed"
      ? CONFIRMED_CONFIDENCE
      : Math.min(MAX_INFERRED_CONFIDENCE, verdict.confidence),
    cycleKey: operationalCycleKey({
      truckId: input.truckId,
      loadId: input.load?.id,
      emptyAt: expectedEmptyAt,
    }),
    loadId: input.load?.id,
    loadReference: input.load?.reference,
    expectedEmptyAt,
    expectedEmptyCity: input.load?.deliveryCity ?? latest?.city,
    expectedEmptyState: input.load?.deliveryState ?? latest?.state,
    decidedAt: nowIso,
    evidence: found,
    rationale: verdict.rationale,
    awaiting: verdict.awaiting,
    provenance: { ...input.provenance, receivedAt: nowIso },
  };
}

/* -------------------------------------------------------------------------- */
/* Classification                                                              */
/* -------------------------------------------------------------------------- */

interface Working {
  now: Date;
  signals: LocationSignal[];
  latest?: LocationSignal;
  positionTrusted: boolean;
  milesToDelivery?: number;
  believableEntry: boolean;
  believableExit: boolean;
  usable: AvailabilityEvidence[];
}

interface Verdict {
  state: AvailabilityState;
  basis: AvailabilityBasis;
  confidence: number;
  rationale: string;
  awaiting?: string;
}

function classify(input: AvailabilityInput, w: Working): Verdict {
  const { load, workflow, pod, confirmation, equipmentStatus } = input;

  /* --- The carrier has taken the truck out of play. Nothing overrides it. */
  if (equipmentStatus === "maintenance" || equipmentStatus === "unavailable") {
    return {
      state: "unavailable",
      basis: "confirmed",
      confidence: CONFIRMED_CONFIDENCE,
      rationale: equipmentSummary(input),
    };
  }

  /* --- A person said so. The only door to Empty Confirmed. --------------- */
  if (confirmation) {
    return confirmation.empty
      ? {
        state: "empty_confirmed",
        basis: "confirmed",
        confidence: CONFIRMED_CONFIDENCE,
        rationale: `${confirmation.actorName} confirmed the truck is empty.`,
      }
      : {
        state: "unavailable",
        basis: "confirmed",
        confidence: CONFIRMED_CONFIDENCE,
        rationale: `${confirmation.actorName} says the truck is not empty.`,
      };
  }

  /* --- The driver recorded unloading through their own workflow. --------- */
  const confirmedUnload = [workflow?.unloaded, workflow?.tripCompleted]
    .find((m) => m?.basis === "confirmed");
  if (confirmedUnload) {
    return {
      state: "empty_confirmed",
      basis: "confirmed",
      confidence: CONFIRMED_CONFIDENCE,
      rationale:
        "The driver recorded the load delivered and unloaded in their own workflow. "
        + "That is a person's action, not an inference.",
    };
  }

  /* --- Contradictions. Saying "I cannot tell" is a real answer. ---------- */
  const contradiction = findContradiction(input, w);
  if (contradiction) {
    return {
      state: "availability_uncertain",
      basis: "inferred",
      confidence: 0.2,
      rationale: contradiction,
      awaiting: "Somebody needs to confirm where this truck actually is and whether it is empty.",
    };
  }

  /* --- The machine evidence says unloaded. That is LIKELY, never certain.  */
  const unloadSigns: string[] = [];
  if (workflow?.unloaded?.basis === "inferred") unloadSigns.push("the workflow inferred unloading finished");
  if (workflow?.unloadingStarted && !workflow?.unloaded) unloadSigns.push("unloading had started");
  if (pod?.present) unloadSigns.push("proof of delivery is on file");
  if (w.believableExit) unloadSigns.push("the truck left the receiver's geofence after dwelling inside it");
  if (load?.deliveryDepartedAt) unloadSigns.push("the delivery stop shows a departure");
  if (load?.status === "delivered") unloadSigns.push("the load is marked delivered");

  if (unloadSigns.length > 0) {
    // The carrier's own record agreeing with the machine evidence is a person
    // corroborating it, so this is the one path where inferred evidence and a
    // human statement combine into a confirmation. The confirmation is the
    // carrier's; the GPS did not produce it and could not have.
    if (equipmentStatus === "available") {
      return {
        state: "empty_confirmed",
        basis: "confirmed",
        confidence: CONFIRMED_CONFIDENCE,
        rationale:
          `The carrier's own record has this truck available, and the evidence agrees: ${joinPhrases(unloadSigns)}.`,
      };
    }

    // Two independent signs, or one plus a trustworthy position, before this
    // engine is willing to say "likely". One lonely inference is a lead, and a
    // lead does not move a truck onto the empty board as probably-free.
    const strong = unloadSigns.length >= 2 || (unloadSigns.length === 1 && w.positionTrusted);
    if (strong) {
      return {
        state: "likely_available",
        basis: "inferred",
        confidence: Math.min(MAX_INFERRED_CONFIDENCE, 0.5 + 0.12 * unloadSigns.length),
        rationale: `Probably empty: ${joinPhrases(unloadSigns)}. Nobody has confirmed it.`,
        awaiting: "A driver or dispatcher confirming the truck is empty.",
      };
    }
    return {
      state: "expected_available",
      basis: "inferred",
      confidence: 0.45,
      rationale:
        `One sign points at an empty truck — ${unloadSigns[0]} — and nothing corroborates it yet.`,
      awaiting: "A second signal, or somebody confirming it.",
    };
  }

  /* --- Before delivery: the appointment, the ETA and the distance. -------
   * Ahead of the equipment record on purpose. A live load with an appointment
   * and a fresh position is evidence about right now; a status field is what
   * somebody last set. When they disagree, this says so out loud rather than
   * quietly preferring one.
   */
  if (load && !isFinished(load.status)) {
    const disagreement = equipmentStatus === "available"
      ? ` The carrier's record still has this truck available, which does not match ${load.reference} being live — worth a phone call.`
      : "";
    const target = input.etaAt ?? load.deliveryAppointmentAt;
    if (target) {
      const proximityPhrase = w.milesToDelivery != null
        ? `, currently ${Math.round(w.milesToDelivery)} straight-line miles out (${proximityFor(w.milesToDelivery).replace(/_/g, " ")})`
        : "";
      return {
        state: "expected_available",
        basis: "inferred",
        confidence: w.positionTrusted ? 0.7 : 0.45,
        rationale:
          `Still on ${load.reference}, due into ${load.deliveryCity}, ${load.deliveryState}${proximityPhrase}. `
          + `Expected empty is derived from that, plus unloading time.${disagreement}`,
        awaiting: "Delivery, then somebody confirming the truck is empty.",
      };
    }
    return {
      state: "availability_uncertain",
      basis: "inferred",
      confidence: 0.2,
      rationale:
        `On ${load.reference} with no delivery appointment and no ETA, so there is nothing to derive an empty time from.${disagreement}`,
      awaiting: "A delivery appointment or an ETA.",
    };
  }

  /* --- The carrier's record says the truck is free, and nothing disputes it. */
  if (equipmentStatus === "available") {
    return {
      state: "empty_confirmed",
      basis: "confirmed",
      confidence: CONFIRMED_CONFIDENCE,
      rationale:
        "The carrier's own record has this truck available, and no load or signal contradicts it. "
        + "That is a person's statement about their own equipment, not a GPS conclusion.",
    };
  }

  if (equipmentStatus === "expected_available") {
    return {
      state: "expected_available",
      basis: "confirmed",
      confidence: CONFIRMED_CONFIDENCE,
      rationale:
        "The carrier's record says this truck is expected available, with no load or signal to refine it by.",
      awaiting: "Confirmation that it is actually empty.",
    };
  }

  return {
    state: "availability_uncertain",
    basis: "inferred",
    confidence: 0.15,
    rationale:
      w.latest
        ? "There is a position but nothing about a load, a delivery or unloading to read it against."
        : "Nothing has been reported about this truck at all — no position, no workflow, no paperwork.",
    awaiting: "Any signal, or somebody saying where the truck is and whether it is loaded.",
  };
}

/**
 * Situations where the evidence disagrees with itself.
 *
 * These produce "Availability Uncertain" rather than a best guess, because the
 * cost of the best guess is a dispatcher booking a load onto a truck that is
 * three hundred miles from where the paperwork says it finished.
 */
function findContradiction(input: AvailabilityInput, w: Working): string | undefined {
  const { load, pod, workflow } = input;

  const claimsDone = Boolean(
    pod?.present || load?.status === "delivered" || workflow?.unloaded || load?.deliveryDepartedAt,
  );

  if (claimsDone && w.positionTrusted && w.milesToDelivery != null) {
    const proximity = proximityFor(w.milesToDelivery);
    if (proximity === "far" || proximity === "en_route") {
      return (
        `The paperwork says this load is finished, but the last position is ${Math.round(w.milesToDelivery)} `
        + `straight-line miles from ${load?.deliveryCity ?? "the receiver"}. Those two cannot both be right.`
      );
    }
  }

  // Claimed arrival at the receiver while the truck is demonstrably moving fast
  // somewhere else.
  if (
    workflow?.arrivedAtReceiver
    && w.positionTrusted
    && w.latest?.speedMph != null
    && w.latest.speedMph > 40
    && (w.milesToDelivery == null || w.milesToDelivery > 25)
  ) {
    return (
      "The workflow shows an arrival at the receiver, but the truck is reported doing "
      + `${Math.round(w.latest.speedMph)} mph away from it.`
    );
  }

  // A running load where we have nothing fresh enough to decide on.
  if (load && isRunning(load.status) && !w.positionTrusted && !workflow && !pod?.present) {
    return w.latest
      ? `The only position for this truck is older than the ${AVAILABILITY_TRUST_WINDOW_MINUTES}-minute window availability is decided on, and nothing else has reported.`
      : "This load is running and nothing has reported a position, a milestone or a document.";
  }

  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function equipmentSummary(input: AvailabilityInput): string {
  switch (input.equipmentStatus) {
    case "maintenance":
      return "The carrier has this truck in the shop.";
    case "unavailable":
      return input.equipmentStatusNote
        ?? "The carrier has marked this truck unavailable.";
    case "loaded":
      return "The carrier's record has this truck loaded.";
    case "available":
      return "The carrier's record has this truck available.";
    default:
      return "The carrier's record has this truck expected available.";
  }
}

function placeOf(signal: LocationSignal): string {
  if (signal.description) return signal.description;
  if (signal.city && signal.state) return `${signal.city}, ${signal.state}`;
  if (signal.city) return signal.city;
  if (signal.point) {
    return `${signal.point.latitude.toFixed(3)}, ${signal.point.longitude.toFixed(3)}`;
  }
  return "an unnamed place";
}

const FINISHED: LoadStatus[] = ["delivered", "ready_to_invoice", "invoiced", "paid", "cancelled"];
const RUNNING: LoadStatus[] = ["dispatched", "at_pickup", "loaded", "in_transit", "at_delivery"];

const isFinished = (status: LoadStatus) => FINISHED.includes(status);
const isRunning = (status: LoadStatus) => RUNNING.includes(status);

/**
 * When the truck is expected to come free.
 *
 * Before delivery this is the ETA (or the appointment, when there is no ETA)
 * plus an unloading allowance. Afterwards it is whichever moment the evidence
 * actually points at, and for a truck already believed empty it is now —
 * saying "empty in 90 minutes" about a truck sitting on a dock with its doors
 * shut is worse than saying nothing.
 */
function expectedEmpty(
  input: AvailabilityInput,
  state: AvailabilityState,
  now: Date,
): IsoDateTime | undefined {
  if (state === "unavailable") return undefined;
  if (state === "empty_confirmed" || state === "likely_available") {
    const at = input.workflow?.unloaded?.at
      ?? input.load?.deliveryDepartedAt
      ?? input.confirmation?.at
      ?? now.toISOString();
    return at;
  }

  const target = input.etaAt ?? input.load?.deliveryAppointmentAt;
  if (!target) return undefined;

  const allowance = input.unloadAllowanceMinutes ?? DEFAULT_UNLOAD_ALLOWANCE_MINUTES;
  const base = input.load?.deliveryArrivedAt
    // Already on site: the clock runs from arrival, not from an ETA it beat.
    ? Date.parse(input.load.deliveryArrivedAt)
    : Date.parse(target);
  if (Number.isNaN(base)) return undefined;
  return new Date(base + allowance * 60_000).toISOString();
}

function joinPhrases(parts: string[]): string {
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** True when the state is one the MT Loop board should carry an entry for. */
export function isPublishableAvailability(state: AvailabilityState): boolean {
  return state === "expected_available"
    || state === "likely_available"
    || state === "empty_confirmed";
}
