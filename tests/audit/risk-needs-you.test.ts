import { beforeEach, describe, expect, it } from "vitest";
import { services } from "@/lib/api";
import { RISK_EXTENSION_POINTS } from "@/lib/risk/extensions";
import {
  NORTHLINE_OWNER, contextFor, openCaseFor, resetAuditAndRisk, risk,
  riskWorker, signalWith, withoutPermissions,
} from "./helpers";

/**
 * Risk cases land in the ONE queue, derived from the cases themselves.
 * They are not a second inbox, and they are not fixtures.
 */

const needsYou = services.needsYou;

beforeEach(resetAuditAndRisk);

const criticalSignal = (ctx = riskWorker()) =>
  signalWith(ctx, (s) => s.kind === "cross_organization_access");

describe("assigned high and critical cases reach Needs You", () => {
  it("produces nothing until a case is opened AND assigned", async () => {
    const ctx = riskWorker();
    const before = await needsYou.list(ctx);
    expect(before.filter((i) => i.entity.kind === "risk_case")).toHaveLength(0);

    const opened = await openCaseFor(ctx, await criticalSignal(ctx), "Cross-org access");
    // Opened, not assigned: a case nobody owns is a risk-queue problem, not a
    // personal to-do on somebody's Home screen.
    const unassigned = await needsYou.list(ctx);
    expect(unassigned.filter((i) => i.entity.kind === "risk_case")).toHaveLength(0);

    await risk.assign(ctx, opened.id, ctx.membershipId);
    const after = await needsYou.list(ctx);
    const item = after.find((i) => i.entity.id === opened.id)!;
    expect(item).toBeTruthy();
    expect(item.severity).toBe("critical");
    expect(item.category).toBe("risk_case_critical");
    expect(item.assigneeMembershipId).toBe(ctx.membershipId);
    expect(item.entity.href).toBe(`/audit/cases/${opened.id}`);
    expect(item.derived).toBe(true);
  });

  it("leaves medium and low cases out of the queue entirely", async () => {
    const ctx = riskWorker();
    const churn = await signalWith(ctx, (s) => s.kind === "suspicious_change");
    const opened = await openCaseFor(ctx, churn);
    expect(opened.severity).toBe("medium");
    await risk.assign(ctx, opened.id, ctx.membershipId);

    const items = await needsYou.list(ctx);
    expect(items.some((i) => i.entity.id === opened.id)).toBe(false);
  });

  it("stops existing when the case is closed — nobody has to tidy it away", async () => {
    const ctx = riskWorker();
    const opened = await openCaseFor(ctx, await criticalSignal(ctx));
    await risk.assign(ctx, opened.id, ctx.membershipId);
    expect((await needsYou.list(ctx)).some((i) => i.entity.id === opened.id)).toBe(true);

    await risk.transition(ctx, opened.id, {
      to: "resolved",
      rationale: "Stale bookmark; access re-checked.",
    });
    expect((await needsYou.list(ctx)).some((i) => i.entity.id === opened.id)).toBe(false);
  });

  it("refuses to be snoozed or resolved from the queue", async () => {
    const ctx = riskWorker();
    const opened = await openCaseFor(ctx, await criticalSignal(ctx));
    await risk.assign(ctx, opened.id, ctx.membershipId);
    const itemId = `ny_risk_${opened.id}`;

    // There is nothing here to write to, and hiding the row would not move the
    // investigation. The message says so rather than returning a bare error.
    await expect(needsYou.snooze(ctx, itemId, { hours: 1, reason: "later" }))
      .rejects.toThrow(/open the case/i);
    await expect(needsYou.resolve(ctx, itemId)).rejects.toThrow(/open the case/i);
  });

  it("is gated on risk:view like every other item in the queue", async () => {
    const ctx = riskWorker();
    const opened = await openCaseFor(ctx, await criticalSignal(ctx));
    await risk.assign(ctx, opened.id, ctx.membershipId);

    const blind = withoutPermissions(ctx, "risk:view");
    const items = await needsYou.list(blind);
    expect(items.some((i) => i.entity.kind === "risk_case")).toBe(false);
  });

  it("counts toward the open badge", async () => {
    const ctx = riskWorker();
    const before = await needsYou.openCount(ctx);
    const opened = await openCaseFor(ctx, await criticalSignal(ctx));
    await risk.assign(ctx, opened.id, ctx.membershipId);
    expect(await needsYou.openCount(ctx)).toBe(before + 1);
  });

  it("does not disturb the items the other modules already contribute", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const before = await needsYou.list(ctx);
    const nonRisk = before.filter((i) => i.entity.kind !== "risk_case");

    const opened = await openCaseFor(ctx, await criticalSignal(ctx));
    await risk.assign(ctx, opened.id, "mem_nl_marcus");

    const after = await needsYou.list(ctx);
    const nonRiskAfter = after.filter((i) => i.entity.kind !== "risk_case");
    expect(nonRiskAfter.map((i) => i.id).sort()).toEqual(nonRisk.map((i) => i.id).sort());
  });
});

describe("extension points are declared and not built", () => {
  it("names every later milestone and marks all of them unavailable", async () => {
    const points = await risk.extensionPoints(riskWorker());
    expect(points).toEqual(RISK_EXTENSION_POINTS);
    expect(points.every((p) => p.available === false)).toBe(true);

    const kinds = points.map((p) => p.kind);
    for (const expected of [
      "security_monitoring", "fraud_detection", "identity_verification",
      "legal_hold", "retention_policy", "external_compliance",
    ]) {
      expect(kinds).toContain(expected);
    }
  });

  it("says what each one would add, so a later branch extends rather than forks", () => {
    for (const point of RISK_EXTENSION_POINTS) {
      expect(point.wouldAdd.length).toBeGreaterThan(20);
      expect(point.consumes.length).toBeGreaterThan(0);
    }
  });
});
