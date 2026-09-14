"use client";

import { Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatMetric } from "@/lib/reports/format";
import { metricDefinition } from "@/lib/reports/metrics";
import type { DrilldownRef, ReportResult } from "@/types";

/**
 * The summary-text view: the report read out loud.
 *
 * It is generated from the same MetricValues the tiles and the charts use, so
 * it cannot drift from them, and every sentence still ends in the records it
 * was computed from.
 */
export function ReportSummaryText({
  result,
  onDrilldown,
}: {
  result: ReportResult;
  onDrilldown?: (ref: DrilldownRef, title: string) => void;
}) {
  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="space-y-2.5 pt-5">
          {result.narrative.map((line, i) => (
            <p
              key={i}
              className={
                i === 0
                  ? "text-[0.9375rem] font-medium text-fg"
                  : "text-[0.875rem] leading-6 text-fg-muted"
              }
            >
              {line}
            </p>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          <h3 className="text-[0.875rem] font-semibold text-fg">
            {result.rowLabel} breakdown, in words
          </h3>
          <ul className="mt-2 space-y-1.5">
            {result.rows.slice(0, 12).map((row) => {
              const parts = result.columns
                .map((column) => {
                  const value = row.values[column.key];
                  if (value == null) return null;
                  return `${column.label.toLowerCase()} ${formatMetric(value, column.unit)}`;
                })
                .filter(Boolean);
              return (
                <li key={row.id} className="text-[0.875rem] leading-6 text-fg-muted">
                  <span className="font-medium text-fg">{row.label}</span>
                  {parts.length ? ` — ${parts.join(", ")}.` : " — no figures available."}
                  {row.drilldown && onDrilldown ? (
                    <button
                      type="button"
                      onClick={() => onDrilldown(row.drilldown!, row.label)}
                      className="ml-1.5 inline-flex items-center gap-1 rounded-xs text-[0.75rem] text-primary hover:underline"
                    >
                      <Search aria-hidden className="size-3" />
                      {row.drilldown.label}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {result.rows.length > 12 ? (
            <p className="mt-2 text-[0.75rem] text-fg-subtle">
              {result.rows.length - 12} more rows in the table view.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          <h3 className="text-[0.875rem] font-semibold text-fg">Headline numbers</h3>
          <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {result.summary.map((metric) => (
              <div key={metric.key} className="flex items-baseline justify-between gap-3">
                <dt className="text-[0.875rem] text-fg-muted">
                  {metricDefinition(metric.key)?.label ?? metric.key}
                </dt>
                <dd className="tnum text-[0.875rem] font-medium text-fg">
                  {metric.value == null ? "—" : formatMetric(metric.value, metric.unit)}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
