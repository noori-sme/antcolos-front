"use client";

import {
  Activity, Container, Gauge, Link2Off, MapPinOff, ShieldAlert, Truck as TruckIcon,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import type {
  FleetAssetKind, FleetEquipmentFilters, FleetFleetSummary, FleetOperationalStatus,
} from "@/types";
import { OPERATIONAL_STATUS_LABEL, OPERATIONAL_STATUS_ORDER, formatHours } from "./labels";
import { OperationalStatusChip } from "./chips";
import { EquipmentList } from "./equipment-list";
import { TriadPanel } from "./triad-panel";
import { IntegrationsPanel } from "./integrations-panel";
import { useFleetDashboard, useFleetEquipment } from "./hooks";
import { cn } from "@/lib/utils";

/**
 * The organization-scoped fleet dashboard.
 *
 * One screen that answers the operational question across trucks, trailers and
 * drivers at once — what is free, what is committed, what is broken and what is
 * stopping it — assembled from the permanent records rather than from a copy.
 *
 * Everything on it is scoped to the active membership's organization. A
 * dispatch organization sees the equipment carriers have explicitly shared with
 * it and nothing else; a carrier sees what it is onboarded on; a driver sees
 * the truck they are on. None of that is decided here — it is decided in the
 * service layer, and this screen renders whatever it is given.
 */
export function FleetDashboardScreen() {
  const dashboard = useFleetDashboard();
  const [assetKind, setAssetKind] = useState<FleetAssetKind | "all">("all");
  const [statuses, setStatuses] = useState<FleetOperationalStatus[]>([]);
  const [availableOnly, setAvailableOnly] = useState(false);
  const [staleOnly, setStaleOnly] = useState(false);
  const [search, setSearch] = useState("");

  const filters = useMemo<FleetEquipmentFilters>(() => ({
    assetKind: assetKind === "all" ? undefined : assetKind,
    status: statuses.length ? statuses : undefined,
    availableOnly: availableOnly || undefined,
    staleOnly: staleOnly || undefined,
    search: search.trim() || undefined,
  }), [assetKind, statuses, availableOnly, staleOnly, search]);

  const equipment = useFleetEquipment(filters);

  const toggleStatus = (s: FleetOperationalStatus) =>
    setStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  if (dashboard.isError) {
    return (
      <div className="space-y-section">
        <PageHeader title="Fleet" />
        <ErrorState
          title="The fleet could not be assembled"
          description={(dashboard.error as Error)?.message ?? "The request did not complete."}
          onRetry={() => dashboard.refetch()}
        />
      </div>
    );
  }

  const data = dashboard.data;
  const combined = data
    ? {
      total: data.trucks.total + data.trailers.total,
      stale: data.trucks.staleTelemetry + data.trailers.staleTelemetry,
      locked: data.trucks.lockedByOtherAuthority + data.trailers.lockedByOtherAuthority,
      blocking: data.trucks.readinessBlocking + data.trailers.readinessBlocking,
    }
    : null;

  return (
    <div className="space-y-section">
      <PageHeader
        title="Fleet"
        description="What your equipment is doing right now, drawn from the truck, trailer, lease, assignment and document records — not from a separate status of its own."
      />

      {dashboard.isPending ? <LoadingSkeleton rows={3} /> : null}

      {data && combined ? (
        <>
          <section aria-label="Fleet at a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <SummaryTile
              icon={TruckIcon}
              label="Power units"
              value={String(data.trucks.total)}
              hint={availableHint(data.trucks)}
            />
            <SummaryTile
              icon={Container}
              label="Trailers"
              value={String(data.trailers.total)}
              hint={availableHint(data.trailers)}
            />
            <SummaryTile
              icon={Gauge}
              label="Utilization"
              value={`${data.utilization.utilizationPct}%`}
              hint={
                data.utilization.fullyDerived
                  ? `Last ${data.utilization.windowDays} days`
                  : `Last ${data.utilization.windowDays} days — partial records`
              }
              tone={data.utilization.fullyDerived ? "default" : "warning"}
            />
            <SummaryTile
              icon={Activity}
              label="Idle time"
              value={formatHours(data.utilization.idleHours)}
              hint={`${formatHours(data.utilization.downtimeHours)} operational downtime`}
            />
          </section>

          <Card>
            <CardHeader className="flex-col items-start gap-1">
              <CardTitle>How these numbers were worked out</CardTitle>
              <CardDescription>{data.utilization.basis}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <Attention
                icon={MapPinOff}
                count={combined.stale}
                label="with a stale or missing location"
                detail="No GPS, ELD or telematics feed is connected. A location is only ever as fresh as the last person who recorded one."
                active={staleOnly}
                onClick={() => setStaleOnly((v) => !v)}
              />
              <Attention
                icon={ShieldAlert}
                count={combined.blocking}
                label="with expired or missing paperwork"
                detail="Registration, plate or permit. Nothing has been checked with a state — no registration lookup is connected."
              />
              <Attention
                icon={Link2Off}
                count={combined.locked}
                label="held under another operating authority"
                detail="Approved to you, but running for somebody else right now. You are told it is busy, never who has it."
              />
            </CardContent>
          </Card>

          <StatusBreakdown trucks={data.trucks} trailers={data.trailers} />

          <TriadPanel triads={data.triads} />

          <section aria-label="Equipment" className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1 sm:max-w-xs">
                <label className="sr-only" htmlFor="fleet-search">Search equipment</label>
                <Input
                  id="fleet-search"
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Unit, driver, city…"
                />
              </div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by equipment kind">
                {(["all", "truck", "trailer"] as const).map((k) => (
                  <Chip
                    key={k}
                    label={k === "all" ? "All equipment" : k === "truck" ? "Power units" : "Trailers"}
                    selected={assetKind === k}
                    onToggle={() => setAssetKind(k)}
                  />
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by operational status">
              {OPERATIONAL_STATUS_ORDER.map((s) => (
                <Chip
                  key={s}
                  label={OPERATIONAL_STATUS_LABEL[s]}
                  selected={statuses.includes(s)}
                  onToggle={() => toggleStatus(s)}
                  count={data.trucks.counts[s] + data.trailers.counts[s]}
                />
              ))}
              <Chip
                label="Available to you"
                selected={availableOnly}
                onToggle={() => setAvailableOnly((v) => !v)}
              />
              <Chip
                label="Stale location"
                selected={staleOnly}
                onToggle={() => setStaleOnly((v) => !v)}
                count={combined.stale}
              />
            </div>

            {equipment.isPending ? <LoadingSkeleton rows={4} /> : null}
            {equipment.data?.length === 0 ? (
              <EmptyState
                icon={TruckIcon}
                title={combined.total === 0 ? "No equipment yet" : "Nothing matches those filters"}
                description={
                  combined.total === 0
                    ? "This organization has no live relationship with any truck or trailer. Equipment appears here once a carrier relationship is approved, or once a carrier shares it with you."
                    : "Try a different search, status or equipment kind."
                }
                action={
                  combined.total === 0 ? (
                    <Link href="/fleet/trucks" className="text-[0.8125rem] font-medium text-primary underline-offset-4 hover:underline">
                      Go to Trucks
                    </Link>
                  ) : undefined
                }
              />
            ) : null}
            {equipment.data?.length ? <EquipmentList rows={equipment.data} /> : null}
          </section>

          <IntegrationsPanel integrations={data.integrations} />
        </>
      ) : null}
    </div>
  );
}

function availableHint(summary: FleetFleetSummary): string {
  if (summary.total === 0) return "None connected";
  const free = summary.counts.available;
  return `${free} available now`;
}

function SummaryTile({
  icon: Icon, label, value, hint, tone = "default",
}: {
  icon: typeof TruckIcon;
  label: string;
  value: string;
  hint: string;
  tone?: "default" | "warning";
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <span className="flex items-center gap-2 text-fg-muted">
          <Icon aria-hidden className="size-4 text-fg-subtle" />
          <span className="text-[0.8125rem] font-medium">{label}</span>
        </span>
        <span
          className={cn(
            "tnum mt-1.5 block text-[1.5rem] leading-8 font-semibold tracking-[-0.02em] sm:text-[1.75rem] sm:leading-9",
            tone === "warning" ? "text-st-warning" : "text-fg",
          )}
        >
          {value}
        </span>
        <span className="mt-0.5 block min-h-4 text-[0.75rem] text-fg-subtle">{hint}</span>
      </CardContent>
    </Card>
  );
}

/**
 * A count that is worth doing something about, with the honest caveat attached.
 *
 * The caveat is not a footnote: "3 with a stale location" means something quite
 * different when nothing is reporting automatically, and a reader who does not
 * know that will draw the wrong conclusion from the number.
 */
function Attention({
  icon: Icon, count, label, detail, active, onClick,
}: {
  icon: typeof MapPinOff;
  count: number;
  label: string;
  detail: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="flex items-baseline gap-2">
        <Icon aria-hidden className={cn("size-4 self-center", count > 0 ? "text-st-warning" : "text-fg-subtle")} />
        <span className={cn("tnum text-[1.125rem] font-semibold", count > 0 ? "text-fg" : "text-fg-muted")}>
          {count}
        </span>
        <span className="text-[0.8125rem] text-fg-muted">{label}</span>
      </span>
      <span className="mt-1 block text-[0.75rem] leading-relaxed text-fg-subtle">{detail}</span>
    </>
  );

  if (!onClick) {
    return <div className="rounded-md border border-border bg-surface-sunken/50 p-3">{body}</div>;
  }
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-md border p-3 text-left transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        active
          ? "border-primary bg-primary/10"
          : "border-border bg-surface-sunken/50 hover:border-border-strong",
      )}
    >
      {body}
    </button>
  );
}

function StatusBreakdown({
  trucks, trailers,
}: { trucks: FleetFleetSummary; trailers: FleetFleetSummary }) {
  return (
    <Card>
      <CardHeader className="flex-col items-start gap-1">
        <CardTitle>Current operational status</CardTitle>
        <CardDescription>
          Reconciled on read from the equipment record, the operating-authority lease and the
          attachment record. Nothing writes a status of its own, so this cannot disagree with
          the Trucks or Trailers screens.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-[0.8125rem]">
          <thead>
            <tr className="border-b border-border text-left text-fg-muted">
              <th scope="col" className="py-2 pr-4 font-medium">Status</th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">Power units</th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">Trailers</th>
              <th scope="col" className="py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {OPERATIONAL_STATUS_ORDER.map((s) => (
              <tr key={s} className="border-b border-border/60 last:border-0">
                <td className="py-2 pr-4">
                  <OperationalStatusChip status={s} />
                </td>
                <td className="tnum py-2 pr-4 text-right text-fg">{trucks.counts[s]}</td>
                <td className="tnum py-2 pr-4 text-right text-fg">{trailers.counts[s]}</td>
                <td className="tnum py-2 text-right font-semibold text-fg">
                  {trucks.counts[s] + trailers.counts[s]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
