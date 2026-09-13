/**
 * Shared primitives for every Antcolos entity.
 *
 * Conventions that apply everywhere and are not repeated per field:
 *  - IDs are opaque strings. Never parse them, never infer meaning from them.
 *  - Timestamps are ISO 8601 with an explicit offset, stored in UTC.
 *    Local wall-clock time is derived for display using the relevant
 *    organization's or stop's time zone — never stored.
 *  - Money is an integer count of minor units (cents) plus a currency code.
 *    No floats anywhere in the money path.
 *  - Distances are whole miles. Weights are whole pounds.
 */

/** ISO 8601 instant with offset, e.g. "2026-09-13T18:40:00.000Z". */
export type IsoDateTime = string;

/** IANA time zone, e.g. "America/Chicago". */
export type TimeZone = string;

export type CurrencyCode = "USD";

/** Integer minor units. 224000 === $2,240.00 USD. */
export type Cents = number;

export interface Money {
  amount: Cents;
  currency: CurrencyCode;
}

export interface Address {
  line1?: string;
  line2?: string;
  city: string;
  /** Two-letter state or province code. */
  state: string;
  postalCode?: string;
  /** ISO 3166-1 alpha-2. Defaults to "US" when absent. */
  country?: string;
}

export interface Contact {
  name?: string;
  phone?: string;
  email?: string;
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** Where a record or event came from. Status history is honest about this. */
export type EventSource = "web" | "telegram" | "eld" | "ocr" | "email" | "api" | "system";

/**
 * Pagination envelope for every list endpoint. Cursor-based so a growing
 * collection does not shift under a paging client.
 */
export interface Page<T> {
  items: T[];
  /** Absent when there is no further page. */
  nextCursor?: string;
  /** Total matching the filter, when the backend can supply it cheaply. */
  totalCount?: number;
}

export interface PageRequest {
  limit?: number;
  cursor?: string;
}
