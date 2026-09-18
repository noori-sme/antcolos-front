import {
  nameSimilarity, normalizeEmail, normalizePersonName, normalizePhone,
  normalizeState,
} from "@/lib/directory/normalize";
import { normalizeVin } from "@/lib/fleet/vin";
import type {
  ClaimCandidate, ClaimOutcome, MatchConfidence, MatchConflict, MatchSignal,
  PersonClaim, TruckClaim,
} from "@/types";

/**
 * Deciding which permanent record a line of somebody's spreadsheet refers to.
 *
 * This is the same problem `lib/directory/matching.ts` solves for brokers, and
 * it deliberately reuses that module's vocabulary — `MatchConfidence`,
 * `MatchSignal`, `MatchConflict` — because a second set of words for
 * "decisive", "strong" and "conflict" is how two parts of a product come to
 * disagree about what a match is. What differs is the RULES, and they differ
 * because the stakes do: getting a broker wrong bills the wrong company;
 * getting a person wrong either creates a second permanent professional profile
 * for somebody who already has one, or attaches a carrier to a stranger's
 * licence and medical card.
 *
 * So three rules are stricter here than in the directory:
 *
 *  1. THE DECISIVE SET IS SMALLER. A company can be identified by an MC number
 *     alone. A person cannot be identified by their name, their phone, or their
 *     employer's opinion. Only two things are decisive — a CDL number together
 *     with its issuing state, and a VIN — and both are identifiers issued by an
 *     authority to be unique to one holder.
 *
 *  2. THERE IS NO "STRONG ENOUGH TO LINK". The directory lets a strong match
 *     link with confirmation. Here, strong produces `needs_decision`: the
 *     product asks. A name plus a matching phone number is two people in the
 *     same family often enough that the difference matters.
 *
 *  3. A CONFLICT ON A DECISIVE IDENTIFIER ELIMINATES. Same name, different CDL
 *     number is not weak evidence of a match — it is positive evidence of two
 *     people. The candidate is dropped rather than scored down.
 *
 * ★ WHAT IS DELIBERATELY NOT A SIGNAL ★
 * A truck's unit number. See `TruckClaim.unitNumber`.
 *
 * Nothing in this file reads a store, writes anything, or decides to link
 * anything. It ranks, it explains, and it says when it will not choose.
 */

/* -------------------------------------------------------------------------- */
/* Weights                                                                     */
/* -------------------------------------------------------------------------- */

const WEIGHT = {
  /** Decisive together. Neither half is decisive alone: states reuse numbers. */
  cdl: 100,
  /** Decisive. Issued once, to one vehicle, for its life. */
  vin: 100,
  /**
   * A mailbox is the strongest soft signal a person has, and it is still soft.
   * Shared family addresses and recycled company addresses are both ordinary,
   * so it sits below the ask-a-human line on its own.
   */
  email: 36,
  phone: 26,
  exactName: 24,
  /** Ceiling, scaled by similarity: "Maria Santos" against "Maria L Santos". */
  similarName: 18,
  plate: 30,
  makeModelYear: 10,
} as const;

/**
 * Two independent soft signals must agree before the word "strong" is used —
 * and `strong` still does not link, it asks. The threshold sits above the
 * largest single soft weight so that no lone signal can ever reach it.
 */
const STRONG_THRESHOLD = 44;
const POSSIBLE_THRESHOLD = 12;

/** A candidate this far behind the leader is not a real alternative. */
const RUNNER_UP_MARGIN = 20;

const signal = (code: string, label: string, weight: number, decisive = false): MatchSignal =>
  ({ code, label, weight, decisive });

function tier(score: number, decisive: boolean): MatchConfidence {
  if (decisive) return "exact";
  if (score >= STRONG_THRESHOLD) return "strong";
  if (score >= POSSIBLE_THRESHOLD) return "possible";
  return "none";
}

/* -------------------------------------------------------------------------- */
/* People                                                                      */
/* -------------------------------------------------------------------------- */

/** The shape a person-holding registry must expose to be matched against. */
export interface PersonRecord {
  entityId: string;
  legalName: string;
  email?: string;
  phone?: string;
  cdlNumber?: string;
  cdlState?: string;
  /** Shown beside the candidate so a reviewer can tell two people apart. */
  detail?: string;
}

/** A CDL is only an identity when its issuing state is known too. */
function cdlKey(number?: string, state?: string): string | undefined {
  const n = number?.replace(/[^0-9a-z]/gi, "").toUpperCase();
  const s = normalizeState(state);
  return n && s ? `${s}:${n}` : undefined;
}

export function scorePerson(claim: PersonClaim, record: PersonRecord): ClaimCandidate {
  const signals: MatchSignal[] = [];
  const conflicts: MatchConflict[] = [];
  let score = 0;
  let decisive = false;

  /* ---- The one identifier issued to be unique --------------------------- */
  const claimCdl = cdlKey(claim.cdlNumber, claim.cdlState);
  const recordCdl = cdlKey(record.cdlNumber, record.cdlState);
  if (claimCdl && recordCdl) {
    if (claimCdl === recordCdl) {
      signals.push(signal("cdl", `Licence ${claim.cdlState} ${claim.cdlNumber} matches`, WEIGHT.cdl, true));
      score += WEIGHT.cdl;
      decisive = true;
    } else {
      // Not weak evidence against — PROOF of two people. A licence number is
      // issued to one holder, so two different ones cannot be one person.
      conflicts.push({
        code: "cdl_conflict",
        label: `Different licence: this file says ${claim.cdlState} ${claim.cdlNumber}`,
      });
      return {
        entityId: record.entityId, entityKind: "person", label: record.legalName,
        detail: record.detail, score: 0, confidence: "none", signals, conflicts,
      };
    }
  }

  /* ---- Soft signals, which accumulate and never decide ------------------ */
  const claimEmail = normalizeEmail(claim.email);
  const recordEmail = normalizeEmail(record.email);
  if (claimEmail && recordEmail && claimEmail === recordEmail) {
    signals.push(signal("email", `Same address, ${claimEmail}`, WEIGHT.email));
    score += WEIGHT.email;
  }

  const claimPhone = normalizePhone(claim.phone);
  const recordPhone = normalizePhone(record.phone);
  if (claimPhone && recordPhone && claimPhone === recordPhone) {
    signals.push(signal("phone", "Same phone number", WEIGHT.phone));
    score += WEIGHT.phone;
  }

  const claimName = normalizePersonName(claim.fullName);
  const recordName = normalizePersonName(record.legalName);
  if (claimName && recordName) {
    if (claimName === recordName) {
      signals.push(signal("name_exact", `Name matches: ${record.legalName}`, WEIGHT.exactName));
      score += WEIGHT.exactName;
    } else {
      const similarity = nameSimilarity(claimName, recordName);
      if (similarity >= 0.8) {
        const weight = Math.round(WEIGHT.similarName * similarity);
        signals.push(signal("name_similar", `Similar name: ${record.legalName}`, weight));
        score += weight;
      }
    }
  }

  return {
    entityId: record.entityId,
    entityKind: "person",
    label: record.legalName,
    detail: record.detail,
    score,
    confidence: tier(score, decisive),
    signals,
    conflicts,
  };
}

/* -------------------------------------------------------------------------- */
/* Trucks                                                                      */
/* -------------------------------------------------------------------------- */

export interface TruckRecord {
  entityId: string;
  vin: string;
  make?: string;
  model?: string;
  year?: number;
  plateNumber?: string;
  plateState?: string;
  detail?: string;
}

const truckLabel = (r: TruckRecord) =>
  [r.year, r.make, r.model].filter(Boolean).join(" ") || r.vin;

export function scoreTruck(claim: TruckClaim, record: TruckRecord): ClaimCandidate {
  const signals: MatchSignal[] = [];
  const conflicts: MatchConflict[] = [];
  let score = 0;
  let decisive = false;

  const claimVin = claim.vin ? normalizeVin(claim.vin) : undefined;
  const recordVin = normalizeVin(record.vin);
  if (claimVin) {
    if (claimVin === recordVin) {
      signals.push(signal("vin", `VIN ${recordVin} matches`, WEIGHT.vin, true));
      score += WEIGHT.vin;
      decisive = true;
    } else {
      conflicts.push({ code: "vin_conflict", label: `Different VIN: this file says ${claimVin}` });
      return {
        entityId: record.entityId, entityKind: "truck", label: truckLabel(record),
        detail: record.detail, score: 0, confidence: "none", signals, conflicts,
      };
    }
  }

  const claimPlate = claim.plateNumber?.replace(/[^0-9a-z]/gi, "").toUpperCase();
  const recordPlate = record.plateNumber?.replace(/[^0-9a-z]/gi, "").toUpperCase();
  if (claimPlate && recordPlate && claimPlate === recordPlate
    && normalizeState(claim.plateState) === normalizeState(record.plateState)) {
    // A plate is reassigned when a truck is sold, so it dates rather than
    // identifies — strong evidence, never decisive.
    signals.push(signal("plate", `Plate ${claim.plateNumber} matches`, WEIGHT.plate));
    score += WEIGHT.plate;
  }

  if (claim.make && claim.model && claim.year
    && claim.make.toLowerCase() === record.make?.toLowerCase()
    && claim.model.toLowerCase() === record.model?.toLowerCase()
    && claim.year === record.year) {
    signals.push(signal("make_model_year", `${claim.year} ${claim.make} ${claim.model}`, WEIGHT.makeModelYear));
    score += WEIGHT.makeModelYear;
  }

  return {
    entityId: record.entityId,
    entityKind: "truck",
    label: truckLabel(record),
    detail: record.detail,
    score,
    confidence: tier(score, decisive),
    signals,
    conflicts,
  };
}

/* -------------------------------------------------------------------------- */
/* From a ranking to an outcome                                                */
/* -------------------------------------------------------------------------- */

export interface Ranking {
  candidates: ClaimCandidate[];
  outcome: ClaimOutcome;
  rationale: string;
}

/**
 * Turns scored candidates into what the import should DO.
 *
 * ★ THE ONLY PLACE `matched` IS PRODUCED ★
 * Exactly one candidate, matched on an identifier issued to be unique, with no
 * conflict. Everything else that is plausible stops for a person — including
 * two decisive matches, which means the registry already holds a duplicate and
 * is emphatically not something an importer should pick between.
 */
export function rank(candidates: ClaimCandidate[]): Ranking {
  const alive = candidates
    .filter((c) => c.conflicts.length === 0 && c.confidence !== "none")
    .sort((a, b) => b.score - a.score);

  if (alive.length === 0) {
    return {
      candidates: [],
      outcome: "new",
      rationale: "Nothing in Antcolos looks like this one, so it would be created.",
    };
  }

  const exact = alive.filter((c) => c.confidence === "exact");
  if (exact.length === 1) {
    return {
      candidates: alive,
      outcome: "matched",
      rationale: `${exact[0].signals.find((s) => s.decisive)?.label ?? "An exact identifier matches"}`
        + ", which is issued to one holder — so this is the same record, not a new one.",
    };
  }
  if (exact.length > 1) {
    return {
      candidates: alive,
      outcome: "needs_decision",
      rationale: `${exact.length} existing records match on an identifier that should be unique. `
        + "Antcolos will not choose between them.",
    };
  }

  const [leader, runnerUp] = alive;
  if (runnerUp && leader.score - runnerUp.score < RUNNER_UP_MARGIN) {
    return {
      candidates: alive,
      outcome: "needs_decision",
      rationale: "More than one existing record fits about equally well. "
        + "Picking one on a similar name would be a guess.",
    };
  }

  return {
    candidates: alive,
    outcome: "needs_decision",
    rationale: `${leader.label} looks like a match on `
      + `${leader.signals.map((s) => s.label.toLowerCase()).join(" and ")} — `
      + "which is suggestive and not proof, so somebody should confirm it.",
  };
}
