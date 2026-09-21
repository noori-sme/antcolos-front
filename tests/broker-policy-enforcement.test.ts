import test from "node:test";
import assert from "node:assert/strict";
import {
  APEX_MC, BAXTER, BAXTER_OWNER, MERIDIAN_DISPATCHER, MERIDIAN_OWNER,
  NORTHLINE, NORTHLINE_OWNER, brokerPartyByMc, policyContextFor, resetPolicyWorld,
} from "./broker-policy-harness.ts";
import type { MtLoopContext } from "@/lib/api/mock/mt-loop";
import { buildMtLoopBoard, openLoopsFor, syncMtLoops } from "@/lib/api/mock/mt-loop";
import { startSearch } from "@/lib/api/mock/search-session";
import { allMatches, matchesForCycle } from "@/lib/api/mock/opportunity-matching";
import {
  refreshOpportunities, truckOpportunitiesSync,
} from "@/lib/api/mock/opportunity-service";
import {
  acceptOnTheTable, openNegotiation, recordBrokerRound,
} from "@/lib/api/mock/negotiation";
import { bookNegotiation, canBook } from "@/lib/api/mock/booking";
import {
  driverGate, recordDriverDecision, sendOpportunityToDriver,
} from "@/lib/api/mock/driver-review";
import {
  approveBrokerPolicySync, brokerPoliciesForTests,
  grantBrokerPolicyExceptionSync, proposeBrokerPolicySync, revokeBrokerPolicy,
} from "@/lib/api/mock/broker-policy-registry";
import { dispatchGrantsByCarrier } from "@/lib/api/mock/truck-registry";
import type { BrokerPolicyAction, MatchWithListing } from "@/types";
import { UNARGUABLE_CHECKS } from "@/types";

/**
 * ★ WHAT A POLICY DOES TO THE WORK ★
 *
 * Load Search, the Opportunity and Booking, driven end to end through the same
 * services a dispatcher's screen calls. Nothing here reaches past the service
 * layer and nothing constructs a match by hand: a policy that only worked in a
 * unit test of the evaluator would be a policy nobody is protected by.
 *
 * The companion file, `broker-work-policy.test.ts`, proves the authority and
 * routing half.
 */

const APEX_NAME = "Apex Logistics";

/** Every match on this cycle whose broker is the one we wrote a policy about. */
function apexRows(rows: MatchWithListing[]): MatchWithListing[] {
  return rows.filter((r) => r.listing.broker.name === APEX_NAME);
}

/**
 * The cycle's matches as a SCREEN would read them.
 *
 * Through `refreshOpportunities`, which is the ordering every Opportunity
 * surface goes through: listings age, then matches reconcile against them. A
 * test that read the bucket directly would be reading what was true when the
 * search ran rather than what is true now — and "a policy written since is
 * picked up on the next read" is exactly the property being tested.
 */
function rowsFor(loopId: string, ctx: MtLoopContext): MatchWithListing[] {
  refreshOpportunities(ctx);
  return matchesForCycle(loopId, ctx);
}

/**
 * A Northline cycle that the sample market actually posts Apex freight into.
 *
 * Picked by searching rather than asserted from a fixture id: which truck sees
 * which lane is the market's business, and a test that hard-coded it would go
 * red the first time somebody added a lane.
 */
async function northlineCycleWithApex(ctx: MtLoopContext) {
  syncMtLoops(ctx);
  for (const loop of openLoopsFor(ctx)) {
    // A truck that already has a load is not looking for one, and its card is
    // about the rate confirmation rather than about finding work.
    if (loop.loadId) continue;
    await startSearch(loop.loopId, ctx);
    const rows = apexRows(rowsFor(loop.loopId, ctx));
    if (rows.length > 0) return { loop, rows };
  }
  throw new Error("the sample market posted no Apex freight to any Northline truck");
}

function writeCarrierPolicy(
  action: BrokerPolicyAction,
  explanation: string,
  carrierOrganizationId = NORTHLINE,
  ownerMembershipId = NORTHLINE_OWNER,
) {
  const owner = policyContextFor(ownerMembershipId);
  return proposeBrokerPolicySync(owner, {
    scope: "carrier",
    carrierOrganizationId,
    brokerPartyId: brokerPartyByMc(APEX_MC).partyId,
    action,
    reason: "payment_experience",
    explanation,
  }).policy;
}

/* ========================================================================== */
/* 8 (in Load Search). Only an active policy filters a search result           */
/* ========================================================================== */

test("8 · a proposed policy leaves Load Search exactly as it was", async () => {
  resetPolicyWorld();
  const owner = policyContextFor(NORTHLINE_OWNER);
  const { loop } = await northlineCycleWithApex(owner);

  const before = apexRows(rowsFor(loop.loopId, owner));
  const eligibleBefore = before.filter((r) => r.match.status === "eligible").length;

  // A dispatcher's proposal, which nobody has approved.
  const paige = policyContextFor("mem_northline_paige");
  proposeBrokerPolicySync(paige, {
    scope: "carrier",
    carrierOrganizationId: NORTHLINE,
    brokerPartyId: brokerPartyByMc(APEX_MC).partyId,
    action: "hard_block",
    reason: "payment_experience",
    explanation: "I think we should stop.",
  });

  const after = apexRows(rowsFor(loop.loopId, owner));
  assert.equal(
    after.filter((r) => r.match.status === "eligible").length, eligibleBefore,
    "a proposal filters nothing in Load Search",
  );
  for (const row of after) {
    assert.equal(row.match.brokerPolicy?.effect, "none");
  }
});

/* ========================================================================== */
/* 9. Deprioritize changes ranking without hiding the load                    */
/* ========================================================================== */

test("9 · deprioritize ranks a load down and leaves it visible and bookable", async () => {
  resetPolicyWorld();
  const owner = policyContextFor(NORTHLINE_OWNER);
  const { loop } = await northlineCycleWithApex(owner);

  const before = apexRows(rowsFor(loop.loopId, owner));
  const scoresBefore = new Map(before.map((r) => [r.match.matchId, r.match.score.total]));
  const statusBefore = new Map(before.map((r) => [r.match.matchId, r.match.status]));
  assert.ok(before.length > 0);

  writeCarrierPolicy("deprioritize", "They pay, but they pay slowly. Take them last.");

  const after = apexRows(rowsFor(loop.loopId, owner));
  assert.equal(after.length, before.length, "every one of them is still there");

  for (const row of after) {
    assert.equal(row.match.brokerPolicy?.effect, "deprioritize");
    /*
     * ★ VISIBLE ★
     * Asserted against what each match was BEFORE the policy rather than
     * against "not ineligible" flat: a cargo van was never going to take a dry
     * van and was ineligible for that reason the whole time. The claim being
     * made is that deprioritize changed nothing about eligibility, which is
     * exactly what comparing the two says.
     */
    assert.equal(
      row.match.status, statusBefore.get(row.match.matchId),
      "deprioritize moved the ranking and nothing else",
    );
    const check = row.match.checks.find((c) => c.key === "broker_policy");
    assert.equal(check?.outcome, "warn");
    assert.equal(check?.blocking, false, "deprioritize never blocks");
    assert.match(check!.detail, /Ranked down by Northline Freight \(carrier policy\)/);

    // ★ RANKED DOWN ★
    const was = scoresBefore.get(row.match.matchId)!;
    assert.ok(
      row.match.score.total < was,
      `score fell from ${was} to ${row.match.score.total}`,
    );
    // The component breakdown still says what the load was actually worth, so
    // a dispatcher can see both why it would have ranked and what pushed it down.
    assert.ok(row.match.score.components.length > 0);
  }

  // And it sinks below the unaffected freight rather than vanishing from it.
  const all = rowsFor(loop.loopId, owner)
    .filter((r) => r.match.status === "eligible" || r.match.status === "shortlisted");
  const others = all.filter((r) => r.listing.broker.name !== APEX_NAME);
  const apex = all.filter((r) => r.listing.broker.name === APEX_NAME);
  if (apex.length > 0 && others.length > 0) {
    const worstOther = Math.min(...others.map((r) => r.match.score.total));
    const bestApex = Math.max(...apex.map((r) => r.match.score.total));
    assert.ok(
      bestApex <= worstOther,
      `deprioritized ${bestApex} should not outrank ${worstOther}`,
    );
  }
});

/* ========================================================================== */
/* 10 & 11. What a warning does, and what a hard block does, at booking       */
/* ========================================================================== */

/** Walk one match all the way to an agreed price, exactly as the screens do. */
async function agreeOn(row: MatchWithListing, ctx: MtLoopContext): Promise<string> {
  const gate = driverGate(row.match.matchId, ctx);
  if (!gate.clear && gate.hasDriver) {
    const sent = await sendOpportunityToDriver(row.match.matchId, ctx);
    const review = sent.status === "ok" || sent.status === "already_sent" ? sent.review : undefined;
    assert.ok(review);
    await recordDriverDecision(review.reviewId, "approved", ctx);
  }
  const opened = await openNegotiation(row.match.matchId, ctx);
  assert.equal(opened.status, "ok", JSON.stringify(opened));
  const negotiationId = opened.status === "ok" ? opened.negotiation.negotiationId : "";
  await recordBrokerRound(negotiationId, {
    kind: "counter",
    amountCents: row.listing.postedRateCents,
    note: "Best we can do.",
  }, ctx);
  assert.equal((await acceptOnTheTable(negotiationId, ctx)).status, "ok");
  return negotiationId;
}

/** A match on this cycle that nothing but a policy could stop. */
function bookableApexRow(loopId: string, ctx: MtLoopContext): MatchWithListing {
  const row = apexRows(rowsFor(loopId, ctx)).find(
    (r) => !r.match.checks.some(
      (c) => c.outcome === "fail"
        && UNARGUABLE_CHECKS.includes(c.key)
        && c.key !== "broker_policy",
    ),
  );
  assert.ok(row, "at least one Apex match passes every unarguable check but the policy");
  return row;
}

test("10 · a warning leaves booking available, and says its piece first", async () => {
  resetPolicyWorld();
  const owner = policyContextFor(NORTHLINE_OWNER);
  const { loop } = await northlineCycleWithApex(owner);

  writeCarrierPolicy("warning", "Ask for quick pay. They ran us to 52 days last time.");

  const row = bookableApexRow(loop.loopId, owner);
  assert.equal(row.match.brokerPolicy?.effect, "warning");
  const check = row.match.checks.find((c) => c.key === "broker_policy");
  assert.equal(check?.outcome, "warn");
  assert.equal(check?.blocking, false, "a warning hides nothing and blocks nothing");
  assert.equal(
    row.match.checks.some((c) => c.key === "broker_policy" && c.outcome === "fail"),
    false,
  );

  const negotiationId = await agreeOn(row, owner);
  const verdict = canBook(negotiationId, owner);

  assert.equal(verdict.ok, true, JSON.stringify(verdict.blocks));
  assert.equal(
    verdict.blocks.some((b) => b.kind === "broker_policy"), false,
    "a warning is not a block",
  );
  // It is carried onto the confirmation, so the dispatcher reads it before
  // they commit rather than after.
  assert.equal(verdict.preview?.brokerPolicy?.outcome, "warn");
  assert.match(
    verdict.preview!.brokerPolicy!.evaluation.notices[0].explanation!,
    /quick pay/,
  );

  const booked = await bookNegotiation(negotiationId, owner);
  assert.equal(booked.status, "ok", "and the booking goes through");
});

test("11 · a hard block prevents booking, and is not negotiable", async () => {
  resetPolicyWorld();
  const owner = policyContextFor(NORTHLINE_OWNER);
  const { loop } = await northlineCycleWithApex(owner);

  // Agree a price FIRST, while nothing stands in the way.
  const row = bookableApexRow(loop.loopId, owner);
  const negotiationId = await agreeOn(row, owner);
  assert.equal(canBook(negotiationId, owner).ok, true, "it was bookable before");

  writeCarrierPolicy("hard_block", "They short-paid two invoices and stopped answering.");

  const verdict = canBook(negotiationId, owner);
  assert.equal(verdict.ok, false);
  const block = verdict.blocks.find((b) => b.kind === "broker_policy");
  assert.ok(block, JSON.stringify(verdict.blocks));
  assert.match(block.detail, /Blocked by Northline Freight \(carrier policy\)/);

  // And the command refuses too — a check only the screen ran is a decoration.
  const attempt = await bookNegotiation(negotiationId, owner);
  assert.equal(attempt.status, "blocked");
  assert.ok(
    attempt.status === "blocked"
    && attempt.blocks.some((b) => b.kind === "broker_policy"),
  );

  // Nothing was created. No load, no booking, no half-committed truck.
  const loopNow = openLoopsFor(owner).find((l) => l.loopId === loop.loopId);
  assert.equal(loopNow?.loadId, undefined);
});

/* ========================================================================== */
/* 11b. A hard block takes the load off the eligible list in Search            */
/* ========================================================================== */

test("11b · a hard block stops the load being presented as eligible, with an explanation on demand", async () => {
  resetPolicyWorld();
  const owner = policyContextFor(NORTHLINE_OWNER);
  const { loop } = await northlineCycleWithApex(owner);

  writeCarrierPolicy("hard_block", "They short-paid two invoices and stopped answering.");

  const rows = apexRows(rowsFor(loop.loopId, owner));
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.equal(row.match.status, "ineligible", "never offered as eligible");
    const check = row.match.checks.find((c) => c.key === "broker_policy");
    assert.equal(check?.outcome, "fail");
    assert.equal(check?.blocking, true);
    // The explanation is there for anybody who opens it — and it names WHOSE
    // policy it is, so a dispatch organization's decision can never be read as
    // the carrier's.
    assert.match(check!.detail, /Blocked by Northline Freight \(carrier policy\)/);
    assert.match(check!.detail, /short-paid two invoices/);
  }

  // The shortlist a dispatcher is shown carries none of them.
  const inbox = truckOpportunitiesSync(loop.loopId, owner);
  assert.equal(
    inbox.top.some((r) => r.listing.broker.name === APEX_NAME), false,
    "a blocked load is never in the top shortlist",
  );
});

/* ========================================================================== */
/* 14. Search, Opportunity and Booking use the same canonical policy          */
/* ========================================================================== */

test("14 · Search, the Opportunity and Booking all read one canonical policy", async () => {
  resetPolicyWorld();
  const owner = policyContextFor(NORTHLINE_OWNER);
  const { loop } = await northlineCycleWithApex(owner);

  const policy = writeCarrierPolicy("warning", "Ask for quick pay.");
  // ★ ONE RECORD ★ There is one row in one store, and every surface below
  // resolves to its id rather than to a copy of its contents.
  assert.equal(brokerPoliciesForTests(NORTHLINE).length, 1);

  /* ---- Load Search ---- */
  const searchRow = bookableApexRow(loop.loopId, owner);
  assert.equal(searchRow.match.brokerPolicy?.notices[0].policyId, policy.policyId);

  /* ---- The Opportunity ---- */
  const inbox = truckOpportunitiesSync(loop.loopId, owner);
  const opportunityRow = [...inbox.top, ...inbox.rest].find(
    (r) => r.match.matchId === searchRow.match.matchId,
  );
  assert.ok(opportunityRow);
  assert.equal(opportunityRow.match.brokerPolicy?.notices[0].policyId, policy.policyId);
  // Not a second evaluation that happens to agree — the same carried answer.
  assert.deepEqual(
    opportunityRow.match.brokerPolicy,
    searchRow.match.brokerPolicy,
  );

  /* ---- Booking ---- */
  const negotiationId = await agreeOn(searchRow, owner);
  const verdict = canBook(negotiationId, owner);
  assert.equal(
    verdict.preview?.brokerPolicy?.evaluation.notices[0].policyId,
    policy.policyId,
  );

  // And revoking that ONE record clears all three at once.
  await revokeBrokerPolicy(owner, policy.policyId, "They settled in full.");
  const cleared = rowsFor(loop.loopId, owner).find(
    (r) => r.match.matchId === searchRow.match.matchId,
  );
  assert.equal(cleared?.match.brokerPolicy?.effect, "none");
  assert.equal(canBook(negotiationId, owner).preview?.brokerPolicy, undefined);
});

/* ========================================================================== */
/* 15. A policy change after Opportunity creation is enforced at booking      */
/* ========================================================================== */

test("15 · a policy written after the Opportunity is enforced when somebody presses Book", async () => {
  resetPolicyWorld();
  const paige = policyContextFor("mem_northline_paige");
  const owner = policyContextFor(NORTHLINE_OWNER);
  const { loop } = await northlineCycleWithApex(owner);

  // An Opportunity, agreed and ready, against a broker nobody had an opinion
  // about. The dispatcher could book it this second.
  const row = bookableApexRow(loop.loopId, owner);
  assert.equal(row.match.brokerPolicy?.effect, "none");
  const negotiationId = await agreeOn(row, owner);
  assert.equal(canBook(negotiationId, owner).ok, true);

  // Somebody proposes a block while the load sits there. Still nothing.
  const { policy } = proposeBrokerPolicySync(paige, {
    scope: "carrier",
    carrierOrganizationId: NORTHLINE,
    brokerPartyId: brokerPartyByMc(APEX_MC).partyId,
    action: "hard_block",
    reason: "suspected_fraud",
    explanation: "Their remit-to address changed mid-load.",
  });
  assert.equal(canBook(negotiationId, owner).ok, true, "a proposal stops nothing");

  // The Owner approves. The Opportunity is unchanged on anybody's screen, and
  // the booking is refused anyway — which is the entire point of re-evaluating
  // at the moment of commitment rather than trusting what was carried.
  approveBrokerPolicySync(owner, policy.policyId);

  const verdict = canBook(negotiationId, owner);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.blocks.some((b) => b.kind === "broker_policy"));
  const attempt = await bookNegotiation(negotiationId, owner);
  assert.equal(attempt.status, "blocked");
});

/* ========================================================================== */
/* An owner's exception lets exactly that booking through                     */
/* ========================================================================== */

test("· an owner's exception unblocks the one booking it names, and nothing else", async () => {
  resetPolicyWorld();
  const owner = policyContextFor(NORTHLINE_OWNER);
  const { loop } = await northlineCycleWithApex(owner);

  const row = bookableApexRow(loop.loopId, owner);
  const negotiationId = await agreeOn(row, owner);
  const policy = writeCarrierPolicy("hard_block", "They short-paid two invoices.");
  assert.equal(canBook(negotiationId, owner).ok, false);

  grantBrokerPolicyExceptionSync(owner, {
    policyId: policy.policyId,
    reason: "They paid the arrears this morning and this is our own customer's freight.",
    expiresAt: new Date(Date.now() + 4 * 3_600_000).toISOString(),
    negotiationId,
    listingId: row.listing.listingId,
  });

  const verdict = canBook(negotiationId, owner);
  assert.equal(verdict.ok, true, JSON.stringify(verdict.blocks));
  const booked = await bookNegotiation(negotiationId, owner);
  assert.equal(booked.status, "ok");

  // Search is unmoved: the policy still stands, and every OTHER Apex load is
  // still off the board. An exception lets one booking through; it does not
  // put the broker back on the market.
  const others = apexRows(rowsFor(loop.loopId, owner)).filter(
    (r) => r.match.status !== "booked" && r.match.status !== "closed_listing_gone",
  );
  for (const other of others) {
    assert.equal(other.match.brokerPolicy?.effect, "blocked");
    assert.equal(other.match.status, "ineligible");
  }
});

/* ========================================================================== */
/* 7 (at booking). A dispatch organization cannot book through a carrier block */
/* ========================================================================== */

/** A Baxter truck Meridian actually dispatches, with Apex freight on it. */
async function meridianCycleWithApex(ctx: MtLoopContext) {
  syncMtLoops(ctx);
  const board = await buildMtLoopBoard(ctx);
  const granted = new Set(
    dispatchGrantsByCarrier(BAXTER)
      .filter((g) => g.dispatchOrganizationId === ctx.organizationId)
      .map((g) => g.truckId),
  );
  for (const loop of board.loops) {
    if (!granted.has(loop.truckId)) continue;
    if (loop.blockReason || loop.loadId) continue;
    await startSearch(loop.loopId, ctx);
    const rows = apexRows(rowsFor(loop.loopId, ctx));
    if (rows.length > 0) return { loop, rows };
  }
  throw new Error("the sample market posted no Apex freight to a granted Baxter truck");
}

test("7c · a carrier's hard block stops the dispatch organization booking, whatever it thinks", async () => {
  resetPolicyWorld();
  const dispatcher = policyContextFor(MERIDIAN_DISPATCHER);
  const { loop } = await meridianCycleWithApex(dispatcher);

  // Baxter, the carrier, refuses this broker.
  writeCarrierPolicy(
    "hard_block",
    "Their remit-to address changed mid-load and we lost a settlement.",
    BAXTER,
    BAXTER_OWNER,
  );

  const rows = apexRows(rowsFor(loop.loopId, dispatcher));
  for (const row of rows) {
    assert.equal(row.match.brokerPolicy?.effect, "blocked");
    assert.equal(row.match.status, "ineligible");
    // The dispatcher is told WHOSE decision this is, and why, because they are
    // the party being told not to book.
    const check = row.match.checks.find((c) => c.key === "broker_policy");
    assert.match(check!.detail, /Blocked by Baxter Transit \(carrier policy\)/);
  }

  // The dispatch company writing its own policy cannot loosen the carrier's.
  const nadia = policyContextFor(MERIDIAN_OWNER);
  proposeBrokerPolicySync(nadia, {
    scope: "dispatch_organization",
    brokerPartyId: brokerPartyByMc(APEX_MC).partyId,
    action: "warning",
    reason: "carrier_preference",
    explanation: "We are happy to work them.",
  });
  const after = apexRows(rowsFor(loop.loopId, dispatcher));
  for (const row of after) {
    assert.equal(
      row.match.brokerPolicy?.effect, "blocked",
      "the carrier's block still wins",
    );
  }

  // And a conversation cannot be opened against it at all: a broker is not the
  // person who can lift their customer's block.
  const row = rows[0];
  const opened = await openNegotiation(row.match.matchId, dispatcher);
  assert.notEqual(opened.status, "ok");
});

/* ========================================================================== */
/* The outer MT Loop shows a compact blocker, and only when one is real       */
/* ========================================================================== */

test("· the outer MT Loop stays quiet until an Opportunity is actually stopped", async () => {
  resetPolicyWorld();
  const owner = policyContextFor(NORTHLINE_OWNER);
  const { loop } = await northlineCycleWithApex(owner);

  // A block exists and blocked loads are simply not offered. Nobody is working
  // one, so the board says nothing about brokers at all.
  writeCarrierPolicy("hard_block", "They short-paid two invoices.");
  let board = await buildMtLoopBoard(owner);
  for (const card of board.loops) {
    assert.notEqual(
      card.progress.key, "broker_policy_blocked",
      `unit ${card.truckUnit} has no broker decision outstanding`,
    );
  }

  // Now somebody short-lists one of those loads, so there IS an Opportunity a
  // policy is holding up.
  const row = apexRows(rowsFor(loop.loopId, owner))[0];
  const match = allMatches(owner).find((r) => r.match.matchId === row.match.matchId)!.match;
  match.status = "shortlisted";

  board = await buildMtLoopBoard(owner);
  let card = board.loops.find((l) => l.loopId === loop.loopId);
  assert.ok(card);
  assert.equal(card.progress.key, "broker_policy_blocked");
  assert.equal(card.progress.label, "Broker blocked");
  assert.equal(card.progress.note, "owner decision required");

  // ★ ONE ACTION, AND NO DETAIL ★
  assert.equal(card.nextAction?.label, "Review opportunity");
  assert.equal(card.inlineAction, undefined, "nothing opens in place on the board");
  // The private explanation, the evidence and the approval history stay in the
  // Opportunity and in Needs You. None of them is on the card.
  const rendered = JSON.stringify({
    progress: card.progress,
    headline: card.headline,
    headlineDetail: card.headlineDetail,
    nextAction: card.nextAction,
  });
  assert.equal(rendered.includes("short-paid"), false);
  assert.equal(rendered.includes(APEX_NAME), false);

  /*
   * ★ AND IT CLEARS ON THE NEXT READ, WITHOUT ANYBODY OPENING OPPORTUNITIES ★
   * The board asks the canonical record itself rather than trusting what the
   * match was carrying, so an owner revoking the policy is visible here
   * immediately — the same reason booking re-evaluates instead of reading back.
   */
  const policy = brokerPoliciesForTests(NORTHLINE)[0];
  await revokeBrokerPolicy(owner, policy.policyId, "They settled in full.");
  board = await buildMtLoopBoard(owner);
  card = board.loops.find((l) => l.loopId === loop.loopId);
  assert.notEqual(card?.progress.key, "broker_policy_blocked");
});
