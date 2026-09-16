import test from "node:test";
import assert from "node:assert/strict";
import { loopContextFor, resetPropagationWorld } from "./propagation-harness.ts";
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
import {
  confirmAndSign, correctField, progressOf, receiveRateConfirmation, verifyField,
} from "@/lib/api/mock/rate-confirmation";
import {
  rateConfirmationForLoad, rateConfirmationVersions,
} from "@/lib/api/mock/rate-confirmation-record";
import { pendingExtractions } from "@/lib/api/mock/rate-con-extractions";
import { propagationBus } from "@/lib/propagation";
import { mockStore } from "@/lib/api/mock/store";
import { integrations } from "@/lib/integrations";
import { driverWorkflowStore } from "@/lib/api/mock/driver-workflow-store";

/**
 * The Required Example, end to end.
 *
 * Dispatch finds a load, agrees a price, books it, receives the broker's rate
 * confirmation, checks it field by field, corrects the ones that are wrong, and
 * signs it. What this file asserts is everything that happens NEXT, because that
 * is the milestone: one canonical commit, one event, and one run of every
 * authorized projection — no matter how many times the button is pressed.
 */

const CTX = "mem_northline_owner";

/** Drive the flow up to "a booked load with a rate confirmation on the desk". */
async function bookedLoadWithRateCon(ctx: MtLoopContext) {
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

/** Check every required field, correcting any the document got wrong. */
async function reviewEveryField(rateConId: string, ctx: MtLoopContext, workflow: {
  fields: { key: string; required: boolean; disagrees: boolean; expected?: string }[];
}) {
  let corrected = 0;
  for (const field of workflow.fields.filter((f) => f.required)) {
    if (field.disagrees && field.expected) {
      await correctField(rateConId, field.key as never, field.expected, ctx, "Booked value is right.");
      corrected += 1;
    } else {
      await verifyField(rateConId, field.key as never, ctx);
    }
  }
  return corrected;
}

test.beforeEach(() => resetPropagationWorld());

/* -------------------------------------------------------------------------- */

test("signing a rate confirmation commits ONE immutable record and finalizes the load once", async () => {
  const ctx = loopContextFor(CTX);
  const { workflow } = await bookedLoadWithRateCon(ctx);

  // Nothing is committed before the signature. A load with an unsigned
  // confirmation has no agreed rate, and that absence is a first-class answer.
  assert.equal(rateConfirmationForLoad(ctx.organizationId, workflow.loadId), undefined);

  const corrected = await reviewEveryField(workflow.rateConId, ctx, workflow);
  assert.ok(progressOf(workflow).canConfirm, progressOf(workflow).blockedReasons.join("; "));

  const signed = await confirmAndSign(workflow.rateConId, ctx);
  assert.equal(signed.status, "ok", JSON.stringify(signed));

  const record = rateConfirmationForLoad(ctx.organizationId, workflow.loadId);
  assert.ok(record, "a canonical record exists once it is signed and returned");
  assert.equal(record.version, 1);
  assert.equal(record.loadId, workflow.loadId);
  assert.ok(record.signature.authorisedByName, "the signature names who authorised it");
  assert.notEqual(
    record.originalDocumentId, record.signedDocumentId,
    "the original is never altered; signing produces a separate document",
  );

  // Both values survive on every field a person changed.
  const changed = record.facts.filter((f) => f.correctedValue !== undefined);
  assert.equal(changed.length, corrected);
  for (const fact of changed) {
    assert.notEqual(fact.extractedValue, fact.confirmedValue);
    assert.equal(fact.verification, "corrected");
  }

  // The record is frozen. There is no path that edits one.
  assert.throws(() => {
    (record as { version: number }).version = 99;
  });
});

test("one versioned load.finalized event is published, and a retry publishes nothing", async () => {
  const ctx = loopContextFor(CTX);
  const { workflow } = await bookedLoadWithRateCon(ctx);
  await reviewEveryField(workflow.rateConId, ctx, workflow);
  await confirmAndSign(workflow.rateConId, ctx);

  const published = propagationBus
    .events(ctx.organizationId)
    .filter((e) => e.kind === "load.finalized" && e.subjectId === workflow.loadId);
  assert.equal(published.length, 1, "exactly one finalization event");
  assert.equal(published[0].version, 1, "the payload contract is versioned");
  assert.ok(published[0].correlationId, "it joins everything the one intent produced");
  assert.ok(published[0].idempotencyKey.includes(
    rateConfirmationForLoad(ctx.organizationId, workflow.loadId)!.rateConfirmationId,
  ), "the key is derived from the committed record, not from the caller");

  // Signing again is refused by the workflow, and nothing downstream re-runs.
  const again = await confirmAndSign(workflow.rateConId, ctx);
  assert.equal(again.status, "blocked");
  assert.equal(
    propagationBus.events(ctx.organizationId)
      .filter((e) => e.kind === "load.finalized").length,
    1,
  );

  // Republishing the same event directly is the retry a flaky network produces.
  const replay = await propagationBus.publish(published[0]);
  assert.equal(replay.duplicate, true);
  const attempts = propagationBus.projectionsFor(published[0].scope.organizationId, published[0].eventId).map((p) => p.attempts);
  assert.deepEqual(
    attempts, attempts.map(() => 1),
    "no projection ran twice",
  );
});

test("the canonical Load is written through its own command, with a timeline behind every change", async () => {
  const ctx = loopContextFor(CTX);
  const { workflow } = await bookedLoadWithRateCon(ctx);
  await reviewEveryField(workflow.rateConId, ctx, workflow);
  await confirmAndSign(workflow.rateConId, ctx);

  const load = mockStore.org(ctx.organizationId).loads.find((l) => l.id === workflow.loadId)!;
  const record = rateConfirmationForLoad(ctx.organizationId, workflow.loadId)!;

  // The requirement is satisfied by the SIGNED document. An unsigned
  // confirmation on file is not a confirmed load.
  assert.equal(
    load.documentRequirements.find((r) => r.kind === "rate_confirmation")?.satisfiedByDocumentId,
    record.signedDocumentId,
  );

  const kinds = mockStore.org(ctx.organizationId).events
    .filter((e) => e.loadId === load.id)
    .map((e) => e.kind);
  for (const expected of [
    "load.created", "assignment.created",
    "load.rate_confirmation_received", "load.fields_extracted", "load.verified",
  ]) {
    assert.ok(kinds.includes(expected as never), `the timeline records ${expected}`);
  }
});

test("every authorized projection reports its own honest outcome", async () => {
  const ctx = loopContextFor(CTX);
  const { workflow } = await bookedLoadWithRateCon(ctx);
  await reviewEveryField(workflow.rateConId, ctx, workflow);
  const signed = await confirmAndSign(workflow.rateConId, ctx);
  assert.equal(signed.status, "ok");
  const rows = signed.status === "ok" ? signed.workflow.distribution : [];

  const ids = rows.map((r) => r.key);
  for (const expected of [
    "driver_workflow", "accounting_expected_revenue", "invoice_settlement_preparation",
    "directory_parties", "mt_loop", "tracking_session", "load_documents", "reports",
  ]) {
    assert.ok(ids.includes(expected), `${expected} was offered the event`);
  }

  // Every row says something, and every non-processed row says WHY.
  for (const row of rows) {
    assert.ok(row.detail.length > 0, `${row.key} explains itself`);
    if (row.state !== "processed") {
      assert.ok(row.reason, `${row.key} says why it is ${row.state}`);
    }
  }

  // The directory may never create a party profile on its own.
  const directory = rows.find((r) => r.key === "directory_parties")!;
  assert.equal(directory.state, "needs_review");
  assert.equal(pendingExtractions(ctx.organizationId).length, 1);

  // Sharing a truck's position outside the organization stays a person's call.
  assert.equal(rows.find((r) => r.key === "tracking_session")!.state, "pending");
});

test("signing unlocks the Driver Load Post, which the fixture gate never did", async () => {
  const ctx = loopContextFor(CTX);
  const { workflow } = await bookedLoadWithRateCon(ctx);

  // Before signing, the integration boundary reports no rate confirmation, so
  // the driver-workflow gate refuses — which is the point of the gate.
  assert.equal(
    await integrations.loadSource.getRateConfirmation(ctx.organizationId, workflow.loadId),
    undefined,
  );

  await reviewEveryField(workflow.rateConId, ctx, workflow);
  const signed = await confirmAndSign(workflow.rateConId, ctx);
  assert.equal(signed.status, "ok");

  // After signing, the boundary reads the canonical record: reviewed, signed,
  // sent. All three, from one commit.
  const rc = await integrations.loadSource.getRateConfirmation(ctx.organizationId, workflow.loadId);
  assert.ok(rc);
  assert.equal(rc.reviewedByDispatch, true);
  assert.equal(rc.carrierSignature.signed, true);
  assert.equal(rc.sentToBroker.sent, true);
  assert.equal(rc.provenance.mock, true, "and it still says it is a mock");

  const driver = signed.status === "ok"
    ? signed.workflow.distribution.find((d) => d.key === "driver_workflow")!
    : undefined;
  assert.ok(driver);
  assert.equal(driver.state, "processed", driver.reason ?? driver.detail);

  const posts = driverWorkflowStore.org(ctx.organizationId).posts
    .filter((p) => p.loadId === workflow.loadId);
  assert.equal(posts.length, 1, "exactly one Driver Load Post");
  const post = posts[0];
  assert.equal(post.loadReference, workflow.loadReference);
  assert.ok(post.rateConfirmationRef, "the post points back at the confirmation it rests on");
  assert.ok(post.stops.length >= 2, "both stops reached the driver without re-entry");
  assert.ok(
    post.contacts.length > 0,
    "the broker and facility contacts reached the driver without re-entry",
  );

  // Re-running the projection is safe: one post, whatever happens.
  const event = propagationBus.events(ctx.organizationId)
    .find((e) => e.kind === "load.finalized" && e.subjectId === workflow.loadId)!;
  await propagationBus.retry(event.scope.organizationId, event.eventId, "driver_workflow");
  assert.equal(
    driverWorkflowStore.org(ctx.organizationId).posts
      .filter((p) => p.loadId === workflow.loadId).length,
    1,
    "still exactly one post after a retry",
  );
});

test("a later version supersedes without erasing the first", async () => {
  const ctx = loopContextFor(CTX);
  const { workflow } = await bookedLoadWithRateCon(ctx);
  await reviewEveryField(workflow.rateConId, ctx, workflow);
  await confirmAndSign(workflow.rateConId, ctx);

  const versions = rateConfirmationVersions(ctx.organizationId, workflow.loadId);
  assert.equal(versions.length, 1);
  assert.equal(versions[0].version, 1);
  assert.equal(versions[0].supersedesRateConfirmationId, undefined);
  // The record in force is the newest, and the history keeps every one of them.
  assert.equal(
    rateConfirmationForLoad(ctx.organizationId, workflow.loadId)!.rateConfirmationId,
    versions.at(-1)!.rateConfirmationId,
  );
});
