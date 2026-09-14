"use client";

import { Search } from "lucide-react";
import { formatMetric, NO_VALUE } from "@/lib/reports/format";
import { cn } from "@/lib/utils";
import type { DrilldownRef, ReportResult } from "@/types";

/**
 * The table view. It is also the accessible fallback for every chart: the same
 * rows, the same numbers, in the same order.
 */
export function ReportTable({
  result,
  onDrilldown,
}: {
  result: ReportResult;
  onDrilldown?: (ref: DrilldownRef, title: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full border-collapse text-[0.875rem]">
        <caption className="sr-only">
          {result.rowLabel} breakdown. {result.rows.length} rows.
        </caption>
        <thead>
          <tr className="bg-surface-sunken/60 text-left">
            <th
              scope="col"
              className="px-3 py-2.5 text-[0.75rem] font-semibold tracking-wide text-fg-subtle uppercase"
            >
              {result.rowLabel}
            </th>
            {result.columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className="px-3 py-2.5 text-right text-[0.75rem] font-semibold tracking-wide text-fg-subtle uppercase"
              >
                {column.label}
              </th>
            ))}
            <th scope="col" className="px-3 py-2.5">
              <span className="sr-only">Source records</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row) => (
            <tr key={row.id} className="border-t border-border transition-colors hover:bg-surface-hover">
              <th
                scope="row"
                className="h-row px-3 py-[var(--cell-py)] text-left align-middle font-medium text-fg"
              >
                {row.label}
                {row.sublabel ? (
                  <span className="mt-0.5 block text-[0.75rem] font-normal text-fg-subtle">
                    {row.sublabel}
                  </span>
                ) : null}
              </th>
              {result.columns.map((column) => {
                const value = row.values[column.key];
                return (
                  <td
                    key={column.key}
                    className={cn(
                      "tnum h-row px-3 py-[var(--cell-py)] text-right align-middle",
                      value == null ? "text-fg-subtle" : "text-fg-muted",
                    )}
                  >
                    {value == null ? NO_VALUE : formatMetric(value, column.unit)}
                  </td>
                );
              })}
              <td className="px-3 py-[var(--cell-py)] text-right align-middle">
                {row.drilldown && onDrilldown ? (
                  <button
                    type="button"
                    onClick={() => onDrilldown(row.drilldown!, row.label)}
                    className="inline-flex items-center gap-1 rounded-xs text-[0.75rem] text-primary hover:underline"
                  >
                    <Search aria-hidden className="size-3" />
                    {row.drilldown.label}
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
