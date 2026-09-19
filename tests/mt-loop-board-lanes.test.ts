import test from "node:test";
import assert from "node:assert/strict";
import { loopContextFor, resetPropagationWorld } from "./propagation-harness.ts";
import { blockLoop, buildMtLoopBoard, syncMtLoops } from "@/lib/api/mock/mt-loop";
import { laneFor } from "@/lib/api/mock/mt-loop-board-facts";
import type { MtLoopBlocker } from "@/types";

/**
 * The board's three lanes, and the badge that says whose turn it is.
 *
 * ★ WHAT THESE EXIST TO STOP HAPPENING ★
 *
 * A lane is a triage decision, and there are exactly two ways to get one wrong.
 *
 *   Hiding    A truck nobody may dispatch is still an open cycle with a fixed
 *             id, a running clock and somebody answerable for it. Dropping it
 *             off the board would make the screen look calm while the money
 *             kept going out. It is DEMOTED to `not_ready`, never removed, and
 *             the blocker that put it there is still on its row.
 *
 *   Flattering  A booked load whose signed rate confirmation has not come back
 *             is not a truck that has gone, however much a driver post on it
 *             looks like one. Calling it `rolling` would take the one truck
 *             somebody has to chase a broker about off the working lane.
 *
 * Both were live possibilities while this was being built: the second actually
 * happened, and put a truck with an outstanding rate confirmation into Rolling.
 */

const CTX = "mem_northline_owner";

const blocker = (over: Partial<MtLoopBlocker> = {}): MtLoopBlocker => ({
  key: "no_driver",
  label: "No driver",
  detail: "Nobody is on this truck.",
  owner: "carrier",
  severity: "medium",
  stopsDispatch: true,
  ...over,
});

test.beforeEach(() => resetPropagationWorld());

/* -------------------------------------------------------------------------- */
/* The rule itself                                                             */
/* -------------------------------------------------------------------------- */

test("a truck is only Rolling once the paper is back AND the driver has started", () => {
  // A driver post exists, so the cycle reads `dispatched` — but nothing signed
  // has come back. Somebody is still chasing a broker, so it stays workable.
  assert.equal(laneFor("dispatched", [], false), "needs_load");
  assert.equal(laneFor("dispatched", [], true), "rolling");

  // A load actually under way is past arguing about, whatever the paper says.
  assert.equal(laneFor("running", [], false), "rolling");
});

test("anything that stops a dispatch takes the truck out of the working lane", () => {
  assert.equal(laneFor("empty_unworked", [blocker()], false), "not_ready");
  assert.equal(laneFor("finding_work", [blocker({ key: "carrier_authority" })], false), "not_ready");

  // Not every blocker stops a dispatch. One that does not must not demote it.
  assert.equal(
    laneFor("finding_work", [blocker({ key: "unclaimed", stopsDispatch: false })], false),
    "needs_load",
  );
});

test("the rate confirmation somebody is chasing does not demote its own truck", () => {
  // `unconfirmed_load` stops a dispatch and is exactly the work in hand. Moving
  // the truck to `not_ready` would hide it from the person doing that work.
  assert.equal(
    laneFor("booked_unconfirmed", [blocker({ key: "unconfirmed_load" })], false),
    "needs_load",
  );
});

test("a cycle a person has set aside is not offered as workable", () => {
  assert.equal(laneFor("stopped", [], false), "not_ready");
});

/* -------------------------------------------------------------------------- */
/* Against the real board                                                      */
/* -------------------------------------------------------------------------- */

test("every open cycle lands in exactly one lane, and none is dropped", async () => {
  const ctx = loopContextFor(CTX);
  syncMtLoops(ctx);
  const board = await buildMtLoopBoard(ctx);
  assert.ok(board.loops.length > 0, "there is something to lane");

  const lanes = board.loops.map((c) => c.lane);
  for (const lane of lanes) {
    assert.ok(["needs_load", "rolling", "not_ready"].includes(lane), `${lane} is a lane`);
  }
  // The three lanes together are the whole board. A card in none of them would
  // be an open cycle the screen silently stopped rendering.
  assert.equal(
    lanes.filter((l) => l === "needs_load").length
      + lanes.filter((l) => l === "rolling").length
      + lanes.filter((l) => l === "not_ready").length,
    board.loops.length,
  );
});

test("a demoted truck keeps its clock, its blocker and somebody answerable", async () => {
  const ctx = loopContextFor(CTX);
  syncMtLoops(ctx);
  const board = await buildMtLoopBoard(ctx);

  const demoted = board.loops.filter((c) => c.lane === "not_ready");
  assert.ok(demoted.length > 0, "the fixtures have a truck that cannot be dispatched");

  for (const card of demoted) {
    // The reason is on the card, not only in the lane's name.
    assert.ok(
      card.blockers.some((b) => b.stopsDispatch),
      `unit ${card.truckUnit} says what stops it`,
    );
    // Still a cycle: an id that does not change, and a named responsible party.
    assert.ok(card.loopId, "the cycle keeps its identity");
    assert.ok(card.responsible || card.claimed, `unit ${card.truckUnit} is still somebody's`);
    // And the clock is still running, which is the whole reason it stays.
    assert.ok(card.openedAt, "the cycle still knows when it opened");
  }
});

test("a hold a person puts on demotes the cycle and says so on the card", async () => {
  const ctx = loopContextFor(CTX);
  syncMtLoops(ctx);

  const before = await buildMtLoopBoard(ctx);
  const target = before.loops.find((c) => c.can.block && c.lane !== "not_ready");
  if (!target) return; // Nothing workable to hold in this fixture set.

  const reason = "Owner wants this truck held for a dedicated run on Monday";
  assert.equal((await blockLoop(target.loopId, reason, ctx)).status, "ok");

  const after = await buildMtLoopBoard(ctx);
  const held = after.loops.find((c) => c.loopId === target.loopId);
  assert.ok(held, "the cycle is still on the board — a hold is not a disappearance");
  assert.equal(held.lane, "not_ready");
  assert.equal(held.progress.key, "stopped");
  // The words the person used, not a generic label.
  assert.equal(held.headline, reason);
  assert.ok(
    held.blockers.some((b) => b.key === "loop_blocked" && b.stopsDispatch),
    "and the hold is still a blocker that stops the dispatch",
  );
});

/* -------------------------------------------------------------------------- */
/* The badge                                                                   */
/* -------------------------------------------------------------------------- */

test("every card says where the cycle has got to, and whose turn it is", async () => {
  const ctx = loopContextFor(CTX);
  syncMtLoops(ctx);
  const board = await buildMtLoopBoard(ctx);

  for (const card of board.loops) {
    assert.ok(card.progress.label, `unit ${card.truckUnit} has a state`);
    assert.ok(card.progress.note, `unit ${card.truckUnit} says whose turn it is`);
    assert.equal(typeof card.progress.yourTurn, "boolean");
    // One sentence, always. "There is nothing to say" is not an answer a board
    // about empty trucks is allowed to give.
    assert.ok(card.headline.length > 0, `unit ${card.truckUnit} has a conclusion`);
    // A truck the cycle is waiting on a broker for is never "your turn".
    if (card.progress.key === "asked_brokers") {
      assert.equal(card.progress.yourTurn, false);
    }
  }
});

test("a position is drawn only where one may be known, and says which kind", async () => {
  const ctx = loopContextFor(CTX);
  syncMtLoops(ctx);
  const board = await buildMtLoopBoard(ctx);

  for (const card of board.loops) {
    if (!card.position) continue; // No share, no permission, no signal. No map.

    // ★ THE RULE THE WHOLE MAP EXISTS TO KEEP ★
    // A coordinate travels only at exact precision. City-only is a PERMISSION
    // outcome, so the card gets somewhere to put a mark and never a fix.
    if (card.position.precision === "exact") {
      assert.ok(card.position.point, "an exact position carries its coordinate");
      assert.equal(card.position.mapPoint, card.position.point, "and is drawn where it is");
    } else {
      assert.equal(
        card.position.point,
        undefined,
        `unit ${card.truckUnit}: a withheld coordinate is absent, never approximated`,
      );
    }
  }
});
