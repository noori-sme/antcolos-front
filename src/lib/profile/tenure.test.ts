import { describe, expect, it } from "vitest";
import type { WorkplaceAssociation } from "@/types";
import {
  activeDaysFrom, buildTenure, daysBetween, formatDuration, formatMonth, formatPeriod,
} from "./tenure";

const AS_OF = "2026-09-20T00:00:00.000Z";

function association(
  overrides: Partial<WorkplaceAssociation> & Pick<WorkplaceAssociation, "startedAt">,
): WorkplaceAssociation {
  return {
    id: overrides.id ?? `wa_${overrides.startedAt}`,
    userId: "usr_sam",
    organizationId: overrides.organizationId ?? "org_a",
    organizationNameSnapshot: "Northline Freight",
    organizationType: "CARRIER",
    capacity: "dispatcher",
    verified: true,
    ...overrides,
  };
}

describe("active time on the platform", () => {
  it("counts overlapping associations once, not twice", () => {
    const overlapping = [
      association({ startedAt: "2026-01-01T00:00:00.000Z", endedAt: "2026-04-01T00:00:00.000Z", organizationId: "org_a" }),
      association({ startedAt: "2026-02-01T00:00:00.000Z", endedAt: "2026-05-01T00:00:00.000Z", organizationId: "org_b" }),
    ];
    // 1 Jan to 1 May is 120 days. Summing the two would give 180.
    expect(activeDaysFrom(overlapping, AS_OF)).toBe(120);
  });

  it("counts a gap between two jobs as time not worked", () => {
    const withGap = [
      association({ startedAt: "2026-01-01T00:00:00.000Z", endedAt: "2026-02-01T00:00:00.000Z" }),
      association({ startedAt: "2026-03-01T00:00:00.000Z", endedAt: "2026-04-01T00:00:00.000Z" }),
    ];
    expect(activeDaysFrom(withGap, AS_OF)).toBe(31 + 31);
  });

  it("runs an open association up to now and no further", () => {
    const current = [association({ startedAt: "2026-09-10T00:00:00.000Z" })];
    expect(activeDaysFrom(current, AS_OF)).toBe(10);
  });

  it("never lets a future or malformed association add time", () => {
    const odd = [
      association({ startedAt: "2027-01-01T00:00:00.000Z" }),
      association({ startedAt: "not-a-date" }),
      association({ startedAt: "2026-05-01T00:00:00.000Z", endedAt: "2026-04-01T00:00:00.000Z" }),
    ];
    expect(activeDaysFrom(odd, AS_OF)).toBe(0);
  });

  it("caps an end date that runs past now", () => {
    const openEnded = [
      association({ startedAt: "2026-09-01T00:00:00.000Z", endedAt: "2030-01-01T00:00:00.000Z" }),
    ];
    expect(activeDaysFrom(openEnded, AS_OF)).toBe(19);
  });
});

describe("the tenure summary", () => {
  it("separates time with an account from time doing work", () => {
    const tenure = buildTenure(
      "2025-09-20T00:00:00.000Z",
      [association({ startedAt: "2026-06-20T00:00:00.000Z", organizationId: "org_a" })],
      AS_OF,
    );
    expect(tenure.daysOnPlatform).toBe(365);
    expect(tenure.activeDays).toBe(92);
    expect(tenure.currentWorkplaces).toBe(1);
    expect(tenure.organizationsWorkedWith).toBe(1);
  });

  it("counts one organization once however many times somebody worked there", () => {
    const tenure = buildTenure(
      "2024-01-01T00:00:00.000Z",
      [
        association({ id: "a", startedAt: "2024-02-01T00:00:00.000Z", endedAt: "2025-02-01T00:00:00.000Z", organizationId: "org_a" }),
        association({ id: "b", startedAt: "2026-02-01T00:00:00.000Z", organizationId: "org_a" }),
      ],
      AS_OF,
    );
    expect(tenure.organizationsWorkedWith).toBe(1);
    expect(tenure.currentWorkplaces).toBe(1);
  });
});

describe("how periods read", () => {
  it("never reports negative time", () => {
    expect(daysBetween("2026-09-20T00:00:00.000Z", "2026-01-01T00:00:00.000Z")).toBe(0);
  });

  it("gets coarser as the period gets longer", () => {
    expect(formatDuration(0)).toBe("Today");
    expect(formatDuration(1)).toBe("1 day");
    expect(formatDuration(12)).toBe("12 days");
    expect(formatDuration(200)).toBe("6 mo");
    expect(formatDuration(365)).toBe("1 yr");
    expect(formatDuration(853)).toBe("2 yr 4 mo");
  });

  it("words an open-ended association as Present", () => {
    expect(formatPeriod("2026-05-04T00:00:00.000Z")).toBe("May 2026 – Present");
    expect(formatPeriod("2026-05-04T00:00:00.000Z", "2026-11-01T00:00:00.000Z"))
      .toBe("May 2026 – Nov 2026");
  });

  it("says so rather than rendering Invalid Date", () => {
    expect(formatMonth("nonsense")).toBe("—");
  });
});
