"use client";

import { ExternalLink, FileSearch } from "lucide-react";
import Link from "next/link";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { Sheet, SheetCloseButton, SheetContent } from "@/components/ui/sheet";
import type { DrilldownRef, ReportFilters, ReportId } from "@/types";
import { useDrilldown } from "./hooks";
import { AvailabilityBadge } from "./source-notice";

/**
 * Drill-down.
 *
 * Every number on a report opens this, and what it shows are the records
 * themselves — held by the module that owns them, linked to that module's own
 * screen where it has one. Reporting does not render a second version of a
 * load, and it cannot show a record the report itself excluded: the service
 * re-runs the same filters and returns only what falls inside them.
 */
export function DrilldownSheet({
  reportId,
  filters,
  // Never called `ref`: that name is reserved by React and this is data.
  target,
  title,
  onOpenChange,
}: {
  reportId: ReportId;
  filters: ReportFilters;
  target: DrilldownRef | null;
  title: string;
  onOpenChange: (open: boolean) => void;
}) {
  const query = useDrilldown(reportId, filters, target);
  const records = query.data ?? [];

  return (
    <Sheet open={Boolean(target)} onOpenChange={onOpenChange}>
      <SheetContent
        title={`Source records for ${title}`}
        description="The records this number was calculated from."
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <p className="text-[0.75rem] font-medium tracking-wide text-fg-subtle uppercase">
              Source records
            </p>
            <h2 className="truncate text-[1rem] font-semibold text-fg">{title}</h2>
            <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
              {target?.label ?? ""} — owned by the module that created them.
            </p>
          </div>
          <SheetCloseButton />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {query.isPending ? (
            <LoadingSkeleton rows={5} />
          ) : query.isError ? (
            <ErrorState
              title="Could not open these records"
              description={query.error.message}
              onRetry={() => query.refetch()}
            />
          ) : records.length === 0 ? (
            <EmptyState
              icon={FileSearch}
              title="Nothing to open"
              description="These records are outside this workspace, this date range or what has been shared with you."
            />
          ) : (
            <ul className="space-y-2.5">
              {records.map((record) => (
                <li
                  key={record.id}
                  className="rounded-md border border-border bg-surface px-3.5 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[0.875rem] font-medium text-fg">
                        {record.title}
                      </p>
                      {record.subtitle ? (
                        <p className="truncate text-[0.8125rem] text-fg-muted">
                          {record.subtitle}
                        </p>
                      ) : null}
                    </div>
                    <AvailabilityBadge availability={record.availability} />
                  </div>

                  {record.meta.length > 0 ? (
                    <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                      {record.meta.map((entry) => (
                        <div key={entry.label} className="flex items-baseline gap-1.5">
                          <dt className="text-[0.75rem] text-fg-subtle">{entry.label}</dt>
                          <dd className="text-[0.75rem] font-medium text-fg-muted capitalize">
                            {entry.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}

                  {record.href ? (
                    <Link
                      href={record.href}
                      className="mt-2 inline-flex items-center gap-1 rounded-xs text-[0.8125rem] text-primary hover:underline"
                    >
                      Open in its own module
                      <ExternalLink aria-hidden className="size-3.5" />
                    </Link>
                  ) : (
                    <p className="mt-2 text-[0.75rem] text-fg-subtle">
                      This module has no screen for the record yet, so there is nowhere
                      honest to send you.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
