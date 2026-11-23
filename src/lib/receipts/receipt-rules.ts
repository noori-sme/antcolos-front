import type { PredictedField, Receipt, ReceiptFailure, ReceiptKindView } from "@/types/receipt";

/**
 * Pure receipt helpers for the screens (F2.1). Amounts are the contract's
 * decimal strings: they are formatted as text, never parsed to floats.
 */

export const KIND_LABEL: Record<ReceiptKindView, string> = {
  FUEL: "Fuel",
  REPAIR: "Repair",
  TOLL: "Toll",
  UNKNOWN: "Receipt",
};

/** Plain words for what the model read (the hub's schema paths). */
const FIELD_LABEL: Record<string, string> = {
  totalAmount: "Total",
  subtotal: "Subtotal",
  quantity: "Gallons",
  quantityUnit: "Unit",
  unitPrice: "Price per gallon",
  purchasedAt: "Date and time",
  purchaseDate: "Date",
  purchaseTimeLocal: "Time",
  merchantName: "Vendor",
  stationBrand: "Brand",
  "merchantAddress.city": "City",
  "merchantAddress.state": "State",
  "merchantAddress.raw": "Address",
  fuelType: "Fuel type",
  currency: "Currency",
  paymentMethod: "Paid with",
  cardLast4: "Card ending",
  odometer: "Odometer",
  unitNumber: "Unit on the receipt",
  pumpNumber: "Pump",
  transactionNumber: "Transaction",
};

/** A known label, else the path made readable ("merchantAddress.zip" → "merchant address zip"). */
export function fieldLabel(field: Pick<PredictedField, "path">): string {
  return (
    FIELD_LABEL[field.path] ??
    field.path.replace(/\./g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()
  );
}

/** How long the screens wait on a receipt being read before saying it is slow. */
export const READING_PATIENCE_MS = 120_000;

/** True once a receipt has been "reading" for longer than it should. */
export function readingTooLong(receipt: Pick<Receipt, "status" | "createdAt">, now: number): boolean {
  return receipt.status === "EXTRACTING" && now - Date.parse(receipt.createdAt) >= READING_PATIENCE_MS;
}

/** What a person should look at, in plain words, per backend failure code. */
export const FAILURE_TEXT: Record<ReceiptFailure, string> = {
  TOTAL_MISSING: "The total could not be read.",
  TOTAL_LOW_CONFIDENCE: "The total is not clear enough to trust.",
  DATE_MISSING: "The date could not be read.",
  DATE_LOW_CONFIDENCE: "The date is not clear enough to trust.",
  DATE_IN_FUTURE: "The date read is in the future.",
  DATE_TOO_OLD: "The date read is older than expected for this trip.",
  QUANTITY_MISSING: "The gallons could not be read.",
  QUANTITY_LOW_CONFIDENCE: "The gallons are not clear enough to trust.",
  UNIT_PRICE_MISSING: "The price per gallon could not be read.",
  UNIT_PRICE_LOW_CONFIDENCE: "The price per gallon is not clear enough to trust.",
  ARITHMETIC_MISMATCH: "Gallons times price does not match the total.",
  NOT_GALLONS: "The receipt is in liters.",
  NOT_USD: "The receipt is not in US dollars.",
  KIND_NOT_READ: "Repair and toll receipts are entered by hand for now.",
  EXTRACTION_FAILED: "The receipt could not be read. Enter it by hand.",
};

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const QUANTITY = /^\d{1,7}(\.\d{1,3})?$/;
const UNIT_PRICE = /^\d{1,6}(\.\d{1,4})?$/;

/** The contract's decimal patterns, so the form never sends what the API refuses. */
export const isMoney = (v: string): boolean => MONEY.test(v);
export const isQuantity = (v: string): boolean => QUANTITY.test(v);
export const isUnitPrice = (v: string): boolean => UNIT_PRICE.test(v);

/** "1234.5" → "$1,234.50"; null → "—". String work only, no floats. */
export function formatMoney(amount: string | null, currency = "USD"): string {
  if (amount === null || !/^-?\d+(\.\d+)?$/.test(amount)) return "—";
  const negative = amount.startsWith("-");
  const [whole, fraction = ""] = amount.replace("-", "").split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = (fraction + "00").slice(0, 2);
  const symbol = currency === "USD" ? "$" : `${currency} `;
  return `${negative ? "-" : ""}${symbol}${grouped}.${cents}`;
}

/** Trailing zeros dropped for display: "100.000" → "100", "4.1250" → "4.125". */
export function trimDecimal(value: string | null): string {
  if (value === null) return "—";
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}

export interface Viewer {
  userId: string;
  canReview: boolean;
  canConfirmOwn: boolean;
}

/** Who may confirm this receipt now; the backend decides again. */
export function canConfirm(receipt: Receipt, viewer: Viewer): boolean {
  if (receipt.status !== "PENDING_REVIEW") return false;
  return viewer.canReview || (viewer.canConfirmOwn && receipt.driverUserId === viewer.userId);
}

export function canReject(receipt: Receipt, viewer: Viewer): boolean {
  return receipt.status === "PENDING_REVIEW" && viewer.canReview;
}
