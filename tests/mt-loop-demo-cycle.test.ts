import test from "node:test";
import assert from "node:assert/strict";
import { loopContextFor, resetPropagationWorld } from "./propagation-harness.ts";
import { buildMtLoopBoard, openLoopsFor, syncMtLoops } from "@/lib/api/mock/mt-loop";
import { ensureDemoCycle } from "@/lib/api/mock/demo-cycle";
import { truckOpportunitiesSync } from "@/lib/api/mock/opportunity-service";
import { TRUCK_IDS } from "@/lib/api/mock/truck-registry";

/**
 * The end-to-end walkthrough on unit 133.
 *
 * ★ WHY THIS NEEDS A TEST AT ALL ★
 *
 * `demo-cycle.ts` gives up quietly at every step. That is deliberate — a
 * seeder must not be able to stop the board from rendering — and it is exactly
 * what makes it rot invisibly. If a gate starts refusing what a dispatcher
 * does, the walkthrough stops halfway, the board still loads, and the only
 * symptom is a demo truck that is less impressive than it was last week.
 *
 * So the thing to assert is not that the code ran. It is that the cycle
 * ARRIVED: a search session with listings behind it, a shortlist, an answer
 * from the driver, a conversation with rounds in it, a booking, a signed rate
 * confirmation, and a truck in the Rolling lane with the empty clock stopped.
 *
 * ★ AND WHY IT IS WORTH MORE THAN A FIXTURE ★
 * Every record below was made by the same exported service call the screen
 * makes, through the same permission checks and the same carrier rules. So
 * this is not really a test of the seeder — it is the only test in the suite
 * that walks the whole empty-to-empty cycle in one piece, in order, the way a
 * dispatcher does.
 */

const CTX = "mem_northline_owner";

test.beforeEach(() => resetPropagationWorld());

test("the walkthrough truck reaches the end of its cycle", async () => {
  const ctx = loopContextFor(CTX);
  await ensureDemoCycle(ctx);

  syncMtLoops(ctx);
  const loop = openLoopsFor(ctx).find((l) => l.truckId === TRUCK_IDS.nl133);
  assert.ok(loop, "unit 133 has an open cycle");

  const o = truckOpportunitiesSync(loop.loopId, ctx);

  /* ---- 1. Somebody was responsible, and said so ------------------------- */
  assert.ok(loop.claimedByMembershipId, "a person accepted the cycle");

  /* ---- 2. Load search --------------------------------------------------- */
  assert.ok(o.session, "a search ran on this cycle");
  assert.ok(o.session.counts.listingsSeen > 0, "and it saw listings");
  // ★ Sources that are not connected are still reported. ★ A search that
  // silently skipped them would look like a market with no freight in it.
  assert.ok(
    o.session.sources.some((s) => s.status === "not_connected"),
    "and says which sources are not connected rather than implying full coverage",
  );

  /* ---- 3. Opportunities ------------------------------------------------- */
  assert.ok(o.counts.considered > 0, "loads were considered for this truck");
  assert.ok(
    o.counts.ineligible > 0,
    "including ones it may not legally haul, which is what the checks are for",
  );

  /* ---- 4. The driver ---------------------------------------------------- */
  // Northline carries `driver_consent_required`, so this stage is not optional
  // here — and a carrier without that rule would skip it, which is a different
  // assertion in `mt-loop-cycle-stages.test.ts`.
  assert.equal(o.driverReviews.length, 1, "one load was put to the driver");
  assert.equal(o.driverReviews[0].status, "approved", "and they accepted it");

  /* ---- 5. The brokers --------------------------------------------------- */
  const negotiation = o.negotiations[0]?.negotiation;
  assert.ok(negotiation, "a conversation was opened");
  assert.equal(negotiation.status, "booked");
  assert.ok(
    negotiation.rounds.length >= 4,
    "with a real argument in it, not a single instant agreement",
  );
  assert.ok(negotiation.agreedRateCents, "and a price both sides landed on");

  /* ---- 6. The booking --------------------------------------------------- */
  assert.ok(o.booking, "the agreed price became a load");
  assert.ok(loop.loadId, "and the load is on the cycle");

  /* ---- 7. The paper ----------------------------------------------------- */
  assert.ok(o.rateCon, "a rate confirmation arrived");
  assert.equal(o.rateCon.status, "returned", "was checked, signed and returned");
  assert.ok(
    o.rateCon.fields.filter((f) => f.required).every((f) => f.reviewedAt),
    "every required field was looked at by a person",
  );

  /* ---- 8. Rolling ------------------------------------------------------- */
  const board = await buildMtLoopBoard(ctx);
  const card = board.loops.find((c) => c.truckId === TRUCK_IDS.nl133);
  assert.ok(card, "the truck is still on the board");
  assert.equal(card.lane, "rolling", "in the lane that means it has gone");
  assert.equal(card.progress.key, "rolling");
  // ★ Both, or it is not rolling. ★ The lane needs a signed confirmation AND a
  // driver who has started, and this cycle is the only fixture that has both.
  assert.ok(
    card.blockers.every((b) => b.key !== "unconfirmed_load"),
    "with nothing outstanding on the paper",
  );
});

test("it walks once, however many screens ask", async () => {
  const ctx = loopContextFor(CTX);
  await Promise.all([ensureDemoCycle(ctx), ensureDemoCycle(ctx), ensureDemoCycle(ctx)]);
  await ensureDemoCycle(ctx);

  syncMtLoops(ctx);
  const loop = openLoopsFor(ctx).find((l) => l.truckId === TRUCK_IDS.nl133);
  const o = truckOpportunitiesSync(loop!.loopId, ctx);

  // Two boards mounting at once must not open two searches, two conversations
  // or two bookings on one truck — which is the same invariant the modules
  // enforce for real dispatchers, checked here against a concurrent caller.
  assert.equal(o.negotiations.length, 1, "one conversation, not three");
  assert.equal(o.driverReviews.length, 1, "one thing put to the driver");
  assert.ok(o.session, "one search session");
});

test("a workspace that does not dispatch this truck is not walked through anything", async () => {
  // Meridian dispatches somebody else's trucks. The demo is not a reason to
  // touch a cycle that is not theirs, and `ensureDemoCycle` returns without
  // doing anything rather than acting as Northline.
  const meridian = loopContextFor("mem_meridian_dispatcher");
  await ensureDemoCycle(meridian);

  const board = await buildMtLoopBoard(meridian);
  assert.ok(
    board.loops.every((c) => c.truckId !== TRUCK_IDS.nl133),
    "unit 133 is not on another workspace's board",
  );
});
