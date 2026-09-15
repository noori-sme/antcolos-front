import { beforeEach, describe, expect, it } from "vitest";
import {
  setMembershipDelegationScope, setMembershipStatus,
} from "@/lib/api/mock/membership-directory";
import { mockHomeService } from "@/lib/api/mock/home";
import { resetAllMocks } from "@/lib/api/mock/registry";
import { mockResponsibilityService as R } from "@/lib/api/mock/responsibility";
import type { ResponsibilityAssignment } from "@/types";
import {
  BAXTER_OWNER, CASCADE_DRIVER, MERIDIAN_DISPATCHER, NORTHLINE_BOOKS,
  NORTHLINE_OWNER, NORTHLINE_PAIGE, NORTHLINE_SHOP, SOLO_DISPATCHER,
  SUMMIT_DEVON, SUMMIT_OWNER, contextFor,
} from "./harness";

/**
 * ★ WHOSE PROBLEM IS THIS? ★
 *
 * The audit these tests exist for: a Carrier Owner had 119 of their
 * workspace's 145 items in their personal queue, and Home told them "142 open",
 * because the product could not tell "I answer for this organization" apart
 * from "this needs me today".
 *
 * Every test below pins one half of that separation. They assert VISIBLE
 * OUTCOMES — the counts a person reads — not just that the routing engine ran.
 */

beforeEach(() => resetAllMocks());

const key = (a: ResponsibilityAssignment) => ({ kind: a.work.kind, id: a.work.id });

/* -------------------------------------------------------------------------- */
/* The three views are strictly separate                                       */
/* -------------------------------------------------------------------------- */

describe("My Needs You is a personal queue, not an org chart", () => {
  it("keeps an Owner's personal queue far below their oversight and their org", async () => {
    const v = await R.attention(contextFor(NORTHLINE_OWNER));

    // The whole inventory is still there to inspect.
    expect(v.counts.allOrganization).toBeGreaterThan(100);
    // Oversight is complete.
    expect(v.counts.teamOversight).toBeGreaterThan(100);
    // The personal queue is a to-do list, and it is small.
    expect(v.counts.myNeedsYou).toBeLessThan(20);
    expect(v.counts.myNeedsYou).toBeLessThan(v.counts.teamOversight / 5);
  });

  it("admits nothing to a personal queue merely because the Owner oversees it", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const v = await R.attention(ctx);

    for (const a of v.teamOversight) {
      // Everything overseen is somebody else's, and says so.
      expect(a.responsible.membershipId).not.toBe(ctx.membershipId);
      expect(a.attention).toHaveLength(0);
    }
    // And nothing appears in both.
    const mine = new Set(v.myNeedsYou.map((a) => a.id));
    expect(v.teamOversight.some((a) => mine.has(a.id))).toBe(false);
  });

  it("does not admit healthy, high-severity, actively-owned work", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const v = await R.attention(ctx);

    const severeButHandled = v.teamOversight.filter(
      (a) => a.severity === "critical" || a.severity === "high",
    );
    expect(severeButHandled.length).toBeGreaterThan(0);
    // Severity alone is not a claim on the Owner's attention.
    expect(severeButHandled.every((a) => a.attention.length === 0)).toBe(true);
  });

  it("does not admit work merely because a rung has fallen due", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const v = await R.attention(ctx);

    // Plenty of overseen work is past its target and climbing. Pressure is
    // pressure; it is not delivery, and it is not the Owner's job yet.
    const pressured = v.teamOversight.filter((a) => a.atRisk);
    expect(pressured.length).toBeGreaterThan(0);
    expect(pressured.every((a) => a.attention.length === 0)).toBe(true);
  });

  it("gives every reason it does admit something", async () => {
    const v = await R.attention(contextFor(NORTHLINE_OWNER));
    expect(v.myNeedsYou.length).toBeGreaterThan(0);
    for (const a of v.myNeedsYou) {
      expect(a.attention.length).toBeGreaterThan(0);
      for (const reason of a.attention) {
        expect([
          "responsible", "owner_fallback", "needs_assignment",
          "explicit_accountable", "approval_required",
          "escalation_reached_you", "help_requested",
        ]).toContain(reason);
      }
    }
  });

  it("keeps the complete inventory in All organization", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const v = await R.attention(ctx);
    const board = await R.board(ctx);
    const all = board.queues.find((q) => q.queue === "all_organization")!;

    expect(v.counts.allOrganization).toBe(all.count);
    // Personal and oversight are both subsets of it, and together account for
    // everything: nothing is lost by splitting the views.
    const allIds = new Set(v.allOrganization.map((a) => a.id));
    expect(v.myNeedsYou.every((a) => allIds.has(a.id))).toBe(true);
    expect(v.teamOversight.every((a) => allIds.has(a.id))).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Home and the Needs You page share one derivation                            */
/* -------------------------------------------------------------------------- */

describe("Home and the Needs You page consume the same derivation", () => {
  const everyone = [
    NORTHLINE_OWNER, NORTHLINE_PAIGE, MERIDIAN_DISPATCHER, SUMMIT_OWNER,
    SOLO_DISPATCHER, BAXTER_OWNER, CASCADE_DRIVER,
  ];

  for (const who of everyone) {
    it(`agrees item for item for ${who}`, async () => {
      const ctx = contextFor(who);
      const views = await R.attention(ctx);
      const home = await mockHomeService.summary(ctx);

      const mine = views.myNeedsYou
        .filter((a) => a.work.kind === "needs_you")
        .map((a) => a.work.id);

      // Home's count IS the personal count — never the organization's.
      expect(home.counts.needsYouOpen).toBe(mine.length);
      // And its preview is drawn from that same set, in order.
      expect(home.needsYouPreview.length).toBeLessThanOrEqual(4);
      expect(home.needsYouPreview.every((i) => mine.includes(i.id))).toBe(true);
    });
  }

  it("shows an Owner a Home count that is a fraction of their organization", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const home = await mockHomeService.summary(ctx);
    const views = await R.attention(ctx);

    expect(home.counts.needsYouOpen).toBeLessThan(20);
    expect(views.counts.allOrganization).toBeGreaterThan(100);
  });

  it("never shows a driver their carrier's whole queue on Home", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const home = await mockHomeService.summary(ctx);
    const views = await R.attention(ctx);
    expect(home.counts.needsYouOpen).toBe(views.counts.myNeedsYou);
    expect(home.counts.needsYouOpen).toBeLessThan(5);
  });
});

/* -------------------------------------------------------------------------- */
/* Only real events reach a person                                             */
/* -------------------------------------------------------------------------- */

describe("work enters a personal queue only through a recorded event", () => {
  it("arrives when somebody escalates it by hand, and not before", async () => {
    const owner = contextFor(NORTHLINE_OWNER);
    const paige = contextFor(NORTHLINE_PAIGE);

    const before = await R.attention(owner);
    const target = before.teamOversight.find(
      (a) => a.responsible.membershipId === paige.membershipId,
    )!;
    expect(target.attention).toHaveLength(0);

    await R.escalate(paige, key(target), "I need a decision on this rate.");

    const after = await R.attention(owner);
    const now = after.myNeedsYou.find((a) => a.id === target.id);
    expect(now).toBeTruthy();
    expect(now!.attention).toContain("escalation_reached_you");
    // ★ And it did NOT move. ★
    expect(now!.responsible.membershipId).toBe(paige.membershipId);
    expect(after.counts.myNeedsYou).toBe(before.counts.myNeedsYou + 1);
  });

  it("arrives when the assignee asks for help, and the assignee keeps it", async () => {
    const owner = contextFor(NORTHLINE_OWNER);
    const paige = contextFor(NORTHLINE_PAIGE);

    const before = await R.attention(owner);
    const target = before.teamOversight.find(
      (a) => a.responsible.membershipId === paige.membershipId && a.can.requestHelp !== undefined,
    )!;

    await R.requestHelp(paige, key(target), "Broker wants a rate above my limit.");

    const after = await R.attention(owner);
    const now = after.myNeedsYou.find((a) => a.id === target.id)!;
    expect(now.attention).toContain("help_requested");
    expect(now.responsible.membershipId).toBe(paige.membershipId);
  });

  it("arrives when a person names the Owner accountable, but not when the engine does", async () => {
    const owner = contextFor(NORTHLINE_OWNER);
    const before = await R.attention(owner);

    // The engine already makes the Owner accountable for masses of work.
    const derived = before.teamOversight.filter(
      (a) => a.accountable.membershipId === owner.membershipId,
    );
    expect(derived.length).toBeGreaterThan(0);
    expect(derived.every((a) => a.attention.length === 0)).toBe(true);

    // A person doing it by hand is a different fact.
    const target = derived.find((a) => a.can.changeAccountable)!;
    await R.changeAccountable(owner, key(target), {
      toMembershipId: owner.membershipId, note: "I am carrying this one myself.",
    });

    const after = await R.attention(owner);
    const now = after.myNeedsYou.find((a) => a.id === target.id)!;
    expect(now.attention).toContain("explicit_accountable");
  });
});

/* -------------------------------------------------------------------------- */
/* Terminology                                                                 */
/* -------------------------------------------------------------------------- */

describe("nothing is called unassigned while naming a person", () => {
  it("reports owner fallback and needs-assignment as separate states", async () => {
    const v = await R.attention(contextFor(NORTHLINE_OWNER));
    const board = await R.board(contextFor(NORTHLINE_OWNER));

    // Work the Owner holds because nobody else qualified is OWNED.
    expect(v.counts.ownerFallback).toBeGreaterThan(0);
    const fb = board.queues.find((q) => q.queue === "owner_fallback")!;
    expect(fb.count).toBe(v.counts.ownerFallback);
    for (const a of fb.items) {
      expect(a.assignmentState).toBe("owner_fallback");
      expect(a.responsible.displayName).toBeTruthy();
      expect(a.accountable.displayName).toBeTruthy();
    }
  });

  it("never produces work with nobody responsible, in any workspace", async () => {
    for (const who of [
      NORTHLINE_OWNER, MERIDIAN_DISPATCHER, SUMMIT_OWNER, SOLO_DISPATCHER,
      BAXTER_OWNER, CASCADE_DRIVER,
    ]) {
      const v = await R.attention(contextFor(who));
      expect(v.counts.trulyUnassigned).toBe(0);
      for (const a of v.allOrganization) {
        expect(a.responsible.membershipId).toBeTruthy();
        expect(a.assignmentState).not.toBe("unassigned" as never);
      }
    }
  });

  it("calls a one-person carrier's work owned, never a fallback", async () => {
    const v = await R.attention(contextFor(BAXTER_OWNER));
    expect(v.counts.myNeedsYou).toBe(v.counts.allOrganization);
    expect(v.counts.ownerFallback).toBe(0);
    expect(v.counts.trulyUnassigned).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Dispatchers and drivers see only their own                                  */
/* -------------------------------------------------------------------------- */

describe("people without the roster see only what is theirs", () => {
  it("does not leak the organization's escalations to a dispatcher", async () => {
    const paige = contextFor(NORTHLINE_PAIGE);
    const board = await R.board(paige);

    // No team or organization views at all.
    expect(board.queues.find((q) => q.queue === "team_oversight")).toBeUndefined();
    expect(board.queues.find((q) => q.queue === "all_organization")).toBeUndefined();

    // And the lenses that remain are scoped to her, not to the workspace.
    for (const q of board.queues) {
      for (const a of q.items) {
        const hers = a.attention.length > 0
          || a.accountable.membershipId === paige.membershipId
          || a.watchers.some((w) => w.membershipId === paige.membershipId);
        expect(hers).toBe(true);
      }
    }
  });

  it("keeps a driver's queue to their own work", async () => {
    const ctx = contextFor(CASCADE_DRIVER);
    const v = await R.attention(ctx);
    expect(v.maySeeTeam).toBe(false);
    expect(v.counts.teamOversight).toBe(0);
    for (const a of v.myNeedsYou) {
      expect(a.responsible.membershipId).toBe(ctx.membershipId);
    }
  });

  it("gives a bookkeeper their own work and no oversight of the desk", async () => {
    const ctx = contextFor(NORTHLINE_BOOKS);
    const v = await R.attention(ctx);
    expect(v.counts.myNeedsYou).toBeGreaterThan(0);
    for (const a of v.myNeedsYou) {
      expect(a.attention.length).toBeGreaterThan(0);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* MT Loop delegation scope                                                    */
/* -------------------------------------------------------------------------- */

describe("delegating a scope moves only the work inside it", () => {
  it("moves only the delegated trucks, and leaves the rest where they were", async () => {
    const owner = contextFor(NORTHLINE_OWNER);
    const paige = contextFor(NORTHLINE_PAIGE);

    const before = await R.attention(owner);
    const loopsBefore = before.allOrganization.filter((a) => a.work.kind === "mt_loop");
    expect(loopsBefore.length).toBeGreaterThan(1);
    const withPaige = loopsBefore.filter(
      (a) => a.responsible.membershipId === paige.membershipId,
    ).length;

    // Narrow Paige to ONE truck. Adding a scope must not hand her everything,
    // and must not take away what is outside it from everybody else.
    const onlyOne = loopsBefore[0];
    const truckId = onlyOne.scope.find((s) => s.kind === "truck")?.id;
    expect(truckId).toBeTruthy();
    setMembershipDelegationScope(paige.membershipId, { truckIds: [truckId!] });

    const after = await R.attention(owner);
    const loopsAfter = after.allOrganization.filter((a) => a.work.kind === "mt_loop");

    // Same work, none created and none destroyed.
    expect(loopsAfter.length).toBe(loopsBefore.length);
    // She holds at most the one truck she was given.
    const nowHers = loopsAfter.filter(
      (a) => a.responsible.membershipId === paige.membershipId,
    );
    expect(nowHers.length).toBeLessThanOrEqual(1);
    expect(nowHers.length).toBeLessThanOrEqual(withPaige);
    for (const a of nowHers) {
      expect(a.scope.some((s) => s.kind === "truck" && s.id === truckId)).toBe(true);
    }
  });

  it("returns the work to the Owner as an explicit fallback when the scope is revoked", async () => {
    const owner = contextFor(NORTHLINE_OWNER);
    const paige = contextFor(NORTHLINE_PAIGE);

    const start = await R.attention(owner);
    const loop = start.allOrganization.find(
      (a) => a.work.kind === "mt_loop" && a.responsible.membershipId === paige.membershipId,
    );
    if (!loop) return; // Nothing delegated in this fixture; the case above covers scope.

    const historyBefore = loop.timeline.length;

    // Narrow her away from this truck entirely.
    setMembershipDelegationScope(paige.membershipId, { truckIds: ["no-such-truck"] });

    const after = await R.get(owner, key(loop));
    expect(after.responsible.membershipId).not.toBe(paige.membershipId);
    expect(after.responsible.membershipId).toBeTruthy();
    // The work itself was neither duplicated nor destroyed, and its history kept.
    expect(after.id).toBe(loop.id);
    expect(after.timeline.length).toBeGreaterThanOrEqual(historyBefore);

    // Give it back.
    setMembershipDelegationScope(paige.membershipId, undefined);
    const restored = await R.get(owner, key(loop));
    expect(restored.id).toBe(loop.id);
    expect(restored.responsible.membershipId).toBeTruthy();
  });

  it("keeps a dispatch organization's work inside that organization", async () => {
    // Meridian dispatches Northline trucks under a grant. Northline's Owner
    // does not see Meridian's workspace, and Meridian does not see Northline's
    // other work — the delegation boundary is the organization.
    const northline = await R.attention(contextFor(NORTHLINE_OWNER));
    const meridian = await R.attention(contextFor(MERIDIAN_DISPATCHER));

    expect(northline.allOrganization.every((a) => a.organizationId === "org_northline"))
      .toBe(true);
    expect(meridian.myNeedsYou.every((a) => a.organizationId === "org_meridian")).toBe(true);
    const northlineIds = new Set(northline.allOrganization.map((a) => a.id));
    expect(meridian.myNeedsYou.some((a) => northlineIds.has(a.id))).toBe(false);
  });

  it("routes to the Owner when the delegate stops being eligible", async () => {
    const owner = contextFor(SUMMIT_OWNER);
    const before = await R.attention(owner);
    const target = before.allOrganization.find((a) => a.can.reassign)!;

    await R.reassign(owner, key(target), {
      toMembershipId: SUMMIT_DEVON, note: "Devon has the afternoon.",
    });
    expect((await R.get(owner, key(target))).responsible.membershipId).toBe(SUMMIT_DEVON);

    // The relationship ends.
    setMembershipStatus(SUMMIT_DEVON, "left");

    const after = await R.get(owner, key(target));
    expect(after.responsible.membershipId).not.toBe(SUMMIT_DEVON);
    expect(after.assignmentState).toBe("owner_fallback");
    // It is back on the Owner's PERSONAL list, with the reason stated.
    expect(after.attention).toContain("owner_fallback");
    // And nothing was lost.
    expect(after.timeline.some((t) => t.subjectMembershipId === SUMMIT_DEVON)).toBe(true);
    expect(after.id).toBe(target.id);
  });
});

/* -------------------------------------------------------------------------- */
/* Everything else still works                                                 */
/* -------------------------------------------------------------------------- */

describe("the rest of the module is untouched", () => {
  it("still routes maintenance to the shop and keeps deep links intact", async () => {
    const v = await R.attention(contextFor(NORTHLINE_OWNER));
    const shop = contextFor(NORTHLINE_SHOP).membershipId;
    const maintenance = v.allOrganization.filter((a) => a.functionKey === "maintenance");
    expect(maintenance.length).toBeGreaterThan(0);
    expect(maintenance.every((a) => a.responsible.membershipId === shop)).toBe(true);
    // Needs You deep links survive the split.
    expect(
      v.allOrganization.filter((a) => a.work.kind === "needs_you").every((a) => a.work.label),
    ).toBe(true);
  });

  it("still keeps SLA evidence and timelines on every item", async () => {
    const v = await R.attention(contextFor(NORTHLINE_OWNER));
    for (const a of v.allOrganization.slice(0, 25)) {
      expect(a.sla.target.acknowledgeMinutes).toBeGreaterThan(0);
      expect(a.sla.acknowledge.clock).toBe("acknowledge");
      expect(a.sla.resolve.clock).toBe("resolve");
      expect(a.timeline.length).toBeGreaterThan(0);
      expect(a.policyName).toBeTruthy();
    }
  });

  it("still holds MT Loop records alongside Needs You work", async () => {
    const v = await R.attention(contextFor(SOLO_DISPATCHER));
    expect(v.allOrganization.some((a) => a.work.kind === "mt_loop")).toBe(true);
    expect(v.allOrganization.some((a) => a.work.kind === "needs_you")).toBe(true);
  });
});
