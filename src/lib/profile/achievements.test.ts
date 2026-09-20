import { describe, expect, it } from "vitest";
import type { Achievement, ContributionKind, ProfileCapacity, ProfileContribution } from "@/types";
import {
  ACHIEVEMENT_RULES, CONFERRED_DEFINITIONS, crossingDate, evaluateAchievements,
  headlineAchievement,
} from "./achievements";

const AS_OF = "2026-09-20T00:00:00.000Z";

let seq = 0;
function row(
  kind: ContributionKind,
  value: number,
  occurredAt: string,
  capacity: ProfileCapacity = "dispatcher",
): ProfileContribution {
  seq += 1;
  return {
    id: `pc_${seq}`,
    userId: "usr_sam",
    organizationId: "org_northline",
    organizationNameSnapshot: "Northline Freight",
    capacity,
    kind,
    value,
    occurredAt,
  };
}

const keysOf = (list: Achievement[]) => list.map((a) => a.key);

describe("when a threshold was crossed", () => {
  it("dates the badge to the row that crossed the line, not to today", () => {
    const rows = [
      row("load_dispatched", 60, "2026-02-01T00:00:00.000Z"),
      row("load_dispatched", 45, "2026-03-04T00:00:00.000Z"),
      row("load_dispatched", 30, "2026-06-01T00:00:00.000Z"),
    ];
    expect(crossingDate(rows, 100)).toBe("2026-03-04T00:00:00.000Z");
  });

  it("returns nothing when the line was never reached", () => {
    expect(crossingDate([row("load_dispatched", 4, "2026-01-01T00:00:00.000Z")], 100)).toBeNull();
  });

  it("takes the badge back when a reversal drops the total below the line", () => {
    const rows = [
      row("load_dispatched", 100, "2026-01-01T00:00:00.000Z"),
      row("load_dispatched", -5, "2026-01-05T00:00:00.000Z"),
    ];
    expect(crossingDate(rows, 100)).toBeNull();
  });

  it("dates a re-crossing to the row that made it stick", () => {
    const rows = [
      row("load_dispatched", 100, "2026-01-01T00:00:00.000Z"),
      row("load_dispatched", -5, "2026-01-05T00:00:00.000Z"),
      row("load_dispatched", 5, "2026-02-09T00:00:00.000Z"),
    ];
    expect(crossingDate(rows, 100)).toBe("2026-02-09T00:00:00.000Z");
  });

  it("reads rows in the order they happened, not the order they arrived", () => {
    const rows = [
      row("load_dispatched", 40, "2026-05-01T00:00:00.000Z"),
      row("load_dispatched", 70, "2026-01-01T00:00:00.000Z"),
    ];
    expect(crossingDate(rows, 100)).toBe("2026-05-01T00:00:00.000Z");
  });
});

describe("evaluating a dispatcher", () => {
  it("awards every threshold that was passed and none that was not", () => {
    const badges = evaluateAchievements({
      joinedAt: "2026-01-01T00:00:00.000Z",
      asOf: AS_OF,
      contributions: [
        row("load_dispatched", 140, "2026-04-01T00:00:00.000Z"),
        row("revenue_booked", 110_000_000, "2026-04-01T00:00:00.000Z"),
      ],
    });
    expect(keysOf(badges)).toContain("dispatch.loads.1");
    expect(keysOf(badges)).toContain("dispatch.loads.100");
    expect(keysOf(badges)).toContain("dispatch.revenue.1m");
    expect(keysOf(badges)).not.toContain("dispatch.loads.500");
    expect(keysOf(badges)).not.toContain("dispatch.revenue.10m");
  });

  it("carries the figure that met the threshold", () => {
    const [badge] = evaluateAchievements({
      joinedAt: "2026-01-01T00:00:00.000Z",
      asOf: AS_OF,
      contributions: [row("load_dispatched", 140, "2026-04-01T00:00:00.000Z")],
    }).filter((a) => a.key === "dispatch.loads.100");
    expect(badge.value).toBe(140);
  });

  it("never lets driving work earn a dispatch badge", () => {
    const badges = evaluateAchievements({
      joinedAt: "2026-01-01T00:00:00.000Z",
      asOf: AS_OF,
      contributions: [row("load_dispatched", 500, "2026-04-01T00:00:00.000Z", "driver")],
    });
    expect(keysOf(badges)).not.toContain("dispatch.loads.100");
  });
});

describe("evaluating a driver", () => {
  const deliveries = (count: number, at: string) => [
    row("load_delivered", count, at, "driver"),
    row("delivery_on_time", count, at, "driver"),
  ];

  it("gates quality badges on volume, so three perfect loads win nothing", () => {
    const badges = evaluateAchievements({
      joinedAt: "2026-01-01T00:00:00.000Z",
      asOf: AS_OF,
      contributions: [...deliveries(3, "2026-02-01T00:00:00.000Z"), row("clean_inspection", 1, "2026-02-01T00:00:00.000Z", "driver")],
    });
    expect(keysOf(badges)).not.toContain("driver.safety.5star");
    expect(keysOf(badges)).not.toContain("driver.ontime.98");
  });

  it("awards them once the volume is there", () => {
    const badges = evaluateAchievements({
      joinedAt: "2026-01-01T00:00:00.000Z",
      asOf: AS_OF,
      contributions: [
        ...deliveries(120, "2026-02-01T00:00:00.000Z"),
        row("clean_inspection", 2, "2026-03-01T00:00:00.000Z", "driver"),
        row("miles_driven", 140_000, "2026-03-01T00:00:00.000Z", "driver"),
      ],
    });
    expect(keysOf(badges)).toEqual(expect.arrayContaining([
      "driver.safety.5star", "driver.ontime.98", "driver.miles.100k", "driver.loads.100",
    ]));
  });

  it("dates a rate badge to the last work that fed it", () => {
    const [badge] = evaluateAchievements({
      joinedAt: "2026-01-01T00:00:00.000Z",
      asOf: AS_OF,
      contributions: [
        ...deliveries(80, "2026-02-01T00:00:00.000Z"),
        row("miles_driven", 9_000, "2026-05-11T00:00:00.000Z", "driver"),
      ],
    }).filter((a) => a.key === "driver.ontime.98");
    expect(badge.earnedAt).toBe("2026-05-11T00:00:00.000Z");
  });

  it("withholds a safety badge from a driver with events", () => {
    const badges = evaluateAchievements({
      joinedAt: "2026-01-01T00:00:00.000Z",
      asOf: AS_OF,
      contributions: [
        ...deliveries(80, "2026-02-01T00:00:00.000Z"),
        row("safety_event", 2, "2026-03-01T00:00:00.000Z", "driver"),
      ],
    });
    expect(keysOf(badges)).not.toContain("driver.safety.5star");
  });
});

describe("time-based badges", () => {
  it("awards a year at a year, and not a day before", () => {
    const justShort = evaluateAchievements({
      joinedAt: "2025-09-21T00:00:00.000Z", asOf: AS_OF, contributions: [],
    });
    expect(keysOf(justShort)).not.toContain("tenure.year.1");

    const exactly = evaluateAchievements({
      joinedAt: "2025-09-20T00:00:00.000Z", asOf: AS_OF, contributions: [],
    });
    expect(keysOf(exactly)).toContain("tenure.year.1");
  });
});

describe("what the rule engine refuses to invent", () => {
  it("has no rule that could produce a comparative award", () => {
    const derivable = ACHIEVEMENT_RULES.map((r) => r.definition.key);
    for (const key of Object.keys(CONFERRED_DEFINITIONS)) {
      expect(derivable).not.toContain(key);
    }
  });

  it("never awards one however good the figures are", () => {
    const badges = evaluateAchievements({
      joinedAt: "2020-01-01T00:00:00.000Z",
      asOf: AS_OF,
      contributions: [
        row("load_dispatched", 50_000, "2026-01-01T00:00:00.000Z"),
        row("revenue_booked", 9_000_000_000, "2026-01-01T00:00:00.000Z"),
      ],
    });
    expect(keysOf(badges)).not.toContain("dispatch.top.quarter");
  });

  it("merges a conferred award in and sorts it with the rest", () => {
    const conferred: Achievement = {
      key: "dispatch.top.quarter",
      definition: CONFERRED_DEFINITIONS["dispatch.top.quarter"],
      earnedAt: "2026-09-19T00:00:00.000Z",
      period: "Q3 2026",
      organizationNameSnapshot: "Meridian Dispatch",
    };
    const badges = evaluateAchievements({
      joinedAt: "2026-01-01T00:00:00.000Z",
      asOf: AS_OF,
      contributions: [row("load_dispatched", 5, "2026-02-01T00:00:00.000Z")],
      conferred: [conferred],
    });
    expect(badges[0].key).toBe("dispatch.top.quarter");
    expect(badges[0].definition.origin).toBe("conferred");
  });
});

describe("the badge a share card leads with", () => {
  it("takes the highest tier, then the newest", () => {
    const badges = evaluateAchievements({
      joinedAt: "2020-01-01T00:00:00.000Z",
      asOf: AS_OF,
      contributions: [
        row("load_dispatched", 1200, "2026-06-01T00:00:00.000Z"),
        row("revenue_booked", 150_000_000, "2026-07-01T00:00:00.000Z"),
      ],
    });
    expect(headlineAchievement(badges)?.key).toBe("dispatch.loads.1000");
  });

  it("answers null for somebody with nothing yet", () => {
    expect(headlineAchievement([])).toBeNull();
  });
});
