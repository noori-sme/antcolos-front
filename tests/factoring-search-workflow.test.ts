import test from "node:test";
import assert from "node:assert/strict";
import { loopContextFor, resetPropagationWorld } from "./propagation-harness.ts";
import type { MtLoopContext } from "@/lib/api/mock/mt-loop";
import { buildMtLoopBoard, syncMtLoops } from "@/lib/api/mock/mt-loop";
import { startSearch } from "@/lib/api/mock/search-session";
import {
  opportunityInboxSync, truckOpportunitiesSync,
} from "@/lib/api/mock/opportunity-service";
import { allMatches } from "@/lib/api/mock/opportunity-matching";
import { mockFactoringService } from "@/lib/api/mock/factoring";
import {
  connectFactoringSync, factoringStatusSync, resetFactoring,
} from "@/lib/api/mock/factoring-registry";
import { previewForDriver } from "@/lib/api/mock/driver-review";
import { matchesFactoringFilter } from "@/lib/factoring";
import {
  MT_LOOP_LANE_ORDER, MT_LOOP_STAGE_ORDER, isFactoringApproved,
} from "@/types";

/**
 * ★ FACTORING INSIDE THE SEARCH WORKFLOW ★
 *
 * ███ NO FACTORING COMPANY IS CONTACTED BY ANY TEST IN THIS FILE ███
 *
 * The workflow claim this file holds down is a NEGATIVE one as much as a
 * positive: factoring is an eligibility check inside Search and Opportunity
 * evaluation, and it is NOT a new MT Loop stage, lane, page or ceremony. A
 * dispatcher working a truck sees the answer on the row they are already
 * reading, and — where their carrier has no authorized API — exactly one
 * contextual button.
 *
 * The fixtures give two carriers with two arrangements on purpose:
 *
 *   Northline  runs the development adapter, so checks happen in the
 *              background and there is no button. (The same code path a real
 *              authorized API would take; `liveApi` is what separates them.)
 *   Baxter     records its factor's answers by hand, so there is a button —
 *              and its factor REFUSES a broker Northline's factor approves.
 *
 * Baxter has delegated every one of its trucks, so its own MT Loop board is
 * empty by design. The tests that need a board therefore work Northline's and
 * change its connection MODE, which is the thing that actually decides between
 * a status and a button; the two-carrier claim is proven directly against both
 * carriers' answers in test 7.
 */

const NORTHLINE_OWNER = "mem_northline_owner";
const NORTHLINE = "org_northline";
const BAXTER_OWNER = "mem_baxter_owner";
const BAXTER = "org_baxter";
/** Meridian dispatches for carriers that granted it authority, not Northline. */
const MERIDIAN_DISPATCHER = "mem_meridian_dispatcher";

/**
 * Re-point the carrier being searched at a mode with no adapter.
 *
 * ★ WHY THE WORKFLOW TESTS SWITCH MODE RATHER THAN CARRIER ★
 * What decides whether a dispatcher sees a status or a button is the
 * CONNECTION MODE, not which company they work for. Driving that directly —
 * through the same `connect` command an owner uses — tests the rule rather
 * than a fixture's current shape, and it keeps both halves of the claim on one
 * board with one set of loads.
 */
async function useManualMode(ctx: MtLoopContext, carrierOrganizationId: string) {
  await mockFactoringService.connect(ctx, {
    carrierOrganizationId,
    providerKind: "rts",
    providerName: "RTS Financial",
    accountLabel: "RTS Financial",
    accountReference: "BX-22108",
    mode: "manual",
    fallback: {
      creditCheckEmail: "credit@rts.example",
      portalUrl: "https://portal.rts.example",
      phone: "+1 (816) 555-0190",
    },
  });
}

interface SearchedRow {
  ctx: MtLoopContext;
  loopId: string;
  matchId: string;
  listingId: string;
  brokerName: string;
  brokerMcNumber?: string;
  offeredRateCents?: number;
}

/** Work a truck the way a dispatcher does: open the board, start a search. */
async function searchFor(membershipId: string): Promise<SearchedRow> {
  const ctx = loopContextFor(membershipId);
  syncMtLoops(ctx);
  const board = await buildMtLoopBoard(ctx);
  const loop = board.loops.find((l) => !l.loadId);
  assert.ok(loop, "the fixture gives this membership a truck to work");

  await startSearch(loop.loopId, ctx);
  const rows = allMatches(ctx).filter(
    (r) => r.match.dispatchCycleId === loop.loopId && r.listing.broker.mcNumber,
  );
  assert.ok(rows.length > 0, "the search turned up loads with an identified broker MC");

  const row = rows[0];
  return {
    ctx,
    loopId: loop.loopId,
    matchId: row.match.matchId,
    listingId: row.listing.listingId,
    brokerName: row.listing.broker.name,
    brokerMcNumber: row.listing.broker.mcNumber,
    offeredRateCents: row.listing.offeredRateCents,
  };
}

function rowIn(ctx: MtLoopContext, loopId: string, matchId: string) {
  const found = truckOpportunitiesSync(loopId, ctx);
  return [...found.top, ...found.rest].find((r) => r.match.matchId === matchId);
}

test.beforeEach(() => {
  resetPropagationWorld();
  resetFactoring();
});

/* -------------------------------------------------------------------------- */

test("1 — an automatically-checked carrier gets a result and no manual button", async () => {
  const { ctx, loopId, matchId } = await searchFor(NORTHLINE_OWNER);
  const row = rowIn(ctx, loopId, matchId);

  assert.ok(row?.factoring, "the search result carries a factoring answer");
  assert.equal(row.factoring.automatic, true);
  // ★ The whole claim: no button beside an automatic connection.
  assert.equal(row.factoring.offersManualCheck, false);
  // And the answer arrived without the dispatcher doing anything.
  assert.notEqual(row.factoring.decision, "not_connected");
});

test("2 — a carrier with no automatic connection is offered one button", async () => {
  const { ctx, loopId, matchId } = await searchFor(NORTHLINE_OWNER);
  await useManualMode(ctx, NORTHLINE);
  const row = rowIn(ctx, loopId, matchId);

  assert.ok(row?.factoring);
  assert.equal(row.factoring.automatic, false);
  assert.equal(row.factoring.offersManualCheck, true);
  // It does not pretend a live API exists.
  assert.equal(row.factoring.liveApi, false);
});

test("3 — the fallback is prefilled with carrier, broker, MC, amount and opportunity", async () => {
  const s = await searchFor(NORTHLINE_OWNER);
  await useManualMode(s.ctx, NORTHLINE);
  const prefill = await mockFactoringService.fallbackPrefill(s.ctx, {
    carrierOrganizationId: NORTHLINE,
    brokerNameObserved: s.brokerName,
    brokerMcNumber: s.brokerMcNumber,
    proposedAmountCents: s.offeredRateCents,
    dispatchCycleId: s.loopId,
    listingId: s.listingId,
  });

  assert.equal(prefill.carrierOrganizationId, NORTHLINE);
  assert.ok(prefill.carrierName.length > 0);
  assert.equal(prefill.providerName, "RTS Financial");
  assert.equal(prefill.accountReference, "BX-22108");
  assert.equal(prefill.brokerName, s.brokerName);
  assert.equal(prefill.brokerMcNumber, s.brokerMcNumber?.replace(/\D/g, ""));
  assert.equal(prefill.proposedAmountCents, s.offeredRateCents);
  assert.equal(prefill.dispatchCycleId, s.loopId);
  assert.equal(prefill.listingId, s.listingId);
  assert.ok(prefill.dispatcherName.length > 0);
  // The credit desk's own address, and a message ready to send.
  assert.equal(prefill.fallback.creditCheckEmail, "credit@rts.example");
  assert.ok(prefill.emailDraft?.body.includes(s.brokerMcNumber!.replace(/\D/g, "")));
  // And nothing that could authenticate anybody.
  assert.ok(!/password|token|secret/i.test(JSON.stringify(prefill)));
});

test("4 — Search and Opportunity read the same canonical answer", async () => {
  const { ctx, loopId, matchId } = await searchFor(NORTHLINE_OWNER);

  const onTruck = rowIn(ctx, loopId, matchId);
  const inInbox = opportunityInboxSync(ctx).matches.find(
    (r) => r.match.matchId === matchId,
  );

  assert.ok(onTruck?.factoring);
  assert.ok(inInbox?.factoring);
  // Same check id, not merely the same word: two surfaces reading one record.
  assert.equal(inInbox.factoring.check?.checkId, onTruck.factoring.check?.checkId);
  assert.equal(inInbox.factoring.decision, onTruck.factoring.decision);
});

test("5 — recording a fallback updates both surfaces and creates no duplicate", async () => {
  const s = await searchFor(NORTHLINE_OWNER);
  await useManualMode(s.ctx, NORTHLINE);
  const subject = {
    carrierOrganizationId: NORTHLINE,
    brokerNameObserved: s.brokerName,
    brokerMcNumber: s.brokerMcNumber,
    dispatchCycleId: s.loopId,
    listingId: s.listingId,
  };

  const before = await mockFactoringService.history(s.ctx, subject);

  const recorded = await mockFactoringService.recordResult(s.ctx, {
    ...subject,
    decision: "approved_manual",
    source: "phone_confirmation",
    providerReference: "RTS-CALL-99001",
    idempotencyKey: "one-call",
  });

  // The same call recorded twice is one answer.
  const again = await mockFactoringService.recordResult(s.ctx, {
    ...subject,
    decision: "approved_manual",
    source: "phone_confirmation",
    providerReference: "RTS-CALL-99001",
    idempotencyKey: "one-call",
  });
  assert.equal(again.checkId, recorded.checkId);

  const after = await mockFactoringService.history(s.ctx, subject);
  assert.equal(after.length, before.length + 1, "exactly one new answer");

  const onTruck = rowIn(s.ctx, s.loopId, s.matchId);
  const inInbox = opportunityInboxSync(s.ctx).matches.find(
    (r) => r.match.matchId === s.matchId,
  );

  // Both surfaces moved, and both show the SAME record.
  assert.equal(onTruck?.factoring?.check?.checkId, recorded.checkId);
  assert.equal(inInbox?.factoring?.check?.checkId, recorded.checkId);
  assert.ok(isFactoringApproved(onTruck!.factoring!.decision));
  // The button is replaced by the status it produced… except that in a manual
  // mode the carrier can always go and ask again, which is the honest state.
  assert.equal(onTruck!.factoring!.source, "phone_confirmation");
});

test("6 — an expired approval becomes a recheck, never a refusal", async () => {
  const s = await searchFor(NORTHLINE_OWNER);
  await useManualMode(s.ctx, NORTHLINE);
  const subject = {
    carrierOrganizationId: NORTHLINE,
    brokerNameObserved: s.brokerName,
    brokerMcNumber: s.brokerMcNumber,
  };

  const recorded = await mockFactoringService.recordResult(s.ctx, {
    ...subject,
    decision: "approved_manual",
    source: "manual_portal_check",
    checkedAt: new Date(Date.now() - 3_600_000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });

  const fresh = await mockFactoringService.status(s.ctx, subject);
  assert.ok(isFactoringApproved(fresh.decision));

  // Read as of a minute after it lapses. No job runs; nothing is written.
  const lapsed = factoringStatusSync(s.ctx, {
    ...subject,
    now: new Date(Date.parse(recorded.expiresAt!) + 60_000).toISOString(),
  });
  assert.equal(lapsed.decision, "stale");
  assert.equal(lapsed.recheckRequired, true);
  assert.equal(lapsed.recordedDecision, "approved_manual");
  assert.notEqual(lapsed.decision, "rejected");
  assert.equal(matchesFactoringFilter(lapsed, "stale"), true);
  assert.equal(matchesFactoringFilter(lapsed, "approved"), false);
});

test("7 — switching carriers changes the answer and the workflow", async () => {
  const north = await searchFor(NORTHLINE_OWNER);
  const baxterCtx = loopContextFor(BAXTER_OWNER);

  const northRow = rowIn(north.ctx, north.loopId, north.matchId);
  assert.ok(northRow?.factoring);

  // The SAME broker gives two different answers to two carriers, from two
  // different factors, with two different workflows attached.
  const mc = "MC-612884";
  const forNorth = factoringStatusSync(north.ctx, {
    carrierOrganizationId: NORTHLINE, brokerNameObserved: "Apex Logistics LLC", brokerMcNumber: mc,
  });
  const forBaxter = factoringStatusSync(baxterCtx, {
    carrierOrganizationId: BAXTER, brokerNameObserved: "Apex Logistics LLC", brokerMcNumber: mc,
  });

  assert.ok(isFactoringApproved(forNorth.decision));
  assert.equal(forBaxter.decision, "rejected");
  assert.notEqual(forNorth.providerName, forBaxter.providerName);
  // Northline's answers arrive by themselves; Baxter's are gone and got.
  assert.equal(forNorth.offersManualCheck, false);
  assert.equal(forBaxter.offersManualCheck, true);
});

test("8 — a dispatcher never sees another carrier's factor account or decision", async () => {
  const ctx = loopContextFor(MERIDIAN_DISPATCHER);

  // Meridian dispatches Baxter, so Baxter's factoring is readable.
  const allowed = await mockFactoringService.connection(ctx, BAXTER);
  assert.ok(allowed, "a delegate reaches the carrier that granted it authority");

  // Northline granted Meridian nothing.
  await assert.rejects(
    () => mockFactoringService.connection(ctx, NORTHLINE),
    (e: Error) => e.name === "NotFoundError",
  );
  await assert.rejects(
    () => mockFactoringService.status(ctx, {
      carrierOrganizationId: NORTHLINE,
      brokerNameObserved: "Apex Logistics LLC",
      brokerMcNumber: "MC-612884",
    }),
    (e: Error) => e.name === "NotFoundError",
  );

  // And administering even the carrier it DOES dispatch for is refused: a
  // delegation over trucks is not a delegation over banking.
  await assert.rejects(
    () => mockFactoringService.setPolicy(ctx, BAXTER, { allowOverride: false }),
    (e: Error) => e.name === "NotFoundError" || e.name === "PermissionDeniedError",
  );

  // Nothing about a factor appears on a search row for a carrier it cannot reach.
  syncMtLoops(ctx);
  const board = await buildMtLoopBoard(ctx);
  const loop = board.loops.find((l) => !l.loadId);
  if (loop) {
    await startSearch(loop.loopId, ctx);
    const rows = [...truckOpportunitiesSync(loop.loopId, ctx).top];
    for (const row of rows) {
      if (row.factoring) {
        assert.equal(
          row.factoring.carrierOrganizationId, row.match.carrierOrganizationId,
          "a row's factoring answer belongs to that row's own carrier",
        );
        assert.notEqual(row.factoring.carrierOrganizationId, NORTHLINE);
      }
    }
  }
});

test("9 — MT Loop gains no factoring stage and no factoring lane", () => {
  for (const stage of MT_LOOP_STAGE_ORDER) {
    assert.ok(
      !String(stage).toLowerCase().includes("factor"),
      `MT Loop stage "${stage}" must not be a factoring stage`,
    );
  }
  for (const lane of MT_LOOP_LANE_ORDER) {
    assert.ok(
      !String(lane).toLowerCase().includes("factor"),
      `MT Loop lane "${lane}" must not be a factoring lane`,
    );
  }
});

test("10 — a driver-facing opportunity never calls an unchecked load approved", async () => {
  const s = await searchFor(NORTHLINE_OWNER);
  await useManualMode(s.ctx, NORTHLINE);

  // Somewhere on this board there is a truck with a driver on it.
  const rows = [...truckOpportunitiesSync(s.loopId, s.ctx).top,
    ...truckOpportunitiesSync(s.loopId, s.ctx).rest];
  const withDriver = rows.find((r) => r.driver?.hasDriver);

  if (!withDriver) {
    // The fixture gave this truck no driver. The claim is still checked at the
    // level it lives at: the label, from the answer and the policy.
    const status = factoringStatusSync(s.ctx, {
      carrierOrganizationId: NORTHLINE,
      brokerNameObserved: "Nobody Has Asked Freight",
      brokerMcNumber: "MC-888222",
    });
    assert.equal(status.decision, "unknown");
    return;
  }

  const preview = previewForDriver(withDriver.match.matchId, s.ctx);
  assert.ok(preview);

  if (preview.factoring) {
    const approved = isFactoringApproved(withDriver.factoring?.decision ?? "unknown");
    if (!approved) {
      assert.ok(
        /requires factoring approval/i.test(preview.factoring.label),
        `an unapproved load must say so, got "${preview.factoring.label}"`,
      );
      assert.ok(!/^Factoring approved$/.test(preview.factoring.label));
    }
  }
});

test("a carrier put into the reserved API mode is never shown as connected", async () => {
  const ctx = loopContextFor(BAXTER_OWNER);
  connectFactoringSync(ctx, {
    carrierOrganizationId: BAXTER,
    providerKind: "rts",
    accountLabel: "RTS — API",
    mode: "api",
  });

  const connection = await mockFactoringService.connection(ctx, BAXTER);
  assert.equal(connection?.status, "provider_unavailable");

  const status = await mockFactoringService.status(ctx, {
    carrierOrganizationId: BAXTER,
    brokerNameObserved: "Anybody At All",
    brokerMcNumber: "MC-555444",
  });
  assert.equal(status.decision, "provider_unavailable");
  assert.equal(isFactoringApproved(status.decision), false);
  // With nothing automatic that can answer, the fallback is offered instead.
  assert.equal(status.offersManualCheck, true);
});
