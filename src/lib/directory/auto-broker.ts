import type { ExtractedPartyBlock, Party } from "@/types";
import { rankPartyCandidates } from "./matching";
import { normalizeCompanyName, normalizeMcNumber } from "./normalize";

/**
 * ★ THE ONE PLACE A PROFILE IS CREATED WITHOUT A PERSON ★
 *
 * Everywhere else in the Directory, a rate confirmation produces a PROPOSAL and
 * a dispatcher confirms it. That rule exists for a specific, well-earned
 * reason, written down in `matching.ts` and in the load-finalized projection: a
 * rate confirmation that mints a profile on its own is how a carrier ends up
 * with four profiles for one broker. Nothing here repeals it.
 *
 * What this module does is carve out the single case where the reason does not
 * apply, and refuse everything else.
 *
 * ── WHY BROKERS, AND ONLY BROKERS ─────────────────────────────────────────
 * The duplicate problem is a problem of SOFT evidence. Shippers and receivers
 * are matched on names and addresses — "Blue Ridge Foods" at "1200 Industrial
 * Blvd" — and those resemble each other across genuinely different companies,
 * so two documents about one dock routinely look like two docks. Nothing can
 * be created from that safely, which is why this module refuses shippers and
 * receivers outright rather than by policy.
 *
 * A broker is different in kind, not degree. An MC number is issued once, by an
 * authority, to one company. `matching.ts` already treats it as DECISIVE: a
 * match on it cannot be outvoted by any accumulation of soft signals, and a
 * mismatch eliminates a candidate outright. A broker block carrying an MC
 * number is therefore not a guess at all — it is an identity.
 *
 * ── THE ASYMMETRY THAT KEEPS THIS SAFE ────────────────────────────────────
 * The two questions this module asks use deliberately different standards:
 *
 *   To CREATE, evidence must be DECISIVE. An MC number, normalized, or nothing
 *   happens. A broker printed with only a name goes to the review queue exactly
 *   as it does today.
 *
 *   To ABSTAIN, evidence may be as WEAK as it likes. Any existing party that
 *   resembles this one at all — `possible`, not merely `strong` — is enough to
 *   stop. A false resemblance costs nothing: the block falls through to the
 *   review queue, which is the current behaviour. A missed resemblance costs a
 *   duplicate, which is the thing worth avoiding.
 *
 * So the failure mode of being wrong here is "a dispatcher confirms it by hand,
 * as they do today", never "the directory grew a second profile for TQL".
 *
 * ── WHAT AN AUTO-INDEXED RECORD IS NOT ────────────────────────────────────
 * It is not verified: nothing checked the MC number against FMCSA, and a
 * document a broker sent us is evidence of what the broker SAID. It is not
 * claimed: nobody at that brokerage has an account, has agreed to anything, or
 * has been told the record exists. It is not linked to a load: that is a
 * carrier-private write and still requires a person. It confers nothing on
 * anybody.
 *
 * Nothing in this file reads or writes a store, reads a permission, or touches
 * the clock.
 */

/** Why a block was not auto-indexed. Each one is a different conversation. */
export type AutoIndexRefusal =
  /** Shippers and receivers. Out of scope by design, not by configuration. */
  | "not_a_broker"
  /** No MC number: identity would be a guess, and guesses go to a person. */
  | "no_decisive_identifier"
  /** The name could not be normalized to anything recognizable. */
  | "unusable_name"
  /** Something in the directory already resembles this. A person decides. */
  | "already_resembled";

export type AutoIndexDecision =
  | {
    outcome: "index";
    /** Normalized, digits only. The identity the new record is born with. */
    mcNumber: string;
    legalName: string;
  }
  | {
    outcome: "skip";
    reason: AutoIndexRefusal;
    /** One sentence a dispatcher can read in the projection's report. */
    detail: string;
    /** The party that resembled it, when that is why we stopped. */
    resembledPartyId?: string;
  };

/**
 * Decide whether one extracted block may become a broker profile on its own.
 *
 * `existing` is every party the directory holds. It is passed in rather than
 * read, so this stays pure and so a caller cannot accidentally scope the
 * duplicate check to one organization — a broker record is shared, and
 * checking only one carrier's corner of the directory is how the duplicate
 * gets created anyway.
 */
export function decideAutoIndex(
  block: ExtractedPartyBlock,
  existing: readonly Party[],
): AutoIndexDecision {
  if (block.role !== "broker") {
    return {
      outcome: "skip",
      reason: "not_a_broker",
      detail:
        `A ${block.role} is matched on its name and address, which resemble each other `
        + "across genuinely different companies. Only brokers are indexed automatically.",
    };
  }

  const mcNumber = normalizeMcNumber(block.party.mcNumber);
  if (!mcNumber) {
    return {
      outcome: "skip",
      reason: "no_decisive_identifier",
      detail:
        "No MC number on the rate confirmation. Without one the broker's identity is a "
        + "guess, and the next confirmation would have no way to recognise the record.",
    };
  }

  const legalName = block.party.name.trim();
  if (!normalizeCompanyName(block.party.name)) {
    return {
      outcome: "skip",
      reason: "unusable_name",
      detail: "The company name is too short or too generic to put on a profile.",
    };
  }

  // Deliberately the weakest bar in the file. `rankPartyCandidates` already
  // drops everything below `possible`, so anything it returns at all is enough
  // to stop — including a candidate this module would have scored as a
  // near-miss. Abstaining is free; duplicating is not.
  const [resembling] = rankPartyCandidates(block.party, [...existing], "broker", () => ({
    // Auto-indexing has no carrier context and must not acquire one: a broker
    // record is shared, and tie-breaking it on one carrier's load history
    // would make the answer depend on who happened to book the load.
    loadCount: 0,
  }));

  if (resembling) {
    return {
      outcome: "skip",
      reason: "already_resembled",
      detail:
        `${resembling.legalName} already resembles this broker (${resembling.confidence} match). `
        + "Nothing was created; the existing profile is proposed for linking instead.",
      resembledPartyId: resembling.partyId,
    };
  }

  return { outcome: "index", mcNumber, legalName };
}

/**
 * The whole confirmation, decided block by block.
 *
 * Returns one decision per block in the order they appeared, so a caller can
 * report honestly on every party it saw rather than only on the ones it acted
 * on. A projection that said nothing about the shipper it skipped would read
 * like a projection that had not noticed it.
 */
export function decideAutoIndexForBlocks(
  blocks: readonly ExtractedPartyBlock[],
  existing: readonly Party[],
): AutoIndexDecision[] {
  // Threaded rather than mapped: two blocks on one confirmation naming the
  // same MC number must not both create a record. The first becomes the
  // profile and the second sees it.
  const seen: Party[] = [];
  return blocks.map((block) => {
    const decision = decideAutoIndex(block, [...existing, ...seen]);
    if (decision.outcome === "index") {
      seen.push(provisionalStandIn(decision.mcNumber, decision.legalName));
    }
    return decision;
  });
}

/**
 * The minimum a duplicate check needs to see.
 *
 * Not a record and never stored — it exists for the length of one call, so the
 * second block naming the same MC number matches the first decisively instead
 * of creating a twin. Building a whole `Party` here would mean inventing a
 * provenance and a timestamp this module has no business deciding.
 */
function provisionalStandIn(mcNumber: string, legalName: string): Party {
  return {
    partyId: `pending:${mcNumber}`,
    roles: ["broker"],
    legalName,
    identifiers: { mcNumber },
    status: "provisional",
    verification: { state: "unverified" },
    claim: { state: "unclaimed" },
    provenance: {
      kind: "rate_confirmation_auto",
      recordedAt: "",
      recordedBy: {
        userId: "system", membershipId: "system",
        displayNameSnapshot: "Antcolos", source: "system",
      },
      recordedByOrganizationId: "",
    },
    createdAt: "",
    updatedAt: "",
    createdByOrganizationId: "",
  };
}

/** The sentence the badge shows. One definition, used by every surface. */
export const AUTO_INDEXED_BADGE = "Auto-generated via rate con — unclaimed";

export const AUTO_INDEXED_EXPLANATION =
  "Antcolos indexed this brokerage from a rate confirmation another company sent in. "
  + "Nobody from the brokerage has claimed the record, and nothing on it has been "
  + "checked against FMCSA.";
