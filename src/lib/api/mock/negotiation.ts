import type {
  Cents, Listing, MatchWithListing, Negotiation, NegotiationChannel,
  NegotiationRound, NegotiationRoundKind, NegotiationSummary,
} from "@/types";
import { isNegotiationOpen, UNARGUABLE_CHECKS } from "@/types";
import { listingById } from "./listing-registry";
import { allMatches, matchById, truckMatchContext } from "./opportunity-matching";
import { driverGate } from "./driver-review";
import { mtLoopById } from "./mt-loop";
import type { MtLoopContext } from "./mt-loop";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * Agreeing a price with a broker.
 *
 * NOTHING IS SENT OR RECEIVED HERE. A broker reply is either something a person
 * typed in after a phone call — the most trustworthy round there is — or a
 * sample reply generated from the same mock market the listings come from, and
 * labelled `sample_reply` so no screen can show it as if a broker wrote it.
 *
 * Three rules do the real work:
 *
 *   1. A negotiation cannot be opened on a match that fails a check no
 *      conversation can fix. Rate and deadhead are exactly what negotiating is
 *      for; equipment, authority, capacity and an expired licence are not, and
 *      letting a dispatcher spend an afternoon arguing one of those is worse
 *      than telling them no.
 *
 *   2. Rounds are appended, never edited. What the broker first offered is as
 *      much a part of the record as what was finally agreed — it is how a
 *      dispatcher learns which brokers move and which do not.
 *
 *   3. Agreeing under the carrier's own rate floor takes a typed reason. The
 *      floor belongs to the carrier, not to the dispatch agency, and quietly
 *      going under it is taking a decision that is not the dispatcher's to
 *      take. It is allowed — a backhaul at a loss to reposition is a real
 *      thing — but it is recorded, in the dispatcher's words.
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const LATENCY_MS = 240;

let seq = 0;
const rowId = (p: string) => `${p}_${(++seq).toString(36)}${Date.now().toString(36)}`;
const nowIso = () => new Date().toISOString();

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

const byOrg = new Map<string, Negotiation[]>();

function bucket(organizationId: string): Negotiation[] {
  let rows = byOrg.get(organizationId);
  if (!rows) {
    rows = [];
    byOrg.set(organizationId, rows);
  }
  return rows;
}

export function resetNegotiations() {
  byOrg.clear();
  seq = 0;
}

/* -------------------------------------------------------------------------- */
/* Permission                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The same gate the matches use.
 *
 * A person who may only see the loads assigned to them is not negotiating for
 * a truck — they are a driver looking at their own work, and the whole module
 * is invisible to them rather than present and refusing.
 */
function mayAct(ctx: MtLoopContext): boolean {
  return ctx.permissions.has("loads:view") && ctx.scope.loads !== "assigned";
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

export function negotiationById(
  negotiationId: string,
  ctx: MtLoopContext,
): Negotiation | undefined {
  if (!mayAct(ctx)) return undefined;
  return bucket(ctx.organizationId).find((n) => n.negotiationId === negotiationId);
}

/** The negotiation on one match, if there is one. At most one is ever open. */
export function negotiationForMatch(
  matchId: string,
  ctx: MtLoopContext,
): Negotiation | undefined {
  if (!mayAct(ctx)) return undefined;
  const rows = bucket(ctx.organizationId).filter((n) => n.matchId === matchId);
  return rows.find((n) => n.status !== "withdrawn" && n.status !== "lost") ?? rows[rows.length - 1];
}

/** Every negotiation on one dispatch cycle, newest first. */
export function negotiationsForCycle(
  dispatchCycleId: string,
  ctx: MtLoopContext,
): Negotiation[] {
  if (!mayAct(ctx)) return [];
  return bucket(ctx.organizationId)
    .filter((n) => n.dispatchCycleId === dispatchCycleId)
    .sort((a, b) => b.openedAt.localeCompare(a.openedAt));
}

/**
 * Every negotiation this workspace has open, whichever truck it is for.
 *
 * "Agreed" counts as open, and deliberately so: a price agreed with a broker
 * and never turned into a load is the most dangerous state in the module —
 * the broker believes the truck is theirs and Antcolos does not know about it.
 * Leaving it out of this list is how it would stop being chased.
 */
export function openNegotiations(ctx: MtLoopContext): Negotiation[] {
  if (!mayAct(ctx)) return [];
  return bucket(ctx.organizationId)
    .filter((n) => isNegotiationOpen(n.status))
    .sort((a, b) => a.openedAt.localeCompare(b.openedAt));
}

/* -------------------------------------------------------------------------- */
/* Opening                                                                     */
/* -------------------------------------------------------------------------- */

export type OpenBlock =
  | { status: "ok" }
  | { status: "not_permitted" }
  | { status: "not_found" }
  | { status: "listing_gone" }
  | { status: "already_open"; negotiation: Negotiation }
  | { status: "unarguable"; reasons: string[] }
  /** The driver was asked and has not answered, or the carrier insists. */
  | { status: "driver_first"; reason: string; reviewRequired: boolean };

/**
 * Can a conversation about this match even be started?
 *
 * Exported because the screen has to answer the same question BEFORE offering
 * the button — a button that appears and then refuses is a worse experience
 * than a button that is not there with the reason written next to it.
 */
export function canOpen(matchId: string, ctx: MtLoopContext): OpenBlock {
  if (!mayAct(ctx)) return { status: "not_permitted" };
  const row = allMatches(ctx).find((r) => r.match.matchId === matchId);
  if (!row) return { status: "not_found" };

  const existing = negotiationForMatch(matchId, ctx);
  if (existing && (existing.status === "waiting_on_broker"
    || existing.status === "waiting_on_you"
    || existing.status === "agreed"
    || existing.status === "booked")) {
    return { status: "already_open", negotiation: existing };
  }

  if (row.listing.status !== "open") return { status: "listing_gone" };
  if (row.match.status === "closed_listing_gone" || row.match.status === "booked") {
    return { status: "listing_gone" };
  }

  const unarguable = row.match.checks.filter(
    (c) => c.outcome === "fail" && UNARGUABLE_CHECKS.includes(c.key),
  );
  if (unarguable.length > 0) {
    return { status: "unarguable", reasons: unarguable.map((c) => c.detail) };
  }

  // The driver comes LAST, after the things no conversation can fix. A driver
  // should not be asked about a load the truck cannot legally take.
  const gate = driverGate(matchId, ctx);
  if (!gate.clear) {
    return {
      status: "driver_first",
      reason: gate.reason ?? "The driver has to see this first.",
      reviewRequired: gate.reviewRequired,
    };
  }
  return { status: "ok" };
}

export type NegotiationOutcome =
  | { status: "ok"; negotiation: Negotiation }
  | { status: "not_permitted" }
  | { status: "not_found" }
  | { status: "listing_gone" }
  | { status: "already_open"; negotiation: Negotiation }
  | { status: "unarguable"; reasons: string[] }
  | { status: "driver_first"; reason: string; reviewRequired: boolean }
  | { status: "needs_reason" }
  | { status: "closed" };

/**
 * Open the conversation with what we are asking for.
 *
 * The opening ask defaults to the carrier's own floor applied to this lane
 * rather than to the posted rate, because asking for exactly what was posted
 * is not a negotiation — and a dispatcher who wants the posted number can type
 * it. Where the posted rate is already above the floor, the ask starts there
 * plus a margin, which is what a dispatcher does by hand.
 */
export async function openNegotiation(
  matchId: string,
  ctx: MtLoopContext,
  askCents?: Cents,
): Promise<NegotiationOutcome> {
  await sleep(LATENCY_MS);
  const gate = canOpen(matchId, ctx);
  if (gate.status !== "ok") return gate as NegotiationOutcome;

  const row = allMatches(ctx).find((r) => r.match.matchId === matchId);
  if (!row) return { status: "not_found" };
  const loop = mtLoopById(row.match.dispatchCycleId, ctx);
  if (!loop) return { status: "not_found" };
  const tc = truckMatchContext(loop, ctx);
  if (!tc) return { status: "not_found" };

  const ask = askCents ?? suggestedAsk(row, tc.minRatePerMileCents);
  const at = nowIso();
  const negotiation: Negotiation = {
    negotiationId: rowId("neg"),
    organizationId: ctx.organizationId,
    carrierOrganizationId: tc.carrier?.organizationId ?? ctx.organizationId,
    carrierName: tc.carrier?.legalName ?? ctx.organization.legalName,
    matchId,
    listingId: row.listing.listingId,
    dispatchCycleId: row.match.dispatchCycleId,
    truckId: row.match.truckId,
    truckUnit: row.match.truckUnit,
    status: "waiting_on_broker",
    brokerName: row.listing.broker.name,
    brokerContactName: row.listing.broker.contactName,
    brokerEmail: row.listing.broker.email,
    postedRateCents: row.listing.offeredRateCents,
    askedRateCents: ask,
    onTheTableCents: ask,
    openedAt: at,
    openedByName: ctx.actor.displayNameSnapshot,
    rounds: [{
      id: rowId("rd"),
      at,
      side: "us",
      kind: "opened",
      channel: "recorded_by_hand",
      amountCents: ask,
      byName: ctx.actor.displayNameSnapshot,
      actorMembershipId: ctx.membershipId,
      note: `Asked ${money(ask)} for ${row.listing.origin.city}, ${row.listing.origin.state} → ${row.listing.destination.city}, ${row.listing.destination.state}.`,
    }],
  };
  bucket(ctx.organizationId).push(negotiation);
  return { status: "ok", negotiation };
}

/**
 * What to open with.
 *
 * Never below the carrier's floor: opening under your own client's minimum is
 * giving away money before the conversation starts.
 */
export function suggestedAsk(row: MatchWithListing, floorPerMileCents: number): Cents {
  const miles = Math.max(row.match.loadedMiles, 1);
  const floor = Math.round(floorPerMileCents * miles);
  const posted = row.listing.offeredRateCents ?? floor;
  const room = Math.round(posted * 0.12);
  return Math.max(floor, posted + room);
}

/* -------------------------------------------------------------------------- */
/* Rounds                                                                      */
/* -------------------------------------------------------------------------- */

function append(
  negotiation: Negotiation,
  round: Omit<NegotiationRound, "id" | "at">,
): NegotiationRound {
  const full: NegotiationRound = { ...round, id: rowId("rd"), at: nowIso() };
  negotiation.rounds.push(full);
  return full;
}

/** Our side moves: a counter, or the first number after a broker's reply. */
export async function recordOurOffer(
  negotiationId: string,
  amountCents: Cents,
  ctx: MtLoopContext,
  note?: string,
): Promise<NegotiationOutcome> {
  await sleep(LATENCY_MS);
  const negotiation = negotiationById(negotiationId, ctx);
  if (!negotiation) return mayAct(ctx) ? { status: "not_found" } : { status: "not_permitted" };
  if (!isLive(negotiation)) return { status: "closed" };
  if (!listingStillOpen(negotiation, ctx)) return closeAsGone(negotiation);

  append(negotiation, {
    side: "us",
    kind: negotiation.rounds.length === 0 ? "offer" : "counter",
    channel: "recorded_by_hand",
    amountCents,
    byName: ctx.actor.displayNameSnapshot,
    actorMembershipId: ctx.membershipId,
    note,
  });
  negotiation.onTheTableCents = amountCents;
  negotiation.status = "waiting_on_broker";
  negotiation.offerExpiresAt = undefined;
  return { status: "ok", negotiation };
}

/**
 * The broker moved.
 *
 * `channel` is not optional and has no default: a reply that was typed in after
 * a phone call and a reply the sample market produced are different kinds of
 * fact, and the difference is exactly what a dispatcher needs to see.
 */
export async function recordBrokerRound(
  negotiationId: string,
  input: {
    kind: Extract<NegotiationRoundKind, "counter" | "accepted" | "declined" | "note">;
    amountCents?: Cents;
    channel: NegotiationChannel;
    byName?: string;
    note?: string;
    /** How long their number is good for. */
    goodForHours?: number;
  },
  ctx: MtLoopContext,
): Promise<NegotiationOutcome> {
  await sleep(LATENCY_MS);
  const negotiation = negotiationById(negotiationId, ctx);
  if (!negotiation) return mayAct(ctx) ? { status: "not_found" } : { status: "not_permitted" };
  if (!isLive(negotiation)) return { status: "closed" };
  if (!listingStillOpen(negotiation, ctx)) return closeAsGone(negotiation);

  append(negotiation, {
    side: "broker",
    kind: input.kind,
    channel: input.channel,
    amountCents: input.amountCents,
    byName: input.byName ?? negotiation.brokerContactName ?? negotiation.brokerName,
    note: input.note,
  });

  if (input.kind === "declined") {
    negotiation.status = "lost";
    negotiation.closedAt = nowIso();
    negotiation.outcomeNote = input.note ?? "The broker said no.";
    return { status: "ok", negotiation };
  }
  if (input.kind === "accepted") {
    // They took OUR number: the price on the table is already ours.
    negotiation.agreedRateCents = negotiation.onTheTableCents;
    negotiation.status = "agreed";
    return { status: "ok", negotiation };
  }
  if (input.kind === "counter" && input.amountCents !== undefined) {
    negotiation.onTheTableCents = input.amountCents;
    negotiation.offerExpiresAt = input.goodForHours
      ? new Date(Date.now() + input.goodForHours * 3_600_000).toISOString()
      : undefined;
  }
  negotiation.status = "waiting_on_you";
  return { status: "ok", negotiation };
}

/* -------------------------------------------------------------------------- */
/* Sample replies                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A reply from the sample market.
 *
 * Deterministic from the listing, so the same load always behaves the same way
 * and a dispatcher can be shown the same thing twice. A broker who has been
 * paid by this workspace before moves further, and a load picking up sooner
 * moves further still — both are true of real brokers, and both give the
 * ranking something honest to be checked against later.
 *
 * It is a MOCK. Every round it writes carries `channel: "sample_reply"`.
 */
export async function sampleBrokerReply(
  negotiationId: string,
  ctx: MtLoopContext,
): Promise<NegotiationOutcome> {
  const negotiation = negotiationById(negotiationId, ctx);
  if (!negotiation) return mayAct(ctx) ? { status: "not_found" } : { status: "not_permitted" };
  if (!isLive(negotiation)) return { status: "closed" };
  const listing = listingById(ctx.organizationId, negotiation.listingId);
  if (!listing || listing.status !== "open") return closeAsGone(negotiation);

  const asked = negotiation.onTheTableCents ?? negotiation.askedRateCents;
  const posted = listing.offeredRateCents ?? asked;
  const willingness = movement(listing);

  // How far above the posting they will actually come.
  const ceiling = Math.round(posted * (1 + willingness));
  if (asked <= ceiling) {
    return recordBrokerRound(negotiationId, {
      kind: "accepted",
      channel: "sample_reply",
      note: "Took the number as asked.",
    }, ctx);
  }

  const counter = Math.max(posted, Math.round((asked + ceiling) / 2));
  if (counter <= posted) {
    return recordBrokerRound(negotiationId, {
      kind: "counter",
      amountCents: posted,
      channel: "sample_reply",
      goodForHours: 2,
      note: "Holding at the posted rate.",
    }, ctx);
  }
  return recordBrokerRound(negotiationId, {
    kind: "counter",
    amountCents: counter,
    channel: "sample_reply",
    goodForHours: 3,
    note: "Came up, but not all the way.",
  }, ctx);
}

/** 0.02–0.18 of the posted rate, derived from the load itself. */
function movement(listing: Listing): number {
  let m = 0.06;
  if (listing.broker.workedWithBefore) m += 0.05;
  if ((listing.broker.creditScore ?? 0) >= 90) m += 0.02;
  const hoursOut = (Date.parse(listing.pickupAt) - Date.now()) / 3_600_000;
  if (hoursOut < 12) m += 0.05;
  else if (hoursOut > 72) m -= 0.03;
  if (listing.teamRequired) m += 0.02;
  return Math.min(0.18, Math.max(0.02, m));
}

/* -------------------------------------------------------------------------- */
/* Ending it                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Take the number on the table.
 *
 * The floor check is the point of this function. The carrier set a minimum per
 * loaded mile; going under it is allowed, because repositioning at a loss is a
 * real decision, but it is the dispatcher's decision to make out loud and in
 * writing rather than by clicking through.
 */
export async function acceptOnTheTable(
  negotiationId: string,
  ctx: MtLoopContext,
  belowFloorReason?: string,
): Promise<NegotiationOutcome> {
  await sleep(LATENCY_MS);
  const negotiation = negotiationById(negotiationId, ctx);
  if (!negotiation) return mayAct(ctx) ? { status: "not_found" } : { status: "not_permitted" };
  if (!isLive(negotiation)) return { status: "closed" };
  if (!listingStillOpen(negotiation, ctx)) return closeAsGone(negotiation);

  const amount = negotiation.onTheTableCents;
  if (amount === undefined) return { status: "not_found" };

  if (isBelowFloor(negotiation, amount, ctx) && !belowFloorReason?.trim()) {
    return { status: "needs_reason" };
  }

  append(negotiation, {
    side: "us",
    kind: "accepted",
    channel: "recorded_by_hand",
    amountCents: amount,
    byName: ctx.actor.displayNameSnapshot,
    actorMembershipId: ctx.membershipId,
    note: belowFloorReason?.trim()
      ? `Below ${negotiation.carrierName}'s floor. ${belowFloorReason.trim()}`
      : undefined,
  });
  negotiation.agreedRateCents = amount;
  negotiation.belowFloorReason = belowFloorReason?.trim() || undefined;
  negotiation.status = "agreed";
  negotiation.offerExpiresAt = undefined;
  return { status: "ok", negotiation };
}

/** Is this number under the carrier's own minimum for this truck? */
export function isBelowFloor(
  negotiation: Negotiation,
  amountCents: Cents,
  ctx: MtLoopContext,
): boolean {
  const floor = carrierFloorPerMile(negotiation, ctx);
  if (floor === undefined) return false;
  const match = matchById(negotiation.matchId, ctx);
  const miles = Math.max(match?.loadedMiles ?? 0, 1);
  return amountCents / miles < floor;
}

export function carrierFloorPerMile(
  negotiation: Negotiation,
  ctx: MtLoopContext,
): number | undefined {
  const loop = mtLoopById(negotiation.dispatchCycleId, ctx);
  if (!loop) return undefined;
  return truckMatchContext(loop, ctx)?.minRatePerMileCents;
}

export async function walkAway(
  negotiationId: string,
  ctx: MtLoopContext,
  reason: string,
): Promise<NegotiationOutcome> {
  await sleep(LATENCY_MS);
  const negotiation = negotiationById(negotiationId, ctx);
  if (!negotiation) return mayAct(ctx) ? { status: "not_found" } : { status: "not_permitted" };
  if (!isLive(negotiation)) return { status: "closed" };
  if (!reason.trim()) return { status: "needs_reason" };

  append(negotiation, {
    side: "us",
    kind: "withdrawn",
    channel: "recorded_by_hand",
    byName: ctx.actor.displayNameSnapshot,
    actorMembershipId: ctx.membershipId,
    note: reason.trim(),
  });
  negotiation.status = "withdrawn";
  negotiation.closedAt = nowIso();
  negotiation.outcomeNote = reason.trim();
  return { status: "ok", negotiation };
}

/**
 * Time ran out on the number the broker gave us.
 *
 * Swept rather than checked on read, so the queue and the screen agree about
 * what has expired, and so expiry writes a round like everything else.
 */
export function expireStaleOffers(ctx: MtLoopContext): number {
  if (!mayAct(ctx)) return 0;
  const now = Date.now();
  let n = 0;
  for (const negotiation of bucket(ctx.organizationId)) {
    if (negotiation.status !== "waiting_on_you") continue;
    if (!negotiation.offerExpiresAt) continue;
    if (Date.parse(negotiation.offerExpiresAt) > now) continue;
    append(negotiation, {
      side: "broker",
      kind: "expired",
      channel: "sample_reply",
      byName: negotiation.brokerContactName ?? negotiation.brokerName,
      note: "The number they gave is no longer good.",
    });
    negotiation.status = "expired";
    negotiation.closedAt = nowIso();
    negotiation.outcomeNote = "Nobody answered in time.";
    negotiation.onTheTableCents = undefined;
    n += 1;
  }
  return n;
}

/**
 * The load went somewhere else while we were talking about it.
 *
 * Called by the same stand-down the matches use, so a listing closing takes its
 * conversations with it instead of leaving a dispatcher arguing over a load
 * their colleague booked an hour ago.
 */
export function closeNegotiationsForListing(
  organizationId: string,
  listingId: string,
  reason: string,
  exceptNegotiationId?: string,
): string[] {
  const closed: string[] = [];
  for (const negotiation of bucket(organizationId)) {
    if (negotiation.listingId !== listingId) continue;
    if (negotiation.negotiationId === exceptNegotiationId) continue;
    if (!isLive(negotiation)) continue;
    negotiation.rounds.push({
      id: rowId("rd"),
      at: nowIso(),
      side: "us",
      kind: "withdrawn",
      channel: "recorded_by_hand",
      byName: "Antcolos",
      note: reason,
    });
    negotiation.status = "lost";
    negotiation.closedAt = nowIso();
    negotiation.outcomeNote = reason;
    closed.push(negotiation.negotiationId);
  }
  return closed;
}

/** Mark the one that won. Called by booking, which owns everything else. */
export function markBooked(negotiation: Negotiation) {
  negotiation.status = "booked";
  negotiation.closedAt = nowIso();
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function isLive(negotiation: Negotiation): boolean {
  return negotiation.status === "waiting_on_broker"
    || negotiation.status === "waiting_on_you"
    || negotiation.status === "agreed";
}

function listingStillOpen(negotiation: Negotiation, ctx: MtLoopContext): boolean {
  const listing = listingById(ctx.organizationId, negotiation.listingId);
  return listing?.status === "open";
}

function closeAsGone(negotiation: Negotiation): NegotiationOutcome {
  negotiation.status = "lost";
  negotiation.closedAt = nowIso();
  negotiation.outcomeNote = "The load went elsewhere.";
  return { status: "listing_gone" };
}

const money = (cents: Cents) => `$${(cents / 100).toLocaleString("en-US", {
  minimumFractionDigits: 0, maximumFractionDigits: 0,
})}`;

/* -------------------------------------------------------------------------- */
/* For the screen                                                              */
/* -------------------------------------------------------------------------- */

/** A negotiation with the numbers a screen needs, worked out once, here. */
export function summarize(
  negotiation: Negotiation,
  ctx: MtLoopContext,
): NegotiationSummary | undefined {
  const listing = listingById(ctx.organizationId, negotiation.listingId);
  const match = matchById(negotiation.matchId, ctx);
  if (!listing || !match) return undefined;
  const onTable = negotiation.agreedRateCents ?? negotiation.onTheTableCents;
  const miles = Math.max(match.loadedMiles, 1);
  return {
    negotiation,
    lane: `${listing.origin.city}, ${listing.origin.state} → ${listing.destination.city}, ${listing.destination.state}`,
    pickupAt: listing.pickupAt,
    equipmentLabel: listing.equipment.replace(/_/g, " "),
    carrierFloorPerMileCents: carrierFloorPerMile(negotiation, ctx),
    onTheTablePerMileCents: onTable === undefined ? undefined : Math.round(onTable / miles),
    totalMiles: match.totalMiles,
    loadedMiles: match.loadedMiles,
  };
}

export function summarizeAll(
  negotiations: Negotiation[],
  ctx: MtLoopContext,
): NegotiationSummary[] {
  const out: NegotiationSummary[] = [];
  for (const negotiation of negotiations) {
    const s = summarize(negotiation, ctx);
    if (s) out.push(s);
  }
  return out;
}

/** Test seam only: the raw rows for one workspace. */
export function negotiationsForTests(organizationId: string): Negotiation[] {
  return bucket(organizationId);
}
