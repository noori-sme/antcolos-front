"use client";

import { ChevronRight, Container, Plus, Search, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, LoadingSkeleton } from "@/components/data/states";
import { Can } from "@/components/auth/can";
import { TRAILER_TYPE_LABEL } from "@/lib/fleet/trailer-equipment";
import { listPendingTrailerConnections, listTrailerFleet } from "@/lib/api/mock/trailer-registry";
import type {
  FleetTrailer, Trailer, TrailerCarrierRelationship, TrailerOperatingStatus,
} from "@/types";
import { AttachmentStateChip, TrailerActivationChip, TrailerCarrierStatusChip, TrailerStatusChip } from "./trailer-chips";
import { TRAILER_STATUS_LABEL, formatDate, maskTrailerVin } from "./trailer-labels";
import { useTrailerContext } from "./use-trailer-context";
import { cn } from "@/lib/utils";

const STATUS_FILTERS: Array<TrailerOperatingStatus | "all"> = [
  "all", "available", "attached", "loaded", "expected_available", "maintenance", "out_of_service",
];

type AttachmentFilter = "all" | "attached" | "unattached";
type ReadinessFilter = "all" | "issues" | "clear";

/**
 * The organization's trailers.
 *
 * Every row is a permanent trailer this organization has a live relationship
 * with, drawn from the registry rather than from a list in this file — so the
 * count here is the same number the registry would give any other screen, and a
 * trailer nobody has connected to you never appears however well you know its
 * id.
 */
export function TrailerRosterScreen() {
  const ctx = useTrailerContext();
  const [trailers, setTrailers] = useState<FleetTrailer[] | null>(null);
  const [vins, setVins] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Array<{ trailer: Trailer; relationship: TrailerCarrierRelationship }>>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<TrailerOperatingStatus | "all">("all");
  const [type, setType] = useState<string>("all");
  const [attachment, setAttachment] = useState<AttachmentFilter>("all");
  const [powerUnit, setPowerUnit] = useState<string>("all");
  const [readiness, setReadiness] = useState<ReadinessFilter>("all");

  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    Promise.all([listTrailerFleet(ctx), listPendingTrailerConnections(ctx)]).then(([fleet, waiting]) => {
      if (cancelled) return;
      setTrailers(fleet);
      setPending(waiting);
      // VINs come from the permanent record, masked until asked for.
      setVins(Object.fromEntries(waiting.map((p) => [p.trailer.trailerId, p.trailer.vin])));
    });
    return () => { cancelled = true; };
  }, [ctx]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (trailers ?? []).filter((t) => {
      if (status !== "all" && t.status !== status) return false;
      if (type !== "all" && t.trailerType !== type) return false;
      if (attachment === "attached" && !t.attachedTruckUnit) return false;
      if (attachment === "unattached" && t.attachedTruckUnit) return false;
      if (powerUnit !== "all" && t.attachedTruckUnit !== powerUnit) return false;
      if (readiness === "issues" && t.documentWarnings === 0) return false;
      if (readiness === "clear" && t.documentWarnings > 0) return false;
      if (!q) return true;
      return (
        t.unit.toLowerCase().includes(q) ||
        TRAILER_TYPE_LABEL[t.trailerType].toLowerCase().includes(q) ||
        (t.attachedTruckUnit ?? "").toLowerCase().includes(q) ||
        (t.currentCity ?? "").toLowerCase().includes(q) ||
        (vins[t.trailerId] ?? "").toLowerCase().includes(q)
      );
    });
  }, [trailers, query, status, type, attachment, powerUnit, readiness, vins]);

  const types = useMemo(
    () => Array.from(new Set((trailers ?? []).map((t) => t.trailerType))),
    [trailers],
  );
  const powerUnits = useMemo(
    () => Array.from(new Set((trailers ?? []).map((t) => t.attachedTruckUnit).filter(Boolean) as string[])),
    [trailers],
  );

  return (
    <div className="space-y-section">
      <PageHeader
        title="Trailers"
        description="Every trailer your organization runs, what it is hooked to, and what needs sorting out."
        actions={
          <Can permission="trailers:create">
            <Button variant="primary" asChild>
              <Link href="/fleet/trailers/new">
                <Plus aria-hidden />
                Add trailer
              </Link>
            </Button>
          </Can>
        }
      />

      {pending.length > 0 ? (
        <section aria-labelledby="pending-trailers" className="rounded-lg border border-st-info/35 bg-st-info-bg/40 p-4">
          <h2 id="pending-trailers" className="text-[0.875rem] font-semibold text-fg">
            Waiting to be connected
          </h2>
          <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-fg-muted">
            You have asked to operate {pending.length === 1 ? "this trailer" : "these trailers"}. They
            are not part of your fleet and are not counted until the request is approved.
          </p>
          <ul className="mt-3 space-y-2">
            {pending.map(({ trailer, relationship }) => (
              <li key={relationship.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md border border-border bg-surface px-3.5 py-2.5">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-[0.875rem] font-medium text-fg">
                    Unit {relationship.unitNumber}
                    <TrailerCarrierStatusChip status={relationship.status} />
                  </p>
                  <p className="mt-0.5 font-mono text-[0.75rem] break-all text-fg-subtle">
                    {maskTrailerVin(trailer.vin)}
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
            placeholder="Unit, type, power unit, city or VIN…"
            aria-label="Search trailers"
            className="pl-9"
          />
        </div>

        <label className="sr-only" htmlFor="type-filter">Filter by trailer type</label>
        <select
          id="type-filter"
          value={type}
          onChange={(e) => setType(e.target.value)}
          className={SELECT}
        >
          <option value="all">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>{TRAILER_TYPE_LABEL[t]}</option>
          ))}
        </select>

        <label className="sr-only" htmlFor="attachment-filter">Filter by attachment</label>
        <select
          id="attachment-filter"
          value={attachment}
          onChange={(e) => setAttachment(e.target.value as AttachmentFilter)}
          className={SELECT}
        >
          <option value="all">Attached and unattached</option>
          <option value="attached">Attached only</option>
          <option value="unattached">Unattached only</option>
        </select>

        <label className="sr-only" htmlFor="power-unit-filter">Filter by power unit</label>
        <select
          id="power-unit-filter"
          value={powerUnit}
          onChange={(e) => setPowerUnit(e.target.value)}
          className={SELECT}
        >
          <option value="all">Any power unit</option>
          {powerUnits.map((u) => (
            <option key={u} value={u}>Unit {u}</option>
          ))}
        </select>

        <label className="sr-only" htmlFor="readiness-filter">Filter by document readiness</label>
        <select
          id="readiness-filter"
          value={readiness}
          onChange={(e) => setReadiness(e.target.value as ReadinessFilter)}
          className={SELECT}
        >
          <option value="all">Any paperwork state</option>
          <option value="issues">Paperwork needs attention</option>
          <option value="clear">Paperwork clear</option>
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
            {s === "all" ? "All" : TRAILER_STATUS_LABEL[s]}
            <span className="ml-1.5 tabular-nums opacity-70">
              {s === "all" ? trailers?.length ?? 0 : (trailers ?? []).filter((t) => t.status === s).length}
            </span>
          </button>
        ))}
      </div>

      {trailers === null ? <LoadingSkeleton rows={4} /> : null}

      {trailers !== null && trailers.length === 0 ? (
        <EmptyState
          icon={Container}
          title="No trailers yet"
          description="Add your first trailer when you are ready. You can run Antcolos without one and come back to this whenever it suits you."
          action={
            <Can permission="trailers:create">
              <Button variant="primary" asChild>
                <Link href="/fleet/trailers/new">Add your first trailer</Link>
              </Button>
            </Can>
          }
        />
      ) : null}

      {trailers !== null && trailers.length > 0 && visible.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No trailers match"
          description="Try a different search, type, status, power unit or paperwork filter."
        />
      ) : null}

      {visible.length > 0 ? (
        <ul className="space-y-2.5">
          {visible.map((trailer) => (
            <li key={trailer.trailerId}>
              <Link
                href={`/fleet/trailers/${trailer.trailerId}`}
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
                  <Container className="size-[1.125rem]" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-[0.9375rem] font-semibold text-fg">Unit {trailer.unit}</span>
                    <TrailerStatusChip status={trailer.status} />
                    <AttachmentStateChip state={trailer.attachmentState} />
                    <TrailerActivationChip state={trailer.activationState} />
                    <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[0.6875rem] font-medium text-fg-muted">
                      {TRAILER_TYPE_LABEL[trailer.trailerType]}
                    </span>
                    {trailer.documentWarnings > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-st-warning-bg px-2 py-0.5 text-[0.6875rem] font-medium text-st-warning">
                        <TriangleAlert className="size-3" aria-hidden />
                        {trailer.documentWarnings} to sort out
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.75rem] text-fg-muted">
                    <span>
                      {trailer.attachedTruckUnit
                        ? `On unit ${trailer.attachedTruckUnit}`
                        : "Not on a power unit"}
                    </span>
                    {trailer.carrierName ? <span>Runs under {trailer.carrierName}</span> : null}
                    {trailer.lockedByAnotherCarrier ? (
                      <span>Held by another carrier&apos;s operating lease</span>
                    ) : null}
                    {trailer.currentCity ? (
                      <span>{trailer.currentCity}{trailer.currentState ? `, ${trailer.currentState}` : ""}</span>
                    ) : null}
                    {trailer.expectedAvailableAt ? (
                      <span className="tabular-nums">Free {formatDate(trailer.expectedAvailableAt)}</span>
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

const SELECT =
  "h-control rounded-md border border-border bg-surface px-3 text-[0.8125rem] text-fg shadow-e1 " +
  "hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35";
