import { describe, expect, it } from "vitest";
import type { ContributionKind, ProfileCapacity, ProfileContribution } from "@/types";
import {
  buildMetrics, contributionsBetween, dispatcherMetrics, driverMetrics,
  formatCompactUsd, formatUsd, laneLabelOf,
} from "./metrics";

let seq = 0;
function row(
  kind: ContributionKind,
  value: number,
  extra: Partial<ProfileContribution> = {},
): ProfileContribution {
  seq += 1;
  return {
    id: `pc_${seq}`,
    userId: "usr_sam",
    organizationId: "org_northline",
    organizationNameSnapshot: "Northline Freight",
    capacity: (extra.capacity ?? "dispatcher") as ProfileCapacity,
    kind,
    value,
    occurredAt: "2026-06-01T00:00:00.000Z",
    ...extra,
  };
}

describe("dispatcher metrics", () => {
  it("folds loads and revenue into an average rate", () => {
    const metrics = dispatcherMetrics([
      row("load_dispatched", 1),
      row("load_dispatched", 1),
      row("revenue_booked", 240_000),
      row("revenue_booked", 260_000),
    ]);
    expect(metrics.loadsDispatched).toBe(2);
    expect(metrics.grossRevenueBookedCents).toBe(500_000);
    expect(metrics.averageLoadRateCents).toBe(250_000);
  });

  it("reports zero rather than dividing by no loads", () => {
    const metrics = dispatcherMetrics([row("revenue_booked", 100_000)]);
    expect(metrics.loadsDispatched).toBe(0);
    expect(metrics.averageLoadRateCents).toBe(0);
  });

  it("lets a reversing row correct a total without editing one", () => {
    const metrics = dispatcherMetrics([
      row("load_dispatched", 1),
      row("revenue_booked", 300_000),
      // The load cancelled. Both rows are reversed, neither is deleted.
      row("load_dispatched", -1),
      row("revenue_booked", -300_000),
    ]);
    expect(metrics.loadsDispatched).toBe(0);
    expect(metrics.grossRevenueBookedCents).toBe(0);
  });

  it("ranks lanes by loads and prices them from the same lane's revenue", () => {
    const chi = { origin: "Chicago, IL", destination: "Dallas, TX" };
    const sea = { origin: "Seattle, WA", destination: "Boise, ID" };
    const metrics = dispatcherMetrics([
      row("load_dispatched", 1, { lane: chi }),
      row("load_dispatched", 1, { lane: chi }),
      row("revenue_booked", 500_000, { lane: chi }),
      row("load_dispatched", 1, { lane: sea }),
      row("revenue_booked", 400_000, { lane: sea }),
    ]);
    expect(metrics.topLanes).toHaveLength(2);
    expect(laneLabelOf(metrics.topLanes[0])).toBe("Chicago, IL → Dallas, TX");
    expect(metrics.topLanes[0].averageRateCents).toBe(250_000);
    expect(metrics.topLanes[1].averageRateCents).toBe(400_000);
  });

  it("keeps a lane whose revenue was never posted, at a rate of zero", () => {
    const lane = { origin: "Reno, NV", destination: "Provo, UT" };
    const metrics = dispatcherMetrics([row("load_dispatched", 1, { lane })]);
    expect(metrics.topLanes[0].loads).toBe(1);
    expect(metrics.topLanes[0].averageRateCents).toBe(0);
  });

  it("shows at most three lanes", () => {
    const rows = ["A", "B", "C", "D", "E"].flatMap((city, i) => [
      row("load_dispatched", 5 - i, { lane: { origin: city, destination: "Hub" } }),
    ]);
    expect(dispatcherMetrics(rows).topLanes).toHaveLength(3);
  });
});

describe("driver metrics", () => {
  const driver = { capacity: "driver" as ProfileCapacity };

  it("computes on-time from the deliveries that were rated", () => {
    const metrics = driverMetrics([
      row("load_delivered", 10, driver),
      row("delivery_on_time", 9, driver),
      row("delivery_late", 1, driver),
    ]);
    expect(metrics.onTimePercentage).toBe(90);
  });

  it("says nothing rather than zero when nothing has been delivered", () => {
    const metrics = driverMetrics([]);
    expect(metrics.onTimePercentage).toBeNull();
    expect(metrics.safetyScore).toBeNull();
  });

  it("does not award a perfect safety score to somebody with no history", () => {
    const metrics = driverMetrics([row("miles_driven", 0, driver)]);
    expect(metrics.safetyScore).toBeNull();
  });

  it("penalizes events, credits clean inspections and stays inside 0–100", () => {
    const clean = driverMetrics([
      row("miles_driven", 120_000, driver),
      row("clean_inspection", 6, driver),
    ]);
    expect(clean.safetyScore).toBe(100);

    const mixed = driverMetrics([
      row("miles_driven", 90_000, driver),
      row("safety_event", 2, driver),
      row("clean_inspection", 1, driver),
    ]);
    expect(mixed.safetyScore).toBe(100 - 16 + 2);

    const poor = driverMetrics([
      row("miles_driven", 10_000, driver),
      row("safety_event", 40, driver),
    ]);
    expect(poor.safetyScore).toBe(0);
  });
});

describe("assembling the grids", () => {
  it("builds one grid per capacity, in the order asked for", () => {
    const rows = [
      row("load_dispatched", 3),
      row("load_delivered", 2, { capacity: "driver" }),
    ];
    const metrics = buildMetrics(rows, ["dispatcher", "driver"]);
    expect(metrics.map((m) => m.capacity)).toEqual(["dispatcher", "driver"]);
  });

  it("never mixes one capacity's work into another's figures", () => {
    const rows = [
      row("load_dispatched", 3),
      row("load_dispatched", 99, { capacity: "driver" }),
    ];
    const [dispatch] = buildMetrics(rows, ["dispatcher"]);
    expect(dispatch).toMatchObject({ capacity: "dispatcher", loadsDispatched: 3 });
  });

  it("builds nothing for a capacity with no grid", () => {
    expect(buildMetrics([row("load_dispatched", 1)], ["safety"])).toHaveLength(0);
  });
});

describe("windows and formatting", () => {
  it("includes the start of a window and excludes its end", () => {
    const rows = [
      row("load_dispatched", 1, { occurredAt: "2026-07-01T00:00:00.000Z" }),
      row("load_dispatched", 1, { occurredAt: "2026-10-01T00:00:00.000Z" }),
    ];
    const q3 = contributionsBetween(rows, "2026-07-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z");
    expect(q3).toHaveLength(1);
  });

  it("formats money the way a share card reads it", () => {
    expect(formatCompactUsd(142_000_000)).toBe("$1.4M");
    expect(formatCompactUsd(1_820_000)).toBe("$18.2K");
    expect(formatCompactUsd(94_000)).toBe("$940");
    // A round figure loses the pointless decimal.
    expect(formatCompactUsd(100_000_000)).toBe("$1M");
    expect(formatCompactUsd(24_500_000_000)).toBe("$245M");
    expect(formatCompactUsd(-1_820_000)).toBe("-$18.2K");
    expect(formatUsd(245_000)).toBe("$2,450");
  });
});
