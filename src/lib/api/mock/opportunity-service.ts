import type {
  LearningSummary, Listing, MatchWithListing, OutreachDraft, RankingPreferences,
  SearchSession,
} from "@/types";
import { expireStaleListings, listingsFor } from "./listing-registry";
import {
  allMatches, bookMatch, listingTakenElsewhere, matchesForCycle, rankMatches,
  reconcileMatches, type BookingOutcome,
} from "./opportunity-matching";
import {
  draftIdForMatch, draftsFor, draftsForCycle, reconcileDrafts,
  supersedeDraftsForListing,
} from "./outreach-drafts";
import { learningFor, rankingPreferences } from "./ranking";
import { sessionForCycle, sessionsFor } from "./search-session";
import { openLoopsFor, type MtLoopContext } from "./mt-loop";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The one door the screens come through.
 *
 * Listings, matches, ranking, sessions and drafts are five services with one
 * direction of dependency between them, which is what keeps each of them
 * testable on its own. But a screen needs all five at once and in the right
 * ORDER — listings age out, then matches reconcile against them, then drafts
 * regroup against the matches — and leaving that order to whichever component
 * renders first is how a dashboard ends up showing a draft for a load that
 * expired two minutes ago.
 *
 * So the ordering lives here, once, and the screens ask for a finished picture.
 * This file also holds the two operations that have to touch more than one
 * service at a time: booking a load, and a load going elsewhere. Both of those
 * stand competing matches AND their drafts down, and doing one without the
 * other is the bug this exists to prevent.
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const LATENCY_MS = 300;

/* -------------------------------------------------------------------------- */
/* The finished picture                                                        */
/* -------------------------------------------------------------------------- */

export interface OpportunityInbox {
  /** Every listing in the workspace, from every source, normalised. */
  listings: Listing[];
  /** Every match, best first, with its listing. */
  matches: MatchWithListing[];
  /** The best few, already separated out. */
  top: MatchWithListing[];
  /** Everything else, still visible, each with its reason. */
  rest: MatchWithListing[];
  drafts: OutreachDraft[];
  sessions: SearchSession[];
  ranking: RankingPreferences;
  learning: LearningSummary;
  counts: {
    listings: number;
    duplicatesFolded: number;
    eligible: number;
    ineligible: number;
    shortlisted: number;
    draftsWaiting: number;
    openCycles: number;
    /** Cycles with no search running. The ones nobody is looking for. */
    cyclesWithoutSearch: number;
  };
}

/**
 * How many count as "the best".
 *
 * Five, and fewer when there are not five worth showing. A dispatcher scanning
 * a screen holds about this many in their head before the list stops being a
 * short list and becomes another list to read.
 */
const TOP_N = 5;

/**
 * Bring everything up to date, in the order it has to happen.
 *
 * Cheap, synchronous, and run on every read. The alternative — reconciling on a
 * timer, or when something changes — gives a screen that is right most of the
 * time, and "most of the time" is not a property anybody can reason about.
 */
export function refreshOpportunities(ctx: MtLoopContext): void {
  expireStaleListings(ctx.organizationId);
  reconcileMatches(ctx);
  reconcileDrafts(ctx);
}

export function opportunityInboxSync(ctx: MtLoopContext): OpportunityInbox {
  refreshOpportunities(ctx);

  const listings = listingsFor(ctx.organizationId);
  const matches = attachDrafts(allMatches(ctx), ctx);
  const drafts = draftsFor(ctx);
  const sessions = sessionsFor(ctx);
  const loops = openLoopsFor(ctx);

  // Only genuinely eligible work can be "the best". A short list with an
  // ineligible load in it is not a short list, it is a trap.
  const rankable = matches.filter(
    (m) => m.match.status === "eligible" || m.match.status === "shortlisted",
  );
  const top = rankable.slice(0, TOP_N);
  const topIds = new Set(top.map((m) => m.match.matchId));
  const rest = matches.filter((m) => !topIds.has(m.match.matchId));

  const cyclesWithoutSearch = loops.filter(
    (l) => sessionForCycle(l.loopId, ctx) === undefined,
  ).length;

  return {
    listings,
    matches,
    top,
    rest,
    drafts,
    sessions,
    ranking: rankingPreferences(ctx.organizationId),
    learning: learningFor(ctx.organizationId),
    counts: {
      listings: listings.length,
      duplicatesFolded: listings.reduce((sum, l) => sum + Math.max(0, l.sightings.length - 1), 0),
      eligible: matches.filter((m) => m.match.status === "eligible").length,
      ineligible: matches.filter((m) => m.match.status === "ineligible").length,
      shortlisted: matches.filter((m) => m.match.status === "shortlisted").length,
      draftsWaiting: drafts.filter((d) => d.status === "ready").length,
      openCycles: loops.length,
      cyclesWithoutSearch,
    },
  };
}

export async function opportunityInbox(ctx: MtLoopContext): Promise<OpportunityInbox> {
  await sleep(LATENCY_MS);
  return opportunityInboxSync(ctx);
}

/* -------------------------------------------------------------------------- */
/* One truck                                                                   */
/* -------------------------------------------------------------------------- */

export interface TruckOpportunities {
  session?: SearchSession;
  /** The best few for THIS truck. */
  top: MatchWithListing[];
  /** Everything else considered for it, each with the reason it ranks lower. */
  rest: MatchWithListing[];
  drafts: OutreachDraft[];
  ranking: RankingPreferences;
  counts: { considered: number; eligible: number; ineligible: number; shortlisted: number };
}

export function truckOpportunitiesSync(
  dispatchCycleId: string,
  ctx: MtLoopContext,
): TruckOpportunities {
  refreshOpportunities(ctx);
  const matches = attachDrafts(matchesForCycle(dispatchCycleId, ctx), ctx);
  const rankable = matches.filter(
    (m) => m.match.status === "eligible" || m.match.status === "shortlisted",
  );
  const top = rankable.slice(0, TOP_N);
  const topIds = new Set(top.map((m) => m.match.matchId));

  return {
    session: sessionForCycle(dispatchCycleId, ctx),
    top,
    rest: matches.filter((m) => !topIds.has(m.match.matchId)),
    drafts: draftsForCycle(dispatchCycleId, ctx),
    ranking: rankingPreferences(ctx.organizationId),
    counts: {
      considered: matches.length,
      eligible: matches.filter((m) => m.match.status === "eligible").length,
      ineligible: matches.filter((m) => m.match.status === "ineligible").length,
      shortlisted: matches.filter((m) => m.match.status === "shortlisted").length,
    },
  };
}

export async function truckOpportunities(
  dispatchCycleId: string,
  ctx: MtLoopContext,
): Promise<TruckOpportunities> {
  await sleep(LATENCY_MS);
  return truckOpportunitiesSync(dispatchCycleId, ctx);
}

function attachDrafts(rows: MatchWithListing[], ctx: MtLoopContext): MatchWithListing[] {
  return rankMatches(
    rows.map((r) => ({ ...r, draftId: draftIdForMatch(r.match.matchId, ctx) })),
  );
}

/* -------------------------------------------------------------------------- */
/* A load going somewhere                                                      */
/* -------------------------------------------------------------------------- */

export interface CloseoutResult extends BookingOutcome {
  supersededDraftIds: string[];
}

/**
 * One truck got it. Everything else about that load stands down.
 *
 * Booking proper is milestone 8 — this is the mechanism it will call, built now
 * because the matches and drafts it has to stand down are built now. Two things
 * have to happen together and neither is optional: competing MATCHES close, and
 * competing DRAFTS are superseded. Closing the matches alone leaves a prepared
 * email about a load that is gone sitting in somebody's review queue.
 */
export function bookAndStandDown(
  matchId: string,
  ctx: MtLoopContext,
  actorName: string,
): CloseoutResult {
  const outcome = bookMatch(matchId, ctx, actorName);
  if (outcome.status !== "ok" || !outcome.match) {
    return { ...outcome, supersededDraftIds: [] };
  }
  const supersededDraftIds = supersedeDraftsForListing(
    ctx.organizationId,
    outcome.match.listingId,
    `Unit ${outcome.match.truckUnit} got this load.`,
  );
  return { ...outcome, supersededDraftIds };
}

/**
 * Somebody else got it, or the broker pulled it.
 *
 * By far the more common ending, and it has to do exactly the same standing
 * down. A dispatcher must not spend the afternoon working a load that came off
 * the board an hour ago.
 */
export function markTakenElsewhere(
  listingId: string,
  ctx: MtLoopContext,
  reason: string,
): { closedMatchIds: string[]; supersededDraftIds: string[] } {
  const closedMatchIds = listingTakenElsewhere(listingId, ctx, reason);
  const supersededDraftIds = supersedeDraftsForListing(ctx.organizationId, listingId, reason);
  return { closedMatchIds, supersededDraftIds };
}
