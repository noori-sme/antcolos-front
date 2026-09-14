import type {
  BookingRecord, LearningSummary, Listing, MatchWithListing, NegotiationSummary,
  DriverReview, DriverVisibilityPolicy, OutreachDraft, RankingPreferences,
  RateConWorkflow, SearchSession,
} from "@/types";
import { expireStaleListings, listingsFor } from "./listing-registry";
import {
  allMatches, listingTakenElsewhere, matchesForCycle, rankMatches,
  reconcileMatches,
} from "./opportunity-matching";
import {
  approveDraft, draftIdForMatch, draftsFor, draftsForCycle, reconcileDrafts,
  supersedeDraftsForListing, type DraftOutcome,
} from "./outreach-drafts";
import {
  cycleCommunicationsSync, recordInquiryFromDraft, reconcileMessages,
  type CycleCommunications,
} from "./communications";
import {
  closeNegotiationsForListing, expireStaleOffers, negotiationsForCycle,
  openNegotiations, summarizeAll,
} from "./negotiation";
import { threadsFor } from "./communications";
import {
  closeReviewsForListing, driverGate, reviewForMatch, reviewsFor, reviewsForCycle,
} from "./driver-review";
import { rateConForCycle, rateConsFor } from "./rate-confirmation";
import {
  bookAndStandDown, bookingForCycle, bookingsForWorkspace, type CloseoutResult,
} from "./booking";
import { learningFor, rankingPreferences } from "./ranking";
import { sessionForCycle, sessionsFor } from "./search-session";
import { mtLoopById, openLoopsFor, type MtLoopContext } from "./mt-loop";
import { policiesFor } from "./driver-visibility";

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
  /** Conversations still live, whichever truck they are for. */
  negotiations: NegotiationSummary[];
  /** Loads booked out of this inbox, newest first. */
  bookings: BookingRecord[];
  /** Messages nobody has read yet, across every conversation. */
  messagesWaiting: number;
  /** Rate confirmations still waiting to be checked and signed. */
  rateConsWaiting: number;
  /** Opportunities sent to a driver that nobody has answered. */
  driverReviewsWaiting: number;
  /** Every rate confirmation in the workspace, newest first. */
  rateCons: RateConWorkflow[];
  ranking: RankingPreferences;
  learning: LearningSummary;
  counts: {
    listings: number;
    duplicatesFolded: number;
    eligible: number;
    ineligible: number;
    shortlisted: number;
    draftsWaiting: number;
    /** Conversations where the ball is with us. */
    negotiationsWaitingOnYou: number;
    /** Agreed with a broker and not yet turned into a load. */
    agreedNotBooked: number;
    /** Booked loads still waiting on a driver to accept. */
    consentPending: number;
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
  // Offers age out AFTER the listings do, so a number that went stale because
  // the load itself came off the board is recorded as the load going, not as
  // the dispatcher being slow.
  expireStaleOffers(ctx);
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
  const bookings = bookingsForWorkspace(ctx);
  const negotiations = withBookings(summarizeAll(openNegotiations(ctx), ctx), bookings);
  reconcileMessages(ctx);
  const waiting = messagesWaitingCount(ctx);
  const rateCons = rateConsFor(ctx);
  const driverReviewsWaiting = reviewsFor(ctx).filter((r) => r.status === "waiting").length;
  const rateConsWaiting = rateCons.filter(
    (w) => w.status === "reviewing" || w.status === "ready_to_confirm",
  ).length;

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
    negotiations,
    bookings,
    messagesWaiting: waiting,
    rateConsWaiting,
    driverReviewsWaiting,
    rateCons,
    ranking: rankingPreferences(ctx.organizationId),
    learning: learningFor(ctx.organizationId),
    counts: {
      listings: listings.length,
      duplicatesFolded: listings.reduce((sum, l) => sum + Math.max(0, l.sightings.length - 1), 0),
      eligible: matches.filter((m) => m.match.status === "eligible").length,
      ineligible: matches.filter((m) => m.match.status === "ineligible").length,
      shortlisted: matches.filter((m) => m.match.status === "shortlisted").length,
      draftsWaiting: drafts.filter((d) => d.status === "ready").length,
      negotiationsWaitingOnYou: negotiations.filter(
        (n) => n.negotiation.status === "waiting_on_you",
      ).length,
      agreedNotBooked: negotiations.filter(
        (n) => n.negotiation.status === "agreed",
      ).length,
      consentPending: bookings.filter((b) => b.consent === "pending").length,
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
  /** Every conversation on this cycle, open or finished, newest first. */
  negotiations: NegotiationSummary[];
  /** The load booked onto this cycle, once there is one. */
  booking?: BookingRecord;
  /** Every message about this cycle, and the templates that can be picked. */
  communications: CycleCommunications;
  /** The rate confirmation for this cycle's load, once one has arrived. */
  rateCon?: RateConWorkflow;
  /** Opportunities sent to this truck's driver, newest first. */
  driverReviews: DriverReview[];
  /**
   * What this carrier shows its drivers, by pay model.
   *
   * Carried in the payload rather than read by the editor while it renders:
   * a screen that reads module state mid-render does not re-render when that
   * state changes, and a settings control that ignores its own clicks is worse
   * than no control.
   */
  driverVisibility: DriverVisibilityPolicy[];
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
    negotiations: withBookings(
      summarizeAll(negotiationsForCycle(dispatchCycleId, ctx), ctx),
      bookingsForWorkspace(ctx),
    ),
    booking: bookingForCycle(dispatchCycleId, ctx),
    communications: cycleCommunicationsSync(dispatchCycleId, ctx),
    rateCon: rateConForCycle(dispatchCycleId, ctx),
    driverReviews: reviewsForCycle(dispatchCycleId, ctx),
    driverVisibility: carrierOf(dispatchCycleId, ctx) ? policiesFor(carrierOf(dispatchCycleId, ctx)!) : [],
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

/**
 * Put each booking next to the conversation that produced it.
 *
 * Joined here rather than inside the negotiation service, which must not know
 * that booking exists: booking reads negotiations, and a module that reads back
 * the other way would be a cycle. This file already knows about both, which is
 * what it is for.
 */
function withBookings(
  rows: NegotiationSummary[],
  bookings: BookingRecord[],
): NegotiationSummary[] {
  if (bookings.length === 0) return rows;
  const byNegotiation = new Map(bookings.map((b) => [b.negotiationId, b]));
  return rows.map((r) => {
    const booking = byNegotiation.get(r.negotiation.negotiationId);
    return booking ? { ...r, booking } : r;
  });
}

/**
 * Everything a screen needs about a row, resolved here rather than there.
 *
 * The draft that covers it and the driver review on it are both things a match
 * card shows, and both live in other services. Resolving them while a component
 * renders would make the card depend on module state React cannot see — and a
 * memoized card would then keep showing a driver's answer from before they gave
 * it. So they are attached to the data, once, on the way out.
 */
function attachDrafts(rows: MatchWithListing[], ctx: MtLoopContext): MatchWithListing[] {
  return rankMatches(
    rows.map((r) => {
      const gate = driverGate(r.match.matchId, ctx);
      const review = reviewForMatch(r.match.matchId, ctx);
      const resendable = !review || review.status === "withdrawn" || review.status === "declined";
      return {
        ...r,
        draftId: draftIdForMatch(r.match.matchId, ctx),
        driver: {
          hasDriver: gate.hasDriver,
          reviewRequired: gate.reviewRequired,
          canSend: gate.hasDriver && resendable && r.listing.status === "open",
          status: gate.status,
          driverName: gate.driverName,
          note: gate.reason ?? driverReadout(gate.status, gate.driverName),
        },
      };
    }),
  );
}

/** Whose authority a cycle runs under, for the policies that belong to them. */
function carrierOf(dispatchCycleId: string, ctx: MtLoopContext): string | undefined {
  return mtLoopById(dispatchCycleId, ctx)?.carrierOrganizationId;
}

/** Where a finished review got to, in one line, for the load it is about. */
function driverReadout(status: string | undefined, driverName?: string): string | undefined {
  const who = driverName ?? "The driver";
  if (status === "approved") return `${who} approved this.`;
  if (status === "countered") return `${who} will take it, at their own number.`;
  return undefined;
}

function messagesWaitingCount(ctx: MtLoopContext): number {
  let n = 0;
  for (const thread of threadsFor(ctx)) {
    n += thread.messages.filter((m) => m.status === "draft").length;
  }
  return n;
}

/**
 * Approve the opening inquiry, and put it in the conversation it opens.
 *
 * Two services own half of this each and neither may own both: the drafts
 * service owns the grouping rule that stops one carrier writing to a broker
 * twice about one load, and the communications service owns the thread that
 * everything said afterwards hangs off. Joining them anywhere but here would
 * mean one of them importing the other, and they are deliberately unaware of
 * each other.
 */
export async function approveDraftAndOpenThread(
  draftId: string,
  ctx: MtLoopContext,
): Promise<DraftOutcome> {
  const outcome = await approveDraft(draftId, ctx);
  if (outcome.status === "ok" && outcome.draft) {
    recordInquiryFromDraft(outcome.draft, ctx);
  }
  return outcome;
}

/* -------------------------------------------------------------------------- */
/* A load going somewhere                                                      */
/* -------------------------------------------------------------------------- */

// `bookAndStandDown` lives in the booking service, which owns committing a
// truck. It is re-exported here because this is the door the screens come
// through and because the tests written against it predate that move.
export type { CloseoutResult };
export { bookAndStandDown };

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
): {
  closedMatchIds: string[];
  supersededDraftIds: string[];
  closedNegotiationIds: string[];
  closedReviewIds: string[];
} {
  const closedMatchIds = listingTakenElsewhere(listingId, ctx, reason);
  const supersededDraftIds = supersedeDraftsForListing(ctx.organizationId, listingId, reason);
  // A conversation about a load that is gone is the worst of the three to
  // leave open: it is the one where somebody is still typing.
  const closedNegotiationIds = closeNegotiationsForListing(ctx.organizationId, listingId, reason);
  // And a driver still deciding about it is owed the same courtesy.
  const closedReviewIds = closeReviewsForListing(ctx.organizationId, listingId, reason);
  return { closedMatchIds, supersededDraftIds, closedNegotiationIds, closedReviewIds };
}
