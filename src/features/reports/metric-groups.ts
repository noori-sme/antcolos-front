import type { MetricUnit, ReportColumn } from "@/types";

/**
 * Metrics that can share one axis.
 *
 * A chart never plots two different units against two scales — that is the one
 * chart mistake that makes a reader believe a relationship that is not there.
 * Metrics are grouped by unit instead, and the reader switches between groups.
 */
export interface MetricGroup {
  id: MetricUnit;
  label: string;
  columns: ReportColumn[];
}

const UNIT_LABEL: Record<MetricUnit, string> = {
  money: "Money",
  rate_per_mile: "Rate per mile",
  percent: "Share",
  miles: "Miles",
  count: "Counts",
  hours: "Hours",
  days: "Days",
};

export function metricGroups(columns: ReportColumn[]): MetricGroup[] {
  const byUnit = new Map<MetricUnit, ReportColumn[]>();
  for (const column of columns) {
    byUnit.set(column.unit, [...(byUnit.get(column.unit) ?? []), column]);
  }
  return [...byUnit.entries()].map(([unit, cols]) => ({
    id: unit,
    label: cols.length === 1 ? cols[0].label : UNIT_LABEL[unit],
    columns: cols,
  }));
}

/** Series colours, assigned in order and never cycled. */
export const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
] as const;

export const MAX_SERIES = SERIES_COLORS.length;
