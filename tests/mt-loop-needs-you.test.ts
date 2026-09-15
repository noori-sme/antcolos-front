import test from "node:test";
import assert from "node:assert/strict";
import { loopContextFor, resetPropagationWorld } from "./propagation-harness.ts";
import type { MtLoopContext } from "@/lib/api/mock/mt-loop";
import { mtLoopBoardSync, syncMtLoops } from "@/lib/api/mock/mt-loop";
import { startSearch } from "@/lib/api/mock/search-session";
import { allMatches } from "@/lib/api/mock/opportunity-matching";
import {
  acceptOnTheTable, openNegotiation, recordBrokerRound,
} from "@/lib/api/mock/negotiation";
import {
  driverGate, recordDriverDecision, sendOpportunityToDriver,
} from "@/lib/api/mock/driver-review";
import { bookNegotiation } from "@/lib/api/mock/booking";
import {
  confirmAndSign, correctField, receiveRateConfirmation, verifyField,
} from "@/lib/api/mock/rate-confirmation";
import { mockNeedsYouService } from "@/lib/api/mock/needs-you";
import { MT_LOOP_STAGE_ORDER } from "@/types";
import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * MT Loop and Needs You as the two surfaces a day is worked from.
 *
 * The test of that claim is not that the screens exist. It is that a card answers
 * the four questions a dispatcher would otherwise open four pages to answer —
 * where is this truck in its cycle, what makes us say so, what is next, what is in
 * the way — and that every Needs You item takes a person to the thing that fixes
 * it rather than to the dashboard it was noticed on.
 */

const CTX = "mem_northline_owner";

test.beforeEach(() => resetPropagationWorld());

/* -------------------------------------------------------------------------- */
/* MT Loop                                                                     */
/* -------------------------------------------------------------------------- */

test("every MT Loop card carries a stage, its evidence, and what is in the way", () => {
  const ctx = loopContextFor(CTX);
  syncMtLoops(ctx);
  const board = mtLoopBoardSync(ctx);
  assert.ok(board.loops.length > 0);

  for (const card of board.loops) {
    assert.ok(
      MT_LOOP_STAGE_ORDER.includes(card.stage),
      `unit ${card.truckUnit} has a stage in the cycle`,
    );
    assert.ok(card.evidence.length > 0, `unit ${card.truckUnit} says why`);
    for (const e of card.evidence) {
      assert.ok(e.label && e.detail, "every piece of evidence is a readable fact");
      assert.ok(
        ["confirmed", "corrected", "inferred", "extracted", "pending", "rejected", "failed"]
          .includes(e.verification),
        "and carries how much it is worth",
      );
    }
    // Blockers are a list, so two problems on one truck are both visible.
    for (const b of card.blockers) {
      assert.ok(b.key && b.label && b.detail);
    }
  }
});

test("the stage is about the truck's cycle, not about who is working it", () => {
  const ctx = loopContextFor(CTX);
  syncMtLoops(ctx);
  const board = mtLoopBoardSync(ctx);

  // An unworked empty truck and a worked one both have no load; the stage tells
  // them apart, which is the distinction `status` alone cannot make.
  const unworked = board.loops.find((c) => !c.responsibleMembershipId && !c.loadReference);
  if (unworked) assert.equal(unworked.stage, "empty_unworked");

  const blocked = board.loops.find((c) => c.status === "blocked");
  if (blocked) {
    assert.equal(blocked.stage, "stopped");
    assert.ok(
      blocked.blockers.some((b) => b.stopsDispatch),
      "a stopped cycle names at least one thing that stops it",
    );
  }
});

test("a problem that stops dispatch outranks finding work", () => {
  const ctx = loopContextFor(CTX);
  syncMtLoops(ctx);
  const board = mtLoopBoardSync(ctx);

  for (const card of board.loops) {
    const stopping = card.blockers.filter(
      (b) => b.stopsDispatch && b.key !== "unconfirmed_load",
    );
    if (stopping.length === 0 || !card.nextAction) continue;
    // Finding work for a truck that may not legally move is wasted effort, so
    // the next action is the fix, not the search.
    assert.match(
      card.nextAction.label.toLowerCase(), /^fix:/,
      `unit ${card.truckUnit} is told to fix ${stopping[0].key} first`,
    );
  }
});

test("a booked load with no signed confirmation is a cycle that is not finished", async () => {
  const ctx = loopContextFor(CTX);
  const { loopId } = await bookALoad(ctx);

  let card = cardFor(ctx, loopId);
  assert.equal(card.stage, "booked_unconfirmed");
  assert.ok(
    card.blockers.some((b) => b.key === "unconfirmed_load"),
    "the outstanding confirmation is named as a blocker",
  );
  assert.match(card.nextAction?.label ?? "", /rate confirmation/i);
  // The truck's own dispatch workspace, which is where THIS cycle's rate
  // confirmation panel is rendered. There is no rate-confirmation index route,
  // and every link asserted here is checked against the real routes below.
  assert.equal(card.nextAction?.href, `/dispatch/trucks/${card.truckId}`);

  await signIt(ctx, loopId);

  card = cardFor(ctx, loopId);
  assert.ok(
    card.stage === "confirmed" || card.stage === "dispatched",
    `the cycle moved on: ${card.stage}`,
  );
  assert.ok(
    !card.blockers.some((b) => b.key === "unconfirmed_load"),
    "and the blocker is gone because the condition is",
  );
  assert.ok(
    card.evidence.some((e) => e.label === "Rate confirmation" && e.verification === "confirmed"),
    "with the signature as evidence",
  );
});

/* -------------------------------------------------------------------------- */
/* Needs You                                                                   */
/* -------------------------------------------------------------------------- */

test("every open item deep-links to where it is fixed, and is assignable", async () => {
  const ctx = loopContextFor(CTX);
  syncMtLoops(ctx);
  const items = await mockNeedsYouService.list(ctx);
  assert.ok(items.length > 0);

  for (const item of items) {
    const link = item.recommendedAction.href ?? item.entity.href;
    assert.ok(link, `${item.category} takes a person somewhere`);
    // Never the dashboard it was noticed on, unless the action genuinely
    // happens there (claiming a loop does).
    if (item.recommendedAction.kind !== "assign_loop") {
      assert.notEqual(link, "/home", `${item.category} does not point back at Home`);
    }
    assert.ok(item.recommendedAction.requires.length > 0, "and says what it needs");
    assert.ok(item.reason.length > 0, "and says why it exists");
  }
});

test("an item exists because the condition does, and stops existing when it stops", async () => {
  const ctx = loopContextFor(CTX);
  const { loopId } = await bookALoad(ctx);

  const reference = cardFor(ctx, loopId).loadReference;
  assert.ok(reference);

  const before = await mockNeedsYouService.list(ctx);
  const outstanding = before.filter(
    (i) => i.category === "ratecon_waiting" && i.entity.label.startsWith(reference),
  );
  assert.equal(
    outstanding.length, 1,
    "an unsigned confirmation on this load is exactly one exception",
  );

  await signIt(ctx, loopId);

  const after = await mockNeedsYouService.list(ctx);
  assert.equal(
    after.filter((i) => outstanding.some((o) => o.id === i.id)).length,
    0,
    "it is gone because it is done, not because anybody dismissed it",
  );

  // And the history of it survives — the item stops being ACTIVE, not real.
  const resolved = await mockNeedsYouService.get(ctx, outstanding[0].id).catch(() => null);
  if (resolved) {
    assert.notEqual(resolved.status, "open");
  }
});

test("a projection that needs a person becomes an item, deep-linked to the decision", async () => {
  const ctx = loopContextFor(CTX);
  const { loopId } = await bookALoad(ctx);
  await signIt(ctx, loopId);

  const items = await mockNeedsYouService.list(ctx);
  const directory = items.find((i) => i.category === "projection_needs_review");
  assert.ok(directory, "the Directory's refusal to guess reaches the queue");
  assert.equal(directory.recommendedAction.href, "/directory/review");
  assert.match(directory.reason, /confirm/i);

  // A projection merely WAITING for an unbuilt module is not an item: nobody can
  // do anything about it, and a queue of those is a queue people stop reading.
  assert.equal(
    items.filter((i) => /pending/i.test(i.title)).length,
    0,
  );
});

test("history survives regeneration", async () => {
  const ctx = loopContextFor(CTX);
  syncMtLoops(ctx);
  const items = await mockNeedsYouService.list(ctx);
  const item = items.find((i) => i.entity.kind === "mt_loop");
  assert.ok(item);

  const assigned = await mockNeedsYouService.assign(ctx, item.id, ctx.membershipId);
  assert.equal(assigned.assigneeMembershipId, ctx.membershipId);

  // Regenerating does not reset it. An item that forgot its assignee on every
  // read would be an item nobody could own.
  const again = await mockNeedsYouService.list(ctx);
  const same = again.find((i) => i.id === item.id);
  assert.ok(same);
  assert.equal(same.assigneeMembershipId, ctx.membershipId);
  assert.ok(same.history.some((h) => h.action === "assigned"));
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function cardFor(ctx: MtLoopContext, loopId: string) {
  const card = mtLoopBoardSync(ctx).loops.find((c) => c.loopId === loopId);
  assert.ok(card, "the loop is still on the board");
  return card;
}

/** Take one loop all the way to a booked load. Returns the loop and workflow. */
async function bookALoad(ctx: MtLoopContext) {
  syncMtLoops(ctx);
  const board = mtLoopBoardSync(ctx);
  const loop = board.loops.find(
    (l) => l.driverName && !l.blockReason && (l.trailerUnit || !l.trailerRequired),
  ) ?? board.loops[0];
  assert.ok(loop);

  await startSearch(loop.loopId, ctx);
  const rows = allMatches(ctx).filter((r) => r.match.dispatchCycleId === loop.loopId);
  assert.ok(rows.length > 0);

  const gate = driverGate(rows[0].match.matchId, ctx);
  if (!gate.clear && gate.hasDriver) {
    const sent = await sendOpportunityToDriver(rows[0].match.matchId, ctx);
    const review = sent.status === "ok" || sent.status === "already_sent" ? sent.review : undefined;
    assert.ok(review);
    await recordDriverDecision(review.reviewId, "approved", ctx);
  }

  const opened = await openNegotiation(rows[0].match.matchId, ctx);
  assert.equal(opened.status, "ok");
  const nid = opened.status === "ok" ? opened.negotiation.negotiationId : "";
  await recordBrokerRound(nid, {
    kind: "counter", amountCents: rows[0].listing.postedRateCents, note: "Best we can do.",
  }, ctx);
  await acceptOnTheTable(nid, ctx);
  const booked = await bookNegotiation(nid, ctx);
  assert.equal(booked.status, "ok", JSON.stringify(booked));
  const booking = booked.status === "ok" ? booked.booking : undefined;
  assert.ok(booking);

  const received = await receiveRateConfirmation(booking.bookingId, ctx);
  const workflow = received.status === "ok" || received.status === "already_open"
    ? received.workflow
    : undefined;
  assert.ok(workflow);
  return { loopId: loop.loopId, booking, workflow };
}

/** Review every required field and sign, the way the review screen does. */
async function signIt(ctx: MtLoopContext, loopId: string) {
  const card = cardFor(ctx, loopId);
  assert.ok(card.loadReference);
  const { rateConsFor } = await import("@/lib/api/mock/rate-confirmation");
  const workflow = rateConsFor(ctx).find((w) => w.loadReference === card.loadReference);
  assert.ok(workflow, "the confirmation for the booked load is on the desk");

  for (const field of workflow.fields.filter((f) => f.required)) {
    if (field.disagrees && field.expected) {
      await correctField(workflow.rateConId, field.key, field.expected, ctx, "Booked value is right.");
    } else {
      await verifyField(workflow.rateConId, field.key, ctx);
    }
  }
  const signed = await confirmAndSign(workflow.rateConId, ctx);
  assert.equal(signed.status, "ok", JSON.stringify(signed));
  return signed;
}

/* -------------------------------------------------------------------------- */
/* Every link goes somewhere that exists                                       */
/* -------------------------------------------------------------------------- */

test("every deep link MT Loop and Needs You produce resolves to a real route", async () => {
  const ctx = loopContextFor(CTX);
  syncMtLoops(ctx);

  const links = new Set<string>();
  for (const card of mtLoopBoardSync(ctx).loops) {
    if (card.nextAction) links.add(card.nextAction.href);
    for (const b of card.blockers) if (b.href) links.add(b.href);
    for (const e of card.evidence) if (e.href) links.add(e.href);
  }
  for (const item of await mockNeedsYouService.list(ctx)) {
    if (item.recommendedAction.href) links.add(item.recommendedAction.href);
    if (item.entity.href) links.add(item.entity.href);
  }
  assert.ok(links.size > 5, "the two surfaces produce links to check");

  for (const link of links) {
    assert.ok(
      routeExists(link),
      `${link} has no page. A deep link to a 404 is worse than no link.`,
    );
  }
});

/**
 * Whether the App Router has a page for this path.
 *
 * Reads the route tree rather than a hardcoded list, so a link added to a route
 * that is later renamed fails here instead of in somebody's browser. Dynamic
 * segments match one path segment each.
 */
function routeExists(href: string): boolean {
  const path = href.split("?")[0].split("#")[0];
  const segments = path.split("/").filter(Boolean);
  return ROUTES.some((route) => {
    if (route.length !== segments.length) return false;
    return route.every((part, i) => part.startsWith("[") || part === segments[i]);
  });
}

/** Every page path under src/app, as segment arrays. */
const ROUTES: string[][] = (() => {
  const out: string[][] = [];
  const root = join(process.cwd(), "src/app");
  const walk = (dir: string, segments: string[]) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        // Route groups like (app) do not appear in the URL.
        const next = entry.name.startsWith("(") ? segments : [...segments, entry.name];
        walk(join(dir, entry.name), next);
      } else if (entry.name === "page.tsx") {
        out.push(segments);
      }
    }
  };
  walk(root, []);
  return out;
})();
