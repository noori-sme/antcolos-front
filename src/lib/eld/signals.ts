import type {
  ComplianceAlertSignal, EldPublishedSignal, FleetLocationSignal, FuelJurisdictionSignal,
  HosAvailabilitySignal, MaintenanceDiagnosticSignal, MaintenanceMeterSignal, MtLoopEtaSignal,
  Provenance, TelemetryAttribution, TelemetryEvent, TelemetryLocationValue, TripInferenceSignal,
} from "@/types";

/**
 * ★ WHAT THIS LAYER HANDS TO THE MODULES THAT ALREADY EXIST ★
 *
 * Fleet, the Trip Workflow, MT Loop, HOS, Maintenance, Fuel/IFTA and Safety &
 * Compliance are all built, all own their own records, and none of them is
 * imported by this file. That is not an accident of layering — it is the
 * contract. This module PUBLISHES typed, addressed, idempotent records and
 * stops. It does not write a fleet status, it does not close a trip milestone,
 * it does not move an odometer on a maintenance requirement and it does not
 * raise a compliance violation.
 *
 * Read the payloads with that in mind and the wording makes sense:
 *
 *   `trip.arrival_departure_inferred` carries `suggests`, never `happened`, and
 *   a `rationale` a driver will read before being asked to confirm it. Nothing
 *   in the type can express "the driver arrived", so nothing downstream can be
 *   handed that claim by accident.
 *
 *   `mt_loop.eta_updated` carries `etaBasis: "not_computed"` and no ETA.
 *   Routing is not built here. An ETA invented from a straight line would be
 *   worse than no ETA, because somebody would plan against it.
 *
 *   `fuel.jurisdiction_mileage_observed` carries `filingGrade: false`. A
 *   position that fell in Indiana is an observation. An IFTA return is a
 *   calculation the Fuel module makes from its own records, and this module is
 *   not entitled to an opinion about it.
 *
 *   `hos.availability_reported` carries `isFullLog: false`. It is a summary of
 *   a clock. It is not a record of duty status, it cannot be certified, edited
 *   or filed, and full HOS logs are a later module.
 *
 * Every signal is `pending_integration`. Nothing here transmits anything to
 * anywhere, and `stateReason` says so in words, on every single record.
 */

const PENDING_REASON =
  "Recorded for the receiving module to collect. Nothing has been transmitted, and this "
  + "module cannot write to that module's records.";

let sequence = 0;

/** Test hook. The publisher is otherwise stateless. */
export function resetSignalSequence() {
  sequence = 0;
}

function signalId(target: string): string {
  sequence += 1;
  return `sig_${target}_${sequence.toString(36)}`;
}

/**
 * Provenance for a published signal.
 *
 * Carried through from the event rather than minted fresh, so the receiving
 * module sees when the PROVIDER observed the fact — not when this module got
 * round to publishing a record about it.
 */
function provenanceFor(event: TelemetryEvent): Provenance {
  return {
    ...event.provenance,
    observedAt: event.sourceAt,
    receivedAt: event.receivedAt,
    confidence: event.confidence,
  };
}

function base<T extends EldPublishedSignal["target"]>(
  target: T,
  operation: string,
  event: TelemetryEvent,
  extra: { events?: readonly string[]; confidence?: number; quality?: TelemetryEvent["quality"] } = {},
) {
  const sourceEventIds = extra.events ?? [event.id];
  return {
    id: signalId(target),
    organizationId: event.organizationId,
    target,
    operation,
    // Deterministic: replaying the same events republishes the same signal
    // rather than a second one. The receiving module can therefore be handed
    // the whole backlog twice without double-counting anything.
    idempotencyKey: `${operation}:${sourceEventIds.join("+")}`,
    sourceEventIds,
    attribution: event.attribution,
    quality: extra.quality ?? event.quality,
    confidence: extra.confidence ?? event.confidence,
    provenance: provenanceFor(event),
    publishedAt: new Date().toISOString(),
    state: "pending_integration" as const,
    stateReason: PENDING_REASON,
  };
}

/* -------------------------------------------------------------------------- */
/* Per-event publishing                                                        */
/* -------------------------------------------------------------------------- */

export interface PublishContext {
  /** True when the caller may publish the driver's clock onward. */
  includeHos: boolean;
  /**
   * The most recent motion state known for this device BEFORE this event, so a
   * change can be spotted. Absent means "we do not know", and no inference is
   * drawn from a state we never had.
   */
  previousMotion?: boolean;
  /** The last accepted position, for the jurisdiction and inference signals. */
  previousLocation?: TelemetryLocationValue;
}

/**
 * Everything one accepted event has to say to the rest of Antcolos.
 *
 * Only `accepted` events get here. A flagged or rejected row is readable on the
 * device screen and publishes nothing — handing another module a signal the
 * pipeline itself distrusted is how a bad row becomes a maintenance ticket.
 */
export function publishFor(
  event: TelemetryEvent,
  context: PublishContext,
): EldPublishedSignal[] {
  if (event.ingestion !== "accepted") return [];
  const truckId = event.attribution.truckId;
  const out: EldPublishedSignal[] = [];

  switch (event.value.kind) {
    case "location": {
      if (!truckId) break;
      const location = event.value;
      const fleet: FleetLocationSignal = {
        ...base("fleet", "fleet.location_availability", event),
        target: "fleet",
        operation: "fleet.location_availability",
        payload: { truckId, location, observedAt: event.sourceAt },
      };
      out.push(fleet);

      const eta: MtLoopEtaSignal = {
        ...base("mt_loop", "mt_loop.eta_updated", event),
        target: "mt_loop",
        operation: "mt_loop.eta_updated",
        payload: {
          truckId,
          loadId: event.attribution.loadId,
          location,
          observedAt: event.sourceAt,
          etaBasis: "not_computed",
        },
      };
      out.push(eta);

      if (location.state) {
        const fuel: FuelJurisdictionSignal = {
          ...base("fuel_ifta", "fuel.jurisdiction_mileage_observed", event),
          target: "fuel_ifta",
          operation: "fuel.jurisdiction_mileage_observed",
          payload: {
            truckId,
            jurisdiction: location.state,
            observedAt: event.sourceAt,
            filingGrade: false,
          },
        };
        out.push(fuel);
      }
      break;
    }

    case "speed": {
      if (!truckId) break;
      const fleet: FleetLocationSignal = {
        ...base("fleet", "fleet.location_availability", event),
        target: "fleet",
        operation: "fleet.location_availability",
        payload: { truckId, speedMph: event.value.milesPerHour, observedAt: event.sourceAt },
      };
      out.push(fleet);
      break;
    }

    case "ignition": {
      if (!truckId) break;
      const fleet: FleetLocationSignal = {
        ...base("fleet", "fleet.location_availability", event),
        target: "fleet",
        operation: "fleet.location_availability",
        payload: { truckId, ignitionOn: event.value.on, observedAt: event.sourceAt },
      };
      out.push(fleet);
      break;
    }

    case "motion": {
      if (!truckId) break;
      const moving = event.value.moving;
      const fleet: FleetLocationSignal = {
        ...base("fleet", "fleet.location_availability", event),
        target: "fleet",
        operation: "fleet.location_availability",
        payload: { truckId, moving, observedAt: event.sourceAt },
      };
      out.push(fleet);

      // An inference is drawn ONLY from a change we actually watched happen.
      // Publishing "arrived" because the first signal we ever saw was
      // stationary would mean a truck parked overnight arrives every morning
      // the moment a device is bound to it.
      if (context.previousMotion != null && context.previousMotion !== moving) {
        out.push(inference(event, moving ? "departure" : "arrival", context));
      }
      break;
    }

    case "odometer": {
      if (!truckId) break;
      const meter: MaintenanceMeterSignal = {
        ...base("maintenance", "maintenance.meter_reported", event),
        target: "maintenance",
        operation: "maintenance.meter_reported",
        payload: { truckId, odometerMiles: event.value.miles, observedAt: event.sourceAt },
      };
      out.push(meter);

      const fuel: FuelJurisdictionSignal = {
        ...base("fuel_ifta", "fuel.jurisdiction_mileage_observed", event),
        target: "fuel_ifta",
        operation: "fuel.jurisdiction_mileage_observed",
        payload: {
          truckId,
          jurisdiction: context.previousLocation?.state,
          odometerMiles: event.value.miles,
          observedAt: event.sourceAt,
          filingGrade: false,
        },
      };
      out.push(fuel);
      break;
    }

    case "engine_hours": {
      if (!truckId) break;
      const meter: MaintenanceMeterSignal = {
        ...base("maintenance", "maintenance.meter_reported", event),
        target: "maintenance",
        operation: "maintenance.meter_reported",
        payload: { truckId, engineHours: event.value.hours, observedAt: event.sourceAt },
      };
      out.push(meter);
      break;
    }

    case "diagnostic": {
      if (!truckId) break;
      const diagnostic = event.value;
      const signal: MaintenanceDiagnosticSignal = {
        ...base("maintenance", "maintenance.diagnostic_reported", event),
        target: "maintenance",
        operation: "maintenance.diagnostic_reported",
        payload: { truckId, diagnostic, observedAt: event.sourceAt, interpretation: "none" },
      };
      out.push(signal);

      if (diagnostic.severity === "critical" && diagnostic.active) {
        const alert: ComplianceAlertSignal = {
          ...base("compliance", "compliance.telematics_alert", event),
          target: "compliance",
          operation: "compliance.telematics_alert",
          payload: {
            truckId,
            alert: "critical_diagnostic",
            observedAt: event.sourceAt,
            detail:
              `${event.attribution.truckUnitSnapshot ?? "The equipment"} is reporting `
              + `${diagnostic.code}${diagnostic.description ? ` — ${diagnostic.description}` : ""}, `
              + "which the provider marked critical. Antcolos does not interpret fault codes.",
          },
        };
        out.push(alert);
      }
      break;
    }

    case "hos_summary": {
      const driverProfileId = event.attribution.driverProfileId;
      // A clock with nobody attached to it is not published. There is no such
      // thing as anonymous hours of service, and guessing at today's driver
      // would attribute somebody's duty time to the wrong person.
      if (!driverProfileId || !context.includeHos) break;
      const hos: HosAvailabilitySignal = {
        ...base("hos", "hos.availability_reported", event),
        target: "hos",
        operation: "hos.availability_reported",
        payload: {
          driverProfileId,
          truckId,
          summary: event.value,
          observedAt: event.sourceAt,
          isFullLog: false,
        },
      };
      out.push(hos);
      break;
    }

    default:
      break;
  }

  // An event produced while the carrier's authority was not active is still
  // recorded and still published — and Compliance is told, because a truck
  // moving under inactive authority is exactly what that module is for.
  const authority = event.attribution.operatingAuthorityStatus;
  if (authority && authority !== "active" && event.kind === "motion" && event.value.kind === "motion"
    && event.value.moving) {
    const alert: ComplianceAlertSignal = {
      ...base("compliance", "compliance.telematics_alert", event),
      target: "compliance",
      operation: "compliance.telematics_alert",
      payload: {
        truckId,
        driverProfileId: event.attribution.driverProfileId,
        alert: "authority_inactive_at_event",
        observedAt: event.sourceAt,
        detail:
          `Movement was observed while the carrier's operating authority was recorded as `
          + `"${authority}". Recorded as observed; Compliance decides what it means.`,
      },
    };
    out.push(alert);
  }

  return out;
}

/**
 * A movement change, offered to the Trip Workflow as a suggestion.
 *
 * Confidence is deliberately modest and the rationale is deliberately plain.
 * The Trip Workflow shows this to a person and asks; it never turns it into a
 * milestone on its own, and this module has no way to make it.
 */
function inference(
  event: TelemetryEvent,
  suggests: "arrival" | "departure",
  context: PublishContext,
): TripInferenceSignal {
  const where = context.previousLocation;
  const place = where?.city
    ? `${where.city}${where.state ? `, ${where.state}` : ""}`
    : "its last reported position";
  return {
    ...base("trip_workflow", "trip.arrival_departure_inferred", event, {
      // An inference is never the provider's claim and never a person's. It is
      // this module's reading of two signals, and it says so.
      quality: "inferred",
      confidence: Math.min(event.confidence, 0.6),
    }),
    target: "trip_workflow",
    operation: "trip.arrival_departure_inferred",
    payload: {
      truckId: event.attribution.truckId!,
      loadId: event.attribution.loadId,
      suggests,
      observedAt: event.sourceAt,
      location: where,
      rationale: suggests === "arrival"
        ? `The truck stopped moving near ${place}. Nobody has confirmed an arrival.`
        : `The truck started moving from ${place}. Nobody has confirmed a departure.`,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Connection-level alerts                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Alerts that are about the ABSENCE of data rather than about an event.
 *
 * Built separately because there is no event to hang them on — which is the
 * whole point of them. A device that stopped reporting produces nothing, and a
 * module that only ever reacts to incoming events would never notice.
 */
export function connectionAlert(input: {
  organizationId: string;
  truckId?: string;
  alert: "device_disconnected" | "data_stale";
  detail: string;
  observedAt: string;
  attribution: TelemetryAttribution;
  provenance: Provenance;
}): ComplianceAlertSignal {
  const operation = "compliance.telematics_alert";
  return {
    id: signalId("compliance"),
    organizationId: input.organizationId,
    target: "compliance",
    operation,
    idempotencyKey: `${operation}:${input.alert}:${input.truckId ?? "unbound"}:${input.observedAt}`,
    // No event produced this, and the type will not let us pretend one did.
    sourceEventIds: [],
    attribution: input.attribution,
    quality: "inferred",
    confidence: 0.5,
    provenance: input.provenance,
    publishedAt: new Date().toISOString(),
    state: "pending_integration",
    stateReason: PENDING_REASON,
    payload: {
      truckId: input.truckId,
      alert: input.alert,
      observedAt: input.observedAt,
      detail: input.detail,
    },
  };
}
