import type {
  DomainEvent, DomainEventKind, FactScope, MeterEquipmentKind,
  OperatingContextRefusalCode,
} from "@/types";
import { operatingContextAt, organizationNameFor } from "@/lib/api/mock/truck-registry";
import { trailerOperatingContextAt } from "@/lib/api/mock/trailer-registry";
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
  | "not_the_operating_carrier"
  | "write_authority_ended"
  | "dispatch_write_not_authorized"
  | "empty_carrier_organization"
  | "carrier_mismatch"
  | "attribution_mismatch"
  | "lease_mismatch"
  | "lease_wrong_equipment_kind"
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
   * the record it is published from is already single-organization and the
   * service that publishes it has already proved ownership. A6 does not
   * re-derive those; see the honesty note at the bottom of this file.
   */
  attribution: "equipment_operating_context" | "publishing_module";
  /**
   * The named canonical grant that lets a workspace OTHER than the attributed
   * organization publish this kind. `null` on all three kinds today, and the
   * `writeRule` below says what is actually required instead.
   *
   * It is `null` for meter events because no canonical record in this
   * repository grants one organization the right to write another's meter
   * history. `TruckDispatchAccess` and `TrailerDispatchAccess` are visibility:
   * `accessReason` calls itself "why this organization can SEE this truck",
   * the truck profile renders a dispatch viewer read-only, and maintenance
   * already refuses a dispatch workspace the operator actions. A workspace
   * permission plus being able to see the equipment is not the operating
   * carrier's consent to write its meters.
   */
  crossOrganizationWrite: readonly ("TruckDispatchAccess" | "TrailerDispatchAccess")[] | null;
  /** What is actually enforced on the way in, in one sentence. */
  writeRule: string;
  /** What is actually enforced on the way out, in one sentence. */
  readRule: string;
  /** Which `FactScope` lease reference this kind may carry. */
  leaseReference: "by_equipment_kind" | "none";
}

/**
 * How each published event kind proves who it belongs to, who may publish one,
 * and who may read one back.
 *
 * Exhaustive by construction: `Record<DomainEventKind, …>` means a fourth event
 * kind cannot be added without deciding its entry, and there is deliberately no
 * default, no wildcard and no "any active relationship" fallback. A kind whose
 * rule nobody has written is a kind nobody can publish.
 *
 * ★ `readRule` IS DESCRIPTIVE, NOT A SWITCH ★
 * Nothing consults this table to decide a read. Reads are decided in one place
 * — `events()`, `event()` and `projections()` filter on `scope.organizationId`
 * and on nothing else — and the column exists so that the write rule and the
 * read rule can be compared at a glance and seen to be different questions.
 * Naming a grant in `crossOrganizationWrite` could never widen a read.
 */
export const EVENT_SCOPE_MATRIX: Record<DomainEventKind, EventScopeRule> = {
  "load.finalized": {
    attribution: "publishing_module",
    crossOrganizationWrite: null,
    writeRule: "The loads service proves the load belongs to the caller's organization before publishing, and the event's organization is the caller's own. No canonical grant lets one organization finalize another's load.",
    readRule: "The finalizing organization only. No grant widens it.",
    leaseReference: "none",
  },
  "fuel_transaction.confirmed": {
    attribution: "publishing_module",
    crossOrganizationWrite: null,
    writeRule: "The fuel service proves the transaction is the caller's own ledger before publishing. `FuelSharingGrant` governs who may READ fuel across organizations and never who may confirm a transaction, so it is not a write grant.",
    readRule: "The owning ledger's organization only. `FuelSharingGrant` shares fuel RECORDS through the fuel service; it does not share bus events.",
    leaseReference: "none",
  },
  "equipment_meter.reading_recorded": {
    attribution: "equipment_operating_context",
    crossOrganizationWrite: null,
    writeRule: "Only the carrier operating the equipment may publish, and it must be the operating carrier BOTH at `occurredAt` (attribution) and at the moment of the write (authority). A dispatch workspace is refused outright until a carrier-controlled meter-write grant exists.",
    readRule: "The operating carrier only. Being named as the dispatch workspace or the carrier on a fact has never been a reason to be shown it.",
    leaseReference: "by_equipment_kind",
  },
};

/**
 * The equipment-kind half of the meter rule.
 *
 * Split out because one `DomainEventKind` covers both a tractor's odometer and
 * a reefer's hour meter, and the two are proven from different canonical
 * registries. Exhaustive over `MeterEquipmentKind` for the same reason the
 * matrix above is exhaustive over event kinds.
 */
const METER_EQUIPMENT_RULES: Record<MeterEquipmentKind, {
  contextAt: (equipmentId: string, instant: string) => ReturnType<typeof operatingContextAt>
    | ReturnType<typeof trailerOperatingContextAt>;
  /** The `FactScope` field this kind's lease id belongs in. */
  leaseField: "truckOperatingLeaseId" | "trailerOperatingLeaseId";
  /** The field it must never appear in. */
  foreignLeaseField: "truckOperatingLeaseId" | "trailerOperatingLeaseId";
}> = {
  truck: {
    contextAt: operatingContextAt,
    leaseField: "truckOperatingLeaseId",
    foreignLeaseField: "trailerOperatingLeaseId",
  },
  trailer: {
    contextAt: trailerOperatingContextAt,
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
  const refusal = meterPublicationRefusal(input);
  if (refusal) throw refusal;
  return meterScope(input)!;
}

/**
 * The same rule, asked rather than enforced.
 *
 * A command that writes its own record BEFORE contributing a reading — fleet
 * telemetry, a fuel purchase, a jurisdiction leg — asks this first, so a
 * refusal happens before the write instead of leaving a telemetry row or a
 * fuel receipt behind with no meter reading and an exception on the way out.
 * Pure: it reads the registries and writes nothing.
 */
export function meterPublicationRefusal(
  input: MeterScopeInput,
): EventScopeRefusedError | null {
  const rule = METER_EQUIPMENT_RULES[input.equipmentKind];
  if (!rule) {
    return new EventScopeRefusedError(
      "unknown_equipment_kind",
      `"${input.equipmentKind}" is not a kind of equipment this build keeps meters for.`,
      [input.equipmentId],
    );
  }

  const recording = input.asserted.organizationId;
  if (!recording) {
    return new EventScopeRefusedError(
      "missing_recording_organization",
      "A meter reading has to say which workspace recorded it.",
      [input.equipmentId],
    );
  }

  // Reserved, and refused rather than dropped: silently ignoring a field the
  // caller filled in is how a caller comes to believe it means something.
  if (input.asserted.operatingAuthorityId) {
    return new EventScopeRefusedError(
      "operating_authority_reserved",
      "`operatingAuthorityId` is reserved: Antcolos has no canonical Operating Authority record, so nothing can supply or check one. The operating lease reference is what proves authority for an interval.",
      [input.equipmentId],
    );
  }

  /* ---- 1. ATTRIBUTION: who was operating it when the meter was read ----- */

  const context = rule.contextAt(input.equipmentId, input.occurredAt);
  if (!context.resolved) {
    return new EventScopeRefusedError(context.code, context.reason, context.records);
  }
  const carrier = context.operatingCarrierOrganizationId;

  if (input.asserted.carrierOrganizationId && input.asserted.carrierOrganizationId !== carrier) {
    return new EventScopeRefusedError(
      "carrier_mismatch",
      `This reading was recorded as belonging to ${organizationNameFor(input.asserted.carrierOrganizationId)}, but the canonical records say ${organizationNameFor(carrier)} was operating this ${input.equipmentKind} when the meter was read.`,
      [input.equipmentId, context.relationship.id],
    );
  }

  /* ---- 2. WHO MAY WRITE IT: the operating carrier, and nobody else ------ */

  /*
   * ★ FAIL CLOSED ON CROSS-ORGANIZATION METER WRITES ★
   *
   * A dispatch workspace can see a truck it dispatches, and a dispatcher's
   * seeded template carries `fleet:telemetry:record`. Neither of those is the
   * operating carrier's consent to write its meter history, and this build has
   * no record that is: `TruckDispatchAccess` and `TrailerDispatchAccess` carry
   * no scope of authority at all, `accessReason` describes itself as why an
   * organization can SEE a truck, the truck profile renders a dispatch viewer
   * read-only, and maintenance already refuses a dispatch workspace every
   * operator action including this one.
   *
   * So the answer here is no, until a carrier-controlled meter-write grant
   * exists to say otherwise. Reading it any other way would let a workspace
   * write into another company's permanent equipment history on the strength
   * of a permission that company never granted.
   */
  if (recording !== carrier) {
    return new EventScopeRefusedError(
      "not_the_operating_carrier",
      `${organizationNameFor(recording)} was not operating this ${input.equipmentKind} when the meter was read — ${organizationNameFor(carrier)} was. Dispatch access lets a workspace see equipment and move freight on it; it is not the carrier's permission to write its meter history, and nothing in Antcolos grants that today.`,
      [input.equipmentId, context.relationship.id],
    );
  }

  /*
   * ★ AUTHORITY IS CHECKED AT THE MOMENT OF THE WRITE, NOT ONLY AT occurredAt ★
   *
   * A backdated reading is attributed to whoever was operating the equipment
   * that day — that is what makes a receipt found three weeks later land in
   * the right place. It is NOT a way to keep writing into a history after the
   * relationship or lease that gave the right to write it has ended. So the
   * writer must still hold operating authority now, as well as then.
   */
  const dispatchClaim = input.asserted.dispatchOrganizationId;
  if (dispatchClaim) {
    return new EventScopeRefusedError(
      "dispatch_write_not_authorized",
      `A meter reading cannot name ${organizationNameFor(dispatchClaim)} as a dispatch workspace: nothing in Antcolos lets a dispatch workspace take part in writing another carrier's meter history.`,
      [input.equipmentId, dispatchClaim],
    );
  }

  const nowContext = rule.contextAt(input.equipmentId, new Date().toISOString());
  if (!nowContext.resolved || nowContext.operatingCarrierOrganizationId !== carrier) {
    return new EventScopeRefusedError(
      "write_authority_ended",
      `${organizationNameFor(recording)} no longer operates this ${input.equipmentKind}, so it cannot add to its meter history now — not even about a moment when it did. What was already recorded stays exactly as it was.`,
      [input.equipmentId],
    );
  }

  /* ---- 3. The lease reference, pinned from the derivation --------------- */

  const derivedLeaseId = context.basis === "operating_lease" ? context.lease?.id : undefined;
  const assertedLeaseId = input.asserted[rule.leaseField];
  if (assertedLeaseId && assertedLeaseId !== derivedLeaseId) {
    return new EventScopeRefusedError(
      "lease_mismatch",
      derivedLeaseId
        ? `This reading names operating lease ${assertedLeaseId}, but ${derivedLeaseId} was the lease covering the moment it was read.`
        : `This reading names operating lease ${assertedLeaseId}, and no operating lease covered the moment it was read.`,
      [input.equipmentId, assertedLeaseId],
    );
  }
  if (input.asserted[rule.foreignLeaseField]) {
    return new EventScopeRefusedError(
      "lease_wrong_equipment_kind",
      `A ${input.equipmentKind} reading cannot carry a ${rule.foreignLeaseField === "truckOperatingLeaseId" ? "truck" : "trailer"} operating lease id.`,
      [input.equipmentId, input.asserted[rule.foreignLeaseField]!],
    );
  }

  return null;
}

/**
 * The scope itself, once the rule above has said yes.
 *
 * Returns `undefined` rather than throwing when the context cannot be resolved,
 * so it is never called except behind a refusal check.
 */
function meterScope(input: MeterScopeInput): FactScope | undefined {
  const rule = METER_EQUIPMENT_RULES[input.equipmentKind];
  const context = rule.contextAt(input.equipmentId, input.occurredAt);
  if (!context.resolved) return undefined;
  const carrier = context.operatingCarrierOrganizationId;
  const leaseId = context.basis === "operating_lease" ? context.lease?.id : undefined;
  return {
    organizationId: carrier,
    carrierOrganizationId: carrier,
    ...(leaseId ? { [rule.leaseField]: leaseId } : {}),
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
    /*
     * A carrier field that is PRESENT AND EMPTY is the one thing this layer can
     * prove wrong about these kinds without re-deriving them.
     *
     * Fuel resolves attribution at record time through `resolveAttribution`,
     * which answers `basis: "unresolved"` with an empty carrier id when the
     * authority history does not cover the purchase — an honest state the fuel
     * module keeps and flags. Copying that empty string onto an event turns
     * "nobody knows whose this was" into a carrier id of "", which reads as a
     * value and compares as one. Absent means unknown; "" means nothing at all.
     */
    if ("carrierOrganizationId" in event.scope && !event.scope.carrierOrganizationId) {
      throw new EventScopeRefusedError(
        "empty_carrier_organization",
        `A ${event.kind} event carries an empty carrier organization. When the canonical attribution could not establish a carrier, the field is left absent rather than set to nothing.`,
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
  if (event.scope.dispatchOrganizationId) {
    throw new EventScopeRefusedError(
      "dispatch_write_not_authorized",
      "A meter event cannot name a dispatch workspace: no canonical grant lets one take part in writing another carrier's meter history.",
      [event.eventId, event.subjectId],
    );
  }
}

/**
 * ███ WHAT THIS DOES NOT DO ███
 *
 *  - It does not authorize READING. No function here is consulted to decide who
 *    may see an event: `events()`, `event()` and `projections()` filter on
 *    `scope.organizationId` and nothing else, and `readRule` in the matrix is a
 *    description of that, not a switch. Naming a grant in
 *    `crossOrganizationWrite` could never widen a read — and today no kind
 *    names one anyway.
 *  - It does not let a dispatch workspace write a meter reading, and it does
 *    not pretend that is a settled design. It is a refusal until a
 *    carrier-controlled meter-write grant exists — a record in which the
 *    operating carrier says which workspace may contribute to its equipment
 *    history, and for which equipment. That record is not in this repository,
 *    and A6 does not invent one.
 *  - It does not re-derive `load.finalized` or `fuel_transaction.confirmed`
 *    attribution. Their organization is already proved by the publishing
 *    service against its own canonical record. Their `carrierOrganizationId`
 *    is a different matter and is NOT enforced here: fuel's comes from
 *    `resolveAttribution` at record time, which is a real canonical source this
 *    module cannot reach without the fuel store; a load's comes from the
 *    applied signature, which traces back to a CURRENT-state lookup. The one
 *    thing provable from the event alone is that a carrier field which is
 *    present must not be empty, and that is what is enforced.
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
