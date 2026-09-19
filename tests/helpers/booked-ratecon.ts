import assert from "node:assert/strict";
import type { MtLoopContext } from "@/lib/api/mock/mt-loop";
import { buildMtLoopBoard, syncMtLoops } from "@/lib/api/mock/mt-loop";
import { startSearch } from "@/lib/api/mock/search-session";
import { allMatches } from "@/lib/api/mock/opportunity-matching";
import {
  acceptOnTheTable, openNegotiation, recordBrokerRound,
} from "@/lib/api/mock/negotiation";
import { bookNegotiation } from "@/lib/api/mock/booking";
import {
  driverGate, recordDriverDecision, sendOpportunityToDriver,
} from "@/lib/api/mock/driver-review";
import { receiveRateConfirmation } from "@/lib/api/mock/rate-confirmation";

/**
 * Dispatch's whole cycle, up to a rate confirmation sitting on the desk.
 *
 * Every step is the exported service call the screen makes, through the same
 * permission checks and the same carrier rules — so a test built on this is
 * testing the real path, not a fixture somebody wrote to make it pass.
 *
 * It lives here rather than in one spec because more than one file needs a
 * workflow that has ARRIVED and has not been signed: that is the state the
 * review screen exists for, and it cannot be constructed by hand without
 * inventing an extraction.
 */

export async function bookedLoadWithRateCon(ctx: MtLoopContext) {
  syncMtLoops(ctx);
  const board = (await buildMtLoopBoard(ctx));
  // A loop with a DRIVER on it, and equipment it can legally run. The driver is
  // what makes this the full example: a load with nobody on it cannot become a
  // Driver Load Post, which the projection says out loud rather than failing.
  const loop = board.loops.find(
    (l) => l.driverName && !l.blockReason && (l.trailerUnit || !l.trailerRequired),
  ) ?? board.loops[0];
  assert.ok(loop, "the fixture workspace has at least one open MT Loop");
  assert.ok(loop.driverName, `loop for unit ${loop.truckUnit} has a driver assigned`);

  await startSearch(loop.loopId, ctx);
  const rows = allMatches(ctx).filter((r) => r.match.dispatchCycleId === loop.loopId);
  assert.ok(rows.length > 0, "the search found at least one eligible load");

  /*
   * The driver is asked FIRST, when the carrier's own rule says so.
   *
   * `driverGate` is what enforces it, and it sits before the negotiation rather
   * than before the booking: a carrier that wants its driver to see a load
   * before it is haggled over means before, not after. Booking without the
   * answer is refused with `driver_first`.
   */
  const gate = driverGate(rows[0].match.matchId, ctx);
  if (!gate.clear && gate.hasDriver) {
    const sent = await sendOpportunityToDriver(rows[0].match.matchId, ctx);
    assert.ok(sent.status === "ok" || sent.status === "already_sent", sent.status);
    const review = sent.status === "ok" || sent.status === "already_sent"
      ? sent.review
      : undefined;
    assert.ok(review);
    const answered = await recordDriverDecision(review.reviewId, "approved", ctx);
    assert.equal(answered.status, "ok");
  }

  // Agree a price the way a dispatcher does: ask, hear back, accept.
  const opened = await openNegotiation(rows[0].match.matchId, ctx);
  assert.equal(opened.status, "ok");
  const negotiationId = opened.status === "ok" ? opened.negotiation.negotiationId : "";

  await recordBrokerRound(negotiationId, {
    kind: "counter",
    amountCents: rows[0].listing.postedRateCents,
    note: "Best we can do.",
  }, ctx);
  const accepted = await acceptOnTheTable(negotiationId, ctx);
  assert.equal(accepted.status, "ok");

  const booked = await bookNegotiation(negotiationId, ctx);
  assert.equal(booked.status, "ok", JSON.stringify(booked));
  const booking = booked.status === "ok" ? booked.booking : undefined;
  assert.ok(booking);

  const received = await receiveRateConfirmation(booking.bookingId, ctx);
  assert.ok(received.status === "ok" || received.status === "already_open", received.status);
  const workflow = received.status === "ok" || received.status === "already_open"
    ? received.workflow
    : undefined;
  assert.ok(workflow);
  return { loop, booking, workflow };
}
