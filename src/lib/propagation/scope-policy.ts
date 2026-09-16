import type {
  DomainEvent, DomainEventKind, FactScope, MeterEquipmentKind,
  OperatingContextRefusalCode,
} from "@/types";
import {
  operatingContextAt, truckDispatchGrantAt,
} from "@/lib/api/mock/truck-registry";
import {
  trailerDispatchGrantAt, trailerOperatingContextAt,
} from "@/lib/api/mock/trailer-registry";
import type { MeterReadingRecordedPayload } from "./events";

/**
 * ★ THE ONE PLACE A FACT SCOPE IS DECIDED AND ENFORCED ★
 *
 * A `FactScope` says which organizations a fact belongs to. Before this module
 * existed, whoever published the event said so — every meter contributor passed
 * its own workspace id as the carrier — and one helper in the meter ledger let
 * any organization NAMED on a reading read the whole history back. Between the
 * two, a dispatch agency recording an odometer became the operating carrier of
 * somebody else's truck, in writing, and could then read everything about it.
 *
 * Two rules fix that, and they are the whole of this file:
 *
 *  1. ATTRIBUTION IS DERIVED, NEVER ASSERTED. For a fact about a piece of
 *     equipment, the organization is the carrier that the canonical truck or
 *     trailer registry says was operating it AT `occurredAt`. A caller may
 *     state what it believes; a statement that disagrees with the canonical
 *     records is refused before anything is stored or any projection runs.
 *
 *  2. A SCOPE FIELD IS NOT A GRANT. Nothing here hands out read access, and
 *     nothing downstream may read a fact because its scope happens to name the
 *     reader. Cross-organization reads stay refused; reading is decided by the
 *     canonical sharing grants the modules already own.
 *
 * ███ MOCK-ADJACENT — REAL RULE, MOCK RECORDS ███
 * The derivation runs against in-memory fixtures and the refusals are thrown in
 * the browser, so a caller that bypasses this module bypasses the rule. Only a
 * backend that runs the same derivation, server side, against records the
 * client cannot touch, makes any of this a security property. What this build
 * can honestly claim is that there is ONE rule and one place to change it.
 */

/* -------------------------------------------------------------------------- */
/* Refusal                                                                     */
/* -------------------------------------------------------------------------- */

export type ScopeRefusalCode =
  | OperatingContextRefusalCode
  | "missing_recording_organization"
  | "operating_authority_reserved"
  | "carrier_mismatch"
  | "attribution_mismatch"
  | "lease_mismatch"
  | "lease_wrong_equipment_kind"
  | "unauthorized_dispatch_workspace"
  | "subject_payload_mismatch"
  | "unknown_equipment_kind";

/**
 * What a refused publication throws.
 *
 * Carries the code and the canonical record ids so the refusal can be recorded
 * and shown as "these two records disagree", rather than as a failure nobody
 * can act on. Never a stack trace on screen.
 */
export class EventScopeRefusedError extends Error {
  constructor(
    readonly code: ScopeRefusalCode,
    message: string,
    readonly records: string[] = [],
  ) {
    super(message);
    this.name = "EventScopeRefusedError";
  }
}

/* -------------------------------------------------------------------------- */
/* The event-kind → canonical-grant matrix                                     */
/* -------------------------------------------------------------------------- */

/**
 * How each published event kind proves who it belongs to, and which EXISTING
 * canonical grant — named, never a category — lets a workspace other than that
 * organization publish one.
 *
 * Exhaustive by construction: `Record<DomainEventKind, …>` means a fourth event
 * kind cannot be added without deciding its entry, and there is deliberately no
 * default, no wildcard and no "any active relationship" fallback. A kind whose
 * rule nobody has written is a kind nobody can publish.
 */
export interface EventScopeRule {
  /**
   * `equipment_operating_context` — derived from the truck or trailer registry
   * at `occurredAt`, and validated against whatever the caller asserted.
   *
   * `publishing_module` — the owning module's own organization stands, because
   * the record it is published from is already single-organization. A6 does not
   * re-derive those; see the honesty note at the bottom of this file.
   */
  attribution: "equipment_operating_context" | "publishing_module";
  /**
   * The canonical grant types — named individually, never a category — that
   * authorize a workspace other than the attributed organization to publish
   * this kind. `null` where no canonical grant delegates it at all and a
   * cross-organization publication is simply refused.
   */
  crossOrganizationWrite: readonly ("TruckDispatchAccess" | "TrailerDispatchAccess")[] | null;
  /**
   * Which `FactScope` lease reference this kind may carry.
   * `by_equipment_kind` means the truck field for a truck and the trailer field
   * for a trailer — never both, and never the other one.
   */
  leaseReference: "by_equipment_kind" | "none";
  /** Why, in the words of the domain. Read by the matrix test. */
  note: string;
}

export const EVENT_SCOPE_MATRIX: Record<DomainEventKind, EventScopeRule> = {
  "load.finalized": {
    attribution: "publishing_module",
    crossOrganizationWrite: null,
    leaseReference: "none",
    note: "A load belongs to the workspace that booked and finalized it. No canonical grant lets one organization finalize another's load, and no lease reference applies to a load.",
  },
  "fuel_transaction.confirmed": {
    attribution: "publishing_module",
    crossOrganizationWrite: null,
    leaseReference: "none",
    note: "A fuel transaction belongs to the workspace whose card and receipt it is. `FuelSharingGrant` governs who may READ fuel across organizations and never who may confirm a transaction, so it is not a cross-organization write grant.",
  },
  "equipment_meter.reading_recorded": {
    attribution: "equipment_operating_context",
    crossOrganizationWrite: ["TruckDispatchAccess", "TrailerDispatchAccess"],
    leaseReference: "by_equipment_kind",
    note: "A meter reading belongs to the carrier operating the equipment when the meter was read. A dispatch workspace holding `TruckDispatchAccess` (trucks) or `TrailerDispatchAccess` (trailers) granted by that carrier may record one on its behalf without becoming it.",
  },
};

/**
 * The equipment-kind half of the meter rule.
 *
 * Split out because one `DomainEventKind` covers both a tractor's odometer and
 * a reefer's hour meter, and the two are proven from different canonical
 * registries with different grant types. Exhaustive over `MeterEquipmentKind`
 * for the same reason the matrix above is exhaustive over event kinds.
 */
const METER_EQUIPMENT_RULES: Record<MeterEquipmentKind, {
  contextAt: (equipmentId: string, instant: string) => ReturnType<typeof operatingContextAt>
    | ReturnType<typeof trailerOperatingContextAt>;
  dispatchGrantAt: (equipmentId: string, dispatchOrganizationId: string, instant: string) => { id: string; grantedByCarrierOrganizationId: string } | undefined;
  grantType: "TruckDispatchAccess" | "TrailerDispatchAccess";
  /** The `FactScope` field this kind's lease id belongs in. */
  leaseField: "truckOperatingLeaseId" | "trailerOperatingLeaseId";
  /** The field it must never appear in. */
  foreignLeaseField: "truckOperatingLeaseId" | "trailerOperatingLeaseId";
}> = {
  truck: {
    contextAt: operatingContextAt,
    dispatchGrantAt: truckDispatchGrantAt,
    grantType: "TruckDispatchAccess",
    leaseField: "truckOperatingLeaseId",
    foreignLeaseField: "trailerOperatingLeaseId",
  },
  trailer: {
    contextAt: trailerOperatingContextAt,
    dispatchGrantAt: trailerDispatchGrantAt,
    grantType: "TrailerDispatchAccess",
    leaseField: "trailerOperatingLeaseId",
    foreignLeaseField: "truckOperatingLeaseId",
  },
};

/* -------------------------------------------------------------------------- */
/* Deriving a meter scope                                                      */
/* -------------------------------------------------------------------------- */

export interface MeterScopeInput {
  equipmentKind: MeterEquipmentKind;
  equipmentId: string;
  /** When the meter was READ. Not when the receipt was typed in. */
  occurredAt: string;
  /**
   * What the contributor believes. `organizationId` is the workspace doing the
   * recording; everything else is an assertion that has to survive checking.
   */
  asserted: FactScope;
}

/**
 * The canonical scope for one meter reading, or a refusal.
 *
 * The recording workspace keeps its place in the record — as
 * `dispatchOrganizationId` when it is a dispatch agency acting under a grant —
 * but the fact is attributed to the carrier that was operating the equipment.
 * That is the difference between "Meridian recorded this" and "this is
 * Meridian's truck", and the second one was never true.
 */
export function meterFactScopeAt(input: MeterScopeInput): FactScope {
  const rule = METER_EQUIPMENT_RULES[input.equipmentKind];
  if (!rule) {
    throw new EventScopeRefusedError(
      "unknown_equipment_kind",
      `"${input.equipmentKind}" is not a kind of equipment this build keeps meters for.`,
      [input.equipmentId],
    );
  }

  const recording = input.asserted.organizationId;
  if (!recording) {
    throw new EventScopeRefusedError(
      "missing_recording_organization",
      "A meter reading has to say which workspace recorded it.",
      [input.equipmentId],
    );
  }

  // Reserved, and refused rather than dropped: silently ignoring a field the
  // caller filled in is how a caller comes to believe it means something.
  if (input.asserted.operatingAuthorityId) {
    throw new EventScopeRefusedError(
      "operating_authority_reserved",
      "`operatingAuthorityId` is reserved: Antcolos has no canonical Operating Authority record, so nothing can supply or check one. The operating lease reference is what proves authority for an interval.",
      [input.equipmentId],
    );
  }

  const context = rule.contextAt(input.equipmentId, input.occurredAt);
  if (!context.resolved) {
    throw new EventScopeRefusedError(context.code, context.reason, context.records);
  }

  const carrier = context.operatingCarrierOrganizationId;

  if (input.asserted.carrierOrganizationId && input.asserted.carrierOrganizationId !== carrier) {
    throw new EventScopeRefusedError(
      "carrier_mismatch",
      `This reading was recorded as belonging to ${input.asserted.carrierOrganizationId}, but the canonical records say ${carrier} was operating this ${input.equipmentKind} when the meter was read.`,
      [input.equipmentId, context.relationship.id],
    );
  }

  // The lease id is pinned from the derivation, never from the caller, and only
  // in the field for this equipment kind. A lease id in the other kind's field
  // is refused outright rather than moved: it means the caller does not know
  // what it is publishing.
  const derivedLeaseId = context.basis === "operating_lease" ? context.lease?.id : undefined;
  const assertedLeaseId = input.asserted[rule.leaseField];
  if (assertedLeaseId && assertedLeaseId !== derivedLeaseId) {
    throw new EventScopeRefusedError(
      "lease_mismatch",
      derivedLeaseId
        ? `This reading names operating lease ${assertedLeaseId}, but ${derivedLeaseId} was the lease covering the moment it was read.`
        : `This reading names operating lease ${assertedLeaseId}, and no operating lease covered the moment it was read.`,
      [input.equipmentId, assertedLeaseId],
    );
  }
  if (input.asserted[rule.foreignLeaseField]) {
    throw new EventScopeRefusedError(
      "lease_wrong_equipment_kind",
      `A ${input.equipmentKind} reading cannot carry a ${rule.foreignLeaseField === "truckOperatingLeaseId" ? "truck" : "trailer"} operating lease id.`,
      [input.equipmentId, input.asserted[rule.foreignLeaseField]!],
    );
  }

  /* Who may record it ----------------------------------------------------- */

  let dispatchOrganizationId: string | undefined;
  const claimedDispatch = input.asserted.dispatchOrganizationId;
  const actingAsDispatch = recording !== carrier;

  if (actingAsDispatch || claimedDispatch) {
    const workspace = actingAsDispatch ? recording : claimedDispatch!;
    if (claimedDispatch && claimedDispatch !== workspace) {
      throw new EventScopeRefusedError(
        "unauthorized_dispatch_workspace",
        `A reading recorded by ${recording} cannot name ${claimedDispatch} as the dispatch workspace.`,
        [input.equipmentId, claimedDispatch],
      );
    }
    const grant = rule.dispatchGrantAt(input.equipmentId, workspace, input.occurredAt);
    if (!grant || grant.grantedByCarrierOrganizationId !== carrier) {
      throw new EventScopeRefusedError(
        "unauthorized_dispatch_workspace",
        `${workspace} held no ${rule.grantType} from ${carrier} on this ${input.equipmentKind} when the meter was read, so it cannot record a reading against it.`,
        [input.equipmentId, workspace],
      );
    }
    dispatchOrganizationId = workspace;
  }

  return {
    organizationId: carrier,
    carrierOrganizationId: carrier,
    ...(dispatchOrganizationId ? { dispatchOrganizationId } : {}),
    ...(derivedLeaseId ? { [rule.leaseField]: derivedLeaseId } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* The publication guard                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Checked on the way into the bus, for every kind, before the event is stored
 * and before any subscriber is offered it.
 *
 * Deliberately independent of the derivation above rather than trusting it: a
 * publisher that builds its own scope by hand, or a future one that forgets the
 * door, is caught here instead of writing a wrong attribution into the log that
 * every projection then reads.
 */
export function assertPublishableScope(event: DomainEvent): void {
  const rule = EVENT_SCOPE_MATRIX[event.kind];
  if (!rule) {
    throw new EventScopeRefusedError(
      "attribution_mismatch",
      `No scope rule is defined for ${event.kind}, so it cannot be published.`,
      [event.eventId],
    );
  }

  if (event.scope.operatingAuthorityId) {
    throw new EventScopeRefusedError(
      "operating_authority_reserved",
      "`operatingAuthorityId` is reserved and cannot be supplied on a published event.",
      [event.eventId],
    );
  }

  if (rule.attribution === "publishing_module") {
    // Nothing in this build can re-derive a load's or a fuel transaction's
    // organization from a second canonical record, so the honest enforcement is
    // the narrow one: these kinds carry no equipment lease reference, because
    // an operating lease is not a fact about either of them.
    if (event.scope.truckOperatingLeaseId || event.scope.trailerOperatingLeaseId) {
      throw new EventScopeRefusedError(
        "lease_wrong_equipment_kind",
        `A ${event.kind} event cannot carry an equipment operating lease id.`,
        [event.eventId],
      );
    }
    return;
  }

  /* Meter events: re-derive and compare ----------------------------------- */

  const kind = event.subjectKind as MeterEquipmentKind;
  if (!METER_EQUIPMENT_RULES[kind]) {
    throw new EventScopeRefusedError(
      "unknown_equipment_kind",
      `A meter event has to be about a truck or a trailer, and this one is about "${event.subjectKind}".`,
      [event.eventId],
    );
  }

  // The subject and the payload have to be talking about the same piece of
  // equipment. They are two statements of one fact, and a derivation done
  // against one while a projection reads the other is a hole.
  const payload = event.payload as Partial<MeterReadingRecordedPayload> | undefined;
  if (
    payload?.equipmentId !== event.subjectId
    || (payload?.equipmentKind !== undefined && payload.equipmentKind !== kind)
  ) {
    throw new EventScopeRefusedError(
      "subject_payload_mismatch",
      "The equipment this meter event is about and the equipment in its payload are not the same.",
      [event.eventId, event.subjectId, String(payload?.equipmentId)],
    );
  }

  const canonical = meterFactScopeAt({
    equipmentKind: kind,
    equipmentId: event.subjectId,
    occurredAt: event.occurredAt,
    asserted: event.scope,
  });

  if (event.scope.organizationId !== canonical.organizationId) {
    throw new EventScopeRefusedError(
      "attribution_mismatch",
      `This meter event is attributed to ${event.scope.organizationId}, but ${canonical.organizationId} was operating the equipment when the meter was read.`,
      [event.eventId, event.subjectId],
    );
  }
  if (event.scope.carrierOrganizationId !== canonical.carrierOrganizationId) {
    throw new EventScopeRefusedError(
      "carrier_mismatch",
      "A meter event has to name the carrier that was operating the equipment when the meter was read.",
      [event.eventId, event.subjectId],
    );
  }
  if ((event.scope.truckOperatingLeaseId ?? undefined) !== (canonical.truckOperatingLeaseId ?? undefined)
    || (event.scope.trailerOperatingLeaseId ?? undefined) !== (canonical.trailerOperatingLeaseId ?? undefined)) {
    throw new EventScopeRefusedError(
      "lease_mismatch",
      "The operating lease on this meter event is not the one that covered the moment the meter was read.",
      [event.eventId, event.subjectId],
    );
  }
  if ((event.scope.dispatchOrganizationId ?? undefined) !== (canonical.dispatchOrganizationId ?? undefined)) {
    throw new EventScopeRefusedError(
      "unauthorized_dispatch_workspace",
      "The dispatch workspace on this meter event is not one the operating carrier had granted access to.",
      [event.eventId, event.subjectId],
    );
  }
}

/**
 * ███ WHAT THIS DOES NOT DO ███
 *
 *  - It does not authorize READING. No function here is consulted to decide who
 *    may see an event, and nothing downstream may treat a scope field as a
 *    reason to show one. Cross-organization reads of meter events stay refused.
 *  - It does not re-derive `load.finalized` or `fuel_transaction.confirmed`
 *    attribution. Those are published from single-organization records, and
 *    inventing a second derivation for them here would be exactly the second
 *    source of truth this layer exists to prevent. What it enforces for them is
 *    what it can prove: no reserved authority id, no equipment lease id.
 *  - It does not write an audit line when it refuses. The refusal is thrown to
 *    the caller, with its code and the canonical record ids, and the calling
 *    service decides what to do with it. Recording refusals in the one audit
 *    ledger means calling the existing `recordCrossOrganizationAttempt`, which
 *    takes a `ServiceContext` — and the meter door is reached with an `ActorRef`
 *    and a recording organization id, not a context. Wiring one through every
 *    contributor is a change of its own; doing it at only the two publishers
 *    that happen to hold a context would produce a refusal log that looks
 *    complete and is not, which is worse than none.
 *  - It does not touch what was already published. A lease ending, a
 *    relationship being suspended or a truck changing hands leaves every
 *    existing event exactly as it was, with the lease id it was published with.
 */
