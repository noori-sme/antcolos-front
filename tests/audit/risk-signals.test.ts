import { beforeEach, describe, expect, it } from "vitest";
import { NotFoundError, PermissionDeniedError } from "@/lib/api/contracts/context";
import { RISK_RULES } from "@/lib/risk/rules";
import { SeparationOfDutiesError } from "@/lib/risk/separation-of-duties";
import {
  NORTHLINE_OWNER, allEvents, audit, contextFor, resetAuditAndRisk, risk,
  riskWorker, signalWith, withoutPermissions,
} from "./helpers";

/**
 * A signal is NOT an audit event. These tests hold that line: what a rule
 * concluded, what it rests on, and that judging it never edits the record.
 */

beforeEach(resetAuditAndRisk);

describe("signals are separate from the ledger", () => {
  it("points at audit events rather than restating them", async () => {
    const ctx = riskWorker();
    const signals = await risk.signals(ctx);
    expect(signals.length).toBeGreaterThan(0);

    const events = await allEvents(ctx);
    const known = new Set(events.map((e) => e.id));
    for (const signal of signals) {
      // Observations from the not-yet-merged modules carry no event ids, and
      // say so; every other signal's evidence must exist in the ledger.
      for (const id of signal.auditEventIds) expect(known.has(id)).toBe(true);
    }
    const fromLedger = signals.filter((s) => s.auditEventIds.length > 0);
    expect(fromLedger.length).toBeGreaterThan(0);
  });

  it("is labelled a mock, rule and all", async () => {
    const ctx = riskWorker();
    const signals = await risk.signals(ctx);
    expect(signals.every((s) => s.mock === true)).toBe(true);
    for (const rule of await risk.rules(ctx)) {
      expect(rule.mock).toBe(true);
      // Every rule says what it cannot do, beside what it does.
      expect(rule.limitations.length).toBeGreaterThan(20);
    }
  });

  it("claims no scoring, no model and no outside service anywhere in the catalogue", () => {
    const text = JSON.stringify(RISK_RULES).toLowerCase();
    for (const claim of ["machine learning", "ai-powered", "risk score", "certified"]) {
      expect(text).not.toContain(claim);
    }
  });

  it("does not touch the ledger when a signal is dismissed", async () => {
    const ctx = riskWorker();
    const signal = await signalWith(ctx, (s) => s.ruleId === "rule.duplicate_record");
    const before = await allEvents(ctx);
    const evidenceBefore = await Promise.all(
      signal.auditEventIds.map((id) => audit.get(ctx, id)),
    );

    await risk.dismissSignal(ctx, signal.id, { reason: "Checked — two different loads." });

    const after = await allEvents(ctx);
    for (const detail of evidenceBefore) {
      const now = await audit.get(ctx, detail.event.id);
      // Same event, same summary, same changes. Nothing was hidden or rewritten.
      expect(now.event).toEqual(detail.event);
    }
    // The ledger GREW by the dismissal itself, and lost nothing.
    expect(after.length).toBe(before.length + 1);
    expect(after.some((e) => e.action === "risk.signal_dismissed")).toBe(true);
    expect(before.every((e) => after.some((a) => a.id === e.id))).toBe(true);
  });

  it("keeps a dismissal dismissed across re-derivation", async () => {
    const ctx = riskWorker();
    const signal = await signalWith(ctx, (s) => s.ruleId === "rule.duplicate_record");
    await risk.dismissSignal(ctx, signal.id, { reason: "Not a duplicate." });
    const again = await risk.signal(ctx, signal.id);
    expect(again.status).toBe("dismissed");
    expect(again.dismissalReason).toBe("Not a duplicate.");
  });

  it("refuses a dismissal with no reason", async () => {
    const ctx = riskWorker();
    const signal = (await risk.signals(ctx))[0];
    await expect(
      risk.dismissSignal(ctx, signal.id, { reason: "  " }),
    ).rejects.toThrow(/why/i);
  });
});

describe("the mock rules flag what they say they flag", () => {
  it("raises a signal for refused permission-sensitive actions", async () => {
    const ctx = riskWorker();
    const signal = await signalWith(ctx, (s) => s.ruleId === "rule.permission_denied_burst");
    expect(signal.kind).toBe("unauthorized_action");
    expect(["high", "critical"]).toContain(signal.severity);
    expect(signal.subjectActor?.membershipId).toBe("mem_nl_dana");
  });

  it("raises a critical signal for a cross-organization attempt", async () => {
    const ctx = riskWorker();
    const signal = await signalWith(ctx, (s) => s.kind === "cross_organization_access");
    expect(signal.severity).toBe("critical");
  });

  it("raises signals for ownership, Authority, signer, banking and payout changes", async () => {
    const ctx = riskWorker();
    const signals = await risk.signals(ctx, { kind: ["sensitive_record_change"] });
    const rules = new Set(signals.map((s) => s.ruleId));
    expect(rules.has("rule.banking_details_changed")).toBe(true);
    expect(rules.has("rule.control_record_changed")).toBe(true);
    const banking = signals.find((s) => s.ruleId === "rule.banking_details_changed")!;
    expect(banking.severity).toBe("critical");
    // The rationale never claims to have checked anything.
    expect(banking.rationale).toMatch(/cannot check/i);
  });

  it("raises a signal for duplicates and conflicts", async () => {
    const ctx = riskWorker();
    const signals = await risk.signals(ctx, { kind: ["duplicate_or_conflict"] });
    expect(signals.length).toBeGreaterThan(0);
    // The seeded invoice pair: two ledger entries on one record, grouped into
    // one signal rather than two.
    const invoice = signals.find((s) => s.entity.id === "inv_nl_2291")!;
    expect(invoice).toBeTruthy();
    expect(invoice.auditEventIds.length).toBeGreaterThanOrEqual(2);
  });

  it("raises a signal for repeated rejected uploads against one subject", async () => {
    const ctx = riskWorker();
    const signal = await signalWith(ctx, (s) => s.kind === "repeated_rejection");
    expect(signal.entity.id).toBe("dp_ray");
    expect(signal.auditEventIds.length).toBeGreaterThanOrEqual(3);
  });

  it("raises a signal for repeated assignment changes on one unit", async () => {
    const ctx = riskWorker();
    const signal = await signalWith(ctx, (s) => s.kind === "suspicious_change");
    expect(signal.entity.id).toBe("trk_nl_118");
  });

  it("raises critical inconsistency signals, and says they came from a mock adapter", async () => {
    const ctx = riskWorker();
    const signals = await risk.signals(ctx, { kind: ["critical_inconsistency"] });
    expect(signals.length).toBeGreaterThan(0);
    for (const signal of signals) {
      expect(signal.severity).toBe("critical");
      expect(signal.rationale).toMatch(/mock adapter/i);
    }
    // And the ELD one is explicit that Antcolos reads no logs.
    expect(signals.some((s) => /connected to no ELD/i.test(s.rationale))).toBe(true);
  });
});

describe("signals are organization-scoped and permission-gated", () => {
  it("refuses signals without risk:view", async () => {
    const ctx = withoutPermissions(riskWorker(), "risk:view");
    await expect(risk.signals(ctx)).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(risk.dashboard(ctx)).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(risk.rules(ctx)).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("refuses a dismissal without risk:investigate", async () => {
    const ctx = withoutPermissions(riskWorker(), "risk:investigate");
    const signal = (await risk.signals(ctx))[0];
    await expect(
      risk.dismissSignal(ctx, signal.id, { reason: "No." }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("answers 'not found' for a signal that is not this organization's", async () => {
    await expect(
      risk.signal(riskWorker(), "rsig_xorg_not_a_real_event"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("will not let somebody dismiss a signal about their own actions", async () => {
    // The seeded signer change was made by Sam, who is the signed-in fixture
    // user and the Owner of Northline. Being the Owner is not a defence.
    const sam = contextFor(NORTHLINE_OWNER);
    const signal = await signalWith(sam, (s) => s.ruleId === "rule.control_record_changed");
    expect(signal.subjectActor?.membershipId).toBe(sam.membershipId);
    await expect(
      risk.dismissSignal(sam, signal.id, { reason: "It was fine." }),
    ).rejects.toBeInstanceOf(SeparationOfDutiesError);
  });
});

describe("the dashboard counts what it says it counts", () => {
  it("reports open signals, cases, refusals and that the rules are mocks", async () => {
    const ctx = riskWorker();
    const dashboard = await risk.dashboard(ctx);
    expect(dashboard.rulesAreMock).toBe(true);
    expect(dashboard.auditEventCount).toBeGreaterThan(0);
    expect(dashboard.deniedActionCount).toBeGreaterThanOrEqual(5);
    expect(dashboard.openSignalCount).toBeGreaterThan(0);
    expect(dashboard.signalsBySeverity.critical).toBeGreaterThan(0);
    expect(dashboard.openCaseCount).toBe(0);
  });
});
