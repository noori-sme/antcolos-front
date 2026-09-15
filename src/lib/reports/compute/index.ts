import type {
  DrilldownRef, MetricValue, PermissionKey, ReportDefinition, ReportId,
  ReportNotice, ReportResult, ReportRow, ReportTrend,
} from "@/types";
import { metricDefinition, metricDefinitions } from "../metrics";
import { changeLabel, formatMetric } from "../format";
import {
  granularityFor, rangeLabel, rangeLengthDays,
} from "../range";
import type { ReportDataset } from "../sources/types";
import {
  SOURCE_AVAILABILITY, SOURCE_LABEL, sourceStatuses, type SourceOverrides,
} from "../sources/types";
import { computeMetric } from "./metric-values";
import {
  groupBy, previousSlice, wholeSlice, type Dimension, type Group, type Slice,
} from "./slice";

/**
 * Turns a definition plus a dataset into a finished report.
 *
 * The same slice function feeds the summary tiles, the table rows, the chart
 * points and the sentences — a view is a rendering choice, never a different
 * calculation.
 */

/** What a row is, per report. Also decides whether a line chart is honest. */
const ROW_DIMENSION: Record<ReportId, Dimension> = {
  carrier_revenue: "period",
  carrier_profit: "period",
  carrier_rpm: "period",
  carrier_deadhead: "truck",
  carrier_truck_performance: "truck",
  carrier_expenses: "expense_category",
  carrier_invoice_status: "invoice_status",
  carrier_receivables: "age_bucket",
  carrier_settlements: "driver",
  carrier_broker_performance: "broker",
  carrier_lane_performance: "lane",
  carrier_equipment_utilization: "truck",
  dispatch_commission_revenue: "period",
  dispatch_carrier_performance: "carrier",
  dispatch_dispatcher_performance: "dispatcher",
  dispatch_booked_loads: "period",
  dispatch_average_rpm: "period",
  dispatch_booking_success: "dispatcher",
  dispatch_empty_trucks: "truck",
  dispatch_time_to_cover: "carrier",
  dispatch_broker_response: "broker",
  my_income: "period",
  my_loads: "period",
  my_carriers: "carrier",
  my_performance: "period",
  my_activity: "period",
};

/** The records a metric points at, so every number can be opened. */
function drilldownFor(key: string, slice: Slice): DrilldownRef | undefined {
  const definition = metricDefinition(key);
  const primary = definition?.sources[0];
  const ref = (kind: DrilldownRef["kind"], ids: string[], noun: string) =>
    ids.length ? { kind, ids, label: `${ids.length} ${noun}${ids.length === 1 ? "" : "s"}` } : undefined;

  switch (primary) {
    case "invoices":
      return ref("invoice", slice.invoices.map((i) => i.id), "invoice");
    case "settlements":
      return ref("settlement", slice.settlements.map((s) => s.id), "settlement");
    case "expenses":
      return ref("expense", slice.expenses.map((e) => e.id), "expense record");
    case "trucks":
      return ref("truck", slice.trucks.map((t) => t.truckId), "truck");
    case "mt_loop":
      return ref("truck", [...new Set(slice.spells.map((s) => s.truckId))], "truck");
    case "search_sessions":
      return ref("search_session", slice.sessions.map((s) => s.id), "search session");
    case "opportunities":
      return ref("opportunity", slice.opportunities.map((o) => o.id), "offer");
    case "carriers":
      return ref("carrier", slice.carriers.filter((c) => c.sharing === "shared").map((c) => c.carrierOrganizationId), "carrier");
    default:
      return ref("load", slice.loads.map((l) => l.id), "load");
  }
}

/** Why a number is missing. The reader is told which of the three it is. */
function unavailableReason(
  key: string,
  held: ReadonlySet<PermissionKey>,
  slice: Slice,
  overrides: SourceOverrides,
): MetricValue["unavailable"] {
  const definition = metricDefinition(key);
  const missing = (definition?.requires ?? []).filter((p) => !held.has(p));
  if (missing.length > 0) {
    return {
      reason: "permission",
      detail: `Needs ${missing.join(" and ")}. Your membership in this organization does not include it.`,
    };
  }
  const dead = (definition?.sources ?? []).filter(
    (s) => (overrides[s] ?? SOURCE_AVAILABILITY[s]).availability === "unavailable",
  );
  if (dead.length > 0) {
    return {
      reason: "no_source",
      detail: `${dead.map((s) => SOURCE_LABEL[s]).join(" and ")} is not connected yet.`,
    };
  }
  return {
    reason: "no_data",
    detail:
      slice.loads.length === 0
        ? "No records in this date range."
        : "The records in this range do not carry what this number needs.",
  };
}

function metricValue(
  key: string,
  slice: Slice,
  previous: Slice | null,
  held: ReadonlySet<PermissionKey>,
  now: number,
  overrides: SourceOverrides,
): MetricValue {
  const definition = metricDefinition(key);
  const unit = definition?.unit ?? "count";
  const value = computeMetric(key, slice, { now });
  const previousValue = previous ? computeMetric(key, previous, { now }) : undefined;
  const changePct =
    value != null && previousValue != null && previousValue !== 0
      ? (value - previousValue) / Math.abs(previousValue)
      : null;

  return {
    key,
    value,
    unit,
    previousValue: previousValue ?? undefined,
    changePct,
    drilldown: drilldownFor(key, slice),
    unavailable: value == null ? unavailableReason(key, held, slice, overrides) : undefined,
  };
}

function buildRows(
  groups: Group[],
  metricKeys: string[],
  held: ReadonlySet<PermissionKey>,
  now: number,
  dimension: Dimension,
): ReportRow[] {
  const rows = groups.map((group) => ({
    id: group.id,
    label: group.label,
    sublabel: group.sublabel,
    values: Object.fromEntries(
      metricKeys.map((key) => [key, computeMetric(key, group.slice, { now })]),
    ) as Record<string, number | null>,
    drilldown: group.drilldown,
  }));

  if (dimension === "period") return rows; // Time is already the right order.

  // Everything else reads best largest-first on the report's headline metric.
  const primary = metricKeys[0];
  return rows
    .filter((row) => metricKeys.some((k) => row.values[k] != null))
    .sort((a, b) => (b.values[primary] ?? -Infinity) - (a.values[primary] ?? -Infinity));
}

function buildNotices(
  definition: ReportDefinition,
  dataset: ReportDataset,
  rows: ReportRow[],
  overrides: SourceOverrides,
): ReportNotice[] {
  const notices: ReportNotice[] = [];

  const dead = definition.sources.filter(
    (s) => (overrides[s] ?? SOURCE_AVAILABILITY[s]).availability === "unavailable",
  );
  if (dead.length > 0) {
    notices.push({
      kind: "no_data",
      message: dead
        .map((s) => (overrides[s] ?? SOURCE_AVAILABILITY[s]).note)
        .join(" "),
    });
  }

  const mock = definition.sources.filter(
    (s) => (overrides[s] ?? SOURCE_AVAILABILITY[s]).availability === "mock",
  );
  if (mock.length > 0) {
    notices.push({
      kind: "mock_source",
      message: `${mock.map((s) => SOURCE_LABEL[s]).join(", ")} ${
        mock.length === 1 ? "is" : "are"
      } not connected yet. Those figures come from a mock adapter and are marked wherever they appear.`,
    });
  }

  if (dataset.withheld.loadCount > 0) {
    notices.push({
      kind: "excluded_records",
      message: `${dataset.withheld.loadCount} load${
        dataset.withheld.loadCount === 1 ? "" : "s"
      } excluded: ${dataset.withheld.carrierOrganizationIds.length} carrier${
        dataset.withheld.carrierOrganizationIds.length === 1 ? " has" : "s have"
      } not shared records with this workspace.`,
    });
  }

  // A time-bucketed report always has rows — one per period — so "empty" means
  // every one of them came back with nothing in it.
  if (isEmptyRowSet(rows)) {
    notices.push({
      kind: "no_data",
      message: "No source records fall in this date range.",
    });
  }

  return notices;
}

/** True when there is nothing to read: no rows, or rows with nothing in them. */
export function isEmptyRowSet(rows: ReportRow[]): boolean {
  return (
    rows.length === 0 ||
    rows.every((row) => Object.values(row.values).every((v) => v == null || v === 0))
  );
}

/** The screens' empty state asks this rather than counting rows themselves. */
export function isEmptyResult(result: ReportResult): boolean {
  return isEmptyRowSet(result.rows);
}

/** The summary-text view: the same numbers, as sentences. */
function buildNarrative(
  definition: ReportDefinition,
  summary: MetricValue[],
  rows: ReportRow[],
  dataset: ReportDataset,
  rangeText: string,
): string[] {
  const lines: string[] = [];
  lines.push(
    `${definition.title}, ${rangeText}. ${dataset.loads.length} load record${
      dataset.loads.length === 1 ? "" : "s"
    } analyzed.`,
  );

  for (const metric of summary) {
    const definitionOf = metricDefinition(metric.key);
    const label = definitionOf?.label ?? metric.key;
    if (metric.value == null) {
      lines.push(`${label}: not available. ${metric.unavailable?.detail ?? ""}`.trim());
      continue;
    }
    const change = changeLabel(metric.changePct);
    lines.push(
      `${label}: ${formatMetric(metric.value, metric.unit)}${change ? `, ${change}` : ""}.`,
    );
  }

  const primary = definition.rowMetrics[0];
  const ranked = rows.filter((r) => r.values[primary] != null);
  if (ranked.length > 1 && primary) {
    const unit = metricDefinition(primary)?.unit ?? "count";
    const best = ranked[0];
    const worst = ranked[ranked.length - 1];
    lines.push(
      `Highest ${definition.rowLabel.toLowerCase()}: ${best.label} at ${formatMetric(
        best.values[primary], unit,
      )}. Lowest: ${worst.label} at ${formatMetric(worst.values[primary], unit)}.`,
    );
  }

  return lines;
}

export interface ComputeOptions {
  definition: ReportDefinition;
  dataset: ReportDataset;
  organizationId: string;
  organizationName: string;
  audience: ReportResult["audience"];
  filters: ReportResult["filters"];
  permissions: ReadonlySet<PermissionKey>;
  now?: number;
  /** Sources that are worse off than usual for this run. */
  sourceOverrides?: SourceOverrides;
}

export function computeReport(options: ComputeOptions): ReportResult {
  const { definition, dataset, filters, permissions } = options;
  const overrides = options.sourceOverrides ?? {};
  const now = options.now ?? Date.now();
  const range = filters.range;
  const days = rangeLengthDays(range);
  const granularity = granularityFor(range);

  const base = wholeSlice(dataset, days);
  const previous = previousSlice(dataset, days);
  const dimension = ROW_DIMENSION[definition.id];

  const groups = groupBy(dimension, { dataset, base, range, granularity, now });
  const rows = buildRows(groups, definition.rowMetrics, permissions, now, dimension);

  const summary = definition.summaryMetrics.map((key) =>
    metricValue(key, base, previous, permissions, now, overrides),
  );

  // A line chart is offered only where the rows are ordered in time. Anywhere
  // else there is nothing to connect, so there is no trend to return.
  const trend: ReportTrend | null =
    dimension === "period"
      ? {
          metricKeys: definition.rowMetrics,
          granularity,
          points: groups.map((group) => ({
            key: group.id,
            label: group.label,
            values: Object.fromEntries(
              definition.rowMetrics.map((key) => [
                key,
                computeMetric(key, group.slice, { now }),
              ]),
            ) as Record<string, number | null>,
            drilldown: group.drilldown,
          })),
        }
      : null;

  const metricKeys = [...new Set([...definition.summaryMetrics, ...definition.rowMetrics])];

  return {
    reportId: definition.id,
    audience: options.audience,
    generatedAt: new Date(now).toISOString(),
    filters,
    organizationId: options.organizationId,
    organizationName: options.organizationName,
    summary,
    columns: definition.rowMetrics.map((key) => {
      const d = metricDefinition(key);
      return { key, label: d?.label ?? key, unit: d?.unit ?? "count" };
    }),
    rows,
    rowLabel: definition.rowLabel,
    trend,
    narrative: buildNarrative(definition, summary, rows, dataset, rangeLabel(range)),
    definitions: metricDefinitions(metricKeys),
    sources: sourceStatuses(definition.sources, overrides),
    notices: buildNotices(definition, dataset, rows, overrides),
    recordCount: dataset.loads.length,
  };
}

export { ROW_DIMENSION };
