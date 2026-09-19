import type {
  ActorRef, Assignment, BookingBlockKind, BookingRecord, ConsentRequirement,
  DispatchWorkReceipt, Load, LoadDocumentRequirement, Negotiation,
  ProviderBookingLink, Stop,
} from "@/types";
import { authorityAllowsDispatch } from "@/types";
import { listingById } from "./listing-registry";
import { CARRIER_NOT_ESTABLISHED, markLoopBooked, mtLoopById } from "./mt-loop";
import type { MtLoopContext } from "./mt-loop";
import { allMatches, bookMatch, truckMatchContext, type BookingOutcome } from "./opportunity-matching";
import {
  closeNegotiationsForListing, markBooked, negotiationById,
} from "./negotiation";
import { closeReviewsForListing, reviewForMatch } from "./driver-review";
import { draftsFor, supersedeDraftsForListing } from "./outreach-drafts";
import { mockStore } from "./store";
import { createBookedLoad, recordLoadConsent } from "./load-commands";
import {
  attributedActor, loadReachFor, requireLoadWriteAuthority,
} from "./dispatch-delegation";
// The shared simulated round trip. A seeder can suppress it; a person never does.
import { sleep } from "./latency";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * Turning an agreed price into a load on the same dispatch cycle.
 *
 * This is the hinge of the whole loop. Before it, a cycle is a truck somebody
 * is looking for work for; after it, it is a truck with a job, and everything
 * later in the cycle — the rate confirmation, the pickup, the delivery, the
 * release — hangs off the load created here and the SAME `dispatchCycleId`
 * that opened when the truck went empty. No new id is minted.
 *
 * Four things happen together, and none of them is optional:
 *
 *   1. A Load is created in the workspace's own load records — the real ones
 *      the Loads screen reads — with the agreed money on it.
 *   2. The truck, its trailer and its driver are assigned to that load, with
 *      the carrier's own consent rule honoured: a carrier that requires the
 *      driver to accept gets `pending`, not a quiet `accepted`.
 *   3. The MT Loop becomes covered and carries the load's id and reference.
 *   4. Every competing match, draft and conversation about the same listing
 *      stands down, so nobody works a load that is gone.
 *
 * What it deliberately does NOT do is create a Broker profile. The permanent
 * Broker, Shipper and Receiver profile system is built elsewhere with its own
 * canonical matching and upsert rules, and inventing a second one here is
 * exactly how duplicate profiles get made. The broker's name is carried as it
 * was given, `brokerProfileLinked` stays false, and the queue asks a person to
 * link it once that system is available.
 */

const LATENCY_MS = 280;

let seq = 0;
const rowId = (p: string) => `${p}_${(++seq).toString(36)}${Date.now().toString(36)}`;
const nowIso = () => new Date().toISOString();

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Bookings, keyed by the CARRIER that owns the transaction.
 *
 * ★ A BOOKING UNDER A CARRIER'S MC IS THE CARRIER'S RECORD ★
 * It used to be keyed by whoever pressed Book, which put a carrier's rate, its
 * broker and its driver in a dispatch agency's store and left the carrier
 * unable to see its own booking at all. The canonical row now lives with the
 * carrier; a provider reads it through a live grant and keeps nothing but a
 * bounded receipt afterwards.
 */
const byCarrier = new Map<string, BookingRecord[]>();

/**
 * The provider's own half — its market activity, and a foreign key.
 *
 * Not a second booking: no mutable commercial fact is copied here. It survives
 * revocation because a dispatch organization's own negotiations, matches and
 * listings are its own.
 */
const providerLinks = new Map<string, ProviderBookingLink[]>();

function bucket(organizationId: string): BookingRecord[] {
  let rows = byCarrier.get(organizationId);
  if (!rows) {
    rows = [];
    byCarrier.set(organizationId, rows);
  }
  return rows;
}

function linkBucket(organizationId: string): ProviderBookingLink[] {
  let rows = providerLinks.get(organizationId);
  if (!rows) {
    rows = [];
    providerLinks.set(organizationId, rows);
  }
  return rows;
}

/** Every booking anywhere, for the reach-aware readers below. */
function allBookings(): BookingRecord[] {
  return [...byCarrier.values()].flat();
}

/**
 * The same set, for sibling modules that need to JOIN on a booking to work out
 * reach — the rate-con workflow needs the truck a booking was on before it can
 * ask whether a grant covers it.
 *
 * Not a read of anybody's records: every caller narrows with `loadReachFor`
 * immediately, and nothing here reaches a screen. Named so that using it as a
 * listing would be obviously wrong.
 */
export function allBookingsForReach(): readonly BookingRecord[] {
  return allBookings();
}

export function resetBookings() {
  byCarrier.clear();
  providerLinks.clear();
  seq = 0;
}

function mayBook(ctx: MtLoopContext): boolean {
  return ctx.permissions.has("loads:create") && ctx.scope.loads !== "assigned";
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * ★ THE THREE READERS ARE THE CHOKE POINT ★
 *
 * Six surfaces read bookings — the Opportunities inbox, rate-con matching,
 * broker outreach, Needs You, the negotiation panel and reporting. Putting the
 * rule here rather than in each of them is what makes "after revocation the
 * provider sees only a receipt" true everywhere at once, instead of true in
 * the five places somebody remembered.
 *
 * A booking is readable when the caller's organization owns it, or when a LIVE
 * grant from the owning carrier names the caller on the booking's truck. Once
 * that grant ends, the same call returns the provider's own sealed receipt and
 * nothing else — never the rate, the broker, the driver or the load id.
 */
function readableBooking(
  booking: BookingRecord,
  ctx: MtLoopContext,
): BookingRecord | undefined {
  if (booking.organizationId === ctx.organizationId) return booking;
  const reach = loadReachFor(ctx, {
    organizationId: booking.organizationId,
    pinnedCarrierOrganizationId: booking.pinnedCarrierOrganizationId,
    assignment: { truckId: booking.truckId } as Load["assignment"],
  });
  return reach === null ? undefined : booking;
}

/** The bookings this workspace may see in full, right now. */
function readableBookings(ctx: MtLoopContext): BookingRecord[] {
  return allBookings().filter((b) => readableBooking(b, ctx) !== undefined);
}

export function bookingForCycle(
  dispatchCycleId: string,
  ctx: MtLoopContext,
): BookingRecord | undefined {
  if (!ctx.permissions.has("loads:view")) return undefined;
  return readableBookings(ctx).find((b) => b.dispatchCycleId === dispatchCycleId);
}

export function bookingsForWorkspace(ctx: MtLoopContext): BookingRecord[] {
  if (!ctx.permissions.has("loads:view")) return [];
  return readableBookings(ctx).sort((a, b) => b.bookedAt.localeCompare(a.bookedAt));
}

export function bookingById(bookingId: string, ctx: MtLoopContext): BookingRecord | undefined {
  if (!ctx.permissions.has("loads:view")) return undefined;
  const booking = allBookings().find((b) => b.bookingId === bookingId);
  return booking ? readableBooking(booking, ctx) : undefined;
}

/* -------------------------------------------------------------------------- */
/* The provider's own half                                                     */
/* -------------------------------------------------------------------------- */

/**
 * This provider's own link for one booking, if it worked it.
 *
 * The join the provider-side surfaces use to recover the market ids that are
 * no longer on the carrier's record. Returns nothing for a workspace that did
 * not do the work, which is also the honest answer for the carrier itself:
 * a carrier sees the outcome of work done for its booking, not the provider's
 * listing and negotiation bookkeeping.
 */
export function providerLinkForBooking(
  bookingId: string,
  ctx: MtLoopContext,
): ProviderBookingLink | undefined {
  return linkBucket(ctx.organizationId).find((l) => l.bookingId === bookingId);
}

/** This provider's own market links, whatever happened to the grants. */
export function providerBookingLinks(ctx: MtLoopContext): ProviderBookingLink[] {
  return [...linkBucket(ctx.organizationId)]
    .sort((a, b) => b.bookedAt.localeCompare(a.bookedAt));
}

/**
 * What a former provider keeps: receipts for work whose access has ended.
 *
 * Read off the SEALED receipt rather than recomputed, so nothing a carrier does
 * afterwards can change what this returns.
 */
export function dispatchWorkReceipts(ctx: MtLoopContext): DispatchWorkReceipt[] {
  return providerBookingLinks(ctx)
    .map((l) => l.receipt)
    .filter((r): r is DispatchWorkReceipt => r !== undefined);
}

/**
 * Seals the receipt for every booking this provider worked under one carrier.
 *
 * Called when a grant is revoked or transferred — a command is running, so the
 * load's status can honestly be read — and by expiry reconciliation, where
 * nothing ran and therefore no status is recorded. Written once: a second call
 * leaves an existing receipt exactly as it was.
 */
export function sealDispatchReceipts(input: {
  providerOrganizationId: string;
  carrierOrganizationId: string;
  truckId?: string;
  basis: DispatchWorkReceipt["basis"];
  at: string;
  note: string;
}): number {
  let sealed = 0;
  for (const link of linkBucket(input.providerOrganizationId)) {
    if (link.receipt) continue;
    if (link.carrierOrganizationId !== input.carrierOrganizationId) continue;
    const booking = allBookings().find((b) => b.bookingId === link.bookingId);
    if (!booking) continue;
    if (input.truckId && booking.truckId !== input.truckId) continue;

    const load = mockStore.org(booking.organizationId).loads
      .find((l) => l.id === booking.loadId);

    link.receipt = {
      basis: input.basis,
      loadReference: booking.loadReference,
      bookedAt: booking.bookedAt,
      accessEndedAt: input.at,
      // ★ The one line that keeps an expired grant honest. ★
      // Nothing was running at `effectiveTo`, so nobody observed the load
      // then. Reading it now and calling that "status at expiry" would be
      // inventing an observation — and would turn the receipt into a live
      // window onto the carrier's later work.
      statusAtAccessEnd: input.basis === "expired_unobserved" ? undefined : load?.status,
      note: input.note,
    };
    sealed += 1;
  }
  return sealed;
}

/* -------------------------------------------------------------------------- */
/* Can this be booked?                                                         */
/* -------------------------------------------------------------------------- */

export interface BookCheck {
  ok: boolean;
  blocks: { kind: BookingBlockKind; detail: string }[];
  /** What the dispatcher is about to commit to, for the confirmation screen. */
  preview?: {
    lane: string;
    rateCents: number;
    loadedMiles: number;
    deadheadMiles: number;
    truckUnit: string;
    trailerUnit?: string;
    driverName?: string;
    consent: ConsentRequirement;
    carrierName: string;
    brokerName: string;
    otherMatchesClosing: number;
    draftsStandingDown: number;
  };
}

/**
 * Everything that would stop this booking, worked out BEFORE anything is done.
 *
 * The screen shows this list rather than a disabled button with no explanation,
 * and booking calls it again itself — a check that only the UI runs is not a
 * rule, it is a decoration.
 */
export function canBook(negotiationId: string, ctx: MtLoopContext): BookCheck {
  const blocks: BookCheck["blocks"] = [];
  if (!mayBook(ctx)) {
    return { ok: false, blocks: [{ kind: "not_permitted", detail: "Booking a load needs permission to create loads." }] };
  }
  const negotiation = negotiationById(negotiationId, ctx);
  if (!negotiation) {
    return { ok: false, blocks: [{ kind: "not_agreed", detail: "There is no conversation to book." }] };
  }
  if (negotiation.status !== "agreed" || negotiation.agreedRateCents === undefined) {
    blocks.push({ kind: "not_agreed", detail: "Agree a price with the broker first." });
  }

  const listing = listingById(ctx.organizationId, negotiation.listingId);
  if (!listing || listing.status !== "open") {
    blocks.push({ kind: "listing_gone", detail: "This load is no longer on the market." });
  }

  const loop = mtLoopById(negotiation.dispatchCycleId, ctx);
  if (!loop) {
    blocks.push({ kind: "truck_unavailable", detail: "This truck's cycle is no longer open to you." });
  } else if (loop.loadId) {
    blocks.push({ kind: "already_booked", detail: `Unit ${loop.truckUnit} already has ${loop.loadReference ?? "a load"} on this cycle.` });
  }

  const tc = loop ? truckMatchContext(loop, ctx) : undefined;
  if (loop && !tc) {
    blocks.push({ kind: "truck_unavailable", detail: "This truck is no longer one you dispatch." });
  }
  if (tc?.carrier && !authorityAllowsDispatch(tc.carrier.authority)) {
    blocks.push({
      kind: "carrier_cannot_haul",
      detail: `${tc.carrier.legalName}'s operating authority is ${tc.carrier.authority.status.replace(/_/g, " ")}. Nothing may be booked on it.`,
    });
  }

  if (blocks.length > 0 || !listing || !loop || !tc) return { ok: false, blocks };

  const consent: ConsentRequirement = !loop.driverProfileId
    ? "not_required"
    : tc.driverConsentRequired ? "pending" : "accepted";

  const standing = standDownCounts(negotiation, ctx);
  return {
    ok: true,
    blocks: [],
    preview: {
      lane: `${listing.origin.city}, ${listing.origin.state} → ${listing.destination.city}, ${listing.destination.state}`,
      rateCents: negotiation.agreedRateCents ?? 0,
      loadedMiles: listing.loadedMiles,
      deadheadMiles: 0,
      truckUnit: loop.truckUnit,
      trailerUnit: loop.trailerUnit,
      driverName: loop.driverName,
      consent,
      carrierName: loop.carrierName ?? CARRIER_NOT_ESTABLISHED,
      brokerName: listing.broker.name,
      otherMatchesClosing: standing.matches,
      draftsStandingDown: standing.drafts,
    },
  };
}

/**
 * How much else is about to be stood down, so the confirmation can say so.
 *
 * Counted from the live rows rather than estimated: the confirmation screen
 * promises a number out loud, and then this module has to deliver exactly that
 * number. A screen that says "2 other trucks stand down" and closes 3 is worse
 * than one that says nothing.
 */
function standDownCounts(negotiation: Negotiation, ctx: MtLoopContext) {
  const matches = allMatches(ctx).filter(
    (r) => r.match.listingId === negotiation.listingId
      && r.match.matchId !== negotiation.matchId
      && r.match.status !== "closed_listing_gone"
      && r.match.status !== "booked",
  ).length;
  const drafts = draftsFor(ctx).filter(
    (d) => d.listingId === negotiation.listingId
      && (d.status === "ready" || d.status === "approved"),
  ).length;
  return { matches, drafts };
}

export interface CloseoutResult extends BookingOutcome {
  supersededDraftIds: string[];
}

/**
 * One truck got it. Everything else about that load stands down.
 *
 * Two things have to happen together and neither is optional: competing MATCHES
 * close, and competing DRAFTS are superseded. Closing the matches alone leaves
 * a prepared email about a load that is gone sitting in somebody's review
 * queue, which is how a broker gets offered a truck that is already loaded.
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

/* -------------------------------------------------------------------------- */
/* Booking                                                                     */
/* -------------------------------------------------------------------------- */

export type BookOutcome =
  | { status: "ok"; booking: BookingRecord; load: Load }
  | { status: "blocked"; blocks: BookCheck["blocks"] };

/**
 * Commit the truck.
 *
 * Every read this needs happens before the first write, so the sequence below
 * cannot be interleaved with another booking of the same listing: in a single
 * threaded runtime that is what makes "two dispatchers booked the same load"
 * impossible rather than merely unlikely.
 */
export async function bookNegotiation(
  negotiationId: string,
  ctx: MtLoopContext,
): Promise<BookOutcome> {
  await sleep(LATENCY_MS);

  const check = canBook(negotiationId, ctx);
  if (!check.ok) return { status: "blocked", blocks: check.blocks };

  const negotiation = negotiationById(negotiationId, ctx)!;
  const listing = listingById(ctx.organizationId, negotiation.listingId)!;
  const loop = mtLoopById(negotiation.dispatchCycleId, ctx)!;
  const tc = truckMatchContext(loop, ctx)!;
  const agreed = negotiation.agreedRateCents!;

  /* --- from here, nothing awaits ------------------------------------------ */

  const at = nowIso();
  const actor: ActorRef = {
    userId: ctx.actor.userId,
    membershipId: ctx.membershipId,
    displayNameSnapshot: ctx.actor.displayNameSnapshot,
    source: "web",
  };

  const consent: ConsentRequirement = !loop.driverProfileId
    ? "not_required"
    : tc.driverConsentRequired ? "pending" : "accepted";

  /*
   * ★ WHOSE TRANSACTION IS THIS? ★
   *
   * Asked here, once, before a single record is written, and answered by the
   * delegation guard rather than by `ctx.organizationId`. A dispatch agency
   * pressing Book is acting FOR a carrier; the booking, the load, the reference
   * and every event below belong to that carrier.
   *
   * The guard proves four things together — the actor, their own permissions,
   * a live grant for THIS truck, and the operating carrier from A6's
   * `operatingContextAt` at this instant — and refuses rather than guessing.
   * An unresolved operating carrier throws, so no load is created under an
   * authority the records do not support.
   */
  const authority = requireLoadWriteAuthority(ctx, {
    truckId: loop.truckId,
    instant: at,
    requires: ["loads:create"],
  });
  const owningOrganizationId = authority.owningOrganizationId;

  const org = mockStore.org(owningOrganizationId);
  const reference = nextReference(owningOrganizationId);
  const loadId = rowId("ld");

  const pickup: Stop = {
    id: rowId("stp"),
    loadId,
    kind: "pickup",
    sequence: 1,
    address: { city: listing.origin.city, state: listing.origin.state, country: "US" },
    timeZone: org.loads[0]?.stops[0]?.timeZone ?? "America/Chicago",
    appointmentType: listing.pickupWindowHours ? "window" : "appointment",
    appointmentAt: listing.pickupAt,
    appointmentEndAt: listing.pickupWindowHours
      ? new Date(Date.parse(listing.pickupAt) + listing.pickupWindowHours * 3_600_000).toISOString()
      : undefined,
  };
  const delivery: Stop = {
    id: rowId("stp"),
    loadId,
    kind: "delivery",
    sequence: 2,
    address: { city: listing.destination.city, state: listing.destination.state, country: "US" },
    timeZone: pickup.timeZone,
    appointmentType: "appointment",
    // The broker gave a deliver-by or nothing; a guess dressed as an
    // appointment would be worse than an honest estimate from the miles.
    appointmentAt: listing.deliverBy
      ?? new Date(Date.parse(listing.pickupAt) + estimatedHours(listing.loadedMiles) * 3_600_000).toISOString(),
  };

  // The rate confirmation has NOT arrived. Requiring it and leaving it
  // unsatisfied is the honest state, and it is what the next milestone fills.
  const documentRequirements: LoadDocumentRequirement[] = [
    { kind: "rate_confirmation", required: true },
    { kind: "bill_of_lading", required: true },
    { kind: "proof_of_delivery", required: true },
  ];

  const assignment: Assignment = {
    id: rowId("asg"),
    loadId,
    truckId: loop.truckId,
    trailerId: loop.trailerId,
    driverId: loop.driverProfileId,
    carrierOrganizationId: loop.carrierOrganizationId,
    assignedAt: at,
    assignedBy: actor,
    consent: { status: consent, respondedAt: consent === "accepted" ? at : undefined },
  };

  /*
   * The Load is created through the Loads module's own command, not by pushing a
   * record onto its store. Booking used to build the `Load` and its events here
   * and `unshift` both, which meant the canonical record had two writers and no
   * idempotency: a double-tapped Book made two loads.
   *
   * The command derives the status from the consent rule, appends
   * `load.created` and `assignment.created` itself, and is keyed on the
   * negotiation so a retry returns the load it already made.
   */
  const load = createBookedLoad({
    organizationId: owningOrganizationId,
    pinnedCarrierOrganizationId: authority.pinnedCarrierOrganizationId,
    operatingLeaseId: authority.operatingLeaseId,
    dispatchedByOrganizationId:
      authority.basis === "dispatch_delegation" ? authority.actingOrganizationId : undefined,
    actor: attributedActor(actor, authority, ctx.organizationName),
    loadId,
    idempotencyKey: `booking:${negotiation.negotiationId}`,
    reference,
    customer: {
      // Carried exactly as the market gave it. NOT a profile reference — the
      // Directory owns matching, and guessing here makes duplicates.
      id: `unlinked:${listing.broker.name}`,
      name: listing.broker.name,
      kind: "broker",
      mcNumber: listing.broker.mcNumber,
      contact: listing.broker.contactName || listing.broker.phone
        ? { name: listing.broker.contactName, phone: listing.broker.phone, email: listing.broker.email }
        : undefined,
    },
    stops: [pickup, delivery],
    assignment,
    equipment: listing.equipment,
    weightLbs: listing.weightLbs,
    commodity: listing.commodity,
    documentRequirements,
    financials: {
      currency: "USD",
      linehaulCents: agreed,
      accessorials: [],
      totalRateCents: agreed,
      loadedMiles: listing.loadedMiles,
      deadheadMiles: 0,
      ratePerMileCents: Math.round(agreed / Math.max(listing.loadedMiles, 1)),
    },
    consent,
    note: `Booked from the Opportunity Inbox at ${money(agreed)} with ${listing.broker.name}. Unit ${loop.truckUnit}${loop.driverName ? ` with ${loop.driverName}` : ""}${consent === "pending" ? `, offered to ${loop.driverName} because ${loop.carrierName ?? "the carrier"} requires the driver to accept` : ""}.`,
    at,
  });

  // Stand down everything else about this listing, in one go.
  const closeout = bookAndStandDown(negotiation.matchId, ctx, ctx.actor.displayNameSnapshot);
  const lostNegotiations = closeNegotiationsForListing(
    ctx.organizationId,
    negotiation.listingId,
    `Unit ${loop.truckUnit} got this load.`,
    negotiation.negotiationId,
  );
  // A driver left holding a question about a load somebody else booked is the
  // same failure as a broker left waiting for a truck that is gone.
  closeReviewsForListing(
    ctx.organizationId,
    negotiation.listingId,
    `Unit ${loop.truckUnit} got this load.`,
    reviewForMatch(negotiation.matchId, ctx)?.reviewId,
  );
  markBooked(negotiation);

  markLoopBooked(loop, {
    loadId,
    loadReference: reference,
    actorMembershipId: ctx.membershipId,
    actorName: ctx.actor.displayNameSnapshot,
    note: `${reference} booked with ${listing.broker.name} at ${money(agreed)}.`,
  });

  const bookingId = rowId("bk");
  const booking: BookingRecord = {
    bookingId,
    // The carrier's transaction, in the carrier's store.
    organizationId: owningOrganizationId,
    carrierOrganizationId: loop.carrierOrganizationId,
    pinnedCarrierOrganizationId: authority.pinnedCarrierOrganizationId,
    dispatchedByOrganizationId:
      authority.basis === "dispatch_delegation" ? authority.actingOrganizationId : undefined,
    dispatchCycleId: negotiation.dispatchCycleId,
    loadId,
    loadReference: reference,
    agreedRateCents: agreed,
    loadedMiles: listing.loadedMiles,
    deadheadMiles: 0,
    truckId: loop.truckId,
    truckUnit: loop.truckUnit,
    trailerId: loop.trailerId,
    trailerUnit: loop.trailerUnit,
    driverProfileId: loop.driverProfileId,
    driverName: loop.driverName,
    consent,
    consentAskedAt: consent === "pending" ? at : undefined,
    consentAnsweredAt: consent === "accepted" ? at : undefined,
    brokerName: listing.broker.name,
    brokerProfileLinked: false,
    bookedAt: at,
    bookedByName: ctx.actor.displayNameSnapshot,
    bookedByMembershipId: ctx.membershipId,
  };
  void lostNegotiations;
  bucket(owningOrganizationId).push(booking);

  /*
   * The provider's own half, when a provider did the work.
   *
   * Which listing it found, which match it worked, which negotiation it ran and
   * what it stood down are its own market activity and stay its own — they are
   * not the carrier's commercial record and are not copied into it. The only
   * thing crossing is `bookingId`, a foreign key that resolves to nothing once
   * the grant ends.
   */
  if (authority.basis === "dispatch_delegation") {
    linkBucket(ctx.organizationId).push({
      organizationId: ctx.organizationId,
      bookingId,
      carrierOrganizationId: owningOrganizationId,
      negotiationId: negotiation.negotiationId,
      matchId: negotiation.matchId,
      listingId: negotiation.listingId,
      dispatchCycleId: negotiation.dispatchCycleId,
      closedMatchIds: closeout.closedMatchIds,
      supersededDraftIds: closeout.supersededDraftIds,
      bookedAt: at,
    });
  }

  return { status: "ok", booking, load };
}

/* -------------------------------------------------------------------------- */
/* Driver consent                                                              */
/* -------------------------------------------------------------------------- */

export type ConsentOutcome =
  | { status: "ok"; booking: BookingRecord }
  | { status: "not_permitted" }
  | { status: "not_found" }
  | { status: "not_pending" };

/**
 * The driver answered.
 *
 * Recorded by the dispatcher on the driver's behalf in this milestone — the
 * driver's own screen is a later one — so the answer carries who wrote it
 * down. A decline is not a failure state: it releases the truck back to being
 * worked, with the load left offered rather than silently cancelled, because
 * the broker has to be told and that is a person's job.
 */
export async function recordDriverConsent(
  bookingId: string,
  answer: "accepted" | "declined",
  ctx: MtLoopContext,
  note?: string,
): Promise<ConsentOutcome> {
  await sleep(LATENCY_MS);
  if (!mayBook(ctx)) return { status: "not_permitted" };
  const booking = bookingById(bookingId, ctx);
  if (!booking) return { status: "not_found" };
  if (booking.consent !== "pending") return { status: "not_pending" };

  const at = nowIso();
  booking.consent = answer;
  booking.consentAnsweredAt = at;

  // Through the Loads command again: the answer moves the derived status AND
  // appends the event that justifies it, in one place, idempotently.
  recordLoadConsent({
    organizationId: ctx.organizationId,
    actor: {
      userId: ctx.actor.userId,
      membershipId: ctx.membershipId,
      displayNameSnapshot: ctx.actor.displayNameSnapshot,
      source: "web",
    },
    idempotencyKey: `booking-consent:${booking.bookingId}`,
    loadId: booking.loadId,
    answer,
    note: note?.trim()
      || (answer === "accepted"
        ? `${booking.driverName ?? "The driver"} accepted ${booking.loadReference}.`
        : `${booking.driverName ?? "The driver"} declined ${booking.loadReference}.`),
    at,
  });
  return { status: "ok", booking };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The next load reference for this workspace.
 *
 * Derived from what is already there rather than from a counter, so it stays
 * right when the mock store is rebuilt mid-session and so two workspaces never
 * hand out the same number.
 */
function nextReference(organizationId: string): string {
  const loads = mockStore.org(organizationId).loads;
  const prefix = loads[0]?.reference.split("-")[0] ?? "LD";
  let highest = 0;
  for (const l of loads) {
    const n = Number.parseInt(l.reference.split("-").pop() ?? "", 10);
    if (Number.isFinite(n) && n > highest) highest = n;
  }
  return `${prefix}-${(highest + 1).toString().padStart(5, "0")}`;
}

/** Rough driving time, stated as an estimate everywhere it is shown. */
function estimatedHours(miles: number): number {
  return Math.max(4, Math.round((miles / 48) + 2));
}

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", {
  minimumFractionDigits: 0, maximumFractionDigits: 0,
})}`;

/** Test seam only. */
export function bookingsForTests(organizationId: string): BookingRecord[] {
  return bucket(organizationId);
}

