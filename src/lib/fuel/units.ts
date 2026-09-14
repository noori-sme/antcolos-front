/**
 * Fixed-point arithmetic for fuel.
 *
 * Every quantity that ends up in a tax figure is an integer in this codebase,
 * for the same reason money is: 0.1 + 0.2 is not 0.3, and a quarter that is off
 * by a thousandth of a gallon in forty jurisdictions is a quarter somebody has
 * to explain. Division rounds half away from zero, once, at the end.
 */

export const GALLON = 1000;
/** Dollars are 1000 mills. A pump price of $3.899 is 3899 mills. */
export const DOLLAR_MILLS = 1000;

/** Rounds half away from zero — never toward even, never toward the floor. */
export function roundHalfUp(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * Integer division that rounds the result rather than truncating it.
 * Returns 0 for a zero denominator: a rate over nothing is not infinity, it is
 * a figure that does not exist yet, and every caller renders it as "—".
 */
export function ratio(numerator: number, denominator: number, scale: number): number {
  if (denominator === 0) return 0;
  return roundHalfUp((numerator * scale) / denominator);
}

/** Miles per gallon in hundredths. 1_000 miles on 153.400 gal → 652 (6.52). */
export function mpgHundredths(miles: number, gallonsThousandths: number): number {
  if (gallonsThousandths === 0) return 0;
  return ratio(miles * GALLON, gallonsThousandths, 100);
}

/** Cost per mile in mills. $1,204.11 over 2,066 mi → 583 ($0.583/mi). */
export function costPerMileMills(totalCents: number, miles: number): number {
  if (miles === 0) return 0;
  return ratio(totalCents * 10, miles, 1);
}

/** Average price per gallon in mills across a set of purchases. */
export function averagePriceMills(totalCents: number, gallonsThousandths: number): number {
  if (gallonsThousandths === 0) return 0;
  return ratio(totalCents * 10 * GALLON, gallonsThousandths, 1);
}

/**
 * Gallons a fleet is deemed to have burned covering `miles` at `mpgHundredths`.
 * This is the IFTA calculation, and it is why fleet MPG has to be a single
 * fleet-wide number rather than a per-truck one.
 */
export function deemedGallonsThousandths(miles: number, mpg100: number): number {
  if (mpg100 === 0) return 0;
  return ratio(miles * GALLON * 100, mpg100, 1);
}

/** "153.400 gal" — three decimals, because that is what a return carries. */
export function formatGallons(thousandths: number, opts: { unit?: boolean } = {}): string {
  const value = (thousandths / GALLON).toLocaleString(undefined, {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
  return opts.unit === false ? value : `${value} gal`;
}

/** "$3.899" — pump prices carry a third decimal and rounding it away is wrong. */
export function formatPricePerGallon(mills: number): string {
  return `$${(mills / DOLLAR_MILLS).toFixed(3)}`;
}

/** "$0.583/mi" */
export function formatCostPerMile(mills: number): string {
  return `$${(mills / DOLLAR_MILLS).toFixed(3)}/mi`;
}

/** "6.52 MPG", or "—" when there is nothing to divide. */
export function formatMpg(hundredths: number): string {
  if (hundredths === 0) return "—";
  return `${(hundredths / 100).toFixed(2)} MPG`;
}

export function formatMiles(miles: number): string {
  return `${miles.toLocaleString()} mi`;
}

/** Parses "153.4" into 153400 thousandths. Returns null for anything else. */
export function parseGallons(input: string): number | null {
  const text = input.trim();
  if (!/^\d{1,6}(\.\d{1,3})?$/.test(text)) return null;
  return roundHalfUp(Number(text) * GALLON);
}

/** Parses "3.899" into 3899 mills. Returns null for anything else. */
export function parsePriceMills(input: string): number | null {
  const text = input.trim().replace(/^\$/, "");
  if (!/^\d{1,3}(\.\d{1,3})?$/.test(text)) return null;
  return roundHalfUp(Number(text) * DOLLAR_MILLS);
}

/** Parses "142.04" into 14204 cents. Returns null for anything else. */
export function parseCents(input: string): number | null {
  const text = input.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(text)) return null;
  return roundHalfUp(Number(text) * 100);
}

/** Parses a whole-mile figure. Returns null for anything else. */
export function parseMiles(input: string): number | null {
  const text = input.trim().replace(/,/g, "");
  if (!/^\d{1,7}$/.test(text)) return null;
  return Number(text);
}
