import type {
  FuelTransaction, FuelType, IftaJurisdictionSummary, IftaPeriod,
  IftaReadinessIssue, JurisdictionMileageRecord, Jurisdiction,
} from "@/types";
import {
  costCentsOf, countableMileage, countableTransactions, isPropulsionFuel, summarize,
} from "./economy";
import { isIftaMember, jurisdictionName } from "./jurisdictions";
import { isPeriodFinished, isWithinQuarter } from "./periods";
import { deemedGallonsThousandths } from "./units";

/**
 * The IFTA calculation, kept deliberately short of the parts Antcolos is not
 * entitled to do.
 *
 * What this file does:
 *   - decides whether a purchase can be claimed as tax-paid gallons
 *   - builds the per-jurisdiction line: miles in, gallons bought, gallons
 *     deemed burned, and the net
 *   - says whether a quarter is complete enough to be called ready
 *
 * What it does NOT do, and must not start doing without a real rate source:
 *   - turn net gallons into money. That needs each jurisdiction's quarterly
 *     rate, and no rate table is connected. Every summary reports
 *     `taxRatesAvailable: false` rather than inventing one.
 *   - file anything. Nothing here talks to any jurisdiction.
 */

/** Fuel types that earn tax-paid credit on a return. */
const CLAIMABLE_FUEL: readonly FuelType[] = ["diesel", "biodiesel_blend", "gasoline", "lng", "cng", "propane"];

export interface QualificationResult {
  qualifies: boolean;
  /** Written for an operator, and shown next to the purchase when it fails. */
  note?: string;
}

/**
 * Whether one purchase can be claimed.
 *
 * Two independent tests: the fuel has to be a taxable motor fuel, and the pump
 * has to sit in a member jurisdiction. Failing either is normal and is not an
 * error — a DEF top-up in Illinois and a diesel fill in Alaska are both real
 * purchases that simply do not go on the return.
 */
export function qualifyForIfta(fuelType: FuelType, jurisdiction: Jurisdiction): QualificationResult {
  if (!isPropulsionFuel(fuelType)) {
    return { qualifies: false, note: "DEF is a consumable, not a motor fuel. It never appears on an IFTA return." };
  }
  if (!CLAIMABLE_FUEL.includes(fuelType)) {
    return { qualifies: false, note: "Electricity is not a taxable motor fuel under IFTA." };
  }
  if (!isIftaMember(jurisdiction)) {
    return {
      qualifies: false,
      note: `${jurisdictionName(jurisdiction)} is not an IFTA member jurisdiction, so these gallons cannot be claimed.`,
    };
  }
  return { qualifies: true };
}

/** Purchases that fall inside a quarter, whatever their state. */
export function transactionsInPeriod(
  transactions: readonly FuelTransaction[],
  period: IftaPeriod,
): FuelTransaction[] {
  return transactions.filter(
    (t) =>
      t.attribution.carrierOrganizationId === period.carrierOrganizationId &&
      isWithinQuarter(t.purchasedAt, period.year, period.quarter),
  );
}

/**
 * Mileage that falls inside a quarter.
 *
 * A segment is placed by where it STARTED. A stretch that runs across midnight
 * on the last day of a quarter belongs to the quarter it began in, and is
 * flagged rather than silently split — splitting it would invent miles nobody
 * recorded.
 */
export function mileageInPeriod(
  records: readonly JurisdictionMileageRecord[],
  period: IftaPeriod,
): JurisdictionMileageRecord[] {
  return records.filter(
    (r) =>
      r.attribution.carrierOrganizationId === period.carrierOrganizationId &&
      isWithinQuarter(r.travelStartedAt, period.year, period.quarter),
  );
}

/**
 * The per-jurisdiction lines of a return.
 *
 * Mileage and fuel are joined ONLY here, at the jurisdiction, and only after
 * both have been reduced independently. A jurisdiction with miles and no fuel,
 * or fuel and no miles, is a real and important case — both appear, because
 * both are things somebody has to explain to a tax authority.
 */
export function jurisdictionSummaries(
  transactions: readonly FuelTransaction[],
  mileage: readonly JurisdictionMileageRecord[],
): IftaJurisdictionSummary[] {
  const fuel = countableTransactions(transactions);
  const miles = countableMileage(mileage);
  const fleetMpg = summarize(transactions, mileage).mpgHundredths;

  const codes = new Set<Jurisdiction>([
    ...miles.map((r) => r.jurisdiction),
    ...fuel.map((t) => t.location.jurisdiction),
  ]);

  return [...codes]
    .map((code) => {
      const inJurisdiction = miles.filter((r) => r.jurisdiction === code);
      const bought = fuel.filter((t) => t.location.jurisdiction === code);
      const taxableMiles = inJurisdiction.reduce((s, r) => s + r.taxableMiles, 0);
      const taxPaid = bought
        .filter((t) => t.qualifiesForIfta)
        .reduce((s, t) => s + t.gallonsThousandths, 0);
      const deemed = deemedGallonsThousandths(taxableMiles, fleetMpg);

      return {
        jurisdiction: code,
        totalMiles: inJurisdiction.reduce((s, r) => s + r.totalMiles, 0),
        taxableMiles,
        taxPaidGallonsThousandths: taxPaid,
        taxableGallonsThousandths: deemed,
        netTaxableGallonsThousandths: deemed - taxPaid,
        spendCents: bought.reduce((s, t) => s + costCentsOf(t), 0),
        purchaseCount: bought.length,
        mileageRecordCount: inJurisdiction.length,
      };
    })
    .sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction));
}

/**
 * Why a quarter is not ready.
 *
 * Every issue is something a person can go and fix, and the list is the same
 * list the Needs You items are built from — so the dashboard and the queue can
 * never disagree about what is outstanding.
 */
export function readinessIssues(
  period: IftaPeriod,
  transactions: readonly FuelTransaction[],
  mileage: readonly JurisdictionMileageRecord[],
  now = Date.now(),
): IftaReadinessIssue[] {
  const issues: IftaReadinessIssue[] = [];
  const fuel = countableTransactions(transactions);
  const miles = countableMileage(mileage);

  if (!isPeriodFinished(period, now)) issues.push("period_not_finished");
  if (miles.length === 0) issues.push("no_mileage_records");
  if (fuel.length === 0) issues.push("no_fuel_purchases");

  if (fuel.some((t) => t.state === "manual" || t.state === "imported" || t.state === "pending_review")) {
    issues.push("fuel_awaiting_review");
  }
  if (miles.some((r) => r.state === "manual" || r.state === "imported" || r.state === "pending_review")) {
    issues.push("mileage_awaiting_review");
  }
  if (fuel.some((t) => !t.receiptDocumentId)) issues.push("missing_receipts");
  if (fuel.some((t) => t.flags.length > 0)) issues.push("flagged_transactions");
  if (miles.some((r) => r.flags.length > 0)) issues.push("flagged_mileage");
  if (
    fuel.some((t) => t.attribution.basis === "unresolved") ||
    miles.some((r) => r.attribution.basis === "unresolved")
  ) {
    issues.push("unresolved_attribution");
  }

  // Fuel bought where the fleet recorded no miles. Legitimate now and then —
  // a truck can fill up and leave — but on a return it is the single most
  // common reason an auditor asks a question, so it is surfaced every time.
  const drivenIn = new Set(miles.map((r) => r.jurisdiction));
  if (fuel.some((t) => t.qualifiesForIfta && !drivenIn.has(t.location.jurisdiction))) {
    issues.push("fuel_without_mileage_jurisdiction");
  }

  return issues;
}

export const READINESS_ISSUE_LABEL: Record<IftaReadinessIssue, string> = {
  period_not_finished: "The quarter has not finished yet",
  no_mileage_records: "No jurisdiction mileage has been recorded",
  no_fuel_purchases: "No fuel purchases have been recorded",
  mileage_awaiting_review: "Mileage records are still waiting for review",
  fuel_awaiting_review: "Fuel purchases are still waiting for review",
  missing_receipts: "Some purchases have no receipt attached",
  flagged_transactions: "Some fuel purchases are flagged",
  flagged_mileage: "Some mileage records are flagged",
  unresolved_attribution: "Some records could not be attributed to a carrier authority",
  fuel_without_mileage_jurisdiction: "Fuel was bought in a jurisdiction with no recorded miles",
};

/**
 * The state a quarter should be in, given its records.
 *
 * `filed` and `amended` are decisions a person made and are never recomputed
 * away — this only ever moves a quarter between incomplete, needs_review and
 * ready.
 */
export function derivePeriodState(
  period: IftaPeriod,
  issues: readonly IftaReadinessIssue[],
): IftaPeriod["state"] {
  if (period.state === "filed" || period.state === "amended") return period.state;
  if (issues.length === 0) return "ready";

  const blocking: IftaReadinessIssue[] = [
    "period_not_finished", "no_mileage_records", "no_fuel_purchases",
  ];
  return issues.some((i) => blocking.includes(i)) ? "incomplete" : "needs_review";
}
