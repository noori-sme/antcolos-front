import { describe, expect, it } from "vitest";
import type { CompensationRule, ContractTerms } from "@/types";
import {
  assertGroundAllowed, compensationRulesAt, ContractTermsError, daysUntilEnd,
  isInsideReminderWindow, isWithinEffectiveDates, nextTermDates, noticeDaysFor,
  renewalNoticeDeadline, terminationEffectiveDate, validateCompensationRule,
  validateTermsForIssue,
} from "./terms";

const NOW = "2026-09-15T12:00:00.000Z";

function terms(overrides: Partial<ContractTerms> = {}): ContractTerms {
  return {
    summary: "Owner-operator agreement",
    effective: { from: "2026-01-01T00:00:00.000Z", to: "2026-12-31T00:00:00.000Z" },
    renewal: { kind: "automatic", termDays: 365, noticeDays: 30, reminderDays: 45 },
    termination: {
      grounds: ["for_convenience", "for_cause"],
      noticeDays: 30, forCauseNoticeDays: 0, closeoutSteps: [],
    },
    compensation: [],
    responsibilities: [],
    requiredDocuments: [],
    ...overrides,
  };
}

describe("effective dates", () => {
  it("is inside its dates on a day between them", () => {
    expect(isWithinEffectiveDates(terms(), NOW)).toBe(true);
  });

  it("is outside before the start and after the end", () => {
    expect(isWithinEffectiveDates(terms(), "2025-12-31T00:00:00.000Z")).toBe(false);
    expect(isWithinEffectiveDates(terms(), "2027-01-02T00:00:00.000Z")).toBe(false);
  });

  it("treats an open-ended agreement as inside forever", () => {
    const open = terms({ effective: { from: "2026-01-01T00:00:00.000Z" } });
    expect(isWithinEffectiveDates(open, "2099-01-01T00:00:00.000Z")).toBe(true);
    expect(daysUntilEnd(open, NOW)).toBeUndefined();
    expect(isInsideReminderWindow(open, NOW)).toBe(false);
  });

  it("reports the reminder window from the agreement's own term", () => {
    const soon = terms({ effective: { from: "2026-01-01T00:00:00.000Z", to: "2026-10-01T12:00:00.000Z" } });
    expect(daysUntilEnd(soon, NOW)).toBe(16);
    expect(isInsideReminderWindow(soon, NOW)).toBe(true);
    // Same dates, a shorter window: not yet.
    expect(isInsideReminderWindow(
      { ...soon, renewal: { ...soon.renewal, reminderDays: 7 } }, NOW,
    )).toBe(false);
  });

  it("does not call a contract that already ran out 'expiring'", () => {
    const past = terms({ effective: { from: "2025-01-01T00:00:00.000Z", to: "2026-08-01T00:00:00.000Z" } });
    expect(isInsideReminderWindow(past, NOW)).toBe(false);
  });
});

describe("renewal", () => {
  it("gives the last day notice can stop an automatic renewal", () => {
    expect(renewalNoticeDeadline(terms())).toBe("2026-12-01T00:00:00.000Z");
  });

  it("has no deadline when nothing rolls over by itself", () => {
    expect(renewalNoticeDeadline(terms({
      renewal: { kind: "mutual_consent", termDays: 365, reminderDays: 30 },
    }))).toBeUndefined();
    expect(renewalNoticeDeadline(terms({
      renewal: { kind: "none", reminderDays: 30 },
    }))).toBeUndefined();
  });

  it("works out the next term's dates without renewing anything", () => {
    expect(nextTermDates(terms())).toEqual({
      from: "2027-01-01T00:00:00.000Z",
      to: "2028-01-01T00:00:00.000Z",
    });
  });

  it("offers no next term for a non-renewing agreement", () => {
    expect(nextTermDates(terms({ renewal: { kind: "none", reminderDays: 30 } }))).toBeUndefined();
  });
});

describe("termination notice", () => {
  it("uses the convenience period for a convenience termination", () => {
    expect(noticeDaysFor(terms().termination, "for_convenience")).toBe(30);
    expect(terminationEffectiveDate(terms(), "for_convenience", NOW))
      .toBe("2026-10-15T12:00:00.000Z");
  });

  it("takes effect at once for cause when the agreement says zero days", () => {
    expect(terminationEffectiveDate(terms(), "for_cause", NOW)).toBe(NOW);
  });

  it("takes effect at once when both sides agreed, with no notice to give", () => {
    const mutual = terms({
      termination: { ...terms().termination, grounds: ["mutual"], noticeDays: 90 },
    });
    expect(terminationEffectiveDate(mutual, "mutual", NOW)).toBe(NOW);
  });

  it("refuses a ground the agreement does not allow", () => {
    expect(() => assertGroundAllowed(terms(), "mutual")).toThrow(ContractTermsError);
    expect(() => assertGroundAllowed(terms(), "for_cause")).not.toThrow();
  });
});

describe("compensation rules are terms, not arithmetic", () => {
  const rule = (overrides: Partial<CompensationRule>): CompensationRule => ({
    id: "cr", kind: "percentage_of_revenue", label: "Share",
    detail: "share of revenue", percentageBasisPoints: 6250,
    payeeRole: "owner_operator", ...overrides,
  });

  it("returns the rules in force on a date, so history is not rewritten", () => {
    const t = terms({
      compensation: [
        rule({ id: "old", percentageBasisPoints: 6000, appliesTo: "2026-05-31T00:00:00.000Z" }),
        rule({ id: "new", percentageBasisPoints: 6500, appliesFrom: "2026-06-01T00:00:00.000Z" }),
      ],
    });
    expect(compensationRulesAt(t, "2026-05-15T00:00:00.000Z").map((r) => r.id)).toEqual(["old"]);
    expect(compensationRulesAt(t, "2026-07-15T00:00:00.000Z").map((r) => r.id)).toEqual(["new"]);
  });

  it("treats a rule with no window as applying for the whole version", () => {
    const t = terms({ compensation: [rule({ id: "always" })] });
    expect(compensationRulesAt(t, "2026-03-01T00:00:00.000Z").map((r) => r.id)).toEqual(["always"]);
    // Before the version's own start date, nothing applies.
    expect(compensationRulesAt(t, "2025-06-01T00:00:00.000Z")).toEqual([]);
  });

  it("refuses a percentage over 100%", () => {
    expect(validateCompensationRule(rule({ percentageBasisPoints: 10_001 })))
      .toContain("A percentage cannot be more than 100%.");
  });

  it("refuses a fractional amount rather than rounding it", () => {
    expect(validateCompensationRule(rule({ kind: "flat_per_load", amountCents: 1249.99 })))
      .toContain("Amount must be a whole number.");
  });

  it("refuses a negative rate", () => {
    expect(validateCompensationRule(rule({ kind: "hourly", rateCents: -100 })))
      .toContain("Rate cannot be negative.");
  });

  it("asks a flat-per-period rule what it is per", () => {
    expect(validateCompensationRule(rule({ kind: "flat_per_period", amountCents: 50_000 })))
      .toContain("A flat-per-period rule needs to say what it is per.");
  });

  it("refuses a window that ends before it starts", () => {
    expect(validateCompensationRule(rule({
      appliesFrom: "2026-06-01T00:00:00.000Z", appliesTo: "2026-05-01T00:00:00.000Z",
    }))).toContain("A rule cannot stop applying before it starts.");
  });
});

describe("what must be true before a version is issued", () => {
  it("passes complete terms", () => {
    expect(validateTermsForIssue(terms())).toEqual([]);
  });

  it("asks for a summary and a start date", () => {
    const problems = validateTermsForIssue(terms({
      summary: "  ",
      effective: { from: "" },
      renewal: { kind: "none", reminderDays: 30 },
    }));
    expect(problems).toContain("The agreement needs a plain-language summary.");
    expect(problems).toContain("The agreement needs a start date.");
  });

  it("refuses an end date at or before the start", () => {
    expect(validateTermsForIssue(terms({
      effective: { from: "2026-06-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
    }))).toContain("The end date has to be after the start date.");
  });

  it("refuses a renewing agreement with no end date to renew from", () => {
    expect(validateTermsForIssue(terms({ effective: { from: "2026-01-01T00:00:00.000Z" } })))
      .toContain("An agreement with no end date cannot renew — there is nothing to renew from.");
  });

  it("insists an automatic renewal says how much notice stops it", () => {
    expect(validateTermsForIssue(terms({
      renewal: { kind: "automatic", termDays: 365, reminderDays: 45 },
    }))).toContain("An automatic renewal needs to say how much notice stops it.");
  });

  it("insists the agreement says how it can be ended", () => {
    expect(validateTermsForIssue(terms({
      termination: { grounds: [], noticeDays: 30, forCauseNoticeDays: 0, closeoutSteps: [] },
    }))).toContain("The agreement has to say on what grounds it can be ended.");
  });

  it("labels a compensation problem with the rule it came from", () => {
    const problems = validateTermsForIssue(terms({
      compensation: [{
        id: "cr", kind: "percentage_of_revenue", label: "Driver share",
        detail: "d", payeeRole: "driver",
      }],
    }));
    expect(problems).toContain("Driver share: A percentage rule needs a percentage.");
  });
});
