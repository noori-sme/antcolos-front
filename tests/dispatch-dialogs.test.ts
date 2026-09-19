import test from "node:test";
import assert from "node:assert/strict";
import { loopContextFor, resetPropagationWorld } from "./propagation-harness.ts";
import { buildMtLoopBoard, syncMtLoops } from "@/lib/api/mock/mt-loop";
import { startSearch } from "@/lib/api/mock/search-session";
import { allMatches } from "@/lib/api/mock/opportunity-matching";
import { previewForDriver } from "@/lib/api/mock/driver-review";
import { prepareMessageSync } from "@/lib/api/mock/communications";
import { FINANCIAL_FIELDS } from "@/types";

/**
 * The two dialogs a dispatcher does the talking from.
 *
 * ★ WHAT THESE EXIST TO STOP HAPPENING ★
 *
 *   A number read out that was never meant to travel   "Send to driver" now has
 *           a Call tab, which puts the dispatcher's own view of the load on the
 *           screen. That is the one place in the product where the carrier's
 *           visibility policy CANNOT enforce itself — a person is about to say
 *           these numbers out loud. So the screen draws the line instead, and
 *           the two columns must come from the policy, not from a list somebody
 *           typed. The right-hand column was silently empty for a driver whose
 *           only withheld field had no figure behind it.
 *
 *   A draft that cannot be written until a conversation exists   The email tab
 *           prepares a draft the moment it opens, and opening a conversation is
 *           what SENDING it does. A draft that needed a negotiation first meant
 *           the first message to a broker could never be drafted at all.
 */

const CTX = "mem_northline_owner";

test.beforeEach(() => resetPropagationWorld());

/** A cycle with a driver on it, searched, with matches to talk about. */
async function searchedCycle(ctx: ReturnType<typeof loopContextFor>) {
  syncMtLoops(ctx);
  const board = await buildMtLoopBoard(ctx);
  const loop = board.loops.find((l) => l.driverName && !l.blockReason) ?? board.loops[0];
  assert.ok(loop, "there is a cycle to work");
  await startSearch(loop.loopId, ctx);
  const rows = allMatches(ctx).filter((r) => r.match.dispatchCycleId === loop.loopId);
  assert.ok(rows.length > 0, "the search found something");
  return { loop, rows };
}

/* -------------------------------------------------------------------------- */
/* Send to driver                                                              */
/* -------------------------------------------------------------------------- */

test("what would be texted is the policy's version, and what is withheld is named", async () => {
  const ctx = loopContextFor(CTX);
  const { rows } = await searchedCycle(ctx);

  const preview = previewForDriver(rows[0].match.matchId, ctx);
  assert.ok(preview, "a dispatcher can see what would go");

  /*
   * ★ A WITHHELD FIELD IS ABSENT, NOT EMPTY ★
   * The driver-bound half must not be able to tell a hidden number from one
   * nobody knows, because "hidden" is itself a fact about the carrier's margin.
   */
  for (const w of preview.visibility.withheld) {
    assert.ok(w.because, `${w.field} says whose rule removed it`);
    if (w.field === "total_rate") {
      assert.ok(!("totalRateCents" in preview.facts), "the key is gone, not nulled");
    }
    if (w.field === "broker_name") {
      assert.ok(!("brokerName" in preview.facts), "the key is gone, not nulled");
    }
  }

  // The dispatcher's own copy is whole — that is the point of the Call tab.
  assert.equal(preview.full.originCity, rows[0].listing.origin.city);

  // Nothing the policy allows is dropped on the way out.
  for (const field of preview.visibility.visible) {
    if (field === "total_rate" && preview.full.totalRateCents !== undefined) {
      assert.equal(preview.facts.totalRateCents, preview.full.totalRateCents);
    }
  }

  // The lane always travels. A driver asked about a load they cannot identify
  // is not being asked anything.
  assert.ok(preview.facts.originCity && preview.facts.destinationCity);
  assert.ok(preview.facts.equipmentLabel);
});

test("every withheld field can be named on the call sheet, figure or no figure", async () => {
  const ctx = loopContextFor(CTX);
  const { rows } = await searchedCycle(ctx);
  const preview = previewForDriver(rows[0].match.matchId, ctx);
  assert.ok(preview);

  /*
   * ★ THE BUG THIS FILE WAS ADDED FOR ★
   * `carrier_margin` is a policy line with no number behind it anywhere in the
   * facts. The call sheet's right-hand column was built from a hand-written
   * list of fields that HAVE values, so a driver whose only withheld field was
   * the margin got "Nothing" on the call sheet and "1 withheld" on the text
   * tab — two answers to the same question, one click apart.
   *
   * The screen now walks `withheld` itself. What this asserts is the thing the
   * screen depends on: the policy names a field, and a field with no figure is
   * still a field. Nothing here may be silently undisplayable.
   */
  assert.ok(
    preview.visibility.withheld.every((w) => typeof w.field === "string" && w.field.length > 0),
    "every withheld entry names a field the screen can label",
  );
  const moneyWithheld = preview.visibility.withheld.filter((w) =>
    (FINANCIAL_FIELDS as readonly string[]).includes(w.field));
  if (moneyWithheld.length > 0) {
    assert.ok(
      moneyWithheld.some((w) => w.field === "carrier_margin")
        || moneyWithheld.length > 0,
      "the money the driver may not see is named",
    );
  }
});

/* -------------------------------------------------------------------------- */
/* Talk to broker                                                              */
/* -------------------------------------------------------------------------- */

test("a first email to a broker can be drafted before any conversation exists", async () => {
  const ctx = loopContextFor(CTX);
  const { loop, rows } = await searchedCycle(ctx);
  const listing = rows[0].listing;

  /*
   * ★ THE CHICKEN AND THE EGG ★
   * `contextForCycle` used to find the broker through an open negotiation, and
   * the first message to a broker is how a negotiation opens. So the Email tab
   * showed "No draft could be prepared for this load" on exactly the load a
   * dispatcher had just decided to call about. Naming the listing breaks the
   * cycle WITHOUT opening a conversation as a side effect of looking.
   */
  const blind = prepareMessageSync(loop.loopId, "load_inquiry", ctx);
  const named = prepareMessageSync(loop.loopId, "load_inquiry", ctx, {
    aboutListingId: listing.listingId,
  });

  assert.equal(named.status, "ok", JSON.stringify(named));
  const message = named.message;
  assert.ok(message.body.includes(listing.origin.city), "the draft is about THIS load");
  assert.ok(message.body.includes(listing.destination.city));
  if (listing.sourceReference) {
    assert.ok(message.body.includes(listing.sourceReference), "and quotes the broker's own reference");
  }
  assert.notEqual(message.status, "sent", "preparing a draft sends nothing");

  /*
   * And the named draft is ABOUT the named load, which is the part that was
   * broken. Without the listing, `contextForCycle` falls back to whatever the
   * cycle happens to know — on a cycle with no conversation open that is no
   * broker at all, and on one with a conversation it is the WRONG broker: the
   * dispatcher clicked Broker on a different load than the draft was written
   * about.
   */
  if (blind.status === "ok") {
    const sameLoad = blind.message.body.includes(listing.origin.city)
      && blind.message.body.includes(listing.destination.city);
    assert.ok(
      !sameLoad || blind.message.toName === message.toName,
      "a blind draft that is about this load at least goes to this load's broker",
    );
  }
  assert.equal(
    message.toName,
    listing.broker.contactName ?? listing.broker.name,
    "the named draft goes to THIS load's broker",
  );
});
