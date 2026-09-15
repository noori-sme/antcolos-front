import type { ReportDefinition, ReportResult } from "@/types";
import { exportValue, UNIT_SUFFIX } from "./format";
import { rangeLabel } from "./range";

/**
 * Export-ready structure.
 *
 * An export never re-queries and never re-computes: it is a serialization of a
 * ReportResult that already exists, including the filters it was run with and
 * the definition of every column — so a spreadsheet on somebody's desk can be
 * traced back to what was asked and what it means.
 */

export interface ReportExport {
  /** Header block a reader sees before the numbers. */
  meta: {
    report: string;
    description: string;
    organization: string;
    range: string;
    generatedAt: string;
    audience: string;
    /** Every source, and whether it was live or a mock adapter. */
    sources: { module: string; status: string; note: string }[];
    notices: string[];
  };
  /** Summary block: one row per headline metric. */
  summary: { metric: string; value: string; unit: string; previous: string; change: string }[];
  /** The table, exactly as the table view shows it. */
  columns: { key: string; label: string; unit: string }[];
  rows: Record<string, string>[];
  /** Definitions, so the numbers can be checked. */
  definitions: { metric: string; definition: string; calculation: string; sources: string }[];
}

export function buildExport(
  result: ReportResult,
  definition: ReportDefinition,
): ReportExport {
  return {
    meta: {
      report: definition.title,
      description: definition.description,
      organization: result.organizationName,
      range: rangeLabel(result.filters.range),
      generatedAt: result.generatedAt,
      audience: result.audience,
      sources: result.sources.map((s) => ({
        module: s.label,
        status: s.availability,
        note: s.note,
      })),
      notices: result.notices.map((n) => n.message),
    },
    summary: result.summary.map((metric) => {
      const definitionOf = result.definitions.find((d) => d.key === metric.key);
      return {
        metric: definitionOf?.label ?? metric.key,
        value: exportValue(metric.value, metric.unit),
        unit: UNIT_SUFFIX[metric.unit],
        previous: exportValue(metric.previousValue ?? null, metric.unit),
        change: metric.changePct == null ? "" : (metric.changePct * 100).toFixed(1),
      };
    }),
    columns: [
      { key: "row", label: result.rowLabel, unit: "" },
      ...result.columns.map((c) => ({
        key: c.key,
        label: c.label,
        unit: UNIT_SUFFIX[c.unit],
      })),
    ],
    rows: result.rows.map((row) => ({
      row: row.sublabel ? `${row.label} (${row.sublabel})` : row.label,
      ...Object.fromEntries(
        result.columns.map((c) => [c.key, exportValue(row.values[c.key] ?? null, c.unit)]),
      ),
    })),
    definitions: result.definitions.map((d) => ({
      metric: d.label,
      definition: d.definition,
      calculation: d.formula,
      sources: d.sources.join(", "),
    })),
  };
}

const escape = (value: string) =>
  /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

const line = (cells: (string | number)[]) => cells.map((c) => escape(String(c))).join(",");

/** The same structure as CSV. Nothing is added that is not in the result. */
export function exportToCsv(payload: ReportExport): string {
  const out: string[] = [];
  out.push(line(["Report", payload.meta.report]));
  out.push(line(["Organization", payload.meta.organization]));
  out.push(line(["Date range", payload.meta.range]));
  out.push(line(["Generated", payload.meta.generatedAt]));
  out.push(line(["Audience", payload.meta.audience]));
  for (const source of payload.meta.sources) {
    out.push(line([`Source: ${source.module}`, source.status, source.note]));
  }
  for (const notice of payload.meta.notices) out.push(line(["Note", notice]));

  out.push("");
  out.push(line(["Summary", "Value", "Unit", "Previous period", "Change %"]));
  for (const row of payload.summary) {
    out.push(line([row.metric, row.value, row.unit, row.previous, row.change]));
  }

  out.push("");
  out.push(
    line(payload.columns.map((c) => (c.unit ? `${c.label} (${c.unit})` : c.label))),
  );
  for (const row of payload.rows) {
    out.push(line(payload.columns.map((c) => row[c.key] ?? "")));
  }

  out.push("");
  out.push(line(["Metric", "What it means", "How it is calculated", "Sources"]));
  for (const d of payload.definitions) {
    out.push(line([d.metric, d.definition, d.calculation, d.sources]));
  }

  return out.join("\n");
}

export function exportFileName(result: ReportResult, definition: ReportDefinition): string {
  const slug = definition.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const day = result.generatedAt.slice(0, 10);
  return `antcolos-${slug}-${day}.csv`;
}
