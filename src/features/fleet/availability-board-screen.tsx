"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarClock, MapPin, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { TruckOperationalBadge } from "@/components/common/status-badge";
import { Can } from "@/components/auth/can";
import {
  BUCKET_HINTS, BUCKET_ORDER, bucketLabel, emptyInText, groupByBucket,
} from "@/lib/fleet/availability";
import { equipmentLabel } from "@/lib/load-records/format";
import { AVAILABILITY_BUCKETS, type AvailabilityBucket, type TruckAvailability } from "@/types/fleet-truck";
import { useTruckAvailability } from "./hooks";
import { AvailabilityHistoryDialog } from "./availability-history-dialog";

const PAGE_SIZE = 50;
const clock = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
const timeOfDay = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

function parseBucket(value: string | null): AvailabilityBucket | undefined {
  return AVAILABILITY_BUCKETS.find((b) => b === value);
}

/** When every truck of the fleet comes empty (F2.5, plan 23). */
export function AvailabilityBoardScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const bucket = parseBucket(searchParams.get("bucket"));
  const [page, setPage] = useState(1);
  const [historyFor, setHistoryFor] = useState<TruckAvailability | null>(null);

  const query = useTruckAvailability({ bucket, page, pageSize: PAGE_SIZE });
  const { data, isLoading, isError, error, refetch, isFetching, dataUpdatedAt } = query;
  const rows = data?.data ?? [];
  const meta = data?.meta;
  const groups = groupByBucket(rows);
  const morePages = (meta?.totalPages ?? 1) > 1;

  const selectBucket = (next: AvailabilityBucket | undefined) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("bucket", next);
    else params.delete("bucket");
    setPage(1);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <div className="space-y-section">
      <PageHeader
        title="Availability"
        description="When each truck comes empty, soonest first. Times are in your time zone."
        actions={
          <div className="flex items-center gap-3">
            {dataUpdatedAt > 0 && (
              <span className="text-[0.8125rem] tabular-nums text-fg-muted">
                Updated {timeOfDay.format(new Date(dataUpdatedAt))}
              </span>
            )}
            <Button variant="secondary" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw aria-hidden className={isFetching ? "animate-spin" : undefined} />
              Refresh
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by availability">
        <Chip label="All" selected={!bucket} onToggle={() => selectBucket(undefined)} />
        {BUCKET_ORDER.map((b) => (
          <Chip
            key={b}
            label={bucketLabel(b)}
            selected={bucket === b}
            onToggle={() => selectBucket(bucket === b ? undefined : b)}
            count={!bucket ? rows.filter((r) => r.bucket === b).length || undefined : undefined}
          />
        ))}
      </div>
      {!bucket && morePages && (
        <p className="text-[0.8125rem] text-fg-muted">Counts are for the trucks on this page.</p>
      )}

      {isLoading && <LoadingSkeleton rows={4} />}
      {isError && (
        <ErrorState
          title="Couldn't load availability"
          description={error?.message}
          onRetry={() => refetch()}
        />
      )}
      {!isLoading && !isError && rows.length === 0 && (
        <EmptyState
          icon={CalendarClock}
          title={bucket ? `No trucks ${bucketLabel(bucket).toLowerCase()}` : "No trucks on this fleet yet"}
          description={
            bucket
              ? "Pick another filter, or All, to see the rest of the fleet."
              : "Trucks you operate show up here with the time they come empty."
          }
        />
      )}

      {groups.map((group) => (
        <section key={group.bucket} aria-labelledby={`bucket-${group.bucket}`} className="space-y-2">
          <h2 id={`bucket-${group.bucket}`} className="text-[0.9375rem] font-semibold text-fg">
            {bucketLabel(group.bucket)} <span className="text-fg-muted">· {group.rows.length}</span>
          </h2>
          {BUCKET_HINTS[group.bucket] && (
            <p className="text-[0.8125rem] text-fg-muted">{BUCKET_HINTS[group.bucket]}</p>
          )}
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {group.rows.map((row) => (
              <AvailabilityRow key={row.truckId} row={row} onHistory={() => setHistoryFor(row)} />
            ))}
          </ul>
        </section>
      ))}

      {meta && meta.totalPages > 1 && (
        <div className="flex flex-col items-center justify-between gap-3 border-t border-border pt-4 sm:flex-row">
          <p className="text-[0.8125rem] tabular-nums text-fg-muted">
            Showing {(meta.page - 1) * meta.pageSize + 1}–{Math.min(meta.page * meta.pageSize, meta.totalItems)} of{" "}
            {meta.totalItems} trucks
          </p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Previous
            </Button>
            <span className="px-2 text-[0.8125rem] font-medium tabular-nums text-fg">
              Page {meta.page} of {meta.totalPages}
            </span>
            <Button variant="secondary" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      {historyFor && (
        <AvailabilityHistoryDialog
          truckId={historyFor.truckId}
          unitNumber={historyFor.unitNumber}
          open
          onOpenChange={(open) => !open && setHistoryFor(null)}
        />
      )}
    </div>
  );
}

function AvailabilityRow({ row, onHistory }: { row: TruckAvailability; onHistory: () => void }) {
  const emptyIn = emptyInText(row.estimatedEmptyAt, new Date());
  const place = [row.emptyCity, row.emptyState].filter(Boolean).join(", ");
  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/fleet/trucks/${row.truckId}`} className="font-semibold text-fg hover:text-primary">
            Unit {row.unitNumber ?? "—"}
          </Link>
          {row.operationalStatus && <TruckOperationalBadge status={row.operationalStatus} />}
          {row.equipmentType && (
            <span className="text-[0.8125rem] text-fg-muted">{equipmentLabel(row.equipmentType)}</span>
          )}
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] text-fg-muted">
          {emptyIn && row.estimatedEmptyAt && (
            <span className="tabular-nums">
              <span className="font-medium text-fg">{emptyIn}</span> · {clock.format(new Date(row.estimatedEmptyAt))}
            </span>
          )}
          {place && (
            <span className="inline-flex items-center gap-1">
              <MapPin aria-hidden className="size-3.5" />
              Empties in {place}
            </span>
          )}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {row.activeLoadId && (
          <Can permission="loads:view">
            <Button variant="secondary" size="sm" asChild>
              <Link href={`/loads/${row.activeLoadId}`}>Load</Link>
            </Button>
          </Can>
        )}
        <Button variant="ghost" size="sm" onClick={onHistory} aria-label={`Prediction history for unit ${row.unitNumber ?? ""}`.trim()}>
          History
        </Button>
      </div>
    </li>
  );
}
