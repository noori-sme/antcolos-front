"use client";

import { useQuery } from "@tanstack/react-query";
import { services } from "@/lib/api";
import { useServiceContext } from "@/lib/api/use-service-context";
import { queryKeys } from "@/lib/query/keys";
import type { DrilldownRef, ReportFilters, ReportId } from "@/types";

/**
 * Every reporting query carries the ServiceContext and nothing else. No screen
 * passes an organization id, a membership id or a permission set of its own —
 * the workspace a report runs in is decided by who is signed in.
 */

export function useReportWorkspace() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.reportWorkspace(ctx.organizationId, ctx.membershipId)
      : ["reports", "no-context"],
    queryFn: () => services.reports.workspace(ctx!),
    enabled: Boolean(ctx),
    retry: false,
  });
}

export function useReport(reportId: ReportId, filters: ReportFilters) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.report(ctx.organizationId, ctx.membershipId, reportId, filters)
      : ["report", "no-context"],
    queryFn: () => services.reports.run(ctx!, { reportId, filters }),
    enabled: Boolean(ctx),
    retry: false,
  });
}

/** Loads the source records behind one number, on demand. */
export function useDrilldown(
  reportId: ReportId,
  filters: ReportFilters,
  ref: DrilldownRef | null,
) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? queryKeys.reportDrilldown(ctx.organizationId, ctx.membershipId, reportId, filters, ref)
      : ["drilldown", "no-context"],
    queryFn: () => services.reports.drilldown(ctx!, { reportId, filters, ref: ref! }),
    enabled: Boolean(ctx) && Boolean(ref),
    retry: false,
  });
}

export function useReportSources() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? [...queryKeys.reportWorkspace(ctx.organizationId, ctx.membershipId), "sources"]
      : ["report-sources", "no-context"],
    queryFn: () => services.reports.sources(ctx!),
    enabled: Boolean(ctx),
    retry: false,
  });
}
