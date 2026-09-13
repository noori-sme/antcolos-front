/**
 * VIN handling — the real world's identity for a vehicle.
 *
 * VIN is what stops two people creating two Antcolos records for one truck, so
 * it is normalized before it is ever compared. Everything here is pure: the
 * registry does the matching, this decides what a VIN *is*.
 */

/** I, O and Q are excluded from the VIN alphabet so they cannot be read as 1 and 0. */
const VIN_ALPHABET = /^[A-HJ-NPR-Z0-9]{17}$/;
export const VIN_LENGTH = 17;

/**
 * Uppercase, and strip the spaces and hyphens people type off a windscreen or
 * a registration document. Comparison and storage always use this form.
 */
export function normalizeVin(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]/g, "");
}

export function validateVin(raw: string): string | null {
  const vin = normalizeVin(raw);
  if (!vin) return "Enter the VIN.";
  if (vin.length !== VIN_LENGTH) {
    return `A VIN is exactly ${VIN_LENGTH} characters. You have ${vin.length}.`;
  }
  if (/[IOQ]/.test(vin)) {
    return "VINs never contain I, O or Q. Check for a 1 or a 0.";
  }
  if (!VIN_ALPHABET.test(vin)) {
    return "Use letters and numbers only — no spaces or punctuation.";
  }
  return null;
}

const TRANSLITERATION: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

/**
 * The ISO 3779 check digit, as an advisory rather than a gate.
 *
 * North American VINs carry one and a mismatch usually means a typo, but
 * plenty of legitimately imported vehicles do not conform. Blocking on it
 * would lock real trucks out of the system, so the form warns and lets the
 * person proceed.
 */
export function checkDigitMatches(raw: string): boolean | null {
  const vin = normalizeVin(raw);
  if (validateVin(vin)) return null;
  let total = 0;
  for (let i = 0; i < VIN_LENGTH; i += 1) {
    const char = vin[i];
    const value = /\d/.test(char) ? Number(char) : TRANSLITERATION[char];
    if (value === undefined) return null;
    total += value * WEIGHTS[i];
  }
  const remainder = total % 11;
  const expected = remainder === 10 ? "X" : String(remainder);
  return vin[8] === expected;
}

/** `1FTBW3XM8NKA51234` -> `1FT••••••••A51234`, enough to recognise, not to copy. */
export function maskVin(vin: string): string {
  const value = normalizeVin(vin);
  if (value.length <= 9) return value;
  return `${value.slice(0, 3)}${"•".repeat(8)}${value.slice(-6)}`;
}
