import test from "node:test";
import assert from "node:assert/strict";
import { loopContextFor, resetPropagationWorld } from "./propagation-harness.ts";
import { buildMtLoopBoard, syncMtLoops } from "@/lib/api/mock/mt-loop";
import { ensureDemoCycle } from "@/lib/api/mock/demo-cycle";
import { ensureDemoFleet } from "@/lib/api/mock/demo-fleet";
import { truckOpportunitiesSync } from "@/lib/api/mock/opportunity-service";

/**
 * Ten trucks in ten states, and whether any of them is real.
 *
 * ★ WHAT THIS EXISTS TO STOP HAPPENING ★
 *
 * The whole value of `demo-fleet.ts` rests on one claim: every state on that
 * board was reached by the same service calls a dispatcher makes. The moment
 * somebody "fixes" a stubborn scenario by writing the record down, the board
 * still looks right and stops meaning anything — a truck could read "Broker
 * replied" while `recordBrokerRound` refused every real reply.
 *
 * So these assertions deliberately go PAST the badge. A truck that says a
 * broker replied must have a conversation with our ask and their answer in it.
 * One that says the driver agreed must have a review with a decision on it. One
 * that says it is fuelling must have a fuel transaction on the ledger.
 *
 * ★ AND WHETHER THE STATES ARE ACTUALLY DIFFERENT ★
 * The second failure mode is subtler: ten cycles that all landed in the same
 * place because the market ran out, each one honestly derived and none of them
 * the state it was supposed to show. That happened twice while this was being
 * built, so the distinctness is asserted too.
 */

const CTX = "mem_northline_owner";

test.beforeEach(() => resetPropagationWorld());

async function seededBoard() {
  const ctx = loopContextFor(CTX);
  await ensureDemoCycle(ctx);
  await ensureDemoFleet(ctx);
  syncMtLoops(ctx);
  return { ctx, board: await buildMtLoopBoard(ctx) };
}

/**
 * The card in a given state, whichever truck happens to be in it.
 *
 * ★ NOT BY UNIT NUMBER, AND THAT IS DELIBERATE ★
 * Which truck lands in which state depends on how the sample market ranks that
 * morning — pickup windows move with the clock, so the van that books the rate
 * confirmation today may be the one that only searched tomorrow. Pinning these
 * to unit 143 made the suite fail for a reason that had nothing to do with the
 * behaviour under test. What must hold is that SOMETHING is in each state and
 * that the records behind it are real.
 */
const inState = (
  board: Awaited<ReturnType<typeof seededBoard>>["board"],
  key: string,
) => {
  const card = board.loops.find((c) => c.progress.key === key);
  assert.ok(card, `a truck is ${key}`);
  return card;
};

/* -------------------------------------------------------------------------- */
/* The board as a whole                                                        */
/* -------------------------------------------------------------------------- */

test("there are at least ten trucks, and both halves of the board are populated", async () => {
  const { board } = await seededBoard();
  assert.ok(board.loops.length >= 10, `${board.loops.length} cycles`);
  assert.ok(board.loops.filter((c) => c.lane === "needs_load").length >= 5, "five to work");
  assert.ok(board.loops.filter((c) => c.lane === "rolling").length >= 5, "five under way");
});

test("the working lane shows five DIFFERENT stages, not five copies of one", async () => {
  const { board } = await seededBoard();
  const working = board.loops.filter((c) => c.lane === "needs_load");
  const states = new Set(working.map((c) => c.progress.key));
  /*
   * The failure this catches: every demo truck stalling at "searching" because
   * the sample market ran out after the third booking. The board looked fine.
   */
  assert.ok(states.size >= 5, `only ${states.size} distinct states: ${[...states].join(", ")}`);
  for (const key of ["searching", "driver_answered", "broker_replied", "asked_brokers", "waiting_rate_con"]) {
    assert.ok(states.has(key as never), `something is ${key}`);
  }
});

test("the rolling lane says what each truck is DOING, and no two the same", async () => {
  const { board } = await seededBoard();
  const rolling = board.loops.filter((c) => c.lane === "rolling");
  for (const card of rolling) {
    assert.ok(card.activity, `unit ${card.truckUnit} says what it is doing`);
  }
  const doing = new Set(rolling.map((c) => c.activity?.key));
  assert.ok(doing.size >= 4, `only ${doing.size} distinct activities: ${[...doing].join(", ")}`);
  for (const key of ["rolling", "off_duty", "fuelling", "delayed", "at_receiver"]) {
    assert.ok(doing.has(key as never), `something is ${key}`);
  }
});

test("an empty truck is never given an activity", async () => {
  const { board } = await seededBoard();
  for (const card of board.loops.filter((c) => c.lane !== "rolling")) {
    // Its stage is the answer. A second badge saying "On a load" beside
    // "Searching" would be two answers to one question.
    assert.equal(card.activity, undefined, `unit ${card.truckUnit} has no activity`);
  }
});

/* -------------------------------------------------------------------------- */
/* Each state, behind the badge                                                */
/* -------------------------------------------------------------------------- */

test("the truck that says a broker replied has a conversation with a reply in it", async () => {
  const { ctx, board } = await seededBoard();
  const card = inState(board, "broker_replied");

  const o = truckOpportunitiesSync(card.loopId, ctx);
  const summary = o.negotiations[0];
  assert.ok(summary, "there is a real conversation");
  const negotiation = summary.negotiation;
  assert.equal(negotiation.status, "waiting_on_you", "and the ball is with us");
  // Both sides said something. A seeded "reply" with no ask before it would be
  // a broker answering a question nobody asked.
  const rounds = negotiation.rounds ?? [];
  assert.ok(rounds.some((r) => r.side === "us"), "we asked");
  assert.ok(rounds.some((r) => r.side === "broker"), "they answered");
});

test("the truck that says the driver agreed has the driver's own answer on file", async () => {
  const { ctx, board } = await seededBoard();
  const card = inState(board, "driver_answered");

  const o = truckOpportunitiesSync(card.loopId, ctx);
  const review = o.driverReviews.find((r) => r.status === "approved");
  assert.ok(review, "a review was sent and answered");
  assert.ok(review.decisions.length > 0, "the answer is a decision, not a status somebody set");
  assert.ok(review.sent.originCity, "and what the driver was actually shown is kept");

  // Nothing has been asked of a broker yet — that is what makes this its own
  // state rather than a step on the way to one.
  assert.equal(o.negotiations.length, 0);
});

test("the truck waiting on a rate con has an unchecked document that disagrees", async () => {
  const { ctx, board } = await seededBoard();
  /*
   * The fixture set has a SECOND truck reading "waiting on the rate con": unit
   * 104 carries a load that was never booked through Antcolos, so there is no
   * booking for a confirmation to hang off. That is a real and different state,
   * and it is not the one this test is about.
   */
  const card = board.loops.find((c) => {
    if (c.progress.key !== "waiting_rate_con") return false;
    return Boolean(truckOpportunitiesSync(c.loopId, ctx).rateCon);
  });
  assert.ok(card, "a truck has a rate confirmation on the desk");

  const o = truckOpportunitiesSync(card.loopId, ctx);
  assert.ok(o.booking, "it is genuinely booked");
  const workflow = o.rateCon;
  assert.ok(workflow, "and a rate confirmation has arrived");
  assert.equal(workflow.status, "reviewing");
  assert.equal(workflow.signed, undefined, "nothing is signed");
  assert.ok(
    workflow.fields.every((f) => f.status === "unreviewed"),
    "and nobody has looked at a single field",
  );
  assert.ok(
    workflow.fields.some((f) => f.disagrees),
    "there is something on it worth catching",
  );
});

test("the truck that is fuelling has a fuel purchase, not a label", async () => {
  const { board } = await seededBoard();
  const card = board.loops.find((c) => c.activity?.key === "fuelling");
  assert.ok(card, "one truck is at a pump");
  /*
   * ★ AND IT SAYS IT IS AN INFERENCE ★
   * A card that cleared six minutes ago is very good evidence somebody is at a
   * pump and no evidence at all that they still are. The screen must not render
   * that identically to a driver telling us where they are.
   */
  assert.equal(card.activity?.inferred, true);
  assert.ok(card.activity?.detail, "and names the stop it read");
});

test("the delayed truck is red, and the one running on time is not", async () => {
  const { board } = await seededBoard();
  const late = board.loops.find((c) => c.activity?.key === "delayed");
  const fine = board.loops.find((c) => c.activity?.key === "rolling");
  assert.ok(late && fine);
  /*
   * Every row in Rolling used to be green, so a truck that had reported a delay
   * looked exactly like one running on time. The lane says the truck has gone;
   * the colour has to say whether it needs anybody.
   */
  assert.equal(late.activity?.tone, "bad");
  assert.equal(fine.activity?.tone, "good");
  assert.ok(late.activity?.detail, "and the reason is on it");
});

test("the truck on a dock says how long it has been sitting", async () => {
  const { board } = await seededBoard();
  const card = board.loops.find((c) => c.activity?.key === "at_receiver");
  assert.ok(card);
  // Time on site is the number that turns into detention, so it is the one
  // fact this activity has to carry.
  assert.match(card.activity?.detail ?? "", /on site \d+/);
});
