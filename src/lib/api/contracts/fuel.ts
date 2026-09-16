import type {
  Document, FuelAuditEntry, FuelDashboard, FuelSharingGrant, FuelStopLocation,
  FuelTransaction, FuelTransactionFilters, FuelType, IftaPeriodSummary,
  Jurisdiction, JurisdictionMileageRecord, MileageRecordFilters, Quarter,
} from "@/types";
import type { IntegrationDescriptor } from "@/lib/fuel/integrations";
import type { ServiceContext } from "./context";

/**
 * The Fuel & IFTA seam.
 *
 * Two services, deliberately not one. `FuelService` owns purchases and
 * jurisdiction mileage — the operational ledger. `IftaService` owns the
 * quarterly return built out of them. Splitting them is what lets a dispatch
 * organization be given the first and refused the second, which is a
 * requirement rather than a nicety.
 *
 * There is no `updateTransaction` and there never will be. A recorded purchase
 * is immutable; `correctTransaction` writes a new revision and supersedes the
 * old one, and every read that produces a figure counts current revisions only.
 */

/* -------------------------------------------------------------------------- */
/* Inputs                                                                      */
/* -------------------------------------------------------------------------- */

export interface RecordFuelPurchaseInput {
  /** The permanent Truck UUID. The service checks the caller may see it. */
  truckId: string;
  driverProfileId?: string;
  loadId?: string;
  purchasedAt: string;
  location: FuelStopLocation;
  odometerMiles?: number;
  fuelType: FuelType;
  gallonsThousandths: number;
  pricePerGallonMills: number;
  totalCostCents: number;
  /** An existing Document. Fuel never uploads a file of its own. */
  receiptDocumentId?: string;
  notes?: string;
  /**
   * Used ONLY when the operating-authority history cannot resolve who was
   * responsible. Supplying it when the history is clear is rejected — a person
   * may fill a gap, never overrule the record.
   */
  declaredCarrierOrganizationId?: string;
  /**
   * What an extractor read off the receipt, when the values above came from
   * one and a person changed some of them before saving.
   *
   * Kept beside the values that stand rather than thrown away, so the
   * transaction can always answer "the receipt said X and somebody entered Y".
   * Absent when nothing was extracted — a purchase typed in from scratch has no
   * original to differ from. Nothing in this build extracts anything: the
   * receipt uploader records a file's name, type and size and discards the file.
   */
  extracted?: ExtractedReceiptValues;
}

/** What a receipt extractor read, before a person touched it. */
export interface ExtractedReceiptValues {
  gallonsThousandths?: number;
  totalCostCents?: number;
  pricePerGallonMills?: number;
  odometerMiles?: number;
  jurisdiction?: string;
  merchantName?: string;
  purchasedAt?: string;
}

/**
 * What a correction may change.
 *
 * Note what is absent: the truck and the carrier. A purchase recorded against
 * the wrong truck is not a correction, it is a rejection plus a new record —
 * and moving attribution to another carrier after the fact is the exact
 * rewriting of history the module exists to prevent.
 */
export interface CorrectFuelPurchaseInput {
  /** Required. A correction without a stated reason is an overwrite. */
  reason: string;
  purchasedAt?: string;
  location?: FuelStopLocation;
  odometerMiles?: number;
  fuelType?: FuelType;
  gallonsThousandths?: number;
  pricePerGallonMills?: number;
  totalCostCents?: number;
  driverProfileId?: string;
  loadId?: string;
  receiptDocumentId?: string;
  notes?: string;
}

export interface RecordMileageInput {
  truckId: string;
  driverProfileId?: string;
  loadId?: string;
  jurisdiction: Jurisdiction;
  travelStartedAt: string;
  travelEndedAt: string;
  totalMiles: number;
  taxableMiles: number;
  odometerStartMiles?: number;
  odometerEndMiles?: number;
  notes?: string;
  declaredCarrierOrganizationId?: string;
}

export interface CorrectMileageInput {
  reason: string;
  jurisdiction?: Jurisdiction;
  travelStartedAt?: string;
  travelEndedAt?: string;
  totalMiles?: number;
  taxableMiles?: number;
  odometerStartMiles?: number;
  odometerEndMiles?: number;
  notes?: string;
}

export interface RecordFilingInput {
  /** What the filer typed off the jurisdiction's own confirmation. */
  confirmationReference?: string;
  filedAt?: string;
  note?: string;
}

/* -------------------------------------------------------------------------- */
/* Read shapes                                                                 */
/* -------------------------------------------------------------------------- */

/** A purchase with everything needed to judge it, in one call. */
export interface FuelTransactionDetail {
  transaction: FuelTransaction;
  /** The whole correction chain, oldest first. Always at least one entry. */
  revisions: FuelTransaction[];
  /** Append-only audit for this record. */
  audit: FuelAuditEntry[];
  /** The receipt, when one is attached. */
  receipt: Document | null;
  /** The purchase this one appears to duplicate, when there is a candidate. */
  duplicateOf: FuelTransaction | null;
}

export interface MileageRecordDetail {
  record: JurisdictionMileageRecord;
  revisions: JurisdictionMileageRecord[];
  audit: FuelAuditEntry[];
}

/**
 * The honest result of asking an adapter for data.
 *
 * Every adapter is unimplemented, so every call returns `not_connected` with
 * the descriptor that says what it would do. There is no code path that
 * returns rows, which is why no screen can imply an import happened.
 */
export interface FuelImportResult {
  status: "not_connected";
  adapter: IntegrationDescriptor;
  message: string;
}

export interface FuelDashboardWindow {
  /** Whole quarters, or a rolling window. Defaults to the current quarter. */
  kind: "current_quarter" | "last_90_days" | "period";
  year?: number;
  quarter?: Quarter;
}

/* -------------------------------------------------------------------------- */
/* Services                                                                    */
/* -------------------------------------------------------------------------- */

export interface FuelService {
  /**
   * Everything the dashboard shows, in one organization-scoped call.
   * Requires `fuel:view`. Money is null without `fuel:costs:view`.
   */
  dashboard(ctx: ServiceContext, window?: FuelDashboardWindow): Promise<FuelDashboard>;

  /** Requires `fuel:view`. Superseded revisions are hidden by default. */
  listTransactions(
    ctx: ServiceContext,
    filters?: FuelTransactionFilters,
  ): Promise<FuelTransaction[]>;

  getTransaction(ctx: ServiceContext, transactionId: string): Promise<FuelTransactionDetail>;

  /** Requires `fuel:record`. Resolves attribution from authority history. */
  recordTransaction(ctx: ServiceContext, input: RecordFuelPurchaseInput): Promise<FuelTransaction>;

  /** Requires `fuel:review`. */
  verifyTransaction(ctx: ServiceContext, transactionId: string): Promise<FuelTransaction>;
  rejectTransaction(ctx: ServiceContext, transactionId: string, reason: string): Promise<FuelTransaction>;
  /**
   * Record that the carrier behind a purchase cannot be established.
   *
   * The one ending available to a purchase whose operating authority the
   * canonical records do not cover. Requires `fuel:review` and the caller's own
   * ledger. It names no carrier, leaves `attribution` exactly as it was, and
   * contributes nothing to the Equipment Meter Ledger — it records that
   * somebody entitled to look has looked and found no evidence either way.
   *
   * Refused when the records DO establish the carrier, and refused when the
   * obstacle is authority rather than evidence: neither of those is a thing a
   * reviewer can conclude, and a refusal code on its own is not proof that an
   * answer can never be found.
   *
   * Calling it twice while the finding still stands changes nothing and writes
   * no second audit line.
   */
  acceptAttributionNotEstablishable(
    ctx: ServiceContext,
    transactionId: string,
    reason: string,
  ): Promise<FuelTransaction>;
  /**
   * The same finding for a jurisdiction leg, on the same terms.
   *
   * Requires `mileage:review` — the permission that reviews mileage — and
   * otherwise behaves exactly as the purchase version: no carrier named, the
   * attribution snapshot untouched, no meter reading contributed, refused where
   * the records answer or where the obstacle is authority.
   */
  acceptMileageAttributionNotEstablishable(
    ctx: ServiceContext,
    recordId: string,
    reason: string,
  ): Promise<JurisdictionMileageRecord>;
  markDuplicate(ctx: ServiceContext, transactionId: string, duplicateOfId: string): Promise<FuelTransaction>;

  /** Requires `fuel:correct`. Returns the NEW revision, never the original. */
  correctTransaction(
    ctx: ServiceContext,
    transactionId: string,
    input: CorrectFuelPurchaseInput,
  ): Promise<FuelTransaction>;

  /** Requires `documents:upload`. Links an existing Document as the receipt. */
  attachReceipt(
    ctx: ServiceContext,
    transactionId: string,
    documentId: string,
  ): Promise<FuelTransaction>;

  /** Requires `mileage:view`. */
  listMileage(
    ctx: ServiceContext,
    filters?: MileageRecordFilters,
  ): Promise<JurisdictionMileageRecord[]>;

  getMileage(ctx: ServiceContext, recordId: string): Promise<MileageRecordDetail>;

  /** Requires `mileage:record`. */
  recordMileage(ctx: ServiceContext, input: RecordMileageInput): Promise<JurisdictionMileageRecord>;

  /** Requires `mileage:review`. */
  verifyMileage(ctx: ServiceContext, recordId: string): Promise<JurisdictionMileageRecord>;
  rejectMileage(ctx: ServiceContext, recordId: string, reason: string): Promise<JurisdictionMileageRecord>;
  correctMileage(
    ctx: ServiceContext,
    recordId: string,
    input: CorrectMileageInput,
  ): Promise<JurisdictionMileageRecord>;

  /** Requires `fuel:import`. Always reports the adapter is not connected. */
  runImport(ctx: ServiceContext, adapterId: string): Promise<FuelImportResult>;

  /** Every extension point and its honest status. Requires `fuel:view`. */
  integrations(ctx: ServiceContext): Promise<IntegrationDescriptor[]>;

  /** The append-only audit trail, newest first. Requires `fuel:view`. */
  audit(ctx: ServiceContext, subjectId?: string): Promise<FuelAuditEntry[]>;

  /**
   * What this organization shares with dispatch organizations — or, for a
   * dispatch organization, what has been shared with it.
   */
  sharingGrants(ctx: ServiceContext): Promise<FuelSharingGrant[]>;
}

export interface IftaService {
  /** Requires `ifta:view`, and for a dispatch organization an explicit grant. */
  listPeriods(ctx: ServiceContext): Promise<IftaPeriodSummary[]>;
  getPeriod(ctx: ServiceContext, periodId: string): Promise<IftaPeriodSummary>;

  /**
   * Requires `ifta:manage`. Records that a person filed the quarter SOMEWHERE
   * ELSE. Antcolos submits nothing and pays nothing; this writes down what
   * happened and locks the quarter.
   */
  recordFiling(
    ctx: ServiceContext,
    periodId: string,
    input: RecordFilingInput,
  ): Promise<IftaPeriodSummary>;

  /** Requires `ifta:manage`. Opens an amendment on an already-filed quarter. */
  amendPeriod(ctx: ServiceContext, periodId: string, reason: string): Promise<IftaPeriodSummary>;
}
