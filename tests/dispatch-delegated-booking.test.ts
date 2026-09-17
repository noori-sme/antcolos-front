import test from "node:test";
import assert from "node:assert/strict";
import { loopContextFor, resetPropagationWorld } from "./propagation-harness.ts";
import type { MtLoopContext } from "@/lib/api/mock/mt-loop";
import { buildMtLoopBoard, openLoopsFor, syncMtLoops } from "@/lib/api/mock/mt-loop";
import { startSearch } from "@/lib/api/mock/search-session";
import { allMatches } from "@/lib/api/mock/opportunity-matching";
import {
  acceptOnTheTable, openNegotiation, recordBrokerRound,
} from "@/lib/api/mock/negotiation";
import {
  bookNegotiation, bookingById, bookingsForWorkspace, dispatchWorkReceipts,
  providerBookingLinks,
} from "@/lib/api/mock/booking";
import {
  driverGate, recordDriverDecision, sendOpportunityToDriver,
} from "@/lib/api/mock/driver-review";
import {
  confirmAndSign, progressOf, rateConsFor, receiveRateConfirmation, verifyField,
} from "@/lib/api/mock/rate-confirmation";
import { mockLoadsService } from "@/lib/api/mock/loads";
import { loadTrackingSync } from "@/lib/api/mock/tracking-board";
import {
  addTrackingRecipient, openTrackingSession, resolvePublicTracking,
} from "@/lib/api/mock/tracking-registry";
import { cycleCommunicationsSync } from "@/lib/api/mock/communications";
import { revokeDispatchDelegation } from "@/lib/api/mock/dispatch-revocation";
import {
  dispatchGrantsByCarrier, truckContextFrom,
} from "@/lib/api/mock/truck-registry";
import { mockStore } from "@/lib/api/mock/store";
import { UNARGUABLE_CHECKS } from "@/types";

/**
 * ★ A PROVIDER BOOKS FOR A CARRIER, END TO END ★
 *
 * Every other booking test in this repository drives a SELF-DISPATCHING carrier
 * — `mem_northline_owner` — so none of them crosses an organization boundary.
 * That is the gap this file exists to close, and it is the gap that let three
 * live-grant regressions through review: the load a provider books now lives in
 * the carrier's store, and several surfaces still looked for it in the caller's.
 *
 * Two halves, and both matter:
 *
 *   WHILE THE GRANT IS LIVE   the provider must still be able to work — see the
 *                             load on its own MT Loop, open its tracking, and
 *                             talk to the broker about it.
 *   ONCE IT ENDS              every one of those, and every direct id, must
 *                             refuse. Failing closed is not enough on its own;
 *                             a product that fails closed while the grant is
 *                             live is simply broken.
 */

const PROVIDER = "mem_meridian_dispatcher";
const PROVIDER_ORG = "org_meridian";
const CARRIER_ORG = "org_baxter";

/** Book a load as the provider, on a truck its carrier granted it. */
async function bookAsProvider(ctx: MtLoopContext) {
  syncMtLoops(ctx);
  const board = await buildMtLoopBoard(ctx);

  // A loop for a truck THIS provider dispatches under a Baxter grant.
  const granted = new Set(
    dispatchGrantsByCarrier(CARRIER_ORG)
      .filter((g) => g.dispatchOrganizationId === PROVIDER_ORG)
      .map((g) => g.truckId),
  );
  const loop = board.loops.find(
    (l) => granted.has(l.truckId) && !l.blockReason && (l.trailerUnit || !l.trailerRequired),
  );
  assert.ok(loop, "the fixture gives Meridian at least one workable Baxter truck");
  /*
   * `loop.carrierOrganizationId` is undefined for every Meridian loop in the
   * session fixtures, on `main` as well as here — the carrier registry does not
   * resolve one for this membership. That is a pre-existing fixture weakness and
   * is deliberately NOT asserted: the delegation guard does not read that field.
   * It derives the owning carrier from the canonical records through A6's
   * `operatingContextAt`, which is the whole point, and the assertions below are
   * on what it produced.
   */

  await startSearch(loop.loopId, ctx);
  const rows = allMatches(ctx).filter((r) => r.match.dispatchCycleId === loop.loopId);
  assert.ok(rows.length > 0, "the search found candidate loads");

  // A match no conversation could rescue cannot be opened at all — see
  // `UNARGUABLE_CHECKS`. Pick one that is actually bookable rather than the
  // first row, which in this fixture needs a dry van on a cargo van.
  const row = rows.find(
    (r) => !r.match.checks.some(
      (c) => c.outcome === "fail" && UNARGUABLE_CHECKS.includes(c.key),
    ),
  );
  assert.ok(row, "at least one match passes every unarguable check");

  const gate = driverGate(row.match.matchId, ctx);
  if (!gate.clear && gate.hasDriver) {
    const sent = await sendOpportunityToDriver(row.match.matchId, ctx);
    const review = sent.status === "ok" || sent.status === "already_sent" ? sent.review : undefined;
    assert.ok(review);
    await recordDriverDecision(review.reviewId, "approved", ctx);
  }

  const opened = await openNegotiation(row.match.matchId, ctx);
  assert.equal(opened.status, "ok");
  const negotiationId = opened.status === "ok" ? opened.negotiation.negotiationId : "";
  await recordBrokerRound(negotiationId, {
    kind: "counter",
    amountCents: row.listing.postedRateCents,
    note: "Best we can do.",
  }, ctx);
  assert.equal((await acceptOnTheTable(negotiationId, ctx)).status, "ok");

  const booked = await bookNegotiation(negotiationId, ctx);
  assert.equal(booked.status, "ok", JSON.stringify(booked));
  const booking = booked.status === "ok" ? booked.booking : undefined;
  assert.ok(booking);
  return { loop, booking, load: booked.status === "ok" ? booked.load : undefined };
}

/* -------------------------------------------------------------------------- */

test("the carrier owns what its provider booked", async () => {
  resetPropagationWorld();
  const ctx = loopContextFor(PROVIDER);
  const { booking, load } = await bookAsProvider(ctx);

  // ★ ONE canonical load and booking, in the CARRIER's organization. ★
  assert.equal(booking.organizationId, CARRIER_ORG);
  assert.equal(booking.pinnedCarrierOrganizationId, CARRIER_ORG);
  assert.equal(booking.dispatchedByOrganizationId, PROVIDER_ORG);
  assert.ok(load);
  assert.equal(load.organizationId, CARRIER_ORG);
  assert.equal(load.pinnedCarrierOrganizationId, CARRIER_ORG);

  // Nothing was written into the provider's own load store.
  const providerLoads = mockStore.org(PROVIDER_ORG).loads.filter((l) => l.id === load.id);
  assert.equal(providerLoads.length, 0, "no shadow load in the provider's store");

  // Exactly one load with that id anywhere.
  const everywhere = [CARRIER_ORG, PROVIDER_ORG]
    .flatMap((o) => mockStore.org(o).loads)
    .filter((l) => l.id === load.id);
  assert.equal(everywhere.length, 1);
});

test("while the grant is live the provider can actually work the load", async () => {
  resetPropagationWorld();
  const ctx = loopContextFor(PROVIDER);
  const { loop, booking, load } = await bookAsProvider(ctx);
  assert.ok(load);

  // The booking reads back through the provider's own service calls.
  assert.ok(bookingById(booking.bookingId, ctx), "bookingById reaches it");
  assert.ok(
    bookingsForWorkspace(ctx).some((b) => b.bookingId === booking.bookingId),
    "it appears in the provider's list",
  );

  // The canonical load reads back through the loads service.
  const got = await mockLoadsService.get(ctx, load.id);
  assert.equal(got.id, load.id);
  assert.equal(got.organizationId, CARRIER_ORG);

  // ★ REGRESSION GUARD 1 — the provider's own MT Loop shows the load. ★
  syncMtLoops(ctx);
  const board = await buildMtLoopBoard(ctx);
  const card = board.loops.find((l) => l.loopId === loop.loopId);
  assert.ok(card, "the cycle is still on the provider's board");
  assert.equal(card.loadReference, load.reference, "the card names the booked load");

  /*
   * ★ THE REAL REGRESSION GUARD ★
   * The live cycle, not the card. Before `syncMtLoops` looked the load up
   * through REACH it searched the caller's own store, found nothing for a
   * delegated load, and took the other branch: it cleared `loadId`, recorded
   * "The load came off this truck", and dropped the cycle out of `covered` —
   * putting a truck that had just been booked back out as available.
   */
  const live = openLoopsFor(ctx).find((l) => l.loopId === loop.loopId);
  assert.ok(live, "the cycle is still open in the provider's workspace");
  assert.equal(live.loadId, load.id, "the cycle still holds the load it booked");
  assert.equal(live.status, "covered", "and is still covered");
  assert.equal(
    live.history.some((e) => e.action === "load_released"), false,
    "no spurious 'the load came off this truck'",
  );

  // ★ REGRESSION GUARD 2 — the provider can open tracking for it. ★
  const tracking = loadTrackingSync(ctx, load.id);
  assert.ok(tracking, "the provider can open tracking for the load it booked");

  // ★ REGRESSION GUARD 3 — broker outreach knows the load. ★
  const comms = cycleCommunicationsSync(loop.loopId, ctx);
  assert.ok(comms, "the outreach thread resolves");
});

test("the carrier discovers and can finalize what its provider prepared", async () => {
  resetPropagationWorld();
  const provider = loopContextFor(PROVIDER);
  const { booking } = await bookAsProvider(provider);

  // The provider prepares the rate confirmation. That much it may do.
  const received = await receiveRateConfirmation(booking.bookingId, provider);
  assert.ok(
    received.status === "ok" || received.status === "already_open",
    `provider may prepare: ${received.status}`,
  );

  // The carrier sees the booking natively, with no grant of its own needed.
  const carrier = loopContextFor("mem_baxter_owner");
  assert.ok(
    bookingsForWorkspace(carrier).some((b) => b.bookingId === booking.bookingId),
    "the carrier sees its own booking",
  );
});

/* -------------------------------------------------------------------------- */

test("revocation closes every provider path to the carrier's records", async () => {
  resetPropagationWorld();
  const provider = loopContextFor(PROVIDER);
  const { loop, booking, load } = await bookAsProvider(provider);
  assert.ok(load);

  // Keep the ids the way a former provider would: in hand.
  const loadId = load.id;
  const bookingId = booking.bookingId;

  const carrier = loopContextFor("mem_baxter_owner");
  for (const grant of dispatchGrantsByCarrier(CARRIER_ORG)) {
    if (grant.dispatchOrganizationId !== PROVIDER_ORG) continue;
    await revokeDispatchDelegation(grant.id, "Back in house.", truckContextFrom(carrier));
  }

  /* ---- Direct id, every service ---------------------------------------- */
  await assert.rejects(
    () => mockLoadsService.get(provider, loadId),
    /not found/i,
    "loads.get by retained id",
  );
  await assert.rejects(
    () => mockLoadsService.events(provider, loadId),
    /not found/i,
    "loads.events by retained id",
  );
  await assert.rejects(
    () => mockLoadsService.documents(provider, loadId),
    /not found/i,
    "loads.documents by retained id",
  );
  assert.equal(bookingById(bookingId, provider), undefined, "bookingById by retained id");
  assert.equal(loadTrackingSync(provider, loadId), undefined, "tracking by retained id");

  /* ---- Lists ------------------------------------------------------------ */
  const list = await mockLoadsService.list(provider, { view: "all" }, undefined, { limit: 500 });
  assert.equal(
    list.items.some((l) => l.id === loadId), false,
    "the load is gone from the provider's list",
  );
  assert.equal(
    bookingsForWorkspace(provider).some((b) => b.bookingId === bookingId), false,
    "the booking is gone from the provider's list",
  );

  /* ---- The board ------------------------------------------------------- */
  syncMtLoops(provider);
  const board = await buildMtLoopBoard(provider);
  assert.equal(
    board.loops.some((l) => l.loopId === loop.loopId), false,
    "the cycle has gone home to the carrier",
  );

  /* ---- The carrier keeps everything ------------------------------------ */
  const kept = await mockLoadsService.get(carrier, loadId);
  assert.equal(kept.id, loadId);
  assert.equal(kept.organizationId, CARRIER_ORG);
  assert.ok(bookingById(bookingId, carrier), "the carrier still has its booking");
});

test("what the former provider keeps is the bounded receipt and its own market work", async () => {
  resetPropagationWorld();
  const provider = loopContextFor(PROVIDER);
  const { booking } = await bookAsProvider(provider);

  const carrier = loopContextFor("mem_baxter_owner");
  for (const grant of dispatchGrantsByCarrier(CARRIER_ORG)) {
    if (grant.dispatchOrganizationId !== PROVIDER_ORG) continue;
    await revokeDispatchDelegation(grant.id, "Back in house.", truckContextFrom(carrier));
  }

  const receipts = dispatchWorkReceipts(provider);
  const mine = receipts.find((r) => r.loadReference === booking.loadReference);
  assert.ok(mine, "a receipt was sealed for the work it finished");

  // ★ EXACTLY these fields, and no handle on anything. ★
  assert.deepEqual(
    Object.keys(mine).sort(),
    ["accessEndedAt", "basis", "bookedAt", "loadReference", "note", "statusAtAccessEnd"].sort(),
  );
  assert.equal("loadId" in mine, false);
  assert.equal("truckId" in mine, false);
  assert.equal("agreedRateCents" in mine, false);
  assert.equal("brokerName" in mine, false);
  assert.equal("driverName" in mine, false);

  // Its own market work survives, and resolves to nothing carrier-side.
  const link = providerBookingLinks(provider).find((l) => l.bookingId === booking.bookingId);
  assert.ok(link, "the provider keeps its own negotiation and listing ids");
  assert.equal(link.organizationId, PROVIDER_ORG);
  assert.equal(bookingById(link.bookingId, provider), undefined,
    "and the foreign key resolves to nothing");
});

test("the sealed receipt does not move when the carrier works on afterwards", async () => {
  resetPropagationWorld();
  const provider = loopContextFor(PROVIDER);
  const { booking, load } = await bookAsProvider(provider);
  assert.ok(load);

  const carrier = loopContextFor("mem_baxter_owner");
  for (const grant of dispatchGrantsByCarrier(CARRIER_ORG)) {
    if (grant.dispatchOrganizationId !== PROVIDER_ORG) continue;
    await revokeDispatchDelegation(grant.id, "Back in house.", truckContextFrom(carrier));
  }

  const before = dispatchWorkReceipts(provider)
    .find((r) => r.loadReference === booking.loadReference);
  assert.ok(before);
  const snapshot = JSON.stringify(before);

  // The carrier advances its load. Nothing about that may reach the receipt.
  const canonical = mockStore.org(CARRIER_ORG).loads.find((l) => l.id === load.id);
  assert.ok(canonical);
  canonical.status = "delivered";
  canonical.updatedAt = new Date().toISOString();

  const after = dispatchWorkReceipts(provider)
    .find((r) => r.loadReference === booking.loadReference);
  assert.equal(JSON.stringify(after), snapshot, "the receipt is frozen");
});

/* -------------------------------------------------------------------------- */

/**
 * ★ ONLY THE CARRIER SIGNS ★
 *
 * `applyRateConfirmation` on the loads service is not the path that signs. The
 * act that puts a carrier's signature on a broker's document and publishes
 * `load.finalized` is `confirmAndSign`, in the rate-confirmation module, and it
 * reaches the canonical Load through its own commit. Guarding only the loads
 * service would leave the real door open — so this asserts the real door.
 *
 * A6 is explicit for this event: `crossOrganizationWrite: null`, and "no
 * canonical grant lets one organization finalize another's load".
 */
test("a provider may prepare a rate confirmation but never sign it", async () => {
  resetPropagationWorld();
  const provider = loopContextFor(PROVIDER);
  const { booking } = await bookAsProvider(provider);

  const received = await receiveRateConfirmation(booking.bookingId, provider);
  const workflow = received.status === "ok" || received.status === "already_open"
    ? received.workflow
    : undefined;
  assert.ok(workflow, `provider may prepare: ${received.status}`);
  assert.equal(workflow.carrierOrganizationId, CARRIER_ORG);

  // Get it genuinely ready to sign, so the refusal below can only be about
  // AUTHORITY. Checking fields needs `rates:view`, which this provider
  // membership does not hold, so the carrier does that part here.
  const carrier = loopContextFor("mem_baxter_owner");
  for (const field of workflow.fields) {
    await verifyField(workflow.rateConId, field.key, carrier);
  }
  assert.equal(progressOf(workflow).canConfirm, true, "it is ready to sign");

  // ★ And is refused the signature itself. ★
  const attempt = await confirmAndSign(workflow.rateConId, provider);
  assert.equal(
    attempt.status === "ok", false,
    "a dispatch provider must not publish load.finalized for a carrier",
  );
  assert.equal(workflow.status !== "returned", true, "nothing was signed");
});

test("the carrier signs what its provider prepared", async () => {
  resetPropagationWorld();
  const provider = loopContextFor(PROVIDER);
  const { booking } = await bookAsProvider(provider);

  const received = await receiveRateConfirmation(booking.bookingId, provider);
  const workflow = received.status === "ok" || received.status === "already_open"
    ? received.workflow
    : undefined;
  assert.ok(workflow);
  // The carrier finds it in its own workspace and signs under its own authority.
  const carrier = loopContextFor("mem_baxter_owner");
  for (const field of workflow.fields) {
    await verifyField(workflow.rateConId, field.key, carrier);
  }

  const mine = rateConsFor(carrier).find((w) => w.rateConId === workflow.rateConId);
  assert.ok(mine, "the carrier can see the confirmation waiting for it");

  const signed = await confirmAndSign(workflow.rateConId, carrier);
  assert.equal(signed.status, "ok", JSON.stringify(signed));
  assert.equal(workflow.status, "returned");
});

/* -------------------------------------------------------------------------- */

/**
 * ★ A PUBLIC LINK DIES WITH ITS ISSUER, NOT WITH THE SESSION ★
 *
 * The session belongs to the carrier, because the load does and tracking is
 * part of that load's history. The carrier keeps the truck forever — so asking
 * "does this session's organization still have the truck?" would answer yes for
 * every link on it, and a broker link a former provider minted would keep
 * serving the carrier's live position to a third party indefinitely.
 *
 * The question has to be asked of whoever minted each link. That is what
 * `TrackingRecipient.issuedByOrganizationId` is for, and this is the proof.
 */
test("a provider's broker link dies on revocation; the carrier's own survives", async () => {
  resetPropagationWorld();
  const provider = loopContextFor(PROVIDER);
  const { load } = await bookAsProvider(provider);
  assert.ok(load);

  // The provider opens tracking on the carrier's load and mints a broker link.
  const session = await openTrackingSession(provider, { loadId: load.id });
  assert.equal(session.organizationId, CARRIER_ORG, "the session is the carrier's");

  const providerLink = await addTrackingRecipient(provider, {
    sessionId: session.id,
    audience: "broker",
    partyName: "Broker the provider is talking to",
  });

  // The carrier mints one of its own on the SAME session.
  const carrier = loopContextFor("mem_baxter_owner");
  const carrierLink = await addTrackingRecipient(carrier, {
    sessionId: session.id,
    audience: "broker",
    partyName: "Broker the carrier is talking to",
  });

  assert.equal(providerLink.issuedByOrganizationId, PROVIDER_ORG);
  assert.equal(carrierLink.issuedByOrganizationId, CARRIER_ORG);

  const snapshot = () => ({});
  assert.equal(
    resolvePublicTracking(providerLink.link.token, snapshot).ok, true,
    "the provider's link works while its grant is live",
  );

  /* ---- The carrier ends the arrangement -------------------------------- */
  for (const grant of dispatchGrantsByCarrier(CARRIER_ORG)) {
    if (grant.dispatchOrganizationId !== PROVIDER_ORG) continue;
    await revokeDispatchDelegation(grant.id, "Back in house.", truckContextFrom(carrier));
  }

  const afterProvider = resolvePublicTracking(providerLink.link.token, snapshot);
  assert.equal(afterProvider.ok, false, "the former provider's link is refused");
  assert.equal(
    afterProvider.ok === false ? afterProvider.refusal : undefined,
    "relationship_ended",
    "and says why, rather than pretending the link never existed",
  );

  // ★ The carrier's own link on the same session is untouched. ★
  assert.equal(
    resolvePublicTracking(carrierLink.link.token, snapshot).ok, true,
    "one issuer's grant ending must not close another organization's link",
  );
});
