import type { Address } from "@/types";

/**
 * Safe normalized identifiers.
 *
 * Matching two companies means comparing something, and the thing compared has
 * to be stable across the ways a document can print it. "TQL", "T.Q.L.",
 * "Total Quality Logistics, LLC" and "TOTAL QUALITY LOGISTICS LLC" are one
 * company; "MC-1142908", "mc 1142908" and "1142908" are one number.
 *
 * The word that does the work here is *safe*. Every function returns undefined
 * rather than a value it is not sure of, because a normalizer that guesses is
 * worse than no normalizer at all: a wrong key silently merges two companies,
 * and the merge surfaces weeks later as a load booked against the wrong broker.
 * So:
 *
 *   - A key shorter than a meaningful threshold is dropped, not returned. "A&B
 *     LLC" normalizes to "a b", which would match a hundred companies, so it
 *     produces no key at all and falls through to other signals.
 *   - Free email providers produce no domain key. Two dispatchers at
 *     gmail.com are not colleagues.
 *   - A phone number that is not a plausible North American number produces
 *     nothing rather than a truncated one.
 *   - An address key needs a street number AND a street name AND a city or a
 *     postal code. "Suite 200" alone is not a place.
 *
 * These functions are pure and have no knowledge of the store, so they are the
 * part of matching that can be reasoned about — and tested — on its own.
 */

/** Company suffixes that carry no identity. Stripped only at the end. */
const COMPANY_SUFFIXES = new Set([
  "llc", "l l c", "inc", "incorporated", "corp", "corporation", "co",
  "company", "ltd", "limited", "lp", "llp", "plc", "pllc", "gmbh", "sa", "nv",
  "holdings", "group", "intl", "international",
]);

/** Words inside a name that add nothing to identity but vary constantly. */
const COMPANY_NOISE = new Set([
  "the", "and", "of", "a", "an",
]);

/**
 * Providers whose domain says nothing about which company somebody works for.
 * An email at one of these is still useful as a whole address — just never as
 * a company-level signal.
 */
const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com",
  "outlook.com", "live.com", "msn.com", "aol.com", "icloud.com", "me.com",
  "mac.com", "protonmail.com", "proton.me", "gmx.com", "mail.com",
  "comcast.net", "att.net", "verizon.net", "sbcglobal.net", "bellsouth.net",
  "cox.net", "charter.net", "earthlink.net", "yandex.com", "zoho.com",
]);

/** Directional and street-type abbreviations, folded to one spelling. */
const STREET_ABBREVIATIONS: Record<string, string> = {
  street: "st", str: "st", st: "st",
  avenue: "ave", av: "ave", ave: "ave",
  boulevard: "blvd", blvd: "blvd",
  road: "rd", rd: "rd",
  drive: "dr", dr: "dr",
  lane: "ln", ln: "ln",
  court: "ct", ct: "ct",
  circle: "cir", cir: "cir",
  highway: "hwy", hwy: "hwy",
  parkway: "pkwy", pkwy: "pkwy",
  place: "pl", pl: "pl",
  terrace: "ter", ter: "ter",
  trail: "trl", trl: "trl",
  square: "sq", sq: "sq",
  suite: "ste", ste: "ste",
  north: "n", n: "n",
  south: "s", s: "s",
  east: "e", e: "e",
  west: "w", w: "w",
  northeast: "ne", ne: "ne",
  northwest: "nw", nw: "nw",
  southeast: "se", se: "se",
  southwest: "sw", sw: "sw",
};

/** Unit markers. A dock number is not part of a building's identity. */
const UNIT_MARKERS = new Set(["ste", "unit", "apt", "bldg", "building", "dock", "door", "#"]);

/** Lowercase, strip accents and punctuation, collapse whitespace. */
function basicClean(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function blank(value: string | undefined | null): boolean {
  return value === undefined || value === null || value.trim() === "";
}

/* -------------------------------------------------------------------------- */
/* Regulatory identifiers                                                      */
/* -------------------------------------------------------------------------- */

/**
 * An MC number, digits only.
 *
 * THE broker identifier: FMCSA issues exactly one per authority, so two
 * documents carrying the same MC number are the same broker. Everything else
 * about broker matching is a fallback for when it is missing.
 *
 * A plausible MC number is 4–8 digits. Anything outside that is a misread or
 * a different number entirely and produces nothing, so a bad value can never
 * become a decisive match.
 */
export function normalizeMcNumber(value?: string): string | undefined {
  if (blank(value)) return undefined;
  const digits = value!.replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length < 4 || digits.length > 8) return undefined;
  return digits;
}

/**
 * A USDOT number, digits only. 5–8 digits is the plausible range.
 *
 * Strong, but not quite the MC number: a broker and its affiliated carrier can
 * share a DOT number, so it corroborates rather than decides on its own.
 */
export function normalizeDotNumber(value?: string): string | undefined {
  if (blank(value)) return undefined;
  const digits = value!.replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length < 5 || digits.length > 8) return undefined;
  return digits;
}

/** A SCAC is exactly four letters. Anything else is not a SCAC. */
export function normalizeScac(value?: string): string | undefined {
  if (blank(value)) return undefined;
  const letters = value!.replace(/[^A-Za-z]/g, "").toUpperCase();
  return letters.length === 4 ? letters : undefined;
}

/* -------------------------------------------------------------------------- */
/* Company names                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A company name reduced to its identifying words.
 *
 * Suffixes go only from the end, so "LLC Freight Systems" keeps its first word
 * while "Freight Systems LLC" loses its last. Noise words go everywhere. What
 * is left has to be at least three characters and carry at least one word of
 * four or more characters, or it is too generic to key on — that rule is what
 * stops "A&B Co" and "AB Company" from colliding.
 */
export function normalizeCompanyName(value?: string): string | undefined {
  if (blank(value)) return undefined;
  const cleaned = basicClean(value!);
  if (!cleaned) return undefined;

  let words = cleaned.split(" ").filter((w) => !COMPANY_NOISE.has(w));

  /*
   * Suffixes are only meaningless at the end of a name, and stripping one can
   * expose another: "Group, L.L.C." is a spelled-out suffix hiding a plain one
   * behind it.
   *
   * These two rules used to run once each, in order, which made the same
   * company normalize two different ways — "Acme Group LLC" lost both words and
   * became "acme", while "Acme Group, L.L.C." dropped the letter run and then
   * stopped, keeping "acme group". Two keys for one company is exactly what
   * this function exists to prevent, so they run together until neither
   * applies.
   */
  for (;;) {
    if (words.length > 1 && COMPANY_SUFFIXES.has(words[words.length - 1])) {
      words = words.slice(0, -1);
      continue;
    }
    // "L L C" survives as three single-letter tokens; drop a trailing run.
    if (words.length > 3 && words.slice(-3).join(" ") === "l l c") {
      words = words.slice(0, -3);
      continue;
    }
    break;
  }

  const key = words.join(" ").trim();
  if (key.length < 3) return undefined;
  // A key of only very short words matches far too much to be safe.
  if (!words.some((w) => w.length >= 4) && key.replace(/ /g, "").length < 6) {
    return undefined;
  }
  return key;
}

/**
 * A person's name, for contact matching.
 *
 * Titles and honorifics go; middle initials go, because a document prints them
 * inconsistently. A single word is kept — "Dave" is weak but real, and the
 * matcher weights it accordingly rather than discarding it here.
 */
export function normalizePersonName(value?: string): string | undefined {
  if (blank(value)) return undefined;
  let cleaned = basicClean(value!);
  cleaned = cleaned
    .replace(/\b(mr|mrs|ms|miss|dr|sr|jr|ii|iii|iv)\b/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  const words = cleaned.split(" ").filter((w) => w.length > 1);
  if (words.length === 0) return undefined;
  const key = words.join(" ");
  return key.length >= 2 ? key : undefined;
}

/* -------------------------------------------------------------------------- */
/* Contact details                                                             */
/* -------------------------------------------------------------------------- */

/**
 * A North American phone number as ten digits.
 *
 * A leading country code 1 is dropped; an extension must already have been
 * split off by the caller, because "5551234567x204" and "5551234567" are the
 * same line and should match. Anything that is not ten digits after that is
 * not a number we can safely compare.
 */
export function normalizePhone(value?: string): string | undefined {
  if (blank(value)) return undefined;
  let digits = value!.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return undefined;
  // An area code never starts with 0 or 1.
  if (digits[0] === "0" || digits[0] === "1") return undefined;
  return digits;
}

/** A whole email address, lowercased. Safe to compare exactly. */
export function normalizeEmail(value?: string): string | undefined {
  if (blank(value)) return undefined;
  const trimmed = value!.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return undefined;
  return trimmed;
}

/**
 * The company part of an email address — a genuine company-level signal, since
 * two people at "@tql.com" work at the same place.
 *
 * Free providers produce nothing: two people at gmail.com share a provider,
 * not an employer, and treating that as a signal would merge every small
 * broker in the directory into one.
 */
export function normalizeEmailDomain(value?: string): string | undefined {
  const email = normalizeEmail(value);
  if (!email) return undefined;
  const domain = email.slice(email.indexOf("@") + 1);
  if (FREE_EMAIL_DOMAINS.has(domain)) return undefined;
  if (domain.length < 4) return undefined;
  return domain;
}

export function isFreeEmailDomain(value?: string): boolean {
  const email = normalizeEmail(value);
  if (!email) return false;
  return FREE_EMAIL_DOMAINS.has(email.slice(email.indexOf("@") + 1));
}

/* -------------------------------------------------------------------------- */
/* Addresses                                                                   */
/* -------------------------------------------------------------------------- */

/** A five-digit ZIP. ZIP+4 is truncated; anything else produces nothing. */
export function normalizePostalCode(value?: string): string | undefined {
  if (blank(value)) return undefined;
  const digits = value!.replace(/\D/g, "");
  if (digits.length < 5) return undefined;
  return digits.slice(0, 5);
}

/** Two-letter state code. Full state names are not guessed at. */
export function normalizeState(value?: string): string | undefined {
  if (blank(value)) return undefined;
  const letters = value!.replace(/[^A-Za-z]/g, "").toUpperCase();
  return letters.length === 2 ? letters : undefined;
}

export function normalizeCity(value?: string): string | undefined {
  if (blank(value)) return undefined;
  const cleaned = basicClean(value!);
  return cleaned.length >= 2 ? cleaned : undefined;
}

/**
 * The identifying part of a street line: the house number and the street name,
 * with the suite stripped and the street type folded to one spelling.
 *
 * The suite has to go. "1200 Industrial Blvd Ste 4" and "1200 Industrial
 * Boulevard" are the same building, and a facility is a building.
 */
export function normalizeStreet(value?: string): string | undefined {
  if (blank(value)) return undefined;
  const cleaned = basicClean(value!);
  if (!cleaned) return undefined;

  const words = cleaned.split(" ");
  const kept: string[] = [];
  for (const word of words) {
    const folded = STREET_ABBREVIATIONS[word] ?? word;
    if (UNIT_MARKERS.has(folded)) break; // Everything after a unit marker is a unit.
    kept.push(folded);
  }
  const key = kept.join(" ").trim();
  if (!key) return undefined;
  // A street line with no house number and no real word is not identifying.
  if (!/\d/.test(key) && key.length < 5) return undefined;
  return key;
}

/**
 * A whole address as one comparable key, or nothing.
 *
 * Requires a street AND (a postal code OR a city with a state). A key built
 * from a city alone would match every facility in Dallas, so this deliberately
 * refuses to produce one — the matcher then falls back to a city-level signal
 * that is weighted as the weak evidence it is.
 */
export function normalizeAddressKey(address?: Address): string | undefined {
  if (!address) return undefined;
  const street = normalizeStreet(address.line1);
  if (!street) return undefined;

  const postal = normalizePostalCode(address.postalCode);
  const city = normalizeCity(address.city);
  const state = normalizeState(address.state);

  if (postal) return `${street}|${postal}`;
  if (city && state) return `${street}|${city}|${state}`;
  return undefined;
}

/** City + state, the weak locality signal. Never identifying on its own. */
export function normalizeLocalityKey(address?: Address): string | undefined {
  if (!address) return undefined;
  const city = normalizeCity(address.city);
  const state = normalizeState(address.state);
  if (!city || !state) return undefined;
  return `${city}|${state}`;
}

/* -------------------------------------------------------------------------- */
/* Similarity                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Token overlap between two normalized names, 0–1 (Jaccard).
 *
 * Used only to tell a dispatcher that two names look related — "Blue Ridge
 * Foods" against "Blue Ridge Foods Distribution". It never produces a decisive
 * signal on its own, which is why a cheap set measure is honest enough here:
 * a fuzzier metric would invite exactly the automatic merge this module is
 * built to refuse.
 */
export function nameSimilarity(a?: string, b?: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const setA = new Set(a.split(" "));
  const setB = new Set(b.split(" "));
  let shared = 0;
  for (const token of setA) if (setB.has(token)) shared += 1;
  const union = setA.size + setB.size - shared;
  return union === 0 ? 0 : shared / union;
}
