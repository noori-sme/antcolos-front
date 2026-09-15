import { describe, expect, it } from "vitest";
import { REPORTS, isReportId, reportDefinition } from "../catalog";
import { ROW_DIMENSION } from "../compute";
import { METRICS, metricDefinition } from "../metrics";
import { SOURCE_AVAILABILITY } from "../sources/types";

/**
 * The catalog is data, and these are the invariants that keep it honest. They
 * are the cheapest place to catch a report that promises a chart its data
 * cannot carry, or a number with no definition behind it.
 */
describe("report catalog", () => {
  it("gives every report a unique id that resolves", () => {
    const ids = REPORTS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(isReportId(id)).toBe(true);
      expect(reportDefinition(id)).toBeDefined();
    }
  });

  it("defines every metric it references", () => {
    for (const report of REPORTS) {
      for (const key of [...report.summaryMetrics, ...report.rowMetrics]) {
        expect(metricDefinition(key), `${report.id} → ${key}`).toBeDefined();
      }
    }
  });

  it("declares the sources its metrics actually read", () => {
    for (const report of REPORTS) {
      const needed = new Set(
        [...report.summaryMetrics, ...report.rowMetrics].flatMap(
          (key) => metricDefinition(key)?.sources ?? [],
        ),
      );
      for (const source of needed) {
        expect(report.sources, `${report.id} is missing source ${source}`).toContain(source);
      }
    }
  });

  it("offers a line chart only where the rows are ordered in time", () => {
    for (const report of REPORTS) {
      if (report.views.includes("line")) {
        expect(ROW_DIMENSION[report.id], `${report.id} plots a line`).toBe("period");
      }
    }
  });

  it("always offers the table and the summary, and defaults to a view it offers", () => {
    for (const report of REPORTS) {
      expect(report.views).toContain("table");
      expect(report.views).toContain("summary");
      expect(report.views).toContain(report.defaultView);
      expect(report.rowMetrics.length).toBeGreaterThan(0);
      expect(report.summaryMetrics.length).toBeGreaterThan(0);
    }
  });

  it("gives every metric a definition, a formula and at least one source", () => {
    for (const metric of Object.values(METRICS)) {
      expect(metric.definition.length).toBeGreaterThan(20);
      expect(metric.formula.length).toBeGreaterThan(3);
      expect(metric.sources.length).toBeGreaterThan(0);
    }
  });

  it("says out loud which sources are not live", () => {
    for (const [key, entry] of Object.entries(SOURCE_AVAILABILITY)) {
      if (entry.availability !== "live") {
        expect(entry.note, `${key} must explain itself`).toMatch(/mock|not connected|no .* module/i);
      }
    }
  });
});
