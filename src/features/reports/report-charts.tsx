"use client";

import {
  Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { formatAxis, formatMetric } from "@/lib/reports/format";
import { cn } from "@/lib/utils";
import type { DrilldownRef, ReportColumn, ReportResult } from "@/types";
import { MAX_SERIES, SERIES_COLORS, type MetricGroup } from "./metric-groups";

/**
 * Charts.
 *
 * Rules held here rather than left to the person drawing one:
 *  - One axis. Only metrics that share a unit are plotted together, so two
 *    scales can never be put side by side and read as a relationship.
 *  - A legend whenever there is more than one series, and a table view always,
 *    so identity never depends on colour alone.
 *  - Series colours are assigned in fixed order and never cycled.
 *  - Missing values are gaps, never zeros.
 *  - Every mark opens the records behind it.
 */

interface ChartPoint {
  id: string;
  label: string;
  drilldown?: DrilldownRef;
  values: Record<string, number | null>;
}

/**
 * A bar chart shows a slice of the rows when there are more than it can carry.
 * Which slice depends on what a row is: categories are already sorted with the
 * largest first, so the top ones are the interesting ones — but periods run in
 * time order, and the interesting end of time is the recent one.
 */
function pointsFromRows(result: ReportResult, limit: number): ChartPoint[] {
  const timeOrdered = result.trend !== null;
  const rows = timeOrdered ? result.rows.slice(-limit) : result.rows.slice(0, limit);
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    drilldown: row.drilldown,
    values: row.values,
  }));
}

function pointsFromTrend(result: ReportResult): ChartPoint[] {
  return (result.trend?.points ?? []).map((point) => ({
    id: point.key,
    label: point.label,
    drilldown: point.drilldown,
    values: point.values,
  }));
}

export function ChartLegend({ columns }: { columns: ReportColumn[] }) {
  if (columns.length < 2) return null;
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {columns.map((column, i) => (
        <li key={column.key} className="flex items-center gap-1.5 text-[0.75rem] text-fg-muted">
          <span
            aria-hidden
            className="size-2.5 rounded-xs"
            style={{ background: SERIES_COLORS[i % MAX_SERIES] }}
          />
          {column.label}
        </li>
      ))}
    </ul>
  );
}

interface TooltipPayloadEntry {
  dataKey?: string | number;
  name?: string | number;
  value?: number | string;
  color?: string;
}

function ChartTooltip({
  active,
  payload,
  label,
  columns,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string | number;
  columns: ReportColumn[];
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 shadow-e3">
      <p className="text-[0.75rem] font-semibold text-fg">{label}</p>
      <ul className="mt-1 space-y-0.5">
        {payload.map((entry) => {
          const column = columns.find((c) => c.key === entry.dataKey);
          if (!column) return null;
          return (
            <li key={String(entry.dataKey)} className="flex items-center gap-2 text-[0.75rem]">
              <span
                aria-hidden
                className="size-2 rounded-xs"
                style={{ background: entry.color }}
              />
              <span className="text-fg-muted">{column.label}</span>
              <span className="tnum ml-auto font-medium text-fg">
                {formatMetric(typeof entry.value === "number" ? entry.value : null, column.unit)}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-1.5 text-[0.6875rem] text-fg-subtle">Select to open source records</p>
    </div>
  );
}

const AXIS = { fill: "var(--chart-axis)", fontSize: 11 };
const GRID = "var(--chart-grid)";

/** Recharts hands the clicked datum back untyped; this is the shape we use. */
function drilldownOf(entry: unknown): { ref?: DrilldownRef; label: string } {
  const payload = (entry as { payload?: ChartPoint })?.payload;
  return { ref: payload?.drilldown, label: payload?.label ?? "" };
}

export function ReportBarChart({
  result,
  group,
  onDrilldown,
}: {
  result: ReportResult;
  group: MetricGroup;
  onDrilldown?: (ref: DrilldownRef, title: string) => void;
}) {
  // Periods are thin bars and read fine in quantity; named categories need room.
  const timeOrdered = result.trend !== null;
  const limit = timeOrdered ? 31 : 12;
  const points = pointsFromRows(result, limit);
  const columns = group.columns.slice(0, MAX_SERIES);
  const data = points.map((point) => ({
    ...point,
    ...Object.fromEntries(columns.map((c) => [c.key, point.values[c.key] ?? null])),
  }));
  const single = columns.length === 1;

  return (
    <figure className="space-y-3">
      <ChartLegend columns={columns} />
      <div className="h-[20rem] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 16, right: 8, bottom: 4, left: 8 }} barGap={2}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              dataKey="label"
              tick={AXIS}
              tickLine={false}
              axisLine={{ stroke: GRID }}
              interval="preserveStartEnd"
              height={36}
            />
            <YAxis
              tick={AXIS}
              tickLine={false}
              axisLine={false}
              width={64}
              tickFormatter={(value: number) => formatAxis(value, group.id)}
            />
            <Tooltip
              cursor={{ fill: "var(--color-surface-hover)" }}
              content={<ChartTooltip columns={columns} />}
            />
            {columns.map((column, i) => (
              <Bar
                key={column.key}
                dataKey={column.key}
                name={column.label}
                fill={SERIES_COLORS[i % MAX_SERIES]}
                radius={[4, 4, 0, 0]}
                maxBarSize={44}
                isAnimationActive={false}
                cursor={onDrilldown ? "pointer" : undefined}
                onClick={(entry: unknown) => {
                  const { ref, label } = drilldownOf(entry);
                  if (ref && onDrilldown) onDrilldown(ref, label);
                }}
              >
                {single && data.length <= 10 ? (
                  <LabelList
                    dataKey={column.key}
                    position="top"
                    className="fill-fg-muted text-[0.6875rem]"
                    formatter={(value: unknown) =>
                      typeof value === "number" ? formatMetric(value, column.unit, { compact: true }) : ""
                    }
                  />
                ) : null}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="text-[0.75rem] text-fg-subtle">
        {result.rows.length > limit
          ? timeOrdered
            ? `Showing the most recent ${limit} of ${result.rows.length} periods. The table view shows all of them.`
            : `Showing the top ${limit} of ${result.rows.length} ${result.rowLabel.toLowerCase()} rows by ${result.columns[0]?.label.toLowerCase()}. The table view shows all of them.`
          : `${result.rows.length} ${result.rowLabel.toLowerCase()} row${result.rows.length === 1 ? "" : "s"}.`}
      </figcaption>
    </figure>
  );
}

export function ReportLineChart({
  result,
  group,
  onDrilldown,
}: {
  result: ReportResult;
  group: MetricGroup;
  onDrilldown?: (ref: DrilldownRef, title: string) => void;
}) {
  const points = pointsFromTrend(result);
  const columns = group.columns.slice(0, MAX_SERIES);
  const data = points.map((point) => ({
    ...point,
    ...Object.fromEntries(columns.map((c) => [c.key, point.values[c.key] ?? null])),
  }));

  return (
    <figure className="space-y-3">
      <ChartLegend columns={columns} />
      <div className="h-[20rem] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 16, right: 12, bottom: 4, left: 8 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              dataKey="label"
              tick={AXIS}
              tickLine={false}
              axisLine={{ stroke: GRID }}
              interval="preserveStartEnd"
              minTickGap={24}
              height={36}
            />
            <YAxis
              tick={AXIS}
              tickLine={false}
              axisLine={false}
              width={64}
              tickFormatter={(value: number) => formatAxis(value, group.id)}
            />
            <Tooltip
              cursor={{ stroke: GRID, strokeWidth: 1 }}
              content={<ChartTooltip columns={columns} />}
            />
            {columns.map((column, i) => (
              <Line
                key={column.key}
                type="monotone"
                dataKey={column.key}
                name={column.label}
                stroke={SERIES_COLORS[i % MAX_SERIES]}
                strokeWidth={2}
                dot={{ r: 3, strokeWidth: 0, fill: SERIES_COLORS[i % MAX_SERIES] }}
                activeDot={{ r: 5, cursor: onDrilldown ? "pointer" : undefined }}
                isAnimationActive={false}
                // A period with no records is a gap in the line, not a zero.
                connectNulls={false}
                onClick={(entry: unknown) => {
                  const { ref, label } = drilldownOf(entry);
                  if (ref && onDrilldown) onDrilldown(ref, label);
                }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="text-[0.75rem] text-fg-subtle">
        {result.trend?.granularity === "day"
          ? "One point per day."
          : result.trend?.granularity === "week"
            ? "One point per week, starting Monday."
            : "One point per month."}{" "}
        Zero means nothing happened in that period; a gap means the number could
        not be worked out for it.
      </figcaption>
    </figure>
  );
}

/** Switches between the metric groups a chart can honestly plot at once. */
export function MetricGroupPicker({
  groups,
  value,
  onChange,
}: {
  groups: MetricGroup[];
  value: MetricGroup;
  onChange: (group: MetricGroup) => void;
}) {
  if (groups.length < 2) return null;
  return (
    <div role="tablist" aria-label="Chart measure" className="flex flex-wrap gap-1">
      {groups.map((group) => (
        <button
          key={group.id}
          role="tab"
          aria-selected={group.id === value.id}
          onClick={() => onChange(group)}
          className={cn(
            "h-control-sm rounded-md px-2.5 text-[0.8125rem] font-medium transition-colors",
            group.id === value.id
              ? "bg-surface-hover text-fg ring-1 ring-border"
              : "text-fg-muted hover:bg-surface-hover hover:text-fg",
          )}
        >
          {group.label}
        </button>
      ))}
    </div>
  );
}
