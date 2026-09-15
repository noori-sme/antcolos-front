import type {
  AppointmentType, Cents, CurrencyCode, DocumentKind, EquipmentType,
  FactVerification, FuelType, IsoDateTime, RateConfirmationFact,
} from "@/types";

/**
 * The payload contracts, one per event kind, each versioned independently.
 *
 * A payload is what the SUBJECT'S OWNER guarantees, not what any particular
 * consumer wants. That is the difference between an event and a remote
 * procedure call: adding a projection never changes a payload, and a consumer
 * that needs a field the owner does not hold has to go and read that other
 * module rather than have it copied in here.
 *
 * Versions are additive. A new required field is a new version, and a
 * subscriber that has not been taught it reports `needs_review` rather than
 * reading a shape it has never agreed to.
 */

/* -------------------------------------------------------------------------- */
/* load.finalized — v1                                                         */
/* -------------------------------------------------------------------------- */

export const LOAD_FINALIZED_VERSION = 1;

/** One company on the confirmation, in the role it plays on this load. */
export interface FinalizedParty {
  role: "broker" | "shipper" | "receiver";
  /** As confirmed. NOT a profile reference — the directory owns matching. */
  name: string;
  mcNumber?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  /** The facility text as confirmed, for the directory to resolve. */
  facilityName?: string;
  addressLine?: string;
  city?: string;
  state?: string;
}

export interface FinalizedStop {
  stopId: string;
  kind: "pickup" | "delivery";
  sequence: number;
  facilityName?: string;
  city: string;
  state: string;
  timeZone: string;
  appointmentType: AppointmentType;
  appointmentAt: IsoDateTime;
  appointmentEndAt?: IsoDateTime;
}

export interface FinalizedMoney {
  currency: CurrencyCode;
  linehaulCents: Cents;
  totalRateCents: Cents;
  ratePerMileCents: Cents;
  loadedMiles: number;
  deadheadMiles: number;
  /** As confirmed on the document. Text, because that is what it says. */
  paymentTermsText?: string;
  /** Kept apart from layover on purpose: different money, different clocks. */
  detentionTermsText?: string;
  layoverTermsText?: string;
}

/**
 * A load became final. Published exactly once per load, from the single moment
 * the authorized carrier signature was applied and the signed copy was
 * confirmed as returned to the broker.
 *
 * Everything a downstream module needs to PREPARE its own record is here.
 * Nothing that another module owns is decided here: no invoice number, no
 * settlement, no party profile id, no tracking link.
 */
export interface LoadFinalizedPayload {
  loadId: string;
  loadReference: string;
  /** The broker's own load number, as confirmed. */
  customerReference?: string;

  /** The immutable canonical rate confirmation this finalization rests on. */
  rateConfirmationId: string;
  rateConfirmationVersion: number;
  /** The broker's document, unaltered. */
  originalDocumentId: string;
  /** The separate signed document. */
  signedDocumentId: string;

  signature: {
    carrierOrganizationId: string;
    carrierName: string;
    signedName: string;
    signedAt: IsoDateTime;
    authorisedByName: string;
    authorisedByMembershipId: string;
  };
  returnedToBroker: {
    at: IsoDateTime;
    channel: "email" | "portal" | "fax";
  };

  parties: FinalizedParty[];
  stops: FinalizedStop[];
  equipment: EquipmentType;
  weightLbs?: number;
  commodity?: string;
  financials: FinalizedMoney;

  assignment?: {
    driverId?: string;
    driverName?: string;
    truckId?: string;
    truckUnit?: string;
    trailerId?: string;
    trailerUnit?: string;
  };

  documentRequirements: {
    kind: DocumentKind;
    required: boolean;
    satisfiedByDocumentId?: string;
  }[];

  /** The operational cycle this load was booked into, when there was one. */
  mtLoopId?: string;
  dispatchCycleId?: string;
  bookingId?: string;

  /**
   * Every confirmed field with its extracted value beside it, so a downstream
   * screen can show "shown as X, corrected to Y" without reading the workflow.
   */
  facts: RateConfirmationFact[];
}

/* -------------------------------------------------------------------------- */
/* fuel_transaction.confirmed — v1                                             */
/* -------------------------------------------------------------------------- */

export const FUEL_TRANSACTION_CONFIRMED_VERSION = 1;

/** What the receipt said, before anybody changed it. */
export interface FuelExtractedValues {
  gallonsThousandths?: number;
  totalCostCents?: Cents;
  pricePerGallonMills?: number;
  odometerMiles?: number;
  jurisdiction?: string;
  merchantName?: string;
  purchasedAt?: IsoDateTime;
}

/**
 * A fuel transaction that stands: newly recorded, verified, or corrected.
 *
 * One receipt produces ONE canonical transaction. A correction publishes again
 * with the next revision and `supersedesTransactionId` set — it never produces
 * a second receipt and never a second transaction lineage.
 */
export interface FuelTransactionConfirmedPayload {
  transactionId: string;
  /** Stable across every revision. The lineage a projection keys on. */
  originalTransactionId: string;
  revisionNumber: number;
  supersedesTransactionId?: string;
  /** Why the correction was made, when this is one. */
  correctionReason?: string;

  truckId: string;
  truckUnit?: string;
  driverProfileId?: string;
  loadId?: string;
  loadReference?: string;

  purchasedAt: IsoDateTime;
  jurisdiction: string;
  merchantName?: string;
  fuelType: FuelType;
  gallonsThousandths: number;
  pricePerGallonMills: number;
  totalCostCents: Cents;
  currency: CurrencyCode;
  odometerMiles?: number;
  qualifiesForIfta: boolean;
  receiptDocumentId?: string;

  verification: FactVerification;
  /** Present when a person changed what the receipt said. Both are kept. */
  extracted?: FuelExtractedValues;

  attribution: {
    carrierOrganizationId: string;
    carrierNameSnapshot: string;
    /** resolved | declared | unresolved — how the carrier was decided. */
    basis: string;
  };
}

/* -------------------------------------------------------------------------- */
/* equipment_meter.reading_recorded — v1                                       */
/* -------------------------------------------------------------------------- */

export const METER_READING_RECORDED_VERSION = 1;

/**
 * A reading was accepted into the canonical equipment meter ledger.
 *
 * Carries both the reading and the ledger's derived current values, because a
 * consumer almost always wants the second one and re-deriving it per consumer
 * is how three modules ended up with three different odometers.
 */
export interface MeterReadingRecordedPayload {
  readingId: string;
  equipmentKind: "truck" | "trailer";
  /** The permanent equipment UUID. Never a unit number. */
  equipmentId: string;
  equipmentLabel?: string;
  odometerMiles?: number;
  engineHours?: number;
  readAt: IsoDateTime;
  verification: FactVerification;
  confidence?: number;
  /** Set when this reading corrects an earlier one. History is never edited. */
  correctsReadingId?: string;
  /** The ledger's accepted values after this reading landed. */
  accepted: {
    odometerMiles?: number;
    odometerReadAt?: IsoDateTime;
    engineHours?: number;
    engineHoursReadAt?: IsoDateTime;
  };
}
