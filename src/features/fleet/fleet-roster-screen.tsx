"use client";

import { ChevronRight, Plus, Search, Truck as TruckIcon, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, LoadingSkeleton } from "@/components/data/states";
import { Can } from "@/components/auth/can";
import { EQUIPMENT_LABEL } from "@/lib/fleet/equipment";
import { maskVin } from "@/lib/fleet/vin";
import { listFleet, listPendingConnections } from "@/lib/api/mock/truck-registry";
import type { FleetTruck, Truck, TruckCarrierRelationship, TruckOperatingStatus } from "@/types";
import { RelationshipStatusChip, TruckStatusChip } from "./status-chips";
import { TRUCK_STATUS_LABEL, formatDate } from "./fleet-labels";
import { useTruckContext } from "./use-truck-context";
import { cn } from "@/lib/utils";

const STATUS_FILTERS: Array<TruckOperatingStatus | "all"> = [
  "all", "available", "loaded", "expected_available", "unavailable", "maintenance",
];

/**
 * The organization's fleet.
 *
 * Every row here is a permanent truck this organization has a live relationship
 * with — so the count on this page and the count on Home are the same number,
 * drawn from the same registry, and a truck nobody has connected to you never
 * appears no matter who knows its id.
 */
export function FleetRosterScreen() {
  const ctx = useTruckContext();
  const [trucks, setTrucks] = useState<FleetTruck[] | null>(null);
  const [vins, setVins] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Array<{ truck: Truck; relationship: TruckCarrierRelationship }>>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<TruckOperatingStatus | "all">("all");
  const [equipment, setEquipment] = useState<string>("all");

  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    Promise.all([listFleet(ctx), listPendingConnections(ctx)]).then(([fleet, waiting]) => {
      if (cancelled) return;
      setTrucks(fleet);
      setPending(waiting);
      // VINs come from the permanent record, masked until asked for.
      setVins(Object.fromEntries(waiting.map((p) => [p.truck.truckId, p.truck.vin])));
    });
    return () => {
      cancelled = true;
    };
  }, [ctx]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (trucks ?? []).filter((t) => {
      if (status !== "all" && t.status !== status) return false;
      if (equipment !== "all" && t.equipment !== equipment) return false;
      if (!q) return true;
      return (
        t.unit.toLowerCase().includes(q) ||
        (t.currentDriverName ?? "").toLowerCase().includes(q) ||
        (t.currentCity ?? "").toLowerCase().includes(q) ||
        (vins[t.truckId] ?? "").toLowerCase().includes(q)
      );
    });
  }, [trucks, query, status, equipment, vins]);

  const equipmentTypes = useMemo(
    () => Array.from(new Set((trucks ?? []).map((t) => t.equipment))),
    [trucks],
  );

  return (
    <div className="space-y-section">
      <PageHeader
        title="Trucks"
        description="Every truck your organization operates, and the ones waiting to be connected."
        actions={
          <Can permission="trucks:create">
            <Button variant="primary" asChild>
              <Link href="/fleet/trucks/new">
                <Plus aria-hidden />
                Add truck
              </Link>
            </Button>
          </Can>
        }
      />

      {pending.length > 0 ? (
        <section aria-labelledby="pending-trucks" className="rounded-lg border border-st-info/35 bg-st-info-bg/40 p-4">
          <h2 id="pending-trucks" className="text-[0.875rem] font-semibold text-fg">
            Waiting to be connected
          </h2>
          <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-fg-muted">
            You have asked to operate {pending.length === 1 ? "this truck" : "these trucks"}. They
            are not part of your fleet and are not counted until the request is accepted.
          </p>
          <ul className="mt-3 space-y-2">
            {pending.map(({ truck, relationship }) => (
              <li key={relationship.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md border border-border bg-surface px-3.5 py-2.5">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-[0.875rem] font-medium text-fg">
                    Unit {relationship.unitNumber}
                    <RelationshipStatusChip status={relationship.status} />
                  </p>
                  <p className="mt-0.5 font-mono text-[0.75rem] break-all text-fg-subtle">
                    {maskVin(truck.vin)}
                  </p>
                </div>
                <p className="text-[0.75rem] text-fg-subtle">
                  Requested {formatDate(relationship.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-fg-subtle" aria-hidden />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Unit, driver, city or VIN…"
            aria-label="Search trucks"
            className="pl-9"
          />
        </div>
        <label className="sr-only" htmlFor="equipment-filter">Filter by equipment type</label>
        <select
          id="equipment-filter"
          value={equipment}
          onChange={(e) => setEquipment(e.target.value)}
          className="h-control rounded-md border border-border bg-surface px-3 text-[0.8125rem] text-fg shadow-e1 hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
        >
          <option value="all">All equipment</option>
          {equipmentTypes.map((t) => (
            <option key={t} value={t}>{EQUIPMENT_LABEL[t]}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-[0.75rem] font-medium transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              status === s
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg",
            )}
          >
            {s === "all" ? "All" : TRUCK_STATUS_LABEL[s]}
            <span className="ml-1.5 tabular-nums opacity-70">
              {s === "all" ? trucks?.length ?? 0 : (trucks ?? []).filter((t) => t.status === s).length}
            </span>
          </button>
        ))}
      </div>

      {trucks === null ? <LoadingSkeleton rows={4} /> : null}

      {trucks !== null && trucks.length === 0 ? (
        <EmptyState
          icon={TruckIcon}
          title="No trucks yet"
          description="Add your first truck when you are ready. You can run Antcolos without one and come back to this whenever it suits you."
          action={
            <Can permission="trucks:create">
              <Button variant="primary" asChild>
                <Link href="/fleet/trucks/new">Add your first truck</Link>
              </Button>
            </Can>
          }
        />
      ) : null}

      {trucks !== null && trucks.length > 0 && visible.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No trucks match"
          description="Try a different search, status or equipment type."
        />
      ) : null}

      {visible.length > 0 ? (
        <ul className="space-y-2.5">
          {visible.map((truck) => (
            <li key={truck.truckId}>
              <Link
                href={`/fleet/trucks/${truck.truckId}`}
                className={cn(
                  "flex items-start gap-3 rounded-lg border border-border bg-surface p-4 shadow-e1 transition-colors",
                  "hover:border-border-strong hover:bg-surface-hover",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                )}
              >
                <span
                  aria-hidden
                  className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-fg-muted"
                >
                  <TruckIcon className="size-[1.125rem]" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-[0.9375rem] font-semibold text-fg">Unit {truck.unit}</span>
                    <TruckStatusChip status={truck.status} />
                    <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[0.6875rem] font-medium text-fg-muted">
                      {EQUIPMENT_LABEL[truck.equipment]}
                    </span>
                    {truck.documentWarnings > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-st-warning-bg px-2 py-0.5 text-[0.6875rem] font-medium text-st-warning">
                        <TriangleAlert className="size-3" aria-hidden />
                        {truck.documentWarnings} to sort out
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.75rem] text-fg-muted">
                    <span>{truck.currentDriverName ?? "No driver assigned"}</span>
                    {truck.carrierName ? <span>Runs under {truck.carrierName}</span> : null}
                    {truck.currentCity ? (
                      <span>{truck.currentCity}{truck.currentState ? `, ${truck.currentState}` : ""}</span>
                    ) : null}
                    {truck.estimatedEmptyAt ? (
                      <span className="tabular-nums">Empty {formatDate(truck.estimatedEmptyAt)}</span>
                    ) : null}
                  </p>
                </div>
                <ChevronRight className="mt-1 size-4 shrink-0 text-fg-subtle" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
