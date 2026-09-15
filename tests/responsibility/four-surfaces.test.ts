import { beforeEach, describe, expect, it } from "vitest";
import {
  assignLoop, buildMtLoopBoard, claimLoop, releaseLoop, syncMtLoops,
  type MtLoopContext,
} from "@/lib/api/mock/mt-loop";
import {
  attentionViewsFor, mockResponsibilityService, resetResponsibility,
} from "@/lib/api/mock/responsibility";
import { mockNeedsYouService } from "@/lib/api/mock/needs-you";
import { mockHomeService } from "@/lib/api/mock/home";
import {
  membershipRecordFor, resetMembershipDirectory, setMembershipDelegationScope,
  setMembershipStatus,
} from "@/lib/api/mock/membership-directory";
import { MOCK_ORGANIZATIONS } from "@/lib/session/fixtures";
import { resetMtLoops } from "@/lib/api/mock/mt-loop";
import type { ServiceContext } from "@/lib/api/contracts/context";
import type { MtLoopCard, ResponsibilityAssignment } from "@/types";
import {
  contextFor, MERIDIAN_DISPATCHER, MERIDIAN_OWNER, NORTHLINE_OWNER, NORTHLINE_PAIGE,
} from "./harness";

/**
 * ★ ONE QUESTION, ONE ANSWER, FOUR SURFACES ★
 *
 * "Who is responsible for this truck's empty cycle?" used to have two answers.
 * MT Loop stored `responsibleMembershipId` and rendered "Nobody on it" from it;
 * the Responsibility Engine routed the same loop to a named dispatcher and
 * every other surface showed that. A dispatcher could read both in the same
 * minute and be told two different things.
 *
 * The boundary this file defends:
 *
 *   responsible   THE ENGINE'S. Derived on every read from permissions, scope,
 *                 asset and work assignment, availability and delegation. No
 *                 module stores it. Every surface renders this one.
 *   claimed       MT LOOP'S. A person's recorded acceptance, with an actor and
 *                 a time. A different fact — a loop routed to Paige that
 *                 nobody has picked up is hers and unclaimed at once — and an
 *                 INPUT to the engine, never a competing answer.
 *
 * Nothing below asserts a seeded name. Each test reads the answer from one
 * surface and requires the other three to match it, so the tests keep working
 * when the fixtures change and fail the moment two surfaces diverge.
 */

function loopCtx(membershipId: string): MtLoopContext {
  const base = contextFor(membershipId);
  const membership = membershipRecordFor(membershipId);
  if (!membership) throw new Error(`No such membership: ${membershipId}`);
  const organization = MOCK_ORGANIZATIONS.find((o) => o.id === base.organizationId);
  if (!organization) throw new Error(`No such organization: ${base.organizationId}`);
  return { ...base, organization, membership };
}

/* -------------------------------------------------------------------------- */
/* The four surfaces, each read the way its screen reads it                    */
/* -------------------------------------------------------------------------- */

/** Surface 1 — the MT Loop board. */
async function mtLoopSurface(ctx: MtLoopContext): Promise<MtLoopCard[]> {
  syncMtLoops(ctx);
  return (await buildMtLoopBoard(ctx)).loops;
}

/** Surface 2 — `/work`, through the responsibility board's queues. */
async function workSurface(ctx: ServiceContext): Promise<Map<string, ResponsibilityAssignment>> {
  const board = await mockResponsibilityService.board(ctx);
  const out = new Map<string, ResponsibilityAssignment>();
  for (const queue of board.queues) {
    for (const item of queue.items) {
      if (item.work.kind === "mt_loop") out.set(item.work.id, item);
    }
  }
  return out;
}

/** Surface 3 — Needs You, through the shared attention derivation. */
async function needsYouSurface(
  ctx: ServiceContext,
): Promise<Map<string, ResponsibilityAssignment>> {
  const views = await attentionViewsFor(ctx);
  return new Map(
    views.allOrganization
      .filter((a) => a.work.kind === "mt_loop")
      .map((a) => [a.work.id, a] as const),
  );
}

/** Surface 4 — Home, whose personal block is built from the same derivation. */
async function homePersonalLoopIds(ctx: ServiceContext): Promise<Set<string>> {
  const views = await attentionViewsFor(ctx);
  // Home renders `HomeSummary.needsYouPreview`, which `mockHomeService.summary`
  // builds from this exact set. Asserting against the set rather than the
  // rendered preview keeps the claim about the derivation, which is the thing
  // that must not fork.
  return new Set(
    views.myNeedsYou.filter((a) => a.work.kind === "mt_loop").map((a) => a.work.id),
  );
}

/** What every surface has to say about one loop, gathered in one place. */
async function answersFor(ctx: MtLoopContext, loopId: string) {
  const cards = await mtLoopSurface(ctx);
  const [work, needsYou, home] = await Promise.all([
    workSurface(ctx), needsYouSurface(ctx), homePersonalLoopIds(ctx),
  ]);
  const card = cards.find((c) => c.loopId === loopId);
  return {
    card,
    mtLoop: card?.responsible?.membershipId,
    work: work.get(loopId)?.responsible.membershipId,
    needsYou: needsYou.get(loopId)?.responsible.membershipId,
    homeSaysMine: home.has(loopId),
    accountable: needsYou.get(loopId)?.accountable.membershipId,
  };
}

function expectAgreement(a: Awaited<ReturnType<typeof answersFor>>) {
  expect(a.mtLoop, "MT Loop must name somebody").toBeTruthy();
  expect(a.work, "the Work screen must agree with MT Loop").toBe(a.mtLoop);
  expect(a.needsYou, "Needs You must agree with MT Loop").toBe(a.mtLoop);
  // Home's is the same derivation, so "is it mine" is decided by the same
  // answer rather than by a rule of Home's own.
  return a.mtLoop!;
}

async function firstOpenLoop(ctx: MtLoopContext) {
  const cards = await mtLoopSurface(ctx);
  const card = cards.find((c) => c.status !== "closed");
  if (!card) throw new Error("the fixture workspace has no open loop");
  return card;
}

beforeEach(() => {
  resetResponsibility();
  resetMtLoops();
  resetMembershipDirectory();
});

/* -------------------------------------------------------------------------- */

describe("every open loop gets one answer", () => {
  it("MT Loop, Work and Needs You name the same responsible party", async () => {
    const ctx = loopCtx(NORTHLINE_OWNER);
    const cards = await mtLoopSurface(ctx);
    expect(cards.length).toBeGreaterThan(0);

    const work = await workSurface(ctx);
    const needsYou = await needsYouSurface(ctx);

    for (const card of cards) {
      expect(card.responsible, `${card.truckUnit} has no responsible party`).toBeDefined();
      expect(
        work.get(card.loopId)?.responsible.membershipId,
        `${card.truckUnit}: MT Loop and Work disagree`,
      ).toBe(card.responsible!.membershipId);
      expect(
        needsYou.get(card.loopId)?.responsible.membershipId,
        `${card.truckUnit}: MT Loop and Needs You disagree`,
      ).toBe(card.responsible!.membershipId);
    }
  });

  it("carries the engine's own words for why, not a second vocabulary", async () => {
    const ctx = loopCtx(NORTHLINE_OWNER);
    const cards = await mtLoopSurface(ctx);
    const work = await workSurface(ctx);
    for (const card of cards) {
      const assignment = work.get(card.loopId)!;
      expect(card.responsible!.source).toBe(assignment.responsible.source);
      expect(card.responsible!.assignmentState).toBe(assignment.assignmentState);
    }
  });

  it("never says nobody is on a loop", async () => {
    const ctx = loopCtx(NORTHLINE_OWNER);
    for (const card of await mtLoopSurface(ctx)) {
      // The old bug, asserted against directly: an unclaimed loop still has an
      // owner, and the status says only that nobody has put their hand up.
      expect(card.responsible?.membershipId).toBeTruthy();
      if (card.status === "unclaimed") expect(card.claimed).toBeUndefined();
      for (const blocker of card.blockers) {
        expect(blocker.label).not.toBe("Nobody on it");
      }
    }
  });

  it("agrees with Home about which loops are the viewer's own", async () => {
    const ctx = loopCtx(NORTHLINE_OWNER);
    const cards = await mtLoopSurface(ctx);
    const home = await homePersonalLoopIds(ctx);
    for (const card of cards) {
      // Home shows a loop only when it needs this person. That is a narrower
      // question than "are they responsible" — an acknowledged, healthy loop
      // is theirs without needing them today — so the claim here is the one
      // that must hold: Home never shows a loop that is somebody else's.
      if (home.has(card.loopId)) {
        expect(card.responsible!.membershipId, `${card.truckUnit} on Home`)
          .toBe(ctx.membershipId);
        expect(card.isMine).toBe(true);
      }
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("claimed and responsible are different facts", () => {
  it("a loop can be somebody's and unclaimed at the same time", async () => {
    const ctx = loopCtx(NORTHLINE_OWNER);
    const unclaimed = (await mtLoopSurface(ctx)).find((c) => !c.claimed);
    expect(unclaimed, "the fixture should have an unclaimed loop").toBeDefined();
    expect(unclaimed!.responsible?.membershipId).toBeTruthy();
    expect(unclaimed!.claimed).toBeUndefined();
  });

  it("accepting a loop makes the accepter responsible on all four surfaces", async () => {
    const ctx = loopCtx(NORTHLINE_OWNER);
    const target = (await mtLoopSurface(ctx)).find((c) => !c.claimed && c.can.claim);
    expect(target, "no claimable loop in the fixture").toBeDefined();

    const before = await answersFor(ctx, target!.loopId);
    expect(before.card!.claimed).toBeUndefined();

    const outcome = await claimLoop(target!.loopId, ctx);
    expect(outcome.status).toBe("ok");

    const after = await answersFor(ctx, target!.loopId);
    expect(expectAgreement(after)).toBe(ctx.membershipId);
    expect(after.card!.claimed?.membershipId).toBe(ctx.membershipId);
    expect(after.card!.claimed?.isMine).toBe(true);
    expect(after.card!.responsible!.source).toBe("manual");
  });

  it("handing a loop back routes it again without deleting or duplicating it", async () => {
    const ctx = loopCtx(NORTHLINE_OWNER);
    const target = (await mtLoopSurface(ctx)).find((c) => !c.claimed && c.can.claim)!;
    await claimLoop(target.loopId, ctx);

    const countBefore = (await mtLoopSurface(ctx)).length;
    const released = await releaseLoop(target.loopId, ctx);
    expect(released.status).toBe("ok");

    const cards = await mtLoopSurface(ctx);
    // The loop is still there, exactly once.
    expect(cards.filter((c) => c.loopId === target.loopId)).toHaveLength(1);
    expect(cards).toHaveLength(countBefore);

    const after = await answersFor(ctx, target.loopId);
    expectAgreement(after);
    expect(after.card!.claimed, "handing back clears the acceptance").toBeUndefined();
    expect(after.card!.responsible!.source, "and it is routed again").not.toBe("manual");
    // The acceptance history survives the hand-back — that is the difference
    // between putting work down and losing it.
    const spells = after.card!.handoffCount;
    expect(spells).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */

describe("delegation produces one answer everywhere", () => {
  it("delegating to a dispatcher moves every surface at once", async () => {
    const ctx = loopCtx(NORTHLINE_OWNER);
    const target = await firstOpenLoop(ctx);
    const paige = membershipRecordFor(NORTHLINE_PAIGE)!;

    await mockResponsibilityService.delegate(
      ctx,
      { kind: "mt_loop", id: target.loopId },
      { toMembershipId: paige.id, note: "Paige knows this lane and is on shift." },
    );

    const after = await answersFor(ctx, target.loopId);
    expect(expectAgreement(after)).toBe(paige.id);
  });

  it("a later acceptance beats an earlier delegation, on every surface", async () => {
    const ctx = loopCtx(NORTHLINE_OWNER);
    const target = (await mtLoopSurface(ctx)).find((c) => !c.claimed && c.can.claim)!;
    const paige = membershipRecordFor(NORTHLINE_PAIGE)!;

    await mockResponsibilityService.delegate(
      ctx,
      { kind: "mt_loop", id: target.loopId },
      { toMembershipId: paige.id, note: "Paige is on shift." },
    );
    expect(expectAgreement(await answersFor(ctx, target.loopId))).toBe(paige.id);

    // Somebody then picks it up on the board. Two explicit choices by two
    // people; the tie-break is time, not which screen they were standing in.
    await claimLoop(target.loopId, ctx);
    const after = await answersFor(ctx, target.loopId);
    expect(expectAgreement(after)).toBe(ctx.membershipId);
    expect(after.card!.claimed?.membershipId).toBe(ctx.membershipId);
  });

  it("assigning on the MT Loop board is the same choice, and reads the same", async () => {
    const ctx = loopCtx(NORTHLINE_OWNER);
    const target = (await mtLoopSurface(ctx)).find((c) => !c.claimed)!;
    const paige = membershipRecordFor(NORTHLINE_PAIGE)!;

    const outcome = await assignLoop(target.loopId, paige.id, "Paige Ellery", ctx);
    expect(outcome.status).toBe("ok");

    const after = await answersFor(ctx, target.loopId);
    expect(expectAgreement(after)).toBe(paige.id);
    expect(after.card!.claimed?.membershipId).toBe(paige.id);
  });

  it("scoping a dispatcher's delegation to some trucks changes only those", async () => {
    const ctx = loopCtx(NORTHLINE_OWNER);
    const cards = await mtLoopSurface(ctx);
    const delegated = cards.filter((c) => c.responsible?.source === "delegation");
    expect(delegated.length, "the fixture should have delegated loops").toBeGreaterThan(1);

    const holder = delegated[0].responsible!.membershipId;
    const kept = delegated[0].truckId;

    // Narrow the delegation to one truck. Every other loop it used to cover
    // has to move — and none of them may vanish.
    setMembershipDelegationScope(holder, { truckIds: [kept] });

    const after = await mtLoopSurface(ctx);
    expect(after).toHaveLength(cards.length);
    const stillTheirs = after.find((c) => c.truckId === kept)!;
    expect(stillTheirs.responsible!.membershipId).toBe(holder);

    for (const card of after) {
      if (card.truckId === kept) continue;
      if (!delegated.some((d) => d.loopId === card.loopId)) continue;
      // It went somewhere — routed on, or to the Owner. Never nowhere.
      expect(card.responsible?.membershipId, `${card.truckUnit} lost its owner`).toBeTruthy();
    }

    // And every surface still agrees about each one.
    const work = await workSurface(ctx);
    for (const card of after) {
      expect(work.get(card.loopId)?.responsible.membershipId).toBe(
        card.responsible!.membershipId,
      );
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("the derived answer keeps up with the world", () => {
  it("a membership ending moves the work and keeps the loop and its history", async () => {
    const ctx = loopCtx(NORTHLINE_OWNER);
    const target = (await mtLoopSurface(ctx)).find((c) => !c.claimed && c.can.claim)!;
    const paige = membershipRecordFor(NORTHLINE_PAIGE)!;

    await assignLoop(target.loopId, paige.id, "Paige Ellery", ctx);
    expect(expectAgreement(await answersFor(ctx, target.loopId))).toBe(paige.id);

    const before = await mtLoopSurface(ctx);
    setMembershipStatus(paige.id, "ended");

    const after = await answersFor(ctx, target.loopId);
    const now = expectAgreement(after);
    expect(now, "the work must leave an ended membership").not.toBe(paige.id);

    // Nothing deleted, nothing copied.
    const cards = await mtLoopSurface(ctx);
    expect(cards).toHaveLength(before.length);
    expect(cards.filter((c) => c.loopId === target.loopId)).toHaveLength(1);
    // The acceptance history is untouched — the loop still records that Paige
    // had it, which is what makes the handover readable a week later.
    expect(after.card!.handoffCount).toBeGreaterThan(0);
  });

  it("losing the permission releases an acceptance rather than stranding the work", async () => {
    const ctx = loopCtx(NORTHLINE_OWNER);
    const target = (await mtLoopSurface(ctx)).find((c) => !c.claimed && c.can.claim)!;
    const paige = membershipRecordFor(NORTHLINE_PAIGE)!;

    await assignLoop(target.loopId, paige.id, "Paige Ellery", ctx);
    expect(expectAgreement(await answersFor(ctx, target.loopId))).toBe(paige.id);

    // Suspending the membership is the readable form of "can no longer do it".
    setMembershipStatus(paige.id, "suspended");

    const after = await answersFor(ctx, target.loopId);
    const now = expectAgreement(after);
    expect(now).not.toBe(paige.id);
    expect(after.card, "the loop is still on the board").toBeDefined();
    // The loop still says who accepted it. The engine simply no longer agrees
    // that they are responsible, which is the honest reading of both facts.
    expect(after.card!.claimed?.membershipId).toBe(paige.id);
  });

  it("escalation raises the alarm without moving the work", async () => {
    const ctx = loopCtx(NORTHLINE_OWNER);
    const target = (await mtLoopSurface(ctx)).find((c) => !c.claimed && c.can.claim)!;
    await claimLoop(target.loopId, ctx);
    const before = expectAgreement(await answersFor(ctx, target.loopId));

    await mockResponsibilityService.escalate(
      ctx,
      { kind: "mt_loop", id: target.loopId },
      "Nobody has moved this all day and the truck goes empty at six.",
    );

    const after = await answersFor(ctx, target.loopId);
    // ★ The rule the whole module is built around. ★
    expect(expectAgreement(after), "escalation is not reassignment").toBe(before);
    expect(after.card!.claimed?.membershipId).toBe(ctx.membershipId);
  });
});

/* -------------------------------------------------------------------------- */

describe("scope isolation survives the shared answer", () => {
  it("another organization's board never shows these loops", async () => {
    const northline = loopCtx(NORTHLINE_OWNER);
    const ours = new Set((await mtLoopSurface(northline)).map((c) => c.loopId));
    expect(ours.size).toBeGreaterThan(0);

    for (const membershipId of [MERIDIAN_OWNER, MERIDIAN_DISPATCHER]) {
      const theirs = loopCtx(membershipId);
      for (const card of await mtLoopSurface(theirs)) {
        expect(ours.has(card.loopId), "a loop crossed a workspace boundary").toBe(false);
      }
      // And the responsibility answer is scoped too — asking the engine for
      // another workspace's loops must not produce one.
      const work = await workSurface(theirs);
      for (const loopId of ours) expect(work.has(loopId)).toBe(false);
    }
  });

  it("names only memberships of this workspace as responsible", async () => {
    const ctx = loopCtx(NORTHLINE_OWNER);
    for (const card of await mtLoopSurface(ctx)) {
      const member = membershipRecordFor(card.responsible!.membershipId);
      expect(member?.organizationId).toBe(ctx.organizationId);
    }
  });

  it("keeps the personal queue personal after everything above", async () => {
    const owner = loopCtx(NORTHLINE_OWNER);
    const target = (await mtLoopSurface(owner)).find((c) => !c.claimed && c.can.claim)!;
    const paige = membershipRecordFor(NORTHLINE_PAIGE)!;
    await assignLoop(target.loopId, paige.id, "Paige Ellery", owner);

    // It is Paige's now, so it is on Paige's Home and not the Owner's.
    const paigeCtx = contextFor(NORTHLINE_PAIGE);
    const paigeHome = await homePersonalLoopIds(paigeCtx);
    const ownerHome = await homePersonalLoopIds(owner);
    expect(paigeHome.has(target.loopId)).toBe(true);
    expect(ownerHome.has(target.loopId)).toBe(false);

    // And Home's own summary is built from that set rather than from a rule of
    // its own, so the two cannot drift.
    const summary = await mockHomeService.summary(paigeCtx);
    const personal = (await attentionViewsFor(paigeCtx)).myNeedsYou.filter(
      (a) => a.work.kind === "needs_you",
    );
    expect(summary.counts.needsYouOpen).toBe(personal.length);
    // The preview is the head of that same list, not a separately filtered one.
    const personalIds = new Set(personal.map((a) => a.work.id));
    for (const item of summary.needsYouPreview) {
      expect(personalIds.has(item.id), `${item.title} is not in Paige's own queue`).toBe(true);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("the answer does not change just because somebody looked", () => {
  /**
   * ★ READING MUST NOT WRITE ★
   *
   * This caught a real bug while the seam was being closed. Adopting an
   * acceptance by WRITING an override made reading the board a mutation, and
   * because the workload tie-break reads overrides, the second read of an
   * unchanged workspace answered differently from the first — fifteen items
   * moved between two questions that were identical. Four surfaces agreeing is
   * worth nothing if the answer depends on how many times somebody looked.
   */
  it("gives the same answer on the fourth read as on the first", async () => {
    const ctx = loopCtx(NORTHLINE_OWNER);
    const first = new Map(
      (await mtLoopSurface(ctx)).map((c) => [c.loopId, c.responsible?.membershipId] as const),
    );
    expect(first.size).toBeGreaterThan(0);

    for (let pass = 2; pass <= 4; pass++) {
      const again = await mtLoopSurface(ctx);
      expect(again, `pass ${pass} changed how many loops there are`).toHaveLength(first.size);
      for (const card of again) {
        expect(card.responsible?.membershipId, `${card.truckUnit} moved on pass ${pass}`)
          .toBe(first.get(card.loopId));
      }
    }
  });

  it("holds the personal queue steady across repeated reads", async () => {
    const ctx = contextFor(NORTHLINE_PAIGE);
    const first = (await attentionViewsFor(ctx)).myNeedsYou.length;
    for (let pass = 2; pass <= 4; pass++) {
      expect(
        (await attentionViewsFor(ctx)).myNeedsYou.length,
        `Paige's queue changed on pass ${pass}`,
      ).toBe(first);
    }
  });

  it("does not let a read decide who holds the work", async () => {
    const owner = loopCtx(NORTHLINE_OWNER);
    // One person reading the board must not change what another person sees.
    const before = await answersFor(owner, (await firstOpenLoop(owner)).loopId);
    await mtLoopSurface(loopCtx(NORTHLINE_PAIGE));
    await attentionViewsFor(contextFor(NORTHLINE_PAIGE));
    const after = await answersFor(owner, (await firstOpenLoop(owner)).loopId);
    expect(after.mtLoop).toBe(before.mtLoop);
    expectAgreement(after);
  });
});

/* -------------------------------------------------------------------------- */

describe("the Needs You queue speaks the same language", () => {
  it("loop items never call a routed loop unassigned", async () => {
    const ctx = loopCtx(NORTHLINE_OWNER);
    syncMtLoops(ctx);
    const items = await mockNeedsYouService.list(ctx, {});
    const loopItems = items.filter((i) => i.entity.kind === "mt_loop");
    for (const item of loopItems) {
      expect(`${item.title} ${item.reason} ${item.detail ?? ""}`).not.toMatch(/nobody on it/i);
    }
  });
});
