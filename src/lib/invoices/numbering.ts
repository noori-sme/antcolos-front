/**
 * Invoice numbers are ORGANIZATION-SPECIFIC. Two carriers may both issue
 * INV-2026-0001 and they are different invoices; the only globally unique
 * identifier is the immutable UUID on the record.
 *
 * The sequence is per organization and per year, and it is never reused — a
 * voided invoice keeps its number so the gap in the sequence is visible rather
 * than silently filled, which is what an auditor expects to see.
 */

export interface InvoiceNumberParts {
  prefix: string;
  year: number;
  sequence: number;
}

const DEFAULT_PREFIX = "INV";
const PAD = 4;

export function formatInvoiceNumber(parts: InvoiceNumberParts): string {
  return `${parts.prefix}-${parts.year}-${String(parts.sequence).padStart(PAD, "0")}`;
}

/** Returns null for anything this organization did not issue in this format. */
export function parseInvoiceNumber(value: string): InvoiceNumberParts | null {
  const match = /^([A-Z]{2,6})-(\d{4})-(\d{4,})$/.exec(value.trim());
  if (!match) return null;
  return { prefix: match[1], year: Number(match[2]), sequence: Number(match[3]) };
}

/**
 * The next number for an organization, given every number it has already used.
 * Existing numbers are read, never rewritten: a carrier that migrated in with
 * INV-2026-0412 continues from 0413.
 */
export function nextInvoiceNumber(
  existingNumbers: readonly string[],
  options: { prefix?: string; year?: number } = {},
): string {
  const prefix = options.prefix ?? DEFAULT_PREFIX;
  const year = options.year ?? new Date().getFullYear();

  const highest = existingNumbers
    .map(parseInvoiceNumber)
    .filter((p): p is InvoiceNumberParts => p !== null)
    .filter((p) => p.prefix === prefix && p.year === year)
    .reduce((max, p) => Math.max(max, p.sequence), 0);

  return formatInvoiceNumber({ prefix, year, sequence: highest + 1 });
}
