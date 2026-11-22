"use client";

import { ArrowRight, MapPin, Package } from "lucide-react";
import Link from "next/link";
import { LoadRecordStatusBadge } from "@/components/common/status-badge";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { MyTruckMaintenanceCard } from "./my-truck-maintenance-card";
import { activeLoad, currentStop, milestoneLabel, stopName } from "@/lib/driver-loads/milestones";
import { routeSummary } from "@/lib/load-records/format";
import type { DriverLoad } from "@/types/driver-load";
import { useDriverLoads } from "./hooks";

/** The driver's loads on the real API (F1.4, plan 16): the one in progress first. */
export function DriverLoadsScreen() {
  const loads = useDriverLoads();
  const items = loads.data?.items ?? [];
  const first = activeLoad(items);
  const rest = items.filter((l) => l.id !== first?.id);

  return (
    <div className="space-y-section">
      <PageHeader title="My loads" description="The loads dispatch put you on, until the POD is in." />
      {/* Outside the loads states: a driver with no loads still sees their truck (plan 24). */}
      <MyTruckMaintenanceCard />
      {loads.isPending ? (
        <LoadingSkeleton rows={3} />
      ) : loads.isError ? (
        <ErrorState description={loads.error.message} onRetry={() => void loads.refetch()} />
      ) : !first ? (
        <EmptyState
          icon={Package}
          title="No loads right now"
          description="When dispatch assigns you a load, it shows up here."
        />
      ) : (
        <>
          <LoadCard load={first} highlight />
          {rest.length > 0 ? (
            <section aria-labelledby="other-loads" className="space-y-2.5">
              <h2 id="other-loads" className="text-[0.9375rem] font-semibold text-fg">Other loads</h2>
              <ul className="space-y-2">
                {rest.map((load) => (
                  <li key={load.id}>
                    <LoadCard load={load} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function LoadCard({ load, highlight = false }: { load: DriverLoad; highlight?: boolean }) {
  const stop = currentStop(load);
  const next = load.nextMilestones[0];
  return (
    <Link
      href={`/driver/loads/${encodeURIComponent(load.id)}`}
      className={`block rounded-lg border bg-surface px-4 py-3.5 shadow-e1 hover:border-border-strong ${
        highlight ? "border-primary" : "border-border"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.9375rem] font-semibold text-fg">Load {load.brokerLoadNumber}</p>
          <p className="truncate text-[0.8125rem] text-fg-muted">{routeSummary(load.stops)}</p>
        </div>
        <LoadRecordStatusBadge status={load.status} />
      </div>
      {stop ? (
        <p className="mt-2 flex items-center gap-1.5 text-[0.8125rem] text-fg">
          <MapPin className="size-3.5 text-fg-muted" aria-hidden />
          {stopName(load.stops, stop.sequence)} · {stop.facilityName ?? `${stop.city}, ${stop.state}`}
        </p>
      ) : null}
      {load.status === "driver_assigned" ? (
        // Accepting is informational (D1.2), but the driver is asked first.
        <p className="mt-1.5 text-[0.8125rem] font-medium text-primary">Waiting for your answer</p>
      ) : next ? (
        <p className="mt-1.5 flex items-center gap-1 text-[0.8125rem] font-medium text-primary">
          Next: {milestoneLabel(next, load.stops)}
          <ArrowRight className="size-3.5" aria-hidden />
        </p>
      ) : null}
    </Link>
  );
}
