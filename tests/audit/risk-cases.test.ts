import { beforeEach, describe, expect, it } from "vitest";
import { NotFoundError, PermissionDeniedError } from "@/lib/api/contracts/context";
import { SeparationOfDutiesError } from "@/lib/risk/separation-of-duties";
import { RISK_CASE_MAX_AGE_HOURS } from "@/lib/risk/case-states";
import {
  BAXTER_OWNER, NORTHLINE_OWNER, allEvents, audit, contextFor, openCaseFor,
  resetAuditAndRisk, risk, riskWorker, signalWith, withoutPermissions,
} from "./helpers";

/**
 * A case is the INVESTIGATION. It groups signals, it records what people did,
 * and its timeline is append-only — including when it is reopened.
 */

beforeEach(resetAuditAndRisk);

const crossOrgSignal = (ctx = riskWorker()) =>
  signalWith(ctx, (s) => s.kind === "cross_organization_access");

describe("a case groups signals without absorbing them", () => {
  it("links the signals and keeps them readable in their own right", async () => {
    const ctx = riskWorker();
    const signal = await crossOrgSignal(ctx);
    const opened = await openCaseFor(ctx, signal, "Cross-organization access");

    expect(opened.signalIds).toEqual([signal.id]);
    expect(opened.severity).toBe("critical");
    expect(opened.state).toBe("open");
    expect(opened.reference).toMatch(/^RC-\d{4}$/);

    const linked = await risk.signal(ctx, signal.id);
    expect(linked.status).toBe("linked");
    expect(linked.caseId).toBe(opened.id);
    // The signal still says what the rule said. The case did not rewrite it.
    expect(linked.rationale).toBe(signal.rationale);
  });

  it("refuses a case with no signal behind it", async () => {
    await expect(
      risk.openCase(riskWorker(), { title: "Something", summary: "", signalIds: [] }),
    ).rejects.toThrow(/at least one signal/i);
  });

  it("carries the audit events as evidence references, not copies", async () => {
    const ctx = riskWorker();
    const signal = await crossOrgSignal(ctx);
    const opened = await openCaseFor(ctx, signal);
    const evidence = opened.evidence.filter((e) => e.kind === "audit_event");
    expect(evidence.length).toBeGreaterThan(0);
    for (const item of evidence) {
      const detail = await audit.get(ctx, item.ref.id);
      expect(detail.event.id).toBe(item.ref.id);
    }
  });

  it("raises the severity when a worse signal is linked to it", async () => {
    const ctx = riskWorker();
    const churn = await signalWith(ctx, (s) => s.kind === "suspicious_change");
    const opened = await openCaseFor(ctx, churn);
    expect(opened.severity).toBe("medium");
    expect(opened.independentReviewRequired).toBe(false);

    const critical = await crossOrgSignal(ctx);
    const linked = await risk.linkSignal(ctx, opened.id, critical.id);
    expect(linked.severity).toBe("critical");
    expect(linked.independentReviewRequired).toBe(true);
  });
});

describe("the case timeline is append-only", () => {
  it("only ever grows, through every action", async () => {
    const ctx = riskWorker();
    const opened = await openCaseFor(ctx, await crossOrgSignal(ctx));
    const lengths = [opened.timeline.length];

    const assigned = await risk.assign(ctx, opened.id, ctx.membershipId);
    lengths.push(assigned.timeline.length);
    const noted = await risk.addNote(ctx, opened.id, { body: "Spoke to dispatch." });
    lengths.push(noted.timeline.length);
    const evidenced = await risk.addEvidence(ctx, opened.id, {
      kind: "document", refId: "doc_x", refKind: "document",
      refLabel: "Access log extract", description: "What they clicked.",
    });
    lengths.push(evidenced.timeline.length);
    const moved = await risk.transition(ctx, opened.id, { to: "investigating" });
    lengths.push(moved.timeline.length);

    for (let i = 1; i < lengths.length; i += 1) {
      expect(lengths[i]).toBeGreaterThan(lengths[i - 1]);
    }
    // Everything that was there at the start is still there at the end.
    const first = opened.timeline[0];
    expect(moved.timeline[0]).toEqual(first);
  });

  it("keeps the first decision on the record when a closed case is reopened", async () => {
    const ctx = riskWorker();
    const opened = await openCaseFor(ctx, await crossOrgSignal(ctx));
    const decided = await risk.recordDecision(ctx, opened.id, {
      kind: "no_action",
      rationale: "A bookmarked link from before the relationship ended.",
      resultingState: "dismissed",
    });
    expect(decided.state).toBe("dismissed");
    expect(decided.closedAt).toBeTruthy();

    const reopened = await risk.transition(ctx, opened.id, {
      to: "investigating",
      rationale: "It happened again.",
    });
    expect(reopened.state).toBe("investigating");
    expect(reopened.closedAt).toBeUndefined();
    // The original decision and its rationale survive the reopening.
    expect(reopened.decisions).toHaveLength(1);
    expect(reopened.decisions[0].rationale).toMatch(/bookmarked link/);
    expect(reopened.timeline.some((e) => e.action === "reopened")).toBe(true);
    expect(reopened.timeline.length).toBeGreaterThan(decided.timeline.length);
  });

  it("refuses a state change the machine does not allow", async () => {
    const ctx = riskWorker();
    const opened = await openCaseFor(ctx, await crossOrgSignal(ctx));
    await risk.transition(ctx, opened.id, { to: "resolved", rationale: "Dealt with." });
    await expect(
      risk.transition(ctx, opened.id, { to: "escalated", rationale: "Actually no." }),
    ).rejects.toThrow(/cannot move from resolved/i);
  });

  it("refuses to close or escalate without a reason", async () => {
    const ctx = riskWorker();
    const opened = await openCaseFor(ctx, await crossOrgSignal(ctx));
    await expect(
      risk.transition(ctx, opened.id, { to: "resolved" }),
    ).rejects.toThrow(/needs a reason/i);
    await expect(
      risk.transition(ctx, opened.id, { to: "escalated" }),
    ).rejects.toThrow(/needs a reason/i);
  });

  it("keeps the three endings distinct", async () => {
    const ctx = riskWorker();
    const endings = ["resolved", "accepted_risk", "dismissed"] as const;
    for (const ending of endings) {
      const signal = await signalWith(ctx, (s) => s.status === "new");
      const opened = await openCaseFor(ctx, signal, `Case ending in ${ending}`);
      const closed = await risk.transition(ctx, opened.id, {
        to: ending,
        rationale: `Ended as ${ending}.`,
      });
      expect(closed.state).toBe(ending);
      expect(closed.resolutionNote).toBe(`Ended as ${ending}.`);
    }
  });
});

describe("separation of duties", () => {
  /** The seeded signer change was made by Sam, the signed-in fixture Owner. */
  const samsOwnSignal = () =>
    signalWith(contextFor(NORTHLINE_OWNER), (s) => s.ruleId === "rule.control_record_changed");

  it("lets the subject open a case about themselves but not work it", async () => {
    const sam = contextFor(NORTHLINE_OWNER);
    const signal = await samsOwnSignal();
    // Opening is allowed: refusing it would mean a person could avoid a case by
    // being the only witness.
    const opened = await risk.openCase(sam, {
      title: "Signer change on the operating authority",
      summary: "Raised by the rule; I made the change.",
      signalIds: [signal.id],
    });
    expect(opened.subjectMembershipIds).toContain(sam.membershipId);
    expect(opened.independentReviewRequired).toBe(true);

    for (const attempt of [
      () => risk.transition(sam, opened.id, { to: "investigating" }),
      () => risk.addEvidence(sam, opened.id, {
        kind: "record", refId: "org_northline", refKind: "organization",
        refLabel: "Northline", description: "Mine.",
      }),
      () => risk.recordDecision(sam, opened.id, {
        kind: "no_action", rationale: "It was me, it was fine.",
      }),
      () => risk.setDueDate(sam, opened.id, null),
    ]) {
      await expect(attempt()).rejects.toBeInstanceOf(SeparationOfDutiesError);
    }
  });

  it("lets the subject add a note, so they can explain themselves", async () => {
    const sam = contextFor(NORTHLINE_OWNER);
    const opened = await risk.openCase(sam, {
      title: "Signer change", summary: "", signalIds: [(await samsOwnSignal()).id],
    });
    const noted = await risk.addNote(sam, opened.id, {
      body: "Priya took over as signer when I stepped back from filings.",
    });
    expect(noted.notes).toHaveLength(1);
  });

  it("refuses to assign the case to its own subject, and leaves them off the list", async () => {
    const sam = contextFor(NORTHLINE_OWNER);
    const opened = await risk.openCase(sam, {
      title: "Signer change", summary: "", signalIds: [(await samsOwnSignal()).id],
    });

    await expect(
      risk.assign(sam, opened.id, sam.membershipId),
    ).rejects.toBeInstanceOf(SeparationOfDutiesError);

    const eligible = await risk.eligibleAssignees(sam, opened.id);
    expect(eligible.some((p) => p.membershipId === sam.membershipId)).toBe(false);
    expect(eligible.length).toBeGreaterThan(0);

    // Somebody else can be given it, and can work it.
    const other = eligible[0];
    const assigned = await risk.assign(sam, opened.id, other.membershipId);
    expect(assigned.assigneeMembershipId).toBe(other.membershipId);
  });

  it("drops an assignee the case was opened with when they are its subject", async () => {
    const sam = contextFor(NORTHLINE_OWNER);
    const opened = await risk.openCase(sam, {
      title: "Signer change",
      summary: "",
      signalIds: [(await samsOwnSignal()).id],
      assigneeMembershipId: sam.membershipId,
    });
    expect(opened.assigneeMembershipId).toBeUndefined();
  });

  it("does not require independent review below high severity", async () => {
    const ctx = riskWorker();
    const churn = await signalWith(ctx, (s) => s.kind === "suspicious_change");
    const opened = await openCaseFor(ctx, churn);
    expect(opened.independentReviewRequired).toBe(false);
  });
});

describe("permissions and scope on cases", () => {
  it("separates reading, assigning, investigating and closing", async () => {
    const base = riskWorker();
    const opened = await openCaseFor(base, await crossOrgSignal(base));

    await expect(
      risk.cases(withoutPermissions(base, "risk:view")),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    await expect(
      risk.openCase(withoutPermissions(base, "risk:investigate"), {
        title: "x", summary: "", signalIds: [opened.signalIds[0]],
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    await expect(
      risk.assign(withoutPermissions(base, "risk:assign"), opened.id, base.membershipId),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    // Investigating is not closing. Moving it along is fine without risk:resolve;
    // ending it is not.
    const noResolve = withoutPermissions(base, "risk:resolve");
    await expect(
      risk.transition(noResolve, opened.id, { to: "investigating" }),
    ).resolves.toBeTruthy();
    await expect(
      risk.transition(noResolve, opened.id, { to: "resolved", rationale: "Done." }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("never shows one organization's cases through another", async () => {
    const northline = riskWorker();
    const opened = await openCaseFor(northline, await crossOrgSignal(northline));

    const baxter = contextFor(BAXTER_OWNER);
    expect(await risk.cases(baxter)).toHaveLength(0);
    await expect(risk.case(baxter, opened.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("due dates are policy, not a free-text field", () => {
  it("gives a critical case a due date inside the critical window", async () => {
    const ctx = riskWorker();
    const opened = await openCaseFor(ctx, await crossOrgSignal(ctx));
    const hours = (new Date(opened.dueAt!).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeLessThanOrEqual(RISK_CASE_MAX_AGE_HOURS.critical + 1);
  });

  it("clamps a due date somebody pushes out past the policy cap", async () => {
    const ctx = riskWorker();
    const opened = await openCaseFor(ctx, await crossOrgSignal(ctx));
    const inAYear = new Date(Date.now() + 365 * 24 * 3_600_000).toISOString();
    const next = await risk.setDueDate(ctx, opened.id, inAYear);
    const hours = (new Date(next.dueAt!).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeLessThanOrEqual(RISK_CASE_MAX_AGE_HOURS.critical + 1);
  });
});

describe("working a case is itself audited", () => {
  it("records every case action in the one ledger", async () => {
    const ctx = riskWorker();
    const before = (await allEvents(ctx)).length;

    const opened = await openCaseFor(ctx, await crossOrgSignal(ctx));
    await risk.assign(ctx, opened.id, ctx.membershipId);
    await risk.addNote(ctx, opened.id, { body: "Looking at it." });
    await risk.transition(ctx, opened.id, { to: "investigating" });
    await risk.recordDecision(ctx, opened.id, {
      kind: "access_change",
      rationale: "Removed the stale link and re-checked their permissions.",
      resultingState: "resolved",
    });

    const after = await allEvents(ctx);
    const actions = after.map((e) => e.action);
    for (const expected of [
      "risk.case_opened", "risk.case_assigned", "risk.case_note_added",
      "risk.case_state_changed", "risk.case_decision_recorded",
    ]) {
      expect(actions).toContain(expected);
    }
    expect(after.length).toBeGreaterThan(before);
  });
});
