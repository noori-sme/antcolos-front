import type { IsoDateTime } from "./common";
import type { IntegrationModule, Provenance } from "./integration";
import type { FactScope, FactVerification } from "./propagation";
import type { ActorRef } from "./user";

/**
 * ★ THE EQUIPMENT METER — ONE FACT, ONE LEDGER ★
 *
 * A truck's odometer is one number about one physical vehicle. Before this
 * ledger it was written in three places — the fleet telemetry store, the
 * maintenance registry and the fuel ledger — with three different values for the
 * same truck, which meant a person typed mileage in on three screens and an oil
 * change never came due from a fuel receipt.
 *
 * The ledger is keyed by the **permanent equipment UUID and nothing else**.
 * That is deliberate and it is the whole design:
 *
 *  - Readings are APPEND-ONLY. A correction appends a linked correction; it
 *    never edits or deletes what was believed before.
 *  - Every reading carries its own scope — the organization that recorded it,
 *    the carrier whose authority the equipment ran under, the operating
 *    authority record — as METADATA, never as a partition.
 *  - So meter history is never reset and never split when ownership, the
 *    carrier or the operating authority changes. A truck that leaves one
 *    carrier and joins another keeps one odometer, because it is one truck. The
 *    same reasoning the truck registry and the MT Loop registry already use.
 *  - One CURRENT ACCEPTED value for odometer and for engine hours is DERIVED
 *    from that history. Nothing stores it, and no other module keeps a
 *    competing one: fleet telemetry, maintenance and fuel all contribute
 *    readings and read the derived value back.
 *
 * ███ FRONTEND ONLY ███
 * Who may read which readings is enforced at the service layer above this, and
 * the backend must enforce it for real. A global key is not a licence to show
 * one carrier another carrier's operations, and the read helpers below take an
 * organization for exactly that reason.
 */

/**
 * How a reading was produced.
 *
 * A superset of the `MeterSource` maintenance used and the
 * `FleetTelemetrySource` fleet operations used, because both of those were
 * partial views of the same list. `fuel_receipt` is the new one and is the whole
 * reason the ledger exists: the odometer on a fuel receipt is a meter reading.
 */
export type MeterSourceKind =
  | "manual_entry"
  | "driver_report"
  | "dispatcher_entry"
  | "service_record"
  /** Read off a fuel purchase. The reading nobody should have to re-type. */
  | "fuel_receipt"
  | "eld"
  | "telematics"
  | "gps"
  /** A labelled mock adapter. Says so on screen, never inferred. */
  | "mock_adapter";

export const METER_SOURCE_LABEL: Record<MeterSourceKind, string> = {
  manual_entry: "Typed in",
  driver_report: "Driver reported",
  dispatcher_entry: "Dispatch entered",
  service_record: "From a service record",
  fuel_receipt: "From a fuel receipt",
  eld: "ELD",
  telematics: "Telematics",
  gps: "GPS",
  mock_adapter: "Mock adapter",
};

/**
 * Why a reading is not the accepted one.
 *
 * A flagged reading is KEPT. It is evidence of what somebody reported, and
 * deleting it would lose the only record that the report was wrong.
 */
export type MeterReadingFlag =
  /** A later reading with a lower odometer than the accepted one. */
  | "odometer_went_backwards"
  /** A later reading with lower engine hours than the accepted ones. */
  | "engine_hours_went_backwards"
  /** Superseded by a correction that points at it. */
  | "corrected"
  /** Same equipment, same instant, same values, recorded twice. */
  | "duplicate";

export const METER_FLAG_LABEL: Record<MeterReadingFlag, string> = {
  odometer_went_backwards: "Odometer lower than the accepted reading",
  engine_hours_went_backwards: "Engine hours lower than the accepted reading",
  corrected: "Corrected by a later reading",
  duplicate: "Duplicate of a reading already on file",
};

export type MeterEquipmentKind = "truck" | "trailer";

/**
 * One dated reading of one piece of equipment's meters.
 *
 * Odometer and engine hours are independent and both optional: a trailer has
 * neither, a tractor has both, and a reading that captured only one must never
 * be completed with a guess at the other.
 */
export interface EquipmentMeterReading {
  readingId: string;
  equipmentKind: MeterEquipmentKind;
  /** The permanent equipment UUID. The ledger's only key. Never a unit number. */
  equipmentId: string;
  /** Unit label as the recording organization knew it. A snapshot, for reading back. */
  equipmentLabel?: string;

  /** Whole miles. */
  odometerMiles?: number;
  /** Engine hours to one decimal place, as the hour meter shows them. */
  engineHours?: number;

  /** When the meter actually read this. What staleness is measured against. */
  readAt: IsoDateTime;
  /** When Antcolos was told. Differs for a receipt entered days later. */
  recordedAt: IsoDateTime;

  source: MeterSourceKind;
  /** Which module contributed it, so the ledger can say where to go and look. */
  contributor: IntegrationModule | "maintenance" | "fleet" | "fuel" | "eld";
  /** Organization and relationship scope. Metadata, never a partition. */
  scope: FactScope;
  verification: FactVerification;
  /** 0–1 where the source can express one. Absent means "not a guess". */
  confidence?: number;
  recordedBy?: ActorRef;
  note?: string;

  /** Set when this reading corrects an earlier one. The earlier one survives. */
  correctsReadingId?: string;
  correctionReason?: string;

  /** Why this reading is not the accepted one. Empty for an accepted reading. */
  flags: MeterReadingFlag[];

  correlationId: string;
  idempotencyKey: string;
  provenance: Provenance;
}

/** The accepted value of one meter, with everything needed to argue with it. */
export interface AcceptedMeterValue<T> {
  value: T;
  readAt: IsoDateTime;
  source: MeterSourceKind;
  verification: FactVerification;
  readingId: string;
  contributor: EquipmentMeterReading["contributor"];
  /** The organization that recorded it, for a screen that shows provenance. */
  recordedByOrganizationId: string;
  recordedByName?: string;
}

/**
 * The derived state of one piece of equipment's meters.
 *
 * Nothing stores this. It is computed from the whole reading history on every
 * read, which is what makes it self-correcting: append a better reading and
 * every screen follows, with nobody typing anything twice.
 */
export interface EquipmentMeterState {
  equipmentKind: MeterEquipmentKind;
  equipmentId: string;
  equipmentLabel?: string;
  odometer?: AcceptedMeterValue<number>;
  engineHours?: AcceptedMeterValue<number>;
  /** How many readings the ledger holds, accepted and flagged together. */
  readingCount: number;
  /** Readings the ledger would not accept as current, newest first. */
  disputed: EquipmentMeterReading[];
}
