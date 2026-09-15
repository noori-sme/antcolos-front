import { beforeEach, describe, expect, it } from "vitest";
import {
  answerCarrierEscalation, assignLoop, buildMtLoopBoard, escalateLoopToCarrier,
  openLoopsFor, resetMtLoops, syncMtLoops, type MtLoopContext,
} from "@/lib/api/mock/mt-loop";
import {
  attentionViewsFor, mockResponsibilityService, resetResponsibility,
} from "@/lib/api/mock/responsibility";
import { mockNeedsYouService } from "@/lib/api/mock/needs-you";
import {
  dispatchGrantsByCarrier, endTruckDispatchAccess, resetTruckRegistry,
  truckDispatchGrants,
} from "@/lib/api/mock/truck-registry";
import {
  membershipRecordFor, membersOf, resetMembershipDirectory,
  setMembershipDelegationScope, setMembershipStatus,
} from "@/lib/api/mock/membership-directory";
import { MOCK_ORGANIZATIONS } from "@/lib/session/fixtures";
import type { MtLoop, MtLoopCard } from "@/types";
import { contextFor } from "./harness";

/**
 * ★ THE TWO-LEVEL DELEGATION CHAIN ★
 *
 *   Carrier Owner
 *     → grants a truck to a Dispatch Organization
 *       → the Dispatch Organization's Owner puts an employee on it
 *
 * Two boundaries, and they behave differently on purpose.
 *
 * INSIDE the dispatch organization, routing does the work: an employee holds
 * the cycle, the organization's Owner is accountable for all of it, and when
 * the employee goes the work moves to another employee and only then to the
 * Owner as the internal fallback. Every rung is ordinary routing.
 *
 * ACROSS the boundary, nothing routes at all. `routeResponsibility` never
 * considers a membership outside the workspace, which is what stops a
 * dispatcher's bad day landing on the carrier who hired the agency. Work
 * reaches the carrier in exactly two ways: somebody decides to ask them
 * (`escalateLoopToCarrier`), or the grant ends and the truck comes home.
 *
 * So the escalation order — Employee → Dispatch Organization Owner → Carrier
 * Owner — is not a ladder anybody configured. The first two rungs fall out of
 * routing being workspace-scoped, and the third is a deliberate act. That is
 * what this file proves.
 */

const MERIDIAN_OWNER = "mem_meridian_owner";
const MERIDIAN_LANE = "mem_meridian_lane";      // holds org_baxter
const MERIDIAN_INES = "mem_meridian_ines";      // holds org_cascade
const MERIDIAN_OPS = "mem_meridian_ops";
const MERIDIAN_SAM = "mem_meridian_dispatcher";
const BAXTER_OWNER = "mem_baxter_owner";
const CARRIER_ORG = "org_baxter";
const DISPATCH_ORG = "org_meridian";

function loopCtx(membershipId: string): MtLoopContext {
  const base = contextFor(membershipId);
  const membership = membershipRecordFor(membershipId);
  if (!membership) throw new Error(`No such membership: ${membershipId}`);
  const organization = MOCK_ORGANIZATIONS.find((o) => o.id === base.organizationId);
  if (!organization) throw new Error(`No such organization: ${base.organizationId}`);
  return { ...base, organization, membership };
}

async function board(ctx: MtLoopContext): Promise<MtLoopCard[]> {
  syncMtLoops(ctx);
  return (await buildMtLoopBoard(ctx)).loops;
}

/** What a Home renders as a full operational card. */
async function homeCards(ctx: MtLoopContext): Promise<MtLoopCard[]> {
  return (await board(ctx)).filter((c) => c.needsYouPersonally);
}

async function summaries(ctx: MtLoopContext) {
  syncMtLoops(ctx);
  const b = await buildMtLoopBoard(ctx);
  return { handledByOthers: b.handledByOthers, dispatchedOut: b.dispatchedOut };
}

/** The carrier's truck that Meridian dispatches — the subject of every test here. */
function grantedLoop(ops: MtLoopContext): MtLoop {
  syncMtLoops(ops);
  const loop = openLoopsFor(ops).find((l) => l.carrierOrganizationId === CARRIER_ORG);
  if (!loop) throw new Error("the fixture has no carrier-granted loop");
  return loop;
}

beforeEach(() => {
  resetResponsibility();
  resetMtLoops();
  resetMembershipDirectory();
  resetTruckRegistry();
});

/* -------------------------------------------------------------------------- */

describe("the Carrier grants a truck to a Dispatch Organization", () => {
  it("puts the cycle in the dispatch organization's workspace, not the carrier's", async () => {
    const ops = loopCtx(MERIDIAN_OWNER);
    const loop = grantedLoop(ops);

    expect(loop.carrierOrganizationId).toBe(CARRIER_ORG);
    expect(loop.dispatchOrganizationId).toBe(DISPATCH_ORG);
    expect(truckDispatchGrants(loop.truckId).map((g) => g.dispatchOrganizationId))
      .toContain(DISPATCH_ORG);

    // The carrier has no operational card for it at all.
    const carrier = loopCtx(BAXTER_OWNER);
    expect((await board(carrier)).map((c) => c.loopId)).not.toContain(loop.loopId);
  });

  it("gives the carrier a compact summary instead of nothing", async () => {
    const ops = loopCtx(MERIDIAN_OWNER);
    grantedLoop(ops);
    const carrier = loopCtx(BAXTER_OWNER);

    const { dispatchedOut } = await summaries(carrier);
    expect(dispatchedOut.count).toBeGreaterThan(0);
    expect(dispatchedOut.byOrganization.map((o) => o.organizationId)).toContain(DISPATCH_ORG);
    // A summary, not a queue: no card, and nothing in the carrier's personal
    // list about a truck somebody else is covering.
    expect(await homeCards(carrier)).toHaveLength(0);
  });

  it("makes the Dispatch Organization the accountable boundary", async () => {
    const ops = loopCtx(MERIDIAN_OWNER);
    const loop = grantedLoop(ops);

    const views = await attentionViewsFor(contextFor(MERIDIAN_OWNER));
    const assignment = views.allOrganization.find((a) => a.work.id === loop.loopId);
    expect(assignment).toBeDefined();
    // Accountable is a membership OF the dispatch organization — that is the
    // organizational boundary expressed in the only currency the engine has.
    expect(assignment!.organizationId).toBe(DISPATCH_ORG);
    expect(membershipRecordFor(assignment!.accountable.membershipId)?.organizationId)
      .toBe(DISPATCH_ORG);
    expect(assignment!.accountable.membershipId).toBe(MERIDIAN_OWNER);
  });
});

/* -------------------------------------------------------------------------- */

describe("inside the Dispatch Organization", () => {
  it("routes the carrier's work to the employee scoped to that carrier", async () => {
    const ops = loopCtx(MERIDIAN_OWNER);
    const loop = grantedLoop(ops);
    const card = (await board(ops)).find((c) => c.loopId === loop.loopId)!;

    expect(card.responsible!.membershipId).toBe(MERIDIAN_LANE);
    expect(card.responsible!.source).toBe("delegation");
  });

  it("keeps it off the Dispatch Organization Owner's Home", async () => {
    const ops = loopCtx(MERIDIAN_OWNER);
    const loop = grantedLoop(ops);

    expect((await homeCards(ops)).map((c) => c.loopId)).not.toContain(loop.loopId);
    const views = await attentionViewsFor(contextFor(MERIDIAN_OWNER));
    expect(views.myNeedsYou.map((a) => a.work.id)).not.toContain(loop.loopId);
  });

  it("shows the Owner a compact team summary instead", async () => {
    const ops = loopCtx(MERIDIAN_OWNER);
    const loop = grantedLoop(ops);
    const { handledByOthers } = await summaries(ops);

    expect(handledByOthers.count).toBeGreaterThan(0);
    expect(handledByOthers.holders.map((h) => h.membershipId)).toContain(MERIDIAN_LANE);
    // Cards plus line is the whole board: nothing hidden, nothing twice.
    const all = await board(ops);
    expect((await homeCards(ops)).length + handledByOthers.count).toBe(all.length);
    expect(all.map((c) => c.loopId)).toContain(loop.loopId);
  });

  it("gives the employee the full operational card", async () => {
    const ops = loopCtx(MERIDIAN_OWNER);
    const loop = grantedLoop(ops);
    const lane = loopCtx(MERIDIAN_LANE);

    const cards = await homeCards(lane);
    expect(cards.map((c) => c.loopId)).toContain(loop.loopId);
    expect(cards.find((c) => c.loopId === loop.loopId)!.attention).toContain("responsible");
  });

  it("keeps it in the Owner's Team oversight and All organization", async () => {
    const ops = loopCtx(MERIDIAN_OWNER);
    const loop = grantedLoop(ops);
    const views = await attentionViewsFor(contextFor(MERIDIAN_OWNER));

    expect(views.teamOversight.map((a) => a.work.id)).toContain(loop.loopId);
    expect(views.allOrganization.map((a) => a.work.id)).toContain(loop.loopId);
    expect((await board(ops)).map((c) => c.loopId)).toContain(loop.loopId);
  });

  it("lets the Owner delegate it to another eligible employee, and follows", async () => {
    const ops = loopCtx(MERIDIAN_OWNER);
    const loop = grantedLoop(ops);

    // Ines is scoped to a different carrier, so widen her to this one first —
    // the engine must honour an authorized person's choice, and the scope is
    // what makes her eligible for it.
    setMembershipDelegationScope(MERIDIAN_INES, { carrierOrganizationIds: [CARRIER_ORG] });
    await mockResponsibilityService.delegate(
      contextFor(MERIDIAN_OWNER),
      { kind: "mt_loop", id: loop.loopId },
      { toMembershipId: MERIDIAN_INES, note: "Inés has the lane this week." },
    );

    const card = (await board(ops)).find((c) => c.loopId === loop.loopId)!;
    expect(card.responsible!.membershipId).toBe(MERIDIAN_INES);
    // Off both Owners' Homes, on the employee's.
    expect((await homeCards(ops)).map((c) => c.loopId)).not.toContain(loop.loopId);
    expect((await homeCards(loopCtx(BAXTER_OWNER))).map((c) => c.loopId))
      .not.toContain(loop.loopId);
    expect((await homeCards(loopCtx(MERIDIAN_INES))).map((c) => c.loopId))
      .toContain(loop.loopId);
    // Still accountable to the dispatch organization's Owner.
    const views = await attentionViewsFor(contextFor(MERIDIAN_OWNER));
    expect(views.allOrganization.find((a) => a.work.id === loop.loopId)!
      .accountable.membershipId).toBe(MERIDIAN_OWNER);
  });
});

/* -------------------------------------------------------------------------- */

describe("the internal fallback, before anything crosses the boundary", () => {
  /** Leave nobody in Meridian eligible for this carrier except the Owner. */
  function stripEligibility() {
    setMembershipStatus(MERIDIAN_LANE, "suspended");
    setMembershipStatus(MERIDIAN_INES, "ended");
    for (const id of [MERIDIAN_OPS, MERIDIAN_SAM]) {
      setMembershipDelegationScope(id, { carrierOrganizationIds: ["org_nobody"] });
    }
  }

  it("moves an employee's work to another employee first, not to the Owner", async () => {
    const ops = loopCtx(MERIDIAN_OWNER);
    const loop = grantedLoop(ops);

    setMembershipStatus(MERIDIAN_LANE, "suspended");

    const card = (await board(ops)).find((c) => c.loopId === loop.loopId)!;
    expect(card.responsible!.membershipId).not.toBe(MERIDIAN_LANE);
    expect(card.responsible!.membershipId).not.toBe(MERIDIAN_OWNER);
    expect(membershipRecordFor(card.responsible!.membershipId)?.organizationId)
      .toBe(DISPATCH_ORG);
  });

  it("falls to the Dispatch Organization Owner when no employee is left", async () => {
    const ops = loopCtx(MERIDIAN_OWNER);
    const loop = grantedLoop(ops);
    stripEligibility();

    const card = (await board(ops)).find((c) => c.loopId === loop.loopId)!;
    expect(card.responsible!.membershipId).toBe(MERIDIAN_OWNER);
    expect(card.responsible!.source).toBe("fallback");
    // And NOW it is a full card on their Home — the explicit internal fallback.
    expect(card.attention).toContain("owner_fallback");
    expect((await homeCards(ops)).map((c) => c.loopId)).toContain(loop.loopId);
  });

  it("does not reach the Carrier Owner, and does not disappear", async () => {
    const ops = loopCtx(MERIDIAN_OWNER);
    const loop = grantedLoop(ops);
    const carrier = loopCtx(BAXTER_OWNER);
    const before = await board(carrier);
    stripEligibility();

    // ★ The rule. ★ Routine internal trouble stays internal.
    expect((await board(carrier)).map((c) => c.loopId)).not.toContain(loop.loopId);
    expect((await homeCards(carrier)).map((c) => c.loopId)).not.toContain(loop.loopId);
    expect(await board(carrier)).toHaveLength(before.length);

    const carrierViews = await attentionViewsFor(contextFor(BAXTER_OWNER));
    expect(carrierViews.myNeedsYou.map((a) => a.work.id)).not.toContain(loop.loopId);

    // Still exactly one record of it, in the dispatch organization.
    const all = await board(ops);
    expect(all.filter((c) => c.loopId === loop.loopId)).toHaveLength(1);
  });

  it("holds the same answer on repeated reads", async () => {
    const ops = loopCtx(MERIDIAN_OWNER);
    const loop = grantedLoop(ops);
    stripEligibility();
    const first = (await board(ops)).find((c) => c.loopId === loop.loopId)!
      .responsible!.membershipId;
    for (let pass = 2; pass <= 4; pass++) {
      expect((await board(ops)).find((c) => c.loopId === loop.loopId)!
        .responsible!.membershipId, `pass ${pass}`).toBe(first);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("only a genuine escalation crosses to the Carrier", () => {
  it("is offered to the dispatch organization, never to a self-dispatching carrier", async () => {
    const ops = loopCtx(MERIDIAN_OWNER);
    const loop = grantedLoop(ops);
    const card = (await board(loopCtx(MERIDIAN_LANE))).find((c) => c.loopId === loop.loopId)!;
    expect(card.can.escalateToCarrier).toBe(true);

    // Northline dispatches its own trucks: there is nobody above it to ask.
    const northline = loopCtx("mem_northline_owner");
    for (const own of await board(northline)) {
      expect(own.can.escalateToCarrier, `${own.truckUnit}`).toBe(false);
    }
  });

  it("refuses an escalation with no reason", async () => {
    const ops = loopCtx(MERIDIAN_OWNER);
    const loop = grantedLoop(ops);
    const outcome = await escalateLoopToCarrier(loop.loopId, "   ", loopCtx(MERIDIAN_LANE));
    expect(outcome.status).toBe("needs_reason");
    expect(loop.carrierEscalation).toBeUndefined();
  });

  it("puts an item in the Carrier Owner's own queue, naming who asked and why", async () => {
    const ops = loopCtx(MERIDIAN_OWNER);
    const loop = grantedLoop(ops);
    const carrier = loopCtx(BAXTER_OWNER);

    const before = await mockNeedsYouService.list(carrier, {});
    const outcome = await escalateLoopToCarrier(
      loop.loopId,
      "Broker wants $200 over your floor. Your call.",
      loopCtx(MERIDIAN_LANE),
    );
    expect(outcome.status).toBe("ok");

    const after = await mockNeedsYouService.list(carrier, {});
    const raised = after.filter((i) => i.category === "dispatch_escalation");
    expect(raised).toHaveLength(1);
    expect(raised[0].reason).toContain("Broker wants $200 over your floor");
    expect(raised[0].title).toContain(loop.truckUnit);
    expect(after.length).toBe(before.length + 1);

    // It reaches them PERSONALLY — the whole point of escalating.
    const views = await attentionViewsFor(contextFor(BAXTER_OWNER));
    expect(views.myNeedsYou.map((a) => a.work.id)).toContain(raised[0].id);
  });

  it("does not move the work: the dispatcher still holds the truck", async () => {
    const ops = loopCtx(MERIDIAN_OWNER);
    const loop = grantedLoop(ops);
    const holderBefore = (await board(ops)).find((c) => c.loopId === loop.loopId)!
      .responsible!.membershipId;

    await escalateLoopToCarrier(loop.loopId, "Need a decision on the rate.", loopCtx(MERIDIAN_LANE));

    const card = (await board(ops)).find((c) => c.loopId === loop.loopId)!;
    expect(card.responsible!.membershipId).toBe(holderBefore);
    // Nor does it land on the carrier's MT Loop board — they were asked, not given.
    expect((await board(loopCtx(BAXTER_OWNER))).map((c) => c.loopId))
      .not.toContain(loop.loopId);
  });

  it("is recorded once, on the loop, and survives being answered", async () => {
    const ops = loopCtx(MERIDIAN_OWNER);
    const loop = grantedLoop(ops);
    const carrier = loopCtx(BAXTER_OWNER);

    await escalateLoopToCarrier(loop.loopId, "Your call on the rate.", loopCtx(MERIDIAN_LANE));
    const eventsAfterRaise = loop.history.length;
    expect(loop.carrierEscalation?.byMembershipId).toBe(MERIDIAN_LANE);
    expect(loop.carrierEscalation?.fromOrganizationId).toBe(DISPATCH_ORG);

    // A second attempt does not raise a second one.
    await escalateLoopToCarrier(loop.loopId, "Again", loopCtx(MERIDIAN_LANE));
    expect(loop.history.length).toBe(eventsAfterRaise);
    expect((await mockNeedsYouService.list(carrier, {}))
      .filter((i) => i.category === "dispatch_escalation")).toHaveLength(1);

    await answerCarrierEscalation(loop.loopId, carrier);
    // Answered, not erased — the account of them asking survives.
    expect(loop.carrierEscalation?.answeredAt).toBeTruthy();
    expect(loop.carrierEscalation?.note).toBe("Your call on the rate.");
    expect(loop.history.some((e) => e.action === "escalated_to_carrier")).toBe(true);
    expect((await mockNeedsYouService.list(carrier, {}))
      .filter((i) => i.category === "dispatch_escalation")).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */

describe("revoking the grant returns the truck to the Carrier", () => {
  it("moves the SAME loop, with its id and its history", async () => {
    const ops = loopCtx(MERIDIAN_OWNER);
    const loop = grantedLoop(ops);
    const loopId = loop.loopId;
    const openedAt = loop.openedAt;
    const eventsBefore = loop.history.length;
    const carrier = loopCtx(BAXTER_OWNER);

    const ended = endTruckDispatchAccess(
      loop.truckId, DISPATCH_ORG, "Bringing dispatch back in house.",
    );
    expect(ended?.status).toBe("ended");
    expect(ended?.endReason).toBe("Bringing dispatch back in house.");

    const onCarrier = (await board(carrier)).find((c) => c.loopId === loopId);
    expect(onCarrier, "the cycle must come home").toBeDefined();
    // ★ The same work item. Not a close and a reopen. ★
    expect(onCarrier!.loopId).toBe(loopId);
    expect(onCarrier!.openedAt).toBe(openedAt);
    expect(loop.history.length).toBeGreaterThan(eventsBefore);
    expect(loop.history.some((e) => e.action === "dispatch_changed")).toBe(true);

    // And gone from the dispatch organization's board.
    expect((await board(ops)).map((c) => c.loopId)).not.toContain(loopId);
  });

  it("leaves exactly one record of the cycle anywhere", async () => {
    const ops = loopCtx(MERIDIAN_OWNER);
    const loop = grantedLoop(ops);
    const carrier = loopCtx(BAXTER_OWNER);
    endTruckDispatchAccess(loop.truckId, DISPATCH_ORG, "Back in house.");

    const onCarrier = await board(carrier);
    const onDispatch = await board(ops);
    const forTruck = [...onCarrier, ...onDispatch].filter((c) => c.truckId === loop.truckId);
    expect(forTruck, "one open cycle for one truck, anywhere").toHaveLength(1);
  });

  it("gives it a responsible party at the carrier, and clears the old claim", async () => {
    const ops = loopCtx(MERIDIAN_OWNER);
    const loop = grantedLoop(ops);
    const carrier = loopCtx(BAXTER_OWNER);
    await assignLoop(loop.loopId, MERIDIAN_LANE, "Lane Okafor", ops);
    expect(loop.claimedByMembershipId).toBe(MERIDIAN_LANE);

    endTruckDispatchAccess(loop.truckId, DISPATCH_ORG, "Back in house.");

    const card = (await board(carrier)).find((c) => c.loopId === loop.loopId)!;
    expect(card.responsible?.membershipId).toBeTruthy();
    expect(membershipRecordFor(card.responsible!.membershipId)?.organizationId)
      .toBe(CARRIER_ORG);
    // A dispatcher at an agency that no longer covers this truck cannot still
    // be holding it.
    expect(card.claimed).toBeUndefined();
    // The spell they had is closed, not deleted.
    expect(loop.assignments.some((a) => a.membershipId === MERIDIAN_LANE && a.endedAt))
      .toBe(true);
  });

  it("takes the carrier's summary down with it", async () => {
    const ops = loopCtx(MERIDIAN_OWNER);
    const loop = grantedLoop(ops);
    const carrier = loopCtx(BAXTER_OWNER);
    const before = (await summaries(carrier)).dispatchedOut.count;
    expect(before).toBeGreaterThan(0);

    endTruckDispatchAccess(loop.truckId, DISPATCH_ORG, "Back in house.");
    expect((await summaries(carrier)).dispatchedOut.count).toBe(before - 1);
  });
});

/* -------------------------------------------------------------------------- */

describe("isolation holds through all of it", () => {
  it("counts only this carrier's own grants, never the agency's whole book", async () => {
    const ops = loopCtx(MERIDIAN_OWNER);
    syncMtLoops(ops);
    // The dispatch organization covers several carriers at once.
    const carriers = new Set(openLoopsFor(ops).map((l) => l.carrierOrganizationId));
    expect(carriers.size).toBeGreaterThan(1);

    const carrier = loopCtx(BAXTER_OWNER);
    const { dispatchedOut } = await summaries(carrier);
    // The summary is built from THIS carrier's grants — the paperwork they
    // signed — so it can never include a truck belonging to one of the
    // agency's other clients.
    const mine = dispatchGrantsByCarrier(CARRIER_ORG);
    expect(dispatchedOut.count).toBe(mine.length);
    expect(mine.every((g) => g.grantedByCarrierOrganizationId === CARRIER_ORG)).toBe(true);
    expect(dispatchedOut.count).toBeGreaterThan(0);
  });

  it("keeps an employee off a carrier they do not hold", async () => {
    const ops = loopCtx(MERIDIAN_OWNER);
    syncMtLoops(ops);
    for (const card of await board(ops)) {
      const holder = membershipRecordFor(card.responsible!.membershipId);
      expect(holder?.organizationId).toBe(DISPATCH_ORG);
    }
    // Lane holds org_baxter only, so nothing outside it should be hers. The
    // delegation scope lives on the directory's candidate record, not on the
    // membership — that is where the engine reads it from too.
    const lane = membersOf(DISPATCH_ORG).find((m) => m.membershipId === MERIDIAN_LANE)!;
    expect(lane.carrierOrganizationIds).toContain(CARRIER_ORG);
    for (const card of await homeCards(loopCtx(MERIDIAN_LANE))) {
      const loop = openLoopsFor(ops).find((l) => l.loopId === card.loopId);
      if (!loop) continue;
      expect(lane.carrierOrganizationIds).toContain(loop.carrierOrganizationId);
    }
  });

  it("does not let an escalation to one carrier be seen by another", async () => {
    const ops = loopCtx(MERIDIAN_OWNER);
    const loop = grantedLoop(ops);
    await escalateLoopToCarrier(loop.loopId, "Your call.", loopCtx(MERIDIAN_LANE));

    for (const who of ["mem_cascade_owner", "mem_stonebridge_owner", "mem_northline_owner"]) {
      if (!membershipRecordFor(who)) continue;
      const other = loopCtx(who);
      const items = await mockNeedsYouService.list(other, {});
      expect(
        items.filter((i) => i.category === "dispatch_escalation"),
        `${who} should not see another carrier's escalation`,
      ).toHaveLength(0);
    }
  });

  it("refuses an escalation from somebody outside the dispatch workspace", async () => {
    const ops = loopCtx(MERIDIAN_OWNER);
    const loop = grantedLoop(ops);
    // The carrier cannot raise an escalation to itself from the other side.
    const outcome = await escalateLoopToCarrier(
      loop.loopId, "Let me in", loopCtx(BAXTER_OWNER),
    );
    expect(outcome.status).toBe("not_found");
    expect(loop.carrierEscalation).toBeUndefined();
  });
});
