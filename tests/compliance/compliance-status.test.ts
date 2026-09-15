import { describe, expect, it } from "vitest";
import {
  addMonths, daysUntil, evaluateStatus, isOpen, nextDueAt, worstStatus,
} from "@/lib/compliance";
import type {
  ComplianceEvidenceRef, ComplianceRenewalCycle, ComplianceStatus,
} from "@/types";

/**
 * Status is derived, never stored. These tests pin the derivation, because it
 * is what decides whether a driver can be dispatched.
 */

const NOW = Date.parse("2026-06-01T12:00:00.000Z");
const DAY = 86_400_000;
const inDays = (n: number) => new Date(NOW + n * DAY).toISOString();

const documentExpiry: ComplianceRenewalCycle = {
  basis: "document_expiry", warnWithinDays: 45,
};
const annual: ComplianceRenewalCycle = {
  basis: "fixed_interval", intervalMonths: 12, warnWithinDays: 45,
};
const oneTime: ComplianceRenewalCycle = { basis: "none", warnWithinDays: 0 };

const evidence = (
  over: Partial<ComplianceEvidenceRef> = {},
): ComplianceEvidenceRef => ({
  system: "truck_document",
  id: "doc_1",
  label: "Registration",
  state: "approved",
  ...over,
});

describe("nextDueAt", () => {
  it("follows the document's own expiry, not a cycle we invented", () => {
    expect(nextDueAt(documentExpiry, { evidence: evidence({ expiresAt: inDays(100) }) }))
      .toBe(inDays(100));
  });

  it("counts a fixed interval from when the evidence was accepted", () => {
    expect(nextDueAt(annual, { satisfiedAt: "2026-01-15T00:00:00.000Z" }))
      .toBe(addMonths("2026-01-15T00:00:00.000Z", 12));
  });

  it("never invents a date for an event-driven cycle", () => {
    // Inspections, violations and accidents are later milestones. Guessing a
    // date from a basis we cannot compute would be a lie, so we return nothing.
    expect(nextDueAt({ basis: "event_driven", warnWithinDays: 30 }, { satisfiedAt: inDays(-5) }))
      .toBeUndefined();
  });

  it("returns nothing for a one-time requirement", () => {
    expect(nextDueAt(oneTime, { satisfiedAt: inDays(-500) })).toBeUndefined();
  });

  it("does not roll a month-end date into the following month", () => {
    expect(addMonths("2026-01-31T00:00:00.000Z", 1).slice(0, 10)).toBe("2026-02-28");
  });
});

describe("evaluateStatus", () => {
  it("is action_required with nothing on file", () => {
    const result = evaluateStatus({ renewal: documentExpiry }, NOW);
    expect(result.status).toBe("action_required");
    expect(result.reason).toMatch(/nothing on file/i);
  });

  it("is action_required when the evidence was rejected, and says why", () => {
    const result = evaluateStatus(
      {
        renewal: documentExpiry,
        evidence: evidence({
          state: "rejected",
          rejectionReason: "The photo cuts off the inspector's signature.",
        }),
      },
      NOW,
    );
    expect(result.status).toBe("action_required");
    expect(result.reason).toMatch(/signature/);
  });

  it("does not treat submitted as satisfied", () => {
    // Handing a document in is not the same as somebody accepting it, and the
    // difference is the entire reason a review step exists.
    const result = evaluateStatus(
      { renewal: documentExpiry, evidence: evidence({ state: "pending_review", expiresAt: inDays(300) }) },
      NOW,
    );
    expect(result.status).toBe("action_required");
    expect(result.reason).toMatch(/waiting for review/i);
  });

  it("is compliant well before the due date", () => {
    const result = evaluateStatus(
      { renewal: documentExpiry, evidence: evidence({ expiresAt: inDays(300) }) },
      NOW,
    );
    expect(result.status).toBe("compliant");
  });

  it("is expiring inside the warning window", () => {
    const result = evaluateStatus(
      { renewal: documentExpiry, evidence: evidence({ expiresAt: inDays(20) }) },
      NOW,
    );
    expect(result.status).toBe("expiring");
    expect(result.reason).toMatch(/20 days/);
  });

  it("is compliant one day outside the warning window", () => {
    expect(
      evaluateStatus(
        { renewal: documentExpiry, evidence: evidence({ expiresAt: inDays(46) }) },
        NOW,
      ).status,
    ).toBe("compliant");
  });

  it("is expired once the due date has passed", () => {
    const result = evaluateStatus(
      { renewal: documentExpiry, evidence: evidence({ expiresAt: inDays(-3) }) },
      NOW,
    );
    expect(result.status).toBe("expired");
    expect(result.reason).toMatch(/3 days ago/);
  });

  it("is compliant forever for a satisfied one-time requirement", () => {
    expect(evaluateStatus({ renewal: oneTime, evidence: evidence() }, NOW).status)
      .toBe("compliant");
  });

  it("puts not_applicable above every other state", () => {
    const result = evaluateStatus(
      {
        renewal: documentExpiry,
        notApplicableReason: "This trailer carries no refrigeration unit.",
        evidence: evidence({ expiresAt: inDays(-90) }),
        suspended: true,
      },
      NOW,
    );
    expect(result.status).toBe("not_applicable");
  });

  it("puts suspended above the clock", () => {
    const result = evaluateStatus(
      {
        renewal: documentExpiry,
        suspended: true,
        suspendedReason: "The truck is in maintenance.",
        evidence: evidence({ expiresAt: inDays(-10) }),
      },
      NOW,
    );
    expect(result.status).toBe("suspended");
    expect(result.reason).toMatch(/maintenance/);
  });

  it("treats a superseded document as nothing on file", () => {
    expect(
      evaluateStatus(
        { renewal: documentExpiry, evidence: evidence({ state: "superseded", expiresAt: inDays(300) }) },
        NOW,
      ).status,
    ).toBe("action_required");
  });
});

describe("ordering helpers", () => {
  it("counts only the three states that need somebody to act", () => {
    const open: ComplianceStatus[] = ["action_required", "expiring", "expired"];
    const closed: ComplianceStatus[] = ["compliant", "suspended", "not_applicable"];
    expect(open.every(isOpen)).toBe(true);
    expect(closed.some(isOpen)).toBe(false);
  });

  it("picks the worst status in a group", () => {
    expect(worstStatus(["compliant", "expiring", "expired"])).toBe("expired");
    expect(worstStatus(["compliant", "not_applicable"])).toBe("compliant");
    expect(worstStatus([])).toBe("not_applicable");
  });

  it("counts whole days to a deadline", () => {
    expect(daysUntil(inDays(3), NOW)).toBe(3);
    expect(daysUntil(inDays(-2), NOW)).toBe(-2);
  });
});
