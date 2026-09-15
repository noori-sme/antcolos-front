import type {
  FuelEconomySummary, FuelTransaction, FuelType, JurisdictionMileageRecord,
} from "@/types";
import { EXCLUDED_FUEL_STATES, EXCLUDED_MILEAGE_STATES } from "@/types";
import { averagePriceMills, costPerMileMills, mpgHundredths } from "./units";

/**
 * Fuel economy, derived from the ledger and never stored.
 *
 * Two rules decide what counts, and both are enforced here rather than at each
 * call site:
 *
 *  - Only CURRENT revisions. A corrected purchase is still in the ledger and
 *    must never be added twice.
 *  - Only records in a state that represents reality. A duplicate, a rejection
 *    and a superseded original are all excluded — they are history, not fuel.
 */

/**
 * What a purchase cost, or zero when the caller was not entitled to be told.
 *
 * Callers that may not see money never see a money figure either: the service
 * withholds the whole summary field rather than returning a total built from
 * zeroes. This helper exists so the arithmetic below has one obvious shape,
 * not so a redacted total can be passed off as a real one.
 */
export function costCentsOf(t: FuelTransaction): number {
  return t.cost?.totalCostCents ?? 0;
}

/** DEF is a consumable, not propulsion. It is spend, and it is not gallons. */
export function isPropulsionFuel(fuelType: FuelType): boolean {
  return fuelType !== "def";
}

/** The purchases that may contribute to any figure at all. */
export function countableTransactions(transactions: readonly FuelTransaction[]): FuelTransaction[] {
  return transactions.filter(
    (t) => t.revision.isCurrent && !EXCLUDED_FUEL_STATES.includes(t.state),
  );
}

/** The mileage records that may contribute to any figure at all. */
export function countableMileage(
  records: readonly JurisdictionMileageRecord[],
): JurisdictionMileageRecord[] {
  return records.filter(
    (r) => r.revision.isCurrent && !EXCLUDED_MILEAGE_STATES.includes(r.state),
  );
}

export function totalMiles(records: readonly JurisdictionMileageRecord[]): number {
  return countableMileage(records).reduce((sum, r) => sum + r.totalMiles, 0);
}

export function totalTaxableMiles(records: readonly JurisdictionMileageRecord[]): number {
  return countableMileage(records).reduce((sum, r) => sum + r.taxableMiles, 0);
}

export function totalGallonsThousandths(transactions: readonly FuelTransaction[]): number {
  return countableTransactions(transactions)
    .filter((t) => isPropulsionFuel(t.fuelType))
    .reduce((sum, t) => sum + t.gallonsThousandths, 0);
}

/** Everything spent at the pump, DEF included. Spend is not the same as fuel. */
export function totalSpendCents(transactions: readonly FuelTransaction[]): number {
  return countableTransactions(transactions).reduce((sum, t) => sum + costCentsOf(t), 0);
}

/**
 * The one place MPG, cost per mile and average price are computed.
 *
 * Miles come from the MILEAGE records and gallons from the FUEL records — the
 * two sides are never derived from each other, which is exactly why they are
 * two arguments.
 */
export function summarize(
  transactions: readonly FuelTransaction[],
  mileage: readonly JurisdictionMileageRecord[],
): FuelEconomySummary {
  const countable = countableTransactions(transactions);
  const propulsion = countable.filter((t) => isPropulsionFuel(t.fuelType));
  const gallons = propulsion.reduce((sum, t) => sum + t.gallonsThousandths, 0);
  const propulsionSpend = propulsion.reduce((sum, t) => sum + costCentsOf(t), 0);
  const spend = countable.reduce((sum, t) => sum + costCentsOf(t), 0);
  const miles = totalMiles(mileage);

  return {
    totalMiles: miles,
    totalGallonsThousandths: gallons,
    mpgHundredths: mpgHundredths(miles, gallons),
    totalSpendCents: spend,
    costPerMileMills: costPerMileMills(spend, miles),
    // Averaged over propulsion fuel only, so a DEF top-up cannot move the
    // diesel price the fleet is judged on.
    averagePricePerGallonMills: averagePriceMills(propulsionSpend, gallons),
    purchaseCount: countable.length,
  };
}

/** Groups countable records by a key, preserving first-seen order. */
export function groupBy<T>(items: readonly T[], key: (item: T) => string | undefined): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k === undefined) continue;
    const bucket = out.get(k);
    if (bucket) bucket.push(item);
    else out.set(k, [item]);
  }
  return out;
}
