import type {
  FuelTransaction, FuelTransactionFlag, JurisdictionMileageRecord, MileageRecordFlag,
} from "@/types";
import { isKnownJurisdiction } from "./jurisdictions";
import { quarterOf, yearOf } from "./periods";
import { GALLON, ratio } from "./units";

/**
 * Cheap, explainable checks that put a record in front of a person.
 *
 * This is NOT fraud detection, and the wording throughout says so. Every check
 * here is arithmetic somebody could do on paper: a dash reading that went
 * backwards, a tank that took more than it holds, a price a long way from what
 * the rest of the fleet paid that week. Nothing is scored, nothing is hidden,
 * and no record is ever auto-rejected — the output is a flag, and a flag is an
 * invitation to look.
 */

/** Bands are generous on purpose: a flag that cries wolf is a flag people mute. */
export const VALIDATION_BOUNDS = {
  /** Above this, somebody almost certainly fuelled two trucks on one receipt. */
  maxGallonsThousandths: 300 * GALLON,
  /** Below this, it is a rounding artefact or a mis-keyed entry. */
  minGallonsThousandths: 1 * GALLON,
  /** How far from the fleet's own recent average a price may sit, in percent. */
  priceBandPct: 40,
  /** A single jurisdiction segment longer than this is not one stretch of road. */
  maxSegmentMiles: 1_500,
} as const;

export interface TransactionValidationInput {
  transaction: FuelTransaction;
  /** Earlier purchases for the same truck, current revisions only, ascending. */
  truckHistory: readonly FuelTransaction[];
  /**
   * The fleet's own average price per gallon in mills over the surrounding
   * period. Undefined disables the price check rather than inventing a band.
   */
  referencePriceMills?: number;
  /** Jurisdictions the truck actually recorded miles in around that date. */
  jurisdictionsTravelled?: readonly string[];
  /** Candidate this looks like a duplicate of, when one was found. */
  duplicateOfId?: string;
}

export function validateTransaction(input: TransactionValidationInput): FuelTransactionFlag[] {
  const { transaction: t } = input;
  const flags: FuelTransactionFlag[] = [];

  if (!t.receiptDocumentId) flags.push("missing_receipt");

  if (
    t.gallonsThousandths > VALIDATION_BOUNDS.maxGallonsThousandths ||
    t.gallonsThousandths < VALIDATION_BOUNDS.minGallonsThousandths
  ) {
    flags.push("implausible_gallons");
  }

  if (t.odometerMiles !== undefined) {
    const earlier = input.truckHistory
      .filter((h) => h.odometerMiles !== undefined && h.purchasedAt < t.purchasedAt)
      .sort((a, b) => a.purchasedAt.localeCompare(b.purchasedAt));
    const previous = earlier[earlier.length - 1];
    if (previous && previous.odometerMiles !== undefined && t.odometerMiles < previous.odometerMiles) {
      flags.push("odometer_regression");
    }
  }

  // Skipped, not failed, when the caller could not be shown the price: a check
  // that cannot see its input must not invent a verdict.
  const price = t.cost?.pricePerGallonMills;
  if (price !== undefined && input.referencePriceMills && input.referencePriceMills > 0) {
    const deltaPct = Math.abs(
      ratio(price - input.referencePriceMills, input.referencePriceMills, 100),
    );
    if (deltaPct > VALIDATION_BOUNDS.priceBandPct) flags.push("price_out_of_band");
  }

  if (input.duplicateOfId) flags.push("possible_duplicate");

  if (
    input.jurisdictionsTravelled &&
    input.jurisdictionsTravelled.length > 0 &&
    !input.jurisdictionsTravelled.includes(t.location.jurisdiction)
  ) {
    flags.push("jurisdiction_outside_travel");
  }

  if (t.attribution.basis === "unresolved") flags.push("no_active_operating_authority");

  return flags;
}

export interface MileageValidationInput {
  record: JurisdictionMileageRecord;
  /** Other current records for the same truck. Used for overlap detection. */
  truckRecords: readonly JurisdictionMileageRecord[];
}

export function validateMileage(input: MileageValidationInput): MileageRecordFlag[] {
  const { record: r } = input;
  const flags: MileageRecordFlag[] = [];

  if (r.totalMiles < 0 || r.taxableMiles < 0) flags.push("negative_miles");
  if (r.taxableMiles > r.totalMiles) flags.push("taxable_exceeds_total");

  if (r.odometerStartMiles !== undefined && r.odometerEndMiles !== undefined) {
    if (r.odometerEndMiles < r.odometerStartMiles) {
      flags.push("odometer_regression");
    } else if (Math.abs(r.odometerEndMiles - r.odometerStartMiles - r.totalMiles) > 5) {
      // Five miles of slack: a dash reading is a whole number and a jurisdiction
      // line is not a mile marker. More than that is a gap somebody should see.
      flags.push("odometer_gap");
    }
  }

  // An unknown code cannot be placed on a return at all, and no single
  // jurisdiction is wide enough for one continuous segment this long.
  if (!isKnownJurisdiction(r.jurisdiction)) flags.push("unknown_jurisdiction");
  if (r.totalMiles > VALIDATION_BOUNDS.maxSegmentMiles) flags.push("segment_too_long");

  const start = Date.parse(r.travelStartedAt);
  const end = Date.parse(r.travelEndedAt);
  if (
    yearOf(r.travelStartedAt) !== yearOf(r.travelEndedAt) ||
    quarterOf(r.travelStartedAt) !== quarterOf(r.travelEndedAt)
  ) {
    flags.push("crosses_period_boundary");
  }

  const overlaps = input.truckRecords.some((other) => {
    if (other.id === r.id || !other.revision.isCurrent) return false;
    if (other.state === "corrected" || other.state === "rejected") return false;
    const otherStart = Date.parse(other.travelStartedAt);
    const otherEnd = Date.parse(other.travelEndedAt);
    return start < otherEnd && otherStart < end;
  });
  if (overlaps) flags.push("overlaps_existing_segment");

  if (r.attribution.basis === "unresolved") flags.push("no_active_operating_authority");

  return [...new Set(flags)];
}
