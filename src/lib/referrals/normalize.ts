/**
 * Normalizing a contact detail somebody typed about SOMEBODY ELSE.
 *
 * ★ THE RULE: NORMALIZE TO MATCH, NEVER TO ASSERT ★
 * These functions produce a key for "is this the same address we already have
 * an open referral to?". They never produce a corrected value to show anybody,
 * and they never conclude that two people are one person. Where normalization
 * would have to GUESS — a ten-digit number that might be US, might not; an
 * address with a plus-tag that some providers treat as the same mailbox and
 * others do not — the answer is `uncertain`, and an uncertain match is treated
 * as a DIFFERENT person.
 *
 * That asymmetry is deliberate and it costs something: two open referrals for
 * what is probably one person, rather than one referral silently attached to
 * the wrong one. The second failure is unrecoverable and invisible; the first
 * is a duplicate somebody can see.
 */

export interface NormalizedValue {
  /** The matching key. Empty when nothing usable was supplied. */
  key: string;
  /** Exactly what was typed, trimmed. What a person is shown. */
  submitted: string;
  valid: boolean;
  /**
   * True when normalization had to make an assumption to produce the key.
   *
   * Callers must not treat two uncertain keys as the same person. See
   * `sameCandidate` below, which refuses to.
   */
  uncertain: boolean;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Lower-cased and trimmed, and nothing else.
 *
 * Notably NOT done: stripping `+tags`, removing dots from the local part, or
 * folding known provider aliases. Every one of those is a provider-specific
 * policy, and applying it here would merge two addresses that a mail server
 * considers distinct — which, for a feature whose whole job is sending mail to
 * a stranger, means sending it to the wrong stranger.
 */
export function normalizeEmail(raw: string): NormalizedValue {
  const submitted = raw.trim();
  const key = submitted.toLowerCase();
  return { key, submitted, valid: EMAIL.test(key), uncertain: false };
}

/**
 * Digits, with the country code kept when the person supplied one.
 *
 * A number typed with a leading `+` is unambiguous and normalizes exactly. A
 * bare ten-digit number is ASSUMED North American to produce a key, and the
 * result is marked `uncertain` because that assumption is a guess about a
 * person whose phone we are about to hand to a company.
 */
export function normalizePhone(raw: string): NormalizedValue {
  const submitted = raw.trim();
  const hasPlus = submitted.startsWith("+");
  const digits = submitted.replace(/\D/g, "");

  if (digits.length < 7 || digits.length > 15) {
    return { key: "", submitted, valid: false, uncertain: false };
  }
  if (hasPlus) return { key: `+${digits}`, submitted, valid: true, uncertain: false };
  if (digits.length === 11 && digits.startsWith("1")) {
    return { key: `+${digits}`, submitted, valid: true, uncertain: false };
  }
  if (digits.length === 10) {
    // A guess, and marked as one.
    return { key: `+1${digits}`, submitted, valid: true, uncertain: true };
  }
  return { key: digits, submitted, valid: true, uncertain: true };
}

/**
 * Whether two submitted contacts are certainly the same person.
 *
 * EMAIL ONLY, and only on an exact normalized match. The phone is never enough
 * on its own — a shared office line, a recycled number or an uncertain country
 * code would each merge two people — and an uncertain email key is never enough
 * either. This is the frontend stand-in for a uniqueness rule, and it is
 * deliberately the conservative half of one.
 */
export function sameCandidate(
  a: { email: string; emailUncertain?: boolean },
  b: { email: string; emailUncertain?: boolean },
): boolean {
  if (a.emailUncertain || b.emailUncertain) return false;
  if (!a.email || !b.email) return false;
  return a.email === b.email;
}

/**
 * `a••••@example.com` — enough for the referrer to recognise what they typed,
 * not enough for a list of their referrals to become a contact export.
 */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "•••";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const head = local.slice(0, 1);
  return `${head}${"•".repeat(Math.max(3, local.length - 1))}${domain}`;
}
