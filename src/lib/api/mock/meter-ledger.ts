import type {
  AcceptedMeterValue, ActorRef, DomainEvent, EquipmentMeterReading,
  EquipmentMeterState, FactScope, FactVerification, MeterEquipmentKind,
  MeterReadingFlag, MeterSourceKind, Provenance,
} from "@/types";
import {
  buildDomainEvent, meterFactScopeAt, meterPublicationRefusal,
  METER_READING_RECORDED_VERSION, propagationBus,
  type EventScopeRefusedError, type MeterReadingRecordedPayload,
} from "@/lib/propagation";
import { ambientCorrelationId } from "@/lib/audit/correlation";
import { meterSeedRows } from "./meter-seed";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The canonical Equipment Meter Ledger.
 *
 * Keyed by the permanent equipment UUID and by nothing else, so meter history
 * survives a truck changing carrier, operating authority or owner. Readings are
 * append-only; a correction appends a linked correction. One accepted odometer
 * and one accepted engine-hours value are DERIVED from the history on every
 * read, and no other module keeps a competing value.
 *
 * Contributors today: fleet operations (`recordTelemetry`), maintenance
 * (`recordMeterReading`, service completions, defect reports) and fuel (the
 * odometer on a purchase or a mileage record). ELD publishes odometer signals
 * and may contribute through the same door when a person accepts one.
 *
 * ███ WHAT THIS IS NOT ███
 * Not persisted — it lives as long as the tab. Not authorized — every read
 * helper takes an organization so the caller can be narrowed, but the real
 * visibility rule is the backend's to enforce. Not connected to any device.
 */

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

interface LedgerState {
  /** equipmentId → readings, in the order they were appended. */
  byEquipment: Map<string, EquipmentMeterReading[]>;
  /** idempotencyKey → readingId, so a retried contribution writes once. */
  byIdempotencyKey: Map<string, string>;
}

let state: LedgerState | null = null;
let seq = 0;

/**
 * Built on first use from `meter-seed.ts`, which is the ONE seeded meter
 * history. The maintenance registry and the fleet telemetry store used to keep
 * a set each, about the same trucks, disagreeing; both now read this.
 */
function db(): LedgerState {
  if (!state) {
    state = { byEquipment: new Map(), byIdempotencyKey: new Map() };
    for (const row of meterSeedRows()) append(state, row);
  }
  return state;
}

const readingId = () => `emr_${(++seq).toString(36)}${Date.now().toString(36)}`;

/** Test hook. Never called by the UI. */
export function resetMeterLedger() {
  seq = 0;
  state = null;
}

/* -------------------------------------------------------------------------- */
/* Contributing a reading                                                      */
/* -------------------------------------------------------------------------- */

export interface ContributeMeterReadingInput {
  equipmentKind: MeterEquipmentKind;
  equipmentId: string;
  equipmentLabel?: string;
  odometerMiles?: number;
  engineHours?: number;
  /** When the meter read this. Defaults to now. */
  readAt?: string;
  source: MeterSourceKind;
  contributor: EquipmentMeterReading["contributor"];
  scope: FactScope;
  verification: FactVerification;
  confidence?: number;
  recordedBy?: ActorRef;
  note?: string;
  /** The reading this one corrects. The earlier one is kept and flagged. */
  correctsReadingId?: string;
  correctionReason?: string;
  /**
   * Same key, same effect, exactly once. Contributors build it from their own
   * record's id so re-reading their store never appends a second reading.
   */
  idempotencyKey: string;
  provenance: Provenance;
  correlationId?: string;
}

export interface ContributeResult {
  reading: EquipmentMeterReading;
  /** True when this exact contribution had already been recorded. */
  duplicate: boolean;
  /** The accepted state after the reading landed. */
  state: EquipmentMeterState;
}

/**
 * Append one reading.
 *
 * A reading that disagrees with the accepted value — a lower odometer at a later
 * time — is NOT refused. It is recorded and flagged, because it is evidence that
 * somebody reported it, and refusing it would lose that. What it does not do is
 * become the accepted value; the derivation below ignores flagged readings.
 *
 * Refusing outright is a decision for the module a person is typing into, not
 * for the ledger. `maintenance.recordMeterReading` still refuses a backwards
 * odometer to the person's face, which is the right place for that.
 */
export function contributeMeterReading(
  input: ContributeMeterReadingInput,
): ContributeResult {
  const ledger = db();
  const result = append(ledger, input);
  return { ...result, state: meterStateOf(input.equipmentId) };
}

/**
 * The single append path, shared by the seed and by every runtime contributor.
 *
 * Takes the state explicitly so the seed can run while `db()` is still building
 * it, which is what keeps the seed and the runtime path from drifting apart.
 */
function append(
  ledger: LedgerState,
  input: ContributeMeterReadingInput,
): { reading: EquipmentMeterReading; duplicate: boolean } {
  const seen = ledger.byIdempotencyKey.get(input.idempotencyKey);
  if (seen) {
    const existing = ledger.byEquipment
      .get(input.equipmentId)
      ?.find((r) => r.readingId === seen);
    // A retried contribution writes nothing. Same key, same effect, once.
    if (existing) return { reading: existing, duplicate: true };
  }

  if (input.odometerMiles === undefined && input.engineHours === undefined) {
    throw new Error("A meter reading needs an odometer value, engine hours, or both.");
  }
  if (input.odometerMiles !== undefined && input.odometerMiles < 0) {
    throw new Error("An odometer cannot be negative.");
  }
  if (input.engineHours !== undefined && input.engineHours < 0) {
    throw new Error("Engine hours cannot be negative.");
  }

  const at = new Date().toISOString();
  const readAt = input.readAt ?? at;
  const rows = ledger.byEquipment.get(input.equipmentId) ?? [];

  /*
   * Stored flags describe the APPEND — facts that are true whatever order the
   * contributors arrived in. A value that contradicts the series is NOT one of
   * them: that is derived in `meterStateOf`, so the answer cannot depend on
   * which module happened to report first.
   */
  const flags: MeterReadingFlag[] = [];
  if (
    rows.some(
      (r) =>
        r.readAt === readAt
        && r.odometerMiles === input.odometerMiles
        && r.engineHours === input.engineHours
        && r.contributor === input.contributor,
    )
  ) {
    flags.push("duplicate");
  }

  const reading: EquipmentMeterReading = {
    readingId: readingId(),
    equipmentKind: input.equipmentKind,
    equipmentId: input.equipmentId,
    equipmentLabel: input.equipmentLabel,
    odometerMiles: input.odometerMiles,
    engineHours: input.engineHours,
    readAt,
    recordedAt: at,
    source: input.source,
    contributor: input.contributor,
    scope: input.scope,
    verification: input.verification,
    confidence: input.confidence,
    recordedBy: input.recordedBy,
    note: input.note,
    correctsReadingId: input.correctsReadingId,
    correctionReason: input.correctionReason,
    flags,
    correlationId: input.correlationId ?? ambientCorrelationId(),
    idempotencyKey: input.idempotencyKey,
    provenance: input.provenance,
  };

  // A correction does not edit what it corrects. It marks it, and both stay.
  if (input.correctsReadingId) {
    const target = rows.find((r) => r.readingId === input.correctsReadingId);
    if (target && !target.flags.includes("corrected")) {
      target.flags = [...target.flags, "corrected"];
    }
  }

  rows.push(reading);
  ledger.byEquipment.set(input.equipmentId, rows);
  ledger.byIdempotencyKey.set(input.idempotencyKey, reading.readingId);

  return { reading, duplicate: false };
}

/**
 * May this workspace contribute a reading for this equipment, right now?
 *
 * The same rule `contributeAndPublish` enforces, asked BEFORE a command writes
 * a record of its own. A fuel purchase, a jurisdiction leg and a telemetry
 * submission each write their own row first and contribute the odometer
 * second; without this the refusal would land after that row was already
 * stored, leaving a receipt on file whose odometer never reached the ledger
 * and an error the person cannot act on.
 *
 * Throws `EventScopeRefusedError`, with the reason in the words of the domain.
 * Reads the registries and writes nothing.
 */
export function assertMeterContributionAllowed(input: MeterContributionQuestion): void {
  const refusal = meterContributionRefusal(input);
  if (refusal) throw refusal;
}

export interface MeterContributionQuestion {
  equipmentKind: MeterEquipmentKind;
  equipmentId: string;
  /** When the meter was read. Defaults to now, like the contribution itself. */
  readAt?: string;
  /** The workspace that wants to record it. */
  organizationId: string;
}

/**
 * The same question, answered rather than thrown.
 *
 * Callers that treat the two kinds of refusal differently — see
 * `EventScopeRefusedError.kind`, and fuel's note about a purchase that
 * genuinely happened — need the reason before deciding, not an exception.
 */
export function meterContributionRefusal(
  input: MeterContributionQuestion,
): EventScopeRefusedError | null {
  return meterPublicationRefusal({
    equipmentKind: input.equipmentKind,
    equipmentId: input.equipmentId,
    occurredAt: input.readAt ?? new Date().toISOString(),
    asserted: { organizationId: input.organizationId },
  });
}

/**
 * Append a reading AND publish it, so downstream projections follow.
 *
 * Kept separate from `contributeMeterReading` so a seed can fill the ledger
 * without publishing a hundred events nobody will read.
 *
 * ★ THE ONE DOOR WHERE A READING BECOMES A PUBLISHED FACT ★
 *
 * Which is why the scope is DERIVED here rather than taken. Every contributor
 * used to pass its own workspace id as the carrier, so a dispatch agency
 * recording an odometer wrote itself down as the operating carrier of a truck
 * it neither owns nor runs. Now the canonical truck or trailer registry says
 * who was operating the equipment when the meter was READ — not when the
 * receipt was typed in — and the contributor's own organization stays in the
 * record as the dispatch workspace when that is what it was.
 *
 * A contributor may still state what it believes. A statement that disagrees
 * with the canonical records throws `EventScopeRefusedError` and NOTHING is
 * appended: a reading whose owner cannot be established is not a reading the
 * ledger can hold, because every reader of it would be told a wrong owner.
 */
export async function contributeAndPublish(
  input: ContributeMeterReadingInput & { actor: ActorRef },
): Promise<ContributeResult & { event: DomainEvent<MeterReadingRecordedPayload> }> {
  // Pinned before the append so the ledger row, the derivation and the event
  // all describe the same instant. Left to default inside `append`, the row
  // would be stamped a few microseconds after the moment the carrier was
  // derived for, which is a difference that matters at a lease boundary.
  const readAt = input.readAt ?? new Date().toISOString();
  const scope = meterFactScopeAt({
    equipmentKind: input.equipmentKind,
    equipmentId: input.equipmentId,
    occurredAt: readAt,
    asserted: input.scope,
  });
  const result = contributeMeterReading({ ...input, readAt, scope });

  const event = buildDomainEvent<MeterReadingRecordedPayload>({
    kind: "equipment_meter.reading_recorded",
    version: METER_READING_RECORDED_VERSION,
    scope,
    subjectId: input.equipmentId,
    subjectKind: input.equipmentKind,
    occurredAt: result.reading.readAt,
    actor: input.actor,
    idempotencyKey: `meter:${result.reading.readingId}`,
    correlationId: result.reading.correlationId,
    provenance: input.provenance,
    payload: {
      readingId: result.reading.readingId,
      equipmentKind: result.reading.equipmentKind,
      equipmentId: result.reading.equipmentId,
      equipmentLabel: result.reading.equipmentLabel,
      odometerMiles: result.reading.odometerMiles,
      engineHours: result.reading.engineHours,
      readAt: result.reading.readAt,
      verification: result.reading.verification,
      confidence: result.reading.confidence,
      correctsReadingId: result.reading.correctsReadingId,
      accepted: {
        odometerMiles: result.state.odometer?.value,
        odometerReadAt: result.state.odometer?.readAt,
        engineHours: result.state.engineHours?.value,
        engineHoursReadAt: result.state.engineHours?.readAt,
      },
    },
  });

  await propagationBus.publish(event);
  return { ...result, event };
}

/* -------------------------------------------------------------------------- */
/* Derivation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Readings eligible to be the accepted one.
 *
 * Excludes what the ledger recorded ABOUT the append — a reading a correction
 * points at, a duplicate — and what a person refused. It does not exclude a
 * contradictory value: that is decided below, from the series, so the answer does
 * not depend on the order the contributors happened to arrive in.
 */
function eligible(reading: EquipmentMeterReading, meter: "odometer" | "hours"): boolean {
  if (reading.flags.includes("corrected")) return false;
  if (reading.flags.includes("duplicate")) return false;
  if (reading.verification === "rejected" || reading.verification === "failed") return false;
  return meter === "odometer"
    ? reading.odometerMiles !== undefined
    : reading.engineHours !== undefined;
}

interface Derived {
  accepted?: EquipmentMeterReading;
  /** Readings whose value is below something already true before them. */
  regressions: Set<string>;
}

/**
 * Derive one accepted value from the series.
 *
 * A meter only goes up. So the series is walked forward in time keeping a
 * running maximum, and any reading BELOW what was already true before it is a
 * regression: somebody misread a dash, transposed a digit, or reported the wrong
 * truck. It is kept as evidence and reported in `disputed`, and the accepted
 * value is the latest reading that is not one.
 *
 * Deriving this rather than storing it is what makes the answer independent of
 * arrival order — the whole reason three modules previously held three different
 * odometers for one truck. Ties on `readAt` are broken by `recordedAt`, so the
 * most recently learned value stands; deliberately NOT by source, because
 * ranking a telematics feed above a driver's own eyes is a policy decision and
 * this build has no connected feed to rank.
 */
function derive(
  readings: EquipmentMeterReading[],
  meter: "odometer" | "hours",
): Derived {
  const value = (r: EquipmentMeterReading) =>
    (meter === "odometer" ? r.odometerMiles : r.engineHours) as number;

  const series = readings
    .filter((r) => eligible(r, meter))
    .sort((a, b) =>
      Date.parse(a.readAt) - Date.parse(b.readAt)
      || Date.parse(a.recordedAt) - Date.parse(b.recordedAt));

  const regressions = new Set<string>();
  let runningMax = Number.NEGATIVE_INFINITY;
  for (const r of series) {
    const v = value(r);
    if (v < runningMax) regressions.add(r.readingId);
    else runningMax = v;
  }

  const accepted = [...series].reverse().find((r) => !regressions.has(r.readingId));
  return { accepted, regressions };
}

function accepted<T extends number>(
  reading: EquipmentMeterReading | undefined,
  value: (r: EquipmentMeterReading) => T | undefined,
): AcceptedMeterValue<T> | undefined {
  if (!reading) return undefined;
  const v = value(reading);
  if (v === undefined) return undefined;
  return {
    value: v,
    readAt: reading.readAt,
    source: reading.source,
    verification: reading.verification,
    readingId: reading.readingId,
    contributor: reading.contributor,
    recordedByOrganizationId: reading.scope.organizationId,
    recordedByName: reading.recordedBy?.displayNameSnapshot,
  };
}

/**
 * The equipment's current meter state, derived from the whole history.
 *
 * Takes no organization: the odometer of a physical truck is one number, and
 * narrowing it per organization is what produced three conflicting values in the
 * first place. Deciding whether a given membership may SEE it is the service
 * layer's job, and it belongs to the module that owns the equipment rather
 * than to a filter over a reading's own scope fields.
 */
export function meterStateOf(equipmentId: string): EquipmentMeterState {
  const rows = db().byEquipment.get(equipmentId) ?? [];
  const odo = derive(rows, "odometer");
  const hrs = derive(rows, "hours");
  const first = rows[0];

  const disputedIds = new Set([...odo.regressions, ...hrs.regressions]);

  return {
    equipmentKind: first?.equipmentKind ?? "truck",
    equipmentId,
    equipmentLabel: odo.accepted?.equipmentLabel ?? first?.equipmentLabel,
    odometer: accepted(odo.accepted, (r) => r.odometerMiles),
    engineHours: accepted(hrs.accepted, (r) => r.engineHours),
    readingCount: rows.length,
    disputed: rows
      .filter((r) => r.flags.length > 0 || disputedIds.has(r.readingId))
      .sort((a, b) => Date.parse(b.readAt) - Date.parse(a.readAt)),
  };
}

/**
 * Why one reading is not the accepted value, in a sentence.
 *
 * Regression is derived, so it is not in `reading.flags` — a screen that only
 * read the flags would show a disputed reading with no reason.
 */
export function meterDisputeReason(
  reading: EquipmentMeterReading,
  state: EquipmentMeterState,
): string | undefined {
  if (reading.flags.includes("corrected")) return "Corrected by a later reading.";
  if (reading.flags.includes("duplicate")) return "A reading already on file says the same thing.";
  if (reading.verification === "rejected") return "Refused on review.";
  if (reading.verification === "failed") return "The source could not produce a value.";
  const odo = state.odometer;
  if (
    odo && reading.odometerMiles !== undefined
    && reading.readingId !== odo.readingId
    && reading.odometerMiles < odo.value
    && Date.parse(reading.readAt) >= Date.parse(odo.readAt)
  ) {
    return `Lower than the ${odo.value.toLocaleString()} mi already on file for an earlier moment. A meter does not go backwards, so this reading is kept as evidence rather than used.`;
  }
  return undefined;
}

/** Every reading for one piece of equipment, newest first. Unscoped. */
export function meterReadings(equipmentId: string): EquipmentMeterReading[] {
  return [...(db().byEquipment.get(equipmentId) ?? [])].sort(
    (a, b) => Date.parse(b.readAt) - Date.parse(a.readAt),
  );
}

/**
 * ███ REMOVED: `visibleMeterReadings(organizationId, equipmentId)` ███
 *
 * It returned every reading whose scope NAMED the caller — as the recording
 * organization, as the carrier, or as the dispatch workspace — and called that
 * a visibility rule. It was not one. Being mentioned on a fact is not
 * permission to read it, so the helper was a cross-organization read grant
 * handed out by the attribution fields themselves: put an organization's id in
 * `carrierOrganizationId` and it could read the history back.
 *
 * Nothing called it outside its own test, so nothing replaces it. When a
 * screen does need a scoped history, the rule belongs to the module that owns
 * the equipment — the truck and trailer registries already decide who may see
 * what about a unit, through relationships, dispatch grants and assignments —
 * and never to a filter over a fact's own scope fields.
 */

/** Whether the accepted reading is older than a module's staleness threshold. */
export function meterIsStale(
  value: AcceptedMeterValue<number> | undefined,
  staleAfterDays: number,
  now: Date = new Date(),
): boolean {
  if (!value) return false;
  const ageDays = (now.getTime() - Date.parse(value.readAt)) / 86_400_000;
  return ageDays > staleAfterDays;
}

/** Equipment the ledger holds anything for. Used by seeds and tests. */
export function meteredEquipmentIds(): string[] {
  return [...db().byEquipment.keys()];
}
