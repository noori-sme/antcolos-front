import type {
  FuelTransactionFlag, FuelTransactionSource, FuelTransactionState, FuelType,
  IftaPeriodState, MileageRecordFlag, MileageRecordState, MileageSource,
} from "@/types";

export const FUEL_TYPE_LABEL: Record<FuelType, string> = {
  diesel: "Diesel",
  biodiesel_blend: "Biodiesel blend",
  gasoline: "Gasoline",
  def: "DEF",
  propane: "Propane",
  cng: "CNG",
  lng: "LNG",
  electric: "Electric",
};

export const FUEL_STATE_LABEL: Record<FuelTransactionState, string> = {
  manual: "Entered by hand",
  imported: "Imported",
  pending_review: "Pending review",
  verified: "Verified",
  corrected: "Corrected",
  duplicate: "Duplicate",
  rejected: "Rejected",
};

export const FUEL_STATE_DESCRIPTION: Record<FuelTransactionState, string> = {
  manual: "Somebody typed this in and nobody has checked it yet.",
  imported: "Arrived from an outside system and has not been reviewed.",
  pending_review: "Flagged for a person to look at before it counts as settled.",
  verified: "A person with review permission accepted it.",
  corrected: "Replaced by a later revision. Kept on the record, and excluded from every total.",
  duplicate: "The same purchase as another record. Excluded from every total.",
  rejected: "Not a real purchase for this carrier. Excluded from every total.",
};

export const FUEL_SOURCE_LABEL: Record<FuelTransactionSource, string> = {
  manual: "Entered in Antcolos",
  fuel_card: "Fuel card",
  receipt_ocr: "Receipt reading",
  eld: "ELD",
  telematics: "Telematics",
  accounting: "Accounting",
  api: "API",
};

export const FUEL_FLAG_LABEL: Record<FuelTransactionFlag, string> = {
  missing_receipt: "No receipt attached",
  odometer_regression: "Odometer went backwards",
  implausible_gallons: "Gallons outside a believable range",
  price_out_of_band: "Price well away from the fleet average",
  possible_duplicate: "Looks like another purchase",
  jurisdiction_outside_travel: "Bought where no miles were recorded",
  no_active_operating_authority: "No carrier authority was live at that moment",
};

export const FUEL_FLAG_DESCRIPTION: Record<FuelTransactionFlag, string> = {
  missing_receipt: "A qualified purchase needs a receipt before the quarter can be called ready.",
  odometer_regression: "The reading is lower than the previous one for this truck. Usually a typo, sometimes two trucks on one card.",
  implausible_gallons: "More or less fuel than a tank on this truck holds. Worth a look before it reaches a return.",
  price_out_of_band: "Far from what the rest of the fleet paid that week. Often a mis-keyed price, occasionally a different fuel.",
  possible_duplicate: "Same truck, same moment, same amount as an existing purchase. A person decides which one is real.",
  jurisdiction_outside_travel: "Fuel was bought in a jurisdiction where no miles are recorded. Legitimate now and then, and the first thing an auditor asks about.",
  no_active_operating_authority: "Nothing in the operating-authority history covers this moment, so responsibility could not be established.",
};

export const MILEAGE_STATE_LABEL: Record<MileageRecordState, string> = {
  manual: "Entered by hand",
  imported: "Imported",
  pending_review: "Pending review",
  verified: "Verified",
  corrected: "Corrected",
  rejected: "Rejected",
};

export const MILEAGE_SOURCE_LABEL: Record<MileageSource, string> = {
  manual: "Entered in Antcolos",
  eld: "ELD",
  gps: "GPS",
  telematics: "Telematics",
  load_derived: "Derived from a load",
};

export const MILEAGE_FLAG_LABEL: Record<MileageRecordFlag, string> = {
  negative_miles: "Negative miles",
  odometer_gap: "Odometer does not match the miles",
  odometer_regression: "Odometer went backwards",
  taxable_exceeds_total: "Taxable miles exceed total miles",
  overlaps_existing_segment: "Overlaps another segment for this truck",
  crosses_period_boundary: "Runs across a quarter boundary",
  unknown_jurisdiction: "Jurisdiction is not recognised",
  segment_too_long: "Longer than any single jurisdiction",
  no_active_operating_authority: "No carrier authority was live at that moment",
};

export const IFTA_PERIOD_STATE_LABEL: Record<IftaPeriodState, string> = {
  incomplete: "Incomplete",
  needs_review: "Needs review",
  ready: "Ready",
  filed: "Filed",
  amended: "Amended",
};

export const IFTA_PERIOD_STATE_DESCRIPTION: Record<IftaPeriodState, string> = {
  incomplete: "The quarter is still running, or records are missing.",
  needs_review: "Everything is here, but something is flagged or unreviewed.",
  ready: "Complete and clean. Antcolos does not file it — you do, wherever you file.",
  filed: "Somebody recorded that this quarter was filed elsewhere. Corrections after this point create an amendment.",
  amended: "Corrected after filing. The amendment history says what changed and why.",
};

/** The one sentence that must appear wherever a return is shown. */
export const NO_FILING_NOTICE =
  "Antcolos does not file IFTA returns, calculate tax owed or move money. No jurisdiction, provider or payment system is connected.";
