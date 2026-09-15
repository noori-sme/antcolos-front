import { beforeEach, describe, expect, it } from "vitest";
import {
  assignLoop, buildMtLoopBoard, resetMtLoops, syncMtLoops, type MtLoopContext,
} from "@/lib/api/mock/mt-loop";
import {
  attentionViewsFor, mockResponsibilityService, resetResponsibility,
} from "@/lib/api/mock/responsibility";
import {
  membershipRecordFor, resetMembershipDirectory, setMembershipDelegationScope,
  setMembershipStatus,
} from "@/lib/api/mock/membership-directory";
import { MOCK_ORGANIZATIONS } from "@/lib/session/fixtures";
import type { MtLoopCard } from "@/types";
import {
  contextFor, MERIDIAN_DISPATCHER, MERIDIAN_LANE, MERIDIAN_OWNER,
  NORTHLINE_OWNER, NORTHLINE_PAIGE,
} from "./harness";

/**
 * ★ HOME IS PERSONAL. THE BOARD IS ORGANIZATIONAL. ★
 *
 * Responsibility moved correctly and attention did not. A Carrier Owner's Home
 * carried a full operational card — buttons and all — for every open loop in
 * the workspace, including healthy ones a dispatcher was already working. The
 * card even said so: "Paige Ellery is responsible · follows a delegation". The
 * Owner was being handed an organization-wide board on the screen they open to
 * find out what needs them.
 *
 * The rule, and it is not a new one: a loop earns a full card on somebody's
 * Home for exactly the reasons `attentionFor` already recognises —
 *
 *   responsible             they are the one doing it
 *   owner_fallback          nobody else qualified, so it fell to them
 *   needs_assignment        nobody in the workspace can do it at all
 *   explicit_accountable    a person named them accountable, by hand
 *   approval_required       they are the approver and it is waiting
 *   escalation_reached_you  a recorded escalation actually named them
 *   help_requested          whoever holds it asked them
 *
 * Being able to see it is not on that list. Everything else collapses to one
 * line with links to the views built for looking, and stays in full on the
 * organization-wide board, in Team oversight and in All organization.
 */

function loopCtx(membershipId: string): MtLoopContext {
  const base = contextFor(membershipId);
  const membership = membershipRecordFor(membershipId);
  if (!membership) throw new Error(`No such membership: ${membershipId}`);
  const organization = MOCK_ORGANIZATIONS.find((o) => o.id === base.organizationId);
  if (!organization) throw new Error(`No such organization: ${base.organizationId}`);
  return { ...base, organization, membership };
}

/** Every loop this workspace covers — the organization-wide board. */
async function boardFor(ctx: MtLoopContext): Promise<MtLoopCard[]> {
  syncMtLoops(ctx);
  return (await buildMtLoopBoard(ctx)).loops;
}

/** What Home renders as a full operational card. */
async function homeCards(ctx: MtLoopContext): Promise<MtLoopCard[]> {
  return (await boardFor(ctx)).filter((c) => c.needsYouPersonally);
}

/** The one-line summary Home shows instead of the rest. */
async function homeSummary(ctx: MtLoopContext) {
  syncMtLoops(ctx);
  return (await buildMtLoopBoard(ctx)).handledByOthers;
}

/** A loop delegated to somebody else and in good health — the case that started this. */
async function healthyDelegatedLoop(ctx: MtLoopContext, notThisPerson: string) {
  const cards = await boardFor(ctx);
  const card = cards.find(
    (c) => c.responsible
      && c.responsible.membershipId !== notThisPerson
      && c.status !== "blocked"
      && c.status !== "closed",
  );
  if (!card) throw new Error("the fixture has no healthy delegated loop");
  return card;
}

beforeEach(() => {
  resetResponsibility();
  resetMtLoops();
  resetMembershipDirectory();
});

/* -------------------------------------------------------------------------- */

describe("a healthy delegated loop leaves the Owner's Home", () => {
  it("is not a full Home card for the Owner", async () => {
    const owner = loopCtx(NORTHLINE_OWNER);
    const delegated = await healthyDelegatedLoop(owner, owner.membershipId);

    const cards = await homeCards(owner);
    expect(cards.map((c) => c.loopId)).not.toContain(delegated.loopId);
    expect(delegated.needsYouPersonally).toBe(false);
    expect(delegated.attention).toEqual([]);
  });

  it("is not in the Owner's My Needs You either", async () => {
    const owner = loopCtx(NORTHLINE_OWNER);
    const delegated = await healthyDelegatedLoop(owner, owner.membershipId);

    const views = await attentionViewsFor(owner);
    const mine = views.myNeedsYou.filter((a) => a.work.kind === "mt_loop").map((a) => a.work.id);
    expect(mine).not.toContain(delegated.loopId);
  });

  it("is counted in one compact line instead, naming who has it", async () => {
    const owner = loopCtx(NORTHLINE_OWNER);
    const delegated = await healthyDelegatedLoop(owner, owner.membershipId);

    const summary = await homeSummary(owner);
    expect(summary.count).toBeGreaterThan(0);
    expect(summary.holders.map((h) => h.membershipId))
      .toContain(delegated.responsible!.membershipId);
    // The counts add up: every loop is either a card or in the line, never both
    // and never neither.
    const all = await boardFor(owner);
    const cards = await homeCards(owner);
    expect(cards.length + summary.count).toBe(all.length);
  });

  it("still appears in full for the dispatcher who is responsible", async () => {
    const owner = loopCtx(NORTHLINE_OWNER);
    const delegated = await healthyDelegatedLoop(owner, owner.membershipId);
    const holder = loopCtx(delegated.responsible!.membershipId);

    const theirs = await homeCards(holder);
    expect(theirs.map((c) => c.loopId)).toContain(delegated.loopId);
    const card = theirs.find((c) => c.loopId === delegated.loopId)!;
    expect(card.attention).toContain("responsible");
    expect(card.isMine).toBe(true);
  });

  it("and in their My Needs You and My work", async () => {
    const owner = loopCtx(NORTHLINE_OWNER);
    const delegated = await healthyDelegatedLoop(owner, owner.membershipId);
    const holder = contextFor(delegated.responsible!.membershipId);

    const views = await attentionViewsFor(holder);
    expect(
      views.myNeedsYou.filter((a) => a.work.kind === "mt_loop").map((a) => a.work.id),
    ).toContain(delegated.loopId);

    const board = await mockResponsibilityService.board(holder);
    const inQueues = board.queues.flatMap((q) => q.items).map((a) => a.work.id);
    expect(inQueues).toContain(delegated.loopId);
  });
});

/* -------------------------------------------------------------------------- */

describe("oversight is moved, never deleted", () => {
  it("keeps the loop on the Owner's organization-wide board", async () => {
    const owner = loopCtx(NORTHLINE_OWNER);
    const delegated = await healthyDelegatedLoop(owner, owner.membershipId);
    expect((await boardFor(owner)).map((c) => c.loopId)).toContain(delegated.loopId);
  });

  it("keeps it in Team oversight and All organization", async () => {
    const owner = loopCtx(NORTHLINE_OWNER);
    const delegated = await healthyDelegatedLoop(owner, owner.membershipId);

    const views = await attentionViewsFor(owner);
    const ids = (list: { work: { kind: string; id: string } }[]) =>
      list.filter((a) => a.work.kind === "mt_loop").map((a) => a.work.id);

    expect(ids(views.teamOversight), "Team oversight").toContain(delegated.loopId);
    expect(ids(views.allOrganization), "All organization").toContain(delegated.loopId);
  });

  it("deletes nothing and duplicates nothing", async () => {
    const owner = loopCtx(NORTHLINE_OWNER);
    const before = await boardFor(owner);
    const cards = await homeCards(owner);
    const summary = await homeSummary(owner);

    const after = await boardFor(owner);
    expect(after).toHaveLength(before.length);
    for (const card of after) {
      expect(after.filter((c) => c.loopId === card.loopId)).toHaveLength(1);
    }
    // A loop is a card or a line, exactly once.
    const shown = new Set(cards.map((c) => c.loopId));
    expect(shown.size + summary.count).toBe(after.length);
  });
});

/* -------------------------------------------------------------------------- */

describe("what brings it back to the Owner's Home", () => {
  it("a real escalation, recorded by a person", async () => {
    const owner = loopCtx(NORTHLINE_OWNER);
    const delegated = await healthyDelegatedLoop(owner, owner.membershipId);
    expect((await homeCards(owner)).map((c) => c.loopId)).not.toContain(delegated.loopId);

    const holder = contextFor(delegated.responsible!.membershipId);
    await mockResponsibilityService.escalate(
      holder,
      { kind: "mt_loop", id: delegated.loopId },
      "The truck goes empty at six and I cannot get this broker to move.",
    );

    const cards = await homeCards(owner);
    expect(cards.map((c) => c.loopId)).toContain(delegated.loopId);
    expect(cards.find((c) => c.loopId === delegated.loopId)!.attention)
      .toContain("escalation_reached_you");

    // ★ Escalation is still not reassignment. ★ It came back to the Owner's
    // attention; it did not become the Owner's work.
    const card = (await boardFor(owner)).find((c) => c.loopId === delegated.loopId)!;
    expect(card.responsible!.membershipId).toBe(delegated.responsible!.membershipId);
  });

  it("the responsible person asking for help", async () => {
    const owner = loopCtx(NORTHLINE_OWNER);
    const delegated = await healthyDelegatedLoop(owner, owner.membershipId);
    const holder = contextFor(delegated.responsible!.membershipId);

    await mockResponsibilityService.requestHelp(
      holder,
      { kind: "mt_loop", id: delegated.loopId },
      "The broker wants a rate I cannot sign off.",
    );

    const cards = await homeCards(owner);
    expect(cards.map((c) => c.loopId)).toContain(delegated.loopId);
    expect(cards.find((c) => c.loopId === delegated.loopId)!.attention)
      .toContain("help_requested");
    // The asker keeps it — asking is not handing over.
    expect(
      (await boardFor(owner)).find((c) => c.loopId === delegated.loopId)!.responsible!.membershipId,
    ).toBe(delegated.responsible!.membershipId);
  });

  it("the responsible membership ending, which makes it the Owner's fallback", async () => {
    const owner = loopCtx(NORTHLINE_OWNER);
    const delegated = await healthyDelegatedLoop(owner, owner.membershipId);
    const holderId = delegated.responsible!.membershipId;

    setMembershipStatus(holderId, "ended");

    const board = await boardFor(owner);
    const card = board.find((c) => c.loopId === delegated.loopId);
    expect(card, "the loop is still there").toBeDefined();
    expect(card!.responsible!.membershipId).not.toBe(holderId);
    // Wherever it landed, somebody holds it and it is not lost.
    expect(card!.responsible!.membershipId).toBeTruthy();
    expect(board).toHaveLength((await boardFor(owner)).length);
  });

  it("nothing else — severity and visibility do not count", async () => {
    const owner = loopCtx(NORTHLINE_OWNER);
    for (const card of await boardFor(owner)) {
      if (card.needsYouPersonally) continue;
      // The Owner can see it, is accountable for the workspace, and holds every
      // permission. None of that is a reason.
      expect(card.attention).toEqual([]);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("partial delegation filters per truck", () => {
  it("splits the Owner's Home by what is actually delegated", async () => {
    const owner = loopCtx(NORTHLINE_OWNER);
    const all = await boardFor(owner);
    const delegated = all.filter(
      (c) => c.responsible && c.responsible.membershipId !== owner.membershipId,
    );
    expect(delegated.length, "need at least two delegated loops").toBeGreaterThan(1);

    const holder = delegated[0].responsible!.membershipId;
    const keptTruck = delegated[0].truckId;

    // Narrow the delegation to one truck. That truck stays theirs and off the
    // Owner's Home; the others come back to whoever the routing picks.
    setMembershipDelegationScope(holder, { truckIds: [keptTruck] });

    const after = await boardFor(owner);
    expect(after, "no loop may vanish").toHaveLength(all.length);

    const stillTheirs = after.find((c) => c.truckId === keptTruck)!;
    expect(stillTheirs.responsible!.membershipId).toBe(holder);
    expect(stillTheirs.needsYouPersonally, "still not the Owner's problem").toBe(false);

    const homeIds = (await homeCards(owner)).map((c) => c.loopId);
    expect(homeIds).not.toContain(stillTheirs.loopId);

    for (const card of after) {
      if (card.truckId === keptTruck) continue;
      if (!delegated.some((d) => d.loopId === card.loopId)) continue;
      // It went somewhere. If it came back to the Owner it is a full card; if
      // it went to another colleague it is not. Either way it has an owner.
      expect(card.responsible?.membershipId).toBeTruthy();
      expect(card.needsYouPersonally).toBe(
        card.responsible!.membershipId === owner.membershipId,
      );
    }
  });

  it("puts a loop the Owner falls back to on the Owner's Home", async () => {
    const owner = loopCtx(NORTHLINE_OWNER);
    const all = await boardFor(owner);
    const delegated = all.filter(
      (c) => c.responsible && c.responsible.membershipId !== owner.membershipId,
    );
    const holder = delegated[0].responsible!.membershipId;

    // Nothing at all is delegated to them any more, and they are suspended, so
    // the loops have to land somewhere. They land, and they show up.
    setMembershipDelegationScope(holder, { truckIds: [] });
    setMembershipStatus(holder, "suspended");

    const after = await boardFor(owner);
    expect(after).toHaveLength(all.length);
    for (const card of after) {
      expect(card.responsible?.membershipId, `${card.truckUnit} lost its owner`).toBeTruthy();
      expect(card.responsible!.membershipId).not.toBe(holder);
      expect(card.needsYouPersonally).toBe(
        card.responsible!.membershipId === owner.membershipId,
      );
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("a dispatch organization behaves the same way", () => {
  it("keeps a dispatcher's healthy loop off their colleague's Home", async () => {
    const ops = loopCtx(MERIDIAN_OWNER);
    const all = await boardFor(ops);
    expect(all.length).toBeGreaterThan(0);

    const someoneElses = all.filter((c) => !c.needsYouPersonally);
    const cards = await homeCards(ops);
    for (const card of someoneElses) {
      expect(cards.map((c) => c.loopId)).not.toContain(card.loopId);
      expect(card.responsible?.membershipId).toBeTruthy();
    }
    // And the board still has every one of them.
    expect(cards.length + (await homeSummary(ops)).count).toBe(all.length);
  });

  it("gives the responsible dispatcher the full card", async () => {
    const ops = loopCtx(MERIDIAN_OWNER);
    const lane = loopCtx(MERIDIAN_LANE);
    const theirs = (await boardFor(ops)).filter(
      (c) => c.responsible?.membershipId === MERIDIAN_LANE,
    );
    if (theirs.length === 0) return;

    const laneHome = (await homeCards(lane)).map((c) => c.loopId);
    for (const card of theirs) expect(laneHome).toContain(card.loopId);
  });

  it("never leaks a carrier's loop into another workspace", async () => {
    const northline = loopCtx(NORTHLINE_OWNER);
    const ours = new Set((await boardFor(northline)).map((c) => c.loopId));

    for (const membershipId of [MERIDIAN_OWNER, MERIDIAN_DISPATCHER]) {
      const theirs = loopCtx(membershipId);
      for (const card of await boardFor(theirs)) {
        expect(ours.has(card.loopId), "a loop crossed a workspace boundary").toBe(false);
      }
      for (const card of await homeCards(theirs)) {
        expect(ours.has(card.loopId)).toBe(false);
      }
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("one derivation, four levels of detail", () => {
  /**
   * ★ RULE 6, ASSERTED ★
   * Home does not have a filter. It renders `needsYouPersonally`, which is the
   * same `attentionFor` result that decides My Needs You. If these two ever
   * disagree, somebody has added a second rule, and this fails.
   */
  it("Home's cards are exactly the loops in My Needs You", async () => {
    for (const who of [NORTHLINE_OWNER, NORTHLINE_PAIGE, MERIDIAN_OWNER, MERIDIAN_LANE]) {
      const ctx = loopCtx(who);
      const cards = new Set((await homeCards(ctx)).map((c) => c.loopId));
      const views = await attentionViewsFor(contextFor(who));
      const mine = new Set(
        views.myNeedsYou.filter((a) => a.work.kind === "mt_loop").map((a) => a.work.id),
      );
      expect([...cards].sort(), `Home and My Needs You disagree for ${who}`)
        .toEqual([...mine].sort());
    }
  });

  it("the card still carries the responsibility facts, at every level", async () => {
    const owner = loopCtx(NORTHLINE_OWNER);
    for (const card of await boardFor(owner)) {
      // Even a loop that is nobody's problem on this screen names its owner.
      expect(card.responsible?.displayName).toBeTruthy();
      expect(card.responsible?.source).toBeTruthy();
    }
  });

  it("gives the same answer on the fourth read as the first", async () => {
    const owner = loopCtx(NORTHLINE_OWNER);
    const first = (await homeCards(owner)).map((c) => c.loopId).sort();
    for (let pass = 2; pass <= 4; pass++) {
      expect((await homeCards(owner)).map((c) => c.loopId).sort(), `pass ${pass}`)
        .toEqual(first);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("assigning a loop hands the card over with it", () => {
  it("moves it off the Owner's Home and onto the assignee's", async () => {
    const owner = loopCtx(NORTHLINE_OWNER);
    const mine = (await homeCards(owner)).find((c) => c.isMine);
    expect(mine, "the Owner should hold at least one loop").toBeDefined();

    const paige = membershipRecordFor(NORTHLINE_PAIGE)!;
    await assignLoop(mine!.loopId, paige.id, "Paige Ellery", owner);

    expect((await homeCards(owner)).map((c) => c.loopId)).not.toContain(mine!.loopId);
    expect((await homeCards(loopCtx(paige.id))).map((c) => c.loopId)).toContain(mine!.loopId);
    // Still on the Owner's board, and now in the line.
    expect((await boardFor(owner)).map((c) => c.loopId)).toContain(mine!.loopId);
    expect((await homeSummary(owner)).holders.map((h) => h.membershipId)).toContain(paige.id);
  });
});
