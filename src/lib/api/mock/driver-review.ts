import type {
  DriverDecisionKind, DriverGate, DriverReview, DriverReviewStatus,
  DriverSendChannel, EffectiveVisibility, EngagementType, MatchWithListing,
  OutgoingOpportunity, OutgoingProgressUpdate,
} from "@/types";
import { driverWorkflowPort } from "../contracts/driver-workflow";
import { carrierViewSync } from "./carrier-registry";
import { driverViewSync } from "./driver-registry";
import { mtLoopById } from "./mt-loop";
import type { MtLoopContext } from "./mt-loop";
import { allMatches, estimateProfit } from "./opportunity-matching";
import { effectiveListing } from "./listing-corrections";
import { effectiveVisibility, redact, sendsAnyMoney } from "./driver-visibility";
import type { FullOpportunityFacts, RedactedFacts } from "./driver-visibility";
import { recordDriverAnswer } from "./driver-workflow-adapter";
import { truckContextFrom } from "./truck-registry";
import { factoringStatusSync, policyForSync } from "./factoring-registry";
import { driverFactoringLabel, type DriverFactoringLabel } from "@/lib/factoring";
// The shared simulated round trip. A seeder can suppress it; a person never does.
import { sleep } from "./latency";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * Asking the driver before anybody negotiates.
 *
 * The rule, in one sentence: if the dispatcher sends an opportunity to the
 * driver, the negotiation waits for the answer. Not "is discouraged from
 * starting" — waits. A dispatcher who has asked a driver and then agrees a
 * price anyway has not asked them anything.
 *
 * Sending is OPTIONAL by default, because a dispatcher who knows their driver
 * does not need to send every load to them, and a system that forces it slows
 * down the thing it is trying to help. A carrier that wants it compulsory sets
 * a rule and then it cannot be skipped — that decision belongs to the carrier,
 * not to us and not to the dispatcher.
 *
 * Nothing here reaches a driver. Everything crosses the Driver Workflow port,
 * whose only implementation today is a stand-in that delivers nothing and says
 * so. What the driver "said" is recorded by a dispatcher, exactly as a phone
 * call would be, and carries its source everywhere it is shown.
 */

const LATENCY_MS = 220;

let seq = 0;
const rowId = (p: string) => `${p}_${(++seq).toString(36)}${Date.now().toString(36)}`;
const nowIso = () => new Date().toISOString();

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

const byOrg = new Map<string, DriverReview[]>();

function bucket(organizationId: string): DriverReview[] {
  let rows = byOrg.get(organizationId);
  if (!rows) {
    rows = [];
    byOrg.set(organizationId, rows);
  }
  return rows;
}

export function resetDriverReviews() {
  byOrg.clear();
  seq = 0;
}

function mayAct(ctx: MtLoopContext): boolean {
  return ctx.permissions.has("loads:view") && ctx.scope.loads !== "assigned";
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

export function reviewById(reviewId: string, ctx: MtLoopContext): DriverReview | undefined {
  if (!mayAct(ctx)) return undefined;
  return bucket(ctx.organizationId).find((r) => r.reviewId === reviewId);
}

/** The live review for one match, if there is one. */
export function reviewForMatch(matchId: string, ctx: MtLoopContext): DriverReview | undefined {
  if (!mayAct(ctx)) return undefined;
  const rows = bucket(ctx.organizationId).filter((r) => r.matchId === matchId);
  return rows.find((r) => r.status !== "withdrawn") ?? rows[rows.length - 1];
}

export function reviewsForCycle(dispatchCycleId: string, ctx: MtLoopContext): DriverReview[] {
  if (!mayAct(ctx)) return [];
  return bucket(ctx.organizationId)
    .filter((r) => r.dispatchCycleId === dispatchCycleId)
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt));
}

export function reviewsFor(ctx: MtLoopContext): DriverReview[] {
  if (!mayAct(ctx)) return [];
  return [...bucket(ctx.organizationId)].sort((a, b) => b.sentAt.localeCompare(a.sentAt));
}

/** What the port says about itself, for every screen that shows its output. */
export function portDescription() {
  return driverWorkflowPort().describe();
}

/* -------------------------------------------------------------------------- */
/* The gate                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Does the carrier insist the driver is asked first?
 *
 * A carrier rule, like the rate floor and the consent requirement. Carriers
 * that run owner-operators very often do insist, because the driver is a
 * business deciding whether to take work rather than an employee being
 * assigned it.
 */
export function reviewRequiredBy(carrierOrganizationId: string, ctx: MtLoopContext): boolean {
  const carrier = carrierViewSync(carrierOrganizationId, truckContextFrom(ctx));
  return carrier?.rules.some((r) => r.kind === "driver_review_required") === true;
}

/**
 * Whether a negotiation may be opened on this match yet.
 *
 * Called by the negotiation service AND by the screen, so the button and the
 * rule cannot disagree. Three answers:
 *
 *   clear            nothing is in the way
 *   waiting          it was sent and the driver has not answered
 *   required         the carrier says it must be sent, and it has not been
 */
export function driverGate(matchId: string, ctx: MtLoopContext): DriverGate {
  const row = allMatches(ctx).find((r) => r.match.matchId === matchId);
  if (!row) return { clear: true, reviewRequired: false, hasDriver: false };

  const required = reviewRequiredBy(row.match.carrierOrganizationId, ctx);
  const review = reviewForMatch(matchId, ctx);
  const loop = mtLoopById(row.match.dispatchCycleId, ctx);
  const hasDriver = Boolean(loop?.driverProfileId);
  const driverName = review?.driverName ?? loop?.driverName;
  const base = { reviewRequired: required, hasDriver, driverName };

  if (!review) {
    if (!required) return { ...base, clear: true };
    if (!hasDriver) {
      // A carrier can require driver review and still have an empty truck with
      // nobody on it. Blocking the negotiation would leave the truck
      // unworkable; saying so lets a dispatcher fix the real problem.
      return {
        ...base,
        clear: true,
        reason: "This carrier asks for driver review, but there is no driver on this truck to ask.",
      };
    }
    return {
      ...base,
      clear: false,
      reason: `${row.match.carrierName ?? "This carrier"} asks that the driver sees a load before it is negotiated.`,
    };
  }

  switch (review.status) {
    case "waiting":
      return {
        ...base, clear: false, status: review.status,
        reason: `${review.driverName} has not answered yet. You sent it ${ago(review.sentAt)}.`,
      };
    case "approved":
      return { ...base, clear: true, status: review.status };
    case "countered":
      // A counter is a yes with a number on it, so the negotiation may start —
      // the dispatcher now knows what they have to beat.
      return { ...base, clear: true, status: review.status };
    case "declined":
      return {
        ...base, clear: false, status: review.status,
        reason: `${review.driverName} said no: ${lastComment(review) ?? "no reason given"}.`,
      };
    case "paused":
      return {
        ...base, clear: false, status: review.status,
        reason: `${review.driverName} wants something answered first: ${lastComment(review) ?? "no question recorded"}.`,
      };
    case "withdrawn":
      return required && hasDriver
        ? {
          ...base, clear: false, status: review.status,
          reason: "This was pulled back, and the carrier asks for driver review.",
        }
        : { ...base, clear: true, status: review.status };
  }
}

/**
 * What this carrier's factoring policy says about putting THIS load in front of
 * a driver, and the sentence that goes with it.
 *
 * Read against the carrier on the match. Returns nothing when the viewer may
 * not see factoring or the listing carries no broker MC — and "nothing" is a
 * pass, not an approval: the payload simply carries no factoring claim, which
 * is the honest state when nobody has asked.
 */
function factoringLabelFor(
  row: MatchWithListing,
  ctx: MtLoopContext,
): DriverFactoringLabel | undefined {
  if (!ctx.permissions.has("factoring:view")) return undefined;
  const carrierOrganizationId = row.match.carrierOrganizationId;
  try {
    const status = row.factoring ?? factoringStatusSync(ctx, {
      carrierOrganizationId,
      brokerNameObserved: row.listing.broker.name,
      brokerMcNumber: row.listing.broker.mcNumber,
      listingId: row.listing.listingId,
      dispatchCycleId: row.match.dispatchCycleId,
    });
    return driverFactoringLabel(status, policyForSync(carrierOrganizationId));
  } catch {
    return undefined;
  }
}

function lastComment(review: DriverReview): string | undefined {
  return [...review.decisions].reverse().find((d) => d.comment)?.comment;
}

function ago(iso: string): string {
  const mins = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

/* -------------------------------------------------------------------------- */
/* Sending                                                                     */
/* -------------------------------------------------------------------------- */

export type ReviewOutcome =
  | { status: "ok"; review: DriverReview }
  | { status: "not_permitted" }
  | { status: "not_found" }
  | { status: "no_driver" }
  | { status: "already_sent"; review: DriverReview }
  | { status: "needs_reason" }
  | { status: "closed" }
  | { status: "undeliverable"; reason: string }
  /**
   * The carrier forbids putting unapproved freight in front of a driver.
   *
   * Its own outcome rather than a generic refusal, because it is not a
   * permission problem and telling a dispatcher "you are not allowed" would
   * send them to an administrator instead of to the factor.
   */
  | { status: "factoring_not_approved"; reason: string };

/**
 * Send one opportunity to the driver on that truck.
 *
 * Everything the driver will see is built HERE, once, through the redaction the
 * visibility policy decides, and handed to the port already redacted. The port
 * never receives a load and a policy and decides for itself, because a
 * boundary that can see the unredacted record is a boundary that will one day
 * forward it.
 */
export async function sendOpportunityToDriver(
  matchId: string,
  ctx: MtLoopContext,
  note?: string,
  channel: DriverSendChannel = "app",
): Promise<ReviewOutcome> {
  await sleep(LATENCY_MS);
  if (!mayAct(ctx)) return { status: "not_permitted" };

  const row = allMatches(ctx).find((r) => r.match.matchId === matchId);
  if (!row) return { status: "not_found" };
  if (row.listing.status !== "open") return { status: "closed" };

  const existing = reviewForMatch(matchId, ctx);
  if (existing && existing.status !== "withdrawn" && existing.status !== "declined") {
    return { status: "already_sent", review: existing };
  }

  const loop = mtLoopById(row.match.dispatchCycleId, ctx);
  if (!loop) return { status: "not_found" };
  if (!loop.driverProfileId) return { status: "no_driver" };

  const truckCtx = truckContextFrom(ctx);
  const carrier = carrierViewSync(row.match.carrierOrganizationId, truckCtx);
  // Narrowed to THIS carrier's engagement: a person who drives for two carriers
  // has two pay models, and the wrong one shows the wrong money.
  const driver = driverViewSync(loop.driverProfileId, truckCtx, carrier?.organizationId);
  if (!driver || !carrier) return { status: "not_found" };

  /*
   * ★ THE CARRIER'S FACTORING POLICY, ENFORCED AT THE SEAM ★
   *
   * Read from the carrier on the MATCH, not from the workspace sending it, and
   * checked here rather than in the dialog — a rule only the UI ran would be a
   * decoration. A carrier that allows driver review before approval (the
   * default) passes straight through and the payload carries the honest label
   * instead.
   */
  const factoring = factoringLabelFor(row, ctx);
  if (factoring && !factoring.mayShareWithDriver) {
    return {
      status: "factoring_not_approved",
      reason: `${carrier.displayName} does not send loads to a driver before factoring has approved them.`,
    };
  }

  const engagementType: EngagementType = driver.engagementType;
  const visibility = effectiveVisibility(carrier.organizationId, engagementType, ctx);

  const listing = row.listing;
  const facts = factsFor(row, engagementType, ctx);

  const reviewId = rowId("rev");
  const payload: OutgoingOpportunity = {
    reviewId,
    dispatchCycleId: row.match.dispatchCycleId,
    carrierOrganizationId: carrier.organizationId,
    carrierName: carrier.displayName,
    driverProfileId: driver.driverProfileId,
    truckUnit: row.match.truckUnit,
    ...redact(facts, visibility),
    factoringNote: factoring?.label,
    note: note?.trim() || undefined,
    channel,
    sentAt: nowIso(),
    sentByName: ctx.actor.displayNameSnapshot,
    isMockDelivery: true,
  };

  const receipt = await driverWorkflowPort().sendOpportunity(ctx, payload);
  if (!receipt.ok) {
    return { status: "undeliverable", reason: receipt.reason ?? "The driver's side did not take it." };
  }

  const review: DriverReview = {
    reviewId,
    organizationId: ctx.organizationId,
    carrierOrganizationId: carrier.organizationId,
    dispatchCycleId: row.match.dispatchCycleId,
    matchId,
    listingId: listing.listingId,
    driverProfileId: driver.driverProfileId,
    driverName: driver.legalName,
    truckUnit: row.match.truckUnit,
    status: "waiting",
    sentAt: payload.sentAt,
    sentByName: payload.sentByName,
    sent: payload,
    visibility,
    decisions: [],
    updates: [],
  };
  bucket(ctx.organizationId).push(review);
  return { status: "ok", review };
}

/**
 * Everything Dispatch knows about one opportunity, before the policy applies.
 *
 * ★ ONE BUILDER, SO A PREVIEW CANNOT LIE ★
 * A dialog that shows a dispatcher "this is what the driver will get" and then
 * sends something assembled somewhere else is worse than no preview at all.
 * `previewForDriver` and `sendOpportunityToDriver` both come through here, so
 * what is shown is what goes.
 */
function factsFor(
  row: MatchWithListing,
  engagementType: EngagementType,
  ctx: MtLoopContext,
): FullOpportunityFacts {
  /*
   * ★ THE CORRECTED LOAD, NOT THE POSTING ★
   * If a broker said 30,000 lb on the phone where the board said 40,000, the
   * driver is told 30,000. Reading `row.listing` straight would send a driver
   * to a dock for a weight somebody already knew was wrong — which is the whole
   * reason corrections exist rather than living in a note.
   */
  const { listing } = effectiveListing(row.listing, row.match.dispatchCycleId, ctx);
  const loadedMiles = listing.loadedMiles ?? row.match.loadedMiles;
  return {
    originCity: listing.origin.city,
    originState: listing.origin.state,
    destinationCity: listing.destination.city,
    destinationState: listing.destination.state,
    equipmentLabel: listing.equipment.replace(/_/g, " "),
    pickupAt: listing.pickupAt,
    deliverBy: listing.deliverBy,
    loadedMiles,
    deadheadMiles: row.match.deadheadMiles,
    commodity: listing.commodity,
    weightLbs: listing.weightLbs,
    brokerName: listing.broker.name,
    brokerContact: [listing.broker.contactName, listing.broker.phone].filter(Boolean).join(" · ") || undefined,
    totalRateCents: listing.offeredRateCents,
    ratePerMileCents: listing.ratePerMileCents,
    estimatedProfitCents: estimateProfit(listing, row.match.deadheadMiles),
    // A company driver's own pay is theirs to see even where the load's rate is
    // not. Estimated from the load, and labelled an estimate wherever shown.
    driverPayEstimateCents: listing.offeredRateCents === undefined
      ? undefined
      : Math.round(listing.offeredRateCents * (engagementType === "owner_operator" ? 0.88 : 0.27)),
    accessorialTerms: undefined,
  };
}

export interface DriverSendPreview {
  driverName: string;
  driverPhone?: string;
  engagementType: EngagementType;
  carrierName: string;
  truckUnit: string;
  /** Exactly what would travel: the facts with the policy already applied. */
  facts: RedactedFacts;
  /** What was removed, and why. Shown so a dispatcher is not surprised. */
  visibility: EffectiveVisibility;
  /** The whole truth, for the dispatcher's own eyes on a phone call. */
  full: FullOpportunityFacts;
  /**
   * What the carrier's factoring policy says about sending this one.
   *
   * Carried on the preview so the dialog can state it before anybody presses
   * send, and so a policy that forbids it is visible rather than discovered
   * when the send is refused.
   */
  factoring?: DriverFactoringLabel;
}

/**
 * What a driver would be told about this load, before anybody sends it.
 *
 * ★ TWO AUDIENCES, ONE CALL ★
 * `facts` is the driver's version — redacted by the carrier's policy and
 * narrowed again by what the sender may themselves see. `full` is the
 * dispatcher's, for reading off during a phone call. They are returned
 * together and never confused: only `facts` is ever sent.
 */
export function previewForDriver(
  matchId: string,
  ctx: MtLoopContext,
): DriverSendPreview | undefined {
  if (!mayAct(ctx)) return undefined;
  const row = allMatches(ctx).find((r) => r.match.matchId === matchId);
  if (!row) return undefined;

  const loop = mtLoopById(row.match.dispatchCycleId, ctx);
  if (!loop?.driverProfileId) return undefined;

  const truckCtx = truckContextFrom(ctx);
  const carrier = carrierViewSync(row.match.carrierOrganizationId, truckCtx);
  const driver = driverViewSync(loop.driverProfileId, truckCtx, carrier?.organizationId);
  if (!driver || !carrier) return undefined;

  const visibility = effectiveVisibility(carrier.organizationId, driver.engagementType, ctx);
  const full = factsFor(row, driver.engagementType, ctx);

  return {
    driverName: driver.legalName,
    driverPhone: driver.phone,
    engagementType: driver.engagementType,
    carrierName: carrier.displayName,
    truckUnit: row.match.truckUnit,
    facts: redact(full, visibility),
    visibility,
    full,
    factoring: factoringLabelFor(row, ctx),
  };
}

/**
 * Tell a driver how it is going, while they are waiting or after they said yes.
 *
 * Allowed at any stage until the load is booked, which is what the roadmap
 * asks for and what a driver deciding whether to hold their evening actually
 * needs. The number is included only where the driver may see money at all —
 * an update that leaks a rate the policy hides would be a hole straight
 * through the policy.
 */
export async function sendProgressUpdate(
  reviewId: string,
  note: string,
  ctx: MtLoopContext,
  onTheTableCents?: number,
): Promise<ReviewOutcome> {
  await sleep(LATENCY_MS);
  if (!mayAct(ctx)) return { status: "not_permitted" };
  const review = reviewById(reviewId, ctx);
  if (!review) return { status: "not_found" };
  if (!note.trim()) return { status: "needs_reason" };
  if (review.status === "withdrawn") return { status: "closed" };

  const update: OutgoingProgressUpdate = {
    updateId: rowId("upd"),
    reviewId,
    dispatchCycleId: review.dispatchCycleId,
    at: nowIso(),
    byName: ctx.actor.displayNameSnapshot,
    note: note.trim(),
    onTheTableCents: sendsAnyMoney(review.visibility) ? onTheTableCents : undefined,
    isMockDelivery: true,
  };

  const receipt = await driverWorkflowPort().sendProgressUpdate(ctx, update);
  if (!receipt.ok) {
    return { status: "undeliverable", reason: receipt.reason ?? "The driver's side did not take it." };
  }
  review.updates.push(update);
  return { status: "ok", review };
}

export async function withdrawReview(
  reviewId: string,
  reason: string,
  ctx: MtLoopContext,
): Promise<ReviewOutcome> {
  await sleep(LATENCY_MS);
  if (!mayAct(ctx)) return { status: "not_permitted" };
  const review = reviewById(reviewId, ctx);
  if (!review) return { status: "not_found" };
  if (!reason.trim()) return { status: "needs_reason" };

  await driverWorkflowPort().withdrawOpportunity(ctx, reviewId, reason.trim());
  review.status = "withdrawn";
  review.withdrawnReason = reason.trim();
  review.answeredAt = nowIso();
  return { status: "ok", review };
}

/* -------------------------------------------------------------------------- */
/* What comes back                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Take down what the driver said.
 *
 * Goes through the adapter rather than writing the decision here, so that the
 * day the real Driver Workflow produces them this function reads them instead
 * of inventing them, and every screen already knows to show where an answer
 * came from.
 */
export async function recordDriverDecision(
  reviewId: string,
  kind: DriverDecisionKind,
  ctx: MtLoopContext,
  input: { comment?: string; wantedRateCents?: number } = {},
): Promise<ReviewOutcome> {
  if (!mayAct(ctx)) return { status: "not_permitted" };
  const review = reviewById(reviewId, ctx);
  if (!review) return { status: "not_found" };
  if (review.status === "withdrawn") return { status: "closed" };
  if ((kind === "declined" || kind === "paused") && !input.comment?.trim()) {
    return { status: "needs_reason" };
  }

  const decision = await recordDriverAnswer({
    reviewId,
    kind,
    comment: input.comment,
    wantedRateCents: input.wantedRateCents,
  });
  if (!decision) return { status: "not_found" };

  review.decisions.push(decision);
  review.status = kind as DriverReviewStatus;
  review.answeredAt = decision.at;
  return { status: "ok", review };
}

/**
 * What the driver says they need for this load.
 *
 * ★ RECORDED WHERE THE NEGOTIATION CAN SEE IT ★
 * A dispatcher who asks an owner-operator "would you run this?" usually gets
 * "not under $1,800" back, and that number is the floor of the conversation
 * they are about to have with the broker. Kept on the review, which is where
 * `openNegotiation` reads it — a requirement written into a comment would be a
 * requirement the negotiation opened underneath.
 *
 * It is not a decision: a driver can name a price without saying yes, and
 * saying yes later does not erase what they asked for.
 */
export async function recordDriverRateRequirement(
  reviewId: string,
  amountCents: number,
  ctx: MtLoopContext,
  note?: string,
): Promise<ReviewOutcome> {
  await sleep(LATENCY_MS);
  if (!mayAct(ctx)) return { status: "not_permitted" };
  const review = reviewById(reviewId, ctx);
  if (!review) return { status: "not_found" };
  if (review.status === "withdrawn") return { status: "closed" };
  if (!Number.isFinite(amountCents) || amountCents <= 0) return { status: "needs_reason" };

  review.rateRequirementCents = Math.round(amountCents);
  review.rateRequirementNote = note?.trim() || undefined;
  review.rateRequirementAt = new Date().toISOString();
  review.rateRequirementByName = ctx.actor.displayNameSnapshot;
  return { status: "ok", review };
}

/** The driver's floor for one match, where a driver has named one. */
export function driverRateRequirement(
  matchId: string,
  ctx: MtLoopContext,
): { cents: number; driverName: string; note?: string } | undefined {
  const review = reviewsFor(ctx).find((r) => r.matchId === matchId && r.rateRequirementCents);
  if (!review?.rateRequirementCents) return undefined;
  return {
    cents: review.rateRequirementCents,
    driverName: review.driverName,
    note: review.rateRequirementNote,
  };
}

/**
 * Pull the current answers from the port.
 *
 * A no-op against the stand-in, which Dispatch has already been told about
 * directly. It exists because the real Driver Workflow will answer on its own
 * schedule, and the call site for that has to be here rather than invented
 * later next to a screen.
 */
export async function refreshFromDriverWorkflow(
  reviewId: string,
  ctx: MtLoopContext,
): Promise<DriverReview | undefined> {
  const review = reviewById(reviewId, ctx);
  if (!review) return undefined;
  const port = driverWorkflowPort();
  const decisions = await port.decisionsFor(ctx, reviewId);
  const status = await port.statusFor(ctx, reviewId);
  const known = new Set(review.decisions.map((d) => d.decisionId));
  for (const decision of decisions) {
    if (!known.has(decision.decisionId)) review.decisions.push(decision);
  }
  if (status) review.status = status;
  return review;
}

/* -------------------------------------------------------------------------- */
/* Closing them out                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The load went, so there is nothing left to ask about.
 *
 * Called by the same stand-down that closes matches, drafts and conversations.
 * A driver left holding a question about a load somebody else booked is the
 * same failure as a broker left waiting for a truck that is gone.
 */
export function closeReviewsForListing(
  organizationId: string,
  listingId: string,
  reason: string,
  exceptReviewId?: string,
): string[] {
  const closed: string[] = [];
  for (const review of bucket(organizationId)) {
    if (review.listingId !== listingId) continue;
    if (review.reviewId === exceptReviewId) continue;
    if (review.status === "withdrawn") continue;
    review.status = "withdrawn";
    review.withdrawnReason = reason;
    review.answeredAt = nowIso();
    closed.push(review.reviewId);
  }
  return closed;
}

/** Test seam only. */
export function reviewsForTests(organizationId: string): DriverReview[] {
  return bucket(organizationId);
}
