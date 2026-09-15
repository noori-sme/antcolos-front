"use client";

import { useMemo, useState } from "react";
import { Download, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { useActiveMembership, useCan } from "@/lib/session/hooks";
import type { AuditEventFilters } from "@/types";
import { AppendOnlyMark } from "./chips";
import { AuditFilterBar } from "./event-filter-bar";
import { AuditEventRow } from "./event-row";
import { ExportPanel } from "./export-panel";
import { SourcesPanel } from "./sources-panel";
import { AUDIT_PAGE_SIZE, useAuditEvents } from "./use-audit";

/**
 * The ledger.
 *
 * One list, for the whole organization, gathered from every module's own
 * history. It is read-only by construction: there is no control on this screen
 * that edits or removes an event, because the service has no method that could.
 */
export function AuditEventsScreen({
  title = "Audit events",
  description = "Every recorded action in this organization, from every module, newest first.",
  fixedFilters,
  lede,
}: {
  title?: string;
  description?: string;
  /** Pins part of the filter — used by the access-only view in Settings. */
  fixedFilters?: AuditEventFilters;
  lede?: React.ReactNode;
} = {}) {
  const [filters, setFilters] = useState<AuditEventFilters>({});
  const [limit, setLimit] = useState(AUDIT_PAGE_SIZE);
  const merged = useMemo(
    () => ({ ...filters, ...fixedFilters }),
    [filters, fixedFilters],
  );
  const events = useAuditEvents(merged, limit);
  const { organization } = useActiveMembership();
  const canExport = useCan("audit:export");
  const [exporting, setExporting] = useState(false);
  const timeZone = organization?.timeZone ?? "UTC";

  return (
    <div className="space-y-section">
      <PageHeader
        title={title}
        description={description}
        actions={
          canExport ? (
            <Button variant="secondary" size="sm" onClick={() => setExporting((v) => !v)}>
              <Download aria-hidden />
              {exporting ? "Hide export" : "Prepare export"}
            </Button>
          ) : null
        }
      />

      {lede}

      <div className="flex flex-wrap items-center gap-2">
        <AppendOnlyMark />
        <p className="text-[0.8125rem] text-fg-muted">
          Nothing here is ever edited or deleted. A mistake is corrected by adding a
          correcting event, and both stay on the record.
        </p>
      </div>

      {exporting ? <ExportPanel filters={merged} onClose={() => setExporting(false)} /> : null}

      <SourcesPanel />

      <AuditFilterBar
        filters={merged}
        onChange={(next) => {
          setFilters(next);
          setLimit(AUDIT_PAGE_SIZE);
        }}
        all={events.data?.items ?? []}
        loaded={events.data?.items.length ?? 0}
        total={events.data?.totalCount ?? 0}
      />

      {events.isLoading ? <LoadingSkeleton rows={6} /> : null}
      {events.isError ? <ErrorState onRetry={() => events.refetch()} /> : null}

      {events.data ? (
        events.data.items.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="Nothing matches"
            description="No recorded action in this organization matches these filters. That is a fact about the filters, not about the organization."
          />
        ) : (
          <>
            <p className="text-[0.75rem] text-fg-subtle">
              Showing {events.data.items.length}
              {events.data.totalCount != null && events.data.totalCount > events.data.items.length
                ? ` of ${events.data.totalCount}`
                : ""}{" "}
              event{events.data.items.length === 1 ? "" : "s"}.
            </p>
            <ol className="space-y-2">
              {events.data.items.map((event) => (
                <li key={event.id}>
                  <AuditEventRow
                    event={event}
                    timeZone={timeZone}
                    href={`/audit/events/${event.id}`}
                  />
                </li>
              ))}
            </ol>
            {events.data.nextCursor ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setLimit((n) => n + AUDIT_PAGE_SIZE)}
                disabled={events.isFetching}
              >
                {events.isFetching
                  ? "Loading…"
                  : `Load ${AUDIT_PAGE_SIZE} more of ${(events.data.totalCount ?? 0) - events.data.items.length} remaining`}
              </Button>
            ) : null}
          </>
        )
      ) : null}
    </div>
  );
}
