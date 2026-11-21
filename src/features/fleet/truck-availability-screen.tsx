"use client";

import { ArrowLeft, MapPin } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { TruckOperationalBadge } from "@/components/common/status-badge";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { BUCKET_LABEL, BUCKET_ORDER, emptyIn, emptyPlace, groupByBucket } from "@/lib/fleet/availability";
import { equipmentLabel } from "@/lib/load-records/format";
import type { AvailabilityQuery, TruckAvailability } from "@/types/fleet-availability";
import { useTruckAvailability } from "./hooks";

const QUERY: AvailabilityQuery = { page: 1, pageSize: 100 };
const AT = new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });

/**
 * Truck availability board (F2.5, backend plan 47): every truck this organization operates,
 * grouped by when it will be empty, with where. Read-only; the estimate comes from the
 * truck's active load and refreshes every few minutes.
 */
export function TruckAvailabilityScreen() {
  const query = useTruckAvailability(QUERY);
  const groups = useMemo(() => groupByBucket(query.data?.data ?? []), [query.data]);
  const total = query.data?.meta.totalItems ?? 0;
  const shown = query.data?.data.length ?? 0;
  const now = new Date();

  return (
    <div className="space-y-section">
      <Button asChild size="sm" variant="ghost" className="-ml-2">
        <Link href="/fleet/trucks">
          <ArrowLeft aria-hidden />
          Trucks
        </Link>
      </Button>
      <PageHeader
        title="Truck availability"
        description="When and where each truck will be empty, soonest first. Estimates come from each truck's current load."
      />

      {query.isPending ? (
        <LoadingSkeleton rows={4} />
      ) : query.isError ? (
        <ErrorState
          title="Couldn't load availability"
          description={query.error.message}
          onRetry={() => void query.refetch()}
        />
      ) : shown === 0 ? (
        <EmptyState
          title="No trucks to show"
          description="Trucks your organization operates appear here with their availability."
          action={
            <Button asChild variant="secondary">
              <Link href="/fleet/trucks">Go to trucks</Link>
            </Button>
          }
        />
      ) : (
        <>
          {total > shown ? (
            <p className="text-[0.8125rem] text-fg-muted">
              Showing the {shown} trucks that are empty soonest, of {total}.
            </p>
          ) : null}
          <div className="space-y-section">
            {BUCKET_ORDER.map((bucket) => {
              const rows = groups.get(bucket) ?? [];
              if (rows.length === 0) return null;
              const id = `bucket-${bucket.toLowerCase()}`;
              return (
                <section key={bucket} aria-labelledby={id} className="space-y-2.5">
                  <h2 id={id} className="text-[0.9375rem] font-semibold text-fg">
                    {BUCKET_LABEL[bucket]} <span className="font-normal text-fg-muted">· {rows.length}</span>
                  </h2>
                  <ul className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                    {rows.map((row) => (
                      <AvailabilityCard key={row.truckId} row={row} now={now} />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function AvailabilityCard({ row, now }: { row: TruckAvailability; now: Date }) {
  const place = emptyPlace(row);
  const relative = emptyIn(row.estimatedEmptyAt, now);
  const at = row.estimatedEmptyAt ? new Date(row.estimatedEmptyAt) : null;
  return (
    <li className="min-w-0 rounded-lg border border-border bg-surface px-4 py-3.5 shadow-e1">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={`/fleet/trucks/${encodeURIComponent(row.truckId)}`}
            className="text-[0.9375rem] font-medium text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
          >
            Unit {row.unitNumber ?? "—"}
          </Link>
          {row.equipmentType ? (
            <p className="mt-0.5 text-[0.75rem] text-fg-muted">{equipmentLabel(row.equipmentType)}</p>
          ) : null}
        </div>
        {row.operationalStatus ? <TruckOperationalBadge status={row.operationalStatus} /> : null}
      </div>
      {at && !Number.isNaN(at.getTime()) ? (
        <p className="mt-2 text-[0.8125rem] text-fg">
          Empty <time dateTime={row.estimatedEmptyAt!}>{AT.format(at)}</time>
          {relative ? <span className="text-fg-muted"> ({relative})</span> : null}
        </p>
      ) : null}
      {place ? (
        <p className="mt-1 flex items-center gap-1 text-[0.8125rem] text-fg-muted">
          <MapPin aria-hidden className="size-3.5 shrink-0" />
          <span className="min-w-0 break-words">{place}</span>
        </p>
      ) : null}
      {row.activeLoadId ? (
        <Link
          href={`/loads/${encodeURIComponent(row.activeLoadId)}`}
          className="mt-2 inline-block text-[0.8125rem] text-primary hover:underline"
        >
          Current load
        </Link>
      ) : null}
    </li>
  );
}
