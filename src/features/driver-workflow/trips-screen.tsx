"use client";

import { ArrowRight, MapPin, Package, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { milestoneMeta } from "@/lib/driver-workflow/catalog";
import { dateTimeIn, relativeTime, useNow } from "@/lib/utils";
import type { DriverTripSummary } from "@/types";
import { useActiveMembership } from "@/lib/session/hooks";
import { useTrips } from "./hooks";
import { TripStatusBadge } from "./labels";

/**
 * The driver's own loads. Every row is a finalized load post with its own
 * workflow instance — a load that is still being papered does not appear here,
 * because until the rate confirmation is signed and sent there is nothing
 * authorized to show.
 */
export function TripsScreen() {
  const trips = useTrips();
  const { organization } = useActiveMembership();
  const tz = organization?.timeZone ?? "UTC";

  const active = trips.data?.filter((t) => t.status === "active") ?? [];
  const finished = trips.data?.filter((t) => t.status !== "active") ?? [];

  return (
    <div className="space-y-stack">
      <PageHeader
        title="My loads"
        description="Loads that are final: the rate confirmation is reviewed, signed and back with the broker."
      />

      {trips.isPending ? <LoadingSkeleton rows={3} /> : null}
      {trips.isError ? (
        <ErrorState description={trips.error.message} onRetry={() => trips.refetch()} />
      ) : null}

      {trips.data?.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No loads yet"
          description="A load appears here once dispatch has finished the paperwork on it. Proposals you are still deciding on live under Proposals."
        />
      ) : null}

      {active.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase">
            In progress
          </h2>
          <ul className="space-y-3">
            {active.map((trip) => (
              <li key={trip.workflowId}>
                <TripRow trip={trip} timeZone={tz} highlight />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {finished.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase">
            Finished
          </h2>
          <ul className="space-y-3">
            {finished.map((trip) => (
              <li key={trip.workflowId}>
                <TripRow trip={trip} timeZone={tz} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function TripRow({
  trip, timeZone, highlight,
}: {
  trip: DriverTripSummary;
  timeZone: string;
  highlight?: boolean;
}) {
  const now = useNow();
  const current = trip.currentMilestone ? milestoneMeta(trip.currentMilestone) : undefined;

  return (
    <Card className={highlight ? "border-primary/40" : undefined}>
      <Link
        href={`/driver/loads/${trip.loadId}`}
        className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
      >
        <CardContent className="space-y-3 pt-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-mono text-[1rem] font-semibold text-fg">{trip.loadReference}</p>
              <p className="mt-0.5 truncate text-[0.8125rem] text-fg-muted">
                {trip.customerName}
              </p>
            </div>
            <TripStatusBadge status={trip.status} />
          </div>

          <p className="flex items-center gap-1.5 text-[0.9375rem] text-fg">
            <MapPin aria-hidden className="size-4 shrink-0 text-fg-subtle" />
            {trip.originLabel}
            <ArrowRight aria-hidden className="size-3.5 shrink-0 text-fg-subtle" />
            {trip.destinationLabel}
          </p>

          <p className="text-[0.8125rem] text-fg-muted">
            Delivers {dateTimeIn(trip.deliveryAt, timeZone)}
            {trip.status === "active" && now !== null
              ? ` · ${relativeTime(trip.deliveryAt, now)}`
              : ""}
          </p>

          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={current ? "progress" : "neutral"}>
              {current ? current.label : "Not started"}
            </Badge>
            {trip.openWarnings > 0 ? (
              <Badge tone="warning">
                <TriangleAlert aria-hidden className="size-3" />
                {trip.openWarnings} to look at
              </Badge>
            ) : null}
          </div>
        </CardContent>
      </Link>
    </Card>
  );
}
