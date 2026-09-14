import type { Cents } from "@/types";

/**
 * Money arithmetic for settlements. Integer cents only — there is no float
 * anywhere in this file, and nothing that returns one.
 *
 * The reason is not pedantry. `0.1 + 0.2` is `0.30000000000000004`, and a
 * settlement that is one cent out is a settlement a driver disputes. Every
 * rate is held as an integer (cents, or basis points) and every result is
 * rounded exactly once, at the point it becomes money.
 */

/** 100% in basis points. 2800 bps = 28.00%. */
export const BASIS_POINTS_SCALE = 10_000;

/** The engine's identity, stamped onto every snapshot it produces. */
export const CALCULATION_ENGINE_VERSION = "settlement-engine/1.0.0";

function assertSafeInteger(value: number, what: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new RangeError(`${what} must be an integer, received ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${what} exceeds safe integer range: ${value}`);
  }
}

/**
 * Rounds half away from zero — the convention a carrier and a driver both
 * expect, and the one a paper statement uses. Banker's rounding would settle
 * half-cents to even and quietly disagree with the payee's own arithmetic.
 */
function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * Applies a basis-point rate to an amount, rounding once, at the end.
 *
 * Percentage pay is the single most disputed number on a settlement, so the
 * rounding happens here and nowhere else: every caller that needs "x% of y"
 * gets the same cent.
 */
export function applyBasisPoints(amountCents: Cents, basisPoints: number): Cents {
  assertSafeInteger(amountCents, "amountCents");
  assertSafeInteger(basisPoints, "basisPoints");
  if (basisPoints < 0) {
    throw new RangeError(`basisPoints must not be negative, received ${basisPoints}`);
  }
  const result = roundHalfAwayFromZero((amountCents * basisPoints) / BASIS_POINTS_SCALE);
  assertSafeInteger(result, "basis point result");
  return result;
}

/** Per-mile pay. Both operands are integers, so the product is exact. */
export function perMileAmount(rateCents: Cents, miles: number): Cents {
  assertSafeInteger(rateCents, "rateCents");
  assertSafeInteger(miles, "miles");
  if (rateCents < 0) throw new RangeError(`rateCents must not be negative, received ${rateCents}`);
  if (miles < 0) throw new RangeError(`miles must not be negative, received ${miles}`);
  const result = rateCents * miles;
  assertSafeInteger(result, "per-mile result");
  return result;
}

/** Adds a list of cent amounts, checking the running total stays exact. */
export function sumCents(amounts: readonly Cents[]): Cents {
  let total = 0;
  for (const amount of amounts) {
    assertSafeInteger(amount, "amountCents");
    total += amount;
  }
  assertSafeInteger(total, "sum");
  return total;
}

/** Sums one numeric field across a list, without an intermediate array. */
export function sumBy<T>(items: readonly T[], pick: (item: T) => Cents): Cents {
  return sumCents(items.map(pick));
}

/**
 * Rate per mile, for display. Returns 0 rather than dividing by zero — a
 * settlement with no miles (a dispatcher's commission, say) has no rate per
 * mile, and Infinity on a statement helps nobody.
 */
export function centsPerMile(amountCents: Cents, miles: number): Cents {
  assertSafeInteger(amountCents, "amountCents");
  assertSafeInteger(miles, "miles");
  if (miles <= 0) return 0;
  return roundHalfAwayFromZero(amountCents / miles);
}

/** "28.00%" from 2800 basis points. Display only. */
export function formatBasisPoints(basisPoints: number): string {
  const whole = Math.trunc(basisPoints / 100);
  const fraction = Math.abs(basisPoints % 100);
  return `${whole}.${String(fraction).padStart(2, "0")}%`;
}
