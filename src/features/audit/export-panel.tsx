"use client";

import { AlertTriangle, FileDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useActiveMembership } from "@/lib/session/hooks";
import type { AuditEventFilters } from "@/types";
import { formatDateTime } from "./format";
import { useAuditExport } from "./use-audit";

/**
 * An export-READY view.
 *
 * Nothing is written to disk, emailed, uploaded or filed. The rows are shown
 * here, and the notice says exactly that, because "Export" on a button is the
 * word people read as "delivered somewhere".
 *
 * Preparing one is itself recorded in the ledger, with who prepared it and the
 * filter they used.
 */
export function ExportPanel({
  filters, onClose,
}: {
  filters: AuditEventFilters;
  onClose: () => void;
}) {
  const { organization } = useActiveMembership();
  const exportView = useAuditExport();
  const view = exportView.data;
  const timeZone = organization?.timeZone ?? "UTC";

  return (
    <section
      aria-labelledby="audit-export"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="audit-export" className="text-[0.875rem] font-semibold text-fg">
            Prepare an export
          </h2>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">
            Builds a flat view of the events matching the filters above. It is shown on this
            screen and nowhere else — nothing is downloaded, sent or filed, and preparing one
            is recorded in this log.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            onClick={() => exportView.mutate(filters)}
            disabled={exportView.isPending}
          >
            <FileDown aria-hidden />
            {exportView.isPending ? "Preparing…" : "Prepare"}
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close export">
            <X aria-hidden />
          </Button>
        </div>
      </div>

      {exportView.isError ? (
        <p className="mt-3 text-[0.8125rem] text-st-danger">
          {(exportView.error as Error).message}
        </p>
      ) : null}

      {view ? (
        <div className="mt-4 space-y-3">
          <p className="text-[0.75rem] text-fg-subtle">
            {view.rows.length} row{view.rows.length === 1 ? "" : "s"} of {view.totalMatching}{" "}
            matching · prepared by {view.generatedBy.displayNameSnapshot} ·{" "}
            {formatDateTime(view.generatedAt, timeZone)}
          </p>

          {view.truncated ? (
            <p className="flex items-start gap-2 rounded-md border border-st-warning/30 bg-st-warning-bg/50 px-3 py-2 text-[0.8125rem] text-fg">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-st-warning" />
              This view was cut short at {view.rows.length} rows. Narrow the filters to see the
              rest — it has not been silently truncated behind your back.
            </p>
          ) : null}

          <p className="rounded-md border border-dashed border-border bg-surface-sunken px-3 py-2 text-[0.75rem] leading-relaxed text-fg-muted">
            {view.notice}
          </p>

          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[56rem] border-collapse text-left">
              <thead>
                <tr className="border-b border-border bg-surface-sunken">
                  {view.columns.map((column) => (
                    <th
                      key={column.key}
                      scope="col"
                      className="px-3 py-2 text-[0.6875rem] font-semibold tracking-wide text-fg-subtle uppercase"
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.rows.slice(0, 25).map((row, i) => (
                  <tr key={`${row.requestId}-${i}`} className="border-b border-border last:border-0">
                    {view.columns.map((column) => (
                      <td
                        key={column.key}
                        className="px-3 py-2 align-top text-[0.75rem] text-fg-muted"
                      >
                        {row[column.key] || "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {view.rows.length > 25 ? (
            <p className="text-[0.75rem] text-fg-subtle">
              First 25 of {view.rows.length} rows shown here. The rest are in the prepared view
              and would go with it wherever it is taken.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
