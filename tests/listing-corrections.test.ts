import test from "node:test";
import assert from "node:assert/strict";
import { loopContextFor, resetPropagationWorld } from "./propagation-harness.ts";
import { buildMtLoopBoard, syncMtLoops } from "@/lib/api/mock/mt-loop";
import { startSearch } from "@/lib/api/mock/search-session";
import { allMatches } from "@/lib/api/mock/opportunity-matching";
import { listingById } from "@/lib/api/mock/listing-registry";
import {
  correctionHistory, correctionsInForce, effectiveListing, recordCorrection,
} from "@/lib/api/mock/listing-corrections";
import { previewForDriver } from "@/lib/api/mock/driver-review";

/**
 * What a broker corrects on the phone, and what it is allowed to touch.
 *
 * ★ WHAT THESE EXIST TO STOP HAPPENING ★
 *
 *   Overwriting the posting   A load board listing is a record of what a source
 *           published. A dispatcher hearing "that's 30,000, not 40,000" does not
 *           get to rewrite it — six weeks later somebody has to be able to say
 *           what the board said AND who told us otherwise. The obvious
 *           implementation is one assignment, and it destroys both answers.
 *
 *   Correcting nothing        The opposite failure, and the likelier one: the
 *           correction is stored somewhere nobody reads, the driver is still
 *           told 40,000, and the truck turns up at a dock for the wrong load.
 *           A correction that is not the single source of truth downstream is
 *           a note, and this file is what stops it quietly becoming one.
 */

const CTX = "mem_northline_owner";

test.beforeEach(() => resetPropagationWorld());

async function searchedMatch(ctx: ReturnType<typeof loopContextFor>) {
  syncMtLoops(ctx);
  const board = await buildMtLoopBoard(ctx);
  const loop = board.loops.find((l) => l.driverName && !l.blockReason) ?? board.loops[0];
  assert.ok(loop);
  await startSearch(loop.loopId, ctx);
  const row = allMatches(ctx).find((r) => r.match.dispatchCycleId === loop.loopId);
  assert.ok(row, "the search found something to correct");
  return row;
}

/* -------------------------------------------------------------------------- */

test("the posting keeps saying what the board said, for ever", async () => {
  const ctx = loopContextFor(CTX);
  const row = await searchedMatch(ctx);
  const posted = row.listing.weightLbs;
  assert.ok(posted !== undefined, "the sample listing publishes a weight");

  const out = await recordCorrection({
    listingId: row.listing.listingId,
    dispatchCycleId: row.match.dispatchCycleId,
    key: "weight_lbs",
    listingValue: `${posted.toLocaleString()} lb`,
    correctedValue: "30,000 lb",
    numericValue: 30_000,
    source: "broker_call",
  }, ctx);
  assert.equal(out.status, "ok", JSON.stringify(out));

  // ★ THE RECORD THE BOARD PUBLISHED IS UNTOUCHED ★
  const stored = listingById(ctx.organizationId, row.listing.listingId);
  assert.equal(stored?.weightLbs, posted, "the listing still says what was posted");

  // And the correction carries BOTH numbers, so neither is lost.
  const correction = out.status === "ok" ? out.correction : undefined;
  assert.equal(correction?.listingValue, `${posted.toLocaleString()} lb`);
  assert.equal(correction?.correctedValue, "30,000 lb");
  assert.ok(correction?.byName, "and who heard it");
});

test("the corrected value is what everything downstream reads", async () => {
  const ctx = loopContextFor(CTX);
  const row = await searchedMatch(ctx);

  await recordCorrection({
    listingId: row.listing.listingId,
    dispatchCycleId: row.match.dispatchCycleId,
    key: "weight_lbs",
    correctedValue: "30,000 lb",
    numericValue: 30_000,
    source: "broker_call",
  }, ctx);

  const { listing, correctedKeys } = effectiveListing(row.listing, row.match.dispatchCycleId, ctx);
  assert.equal(listing.weightLbs, 30_000, "the effective load carries the corrected weight");
  assert.deepEqual(correctedKeys, ["weight_lbs"], "and says which value is not the board's");
  assert.notEqual(listing, row.listing, "it is a copy — the stored listing is not mutated");

  /*
   * ★ THE ONE THAT MATTERS ★
   * A correction that did not reach the driver's message would send a truck to
   * a dock for a weight somebody already knew was wrong.
   */
  const preview = previewForDriver(row.match.matchId, ctx);
  assert.ok(preview);
  assert.equal(preview.full.weightLbs, 30_000, "the driver is told the corrected weight");
});

test("a second correction supersedes the first and neither is deleted", async () => {
  const ctx = loopContextFor(CTX);
  const row = await searchedMatch(ctx);
  const args = {
    listingId: row.listing.listingId,
    dispatchCycleId: row.match.dispatchCycleId,
    key: "weight_lbs" as const,
    source: "broker_call" as const,
  };

  const first = await recordCorrection({ ...args, correctedValue: "30,000 lb", numericValue: 30_000 }, ctx);
  const second = await recordCorrection({ ...args, correctedValue: "34,000 lb", numericValue: 34_000 }, ctx);
  assert.equal(first.status, "ok");
  assert.equal(second.status, "ok");

  const history = correctionHistory(row.listing.listingId, row.match.dispatchCycleId, ctx);
  assert.equal(history.length, 2, "both are kept");
  /*
   * ★ "WE WERE TOLD 30,000 AT 2PM AND 34,000 AT 4PM" ★
   * That is the history somebody needs when a truck turns up and the weight is
   * wrong again. Deleting the first would leave the second looking like the
   * only thing anybody ever said.
   */
  const older = history.find((c) => c.correctedValue === "30,000 lb");
  assert.ok(older?.supersededByCorrectionId, "the older one points at what replaced it");

  const inForce = correctionsInForce(row.listing.listingId, row.match.dispatchCycleId, ctx);
  assert.equal(inForce.weight_lbs?.correctedValue, "34,000 lb", "only the newest is in force");
  assert.equal(
    effectiveListing(row.listing, row.match.dispatchCycleId, ctx).listing.weightLbs,
    34_000,
  );
});

test("a correction belongs to one cycle and does not leak onto another truck's", async () => {
  const ctx = loopContextFor(CTX);
  const row = await searchedMatch(ctx);

  await recordCorrection({
    listingId: row.listing.listingId,
    dispatchCycleId: row.match.dispatchCycleId,
    key: "commodity",
    correctedValue: "Palletised glass",
    source: "broker_call",
  }, ctx);

  /*
   * ★ ONE LISTING, SEVERAL TRUCKS, SEPARATE CONVERSATIONS ★
   * The same load can be matched to three trucks, and a dispatcher ringing
   * about one of them is having one conversation. Attaching the correction to
   * the LISTING alone would have put a second dispatcher's call into the first
   * one's record — and, worse, into a driver message they never approved.
   */
  const other = effectiveListing(row.listing, "some_other_cycle", ctx);
  assert.equal(other.correctedKeys.length, 0);
  assert.equal(other.listing.commodity, row.listing.commodity);
});
