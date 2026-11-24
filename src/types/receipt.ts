/**
 * Receipts as the NestJS API returns them (backend plan 50,
 * ../antcolos/docs/requirements/receipts-api-contract.md). Money and
 * quantities stay the contract's decimal strings; nothing here is a float.
 */

export const RECEIPT_KINDS = ["FUEL", "REPAIR", "TOLL"] as const;
export type ReceiptKind = (typeof RECEIPT_KINDS)[number];
/** A kind this build does not know yet is shown as such, never as another kind. */
export type ReceiptKindView = ReceiptKind | "UNKNOWN";

export const RECEIPT_STATUSES = ["EXTRACTING", "PENDING_REVIEW", "CONFIRMED", "REJECTED"] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];
/** A status this build does not know yet: shown, never acted on. */
export type ReceiptStatusView = ReceiptStatus | "UNKNOWN";

/** Why the system left a receipt for a person (contract: Receipt detail). */
export const RECEIPT_FAILURES = [
  "TOTAL_MISSING", "TOTAL_LOW_CONFIDENCE", "DATE_MISSING", "DATE_LOW_CONFIDENCE",
  "DATE_IN_FUTURE", "DATE_TOO_OLD", "QUANTITY_MISSING", "QUANTITY_LOW_CONFIDENCE",
  "UNIT_PRICE_MISSING", "UNIT_PRICE_LOW_CONFIDENCE", "ARITHMETIC_MISMATCH", "NOT_GALLONS",
  "NOT_USD", "KIND_NOT_READ", "EXTRACTION_FAILED",
] as const;
export type ReceiptFailure = (typeof RECEIPT_FAILURES)[number];

export interface Receipt {
  id: string;
  documentId: string;
  kind: ReceiptKindView;
  status: ReceiptStatusView;
  truckId: string | null;
  loadId: string | null;
  driverUserId: string;
  purchasedAt: string | null;
  /** Decimal strings: 2 places for money, 3 for gallons, 4 for unit price. */
  totalAmount: string | null;
  currency: string;
  vendor: string | null;
  city: string | null;
  state: string | null;
  gallons: string | null;
  unitPrice: string | null;
  category: string | null;
  partsAmount: string | null;
  laborAmount: string | null;
  odometerMiles: number | null;
  arithmeticWarning: boolean;
  rejectReason: string | null;
  /** null when the system confirmed it. */
  confirmedByUserId: string | null;
  confirmedAt: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

/** What the model read, never overwritten by a correction. */
export interface PredictedField {
  path: string;
  value: string | number | boolean | null;
  confidence: number | null;
}

export interface ReceiptDetail extends Receipt {
  fields: PredictedField[];
  /** Known failure codes only; an unknown code is left out, not guessed. */
  failures: ReceiptFailure[];
}

export interface ReceiptFilters {
  status?: ReceiptStatus;
  kind?: ReceiptKind;
  truckId?: string;
  loadId?: string;
  page: number;
  pageSize: number;
}

export interface UploadReceiptInput {
  file: File;
  kind: ReceiptKind;
  truckId?: string;
  loadId?: string;
}

/** Optional corrections; `null` clears a value, an absent key keeps what was read. */
export interface ConfirmReceiptInput {
  purchasedAt?: string;
  totalAmount?: string;
  gallons?: string | null;
  unitPrice?: string | null;
  partsAmount?: string | null;
  laborAmount?: string | null;
  vendor?: string | null;
  city?: string | null;
  state?: string | null;
  category?: string | null;
  odometerMiles?: number | null;
}

/** An upload answers 202 for a new receipt and 200 for a file this organization already has. */
export interface UploadReceiptResult {
  receipt: Receipt;
  duplicate: boolean;
}
