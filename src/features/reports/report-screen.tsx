"use client";

import { Download, FileQuestion } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isReportId, reportDefinition } from "@/lib/reports/catalog";
import { isEmptyResult } from "@/lib/reports/compute";
import { buildExport, exportFileName, exportToCsv } from "@/lib/reports/export";
import { rangeFromPreset } from "@/lib/reports/range";
import { useCan } from "@/lib/session/hooks";
import type { DrilldownRef, ReportFilters, ReportView } from "@/types";
import { DefinitionsPanel } from "./definitions-panel";
import { DrilldownSheet } from "./drilldown-sheet";
import { ReportFilterBar } from "./filter-bar";
import { useReport, useReportWorkspace } from "./hooks";
import { MetricTiles } from "./metric-tiles";
import { metricGroups } from "./metric-groups";
import { useReportPreferences, useRememberedView } from "./preferences";
import { MetricGroupPicker, ReportBarChart, ReportLineChart } from "./report-charts";
import { ReportSummaryText } from "./report-summary";
import { ReportTable } from "./report-table";
import { NoticeList, SourceList } from "./source-notice";
import { ViewSwitcher } from "./view-switcher";
import { ReportDenied, deniedPermissions } from "./states";

/**
 * One report.
 *
 * The filters, the calculations, the permissions and the source records are
 * identical in every view — switching to a chart changes how the same
 * ReportResult is drawn and nothing else. The view a person last used is
 * remembered per report, and is ignored if that report cannot carry it.
 */
export function ReportScreen({ reportId }: { reportId: string }) {
  const workspace = useReportWorkspace();
  const preferences = useReportPreferences();
  const definition = isReportId(reportId) ? reportDefinition(reportId) : undefined;

  const [filters, setFilters] = useState<ReportFilters>(() => ({
    range: rangeFromPreset(preferences.rangePresetId),
  }));
  const [drilldown, setDrilldown] = useState<{ ref: DrilldownRef; title: string } | null>(null);

  const rememberedView = useRememberedView(
    definition?.id ?? "carrier_revenue",
    definition?.defaultView ?? "table",
    definition?.views ?? ["table"],
  );
  const [viewOverride, setViewOverride] = useState<ReportView | null>(null);
  const view = viewOverride ?? rememberedView;

  const query = useReport(definition?.id ?? "carrier_revenue", filters);
  const result = query.data;

  const groups = useMemo(() => metricGroups(result?.columns ?? []), [result?.columns]);
  const [groupId, setGroupId] = useState<string | null>(null);
  const group = groups.find((g) => g.id === groupId) ?? groups[0];

  const canExport = useCan("reports:export");

  if (!definition) {
    return (
      <div className="space-y-section">
        <PageHeader title="Report" />
        <EmptyState
          icon={FileQuestion}
          title="No such report"
          description="This report is not in the catalog for this workspace."
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/reports">Back to reports</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const changeView = (next: ReportView) => {
    setViewOverride(next);
    preferences.setView(definition.id, next);
  };

  const changeFilters = (next: ReportFilters) => {
    setFilters(next);
    if (next.range.presetId) preferences.setRangePresetId(next.range.presetId);
  };

  const download = () => {
    if (!result) return;
    const csv = exportToCsv(buildExport(result, definition));
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = exportFileName(result, definition);
    link.click();
    URL.revokeObjectURL(url);
  };

  const denied = query.isError ? deniedPermissions(query.error) : null;

  return (
    <div className="space-y-section">
      <PageHeader
        title={definition.title}
        description={definition.description}
        actions={
          <div className="flex items-center gap-2">
            {workspace.data ? (
              <Badge tone="outline">{workspace.data.organizationName}</Badge>
            ) : null}
            {canExport ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={download}
                disabled={!result || result.rows.length === 0}
              >
                <Download aria-hidden />
                Export CSV
              </Button>
            ) : null}
          </div>
        }
      />

      <ReportFilterBar
        filters={filters}
        onChange={changeFilters}
        carriers={workspace.data?.carriers ?? []}
        carrierFilterEnabled={workspace.data?.audience === "dispatch_org"}
        organizationName={workspace.data?.organizationName ?? "This workspace"}
      />

      {query.isPending ? (
        <div className="space-y-3">
          <LoadingSkeleton rows={2} />
          <LoadingSkeleton rows={6} />
        </div>
      ) : denied ? (
        <ReportDenied
          required={denied}
          message={
            workspace.data?.audience === "dispatcher_individual"
              ? "This is an organization-wide report. Your membership can see its own work only."
              : undefined
          }
        />
      ) : query.isError ? (
        <ErrorState
          title="Could not run this report"
          description={query.error.message}
          onRetry={() => query.refetch()}
        />
      ) : result ? (
        <>
          <NoticeList notices={result.notices} />
          <MetricTiles
            metrics={result.summary}
            onDrilldown={(ref) => setDrilldown({ ref, title: definition.title })}
          />

          <Card>
            <CardHeader className="flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              <div className="min-w-0">
                <CardTitle>By {definition.rowLabel.toLowerCase()}</CardTitle>
                <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                  {result.recordCount} source record{result.recordCount === 1 ? "" : "s"} analysed ·
                  same filters and calculations in every view
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <ViewSwitcher views={definition.views} value={view} onChange={changeView} />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {isEmptyResult(result) ? (
                <EmptyState
                  title="Nothing in this date range"
                  description="No source records fall inside the filters. Widen the range, or check that the records exist in their own module."
                />
              ) : view === "table" ? (
                <ReportTable
                  result={result}
                  onDrilldown={(ref, title) => setDrilldown({ ref, title })}
                />
              ) : view === "summary" ? (
                <ReportSummaryText
                  result={result}
                  onDrilldown={(ref, title) => setDrilldown({ ref, title })}
                />
              ) : group ? (
                <>
                  <MetricGroupPicker
                    groups={groups}
                    value={group}
                    onChange={(next) => setGroupId(next.id)}
                  />
                  {view === "bar" ? (
                    <ReportBarChart
                      result={result}
                      group={group}
                      onDrilldown={(ref, title) => setDrilldown({ ref, title })}
                    />
                  ) : (
                    <ReportLineChart
                      result={result}
                      group={group}
                      onDrilldown={(ref, title) => setDrilldown({ ref, title })}
                    />
                  )}
                </>
              ) : null}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <DefinitionsPanel definitions={result.definitions} />
            <Card>
              <CardHeader>
                <CardTitle>Sources</CardTitle>
              </CardHeader>
              <CardContent>
                <SourceList sources={result.sources} />
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}

      <DrilldownSheet
        reportId={definition.id}
        filters={filters}
        target={drilldown?.ref ?? null}
        title={drilldown?.title ?? ""}
        onOpenChange={(open) => {
          if (!open) setDrilldown(null);
        }}
      />
    </div>
  );
}
