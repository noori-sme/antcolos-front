import type {
  DomainEvent, ProjectionOutcome, ProjectionSubscriber,
} from "@/types";
import type {
  FuelTransactionConfirmedPayload, MeterReadingRecordedPayload,
} from "@/lib/propagation";
import {
  FUEL_TRANSACTION_CONFIRMED_VERSION, METER_READING_RECORDED_VERSION,
} from "@/lib/propagation";
import { externalRef } from "@/lib/integrations/mock/support";
import { integrations } from "@/lib/integrations";
import { fuelDb } from "../fuel-store";
import { meterStateOf } from "../meter-ledger";
import { mockStore } from "../store";
import { quarterOf, yearOf } from "@/lib/fuel/periods";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * Where one confirmed fuel transaction goes.
 *
 * Almost every reader of a fuel transaction in Antcolos is a PULL: fuel cost, MPG
 * and the IFTA jurisdiction summaries are computed from the ledger on every read,
 * which is correct — a cached MPG that disagrees with the purchases behind it is
 * worse than no MPG. So most of these projections do not write; they confirm what
 * the one canonical transaction changed and name it, which is what makes the
 * propagation visible without inventing a second copy of the data.
 *
 * The exception is the meter, which is a genuine write to a different module's
 * canonical record and is the reason this whole exercise was worth doing.
 */

type FuelEvent = DomainEvent<FuelTransactionConfirmedPayload>;

function fuelSubscriber(
  spec: Omit<ProjectionSubscriber<FuelTransactionConfirmedPayload>, "handles" | "versions">,
): ProjectionSubscriber<FuelTransactionConfirmedPayload> {
  return {
    ...spec,
    handles: ["fuel_transaction.confirmed"],
    versions: [FUEL_TRANSACTION_CONFIRMED_VERSION],
  };
}

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const gallons = (thousandths: number) => (thousandths / 1000).toFixed(3);

/** What was corrected, in the words a dispute would be argued in. */
function correctionSentence(event: FuelEvent): string {
  const e = event.payload.extracted;
  if (!e) return "";
  const diffs: string[] = [];
  if (e.gallonsThousandths !== undefined && e.gallonsThousandths !== event.payload.gallonsThousandths) {
    diffs.push(`gallons shown as ${gallons(e.gallonsThousandths)}, corrected to ${gallons(event.payload.gallonsThousandths)}`);
  }
  if (e.totalCostCents !== undefined && e.totalCostCents !== event.payload.totalCostCents) {
    diffs.push(`total shown as ${money(e.totalCostCents)}, corrected to ${money(event.payload.totalCostCents)}`);
  }
  if (e.odometerMiles !== undefined && e.odometerMiles !== event.payload.odometerMiles) {
    diffs.push(`odometer shown as ${e.odometerMiles.toLocaleString()} mi, corrected to ${event.payload.odometerMiles?.toLocaleString() ?? "nothing"}`);
  }
  if (e.jurisdiction !== undefined && e.jurisdiction !== event.payload.jurisdiction) {
    diffs.push(`jurisdiction shown as ${e.jurisdiction}, corrected to ${event.payload.jurisdiction}`);
  }
  return diffs.length > 0 ? ` Both values are kept: ${diffs.join("; ")}.` : "";
}

/* -------------------------------------------------------------------------- */
/* Fuel cost, and the load or truck that spent it                              */
/* -------------------------------------------------------------------------- */

export const fuelCostProjection = fuelSubscriber({
  id: "fuel_cost",
  label: "Fuel cost, and Load or Truck expense",
  targetModule: "fuel",
  mock: false,
  project(event: FuelEvent): ProjectionOutcome {
    const p = event.payload;
    const load = p.loadId
      ? mockStore.org(event.scope.organizationId).loads.find((l) => l.id === p.loadId)
      : undefined;

    const where = load
      ? `load ${load.reference} and unit ${p.truckUnit ?? p.truckId}`
      : `unit ${p.truckUnit ?? p.truckId}`;

    return {
      state: "processed",
      detail: `${money(p.totalCostCents)} for ${gallons(p.gallonsThousandths)} gal in ${p.jurisdiction} counts against ${where}.${correctionSentence(event)}`,
      producedRefs: [
        externalRef("fuel", p.transactionId, {
          entityId: p.transactionId, entityKind: "fuel_transaction",
        }),
      ],
    };
  },
});

/* -------------------------------------------------------------------------- */
/* MPG                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Fuel economy follows the purchases, and is never cached.
 *
 * MPG is computed between purchases from the ledger's own current revisions, so
 * a correction changes it on the next read with nothing to invalidate. What this
 * projection reports is whether this transaction can contribute to it at all — a
 * purchase with no odometer cannot, and that is worth saying rather than leaving
 * a dispatcher to wonder why the number did not move.
 */
export const fuelEconomyProjection = fuelSubscriber({
  id: "fuel_economy",
  label: "Fuel economy (MPG)",
  targetModule: "fuel",
  mock: false,
  project(event: FuelEvent): ProjectionOutcome {
    const p = event.payload;
    if (p.odometerMiles === undefined) {
      return {
        state: "needs_review",
        detail: `This purchase cannot contribute to unit ${p.truckUnit ?? p.truckId}'s fuel economy.`,
        reason: "No odometer reading was recorded at the pump, and miles between fills cannot be invented. Correct the purchase with the dash reading and the number follows.",
        retryable: true,
      };
    }
    const counted = fuelDb().transactions.filter(
      (t) => t.truckId === p.truckId && t.revision.isCurrent && t.odometerMiles !== undefined,
    ).length;
    return {
      state: "processed",
      detail: `Unit ${p.truckUnit ?? p.truckId}'s fuel economy now spans ${counted} purchase${counted === 1 ? "" : "s"} with an odometer reading. It is computed between fills on every read, so a later correction moves it with nothing to invalidate.`,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* IFTA preparation                                                            */
/* -------------------------------------------------------------------------- */

export const iftaProjection = fuelSubscriber({
  id: "ifta_preparation",
  label: "IFTA preparation",
  targetModule: "fuel",
  mock: false,
  project(event: FuelEvent): ProjectionOutcome {
    const p = event.payload;
    const quarter = quarterOf(p.purchasedAt);
    const year = yearOf(p.purchasedAt);
    const label = `${year} Q${quarter}`;
    const period = fuelDb().periods.find(
      (x) => x.organizationId === event.scope.organizationId
        && x.quarter === quarter && x.year === year,
    );

    if (!p.qualifiesForIfta) {
      return {
        state: "processed",
        detail: `Not claimable as tax-paid gallons in ${p.jurisdiction}, so it is excluded from ${label} rather than counted and corrected later.`,
      };
    }

    if (period?.filing) {
      return {
        state: "needs_review",
        detail: `${label} has already been filed.`,
        reason: "A change inside a filed quarter is an amendment, not an edit. The period is marked amended and a person has to decide whether to refile.",
        retryable: false,
      };
    }

    return {
      state: "processed",
      detail: `${gallons(p.gallonsThousandths)} tax-paid gal in ${p.jurisdiction} count toward ${label}. Jurisdiction totals are derived from the ledger's current revisions on every read.`,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Accounting                                                                  */
/* -------------------------------------------------------------------------- */

export const fuelAccountingProjection = fuelSubscriber({
  id: "fuel_accounting",
  label: "Accounting",
  targetModule: "accounting",
  mock: true,
  async project(event: FuelEvent): Promise<ProjectionOutcome> {
    const p = event.payload;
    const handoff = await integrations.downstream.emit({
      organizationId: event.scope.organizationId,
      target: "accounting",
      operation: "fuel_transaction.confirmed",
      idempotencyKey: `${event.eventId}:accounting`,
      refs: [
        externalRef("fuel", p.transactionId, {
          entityId: p.transactionId, entityKind: "fuel_transaction",
        }),
      ],
      payload: {
        totalCostCents: p.totalCostCents,
        gallonsThousandths: p.gallonsThousandths,
        jurisdiction: p.jurisdiction,
        carrierOrganizationId: p.attribution.carrierOrganizationId,
        purchasedAt: p.purchasedAt,
        loadId: p.loadId,
      },
    });
    return {
      state: "pending",
      detail: `${money(p.totalCostCents)} of fuel spend queued for accounting, attributed to ${p.attribution.carrierNameSnapshot}.`,
      reason: "There is no expense ledger on this branch. The figures above are what the accounting module will be handed, with an idempotency key, when it lands.",
      retryable: true,
      producedRefs: [
        externalRef("accounting", handoff.id, {
          entityId: handoff.id, entityKind: "pending_integration_event",
        }),
      ],
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Reports and audit                                                           */
/* -------------------------------------------------------------------------- */

export const fuelReportsProjection = fuelSubscriber({
  id: "fuel_reports",
  label: "Reports and Audit",
  targetModule: "fuel",
  mock: false,
  project(event: FuelEvent): ProjectionOutcome {
    return {
      state: "processed",
      detail: `In scope for the next run of every fuel, spend and IFTA report, and projected into the one audit ledger through the fuel module's own history feed. Both derive from the canonical ledger; neither holds a copy.`,
      producedRefs: [
        externalRef("fuel", event.payload.transactionId, {
          entityId: event.payload.transactionId, entityKind: "fuel_transaction",
        }),
      ],
    };
  },
});

/* -------------------------------------------------------------------------- */
/* The meter — the one that writes another module's record                      */
/* -------------------------------------------------------------------------- */

type MeterEvent = DomainEvent<MeterReadingRecordedPayload>;

/**
 * Maintenance, following a meter reading it did not have to be told about twice.
 *
 * The reading is already in the canonical Equipment Meter Ledger by the time this
 * runs — the contributor put it there. What this projection does is report the
 * consequence, because the consequence is the entire point of the exercise: a
 * mileage-triggered requirement recomputes from the accepted odometer on every
 * read, so an oil change comes due from a fuel receipt with nobody opening the
 * maintenance screen.
 */
export const maintenanceMeterProjection: ProjectionSubscriber<MeterReadingRecordedPayload> = {
  id: "maintenance_meter",
  label: "Maintenance due dates",
  targetModule: "telematics",
  handles: ["equipment_meter.reading_recorded"],
  versions: [METER_READING_RECORDED_VERSION],
  mock: false,
  project(event: MeterEvent): ProjectionOutcome {
    const p = event.payload;
    const state = meterStateOf(p.equipmentId);
    const accepted = state.odometer;

    if (!accepted) {
      return {
        state: "pending",
        detail: `No accepted odometer for ${p.equipmentLabel ?? p.equipmentId} yet, so mileage requirements stay unanswerable rather than being guessed at.`,
        reason: "A mileage rule with no reading behind it is reported as unknown, never as overdue and never as fine.",
        retryable: false,
      };
    }

    // A reading the ledger would not accept as current is reported, not hidden.
    if (accepted.readingId !== p.readingId && p.odometerMiles !== undefined) {
      return {
        state: "needs_review",
        detail: `${p.odometerMiles.toLocaleString()} mi was recorded for ${p.equipmentLabel ?? p.equipmentId} but is not the accepted reading.`,
        reason: `${accepted.value.toLocaleString()} mi from ${accepted.readAt.slice(0, 10)} is already on file for an earlier moment, and a meter does not run backwards. The reading is kept as evidence; somebody has to say which is right.`,
        retryable: false,
      };
    }

    return {
      state: "processed",
      detail: `${p.equipmentLabel ?? p.equipmentId} now reads ${accepted.value.toLocaleString()} mi${state.engineHours ? ` and ${state.engineHours.value.toLocaleString()} h` : ""}. Every mileage and engine-hour requirement on it recomputes from that on the next read — nobody re-enters it in maintenance.`,
      producedRefs: [
        externalRef("telematics", p.readingId, {
          entityId: p.equipmentId, entityKind: p.equipmentKind,
        }),
      ],
    };
  },
};
