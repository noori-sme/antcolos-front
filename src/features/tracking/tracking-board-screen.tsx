"use client";

import {
  Building2, ChevronRight, MapPin, Share2, Truck as TruckIcon,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  TRACKING_ALERT_LABEL, TRACKING_HEALTH_LABEL,
  type DispatchTrackingFilters, type DispatchTrackingRow, type TrackingSignalHealth,
} from "@/types";
import { formatAge } from "@/lib/tracking";
import { cn } from "@/lib/utils";
import { AvailabilityChip, BasisChip, HealthChip, MockSourceNotice } from "./chips";
import { SourcesPanel } from "./sources-panel";
import { useTrackingBoard } from "./use-tracking";

/**
 * The organization-scoped dispatch tracking board.
 *
 * One screen for a dispatcher working several carriers at once: every load in
 * the air, how well each one is actually being tracked, and what has gone
 * wrong. There is no carrier switcher and no second workspace to sign into —
 * the carriers are chips, because they are a filter over one board rather than
 * four boards behind a login.
 *
 * The screen decides nothing. Rows, their order, their alerts and what is
 * withheld from them all come from the service, which applies each carrier
 * relationship and equipment scope before anything reaches here.
 */

const HEALTH_ORDER: TrackingSignalHealth[] = [
  "live", "stale", "interrupted", "offline", "unavailable",
];

export function TrackingBoardScreen() {
  const [carrier, setCarrier] = useState<string | undefined>();
  const [health, setHealth] = useState<TrackingSignalHealth[]>([]);
  const [alertingOnly, setAlertingOnly] = useState(false);
  const [search, setSearch] = useState("");

  const filters = useMemo<DispatchTrackingFilters>(() => ({
    carrierOrganizationId: carrier,
    health: health.length ? health : undefined,
    alertingOnly: alertingOnly || undefined,
    search: search.trim() || undefined,
  }), [carrier, health, alertingOnly, search]);

  const board = useTrackingBoard(filters);

  const toggleHealth = (h: TrackingSignalHealth) =>
    setHealth((prev) => (prev.includes(h) ? prev.filter((x) => x !== h) : [...prev, h]));

  if (board.isError) {
    return (
      <div className="space-y-section">
        <PageHeader title="Tracking" />
        <ErrorState
          title="The tracking board could not be assembled"
          description={(board.error as Error)?.message ?? "The request did not complete."}
          onRetry={() => board.refetch()}
        />
      </div>
    );
  }

  const data = board.data;

  return (
    <div className="space-y-section">
      <PageHeader
        title="Tracking"
        description="Every load you have in the air, how fresh the tracking on it actually is, and what has gone wrong. Confirmed and inferred are kept apart throughout."
      />

      <MockSourceNotice />

      {board.isPending ? <LoadingSkeleton rows={4} /> : null}

      {data ? (
        <>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            <Tile label="Tracked" value={data.counts.tracked} />
            <Tile label="Live" value={data.counts.live} tone="success" />
            <Tile label="Stale" value={data.counts.stale} tone="warning" />
            <Tile label="Interrupted" value={data.counts.interrupted} tone="danger" />
            <Tile label="Offline" value={data.counts.offline} tone="danger" />
            <Tile label="Alerting" value={data.counts.alerting} tone="warning" />
          </div>

          {data.carriers.length > 0 ? (
            <section aria-labelledby="carrier-filter" className="space-y-2">
              <h2 id="carrier-filter" className="text-[0.8125rem] font-semibold text-fg">
                Carriers on this board
              </h2>
              <p className="text-[0.75rem] leading-relaxed text-fg-muted">
                All of them at once, in this workspace. Each row is still scoped by that
                carrier&rsquo;s own relationship and equipment sharing — the convenience of one
                board does not widen what you may see.
              </p>
              <div className="flex flex-wrap gap-2">
                <Chip
                  label="All carriers"
                  selected={carrier === undefined}
                  onToggle={() => setCarrier(undefined)}
                />
                {data.carriers.map((c) => (
                  <Chip
                    key={c.organizationId}
                    label={c.canHaul ? c.name : `${c.name} — authority not active`}
                    count={c.loadCount}
                    selected={carrier === c.organizationId}
                    onToggle={() =>
                      setCarrier((prev) => (prev === c.organizationId ? undefined : c.organizationId))}
                  />
                ))}
              </div>
            </section>
          ) : null}

          <section aria-label="Filters" className="flex flex-wrap items-center gap-2">
            {HEALTH_ORDER.map((h) => (
              <Chip
                key={h}
                label={TRACKING_HEALTH_LABEL[h]}
                selected={health.includes(h)}
                onToggle={() => toggleHealth(h)}
              />
            ))}
            <Chip
              label="Only rows with alerts"
              selected={alertingOnly}
              onToggle={() => setAlertingOnly((v) => !v)}
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Load, carrier, driver, unit or city"
              aria-label="Search the tracking board"
              className="w-full sm:ml-auto sm:w-72"
            />
          </section>

          {data.rows.length === 0 ? (
            <EmptyState
              icon={MapPin}
              title="Nothing to track right now"
              description="Loads appear here once they are assigned and stay until shortly after they deliver."
            />
          ) : (
            <ul className="space-y-2.5">
              {data.rows.map((row) => <Row key={row.loadId} row={row} />)}
            </ul>
          )}

          <SourcesPanel sources={data.sources} />
        </>
      ) : null}
    </div>
  );
}

function Tile({
  label, value, tone = "neutral",
}: { label: string; value: number; tone?: "neutral" | "success" | "warning" | "danger" }) {
  const toneClass = {
    neutral: "text-fg",
    success: "text-st-success",
    warning: "text-st-warning",
    danger: "text-st-danger",
  }[tone];
  return (
    <div className="rounded-lg border border-border bg-surface px-3.5 py-3 shadow-e1">
      <p className="text-[0.6875rem] font-medium tracking-wide text-fg-subtle uppercase">{label}</p>
      <p className={cn("mt-0.5 text-[1.25rem] leading-7 font-semibold tabular-nums", toneClass)}>
        {value}
      </p>
    </div>
  );
}

function Row({ row }: { row: DispatchTrackingRow }) {
  const worstAlert = row.alerts.find((a) => a.severity === "critical" || a.severity === "high")
    ?? row.alerts[0];

  return (
    <li className="rounded-lg border border-border bg-surface shadow-e1">
      <Link
        href={`/dispatch/tracking/${encodeURIComponent(row.loadId)}`}
        className="flex flex-col gap-3 px-4 py-3.5 transition-colors hover:bg-surface-hover sm:flex-row sm:items-start sm:gap-4"
      >
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[0.9375rem] font-semibold text-fg">{row.loadReference}</span>
            <HealthChip health={row.health} />
            {row.availability ? (
              <span className="inline-flex items-center gap-1 text-[0.6875rem] text-fg-subtle">
                Truck
                <AvailabilityChip state={row.availability.state} />
              </span>
            ) : null}
            {row.sharedWithBroker ? (
              <Badge tone="info">
                <Share2 className="size-3.5" aria-hidden />
                Shared
              </Badge>
            ) : null}
          </div>

          <p className="text-[0.8125rem] text-fg-muted">
            {row.originLabel} → {row.destinationLabel}
            {row.routeProgressPercent != null ? (
              <span className="tnum"> · {row.routeProgressPercent}% of the way</span>
            ) : null}
            {row.milesToDelivery != null ? (
              <span className="tnum">
                {" · "}
                {row.milesToDelivery < 1
                  ? "at the receiver"
                  : `${row.milesToDelivery} mi to go, straight line`}
              </span>
            ) : null}
          </p>

          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.75rem] text-fg-subtle">
            {row.carrierName ? (
              <span className="inline-flex items-center gap-1">
                <Building2 className="size-3.5" aria-hidden />
                {row.carrierName}
              </span>
            ) : null}
            {row.truckUnit ? (
              <span className="inline-flex items-center gap-1">
                <TruckIcon className="size-3.5" aria-hidden />
                Unit {row.truckUnit}
                {row.trailerUnit ? ` · trailer ${row.trailerUnit}` : ""}
              </span>
            ) : null}
            {row.driverName ? <span>{row.driverName}</span> : null}
            {row.authority && !row.authority.allowedDispatch ? (
              <span className="text-st-danger">Operating authority not active</span>
            ) : null}
          </p>

          <p className="text-[0.75rem] leading-relaxed text-fg-muted">
            {row.currentCity ? (
              <>
                Last seen {row.currentDescription ?? `${row.currentCity}, ${row.currentState ?? ""}`}
                {row.lastUpdateAgeMinutes != null
                  ? ` · ${formatAge(row.lastUpdateAgeMinutes)} ago`
                  : ""}
                {row.lastSignalLabel ? ` · ${row.lastSignalLabel}` : ""}
              </>
            ) : (
              row.healthReason
            )}
          </p>

          {worstAlert ? (
            <p className="text-[0.75rem] leading-relaxed text-st-warning">
              {TRACKING_ALERT_LABEL[worstAlert.kind]}: {worstAlert.title}
              {row.alerts.length > 1 ? ` · +${row.alerts.length - 1} more` : ""}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-end">
          {row.availability ? (
            <BasisChip basis={row.availability.basis} confidence={row.availability.confidence} />
          ) : null}
          <ChevronRight className="size-4 text-fg-subtle" aria-hidden />
        </div>
      </Link>
    </li>
  );
}
