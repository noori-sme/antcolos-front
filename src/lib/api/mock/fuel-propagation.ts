import type {
  ActorRef, FactVerification, FuelTransaction, JurisdictionMileageRecord,
  Provenance,
} from "@/types";
import {
  buildDomainEvent, FUEL_TRANSACTION_CONFIRMED_VERSION, propagationBus,
  type FuelExtractedValues, type FuelTransactionConfirmedPayload,
} from "@/lib/propagation";
import { contributeMeterReading } from "./meter-ledger";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * What one confirmed fuel transaction sends out into the rest of Antcolos.
 *
 * Two things, and the second one is the point of the whole exercise:
 *
 *  1. ONE versioned `fuel_transaction.confirmed` event, published from the fuel
 *     service's own write paths. Every reader — fuel cost, load and truck
 *     expense, MPG, IFTA preparation, accounting, reports, audit, Needs You —
 *     consumes that one event's projections rather than re-deriving from the
 *     ledger and rather than being handed a copy of the receipt.
 *
 *  2. The ODOMETER ON THE RECEIPT IS A METER READING. It goes to the canonical
 *     Equipment Meter Ledger, exactly like a reading typed into the fleet or
 *     maintenance screens. So an oil change that comes due at 122,000 miles now
 *     comes due from a fuel purchase, with nobody typing mileage into
 *     maintenance a second time. That single wire is the difference between
 *     "the data is in the system" and "the system knows".
 *
 * Kept out of `fuel.ts` so the service reads as rules and this reads as
 * distribution. Nothing here writes a fuel record; the service already did.
 */

const fuelProvenance = (at: string, mock = true): Provenance => ({
  module: "fuel",
  adapter: "mock:fuel-service",
  mock,
  observedAt: at,
  receivedAt: new Date().toISOString(),
});

/**
 * How sure we are of what the transaction says.
 *
 * Deliberately derived from the record's own review state rather than passed in:
 * a `verified` row has been looked at by a person, a `corrected` revision has
 * been changed by one, and a `manual` row is somebody's typing that nobody has
 * checked. Calling all three "confirmed" is how a screen ends up unable to tell
 * a reviewed number from a guess.
 */
export function fuelVerificationOf(t: FuelTransaction): FactVerification {
  switch (t.state) {
    case "verified": return "confirmed";
    case "corrected": return "corrected";
    case "rejected": return "rejected";
    case "duplicate": return "rejected";
    case "pending_review": return "pending";
    case "imported": return "extracted";
    case "manual": return "pending";
    default: return "pending";
  }
}

/**
 * Contribute the pump odometer to the canonical meter ledger.
 *
 * Idempotent on the transaction's own id, so re-publishing a revision cannot
 * append the same reading twice. A correction points at nothing in the ledger:
 * the corrected revision is a NEW reading at the same instant, and the ledger's
 * derivation decides which value stands — because the pump odometer of a
 * superseded revision was still a thing somebody read off a dash.
 */
export function contributeFuelOdometer(
  t: FuelTransaction,
  actor: ActorRef,
  opts: { correctsTransactionId?: string; correctionReason?: string } = {},
): void {
  if (t.odometerMiles === undefined) return;
  contributeMeterReading({
    equipmentKind: "truck",
    equipmentId: t.truckId,
    equipmentLabel: t.truckUnitSnapshot,
    odometerMiles: t.odometerMiles,
    readAt: t.purchasedAt,
    source: "fuel_receipt",
    contributor: "fuel",
    scope: {
      organizationId: t.organizationId,
      carrierOrganizationId: t.attribution.carrierOrganizationId,
    },
    verification: fuelVerificationOf(t),
    recordedBy: actor,
    note: `Read at the pump: ${t.location.merchantName ?? t.location.jurisdiction}.`,
    correctionReason: opts.correctionReason,
    idempotencyKey: `fuel:odometer:${t.id}`,
    provenance: fuelProvenance(t.purchasedAt),
  });
}

/** The odometer at the end of a jurisdiction leg is a reading too. */
export function contributeMileageOdometer(
  record: JurisdictionMileageRecord,
  actor: ActorRef,
): void {
  if (record.odometerEndMiles === undefined) return;
  contributeMeterReading({
    equipmentKind: "truck",
    equipmentId: record.truckId,
    equipmentLabel: record.truckUnitSnapshot,
    odometerMiles: record.odometerEndMiles,
    readAt: record.travelEndedAt,
    source: "driver_report",
    contributor: "fuel",
    scope: {
      organizationId: record.organizationId,
      carrierOrganizationId: record.attribution.carrierOrganizationId,
    },
    verification: record.state === "verified" ? "confirmed" : "pending",
    recordedBy: actor,
    note: `End of ${record.jurisdiction} leg.`,
    idempotencyKey: `fuel:mileage-odometer:${record.id}`,
    provenance: fuelProvenance(record.travelEndedAt),
  });
}

/**
 * Publish the one event for this transaction and contribute its odometer.
 *
 * The event id is derived from the transaction revision id, so recording the
 * same purchase twice — a double-tapped Save, a retried call — publishes once
 * and every projection runs once.
 */
export async function publishFuelTransaction(
  t: FuelTransaction,
  actor: ActorRef,
  opts: {
    extracted?: FuelExtractedValues;
    correctionReason?: string;
    supersedesTransactionId?: string;
  } = {},
) {
  contributeFuelOdometer(t, actor, {
    correctsTransactionId: opts.supersedesTransactionId,
    correctionReason: opts.correctionReason,
  });

  const event = buildDomainEvent<FuelTransactionConfirmedPayload>({
    kind: "fuel_transaction.confirmed",
    version: FUEL_TRANSACTION_CONFIRMED_VERSION,
    scope: {
      organizationId: t.organizationId,
      carrierOrganizationId: t.attribution.carrierOrganizationId,
    },
    subjectId: t.id,
    subjectKind: "fuel_transaction",
    occurredAt: t.purchasedAt,
    actor,
    idempotencyKey: `fuel-transaction:${t.id}`,
    provenance: fuelProvenance(t.purchasedAt),
    payload: {
      transactionId: t.id,
      originalTransactionId: t.revision.originalId,
      revisionNumber: t.revision.number,
      supersedesTransactionId: t.revision.supersedesId,
      correctionReason: opts.correctionReason ?? t.revision.correctionReason,
      truckId: t.truckId,
      truckUnit: t.truckUnitSnapshot,
      driverProfileId: t.driverProfileId,
      loadId: t.loadId,
      loadReference: t.loadReferenceSnapshot,
      purchasedAt: t.purchasedAt,
      jurisdiction: t.location.jurisdiction,
      merchantName: t.location.merchantName,
      fuelType: t.fuelType,
      gallonsThousandths: t.gallonsThousandths,
      pricePerGallonMills: t.cost?.pricePerGallonMills ?? 0,
      totalCostCents: t.cost?.totalCostCents ?? 0,
      currency: t.cost?.currency ?? "USD",
      odometerMiles: t.odometerMiles,
      qualifiesForIfta: t.qualifiesForIfta,
      receiptDocumentId: t.receiptDocumentId,
      verification: fuelVerificationOf(t),
      extracted: opts.extracted,
      attribution: {
        carrierOrganizationId: t.attribution.carrierOrganizationId,
        carrierNameSnapshot: t.attribution.carrierNameSnapshot,
        basis: t.attribution.basis,
      },
    },
  });

  return propagationBus.publish(event);
}
