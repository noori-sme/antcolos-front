import { describe, expect, it } from "vitest";
import {
  isQuarterFinished, isWithinQuarter, periodId, periodLabel, quarterBounds,
  quarterDueDate, quarterOf, recentQuarters, yearOf,
} from "./periods";

describe("IFTA quarters", () => {
  it("places an instant in the right quarter", () => {
    expect(quarterOf("2026-01-01T00:00:00.000Z")).toBe(1);
    expect(quarterOf("2026-03-31T23:59:59.000Z")).toBe(1);
    expect(quarterOf("2026-04-01T00:00:00.000Z")).toBe(2);
    expect(quarterOf("2026-09-14T12:00:00.000Z")).toBe(3);
    expect(quarterOf("2026-12-31T23:00:00.000Z")).toBe(4);
    expect(yearOf("2026-12-31T23:00:00.000Z")).toBe(2026);
  });

  it("gives inclusive bounds, including a leap-year first quarter", () => {
    expect(quarterBounds(2026, 1)).toEqual({ startsOn: "2026-01-01", endsOn: "2026-03-31" });
    expect(quarterBounds(2026, 2)).toEqual({ startsOn: "2026-04-01", endsOn: "2026-06-30" });
    expect(quarterBounds(2026, 4)).toEqual({ startsOn: "2026-10-01", endsOn: "2026-12-31" });
    expect(quarterBounds(2028, 1)).toEqual({ startsOn: "2028-01-01", endsOn: "2028-03-31" });
  });

  it("puts the due date at the end of the month after the quarter", () => {
    expect(quarterDueDate(2026, 1)).toBe("2026-04-30");
    expect(quarterDueDate(2026, 2)).toBe("2026-07-31");
    expect(quarterDueDate(2026, 3)).toBe("2026-10-31");
    expect(quarterDueDate(2026, 4)).toBe("2027-01-31");
  });

  it("treats both boundaries of a quarter as inside it", () => {
    expect(isWithinQuarter("2026-04-01T00:00:00.000Z", 2026, 2)).toBe(true);
    expect(isWithinQuarter("2026-06-30T23:59:59.000Z", 2026, 2)).toBe(true);
    expect(isWithinQuarter("2026-07-01T00:00:00.000Z", 2026, 2)).toBe(false);
    expect(isWithinQuarter("2026-03-31T23:59:59.000Z", 2026, 2)).toBe(false);
  });

  it("only calls a quarter finished once it is genuinely over", () => {
    const midQ3 = Date.parse("2026-08-15T00:00:00.000Z");
    expect(isQuarterFinished(2026, 3, midQ3)).toBe(false);
    expect(isQuarterFinished(2026, 2, midQ3)).toBe(true);
    expect(isQuarterFinished(2026, 3, Date.parse("2026-10-01T00:00:01.000Z"))).toBe(true);
  });

  it("walks backwards across a year boundary", () => {
    expect(recentQuarters("2026-02-14T00:00:00.000Z", 3)).toEqual([
      { year: 2026, quarter: 1 },
      { year: 2025, quarter: 4 },
      { year: 2025, quarter: 3 },
    ]);
  });

  it("builds a period id that is unique per organization, carrier and quarter", () => {
    expect(periodId("org_a", "org_a", 2026, 2)).toBe("ifta_org_a_org_a_2026Q2");
    expect(periodId("org_a", "org_b", 2026, 2)).not.toBe(periodId("org_a", "org_a", 2026, 2));
    expect(periodLabel(2026, 2)).toBe("Q2 2026");
  });
});
