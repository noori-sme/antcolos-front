import { beforeAll, describe, expect, it } from "vitest";
import { PermissionDeniedError } from "@/lib/api/contracts/context";
import { mockLoadsService } from "@/lib/api/mock/loads";
import { mockReportsService } from "@/lib/api/mock/reports";
import { destinationStop, type ReportResult } from "@/types";
import {
  CARRIER_WITHOUT_DATA, contextFor, DISPATCH_OWNER, DRIVER,
  INDIVIDUAL_DISPATCHER, OWNER_CARRIER, wideFilters,
} from "./helpers";

/**
 * The service is the boundary. These tests ask it the questions a hostile
 * client would: can a dispatcher reach an organization-wide number, can a
 * dispatch workspace see a carrier that did not share, can a drill-down reach
 * past the report that produced it.
 */
describe("reports service — permissions and audience", () => {
  it("refuses a membership without reports:view", async () => {
    const ctx = contextFor(DRIVER);
    expect(ctx.permissions.has("reports:view")).toBe(false);
    await expect(mockReportsService.workspace(ctx)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    await expect(
      mockReportsService.run(ctx, { reportId: "carrier_revenue", filters: wideFilters() }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("puts a carrier owner on the carrier reports", async () => {
    const workspace = await mockReportsService.workspace(contextFor(OWNER_CARRIER));
    expect(workspace.audience).toBe("carrier_org");
    const ids = workspace.entries.map((e) => e.definition.id);
    expect(ids).toContain("carrier_revenue");
    expect(ids).not.toContain("dispatch_commission_revenue");
    expect(ids).not.toContain("my_income");
  });

  it("puts a dispatch owner on the dispatch reports", async () => {
    const workspace = await mockReportsService.workspace(contextFor(DISPATCH_OWNER));
    expect(workspace.audience).toBe("dispatch_org");
    const ids = workspace.entries.map((e) => e.definition.id);
    expect(ids).toContain("dispatch_commission_revenue");
    expect(ids).toContain("dispatch_broker_response");
    expect(ids).not.toContain("carrier_revenue");
  });

  it("gives a dispatcher without revenue:view only their own reports", async () => {
    const ctx = contextFor(INDIVIDUAL_DISPATCHER);
    expect(ctx.permissions.has("reports:view")).toBe(true);
    expect(ctx.permissions.has("revenue:view")).toBe(false);

    const workspace = await mockReportsService.workspace(ctx);
    expect(workspace.audience).toBe("dispatcher_individual");
    const ids = workspace.entries.map((e) => e.definition.id);
    expect(ids.every((id) => id.startsWith("my_"))).toBe(true);
  });

  it("denies an individual membership an organization-wide report", async () => {
    const ctx = contextFor(INDIVIDUAL_DISPATCHER);
    for (const reportId of ["dispatch_commission_revenue", "carrier_revenue"] as const) {
      await expect(
        mockReportsService.run(ctx, { reportId, filters: wideFilters() }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    }
  });

  it("denies a report whose own permissions are missing, naming them", async () => {
    // The dispatch owner holds everything; strip one key and the report closes.
    const ctx = contextFor(DISPATCH_OWNER);
    const narrowed = {
      ...ctx,
      permissions: new Set([...ctx.permissions].filter((p) => p !== "customers:view")),
    };
    await expect(
      mockReportsService.run(narrowed, {
        reportId: "dispatch_broker_response",
        filters: wideFilters(),
      }),
    ).rejects.toMatchObject({ required: ["customers:view"] });
  });
});

describe("reports service — workspace and carrier isolation", () => {
  it("only offers carriers that shared their records", async () => {
    const workspace = await mockReportsService.workspace(contextFor("mem_meridian_dispatcher"));
    const names = workspace.carriers.map((c) => c.name);
    expect(names).not.toContain("Crosswind Freight");
  });

  it("excludes a carrier that has not shared, and says how many it excluded", async () => {
    // Meridian's owner-equivalent view: use a context with revenue:view so the
    // organization-wide report runs, then check what it refused to analyse.
    const ctx = contextFor("mem_meridian_dispatcher");
    const elevated = {
      ...ctx,
      permissions: new Set([...ctx.permissions, "revenue:view", "rates:view"] as const),
    };
    const result = await mockReportsService.run(elevated, {
      reportId: "dispatch_carrier_performance",
      filters: wideFilters(),
    });

    const carriers = result.rows.map((r) => r.label);
    expect(carriers).not.toContain("Crosswind Freight");
    const excluded = result.notices.find((n) => n.kind === "excluded_records");
    expect(excluded?.message).toMatch(/not shared records/);
  });

  it("cannot be drilled into a record the report excluded", async () => {
    const ctx = contextFor("mem_meridian_dispatcher");
    const elevated = {
      ...ctx,
      permissions: new Set([...ctx.permissions, "revenue:view", "rates:view"] as const),
    };
    // Ask the Loads module directly for the withheld carrier's load…
    const page = await mockLoadsService.list(elevated, { view: "all" });
    const withheld = page.items.find(
      (l) => l.assignment?.carrierOrganizationId === "carrier_crosswind",
    );
    expect(withheld).toBeDefined();

    // …then ask reporting to open it. It is not in the report, so it is not returned.
    const records = await mockReportsService.drilldown(elevated, {
      reportId: "dispatch_carrier_performance",
      filters: wideFilters(),
      ref: { kind: "load", ids: [withheld!.id], label: "1 load" },
    });
    expect(records).toEqual([]);
  });

  it("reports a workspace the Loads module cannot serve as unavailable, not empty", async () => {
    const result = await mockReportsService.run(contextFor(CARRIER_WITHOUT_DATA), {
      reportId: "carrier_revenue",
      filters: wideFilters(),
    });
    const loads = result.sources.find((s) => s.key === "loads");
    expect(loads?.availability).toBe("unavailable");
    expect(result.rows.every((row) => row.values.revenue === 0 || row.values.revenue == null)).toBe(true);
    expect(result.notices.some((n) => n.message.includes("no records"))).toBe(true);
  });
});

describe("reports service — numbers trace back to the source records", () => {
  let revenue: ReportResult;

  beforeAll(async () => {
    revenue = await mockReportsService.run(contextFor(OWNER_CARRIER), {
      reportId: "carrier_revenue",
      filters: wideFilters(),
    });
  });

  it("sums the loads the Loads module actually returned", async () => {
    const ctx = contextFor(OWNER_CARRIER);
    const page = await mockLoadsService.list(ctx, { view: "all" }, undefined, { limit: 500 });
    // Revenue is freight that moved: no cancelled load, no draft, and nothing
    // that has not delivered yet.
    const moved = ["delivered", "ready_to_invoice", "invoiced", "paid"];
    const expected = page.items
      .filter((l) => moved.includes(l.status) || destinationStop(l).arrivedAt)
      .reduce((total, load) => total + (load.financials?.totalRateCents ?? 0), 0);

    const summary = revenue.summary.find((m) => m.key === "revenue");
    expect(summary?.value).toBe(expected);
    expect(revenue.recordCount).toBeGreaterThan(0);
  });

  it("agrees between the summary, the table rows and the trend points", () => {
    const summary = revenue.summary.find((m) => m.key === "revenue")!.value!;
    const rowTotal = revenue.rows.reduce((t, row) => t + (row.values.revenue ?? 0), 0);
    const trendTotal = (revenue.trend?.points ?? []).reduce(
      (t, point) => t + (point.values.revenue ?? 0),
      0,
    );
    expect(rowTotal).toBe(summary);
    expect(trendTotal).toBe(summary);
  });

  it("opens the loads behind a number", async () => {
    const ctx = contextFor(OWNER_CARRIER);
    const metric = revenue.summary.find((m) => m.key === "revenue")!;
    expect(metric.drilldown?.kind).toBe("load");

    const records = await mockReportsService.drilldown(ctx, {
      reportId: "carrier_revenue",
      filters: wideFilters(),
      ref: metric.drilldown!,
    });
    expect(records.length).toBe(metric.drilldown!.ids.length);
    for (const record of records) {
      expect(record.availability).toBe("live");
      expect(record.href).toMatch(/^\/loads\//);
    }
  });

  it("keeps rate per mile consistent with revenue and miles", async () => {
    const result = await mockReportsService.run(contextFor(OWNER_CARRIER), {
      reportId: "carrier_rpm",
      filters: wideFilters(),
    });
    const rpm = result.summary.find((m) => m.key === "rpm")!.value!;
    const miles = result.summary.find((m) => m.key === "loadedMiles")!.value!;
    const revenueCents = result.summary.find((m) => m.key === "revenue")!.value!;
    expect(rpm).toBeCloseTo(revenueCents / miles, 6);
  });

  it("honours the date range", async () => {
    const narrow = await mockReportsService.run(contextFor(OWNER_CARRIER), {
      reportId: "carrier_revenue",
      filters: {
        range: {
          from: new Date(Date.now() - 200 * 86_400_000).toISOString(),
          to: new Date(Date.now() - 190 * 86_400_000).toISOString(),
        },
      },
    });
    expect(narrow.recordCount).toBe(0);
    expect(narrow.summary.find((m) => m.key === "revenue")?.value).toBe(0);
    expect(narrow.notices.some((n) => n.kind === "no_data")).toBe(true);
  });
});

describe("reports service — an individual dispatcher", () => {
  it("analyses only the loads credited to them, and never the load's rate", async () => {
    const ctx = contextFor(INDIVIDUAL_DISPATCHER);
    const result = await mockReportsService.run(ctx, {
      reportId: "my_income",
      filters: wideFilters(),
    });

    expect(result.audience).toBe("dispatcher_individual");

    // The Loads module already redacted rates, so no money from a load can
    // reach this report at all — their income comes from their own earnings.
    const page = await mockLoadsService.list(ctx, { view: "all" });
    expect(page.items.every((l) => l.financials === undefined)).toBe(true);

    const mine = result.summary.find((m) => m.key === "myLoads")!.value!;
    expect(mine).toBeLessThanOrEqual(page.items.length);
  });

  it("drills down into its own loads only", async () => {
    const ctx = contextFor(INDIVIDUAL_DISPATCHER);
    const result = await mockReportsService.run(ctx, {
      reportId: "my_loads",
      filters: wideFilters(),
    });
    const ids = result.rows.flatMap((row) => row.drilldown?.ids ?? []);
    const records = await mockReportsService.drilldown(ctx, {
      reportId: "my_loads",
      filters: wideFilters(),
      ref: { kind: "load", ids, label: `${ids.length} loads` },
    });
    expect(records.length).toBe(ids.length);
    // No rate is present on a drill-down record for a membership without rates:view.
    for (const record of records) {
      expect(record.meta.some((m) => m.label === "Rate")).toBe(false);
    }
  });
});
