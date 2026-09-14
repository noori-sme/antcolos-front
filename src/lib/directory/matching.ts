import type {
  ContactMatchCandidate, ExtractedContact, ExtractedFacility, ExtractedParty,
  Facility, FacilityMatchCandidate, MatchConfidence, MatchConflict, MatchSignal,
  Party, PartyContact, PartyMatchCandidate, PartyRole, ResolutionRecommendation,
} from "@/types";
import {
  nameSimilarity, normalizeAddressKey, normalizeCompanyName, normalizeDotNumber,
  normalizeEmail, normalizeEmailDomain, normalizeLocalityKey, normalizeMcNumber,
  normalizePersonName, normalizePhone, normalizePostalCode, normalizeScac,
  normalizeStreet,
} from "./normalize";

/**
 * Entity resolution: deciding which permanent record a name on a rate
 * confirmation refers to.
 *
 * The shape of the problem is not "how similar are these two strings". It is
 * that some evidence is issued by an authority and some is typed by a broker's
 * assistant, and those two kinds of evidence cannot be added up on the same
 * scale. So signals here are of two sorts:
 *
 *   Decisive   An identifier that exists to be unique. An MC number is issued
 *              once. If it matches, that is the company — no accumulation of
 *              soft signals can outvote it, and no absence of them can weaken
 *              it. This is the rule the broker path is built around.
 *
 *   Soft       Names, addresses, phone numbers, email domains. Each is real
 *              evidence and none is sufficient. They accumulate, and the tiers
 *              below are set so that one alone can never reach "strong".
 *
 * And one kind of negative evidence:
 *
 *   Conflict   Two different MC numbers is not weak evidence of a match, it is
 *              positive evidence against one. A conflict on a decisive
 *              identifier eliminates the candidate outright rather than
 *              lowering its score, because a shared name plus a different MC
 *              number is the exact shape of two real, different companies.
 *
 * Nothing in this file reads or writes the store, and nothing in it decides to
 * merge anything. It ranks, explains, and recommends; the registry asks a
 * dispatcher.
 */

/* -------------------------------------------------------------------------- */
/* Weights and tiers                                                           */
/* -------------------------------------------------------------------------- */

const WEIGHT = {
  /** Decisive on its own. The score is a formality once this fires. */
  mcNumber: 100,
  /** Very strong. A broker and an affiliated carrier can share one, so not decisive. */
  dotNumber: 60,
  scac: 55,
  exactName: 30,
  /**
   * Scaled by similarity, so this is the ceiling rather than the usual value.
   * It has to clear POSSIBLE_THRESHOLD at a realistic similarity — "Tandem
   * Freight" against "Tandem Freight Partners Inc." is the single most common
   * shape of freight paperwork, and a weight that could never surface it would
   * make this signal decorative. It stays far below STRONG_THRESHOLD, so a
   * resemblance still cannot do anything on its own except get looked at.
   */
  similarName: 24,
  addressKey: 30,
  street: 18,
  postalCode: 8,
  locality: 6,
  phone: 25,
  email: 35,
  emailDomain: 18,
} as const;

/**
 * Where the tiers sit.
 *
 * `STRONG` is deliberately above the largest single soft weight (email, 35), so
 * no lone soft signal can reach it — two independent things must agree before
 * the word "strong" is used about a guess.
 */
const STRONG_THRESHOLD = 48;
const POSSIBLE_THRESHOLD = 14;

/** A candidate this far below the leader is not a real alternative. */
const RUNNER_UP_MARGIN = 25;

function tier(score: number, decisive: boolean): MatchConfidence {
  if (decisive) return "exact";
  if (score >= STRONG_THRESHOLD) return "strong";
  if (score >= POSSIBLE_THRESHOLD) return "possible";
  return "none";
}

function signal(
  code: string,
  label: string,
  weight: number,
  decisive = false,
): MatchSignal {
  return { code, label, weight, decisive };
}

/* -------------------------------------------------------------------------- */
/* Party matching                                                              */
/* -------------------------------------------------------------------------- */

interface PartyScore {
  score: number;
  decisive: boolean;
  signals: MatchSignal[];
  conflicts: MatchConflict[];
  /** Set when a conflict makes the candidate impossible, not merely weaker. */
  eliminated: boolean;
}

/**
 * Score one extracted company against one stored party.
 *
 * Exported because the explanation it produces is shown to the dispatcher —
 * the reason a match is proposed is part of the proposal, not an internal
 * detail. A match nobody can see the reasoning for is a match nobody can
 * sensibly confirm.
 */
export function scoreParty(
  extracted: ExtractedParty,
  candidate: Party,
  role: PartyRole,
): PartyScore {
  const signals: MatchSignal[] = [];
  const conflicts: MatchConflict[] = [];
  let score = 0;
  let decisive = false;
  let eliminated = false;

  // ---- Regulatory identifiers -------------------------------------------
  const mc = normalizeMcNumber(extracted.mcNumber);
  const candidateMc = candidate.identifiers.mcNumber;
  if (mc && candidateMc) {
    if (mc === candidateMc) {
      score += WEIGHT.mcNumber;
      decisive = true;
      signals.push(signal("mc_number", `MC number ${mc} matches exactly`, WEIGHT.mcNumber, true));
    } else {
      // Two different authorities. Whatever else agrees, this is not it.
      conflicts.push({
        code: "mc_number_conflict",
        label: `Different MC number — the document says ${mc}, this profile is ${candidateMc}`,
      });
      eliminated = true;
    }
  }

  const dot = normalizeDotNumber(extracted.dotNumber);
  const candidateDot = candidate.identifiers.dotNumber;
  if (dot && candidateDot) {
    if (dot === candidateDot) {
      score += WEIGHT.dotNumber;
      signals.push(signal("dot_number", `USDOT ${dot} matches`, WEIGHT.dotNumber));
    } else {
      conflicts.push({
        code: "dot_number_conflict",
        label: `Different USDOT number — the document says ${dot}, this profile is ${candidateDot}`,
      });
      // A DOT mismatch is strong doubt but not proof: a broker's paperwork can
      // carry an affiliate's number. It cancels the soft evidence instead of
      // eliminating, so the dispatcher still sees the candidate and the reason.
      score -= WEIGHT.dotNumber;
    }
  }

  const scac = normalizeScac(extracted.name);
  if (scac && candidate.identifiers.scac && scac === candidate.identifiers.scac) {
    score += WEIGHT.scac;
    signals.push(signal("scac", `SCAC ${scac} matches`, WEIGHT.scac));
  }

  // ---- Name --------------------------------------------------------------
  const extractedName = normalizeCompanyName(extracted.name);
  const extractedDba = normalizeCompanyName(extracted.dbaName);
  const candidateNames = [
    normalizeCompanyName(candidate.legalName),
    normalizeCompanyName(candidate.dbaName),
  ].filter(Boolean) as string[];

  const exactNameHit = candidateNames.some(
    (n) => n === extractedName || (extractedDba !== undefined && n === extractedDba),
  );
  if (exactNameHit) {
    score += WEIGHT.exactName;
    signals.push(signal("normalized_name", `Company name matches "${candidate.legalName}"`, WEIGHT.exactName));
  } else {
    const best = Math.max(
      ...candidateNames.map((n) =>
        Math.max(nameSimilarity(extractedName, n), nameSimilarity(extractedDba, n)),
      ),
      0,
    );
    if (best >= 0.5) {
      const weighted = Math.round(WEIGHT.similarName * best);
      score += weighted;
      signals.push(
        signal("name_similarity", `Name looks like "${candidate.legalName}"`, weighted),
      );
    }
  }

  // ---- Address -----------------------------------------------------------
  const addressKey = normalizeAddressKey(extracted.address);
  const candidateAddressKey = normalizeAddressKey(candidate.primaryAddress);
  if (addressKey && candidateAddressKey && addressKey === candidateAddressKey) {
    score += WEIGHT.addressKey;
    signals.push(signal("address", "Address matches", WEIGHT.addressKey));
  } else {
    const street = normalizeStreet(extracted.address?.line1);
    const candidateStreet = normalizeStreet(candidate.primaryAddress?.line1);
    if (street && candidateStreet && street === candidateStreet) {
      score += WEIGHT.street;
      signals.push(signal("street", "Street address matches", WEIGHT.street));
    }
    const zip = normalizePostalCode(extracted.address?.postalCode);
    const candidateZip = normalizePostalCode(candidate.primaryAddress?.postalCode);
    if (zip && candidateZip && zip === candidateZip) {
      score += WEIGHT.postalCode;
      signals.push(signal("postal_code", `ZIP ${zip} matches`, WEIGHT.postalCode));
    }
    const locality = normalizeLocalityKey(extracted.address);
    const candidateLocality = normalizeLocalityKey(candidate.primaryAddress);
    if (locality && candidateLocality && locality === candidateLocality) {
      score += WEIGHT.locality;
      signals.push(signal("locality", "Same city and state", WEIGHT.locality));
    }
  }

  // ---- Contact details ---------------------------------------------------
  const phone = normalizePhone(extracted.phone);
  const candidatePhone = normalizePhone(candidate.phone);
  if (phone && candidatePhone && phone === candidatePhone) {
    score += WEIGHT.phone;
    signals.push(signal("phone", "Phone number matches", WEIGHT.phone));
  }

  const email = normalizeEmail(extracted.email);
  const candidateEmail = normalizeEmail(candidate.email);
  if (email && candidateEmail && email === candidateEmail) {
    score += WEIGHT.email;
    signals.push(signal("email", "Email address matches", WEIGHT.email));
  } else {
    const domain = normalizeEmailDomain(extracted.email);
    const candidateDomain = normalizeEmailDomain(candidate.email);
    if (domain && candidateDomain && domain === candidateDomain) {
      score += WEIGHT.emailDomain;
      signals.push(signal("email_domain", `Both use @${domain}`, WEIGHT.emailDomain));
    }
  }

  // ---- Role --------------------------------------------------------------
  // A company that has only ever been a receiver appearing as a broker is not
  // impossible — companies do broker their own freight — but it is worth
  // showing, so it is a conflict rather than a penalty.
  if (!candidate.roles.includes(role)) {
    conflicts.push({
      code: "role_mismatch",
      label: `This profile has not been a ${role} before`,
    });
  }

  // A merged record is never a match target: the survivor is.
  if (candidate.status === "merged") eliminated = true;

  return { score: Math.max(0, score), decisive, signals, conflicts, eliminated };
}

/**
 * Rank every stored party against an extracted one, best first.
 *
 * A decisive match short-circuits the list: once an MC number matches, showing
 * a dispatcher four "possible" alternatives invites them to pick a worse one.
 */
export function rankPartyCandidates(
  extracted: ExtractedParty,
  parties: Party[],
  role: PartyRole,
  stats: (partyId: string) => { loadCount: number; lastLoadAt?: string },
): PartyMatchCandidate[] {
  const scored: PartyMatchCandidate[] = [];

  for (const party of parties) {
    const result = scoreParty(extracted, party, role);
    if (result.eliminated) continue;
    const confidence = tier(result.score, result.decisive);
    if (confidence === "none") continue;
    const { loadCount, lastLoadAt } = stats(party.partyId);
    scored.push({
      partyId: party.partyId,
      legalName: party.legalName,
      mcNumber: party.identifiers.mcNumber,
      city: party.primaryAddress?.city,
      state: party.primaryAddress?.state,
      status: party.status,
      score: result.score,
      confidence,
      signals: result.signals,
      conflicts: result.conflicts,
      loadCount,
      lastLoadAt,
    });
  }

  scored.sort((a, b) => b.score - a.score);

  const decisive = scored.filter((c) => c.confidence === "exact");
  return decisive.length > 0 ? decisive : scored.slice(0, 5);
}

/* -------------------------------------------------------------------------- */
/* Facility matching                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Facilities are matched inside one company, never across the whole directory.
 *
 * That narrowing is what makes address matching safe here: "1200 Industrial
 * Blvd" is ambiguous in the world and unambiguous among the four docks one
 * grocery chain operates. The caller passes only that company's facilities.
 */
export function rankFacilityCandidates(
  extracted: ExtractedFacility,
  facilities: Facility[],
): FacilityMatchCandidate[] {
  const extractedKey = normalizeAddressKey(extracted.address);
  const extractedStreet = normalizeStreet(extracted.address.line1);
  const extractedLocality = normalizeLocalityKey(extracted.address);
  const extractedName = normalizeCompanyName(extracted.name);

  const scored: FacilityMatchCandidate[] = [];

  for (const facility of facilities) {
    if (facility.status === "merged") continue;
    const signals: MatchSignal[] = [];
    const conflicts: MatchConflict[] = [];
    let score = 0;
    let decisive = false;

    const key = normalizeAddressKey(facility.address);
    if (extractedKey && key && extractedKey === key) {
      // Within one company, the same street and ZIP is the same dock.
      score += WEIGHT.addressKey;
      decisive = true;
      signals.push(signal("address", "Same address", WEIGHT.addressKey, true));
    } else {
      const street = normalizeStreet(facility.address.line1);
      if (extractedStreet && street && extractedStreet === street) {
        score += WEIGHT.street;
        signals.push(signal("street", "Same street address", WEIGHT.street));
      }
      const locality = normalizeLocalityKey(facility.address);
      if (extractedLocality && locality && extractedLocality === locality) {
        score += WEIGHT.locality;
        signals.push(signal("locality", "Same city and state", WEIGHT.locality));
      } else if (extractedLocality && locality) {
        conflicts.push({ code: "different_city", label: "A different city" });
      }
    }

    const name = normalizeCompanyName(facility.name);
    if (extractedName && name) {
      if (extractedName === name) {
        score += WEIGHT.exactName;
        signals.push(signal("normalized_name", `Facility name matches "${facility.name}"`, WEIGHT.exactName));
      } else {
        const similarity = nameSimilarity(extractedName, name);
        if (similarity >= 0.5) {
          const weighted = Math.round(WEIGHT.similarName * similarity);
          score += weighted;
          signals.push(signal("name_similarity", `Name looks like "${facility.name}"`, weighted));
        }
      }
    }

    const confidence = tier(score, decisive);
    if (confidence === "none") continue;
    scored.push({
      facilityId: facility.facilityId,
      name: facility.name,
      city: facility.address.city,
      state: facility.address.state,
      score,
      confidence,
      signals,
      conflicts,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const decisive = scored.filter((c) => c.confidence === "exact");
  return decisive.length > 0 ? decisive : scored.slice(0, 5);
}

/* -------------------------------------------------------------------------- */
/* Contact matching                                                            */
/* -------------------------------------------------------------------------- */

/**
 * People, matched inside one company.
 *
 * An email address is the one thing here that identifies a person rather than
 * describing them, so it is the only decisive contact signal. A shared name is
 * common, and a shared phone number usually means a shared switchboard rather
 * than a shared person — so neither decides on its own, and "Dave at extension
 * 204" stays a proposal a dispatcher looks at.
 */
export function rankContactCandidates(
  extracted: ExtractedContact,
  contacts: PartyContact[],
): ContactMatchCandidate[] {
  const email = normalizeEmail(extracted.email);
  const phone = normalizePhone(extracted.phone);
  const name = normalizePersonName(extracted.fullName);

  const scored: ContactMatchCandidate[] = [];

  for (const contact of contacts) {
    if (contact.status === "merged") continue;
    const signals: MatchSignal[] = [];
    const conflicts: MatchConflict[] = [];
    let score = 0;
    let decisive = false;

    const candidateEmail = normalizeEmail(contact.email);
    if (email && candidateEmail && email === candidateEmail) {
      score += WEIGHT.email;
      decisive = true;
      signals.push(signal("email", "Same email address", WEIGHT.email, true));
    }

    const candidateName = normalizePersonName(contact.fullName);
    if (name && candidateName) {
      if (name === candidateName) {
        score += WEIGHT.exactName;
        signals.push(signal("person_name", `Name matches ${contact.fullName}`, WEIGHT.exactName));
      } else {
        const similarity = nameSimilarity(name, candidateName);
        if (similarity >= 0.5) {
          const weighted = Math.round(WEIGHT.similarName * similarity);
          score += weighted;
          signals.push(signal("name_similarity", `Name looks like ${contact.fullName}`, weighted));
        }
      }
    }

    const candidatePhone = normalizePhone(contact.phone) ?? normalizePhone(contact.mobile);
    if (phone && candidatePhone && phone === candidatePhone) {
      // A direct line is good evidence; a main number shared by the whole
      // office is not. The extension is what tells them apart, and it is only
      // a signal when both sides carry one.
      const sameExtension =
        extracted.phoneExtension !== undefined &&
        contact.phoneExtension !== undefined &&
        extracted.phoneExtension.replace(/\D/g, "") === contact.phoneExtension.replace(/\D/g, "");
      const weighted = sameExtension ? WEIGHT.phone : Math.round(WEIGHT.phone / 2);
      score += weighted;
      signals.push(
        signal(
          "phone",
          sameExtension ? "Same direct line and extension" : "Same phone number",
          weighted,
        ),
      );
      if (!sameExtension && extracted.phoneExtension && contact.phoneExtension) {
        conflicts.push({ code: "different_extension", label: "A different extension" });
      }
    }

    if (email && candidateEmail && email !== candidateEmail) {
      conflicts.push({ code: "different_email", label: "A different email address" });
    }

    const confidence = tier(score, decisive);
    if (confidence === "none") continue;
    scored.push({
      contactId: contact.contactId,
      fullName: contact.fullName,
      email: contact.email,
      phone: contact.phone,
      score,
      confidence,
      signals,
      conflicts,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const decisive = scored.filter((c) => c.confidence === "exact");
  return decisive.length > 0 ? decisive : scored.slice(0, 5);
}

/* -------------------------------------------------------------------------- */
/* Recommendations                                                             */
/* -------------------------------------------------------------------------- */

export interface Recommendation {
  recommendation: ResolutionRecommendation;
  /** The party/facility/contact id being proposed, when one is. */
  targetId?: string;
  rationale: string;
  /** Why the record would be flagged, when it would be. */
  reviewReason?: string;
}

/**
 * Turn a ranked list into a recommendation.
 *
 * The interesting cases are the two that refuse to commit:
 *
 *   Two close candidates → `choose_between`, never "take the higher score". A
 *   four-point gap between two brokers is noise, and picking the leader is how
 *   a load ends up billed to the wrong company.
 *
 *   One "possible" candidate → `create_provisional`, not `link_existing` and
 *   not a clean `create_new`. Something in the directory resembles this and we
 *   could not tell; that is exactly the state the provisional flag exists for,
 *   and it is what keeps an uncertain match from either silently merging or
 *   silently duplicating.
 */
export function recommendFor(
  candidates: { score: number; confidence: MatchConfidence }[],
  ids: string[],
  labels: { thing: string },
): Recommendation {
  const [best, second] = candidates;

  if (!best || best.confidence === "none") {
    return {
      recommendation: "create_new",
      rationale: `Nothing in the directory resembles this ${labels.thing}. It would be added as a new profile.`,
    };
  }

  if (best.confidence === "exact") {
    return {
      recommendation: "link_existing",
      targetId: ids[0],
      rationale: `An identifier matched exactly. Confirm to link this ${labels.thing} to the existing profile.`,
    };
  }

  const gap = second ? best.score - second.score : Number.POSITIVE_INFINITY;
  if (second && second.confidence !== "none" && gap < RUNNER_UP_MARGIN) {
    return {
      recommendation: "choose_between",
      rationale:
        `More than one profile fits this ${labels.thing} and nothing separates them. ` +
        "Pick the right one, or create a new profile.",
      reviewReason: "Several existing profiles matched equally well",
    };
  }

  if (best.confidence === "strong") {
    return {
      recommendation: "link_existing",
      targetId: ids[0],
      rationale: `Several details agree. Confirm this is the same ${labels.thing} before it is linked.`,
    };
  }

  return {
    recommendation: "create_provisional",
    targetId: ids[0],
    rationale:
      `One existing profile partly resembles this ${labels.thing}, but not enough to link it. ` +
      "Confirm the match, or create a new profile that will be flagged for review.",
    reviewReason: "Created from an uncertain match on a rate confirmation",
  };
}

/**
 * Whether a document carries enough to create a solid record.
 *
 * A broker with no MC number is the case this exists for. The load can still be
 * booked and the profile still created — refusing would block real work — but
 * the record is born provisional, because the next rate confirmation that does
 * carry the MC number has no way to recognise it otherwise.
 */
export function thinExtraction(
  extracted: ExtractedParty,
  role: PartyRole,
): string | undefined {
  if (role === "broker" && !normalizeMcNumber(extracted.mcNumber)) {
    return "No MC number on the rate confirmation — a broker profile without one cannot be matched reliably next time";
  }
  if (!normalizeCompanyName(extracted.name)) {
    return "The company name is too short or too generic to identify a profile";
  }
  if (role !== "broker" && !normalizeAddressKey(extracted.address)) {
    return "No complete address on the rate confirmation — a location without one cannot be matched reliably next time";
  }
  return undefined;
}
