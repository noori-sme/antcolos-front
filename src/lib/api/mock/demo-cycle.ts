import type { MtLoopContext } from "./mt-loop";
import { claimLoop, openLoopsFor, syncMtLoops } from "./mt-loop";
import { TRUCK_IDS } from "./truck-registry";
import { withoutMockLatency } from "./latency";
import { startSearch } from "./search-session";
import { truckOpportunitiesSync } from "./opportunity-service";
import { approveDraft, draftIdForMatch } from "./outreach-drafts";
import { recordDriverDecision, sendOpportunityToDriver } from "./driver-review";
import {
  acceptOnTheTable, openNegotiation, recordBrokerRound, recordOurOffer,
} from "./negotiation";
import { bookNegotiation, recordDriverConsent } from "./booking";
import { confirmAndSign, receiveRateConfirmation, verifyField } from "./rate-confirmation";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * One truck, walked through the whole empty-to-empty cycle.
 *
 * ★ WHY THIS EXISTS ★
 * Every other module in this folder seeds a STATE: a truck that is loaded, a
 * carrier whose authority lapsed, a driver whose medical card is expiring.
 * That is right for demonstrating a state, and useless for demonstrating a
 * PROCESS — nobody can see how a load gets from a search to a rolling truck by
 * looking at a finished one. Unit 133 exists so somebody can open a truck and
 * find every stage of the cycle filled in, with the records each stage left
 * behind, and read the whole thing backwards.
 *
 * ★ IT CLICKS THE BUTTONS. IT DOES NOT WRITE THE ANSWERS. ★
 * Every step below is the same exported service call the screen makes, in the
 * order a dispatcher makes them, through the same permission checks, the same
 * carrier rules and the same gates. Nothing here reaches into a store and
 * nothing constructs a record by hand.
 *
 * That is the difference between a demo and a lie. A hand-written
 * `RateConWorkflow` with `status: "returned"` would look identical on screen
 * and would prove nothing: it would survive a bug that made `confirmAndSign`
 * refuse every real signature. This walkthrough fails loudly instead — if a
 * gate starts rejecting what a dispatcher does, unit 133 stops halfway and the
 * board shows where it stopped.
 *
 * ★ IT IS ALLOWED TO STOP HALFWAY ★
 * Each step checks the outcome and gives up quietly if the one before it did
 * not produce what it needed. A seeder that threw would take the whole board
 * down with it, and the one thing worse than an incomplete demo cycle is an
 * app that will not load because of one.
 */

/** The truck the walkthrough runs on, and the workspace that dispatches it. */
const DEMO_TRUCK_ID = TRUCK_IDS.nl133;
export const DEMO_ORG = "org_northline";

/**
 * How far to walk one cycle.
 *
 * ★ THE STATES A BOARD HAS TO BE ABLE TO SHOW ★
 * Each of these is a real place a dispatcher's morning finds a truck in, and
 * each is reached by stopping the SAME walk at a different point rather than by
 * writing the state down. So a cycle "waiting on a broker's reply" genuinely
 * has an open conversation with our ask in it and nothing back — and if the
 * negotiation module ever stopped producing that, the board would show it.
 */
export type CycleStop =
  /** A search has run. Nothing has been asked about. */
  | "searched"
  /** The driver has been asked and has said yes. No broker contacted. */
  | "driver_accepted"
  /** We have asked a broker for a number. Nothing has come back. */
  | "asked_broker"
  /** They have come back with a counter nobody has answered. */
  | "broker_replied"
  /** Booked, and a rate confirmation is sitting unchecked. */
  | "ratecon_received"
  /** Checked, signed and returned. The end of the desk work. */
  | "signed";

/**
 * Once per store lifetime.
 *
 * The mock world is rebuilt on every full page load, so this runs again then —
 * which is correct: the demo has to be there whenever somebody opens the app.
 * A promise rather than a boolean, so two screens mounting at once await the
 * same walkthrough instead of racing to run it twice.
 */
let running: Promise<void> | null = null;

export function resetDemoCycle() {
  running = null;
}

/**
 * Make sure unit 133's cycle has been walked through, and wait for it.
 *
 * Safe to call from anywhere and on every read: after the first call it
 * resolves immediately.
 */
export function ensureDemoCycle(ctx: MtLoopContext): Promise<void> {
  // Only the workspace that actually dispatches this truck can walk its cycle,
  // and only somebody who may do the work. Anybody else gets the board they
  // would have got anyway — the demo is not a reason to bypass a permission.
  if (ctx.organizationId !== DEMO_ORG) return Promise.resolve();
  if (!ctx.permissions.has("loads:view") || ctx.scope.loads === "assigned") {
    return Promise.resolve();
  }
  running ??= withoutMockLatency(() => walk(ctx)).catch(() => {
    // Swallowed on purpose. See the file header: a seeder must not be able to
    // stop the board from rendering.
  });
  return running;
}

/* -------------------------------------------------------------------------- */

async function walk(ctx: MtLoopContext): Promise<void> {
  await walkCycle(DEMO_TRUCK_ID, "signed", ctx);
}

/**
 * Walk one truck's cycle as far as `stop`, through the real services.
 *
 * Returns the booking's load id once there is one, so a caller that wants to
 * put the truck on the road can carry on from a load that genuinely exists.
 */
export async function walkCycle(
  truckId: string,
  stop: CycleStop,
  ctx: MtLoopContext,
  /**
   * Listings another demo cycle has already taken.
   *
   * ★ TEN TRUCKS SHARE ONE MARKET ★
   * Every cycle ranks the same sample market, so `top[0]` is frequently the
   * same load for two trucks. The first to book it stands the other's driver
   * review and conversation DOWN — correctly, and exactly as it would in real
   * life — and the demo ends up with several trucks showing a withdrawn review
   * instead of the state they were supposed to show. Picking a load nobody else
   * in this run has taken is how a dispatcher would do it too.
   *
   * Mutated as it goes, so the caller's set carries across the whole run.
   */
  taken: Set<string> = new Set(),
): Promise<{ loadId?: string; cycleId?: string }> {
  /* ---- 0. The cycle itself, opened by the truck going empty ------------- */
  syncMtLoops(ctx);
  const loop = openLoopsFor(ctx).find((l) => l.truckId === truckId);
  if (!loop) return {};
  // Already walked — a reload rebuilt the stores but something got here first.
  if (loop.loadId) return { loadId: loop.loadId, cycleId: loop.loopId };

  const cycleId = loop.loopId;

  /* ---- 1. Somebody picks it up ------------------------------------------ */
  // Not cosmetic: an unclaimed cycle reads "nobody has accepted it" on every
  // surface, and a walkthrough that skipped this would show a finished load
  // nobody was ever responsible for.
  await claimLoop(cycleId, ctx);

  /* ---- 2. Load search --------------------------------------------------- */
  const search = await startSearch(cycleId, ctx);
  if (search.status !== "ok" && search.status !== "already_running") return { cycleId };
  if (stop === "searched") return { cycleId };

  /* ---- 3. Opportunities: the one worth asking about --------------------- */
  const found = truckOpportunitiesSync(cycleId, ctx);
  const pick = found.top.find((m) => !taken.has(m.listing.listingId)) ?? found.top[0];
  if (!pick) return { cycleId };
  taken.add(pick.listing.listingId);
  const matchId = pick.match.matchId;

  // The prepared message a person reads and releases. Nothing is sent — no
  // mailbox is connected — and the draft records that a person approved it.
  const draftId = draftIdForMatch(matchId, ctx);
  if (draftId) await approveDraft(draftId, ctx);

  /* ---- 4. Send to driver ------------------------------------------------ */
  /*
   * Whether this happens at all is the CARRIER's rule, not ours. Northline
   * carries `driver_consent_required`, so the walkthrough asks — and on a
   * carrier that does not, `sendOpportunityToDriver` refuses and the spine
   * draws the stage as skipped with the rule on it. Both are correct; this
   * follows whichever the records say.
   */
  // The note names the actual lane. A hard-coded one said "Springfield pickup"
  // on a load that picks up in Indianapolis, because Springfield is where the
  // TRUCK is — the sort of detail a demo gets wrong and a dispatcher notices.
  const lane = `${pick.listing.origin.city}, ${pick.listing.origin.state}`
    + ` → ${pick.listing.destination.city}, ${pick.listing.destination.state}`;
  const sent = await sendOpportunityToDriver(
    matchId,
    ctx,
    `${lane}. Short run, home the same day. Say yes and I will book it.`,
  );
  if (sent.status === "ok") {
    await recordDriverDecision(sent.review.reviewId, "approved", ctx, {
      comment: "Works for me. I can be there for the pickup window.",
    });
  }
  if (stop === "driver_accepted") return { cycleId };

  /* ---- 5. Talking to brokers -------------------------------------------- */
  const opened = await openNegotiation(matchId, ctx);
  if (opened.status !== "ok") return { cycleId };
  const negotiationId = opened.negotiation.negotiationId;
  const asked = opened.negotiation.askedRateCents;
  // Asked, and nothing back. The conversation is genuinely open and genuinely
  // one-sided, which is what "waiting on a broker" has to mean on the board.
  if (stop === "asked_broker") return { cycleId };

  // A real conversation: they come back under, we hold, they meet us. Three
  // rounds rather than one, because a single "agreed" teaches nobody what the
  // module does when a broker argues.
  await recordBrokerRound(
    negotiationId,
    {
      kind: "counter",
      amountCents: Math.round(asked * 0.88),
      channel: "recorded_by_hand",
      /*
       * ★ NO NAME HERE ★
       * The round defaults to the broker contact on the listing. Passing one
       * put "Dana Whitcomb" on every round of a conversation whose header said
       * the contact was Dana Wells — a made-up name arguing with a real one.
       */
      note: "Best I can do today — it is a light load and the lane is soft.",
      goodForHours: 6,
    },
    ctx,
  );
  // Their number is on the table and nobody has answered it. The board's
  // "read the reply" state, and the one a dispatcher is paid to notice.
  if (stop === "broker_replied") return { cycleId };

  await recordOurOffer(
    negotiationId,
    Math.round(asked * 0.96),
    ctx,
    "Held at 96% of the ask. The truck is 40 miles out and the window is tight for them.",
  );

  await recordBrokerRound(
    negotiationId,
    {
      kind: "counter",
      amountCents: Math.round(asked * 0.94),
      channel: "recorded_by_hand",
      note: "Split it and we have a deal.",
      goodForHours: 4,
    },
    ctx,
  );

  const agreed = await acceptOnTheTable(negotiationId, ctx);
  if (agreed.status !== "ok") return { cycleId };

  /* ---- 6. Book it ------------------------------------------------------- */
  // Goes through `canBook`, which re-checks every blocker at the moment of
  // commitment. A walkthrough that wrote the booking directly would skip the
  // one check the whole module exists for.
  const booked = await bookNegotiation(negotiationId, ctx);
  if (booked.status !== "ok") return { cycleId };

  /*
   * ★ ASKED BEFORE, COMMITTED NOW — AND THEY ARE NOT THE SAME QUESTION ★
   * The review above was "would you take this?", put before anybody argued a
   * price. This is the carrier's `driver_consent_required` rule at the moment
   * the truck is actually committed. Leaving it unanswered would park the
   * booking on "waiting on the driver" for ever, on a cycle whose whole point
   * is to show a finished one.
   */
  await recordDriverConsent(
    booked.booking.bookingId,
    "accepted",
    ctx,
    "Confirmed on the phone. Rolling for the pickup window.",
  );

  /* ---- 7. The rate confirmation ----------------------------------------- */
  const arrived = await receiveRateConfirmation(booked.booking.bookingId, ctx);
  const workflow = arrived.status === "ok"
    ? arrived.workflow
    : arrived.status === "already_open" ? arrived.workflow : undefined;
  if (!workflow) return { cycleId, loadId: booked.booking.loadId };
  // It has landed and nobody has looked at it. Every field unchecked, and the
  // two that disagree with the booking still disagreeing.
  if (stop === "ratecon_received") return { cycleId, loadId: booked.booking.loadId };

  // Every required field looked at by a person, which is what moves the
  // workflow to `ready_to_confirm`. Checking them one at a time is the actual
  // work of the module, and the audit trail underneath says who did it.
  for (const field of workflow.fields) {
    if (!field.required) continue;
    await verifyField(workflow.rateConId, field.key, ctx);
  }

  /*
   * ★ THE SIGNATURE, AND WHO MAY APPLY IT ★
   * Only the carrier signs. Northline dispatches its own trucks, so the same
   * membership that did everything above may also sign — and on a truck an
   * agency dispatches, `confirmAndSign` refuses and the cycle stops here with
   * the reason on it. That refusal is a feature, and this seeder is subject to
   * it like anybody else.
   */
  await confirmAndSign(workflow.rateConId, ctx);
  return { cycleId, loadId: booked.booking.loadId };
}
