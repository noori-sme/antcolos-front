import type {
  ActorRef, Assignment, BookingBlockKind, BookingRecord, ConsentRequirement,
  DocumentRequirement, Load, LoadEvent, Negotiation, Stop,
} from "@/types";
import { authorityAllowsDispatch } from "@/types";
import { listingById } from "./listing-registry";
import { markLoopBooked, mtLoopById } from "./mt-loop";
import type { MtLoopContext } from "./mt-loop";
import { allMatches, truckMatchContext } from "./opportunity-matching";
import { bookAndStandDown } from "./opportunity-service";
import {
  closeNegotiationsForListing, markBooked, negotiationById,
} from "./negotiation";
import { draftsFor } from "./outreach-drafts";
import { mockStore } from "./store";

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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const LATENCY_MS = 280;

let seq = 0;
const rowId = (p: string) => `${p}_${(++seq).toString(36)}${Date.now().toString(36)}`;
const nowIso = () => new Date().toISOString();

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

const byOrg = new Map<string, BookingRecord[]>();

function bucket(organizationId: string): BookingRecord[] {
  let rows = byOrg.get(organizationId);
  if (!rows) {
    rows = [];
    byOrg.set(organizationId, rows);
  }
  return rows;
}

export function resetBookings() {
  byOrg.clear();
  seq = 0;
}

function mayBook(ctx: MtLoopContext): boolean {
  return ctx.permissions.has("loads:create") && ctx.scope.loads !== "assigned";
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

export function bookingForCycle(
  dispatchCycleId: string,
  ctx: MtLoopContext,
): BookingRecord | undefined {
  if (!ctx.permissions.has("loads:view")) return undefined;
  return bucket(ctx.organizationId).find((b) => b.dispatchCycleId === dispatchCycleId);
}

export function bookingsForWorkspace(ctx: MtLoopContext): BookingRecord[] {
  if (!ctx.permissions.has("loads:view")) return [];
  return [...bucket(ctx.organizationId)].sort((a, b) => b.bookedAt.localeCompare(a.bookedAt));
}

export function bookingById(bookingId: string, ctx: MtLoopContext): BookingRecord | undefined {
  if (!ctx.permissions.has("loads:view")) return undefined;
  return bucket(ctx.organizationId).find((b) => b.bookingId === bookingId);
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
      carrierName: loop.carrierName,
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

  const org = mockStore.org(ctx.organizationId);
  const reference = nextReference(ctx.organizationId);
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
  const documentRequirements: DocumentRequirement[] = [
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

  const load: Load = {
    id: loadId,
    organizationId: ctx.organizationId,
    reference,
    status: consent === "pending" ? "offered" : "planned",
    customer: {
      // Carried exactly as the market gave it. NOT a profile reference — the
      // profile system owns matching, and guessing here makes duplicates.
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
    createdAt: at,
    createdBy: actor,
    updatedAt: at,
  };

  const events: LoadEvent[] = [{
    id: rowId("evt"),
    organizationId: ctx.organizationId,
    loadId,
    kind: "load.created",
    occurredAt: at,
    recordedAt: at,
    actor,
    source: "web",
    payload: { note: `Booked from the Opportunity Inbox at ${money(agreed)} with ${listing.broker.name}.` },
  }, {
    id: rowId("evt"),
    organizationId: ctx.organizationId,
    loadId,
    kind: "assignment.created",
    occurredAt: at,
    recordedAt: at,
    actor,
    source: "web",
    payload: {
      note: consent === "pending"
        ? `Unit ${loop.truckUnit} offered to ${loop.driverName}. ${loop.carrierName} requires the driver to accept.`
        : `Unit ${loop.truckUnit}${loop.driverName ? ` with ${loop.driverName}` : ""}.`,
    },
  }];

  org.loads.unshift(load);
  org.events.unshift(...events);

  // Stand down everything else about this listing, in one go.
  const closeout = bookAndStandDown(negotiation.matchId, ctx, ctx.actor.displayNameSnapshot);
  const lostNegotiations = closeNegotiationsForListing(
    ctx.organizationId,
    negotiation.listingId,
    `Unit ${loop.truckUnit} got this load.`,
    negotiation.negotiationId,
  );
  markBooked(negotiation);

  markLoopBooked(loop, {
    loadId,
    loadReference: reference,
    actorMembershipId: ctx.membershipId,
    actorName: ctx.actor.displayNameSnapshot,
    note: `${reference} booked with ${listing.broker.name} at ${money(agreed)}.`,
  });

  const booking: BookingRecord = {
    bookingId: rowId("bk"),
    organizationId: ctx.organizationId,
    carrierOrganizationId: loop.carrierOrganizationId,
    negotiationId: negotiation.negotiationId,
    matchId: negotiation.matchId,
    listingId: negotiation.listingId,
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
    closedMatchIds: closeout.closedMatchIds,
    supersededDraftIds: closeout.supersededDraftIds,
  };
  void lostNegotiations;
  bucket(ctx.organizationId).push(booking);

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

  const org = mockStore.org(ctx.organizationId);
  const load = org.loads.find((l) => l.id === booking.loadId);
  if (load?.assignment) {
    load.assignment.consent = { status: answer, respondedAt: at };
    load.status = answer === "accepted" ? "assigned" : "offered";
    load.updatedAt = at;
  }
  org.events.unshift({
    id: rowId("evt"),
    organizationId: ctx.organizationId,
    loadId: booking.loadId,
    kind: answer === "accepted" ? "load.accepted" : "load.declined",
    occurredAt: at,
    recordedAt: at,
    actor: {
      userId: ctx.actor.userId,
      membershipId: ctx.membershipId,
      displayNameSnapshot: ctx.actor.displayNameSnapshot,
      source: "web",
    },
    source: "web",
    payload: {
      note: note?.trim()
        || (answer === "accepted"
          ? `${booking.driverName ?? "The driver"} accepted ${booking.loadReference}.`
          : `${booking.driverName ?? "The driver"} declined ${booking.loadReference}.`),
    },
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

