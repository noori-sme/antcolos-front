import type {
  Address, BrokerObservationState, ObservationConflict, Party,
  ReportedBrokerFields,
} from "@/types";
import type { AuthorityLookupResult } from "./authority";
import { normalizeAddressKey, normalizeCompanyName, normalizeMcNumber } from "./normalize";

/**
 * ★ A RATE CONFIRMATION DISCOVERS A CANDIDATE. IT DOES NOT CREATE AN IDENTITY ★
 *
 * This module holds every decision between "a document mentioned a broker" and
 * "a canonical broker profile exists", and it is pure: no store, no clock, no
 * network, no permission. The authority's answer is passed IN, which is what
 * makes the confirmed, not-found and unavailable paths all provable.
 *
 * The lifecycle it implements:
 *
 *   1. The document's values are preserved as an OBSERVATION, always, whatever
 *      happens next. An observation is a fact about a document and stays true
 *      forever, even when the register later contradicts it.
 *   2. Without a usable MC number there is nothing to resolve. The observation
 *      is kept for a person; no profile is created, ever.
 *   3. With an MC number that already resolves to a canonical profile, the
 *      observation attaches to THAT profile. Always the same one — that is
 *      requirement 6, and it is why the MC number is the key.
 *   4. With an MC number nothing resolves yet, the authority is asked.
 *      `confirmed` creates the one permanent profile from the AUTHORITY's
 *      fields. `not_found` and `unavailable` create nothing at all.
 *
 * ── WHY A DOCUMENT NEVER OVERWRITES AN OFFICIAL FIELD ─────────────────────
 * A rate confirmation that disagrees with the register is not a correction. It
 * is a disagreement, and it is recorded as one on the observation. The
 * canonical profile keeps the register's answer, the observation keeps the
 * document's, and a person can see both. Neither erases the other.
 */

/** What the caller should do with one observed broker block. */
export type BrokerResolution =
  | {
    /** Attach the observation to a canonical profile that already exists. */
    outcome: "attach";
    partyId: string;
    state: Extract<BrokerObservationState, "resolved" | "conflicted">;
    conflicts: ObservationConflict[];
    detail?: string;
  }
  | {
    /** Create the one permanent profile, from the AUTHORITY's fields. */
    outcome: "create";
    authority: Extract<AuthorityLookupResult, { status: "confirmed" }>;
    conflicts: ObservationConflict[];
    detail?: string;
  }
  | {
    /** Keep the observation. Create nothing. */
    outcome: "hold";
    state: Extract<BrokerObservationState, "pending_authority" | "conflicted" | "needs_review">;
    detail: string;
  };

/**
 * The canonical profile an MC number already resolves to, if any.
 *
 * Keyed on the OFFICIAL MC number, not on the party's general identifiers:
 * a broker profile's identity is the register's answer, and matching on
 * anything softer is how two documents about one company become two companies.
 */
export function canonicalForMc(
  mcNumber: string,
  parties: readonly Party[],
): Party | undefined {
  return parties.find(
    (p) => p.broker?.official?.mcNumber === mcNumber
      || (p.roles.includes("broker") && p.identifiers.mcNumber === mcNumber),
  );
}

const addressText = (address?: Address): string | undefined =>
  address ? [address.line1, address.city, address.state, address.postalCode]
    .filter(Boolean).join(", ") : undefined;

/**
 * Where the document and an official identity disagree.
 *
 * Name comparison is on the NORMALIZED form, so "Apex Logistics LLC" against
 * "Apex Logistics, L.L.C." is not reported as a conflict — punctuation is not
 * a disagreement, and a conflict list full of noise is a conflict list nobody
 * reads. A genuinely different trading name IS reported, because the same MC
 * number under two real names is exactly what a person needs to see.
 */
export function conflictsAgainstOfficial(
  reported: ReportedBrokerFields,
  official: { legalName: string; dbaName?: string; dotNumber?: string; address?: Address },
): ObservationConflict[] {
  const conflicts: ObservationConflict[] = [];

  const reportedName = normalizeCompanyName(reported.name);
  const officialName = normalizeCompanyName(official.legalName);
  const officialDba = normalizeCompanyName(official.dbaName);
  if (reportedName && officialName && reportedName !== officialName && reportedName !== officialDba) {
    conflicts.push({ field: "legalName", reported: reported.name, official: official.legalName });
  }

  const reportedDot = reported.dotNumber?.replace(/\D/g, "");
  if (reportedDot && official.dotNumber && reportedDot !== official.dotNumber) {
    conflicts.push({ field: "dotNumber", reported: reported.dotNumber, official: official.dotNumber });
  }

  const reportedAddress = normalizeAddressKey(reported.address);
  const officialAddress = normalizeAddressKey(official.address);
  if (reportedAddress && officialAddress && reportedAddress !== officialAddress) {
    conflicts.push({
      field: "address",
      reported: addressText(reported.address),
      official: addressText(official.address),
    });
  }

  return conflicts;
}

/**
 * Decide what one observed broker block becomes.
 *
 * `lookup` is the authority's answer and is only consulted when no canonical
 * profile exists yet — a profile already resolved for this MC is the answer,
 * and asking again on every rate confirmation would make the directory depend
 * on a service being up.
 */
export function resolveObservation(
  reported: ReportedBrokerFields,
  parties: readonly Party[],
  lookup: (mcNumber: string) => AuthorityLookupResult,
): BrokerResolution {
  const mcNumber = normalizeMcNumber(reported.mcNumber);

  if (!mcNumber) {
    return {
      outcome: "hold",
      state: "needs_review",
      detail:
        "The rate confirmation carried no MC number, so there is nothing to resolve against "
        + "the register. The observation is kept; a person decides which broker it refers to.",
    };
  }

  if (!normalizeCompanyName(reported.name)) {
    return {
      outcome: "hold",
      state: "needs_review",
      detail: "The company name on the rate confirmation is too short or generic to record.",
    };
  }

  /* -- Already canonical: always the same profile, forever ----------------- */

  const existing = canonicalForMc(mcNumber, parties);
  if (existing) {
    const official = existing.broker?.official;
    const conflicts = official ? conflictsAgainstOfficial(reported, official) : [];
    return {
      outcome: "attach",
      partyId: existing.partyId,
      // A disagreement is recorded on the OBSERVATION and changes nothing about
      // the profile. Two names on one MC number is one company with a naming
      // problem, never two companies.
      state: conflicts.length > 0 ? "conflicted" : "resolved",
      conflicts,
      detail: conflicts.length > 0
        ? `This document disagrees with the register on ${conflicts.map((c) => c.field).join(", ")}. `
          + "The profile keeps the register's answer and this document keeps its own."
        : undefined,
    };
  }

  /* -- Not canonical yet: ask the authority, and only the authority -------- */

  const answer = lookup(mcNumber);

  if (answer.status === "confirmed") {
    const conflicts = conflictsAgainstOfficial(reported, answer.official);
    return {
      outcome: "create",
      authority: answer,
      conflicts,
      detail: conflicts.length > 0
        ? "The profile was created from the register. This document's differing values are "
          + "kept on the observation rather than written onto it."
        : undefined,
    };
  }

  if (answer.status === "not_found") {
    return {
      outcome: "hold",
      state: "conflicted",
      detail:
        `The register has no entity for MC ${mcNumber}, which the rate confirmation printed. `
        + `${answer.detail} No profile was created; a person settles this.`,
    };
  }

  return {
    outcome: "hold",
    state: "pending_authority",
    detail: answer.detail,
  };
}
