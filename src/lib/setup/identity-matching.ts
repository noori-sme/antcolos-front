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
 *  3. A CONFLICT ON A DECISIVE IDENTIFIER STOPS; IT NEVER ELIMINATES.
 *
 *     ★ THIS RULE USED TO SAY THE OPPOSITE, AND IT WAS WRONG ★
 *
 *     It said a different licence number was positive evidence of two people,
 *     so the candidate was dropped. The reasoning sounds right — a licence is
 *     issued to one holder — and it fails on two entirely ordinary things.
 *
 *     People move. A driver who leaves Illinois for Texas surrenders one
 *     licence and is issued another; the same person now has two numbers, and
 *     an employer's file may hold either. And rosters are typed by hand: one
 *     wrong character in a fifteen-character string is the commonest defect in
 *     any export anybody has ever produced.
 *
 *     In both cases the old rule deleted the one record that WAS this person,
 *     left nothing plausible behind, and the plan therefore called the row new
 *     — so a second engagement was created for somebody already on the roster,
 *     silently, with nobody asked. The duplicate this module exists to prevent,
 *     produced by the code meant to prevent it.
 *
 *     So a conflicting decisive identifier now means only this: DO NOT LINK
 *     AUTOMATICALLY. If anything else about the record is plausible, the
 *     candidate stays on the table, carrying its conflict, and the row stops
 *     for a person. Neither answer — same person, new person — is one this
 *     module is entitled to pick.
 *
 *     Asymmetry is why. A wrong stop costs one question. A wrong automatic
 *     create costs a permanent duplicate that nobody finds until a licence
 *     expires on the copy nobody is watching.
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

/**
 * Whether two identifiers differ the way a typing mistake differs.
 *
 * One substituted character, one transposed pair, or one inserted or deleted
 * character. Deliberately not a general edit distance: two characters wrong is
 * no longer "a typo", and treating it as one would make every licence at a
 * carrier look like every other.
 *
 * This matters because it is EVIDENCE, not noise. Two real licences that differ
 * by exactly one character is a coincidence; a hand-typed roster row that
 * differs from the file by exactly one character is Tuesday.
 */
export function looksMistyped(a: string, b: string): boolean {
  if (a === b) return false;
  if (Math.abs(a.length - b.length) > 1) return false;

  if (a.length === b.length) {
    const differing: number[] = [];
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) differing.push(i);
      if (differing.length > 2) return false;
    }
    if (differing.length === 1) return true;
    // A transposition: two adjacent positions holding each other's character.
    if (differing.length === 2) {
      const [i, j] = differing;
      return j === i + 1 && a[i] === b[j] && a[j] === b[i];
    }
    return false;
  }

  // One longer than the other: a single insertion or deletion.
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) { i++; j++; continue; }
    if (skipped) return false;
    skipped = true;
    j++;
  }
  return true;
}

/**
 * A conflict that is itself a reason to stop, whatever else the row says.
 *
 * A near-miss identifier and a same-number-different-state pair are the exact
 * shapes of the two failures this module got wrong: a typing error and an
 * interstate move. Either one keeps a candidate on the table even with nothing
 * else in common, because either one is a plausible account of how one person
 * ended up with two numbers.
 */
const SUGGESTIVE_CONFLICTS = new Set([
  "cdl_near_miss", "cdl_state_change", "vin_near_miss", "plate_matches_vin_differs",
]);

const contests = (conflicts: MatchConflict[]) =>
  conflicts.some((c) => SUGGESTIVE_CONFLICTS.has(c.code));

/**
 * The confidence a conflicted candidate is allowed to carry.
 *
 * NEVER `exact`: a conflicting decisive identifier is precisely the thing that
 * makes automatic linking unsafe, so no amount of soft agreement may buy back
 * the word that means "link this without asking". A suggestive conflict floors
 * it at `possible` so the candidate survives ranking and reaches a person.
 */
function conflictedTier(score: number, conflicts: MatchConflict[]): MatchConfidence {
  const soft = tier(score, false);
  if (soft === "none" && contests(conflicts)) return "possible";
  return soft;
}

/** Strip punctuation and case so two spellings of one identifier compare. */
const idKey = (raw?: string) => raw?.replace(/[^0-9a-z]/gi, "").toUpperCase() ?? "";

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
  const n = idKey(number);
  const s = normalizeState(state);
  return n && s ? `${s}:${n}` : undefined;
}

/**
 * Why two licences differ — which is what a reviewer actually needs to know.
 *
 * "Different licence" is not one situation. It is at least three, and they do
 * not deserve the same answer: the same number in another state is what moving
 * house looks like; one character out is what a keyboard looks like; and
 * everything else is what two people look like. The code names which, and the
 * first two keep the candidate on the table on their own.
 */
function cdlConflictFor(claim: PersonClaim, record: PersonRecord): MatchConflict {
  const claimNumber = idKey(claim.cdlNumber);
  const recordNumber = idKey(record.cdlNumber);
  const shown = `${claim.cdlState} ${claim.cdlNumber}`;

  if (claimNumber === recordNumber) {
    return {
      code: "cdl_state_change",
      label: `Same licence number, issued by a different state: the file says ${shown}, `
        + `the record says ${record.cdlState}. A driver who moves is issued a new licence, `
        + "so this may be one person — or two numbers that happen to collide.",
    };
  }
  if (looksMistyped(claimNumber, recordNumber)) {
    return {
      code: "cdl_near_miss",
      label: `Licence differs by one character: the file says ${shown}, the record says `
        + `${record.cdlState} ${record.cdlNumber}. That is usually a typing error, `
        + "and it is occasionally two real licences.",
    };
  }
  return {
    code: "cdl_conflict",
    label: `Different licence: the file says ${shown}, the record says `
      + `${record.cdlState} ${record.cdlNumber}.`,
  };
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
      /*
       * ★ RECORD IT AND KEEP GOING ★
       * This used to `return` here with the candidate dropped and its soft
       * signals thrown away — which is what let a mistyped licence turn a
       * driver the carrier already had into a brand new person. The conflict
       * is carried, the rest of the evidence is still scored, and the ranking
       * below refuses to call the row either answer on its own.
       */
      conflicts.push(cdlConflictFor(claim, record));
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
    confidence: conflicts.length > 0 ? conflictedTier(score, conflicts) : tier(score, decisive),
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
    } else if (looksMistyped(claimVin, recordVin)) {
      /*
       * A VIN is seventeen characters a person copies off a doorframe, and it
       * contains no I, O or Q precisely because they are misread as 1, 0 and 9.
       * One character out is the likeliest single defect in any fleet list, and
       * the truck it would create is a second permanent record for a vehicle
       * the carrier already has.
       */
      conflicts.push({
        code: "vin_near_miss",
        label: `VIN differs by one character: the file says ${claimVin}, the record says `
          + `${recordVin}. Seventeen characters copied by hand usually means a `
          + "transcription error rather than a second truck.",
      });
    } else {
      conflicts.push({
        code: "vin_conflict",
        label: `Different VIN: the file says ${claimVin}, the record says ${recordVin}.`,
      });
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

    // The plate this carrier has on file, on a different VIN. Either the VIN
    // was mistyped or the plate moved to a new truck, and those are opposite
    // facts about the fleet. Nobody here can tell which.
    if (claimVin && claimVin !== recordVin) {
      conflicts.push({
        code: "plate_matches_vin_differs",
        label: `The plate matches this truck but the VIN does not. Either the VIN in the `
          + "file is wrong, or this plate has moved to a different truck.",
      });
    }
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
    confidence: conflicts.length > 0 ? conflictedTier(score, conflicts) : tier(score, decisive),
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
 *
 * ★ AND THE ONLY PLACE `new` IS PRODUCED ★
 * Which is the half that was wrong. `new` now requires that nothing plausible
 * was found AND that nothing was found and set aside over a conflicting
 * identifier. A contested candidate blocks both answers at once: it is not
 * good enough to link and not absent enough to ignore, which is exactly the
 * situation a person exists to resolve.
 */
export function rank(candidates: ClaimCandidate[]): Ranking {
  const alive = candidates
    .filter((c) => c.conflicts.length === 0 && c.confidence !== "none")
    .sort((a, b) => b.score - a.score);

  /*
   * Plausible, and carrying a conflict on the one identifier that would have
   * settled it. Ranked in with the rest so the reviewer sees everything that
   * was considered, and checked FIRST so no other branch can answer over it.
   */
  const contested = candidates
    .filter((c) => c.conflicts.length > 0 && c.confidence !== "none")
    .sort((a, b) => b.score - a.score);

  if (contested.length > 0) {
    const all = [...alive, ...contested].sort((a, b) => b.score - a.score);
    const lead = contested[0];
    return {
      candidates: all,
      outcome: "needs_decision",
      rationale: `${lead.label} may be this person, and may not: `
        + `${lead.conflicts.map((c) => c.label).join(" ")} `
        + "Antcolos will not decide this one either way — linking the wrong record and "
        + "creating a second one are both permanent, and only somebody who knows these "
        + "people can tell them apart.",
    };
  }

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
