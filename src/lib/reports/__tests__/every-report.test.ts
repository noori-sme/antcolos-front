import { describe, expect, it } from "vitest";
import { mockReportsService } from "@/lib/api/mock/reports";
import { isEmptyResult } from "../compute";
import { reportsForAudience } from "../catalog";
import { resolveAudience } from "../audience";
import {
  CARRIER_WITHOUT_DATA, contextFor, DISPATCH_OWNER, INDIVIDUAL_DISPATCHER,
  OWNER_CARRIER, wideFilters,
} from "./helpers";

/**
 * Every report in the catalog, run for every membership that may run it.
 *
 * A report that throws is a broken screen, and a report the catalog offers but
 * the service refuses is a lie in the navigation. This is the test that keeps
 * the two in step as reports are added.
 */
const MEMBERSHIPS = [
  ["carrier owner", OWNER_CARRIER],
  ["dispatch owner", DISPATCH_OWNER],
  ["individual dispatcher", INDIVIDUAL_DISPATCHER],
  ["carrier with no records", CARRIER_WITHOUT_DATA],
] as const;

describe("every report runs", () => {
  for (const [label, membershipId] of MEMBERSHIPS) {
    it(`runs every report offered to a ${label}`, async () => {
      const ctx = contextFor(membershipId);
      const audience = resolveAudience(ctx.organizationType, ctx.permissions)!;
      expect(audience).toBeTruthy();

      const offered = reportsForAudience(audience, ctx.organizationType);
      expect(offered.length).toBeGreaterThan(0);

      for (const definition of offered) {
        const result = await mockReportsService.run(ctx, {
          reportId: definition.id,
          filters: wideFilters(),
        });

        expect(result.reportId).toBe(definition.id);
        expect(result.columns.length).toBe(definition.rowMetrics.length);
        expect(result.summary.length).toBe(definition.summaryMetrics.length);
        expect(result.definitions.length).toBeGreaterThan(0);
        expect(result.sources.length).toBeGreaterThan(0);
        // The summary-text view always has something to say, even when empty.
        expect(result.narrative.length).toBeGreaterThan(0);
        // A line view is only offered where there is a trend to draw.
        if (definition.views.includes("line")) expect(result.trend).not.toBeNull();
        // Nothing is silently blank: an empty report says so.
        if (isEmptyResult(result)) {
          expect(result.notices.some((n) => n.kind === "no_data")).toBe(true);
        }
      }
    }, 120_000);
  }

  it("offers a workspace exactly the reports it can run", async () => {
    for (const [, membershipId] of MEMBERSHIPS) {
      const ctx = contextFor(membershipId);
      const workspace = await mockReportsService.workspace(ctx);
      for (const entry of workspace.entries.filter((e) => e.available)) {
        await expect(
          mockReportsService.run(ctx, {
            reportId: entry.definition.id,
            filters: wideFilters(),
          }),
        ).resolves.toBeTruthy();
      }
    }
  }, 120_000);
});
