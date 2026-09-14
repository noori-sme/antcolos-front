import { describe, expect, it } from "vitest";
import type { Load } from "@/types";
import { computeMetric } from "../compute/metric-values";
import type { Slice } from "../compute/slice";
import { buildExport, exportToCsv } from "../export";
import { bucketKey, bucketsIn, customRange, previousRange, rangeLengthDays } from "../range";
import { reportDefinition } from "../catalog";
import { mockReportsService } from "@/lib/api/mock/reports";
import { contextFor, OWNER_CARRIER, wideFilters } from "./helpers";

/** A load with only the fields the metric under test reads. */
function load(over: Partial<Load> & { id: string }): Load {
  const base = {
    organizationId: "org_test",
    reference: over.id,
    status: "delivered" as const,
    customer: { id: "cus", name: "Test Broker", kind: "broker" as const },
    stops: [
      {
        id: "s1", loadId: over.id, kind: "pickup" as const, sequence: 1,
        address: { city: "Chicago", state: "IL" }, timeZone: "America/Chicago",
        appointmentType: "appointment" as const,
        appointmentAt: "2026-09-01T12:00:00.000Z",
        departedAt: "2026-09-01T13:00:00.000Z",
      },
      {
        id: "s2", loadId: over.id, kind: "delivery" as const, sequence: 2,
        address: { city: "Columbus", state: "OH" }, timeZone: "America/New_York",
        appointmentType: "appointment" as const,
        appointmentAt: "2026-09-02T12:00:00.000Z",
        arrivedAt: "2026-09-02T11:00:00.000Z",
      },
    ],
    equipment: "cargo_van" as const,
    documentRequirements: [],
    createdAt: "2026-08-30T12:00:00.000Z",
    createdBy: { userId: "u", membershipId: "m", displayNameSnapshot: "T", source: "web" as const },
    updatedAt: "2026-09-02T12:00:00.000Z",
  };
  return { ...base, ...over } as Load;
}

const emptySlice: Slice = {
  loads: [], invoices: [], settlements: [], expenses: [], spells: [], sessions: [],
  opportunities: [], earnings: [], trucks: [], rateConfirmations: [], documents: [],
  carriers: [], days: 30,
};

const withLoads = (loads: Load[]): Slice => ({ ...emptySlice, loads });
const ctx = { now: Date.parse("2026-09-14T12:00:00.000Z") };

describe("metric arithmetic", () => {
  const money = (id: string, rate: number, loaded: number, deadhead: number) =>
    load({
      id,
      financials: {
        currency: "USD", linehaulCents: rate, accessorials: [], totalRateCents: rate,
        loadedMiles: loaded, deadheadMiles: deadhead,
        ratePerMileCents: Math.round(rate / loaded), driverShareCents: Math.round(rate * 0.72),
        dispatcherCommissionCents: Math.round(rate * 0.08),
      },
    });

  it("sums revenue and divides it by loaded miles for RPM", () => {
    const slice = withLoads([money("a", 40_000, 200, 20), money("b", 60_000, 300, 30)]);
    expect(computeMetric("revenue", slice, ctx)).toBe(100_000);
    expect(computeMetric("loadedMiles", slice, ctx)).toBe(500);
    expect(computeMetric("rpm", slice, ctx)).toBe(200);
    // All-in weighs the empty miles against the same revenue.
    expect(computeMetric("allInRpm", slice, ctx)).toBeCloseTo(100_000 / 550, 6);
    expect(computeMetric("deadheadPct", slice, ctx)).toBeCloseTo(50 / 550, 6);
  });

  it("does not count freight that has not delivered", () => {
    const booked = { ...money("c", 50_000, 250, 10), status: "planned" as const };
    booked.stops = booked.stops.map((s) =>
      s.kind === "delivery" ? { ...s, arrivedAt: undefined } : s,
    );
    const slice = withLoads([money("a", 40_000, 200, 20), booked]);
    expect(computeMetric("revenue", slice, ctx)).toBe(40_000);
    expect(computeMetric("loadCount", slice, ctx)).toBe(1);
    // Booked volume is a different question, and counts it.
    expect(computeMetric("bookedLoads", slice, ctx)).toBe(2);
  });

  it("returns null rather than zero when the rate is not visible", () => {
    const redacted = load({ id: "r" }); // no financials: the caller lacks rates:view
    const slice = withLoads([redacted]);
    expect(computeMetric("revenue", slice, ctx)).toBeNull();
    expect(computeMetric("rpm", slice, ctx)).toBeNull();
    // Counting loads needs no money at all, so it still answers.
    expect(computeMetric("bookedLoads", slice, ctx)).toBe(1);
  });

  it("returns a real zero when there are no records", () => {
    expect(computeMetric("revenue", emptySlice, ctx)).toBe(0);
    expect(computeMetric("loadCount", emptySlice, ctx)).toBe(0);
    // A ratio with no denominator is unknown, not zero.
    expect(computeMetric("rpm", emptySlice, ctx)).toBeNull();
    expect(computeMetric("onTimePct", emptySlice, ctx)).toBeNull();
  });

  it("will not compute a margin without a cost", () => {
    const slice = withLoads([money("a", 40_000, 200, 20)]);
    expect(computeMetric("cost", slice, ctx)).toBeNull();
    expect(computeMetric("grossProfit", slice, ctx)).toBeNull();
    expect(computeMetric("margin", slice, ctx)).toBeNull();
  });

  it("computes margin from revenue, driver pay and operating spend", () => {
    const slice: Slice = {
      ...withLoads([money("a", 100_000, 500, 50)]),
      settlements: [
        {
          id: "s", organizationId: "org_test", driverId: "d", driverName: "D",
          loadIds: ["a"], driverPayCents: 60_000, status: "paid",
          periodStart: "2026-09-01T00:00:00.000Z", periodEnd: "2026-09-08T00:00:00.000Z",
        },
      ],
      expenses: [
        {
          id: "e", organizationId: "org_test", category: "fuel",
          amountCents: 20_000, incurredAt: "2026-09-02T00:00:00.000Z",
        },
      ],
    };
    expect(computeMetric("cost", slice, ctx)).toBe(80_000);
    expect(computeMetric("grossProfit", slice, ctx)).toBe(20_000);
    expect(computeMetric("margin", slice, ctx)).toBeCloseTo(0.2, 6);
    expect(computeMetric("costPerMile", slice, ctx)).toBeCloseTo(80_000 / 550, 6);
  });

  it("judges on time against the end of the appointment window", () => {
    const early = load({ id: "on" });
    const late = load({ id: "late" });
    late.stops = late.stops.map((s) =>
      s.kind === "delivery" ? { ...s, arrivedAt: "2026-09-02T15:00:00.000Z" } : s,
    );
    expect(computeMetric("onTimePct", withLoads([early, late]), ctx)).toBe(0.5);
  });
});

describe("date ranges", () => {
  it("treats a custom range as whole inclusive days", () => {
    const range = customRange("2026-09-01", "2026-09-07");
    expect(range.from).toBe("2026-09-01T00:00:00.000Z");
    expect(range.to).toBe("2026-09-08T00:00:00.000Z");
    expect(rangeLengthDays(range)).toBe(7);
  });

  it("compares against the period immediately before, of the same length", () => {
    const range = customRange("2026-09-08", "2026-09-14");
    const before = previousRange(range);
    expect(before.to).toBe(range.from);
    expect(rangeLengthDays(before)).toBe(rangeLengthDays(range));
  });

  it("buckets weeks from Monday and covers the whole range", () => {
    // 2026-09-02 is a Wednesday; its week starts on the 31st of August.
    expect(bucketKey("2026-09-02T12:00:00.000Z", "week")).toBe("2026-08-31");
    const buckets = bucketsIn(customRange("2026-09-01", "2026-09-30"), "day");
    expect(buckets).toHaveLength(30);
    expect(buckets[0]).toBe("2026-09-01");
    expect(buckets.at(-1)).toBe("2026-09-30");
  });
});

describe("export", () => {
  it("serialises the result that was on screen, with its filters and definitions", async () => {
    const result = await mockReportsService.run(contextFor(OWNER_CARRIER), {
      reportId: "carrier_revenue",
      filters: wideFilters(),
    });
    const payload = buildExport(result, reportDefinition("carrier_revenue")!);

    expect(payload.meta.organization).toBe("Northline Freight");
    expect(payload.meta.sources.some((s) => s.module === "Loads")).toBe(true);
    expect(payload.rows).toHaveLength(result.rows.length);
    expect(payload.definitions.length).toBe(result.definitions.length);

    const csv = exportToCsv(payload);
    expect(csv).toContain("Report,Revenue");
    expect(csv).toContain("How it is calculated");
    // Money is written as dollars, not cents, and never as a formatted string.
    const revenue = result.summary.find((m) => m.key === "revenue")!.value!;
    expect(csv).toContain((revenue / 100).toFixed(2));
  });

  it("quotes a field that contains a comma", async () => {
    const result = await mockReportsService.run(contextFor(OWNER_CARRIER), {
      reportId: "carrier_lane_performance",
      filters: wideFilters(),
    });
    const csv = exportToCsv(buildExport(result, reportDefinition("carrier_lane_performance")!));
    expect(csv).toMatch(/"[^"]*, IL → [^"]*"/);
  });
});
