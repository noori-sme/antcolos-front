import test from "node:test";
import assert from "node:assert/strict";
import { loopContextFor, resetPropagationWorld } from "./propagation-harness.ts";
import { blockLoop, buildMtLoopBoard, syncMtLoops } from "@/lib/api/mock/mt-loop";
import { truckDispatchWorkspaceFor } from "@/lib/api/mock/truck-dispatch-workspace";

/**
 * One blocker list, for every screen that shows one.
 *
 * ★ WHAT THIS FILE EXISTS TO STOP HAPPENING AGAIN ★
 *
 * The MT Loop board and a truck's dispatch workspace each used to work out their
 * own blockers, from different inputs, and neither list was the complete one.
 * The board could not see a carrier whose authority had lapsed or a driver whose
 * licence had expired. The truck page could not see the loop's own state or the
 * rate confirmation nobody had returned. So the two screens, one click apart,
 * said different things about the same truck — and the truck page said its half
 * in a full-width green banner reading "Nothing is standing in the way".
 *
 * Both were observed in the running app before this was fixed:
 *
 *   Unit 104  board: "Rate confirmation outstanding … the driver has nothing to
 *             run."   truck page: "Nothing is standing in the way."
 *
 *   Unit 118  held by a person with a reason. Board: Stopped · Blocked.
 *             Truck page: "Nothing is standing in the way", with the hold's own
 *             reason 1,462 px further down the page.
 *
 * Both are tests now.
 */

const CTX = "mem_northline_owner";

test.beforeEach(() => resetPropagationWorld());

test("the board and the truck's own page never disagree about what is in the way", async () => {
  const ctx = loopContextFor(CTX);
  syncMtLoops(ctx);
  const board = await buildMtLoopBoard(ctx);
  assert.ok(board.loops.length > 0, "there is something to compare");

  for (const card of board.loops) {
    const workspace = await truckDispatchWorkspaceFor(card.truckId, ctx);
    assert.ok(workspace, `unit ${card.truckUnit} has a dispatch workspace`);

    assert.deepEqual(
      workspace.blockers.map((b) => b.key).sort(),
      card.blockers.map((b) => b.key).sort(),
      `unit ${card.truckUnit}: both screens name the same blockers`,
    );

    // Not just the same keys — the same words. A dispatcher who reads one
    // sentence on the board and a different one on the truck has been given two
    // answers, whether or not they happen to agree.
    const byKey = new Map(workspace.blockers.map((b) => [b.key, b]));
    for (const b of card.blockers) {
      assert.equal(byKey.get(b.key)?.detail, b.detail, `unit ${card.truckUnit}: ${b.key} reads the same`);
      assert.equal(byKey.get(b.key)?.stopsDispatch, b.stopsDispatch, `unit ${card.truckUnit}: ${b.key} stops the same`);
    }
  }
});

test("a hold a person puts on reaches the truck's own page", async () => {
  const ctx = loopContextFor(CTX);
  syncMtLoops(ctx);

  const before = await buildMtLoopBoard(ctx);
  const target = before.loops.find((c) => c.can.block);
  assert.ok(target, "there is a loop this membership may hold");

  const reason = "Owner wants this truck held for a dedicated run on Monday";
  const outcome = await blockLoop(target.loopId, reason, ctx);
  assert.equal(outcome.status, "ok", "the hold went on");

  const workspace = await truckDispatchWorkspaceFor(target.truckId, ctx);
  assert.ok(workspace);

  const held = workspace.blockers.find((b) => b.key === "loop_blocked");
  assert.ok(held, "the truck's own page knows the cycle is held");
  assert.equal(held.detail, reason, "in the words the person who held it used");
  assert.equal(held.stopsDispatch, true);
  assert.equal(held.severity, "critical", "and leads the list");
  assert.equal(workspace.blockers[0]?.key, "loop_blocked");
});

test("a booked load with no rate confirmation back is in the way on both screens", async () => {
  const ctx = loopContextFor(CTX);
  syncMtLoops(ctx);
  const board = await buildMtLoopBoard(ctx);

  const covered = board.loops.find((c) => c.blockers.some((b) => b.key === "unconfirmed_load"));
  assert.ok(covered, "the fixtures have a booked load whose rate confirmation has not come back");

  const workspace = await truckDispatchWorkspaceFor(covered.truckId, ctx);
  assert.ok(workspace);
  assert.ok(
    workspace.blockers.some((b) => b.key === "unconfirmed_load"),
    "and the truck's own page says so too, rather than 'nothing is standing in the way'",
  );
});

test("every blocker names somebody who can actually clear it", async () => {
  const ctx = loopContextFor(CTX);
  syncMtLoops(ctx);
  const board = await buildMtLoopBoard(ctx);

  for (const card of board.loops) {
    for (const b of card.blockers) {
      assert.ok(
        ["carrier", "driver", "dispatcher"].includes(b.owner),
        `unit ${card.truckUnit}: ${b.key} says whose it is to fix`,
      );
      assert.ok(
        ["critical", "high", "medium"].includes(b.severity),
        `unit ${card.truckUnit}: ${b.key} says how hard it stops the work`,
      );
      assert.ok(b.label && b.detail, "and is readable without opening anything");
    }
  }
});
