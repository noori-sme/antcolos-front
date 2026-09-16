import type { Address, Cents, CurrencyCode, GeoPoint, IsoDateTime } from "./common";
import type { ActorRef } from "./user";

/**
 * Fuel and IFTA — the foundation, not the finished tax product.
 *
 * Three rules shape every type in this file, and breaking any one of them is
 * how a fuel module quietly becomes wrong:
 *
 *  1. A FUEL PURCHASE IS NOT A MILEAGE RECORD. `FuelTransaction` says a truck
 *     bought fuel somewhere. `JurisdictionMileageRecord` says a truck drove so
 *     many miles inside a jurisdiction. IFTA needs BOTH, and merging them into
 *     one row destroys the distinction the tax return depends on. They are
 *     separate entities, in separate collections, with separate lifecycles.
 *
 *  2. ATTRIBUTION IS HISTORICAL. Mileage and fuel belong to the carrier whose
 *     operating authority was live at the moment of travel or purchase — a
 *     snapshot taken then and never recomputed. Selling the truck, ending a
 *     lease, moving the driver or renaming the carrier must not rewrite what
 *     a filed quarter said.
 *
 *  3. RECORDS ARE IMMUTABLE. A mistake is corrected by writing a NEW revision
 *     that supersedes the original. The original stays, readable, forever.
 *
 * Numeric conventions, so no float ever reaches a tax figure:
 *   gallonsThousandths     1000  === 1.000 gallon
 *   pricePerGallonMills    3899  === $3.899 per gallon
 *   totalCostCents         14204 === $142.04
 *   miles                  whole miles, as everywhere else in Antcolos
 *   mpgHundredths          652   === 6.52 MPG
 *   costPerMileMills       583   === $0.583 per mile
 */

/* -------------------------------------------------------------------------- */
/* Jurisdictions                                                               */
/* -------------------------------------------------------------------------- */

/**
 * An IFTA member jurisdiction: a US state or a Canadian province, as its
 * two-letter code. Not an address field — a tax jurisdiction. A purchase in a
 * non-member jurisdiction is still recorded, and simply does not qualify.
 */
export type Jurisdiction = string;

/* -------------------------------------------------------------------------- */
/* Fuel purchases                                                              */
/* -------------------------------------------------------------------------- */

/**
 * What went into the tank. Only diesel and its blends earn IFTA tax-paid
 * credit for a diesel power unit; DEF is a consumable, not a fuel, and is
 * tracked because it is on the same receipt — never because it qualifies.
 */
export type FuelType =
  | "diesel"
  | "biodiesel_blend"
  | "gasoline"
  | "def"
  | "propane"
  | "cng"
  | "lng"
  | "electric";

/**
 * Where the record came from. Distinct from its review state: an imported
 * transaction can be verified, and a manual one can be rejected.
 *
 * Every value other than `manual` names an integration that is NOT connected
 * in this build. They exist so the adapter that fills them has somewhere to
 * write, and so the interface can say honestly where a row came from.
 */
export type FuelTransactionSource =
  | "manual"
  | "fuel_card"
  | "receipt_ocr"
  | "eld"
  | "telematics"
  | "accounting"
  | "api";

/**
 * The review lifecycle of a fuel purchase.
 *
 *  manual         Entered by a person and not yet reviewed.
 *  imported       Arrived from an adapter and not yet reviewed.
 *  pending_review Someone flagged it, or a rule did; a human owes it a look.
 *  verified       A person with review permission accepted it.
 *  corrected      Superseded by a later revision. Kept, never deleted.
 *  duplicate      The same purchase as another record; excluded from totals.
 *  rejected       Not a real purchase for this carrier; excluded from totals.
 */
export type FuelTransactionState =
  | "manual"
  | "imported"
  | "pending_review"
  | "verified"
  | "corrected"
  | "duplicate"
  | "rejected";

/** States whose rows must never reach an IFTA figure or a fuel-economy total. */
export const EXCLUDED_FUEL_STATES: readonly FuelTransactionState[] = [
  "corrected", "duplicate", "rejected",
] as const;

/**
 * Machine-detected problems with one purchase.
 *
 * These are cheap, explainable checks — an odometer that went backwards, a
 * price far outside the range everybody else paid that week. They are not
 * fraud detection, and nothing here decides anything on its own: every flag
 * ends up in front of a person.
 */
export type FuelTransactionFlag =
  | "missing_receipt"
  | "odometer_regression"
  | "implausible_gallons"
  | "price_out_of_band"
  | "possible_duplicate"
  | "jurisdiction_outside_travel"
  | "no_active_operating_authority";

/** The money on a purchase. Separated so it can be withheld as a whole. */
export interface FuelCost {
  currency: CurrencyCode;
  /** 3899 === $3.899 per gallon. */
  pricePerGallonMills: number;
  /** What was actually charged, including taxes and fees on the receipt. */
  totalCostCents: Cents;
}

/** Where the fuel was bought. A jurisdiction is required; the rest is detail. */
export interface FuelStopLocation {
  /** The tax jurisdiction the pump physically sits in. */
  jurisdiction: Jurisdiction;
  address: Address;
  /** Truck stop brand and site, when the receipt or the card feed carries it. */
  merchantName?: string;
  merchantSiteId?: string;
  geo?: GeoPoint;
}

/**
 * Who was responsible at the moment this happened.
 *
 * A SNAPSHOT, resolved once from the operating-authority history and then
 * frozen. Later ownership, lease, driver or carrier changes never touch it —
 * which is the whole point: a filed quarter must still read the same next year.
 */
export interface CarrierAttribution {
  carrierOrganizationId: string;
  /** The carrier's name as it read then. A rename does not rewrite history. */
  carrierNameSnapshot: string;
  /**
   * How responsibility was established:
   *  operating_lease       An operating-authority lease was live at that instant.
   *  carrier_relationship  No lease, but exactly one approved carrier relationship covered the truck.
   *  manual_declaration    A person stated it, because neither of the above resolved it.
   *  unresolved            Nothing could establish it. The record is flagged, not guessed.
   */
  basis: "operating_lease" | "carrier_relationship" | "manual_declaration" | "unresolved";
  /** The lease that carried the authority, when there was one. */
  operatingLeaseId?: string;
  /** The approved onboarding relationship, when that is what resolved it. */
  relationshipId?: string;
  /** When the snapshot was taken — not when the travel or purchase happened. */
  resolvedAt: IsoDateTime;
}

/**
 * How a record relates to the ones before and after it.
 *
 * Corrections never overwrite. Revision 1 is the original; a correction writes
 * revision 2 pointing back at it, and marks revision 1 `corrected`. Both rows
 * stay readable, and only `isCurrent` counts toward a total.
 */
export interface RevisionInfo {
  /** 1-based. The original is 1. */
  number: number;
  /** The record this one replaces. Absent on an original. */
  supersedesId?: string;
  /** The record that replaced this one. Absent while current. */
  supersededById?: string;
  /** The first record in the chain — stable across any number of corrections. */
  originalId: string;
  /** Exactly one record per chain has this set. Totals read only these. */
  isCurrent: boolean;
  /** Why the correction was made. Required on every revision after the first. */
  correctionReason?: string;
}

/**
 * One fuel purchase. Immutable once written.
 *
 * There is deliberately no `update` anywhere in the service that returns this
 * type — the only way to change what a purchase says is to correct it, which
 * writes a new row.
 */
export interface FuelTransaction {
  id: string;
  /** The organization whose ledger holds the row. Never crosses. */
  organizationId: string;

  /** The permanent Truck UUID from the truck registry. Never a unit number. */
  truckId: string;
  /** This organization's label for the truck when the row was written. */
  truckUnitSnapshot?: string;
  /** The permanent DriverProfile, when a driver is known. */
  driverProfileId?: string;
  driverNameSnapshot?: string;
  /** The Load being run, when the purchase happened on one. */
  loadId?: string;
  loadReferenceSnapshot?: string;

  /** Frozen at write time. See CarrierAttribution. */
  attribution: CarrierAttribution;
  /**
   * A person's finding that the attribution above cannot be established.
   *
   * Separate from `attribution` and never a substitute for it: the snapshot
   * keeps saying `unresolved`, because that is what the records said when the
   * purchase was recorded and this build does not rewrite that. What this adds
   * is the one thing the snapshot cannot express — that somebody with the
   * authority to look HAS looked, found no evidence either way, and said so.
   *
   * Without it the queue asks a question nobody can answer and reopens itself
   * forever. With it the question has an ending that names no carrier, moves no
   * responsibility and contributes no meter reading.
   */
  attributionReview?: AttributionReview;

  /** When fuel actually went into the tank. */
  purchasedAt: IsoDateTime;
  location: FuelStopLocation;

  /** Dash reading at the pump. Absent when nobody recorded one. */
  odometerMiles?: number;

  fuelType: FuelType;
  /** 1000 === 1.000 gallon. Kilowatt-hours for `electric`, same scaling. */
  gallonsThousandths: number;
  /**
   * What it cost. OMITTED ENTIRELY unless the caller holds `fuel:costs:view` —
   * the service drops the object rather than returning zeroes for the UI to
   * hide, exactly as `Load.financials` does. Gallons and jurisdiction are
   * operational and stay; the money is commercial and does not.
   */
  cost?: FuelCost;

  /**
   * Whether this purchase can be claimed as tax-paid gallons.
   *
   * Derived at write time from the fuel type and the jurisdiction, and stored
   * so a later rule change cannot silently restate a filed quarter.
   */
  qualifiesForIfta: boolean;
  /** Plain-language reason, shown when it does not qualify. */
  qualificationNote?: string;

  source: FuelTransactionSource;
  /** Set for everything that did not come from the Antcolos form. */
  sourceRef?: {
    /** The adapter that produced it, e.g. "fuel_card.mock". */
    adapterId: string;
    /** The id the outside system uses. What re-import matches on. */
    externalId: string;
    importBatchId?: string;
    importedAt: IsoDateTime;
  };

  state: FuelTransactionState;
  /**
   * The record this one appears to duplicate. Set as soon as a match is found
   * — while the row is still flagged and waiting for a person — and kept once
   * somebody confirms it and the state becomes "duplicate". A candidate and a
   * confirmed duplicate are told apart by `state`, never by this field.
   */
  duplicateOfId?: string;
  /** Set when state is "rejected". */
  rejectionReason?: string;
  /** Who accepted it, and when. Only ever set by a review. */
  verifiedBy?: ActorRef;
  verifiedAt?: IsoDateTime;

  /** The receipt in the Documents system. Antcolos does not store files here. */
  receiptDocumentId?: string;

  flags: FuelTransactionFlag[];
  revision: RevisionInfo;

  notes?: string;
  createdAt: IsoDateTime;
  createdBy: ActorRef;
}

/* -------------------------------------------------------------------------- */
/* Jurisdiction mileage                                                        */
/* -------------------------------------------------------------------------- */

export type MileageSource =
  | "manual"
  | "eld"
  | "gps"
  | "telematics"
  | "load_derived";

/** Same review vocabulary as fuel, minus the states that only fuel can reach. */
export type MileageRecordState =
  | "manual"
  | "imported"
  | "pending_review"
  | "verified"
  | "corrected"
  | "rejected";

export const EXCLUDED_MILEAGE_STATES: readonly MileageRecordState[] = [
  "corrected", "rejected",
] as const;

export type MileageRecordFlag =
  | "negative_miles"
  | "odometer_gap"
  | "odometer_regression"
  | "taxable_exceeds_total"
  | "overlaps_existing_segment"
  | "crosses_period_boundary"
  | "unknown_jurisdiction"
  | "segment_too_long"
  | "no_active_operating_authority";

/**
 * Miles a truck ran inside ONE jurisdiction over ONE continuous stretch.
 *
 * This is not a fuel purchase and shares no fields with one beyond the truck
 * and the carrier. A quarter's return needs a complete set of these AND a
 * complete set of qualified purchases; neither can be derived from the other.
 */
export interface JurisdictionMileageRecord {
  id: string;
  organizationId: string;

  truckId: string;
  truckUnitSnapshot?: string;
  driverProfileId?: string;
  driverNameSnapshot?: string;
  /** The Load the miles were run under, when they were run under one. */
  loadId?: string;
  loadReferenceSnapshot?: string;

  /** Frozen at write time, exactly as on a purchase. */
  attribution: CarrierAttribution;
  /**
   * The same finding a purchase can carry, for the same reason.
   *
   * A leg whose operating authority nobody can establish is flagged exactly as
   * a purchase is, raises exactly the same Needs You item, and had exactly the
   * same problem: nothing could close it. Resolved against `travelStartedAt`,
   * which is the instant the attribution snapshot was resolved for.
   */
  attributionReview?: AttributionReview;

  jurisdiction: Jurisdiction;
  /** The continuous stretch inside that jurisdiction. */
  travelStartedAt: IsoDateTime;
  travelEndedAt: IsoDateTime;

  /** Every mile run in the jurisdiction. */
  totalMiles: number;
  /**
   * The subset that is taxable. Differs from total on toll miles and on
   * jurisdiction-specific exemptions, so it is recorded rather than assumed.
   */
  taxableMiles: number;

  odometerStartMiles?: number;
  odometerEndMiles?: number;

  source: MileageSource;
  sourceRef?: {
    adapterId: string;
    externalId: string;
    importBatchId?: string;
    importedAt: IsoDateTime;
  };

  state: MileageRecordState;
  rejectionReason?: string;
  verifiedBy?: ActorRef;
  verifiedAt?: IsoDateTime;

  flags: MileageRecordFlag[];
  revision: RevisionInfo;

  notes?: string;
  createdAt: IsoDateTime;
  createdBy: ActorRef;
}

/* -------------------------------------------------------------------------- */
/* IFTA periods                                                                */
/* -------------------------------------------------------------------------- */

export type Quarter = 1 | 2 | 3 | 4;

/**
 * Where a quarter has got to.
 *
 *  incomplete   Records are still missing or the quarter is still running.
 *  needs_review Everything is present but something is flagged.
 *  ready        Complete and clean. Nothing is filed by Antcolos.
 *  filed        A person recorded that they filed it elsewhere. Locks the quarter.
 *  amended      Corrected after filing. Carries the amendment history.
 */
export type IftaPeriodState =
  | "incomplete"
  | "needs_review"
  | "ready"
  | "filed"
  | "amended";

/** Why a quarter cannot be called ready. Every entry is actionable. */
export type IftaReadinessIssue =
  | "period_not_finished"
  | "no_mileage_records"
  | "no_fuel_purchases"
  | "mileage_awaiting_review"
  | "fuel_awaiting_review"
  | "missing_receipts"
  | "flagged_transactions"
  | "flagged_mileage"
  | "unresolved_attribution"
  | "fuel_without_mileage_jurisdiction";

export interface IftaAmendment {
  id: string;
  at: IsoDateTime;
  by: ActorRef;
  reason: string;
  /** The correcting records that prompted it. */
  transactionIds: string[];
  mileageRecordIds: string[];
}

/**
 * One quarter, for one carrier's authority, inside one organization.
 *
 * The period is a container and a state machine — never a place figures are
 * stored. Every number a period shows is recomputed from the current revisions
 * of its records, so a correction is visible immediately and a filed quarter
 * keeps its own amendment trail.
 */
export interface IftaPeriod {
  id: string;
  organizationId: string;
  /** The carrier authority the return is for. Matches the attribution snapshot. */
  carrierOrganizationId: string;
  carrierNameSnapshot: string;

  year: number;
  quarter: Quarter;
  /** Inclusive ISO dates covering the quarter. */
  startsOn: string;
  endsOn: string;
  /** The statutory filing date. Informational: Antcolos files nothing. */
  dueOn: string;

  state: IftaPeriodState;

  /**
   * What a person recorded about filing it somewhere else. Antcolos has no
   * connection to any jurisdiction, provider or payment system.
   */
  filing?: {
    filedAt: IsoDateTime;
    filedBy: ActorRef;
    /** The confirmation number the filer typed in. Not verified by anybody. */
    confirmationReference?: string;
    /** Always "external": no IFTA provider is connected in this build. */
    channel: "external";
    note?: string;
  };

  amendments: IftaAmendment[];
  /** Set when filed. Records inside a locked period can still be corrected —
   *  doing so is what moves the period to `amended`. */
  lockedAt?: IsoDateTime;

  createdAt: IsoDateTime;
}

/* -------------------------------------------------------------------------- */
/* Derived summaries — computed, never stored                                  */
/* -------------------------------------------------------------------------- */

/**
 * One jurisdiction's line on a return.
 *
 * `netTaxableGallons` is where the calculation deliberately stops. Turning it
 * into money needs each jurisdiction's quarterly tax rate, and no rate source
 * is connected — so the interface says so rather than inventing a number.
 */
export interface IftaJurisdictionSummary {
  jurisdiction: Jurisdiction;
  totalMiles: number;
  taxableMiles: number;
  /** Gallons bought in this jurisdiction with tax already paid at the pump. */
  taxPaidGallonsThousandths: number;
  /** taxableMiles ÷ fleet MPG — what the fleet is deemed to have burned here. */
  taxableGallonsThousandths: number;
  /** taxable − tax-paid. Positive means owed; negative means a credit. */
  netTaxableGallonsThousandths: number;
  /** What was spent here. Absent without `fuel:costs:view`. Never part of the return. */
  spendCents?: Cents;
  purchaseCount: number;
  mileageRecordCount: number;
}

/**
 * Fuel economy for a slice of the ledger: a fleet, a truck, a driver, a period.
 * Every figure is derived from current revisions only.
 */
export interface FuelEconomySummary {
  totalMiles: number;
  totalGallonsThousandths: number;
  /** 652 === 6.52 MPG. Zero when there are no gallons to divide by. */
  mpgHundredths: number;
  /** Absent without `fuel:costs:view`. Zero means zero; absent means withheld. */
  totalSpendCents?: Cents;
  /** 583 === $0.583 per mile. Absent without `fuel:costs:view`. */
  costPerMileMills?: number;
  /** 3899 === $3.899 per gallon, averaged over the slice. Absent without cost access. */
  averagePricePerGallonMills?: number;
  purchaseCount: number;
}

/** Fuel economy for one truck, so the dashboard can rank the fleet. */
export interface TruckFuelEconomy extends FuelEconomySummary {
  truckId: string;
  unit: string;
  /** Absent when this organization is not entitled to know. */
  currentDriverName?: string;
}

/** Fuel economy attributed to one driver. */
export interface DriverFuelEconomy extends FuelEconomySummary {
  driverProfileId: string;
  driverName: string;
}

/**
 * Everything the Fuel & IFTA dashboard shows, assembled by the service so the
 * screen never derives a tax figure of its own.
 *
 * Money fields are `null` — not zero, not hidden client-side — for a caller
 * without the cost permission, exactly as loads omit `financials`.
 */
export interface FuelDashboard {
  /** The window the figures cover. */
  window: { from: IsoDateTime; to: IsoDateTime; label: string };
  economy: FuelEconomySummary;
  /** False when every money field above was withheld, so the UI can say so. */
  costVisible: boolean;
  byTruck: TruckFuelEconomy[];
  byDriver: DriverFuelEconomy[];
  byJurisdiction: IftaJurisdictionSummary[];
  /** Null unless the caller may see IFTA. */
  currentPeriod: IftaPeriodSummary | null;
  recentTransactions: FuelTransaction[];
  counts: {
    transactionsTotal: number;
    awaitingReview: number;
    missingReceipts: number;
    duplicates: number;
    flagged: number;
    mileageRecords: number;
    mileageAwaitingReview: number;
  };
}

/** A period with its derived figures attached. */
export interface IftaPeriodSummary {
  period: IftaPeriod;
  economy: FuelEconomySummary;
  jurisdictions: IftaJurisdictionSummary[];
  readiness: {
    issues: IftaReadinessIssue[];
    /** True when the quarter has finished and no issue remains. */
    ready: boolean;
  };
  /** Always false in this build. No jurisdiction rate table is connected. */
  taxRatesAvailable: boolean;
}

/* -------------------------------------------------------------------------- */
/* Sharing with dispatch organizations                                         */
/* -------------------------------------------------------------------------- */

/**
 * What a carrier has explicitly agreed to show a dispatch organization.
 *
 * A dispatch agency is a service provider, not the taxpayer. It sees nothing
 * about fuel by default — not the ledger, not the spend, and above all not the
 * tax filing. A carrier opens exactly the doors it wants to, per relationship,
 * and can close them again.
 *
 * `includesTaxFiling` is the "separately authorized" case, and it is off unless
 * a carrier deliberately turns it on. Holding `ifta:view` is not enough on its
 * own: the service checks the permission AND the grant.
 */
export interface FuelSharingGrant {
  id: string;
  /** The carrier that owns the fuel data and is giving the access. */
  carrierOrganizationId: string;
  /** The dispatch organization receiving it. */
  dispatchOrganizationId: string;
  dispatchOrganizationName: string;
  /**
   * The trucks covered. An empty array means every truck the carrier operates —
   * stated as `scope`, so "all" is a decision somebody made, not a default.
   */
  scope: "all_trucks" | "listed_trucks";
  truckIds: string[];
  /** Operational fuel information: purchases, gallons, jurisdictions, economy. */
  includesOperationalFuel: boolean;
  /** What the fuel cost. Off by default — it is commercial information. */
  includesCosts: boolean;
  /** IFTA periods, jurisdiction returns and filing. Off unless authorized. */
  includesTaxFiling: boolean;
  status: "active" | "suspended" | "ended";
  startedAt: IsoDateTime;
  endedAt?: IsoDateTime;
  grantedBy: ActorRef;
  createdAt: IsoDateTime;
}

/* -------------------------------------------------------------------------- */
/* Audit                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A reviewer's finding about attribution that could not be resolved.
 *
 * One outcome, deliberately. "Not establishable with the available evidence" is
 * a statement about the EVIDENCE, and it is the only thing a person can honestly
 * conclude without the historical-authority correction and carrier-dispute
 * records that do not exist in this build. There is no "it was carrier X" here,
 * because a person choosing a name to clear a warning is precisely the failure
 * this whole layer is built to prevent.
 */
export interface AttributionReview {
  at: IsoDateTime;
  by: ActorRef;
  outcome: "not_establishable";
  /** Why, in the reviewer's own words. Required — a finding needs a reason. */
  reason: string;
  /**
   * What the canonical records answered at the moment of the review.
   *
   * The finding stands only while that answer stands. If the truck registry
   * later says something different — a lease corrected, a relationship
   * established, a dispute decided — this review no longer describes reality,
   * the queue raises the purchase again, and somebody looks with the new
   * evidence in front of them. A finding about evidence expires when the
   * evidence changes.
   */
  refusalCode: string;
  /**
   * The canonical record ids that refusal named — the conflicting relationships,
   * the leases that overlap, the ownership row that cannot be placed in time.
   *
   * The code alone is a CATEGORY, and a category does not change when the facts
   * behind it do. "Two carriers cover this moment" reads the same whether it is
   * the two carriers the reviewer looked at or two different ones, and a finding
   * that survived that swap would be a person's conclusion about evidence they
   * never saw. The ids are the evidence's own identity, held by the registry
   * that owns it; nothing here is a second copy of a relationship or a lease.
   */
  refusalRecords: string[];
}

export type FuelAuditKind =
  | "transaction.recorded"
  | "transaction.imported"
  | "transaction.flagged"
  | "transaction.verified"
  | "transaction.rejected"
  | "transaction.marked_duplicate"
  | "transaction.corrected"
  | "transaction.attribution_reviewed"
  | "transaction.receipt_attached"
  | "mileage.recorded"
  | "mileage.imported"
  | "mileage.verified"
  | "mileage.rejected"
  | "mileage.corrected"
  | "mileage.attribution_reviewed"
  | "period.opened"
  | "period.state_changed"
  | "period.filed"
  | "period.amended"
  | "sharing.granted"
  | "sharing.changed"
  | "sharing.ended";

/**
 * The append-only fuel audit trail.
 *
 * Written by the service on every state change, never by a screen, and never
 * edited or deleted. `before` and `after` hold only the fields that moved —
 * enough to answer "what did this say before?" without duplicating the record.
 */
export interface FuelAuditEntry {
  id: string;
  organizationId: string;
  kind: FuelAuditKind;
  at: IsoDateTime;
  actor: ActorRef;
  /** What the entry is about. */
  subject: {
    kind: "transaction" | "mileage" | "period" | "sharing";
    id: string;
    label: string;
  };
  summary: string;
  before?: Record<string, string | number | boolean | null>;
  after?: Record<string, string | number | boolean | null>;
}

/* -------------------------------------------------------------------------- */
/* Filters                                                                     */
/* -------------------------------------------------------------------------- */

export interface FuelTransactionFilters {
  /** Matches merchant, city, unit, driver, load reference or notes. */
  search?: string;
  truckId?: string;
  driverProfileId?: string;
  loadId?: string;
  jurisdiction?: Jurisdiction[];
  fuelType?: FuelType[];
  state?: FuelTransactionState[];
  source?: FuelTransactionSource[];
  flagged?: boolean;
  missingReceipt?: boolean;
  /** ISO instants, inclusive. */
  purchasedFrom?: IsoDateTime;
  purchasedTo?: IsoDateTime;
  /** Superseded revisions are hidden unless this is true. */
  includeSuperseded?: boolean;
}

export interface MileageRecordFilters {
  truckId?: string;
  driverProfileId?: string;
  jurisdiction?: Jurisdiction[];
  state?: MileageRecordState[];
  source?: MileageSource[];
  flagged?: boolean;
  travelFrom?: IsoDateTime;
  travelTo?: IsoDateTime;
  includeSuperseded?: boolean;
}
