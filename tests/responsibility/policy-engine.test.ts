import { describe, expect, it } from "vitest";
import {
  DEFAULT_LADDER, DEFAULT_POLICIES, FLEET_BANDS, OPTIONAL_REASSIGN_STEP,
  ROUTING_WEIGHTS,
} from "@/config/responsibility";
import {
  bandFor, escalationsFor, evaluateCandidate, hasEscalated, isEscalated,
  movesWork, pendingMoves, policyFor, rankCandidates, routeResponsibility,
  seedPolicies, slaFor,
} from "@/lib/responsibility";
import { ESCALATION_ACTION_MOVES_WORK } from "@/types";
import {
  candidate, driverCandidate, hoursAgo, hoursFromNow, profile, work,
} from "./harness";

/**
 * The policy engine, on its own.
 *
 * These tests never touch a mock store, because the engine never does. That is
 * what lets them prove the case the fixtures cannot supply: a brand-new carrier
 * with one truck, one member and no setup at all, which is the workspace the
 * zero-friction rule is actually about.
 */

/* -------------------------------------------------------------------------- */
/* Fleet size: the one question onboarding asks                                */
/* -------------------------------------------------------------------------- */

describe("fleet size decides the shape, and the people decide whether it switches on", () => {
  it("gives a brand-new one-truck carrier a working model with no setup", () => {
    const owner = candidate({ membershipId: "m_owner", isOwner: true });
    const p = profile(1, [owner]);

    expect(p.tier).toBe("solo");
    // No queues to hand work to, and nothing to configure. That is the point.
    expect(p.teamQueuesEnabled).toBe(false);
    expect(p.supervisorsEnabled).toBe(false);
    expect(p.escalationLevels).toBe(1);

    // And the work is still routed and still owned.
    const routed = routeResponsibility({
      context: work({ requires: ["loads:view"] }),
      members: [owner],
      fleetProfile: p,
    });
    expect(routed.responsible.membershipId).toBe("m_owner");
    expect(routed.accountable.membershipId).toBe("m_owner");
  });

  it("reads the thresholds from config rather than from a literal in the engine", () => {
    // If somebody edits FLEET_BANDS, the engine follows. That is the whole
    // claim of "configurable — not scattered hardcoded checks".
    for (const band of FLEET_BANDS) {
      expect(bandFor(band.minTrucks).tier).toBe(band.tier);
    }
    const midsize = FLEET_BANDS.find((b) => b.tier === "midsize")!;
    expect(bandFor(midsize.minTrucks - 1).tier).not.toBe("midsize");
  });

  it("refuses to switch on a team queue for a big fleet with nobody in it", () => {
    const owner = candidate({ membershipId: "m_owner", isOwner: true });
    const big = profile(40, [owner]);

    expect(big.tier).toBe("large");
    // The tier ALLOWS team queues. There is nobody to queue work to, so no.
    expect(FLEET_BANDS.find((b) => b.tier === "large")!.teamQueuesEnabled).toBe(true);
    expect(big.teamQueuesEnabled).toBe(false);
    expect(big.summary).toMatch(/switch/i);
  });

  it("switches structure on automatically as people arrive, with nobody asked", () => {
    const owner = candidate({ membershipId: "m_owner", isOwner: true });
    const one = candidate({ membershipId: "m_1", supervisorMembershipId: "m_owner" });
    const two = candidate({ membershipId: "m_2", supervisorMembershipId: "m_owner" });

    expect(profile(12, [owner]).teamQueuesEnabled).toBe(false);
    expect(profile(12, [owner, one]).teamQueuesEnabled).toBe(true);
    expect(profile(12, [owner, one]).supervisorsEnabled).toBe(false);
    expect(profile(12, [owner, one, two]).supervisorsEnabled).toBe(true);
  });

  it("does not count drivers toward the office headcount", () => {
    const owner = candidate({ membershipId: "m_owner", isOwner: true });
    const drivers = [1, 2, 3].map((n) =>
      driverCandidate({ membershipId: `m_d${n}`, driverProfileId: `drv_${n}` }));

    // An owner-operator with three drivers is still one person in the office.
    expect(profile(4, [owner, ...drivers]).teamQueuesEnabled).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Eligibility: never a role name                                              */
/* -------------------------------------------------------------------------- */

describe("eligibility is permissions, scope, assignment and availability", () => {
  it("refuses somebody who lacks a permission the work needs, whatever their title", () => {
    const senior = candidate({
      membershipId: "m_senior",
      title: "Senior Operations Director",
      permissions: new Set(["loads:view"]),
    });
    const verdict = evaluateCandidate(senior, {
      context: work({ requires: ["loads:view", "maintenance:manage"] }),
    });

    expect(verdict.eligible).toBe(false);
    expect(verdict.failures).toContain("missing_permission");
    expect(verdict.score).toBe(0);
  });

  it("refuses a suspended membership, and an unavailable one, for different reasons", () => {
    const gone = candidate({ membershipId: "m_gone", status: "suspended", takesWork: false });
    const away = candidate({ membershipId: "m_away", takesWork: false });

    expect(evaluateCandidate(gone, { context: work() }).failures).toContain("not_active");
    expect(evaluateCandidate(away, { context: work() }).failures).toContain("not_available");
  });

  it("treats an empty carrier list as 'not narrowed', never as 'narrowed to nothing'", () => {
    const anyCarrier = candidate({ membershipId: "m_any" });
    const baxterOnly = candidate({
      membershipId: "m_baxter", carrierOrganizationIds: ["org_baxter"],
    });
    const context = work({ carrierOrganizationId: "org_cascade" });

    expect(evaluateCandidate(anyCarrier, { context }).eligible).toBe(true);
    expect(evaluateCandidate(baxterOnly, { context }).eligible).toBe(false);
  });

  it("keeps a driver membership out of work it could not possibly do", () => {
    const driver = driverCandidate({ membershipId: "m_drv", driverProfileId: "drv_1" });

    // Their own defect: yes.
    expect(evaluateCandidate(driver, {
      context: work({
        functionKey: "maintenance",
        driverProfileId: "drv_1",
        requires: ["maintenance:defects:report"],
      }),
    }).eligible).toBe(true);

    // Dispatching a truck: never, however many permissions they collect.
    expect(evaluateCandidate(driver, {
      context: work({ functionKey: "dispatch", requires: ["loads:view"] }),
    }).failures).toContain("out_of_scope");
  });

  it("orders candidates by the weights in config, with the Owner last", () => {
    const owner = candidate({ membershipId: "m_owner", isOwner: true });
    const onTheTruck = candidate({ membershipId: "m_truck", truckIds: ["t1"] });
    const onTheCarrier = candidate({
      membershipId: "m_carrier", carrierOrganizationIds: ["org_c"],
    });

    const ranked = rankCandidates(
      [owner, onTheCarrier, onTheTruck],
      { context: work({ truckId: "t1", carrierOrganizationId: "org_c" }) },
    );

    expect(ranked.map((r) => r.membershipId)).toEqual(["m_truck", "m_carrier", "m_owner"]);
    expect(ROUTING_WEIGHTS.assignedToTruck).toBeGreaterThan(ROUTING_WEIGHTS.carrierDelegation);
    expect(ROUTING_WEIGHTS.owner).toBeLessThan(ROUTING_WEIGHTS.functionMatch);
  });

  it("gives the same answer twice for identical state", () => {
    const a = candidate({ membershipId: "m_a" });
    const b = candidate({ membershipId: "m_b" });
    const first = rankCandidates([a, b], { context: work() }).map((r) => r.membershipId);
    const second = rankCandidates([b, a], { context: work() }).map((r) => r.membershipId);
    expect(first).toEqual(second);
  });
});

/* -------------------------------------------------------------------------- */
/* Routing: nothing is ownerless                                               */
/* -------------------------------------------------------------------------- */

describe("routing always produces an owner", () => {
  it("falls back to the Owner when nobody is eligible, and says so", () => {
    const owner = candidate({ membershipId: "m_owner", isOwner: true, permissions: new Set() });
    const nobody = candidate({ membershipId: "m_nobody", permissions: new Set() });
    const p = profile(3, [owner, nobody]);

    const routed = routeResponsibility({
      context: work({ requires: ["ifta:manage"] }),
      members: [owner, nobody],
      fleetProfile: p,
    });

    expect(routed.responsible.membershipId).toBe("m_owner");
    expect(routed.responsible.source).toBe("fallback");
    expect(routed.usedFallback).toBe(true);
    expect(routed.noEligibleAssignee).toBe(true);
    expect(routed.accountable).toBeTruthy();
  });

  it("routes driver-action work to the driver of record and to nobody else", () => {
    const owner = candidate({ membershipId: "m_owner", isOwner: true });
    const dispatcher = candidate({ membershipId: "m_disp", functions: ["dispatch"] });
    const mine = driverCandidate({ membershipId: "m_mine", driverProfileId: "drv_1" });
    const other = driverCandidate({ membershipId: "m_other", driverProfileId: "drv_2" });
    const members = [owner, dispatcher, mine, other];

    const routed = routeResponsibility({
      context: work({
        functionKey: "driver_action",
        driverProfileId: "drv_1",
        requires: ["documents:upload"],
      }),
      members,
      fleetProfile: profile(6, members),
    });

    expect(routed.responsible.membershipId).toBe("m_mine");
    // The dispatcher and the Owner were considered and passed over on a fact,
    // not on a label.
    const passed = routed.candidates.filter((c) => !c.eligible).map((c) => c.membershipId);
    expect(passed).toContain("m_other");
    expect(passed).toContain("m_disp");
  });

  it("puts the supervisor in the accountable seat and the Owner in the watchers", () => {
    const owner = candidate({ membershipId: "m_owner", isOwner: true });
    const boss = candidate({ membershipId: "m_boss", supervisorMembershipId: "m_owner" });
    const desk = candidate({
      membershipId: "m_desk", supervisorMembershipId: "m_boss", functions: ["dispatch"],
    });
    const members = [owner, boss, desk];

    const routed = routeResponsibility({
      context: work(), members, fleetProfile: profile(30, members),
    });

    expect(routed.responsible.membershipId).toBe("m_desk");
    expect(routed.accountable.membershipId).toBe("m_boss");
    expect(routed.watchers.map((w) => w.membershipId)).toContain("m_owner");
    // A watcher owns nothing.
    expect(routed.watchers.every((w) => w.role === "watcher")).toBe(true);
  });

  it("honours a person's override even over somebody the default preferred", () => {
    const owner = candidate({ membershipId: "m_owner", isOwner: true });
    const preferred = candidate({ membershipId: "m_pref", truckIds: ["t1"] });
    const chosen = candidate({ membershipId: "m_chosen" });
    const members = [owner, preferred, chosen];

    const routed = routeResponsibility({
      context: work({ truckId: "t1" }),
      members,
      fleetProfile: profile(10, members),
      override: { membershipId: "m_chosen", source: "manual", note: "Ivy knows this broker." },
    });

    expect(routed.responsible.membershipId).toBe("m_chosen");
    expect(routed.responsible.source).toBe("manual");
    expect(routed.responsible.reason).toBe("Ivy knows this broker.");
  });
});

/* -------------------------------------------------------------------------- */
/* SLA                                                                         */
/* -------------------------------------------------------------------------- */

describe("two clocks, computed rather than scheduled", () => {
  const policy = policyFor(seedPolicies("org_new", hoursAgo(100)), {
    organizationId: "org_new", functionKey: "documents", severity: "medium",
  });

  it("reads acknowledged and unresolved as two different states", () => {
    const sla = slaFor({
      severity: "medium",
      openedAt: hoursAgo(100),
      acknowledgedAt: hoursAgo(99),
    }, policy);

    expect(sla.acknowledge.state).toBe("met");
    expect(sla.resolve.state).toBe("breached");
    expect(sla.worst).toBe("breached");
  });

  it("pauses the resolution clock while the work is blocked, and keeps the other running", () => {
    const sla = slaFor({
      severity: "critical",
      openedAt: hoursAgo(48),
      blocked: true,
      blockedReason: "Waiting on the shop.",
    }, policy);

    expect(sla.resolve.state).toBe("paused");
    expect(sla.resolve.pausedReason).toBe("Waiting on the shop.");
    // Somebody still has to pick it up and say it is blocked.
    expect(sla.acknowledge.state).toBe("breached");
  });

  it("lets the work's own deadline win over the policy target when it is sooner", () => {
    const soon = hoursFromNow(0.25);
    const sla = slaFor({ severity: "low", openedAt: hoursAgo(1), dueAt: soon }, policy);
    expect(sla.resolve.dueAt).toBe(soon);
  });

  it("says nothing is at risk for work nobody has missed a target on", () => {
    const sla = slaFor({ severity: "low", openedAt: new Date().toISOString() }, policy);
    expect(sla.worst).toBe("on_track");
  });
});

/* -------------------------------------------------------------------------- */
/* Escalation is not reassignment                                              */
/* -------------------------------------------------------------------------- */

describe("escalation is not reassignment", () => {
  const members = [
    candidate({ membershipId: "m_owner", isOwner: true }),
    candidate({ membershipId: "m_boss", supervisorMembershipId: "m_owner" }),
    candidate({ membershipId: "m_desk", supervisorMembershipId: "m_boss", functions: ["dispatch"] }),
  ];
  const fleetProfile = profile(30, members);
  const policy = policyFor(seedPolicies("org_new", hoursAgo(100)), {
    organizationId: "org_new", functionKey: "dispatch", severity: "high",
  });

  it("ships no default policy that moves work", () => {
    for (const seed of DEFAULT_POLICIES) {
      const p = seedPolicies("org_new", hoursAgo(1))
        .find((x) => x.id.endsWith(`_${seed.key}`))!;
      expect(p.steps.some(movesWork)).toBe(false);
    }
    // The rung that would move work exists — off, and only a person turns it on.
    expect(ESCALATION_ACTION_MOVES_WORK[OPTIONAL_REASSIGN_STEP.action]).toBe(true);
    expect(DEFAULT_LADDER.some((s) => s.level === OPTIONAL_REASSIGN_STEP.level)).toBe(false);
  });

  it("fires rungs on overdue work without proposing to move it", () => {
    const context = work({
      functionKey: "dispatch", severity: "high", openedAt: hoursAgo(72), requires: [],
    });
    const sla = slaFor(context, policy);
    const states = escalationsFor({
      context, policy, sla, fleetProfile,
      responsible: members[2],
    });

    const overdue = states.find((s) => s.trigger === "not_acknowledged");
    expect(overdue).toBeTruthy();
    expect(overdue!.level).toBeGreaterThan(0);
    expect(overdue!.reached.every((s) => !movesWork(s))).toBe(true);
    expect(pendingMoves(states)).toHaveLength(0);
  });

  it("starts a trigger about a person above the reminder rung", () => {
    const away = candidate({ membershipId: "m_away", takesWork: false });
    const context = work({ openedAt: hoursAgo(72), requires: [] });
    const sla = slaFor(context, policy);
    const states = escalationsFor({
      context, policy, sla, fleetProfile, responsible: away,
    });

    const unavailable = states.find((s) => s.trigger === "assignee_unavailable")!;
    expect(unavailable).toBeTruthy();
    // Reminding somebody who is on leave is noise.
    expect(unavailable.reached.every((s) => s.action !== "reminder")).toBe(true);
  });

  it("makes high-severity work visible above the desk from the start, moving nothing", () => {
    const context = work({ severity: "critical", openedAt: new Date().toISOString(), requires: [] });
    const sla = slaFor(context, policy);
    const states = escalationsFor({
      context, policy, sla, fleetProfile, responsible: members[2],
    });

    const severity = states.find((s) => s.trigger === "high_severity")!;
    // One rung, at minute zero: the manager can see it. Not a reminder to
    // somebody who has done nothing wrong, and not a ladder that climbs.
    expect(severity.reached).toHaveLength(1);
    expect(severity.reached[0].action).toBe("manager_visibility");
    expect(severity.next).toBeUndefined();
    expect(pendingMoves(states)).toHaveLength(0);
  });

  it("does not let a standing condition read as 'escalated'", () => {
    const context = work({ severity: "critical", openedAt: hoursAgo(200), requires: [] });
    const sla = slaFor(context, policy);
    const states = escalationsFor({
      context, policy, sla, fleetProfile,
      // Acknowledged and being worked: nothing has gone wrong here.
      responsible: members[2],
    });

    const severity = states.find((s) => s.trigger === "high_severity")!;
    expect(severity.level).toBeGreaterThan(0);
    expect(isEscalated(severity)).toBe(false);
    // Whereas something that actually went wrong does read as escalated.
    const overdue = states.find((s) => s.trigger === "not_acknowledged")!;
    expect(isEscalated(overdue)).toBe(true);
    expect(hasEscalated(states)).toBe(true);
  });

  it("quiets only the reminder rung when somebody keeps the work", () => {
    const context = work({ openedAt: hoursAgo(72), requires: [], severity: "high" });
    const sla = slaFor(context, policy);
    const kept = escalationsFor({
      context, policy, sla, fleetProfile,
      responsible: members[2],
      keptAt: new Date().toISOString(),
    });

    const overdue = kept.find((s) => s.trigger === "not_acknowledged")!;
    expect(overdue.reached.some((s) => s.action === "reminder")).toBe(false);
    // Everything above it is untouched, and the resolution clock never stopped.
    expect(overdue.reached.length).toBeGreaterThan(0);
  });

  it("escalates about nothing once the work is resolved", () => {
    const context = work({
      openedAt: hoursAgo(200), resolvedAt: hoursAgo(1), severity: "critical", requires: [],
    });
    const sla = slaFor(context, policy);
    expect(escalationsFor({ context, policy, sla, fleetProfile })).toHaveLength(0);
  });

  it("moves work only when a policy was deliberately given a rung that does", () => {
    const withMove = {
      ...policy,
      steps: [...policy.steps, { ...OPTIONAL_REASSIGN_STEP, afterMinutes: 0 }],
    };
    const context = work({ openedAt: hoursAgo(200), severity: "high", requires: [] });
    const sla = slaFor(context, withMove);
    const states = escalationsFor({
      context, policy: withMove, sla,
      fleetProfile: { ...fleetProfile, escalationLevels: 4 },
      responsible: members[2],
    });

    expect(pendingMoves(states).length).toBeGreaterThan(0);
  });
});
