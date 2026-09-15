import { describe, expect, it } from "vitest";
import type { Contract, ContractVersion } from "@/types";
import {
  activationBlockers, assertTransition, canTransition, daysBetween,
  deriveContractStatus, isInForce, isTerminalStatus,
} from "./status";

const NOW = "2026-09-15T12:00:00.000Z";

function version(overrides: {
  to?: string;
  reminderDays?: number;
} = {}): Pick<ContractVersion, "terms"> {
  return {
    terms: {
      summary: "s",
      effective: { from: "2026-01-01T00:00:00.000Z", to: overrides.to },
      renewal: { kind: "none", reminderDays: overrides.reminderDays ?? 30 },
      termination: { grounds: ["for_convenience"], noticeDays: 30, forCauseNoticeDays: 0, closeoutSteps: [] },
      compensation: [],
      responsibilities: [],
      requiredDocuments: [],
    },
  };
}

const contract = (status: Contract["status"]) => ({ status });

describe("the contract status machine", () => {
  it("allows the drafting path and refuses shortcuts", () => {
    expect(canTransition("draft", "pending_review")).toBe(true);
    expect(canTransition("draft", "awaiting_signature")).toBe(true);
    expect(canTransition("draft", "active")).toBe(false);
    expect(canTransition("pending_review", "draft")).toBe(true);
  });

  it("refuses to reopen a version that is out for signature", () => {
    // A party may already have signed it. Going back to draft would mean
    // editing terms somebody agreed to.
    expect(canTransition("awaiting_signature", "draft")).toBe(false);
    expect(canTransition("awaiting_signature", "pending_review")).toBe(false);
    expect(canTransition("awaiting_signature", "active")).toBe(true);
  });

  it("treats terminated, cancelled and superseded as ends of the line", () => {
    for (const status of ["terminated", "cancelled", "superseded"] as const) {
      expect(isTerminalStatus(status)).toBe(true);
      expect(canTransition(status, "active")).toBe(false);
      expect(canTransition(status, "draft")).toBe(false);
    }
  });

  it("throws with both states named", () => {
    expect(() => assertTransition("active", "draft")).toThrow(/active to draft/);
  });

  it("knows which statuses mean the agreement is in force", () => {
    expect(isInForce("active")).toBe(true);
    expect(isInForce("expiring")).toBe(true);
    expect(isInForce("expired")).toBe(false);
    expect(isInForce("awaiting_signature")).toBe(false);
  });
});

describe("deriving status from the clock", () => {
  it("leaves every decided status alone", () => {
    for (const status of ["draft", "pending_review", "awaiting_signature", "terminated", "cancelled", "superseded"] as const) {
      // Even with an end date two years past, a decided status is not re-read.
      expect(deriveContractStatus(contract(status), version({ to: "2024-01-01T00:00:00.000Z" }), NOW))
        .toBe(status);
    }
  });

  it("expires an active contract whose end date has passed", () => {
    expect(deriveContractStatus(contract("active"), version({ to: "2026-09-01T00:00:00.000Z" }), NOW))
      .toBe("expired");
  });

  it("marks it expiring inside its own reminder window, not a global one", () => {
    // 20 days left. A 30-day window catches it; a 7-day window does not.
    const to = "2026-10-05T12:00:00.000Z";
    expect(deriveContractStatus(contract("active"), version({ to, reminderDays: 30 }), NOW))
      .toBe("expiring");
    expect(deriveContractStatus(contract("active"), version({ to, reminderDays: 7 }), NOW))
      .toBe("active");
  });

  it("never expires an open-ended agreement", () => {
    expect(deriveContractStatus(contract("active"), version(), NOW)).toBe("active");
  });

  it("does not store the derived answer anywhere", () => {
    // The contract passed in is not mutated: derivation is a read.
    const c = contract("active");
    deriveContractStatus(c, version({ to: "2020-01-01T00:00:00.000Z" }), NOW);
    expect(c.status).toBe("active");
  });
});

describe("daysBetween", () => {
  it("counts whole days and is stable across a DST boundary", () => {
    // 1 Mar to 1 Apr 2026 is 31 days regardless of any local clock change.
    expect(daysBetween("2026-03-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z")).toBe(31);
  });

  it("is negative once the date has passed", () => {
    expect(daysBetween(NOW, "2026-09-01T12:00:00.000Z")).toBe(-14);
  });
});

describe("activation blockers", () => {
  it("names every reason rather than returning a bare false", () => {
    const reasons = activationBlockers({
      version: { status: "draft", terms: version().terms },
      signaturesOutstanding: 2,
      blockingRequirementsOpen: 1,
      now: NOW,
    });
    expect(reasons).toHaveLength(3);
    expect(reasons.join(" ")).toMatch(/issued for signature/);
    expect(reasons.join(" ")).toMatch(/2 parties/);
    expect(reasons.join(" ")).toMatch(/One required item/);
  });

  it("is empty when a fully signed version has nothing outstanding", () => {
    expect(activationBlockers({
      version: { status: "signed", terms: version().terms },
      signaturesOutstanding: 0,
      blockingRequirementsOpen: 0,
      now: NOW,
    })).toEqual([]);
  });
});
