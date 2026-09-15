import { beforeEach, describe, expect, it } from "vitest";
import { PermissionDeniedError } from "@/lib/api/contracts/context";
import {
  memberById, setMembershipAvailability, setMembershipStatus,
} from "@/lib/api/mock/membership-directory";
import { mockNeedsYouService } from "@/lib/api/mock/needs-you";
import { responsibilityContextForNeedsYou } from "@/lib/api/mock/responsibility-context";
import { resetAllMocks } from "@/lib/api/mock/registry";
import { mockResponsibilityService as responsibility } from "@/lib/api/mock/responsibility";
import type { ResponsibilityAssignment, ResponsibilityQueue } from "@/types";
import {
  BAXTER_OWNER, CASCADE_DRIVER, MERIDIAN_DISPATCHER, MERIDIAN_INES,
  MERIDIAN_LANE, MERIDIAN_OPS, MERIDIAN_SUSPENDED, NORTHLINE_BOOKS, NORTHLINE_DRIVER,
  NORTHLINE_OWNER, NORTHLINE_PAIGE, NORTHLINE_SHOP, SOLO_DISPATCHER,
  SUMMIT_DEVON, SUMMIT_OWNER, contextFor,
} from "./harness";

/**
 * The scenarios the milestone asks to be proven, against the real services.
 *
 * Every one of these runs through `mockResponsibilityService`, which reads live
 * MT Loop and Needs You state — so a test here fails if either of those stops
 * emitting responsibility context, which is exactly the coupling worth
 * protecting.
 */

beforeEach(() => resetAllMocks());

const queue = (board: { queues: Array<{ queue: ResponsibilityQueue }> }, q: ResponsibilityQueue) =>
  board.queues.find((x) => x.queue === q);

/** The live Needs You item behind one assignment, for a test that re-derives. */
let needsYouCache: Map<string, import("@/types").NeedsYouItem> = new Map();
const needsYouById = (id: string) => needsYouCache.get(id);

const loadNeedsYou = async (membershipId: string) => {
  const items = await mockNeedsYouService.list(contextFor(membershipId));
  needsYouCache = new Map(items.map((i) => [i.id, i]));
};

const allWork = async (membershipId: string) => {
  const board = await responsibility.board(contextFor(membershipId));
  const all = queue(board, "all_organization");
  // A viewer who may not see the whole organization still has their own work.
  return all?.items
    ?? [
      ...(queue(board, "my_mt_loop")?.items ?? []),
      ...(queue(board, "my_needs_you")?.items ?? []),
    ];
};

/* -------------------------------------------------------------------------- */
/* No work is ownerless                                                        */
/* -------------------------------------------------------------------------- */

describe("no MT Loop cycle and no Needs You item is ever ownerless", () => {
  const everybody = [
    NORTHLINE_OWNER, NORTHLINE_PAIGE, MERIDIAN_DISPATCHER, MERIDIAN_OPS,
    SUMMIT_OWNER, SOLO_DISPATCHER, BAXTER_OWNER, CASCADE_DRIVER,
  ];

  for (const who of everybody) {
    it(`gives every piece of work a responsible and an accountable membership for ${who}`, async () => {
      const items = await allWork(who);
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.responsible.membershipId).toBeTruthy();
        expect(item.responsible.displayName).toBeTruthy();
        // The invariant the whole module exists to keep.
        expect(item.accountable.membershipId).toBeTruthy();
        expect(item.accountable.displayName).toBeTruthy();
        // And a sentence the person can argue with.
        expect(item.responsible.reason).toBeTruthy();
      }
    });
  }

  it("covers both kinds of work, not just the easy one", async () => {
    const items = await allWork(SOLO_DISPATCHER);
    expect(items.some((i) => i.work.kind === "mt_loop")).toBe(true);
    expect(items.some((i) => i.work.kind === "needs_you")).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Small carriers and workspaces of one                                        */
/* -------------------------------------------------------------------------- */

describe("a small self-dispatching carrier needs no setup at all", () => {
  it("routes everything to the Owner and calls it theirs, not unassigned", async () => {
    const ctx = contextFor(BAXTER_OWNER);
    const board = await responsibility.board(ctx);

    expect(board.fleetProfile.teamQueuesEnabled).toBe(false);
    expect(board.fleetProfile.eligibleMemberCount).toBe(1);

    // No team queue and no unassigned queue: both are meaningless alone.
    expect(queue(board, "team")).toBeUndefined();

    const mine = queue(board, "my_needs_you")!;
    expect(mine.count).toBeGreaterThan(0);
    // A one-person carrier's work is OWNED, never "nobody has it".
    expect(queue(board, "unassigned")?.count ?? 0).toBe(0);
    for (const item of mine.items) {
      expect(item.responsible.membershipId).toBe(ctx.membershipId);
      expect(item.responsible.source).not.toBe("fallback");
    }
  });

  it("answers the one onboarding question and reshapes itself with nothing else asked", async () => {
    const ctx = contextFor(BAXTER_OWNER);

    const one = await responsibility.setFleetSize(ctx, 1);
    expect(one.tier).toBe("solo");
    expect(one.escalationLevels).toBe(1);

    const forty = await responsibility.setFleetSize(ctx, 40);
    expect(forty.tier).toBe("large");
    // The tier allows team queues. There is still only one person, so no.
    expect(forty.teamQueuesEnabled).toBe(false);
    expect(forty.summary).toMatch(/somebody else joins|switch/i);
  });

  it("refuses a fleet size that is not a number of trucks", async () => {
    const ctx = contextFor(BAXTER_OWNER);
    await expect(responsibility.setFleetSize(ctx, -3)).rejects.toThrow(/whole number/i);
  });
});

/* -------------------------------------------------------------------------- */
/* A carrier with a team                                                       */
/* -------------------------------------------------------------------------- */

describe("a carrier with a team routes by what people can do, never by title", () => {
  it("spreads work across the people who can actually do it", async () => {
    const items = await allWork(NORTHLINE_OWNER);
    const holders = new Set(items.map((i) => i.responsible.displayName));
    expect(holders.size).toBeGreaterThan(1);
  });

  it("sends maintenance work to the shop, which holds maintenance permissions", async () => {
    const items = await allWork(NORTHLINE_OWNER);
    const maintenance = items.filter((i) => i.functionKey === "maintenance");
    expect(maintenance.length).toBeGreaterThan(0);

    const shop = contextFor(NORTHLINE_SHOP);
    for (const item of maintenance) {
      expect(item.responsible.membershipId).toBe(shop.membershipId);
    }

    // And the reason is a permission, not the word "shop". Strip the
    // permissions and the same person stops being the answer.
    const verdicts = await responsibility.explain(
      contextFor(NORTHLINE_OWNER),
      { kind: maintenance[0].work.kind, id: maintenance[0].work.id },
    );
    const refused = verdicts.filter((v) => !v.eligible);
    expect(refused.some((v) => v.failures.includes("missing_permission"))).toBe(true);
  });

  it("sends the money work to the bookkeeper and dispatch work to a dispatcher", async () => {
    const items = await allWork(NORTHLINE_OWNER);
    const books = contextFor(NORTHLINE_BOOKS).membershipId;
    const paige = contextFor(NORTHLINE_PAIGE).membershipId;

    const invoicesAndSettlements = items.filter(
      (i) => i.responsible.source !== "fallback"
        && /INV-|NL-STL-|disput/i.test(i.work.label),
    );
    expect(invoicesAndSettlements.length).toBeGreaterThan(0);
    expect(invoicesAndSettlements.every((i) => i.responsible.membershipId === books))
      .toBe(true);

    const dispatch = items.filter(
      (i) => i.functionKey === "dispatch" && i.responsible.source !== "fallback",
    );
    expect(dispatch.length).toBeGreaterThan(0);
    expect(dispatch.some((i) => i.responsible.membershipId === paige)).toBe(true);
  });

  it("puts work with whoever can actually do it, even when the label says otherwise", async () => {
    // A missing fuel receipt is classified `finance` — it is money — but doing
    // something about it means uploading a document, which the bookkeeper's
    // permissions do not include and a dispatcher's do. The engine follows the
    // permissions rather than the label, which is the whole instruction, and
    // this is what that looks like when it disagrees with the obvious answer.
    const items = await allWork(NORTHLINE_OWNER);
    const receipts = items.filter((i) => /receipt missing/i.test(i.work.label));
    expect(receipts.length).toBeGreaterThan(0);
    expect(receipts.every((i) => i.responsible.membershipId !== contextFor(NORTHLINE_BOOKS).membershipId))
      .toBe(true);
  });

  it("never hands anybody work they do not hold the permissions for", async () => {
    // The universal version of the rule, over every routed item in the
    // workspace, checked against the membership's own permissions rather than
    // against the engine that chose them — so this fails if routing ever starts
    // agreeing with itself for the wrong reason.
    //
    // Fallback items are the documented exception: when nobody can do the work
    // the Owner holds it anyway rather than it becoming ownerless, and
    // `missing_permission` escalates it.
    const items = await allWork(NORTHLINE_OWNER);
    await loadNeedsYou(NORTHLINE_OWNER);
    const routed = items.filter((i) => i.responsible.source === "default_policy");
    expect(routed.length).toBeGreaterThan(0);

    for (const item of routed) {
      const holder = memberById(item.responsible.membershipId)!;
      expect(holder.status).toBe("active");
      expect(holder.takesWork).toBe(true);
      const context = item.work.kind === "needs_you"
        ? responsibilityContextForNeedsYou(needsYouById(item.work.id)!)
        : undefined;
      for (const key of context?.requires ?? []) {
        expect(holder.permissions.has(key)).toBe(true);
      }
    }
  });

  it("never routes work to somebody who is off shift", async () => {
    // Ivy is on nights and the fixtures say so. She holds the dispatcher
    // permissions and is still not handed daytime work.
    const items = await allWork(NORTHLINE_OWNER);
    expect(items.every((i) => i.responsible.displayName !== "Ivy Delgado")).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Driver-action routing                                                       */
/* -------------------------------------------------------------------------- */

describe("driver-action work goes to the driver and nobody else", () => {
  it("keeps a driver's queue to their own work", async () => {
    const board = await responsibility.board(contextFor(CASCADE_DRIVER));
    const mine = queue(board, "my_needs_you")!;

    // A driver sees no team and no whole-organization view.
    expect(queue(board, "team")).toBeUndefined();
    expect(queue(board, "all_organization")).toBeUndefined();

    for (const item of mine.items) {
      expect(item.responsible.membershipId).toBe("mem_cascade_driver");
    }
  });

  it("does not make a driver responsible for dispatching", async () => {
    const board = await responsibility.board(contextFor(CASCADE_DRIVER));
    const mine = queue(board, "my_needs_you")!;
    expect(mine.items.every((i) => i.functionKey !== "dispatch")).toBe(true);
  });

  it("leaves the carrier's own driver work with the driver rather than the Owner", async () => {
    const items = await allWork(NORTHLINE_OWNER);
    const wes = contextFor(NORTHLINE_DRIVER).membershipId;
    const driverWork = items.filter((i) => i.responsible.membershipId === wes);
    // Whatever Wes holds, it is driver work — never a desk's.
    for (const item of driverWork) {
      expect(["driver_action", "documents", "compliance", "maintenance"])
        .toContain(item.functionKey);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Dispatch organizations and carrier delegation                               */
/* -------------------------------------------------------------------------- */

describe("a dispatch organization keeps its carriers apart inside one workspace", () => {
  it("routes a carrier's truck to the dispatcher who holds that carrier", async () => {
    const ops = contextFor(MERIDIAN_OPS);
    const board = await responsibility.board(ops);
    const all = queue(board, "all_organization")!;

    // Lane holds Baxter, and Baxter's truck is his.
    const baxterWork = all.items.find(
      (i) => i.scope.some((s) => s.kind === "carrier" && s.id === "org_baxter"),
    );
    expect(baxterWork).toBeTruthy();
    expect(baxterWork!.responsible.membershipId).toBe(MERIDIAN_LANE);
    expect(baxterWork!.responsible.source).toBe("delegation");
  });

  it("refuses a dispatcher work for a carrier they do not hold", async () => {
    const ops = contextFor(MERIDIAN_OPS);
    const board = await responsibility.board(ops);
    const all = queue(board, "all_organization")!;

    // A truck belonging to a carrier that is NOT Baxter.
    const otherCarrierWork = all.items.find(
      (i) => i.scope.some(
        (s) => s.kind === "carrier" && s.id && s.id !== "org_baxter",
      ),
    );
    expect(otherCarrierWork).toBeTruthy();

    const verdicts = await responsibility.explain(
      ops, { kind: otherCarrierWork!.work.kind, id: otherCarrierWork!.work.id },
    );
    const lane = verdicts.find((v) => v.membershipId === MERIDIAN_LANE)!;
    // Not a permission problem — Lane is a fully-equipped dispatcher. A scope
    // one, and the verdict says which.
    expect(lane.eligible).toBe(false);
    expect(lane.failures).toContain("out_of_scope");
    expect(lane.failures).not.toContain("missing_permission");

    const ines = verdicts.find((v) => v.membershipId === MERIDIAN_INES);
    if (ines && otherCarrierWork!.scope.every((s) => s.id !== "org_cascade")) {
      expect(ines.eligible).toBe(false);
    }
  });

  it("never lets one workspace see another's work", async () => {
    const meridian = await allWork(MERIDIAN_OPS);
    const summit = await allWork(SUMMIT_OWNER);

    const meridianIds = new Set(meridian.map((i) => i.work.id));
    expect(summit.every((i) => !meridianIds.has(i.work.id))).toBe(true);
    expect(meridian.every((i) => i.organizationId === "org_meridian")).toBe(true);
    expect(summit.every((i) => i.organizationId === "org_summit")).toBe(true);
  });

  it("gives the same answer for a membership in another workspace and one that does not exist", async () => {
    const summit = contextFor(SUMMIT_OWNER);
    const items = await allWork(SUMMIT_OWNER);
    const work = { kind: items[0].work.kind, id: items[0].work.id };

    await expect(responsibility.reassign(summit, work, {
      toMembershipId: MERIDIAN_LANE, note: "Trying to reach into Meridian.",
    })).rejects.toThrow(/not found/i);

    await expect(responsibility.reassign(summit, work, {
      toMembershipId: "mem_does_not_exist", note: "Trying a made-up id.",
    })).rejects.toThrow(/not found/i);
  });

  it("falls back to the dispatch organization's own Owner, not to a carrier's", async () => {
    const ops = contextFor(MERIDIAN_OPS);
    const board = await responsibility.board(ops);
    const fallbacks = queue(board, "all_organization")!.items
      .filter((i) => i.responsible.source === "fallback");

    for (const item of fallbacks) {
      expect(item.responsible.displayName).toBe("Nadia Rahimi");
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Owner oversight without overload                                            */
/* -------------------------------------------------------------------------- */

describe("the Owner keeps oversight without getting every routine item", () => {
  it("leaves routine delegated work out of the Owner's personal list and in the organization view", async () => {
    const ctx = contextFor(SUMMIT_OWNER);
    const board = await responsibility.board(ctx);
    const personal = [
      ...queue(board, "my_mt_loop")!.items,
      ...queue(board, "my_needs_you")!.items,
    ];
    const everything = queue(board, "all_organization")!.items;

    expect(everything.length).toBeGreaterThan(personal.length);

    const personalIds = new Set(personal.map((i) => i.id));
    const excluded = everything.filter((i) => !personalIds.has(i.id));
    expect(excluded.length).toBeGreaterThan(0);

    for (const item of excluded) {
      // Everything kept out is somebody else's, and routine: not critical, not
      // escalated, and not waiting on the Owner for anything.
      expect(item.responsible.membershipId).not.toBe(ctx.membershipId);
      expect(item.severity).not.toBe("critical");
      expect(item.escalations.some((e) => e.level >= 2 && e.trigger !== "high_severity"))
        .toBe(false);
    }
  });

  it("still makes the Owner accountable for the work it kept out of their list", async () => {
    const ctx = contextFor(SUMMIT_OWNER);
    const board = await responsibility.board(ctx);
    const everything = queue(board, "all_organization")!.items;
    const delegated = everything.filter(
      (i) => i.responsible.membershipId !== ctx.membershipId,
    );

    expect(delegated.length).toBeGreaterThan(0);
    expect(board.counts.oversight).toBe(delegated.length);
    for (const item of delegated) {
      expect(item.accountable.membershipId).toBe(ctx.membershipId);
    }
  });

  it("watches delegated work without owning it", async () => {
    const items = await allWork(NORTHLINE_OWNER);
    const owner = contextFor(NORTHLINE_OWNER).membershipId;
    const delegated = items.find(
      (i) => i.responsible.membershipId !== owner && i.accountable.membershipId !== owner,
    );
    if (delegated) {
      expect(delegated.watchers.some((w) => w.membershipId === owner)).toBe(true);
      expect(delegated.watchers.every((w) => w.role === "watcher")).toBe(true);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Escalation without reassignment                                             */
/* -------------------------------------------------------------------------- */

describe("SLA escalation never moves the work by itself", () => {
  async function anEscalatedItem(): Promise<ResponsibilityAssignment> {
    const board = await responsibility.board(contextFor(NORTHLINE_OWNER));
    const escalated = queue(board, "escalated")!;
    expect(escalated.count).toBeGreaterThan(0);
    return escalated.items[0];
  }

  it("leaves the assignee exactly where they were after a rung fires", async () => {
    const item = await anEscalatedItem();
    expect(item.escalations.some((e) => e.level >= 2)).toBe(true);
    // Nothing on the timeline moved the work.
    expect(item.timeline.some((t) => t.action === "reassigned")).toBe(false);
    expect(["default_policy", "delegation", "fallback"])
      .toContain(item.responsible.source);
  });

  it("keeps the original assignee responsible when a person escalates by hand", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const items = await allWork(NORTHLINE_OWNER);
    const target = items.find((i) => i.can.escalate && i.responsible.membershipId !== ctx.membershipId)
      ?? items.find((i) => i.can.escalate)!;
    const before = target.responsible.membershipId;

    const after = await responsibility.escalate(
      ctx, { kind: target.work.kind, id: target.work.id }, "Nobody has moved this all day.",
    );

    // ★ The central rule. ★
    expect(after.responsible.membershipId).toBe(before);
    expect(after.timeline.some((t) => t.action === "escalated")).toBe(true);
    // What changed is that the accountable membership can now see it.
    expect(after.watchers.some((w) => w.membershipId === after.accountable.membershipId))
      .toBe(true);
  });

  it("refuses an escalation with no reason", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const items = await allWork(NORTHLINE_OWNER);
    const target = items.find((i) => i.can.escalate)!;
    await expect(responsibility.escalate(
      ctx, { kind: target.work.kind, id: target.work.id }, "   ",
    )).rejects.toThrow(/reason/i);
  });

  it("stops the acknowledgement clock without stopping the resolution one", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const items = await allWork(NORTHLINE_OWNER);
    const target = items.find((i) => i.can.acknowledge && !i.acknowledgedAt)!;

    const after = await responsibility.acknowledge(
      ctx, { kind: target.work.kind, id: target.work.id },
    );
    expect(after.sla.acknowledge.state).toBe("met");
    expect(after.acknowledgedAt).toBeTruthy();
    expect(["on_track", "due_soon", "breached", "paused"])
      .toContain(after.sla.resolve.state);
  });

  it("quiets the reminder when somebody keeps the work, and nothing else", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const items = await allWork(NORTHLINE_OWNER);
    const target = items.find((i) => i.can.keep)!;

    const after = await responsibility.keep(
      ctx, { kind: target.work.kind, id: target.work.id }, "On it this afternoon.",
    );
    expect(after.timeline.some((t) => t.action === "kept")).toBe(true);
    expect(after.responsible.membershipId).toBe(target.responsible.membershipId);
    for (const state of after.escalations) {
      expect(state.reached.some((s) => s.action === "reminder")).toBe(false);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Override and takeover                                                       */
/* -------------------------------------------------------------------------- */

describe("an authorized person can override the default", () => {
  it("delegates the work and leaves accountability where it was", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const items = await allWork(NORTHLINE_OWNER);
    const target = items.find(
      (i) => i.can.delegate && i.functionKey === "dispatch",
    )!;
    const accountableBefore = target.accountable.membershipId;

    const after = await responsibility.delegate(
      ctx, { kind: target.work.kind, id: target.work.id },
      { toMembershipId: NORTHLINE_PAIGE, note: "Paige knows this lane." },
    );

    expect(after.responsible.membershipId).toBe(NORTHLINE_PAIGE);
    expect(after.responsible.source).toBe("manual");
    // The difference between delegating and reassigning, in one assertion.
    expect(after.accountable.membershipId).toBe(accountableBefore);
    expect(after.timeline.some((t) => t.action === "delegated")).toBe(true);
  });

  it("reassigns, and lets accountability re-derive from where it landed", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const items = await allWork(NORTHLINE_OWNER);
    const target = items.find(
      (i) => i.can.reassign && i.functionKey === "dispatch",
    )!;

    const after = await responsibility.reassign(
      ctx, { kind: target.work.kind, id: target.work.id },
      { toMembershipId: NORTHLINE_PAIGE, note: "Swapping desks for the week." },
    );
    expect(after.responsible.membershipId).toBe(NORTHLINE_PAIGE);
    expect(after.accountable.membershipId).toBeTruthy();
  });

  it("lets a manager assign ahead of a permission, and escalates rather than undoing it", async () => {
    // A real thing managers do: hand somebody work on Friday and grant the
    // permission on Monday. The engine must not quietly route it back — it
    // raises `missing_permission`, which is what that trigger is for.
    const ctx = contextFor(NORTHLINE_OWNER);
    const items = await allWork(NORTHLINE_OWNER);
    const target = items.find(
      (i) => i.can.reassign && i.functionKey === "finance",
    )!;
    const key = { kind: target.work.kind, id: target.work.id };

    const after = await responsibility.reassign(ctx, key, {
      toMembershipId: NORTHLINE_PAIGE, note: "Paige is covering the books.",
    });
    expect(after.responsible.membershipId).toBe(NORTHLINE_PAIGE);

    const reread = await responsibility.get(ctx, key);
    expect(reread.responsible.membershipId).toBe(NORTHLINE_PAIGE);
    expect(reread.escalations.some((e) => e.trigger === "missing_permission")).toBe(true);
  });

  it("takes work over, and records who it came from", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const items = await allWork(NORTHLINE_OWNER);
    const target = items.find(
      (i) => i.can.takeOver && i.responsible.membershipId !== ctx.membershipId,
    )!;
    const from = target.responsible.displayName;

    const after = await responsibility.takeOver(
      ctx, { kind: target.work.kind, id: target.work.id }, "I am on the phone to them now.",
    );
    expect(after.responsible.membershipId).toBe(ctx.membershipId);
    expect(after.responsible.source).toBe("takeover");
    expect(after.timeline.some((t) => t.action === "taken_over" && t.note.includes(from)))
      .toBe(true);
  });

  it("changes who is accountable without touching who is doing the work", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const items = await allWork(NORTHLINE_OWNER);
    const target = items.find((i) => i.can.changeAccountable)!;
    const doer = target.responsible.membershipId;

    const after = await responsibility.changeAccountable(
      ctx, { kind: target.work.kind, id: target.work.id },
      { toMembershipId: NORTHLINE_PAIGE, note: "Paige is covering the desk." },
    );
    expect(after.accountable.membershipId).toBe(NORTHLINE_PAIGE);
    expect(after.responsible.membershipId).toBe(doer);
  });

  it("refuses somebody without the authority to move work", async () => {
    const ctx = contextFor(NORTHLINE_BOOKS);
    const board = await responsibility.board(ctx);
    const mine = queue(board, "my_needs_you")!.items;
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((i) => !i.can.reassign && !i.can.delegate)).toBe(true);

    await expect(responsibility.reassign(
      ctx, { kind: mine[0].work.kind, id: mine[0].work.id },
      { toMembershipId: NORTHLINE_PAIGE, note: "Trying anyway." },
    )).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("refuses an override with no reason", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const items = await allWork(NORTHLINE_OWNER);
    const target = items.find((i) => i.can.reassign)!;
    await expect(responsibility.reassign(
      ctx, { kind: target.work.kind, id: target.work.id },
      { toMembershipId: NORTHLINE_PAIGE, note: "" },
    )).rejects.toThrow(/reason/i);
  });
});

/* -------------------------------------------------------------------------- */
/* Somebody leaves                                                             */
/* -------------------------------------------------------------------------- */

describe("when a membership ends, the work moves and the history does not", () => {
  it("routes unresolved work on rather than leaving it with somebody who is gone", async () => {
    const ctx = contextFor(SUMMIT_OWNER);
    const items = await allWork(SUMMIT_OWNER);
    const target = items.find((i) => i.can.reassign)!;
    const key = { kind: target.work.kind, id: target.work.id };

    await responsibility.reassign(ctx, key, {
      toMembershipId: SUMMIT_DEVON, note: "Devon has the afternoon.",
    });
    const held = await responsibility.get(ctx, key);
    expect(held.responsible.membershipId).toBe(SUMMIT_DEVON);
    const timelineBefore = held.timeline.length;

    // Devon leaves.
    setMembershipStatus(SUMMIT_DEVON, "left");

    const after = await responsibility.get(ctx, key);
    expect(after.responsible.membershipId).not.toBe(SUMMIT_DEVON);
    expect(after.responsible.source).toBe("fallback");
    expect(after.accountable.membershipId).toBeTruthy();

    // Nothing was deleted. The whole chain still reads.
    expect(after.timeline.length).toBeGreaterThan(timelineBefore);
    expect(after.timeline.some((t) => t.subjectMembershipId === SUMMIT_DEVON)).toBe(true);
    expect(after.timeline.some((t) => t.action === "fallback_applied")).toBe(true);
  });

  it("leaves work with somebody who is merely away, and escalates instead", async () => {
    const ctx = contextFor(SUMMIT_OWNER);
    const items = await allWork(SUMMIT_OWNER);
    const target = items.find((i) => i.can.reassign)!;
    const key = { kind: target.work.kind, id: target.work.id };

    await responsibility.reassign(ctx, key, {
      toMembershipId: SUMMIT_DEVON, note: "Devon has this.",
    });
    setMembershipAvailability(SUMMIT_DEVON, "on_leave");

    const after = await responsibility.get(ctx, key);
    // Being on leave is not a reason to take somebody's work off them.
    expect(after.responsible.membershipId).toBe(SUMMIT_DEVON);
    expect(after.responsible.available).toBe(false);
    expect(after.escalations.some((e) => e.trigger === "assignee_unavailable")).toBe(true);
  });

  it("never routes anything to a suspended membership", async () => {
    const items = await allWork(MERIDIAN_OPS);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.responsible.membershipId !== MERIDIAN_SUSPENDED)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* The timeline                                                                */
/* -------------------------------------------------------------------------- */

describe("the timeline is append-only", () => {
  it("records every kind of action and rewrites none of them", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const items = await allWork(NORTHLINE_OWNER);
    const target = items.find((i) => i.can.reassign && i.can.acknowledge)!;
    const key = { kind: target.work.kind, id: target.work.id };

    const first = (await responsibility.get(ctx, key)).timeline;
    expect(first.length).toBeGreaterThan(0);

    await responsibility.acknowledge(ctx, key);
    await responsibility.delegate(ctx, key, {
      toMembershipId: NORTHLINE_PAIGE, note: "Over to Paige.",
    });
    await responsibility.escalate(ctx, key, "Still not moving.");
    const after = (await responsibility.get(ctx, key)).timeline;

    // Everything that was there is still there, unchanged and in order.
    expect(after.length).toBeGreaterThan(first.length);
    expect(after.slice(0, first.length).map((t) => t.id)).toEqual(first.map((t) => t.id));

    const actions = after.map((t) => t.action);
    expect(actions).toContain("acknowledged");
    expect(actions).toContain("delegated");
    expect(actions).toContain("escalated");
    for (const entry of after) {
      expect(entry.at).toBeTruthy();
      expect(entry.actorName).toBeTruthy();
      expect(entry.note).toBeTruthy();
    }
  });

  it("snapshots names, so a line still reads after the person is gone", async () => {
    const ctx = contextFor(SUMMIT_OWNER);
    const items = await allWork(SUMMIT_OWNER);
    const target = items.find((i) => i.can.reassign)!;
    const key = { kind: target.work.kind, id: target.work.id };

    await responsibility.reassign(ctx, key, {
      toMembershipId: SUMMIT_DEVON, note: "Devon has it.",
    });
    setMembershipStatus(SUMMIT_DEVON, "left");

    const after = await responsibility.get(ctx, key);
    const line = after.timeline.find((t) => t.subjectMembershipId === SUMMIT_DEVON)!;
    expect(line.subjectName).toBe("Devon Pike");
  });
});

/* -------------------------------------------------------------------------- */
/* Progressive disclosure                                                      */
/* -------------------------------------------------------------------------- */

describe("everything structural is behind settings", () => {
  it("seeds policies nobody was asked to choose, and lets an Owner edit them", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const policies = await responsibility.policies(ctx);
    expect(policies.length).toBeGreaterThan(0);
    expect(policies.every((p) => p.seeded)).toBe(true);

    const next = await responsibility.updatePolicy(ctx, policies[0].id, {
      sla: { acknowledgeMinutes: 5, resolveMinutes: 45 },
    });
    expect(next.sla.acknowledgeMinutes).toBe(5);
    expect((await responsibility.policies(ctx))[0].sla.resolveMinutes).toBe(45);
  });

  it("offers no way to delete a policy at all", () => {
    // A workspace with no policy is a workspace where nothing escalates.
    expect("deletePolicy" in responsibility).toBe(false);
  });

  it("keeps policy editing away from somebody who only dispatches", async () => {
    const ctx = contextFor(MERIDIAN_DISPATCHER);
    await expect(responsibility.policies(ctx)).rejects.toBeInstanceOf(PermissionDeniedError);
    const board = await responsibility.board(ctx);
    expect(board.mayCustomize).toBe(false);
  });

  it("answers 'who can I hand this to' from the one directory", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const assignable = await responsibility.assignable(ctx);
    expect(assignable.length).toBeGreaterThan(1);
    expect(assignable.every((m) => m.displayName)).toBe(true);

    // In a workspace of one the honest answer is yourself, never an empty list.
    const alone = await responsibility.assignable(contextFor(BAXTER_OWNER));
    expect(alone).toHaveLength(1);
    expect(alone[0].membershipId).toBe("mem_baxter_owner");
  });
});
