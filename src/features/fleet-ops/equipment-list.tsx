"use client";

import { ChevronRight, Container, Lock, MapPin, Truck as TruckIcon, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { FleetEquipmentRow } from "@/types";
import { EQUIPMENT_LABEL } from "@/lib/fleet/equipment";
import { TRAILER_TYPE_LABEL } from "@/lib/fleet/trailer-equipment";
import { OperationalStatusChip, TelemetrySourceChip } from "./chips";
import { formatAge, formatMiles, formatPlace } from "./labels";
import { cn } from "@/lib/utils";

/**
 * The operational roster.
 *
 * One row per asset, ordered so that what needs attention is at the top. Each
 * row states the derived status, whether this organization may actually use the
 * equipment, and how old the location is — because a row that shows a city
 * without saying it was recorded four days ago is worse than one that shows no
 * city at all.
 */
export function EquipmentList({ rows }: { rows: FleetEquipmentRow[] }) {
  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li key={`${row.assetKind}:${row.assetId}`}>
          <Link
            href={`/fleet/equipment/${row.assetKind}/${row.assetId}`}
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
              {row.assetKind === "truck"
                ? <TruckIcon className="size-[1.125rem]" />
                : <Container className="size-[1.125rem]" />}
            </span>

            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2">
                <span className="text-[0.9375rem] font-semibold text-fg">
                  {row.assetKind === "truck" ? `Unit ${row.unit}` : `Trailer ${row.unit}`}
                </span>
                <OperationalStatusChip status={row.derivation.status} />
                <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[0.6875rem] font-medium text-fg-muted">
                  {row.assetKind === "truck"
                    ? EQUIPMENT_LABEL[row.truckEquipmentType!]
                    : TRAILER_TYPE_LABEL[row.trailerType!]}
                </span>
                {row.readiness.blocking > 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-st-danger-bg px-2 py-0.5 text-[0.6875rem] font-medium text-st-danger">
                    <TriangleAlert className="size-3" aria-hidden />
                    {row.readiness.blocking} blocking
                  </span>
                ) : null}
                {row.documentWarnings > 0 ? (
                  <span className="rounded-full bg-st-warning-bg px-2 py-0.5 text-[0.6875rem] font-medium text-st-warning">
                    {row.documentWarnings} document{row.documentWarnings === 1 ? "" : "s"} to sort out
                  </span>
                ) : null}
              </p>

              {/* Why the equipment is not usable, when it is not. Never names
                  another carrier unless the viewer was already entitled to it. */}
              {!row.authority.availableToOrganization && row.authority.blockedReason ? (
                <p className="mt-1.5 inline-flex items-start gap-1.5 rounded-md bg-surface-sunken px-2 py-1 text-[0.75rem] text-fg-muted">
                  <Lock className="mt-px size-3 shrink-0" aria-hidden />
                  {row.authority.blockedReason}
                </p>
              ) : null}

              <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.75rem] text-fg-muted">
                {row.assetKind === "truck" ? (
                  <span>{row.driver ? row.driver.driverName : "No driver assigned"}</span>
                ) : null}
                {row.pairedTrailer ? <span>Pulling {row.pairedTrailer.unit}</span> : null}
                {row.pairedTruck ? <span>On unit {row.pairedTruck.unit}</span> : null}
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3" aria-hidden />
                  {formatPlace(row.telemetry.reading?.location)}
                </span>
                {/* From the canonical Equipment Meter Ledger, which every
                    contributor appends to — not from the location reading. */}
                {row.telemetry.meter?.odometer ? (
                  <span className="tnum">{formatMiles(row.telemetry.meter.odometer.value)}</span>
                ) : null}
              </p>

              <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[0.6875rem] text-fg-subtle">
                <span className={cn(row.telemetry.stale && "text-st-warning")}>
                  Located {formatAge(row.telemetry.ageHours)}
                </span>
                {row.telemetry.reading ? (
                  <TelemetrySourceChip
                    source={row.telemetry.reading.source}
                    stale={row.telemetry.stale}
                  />
                ) : (
                  <span className="rounded-full bg-st-warning-bg px-2 py-0.5 font-medium text-st-warning">
                    Never recorded
                  </span>
                )}
              </p>
            </div>

            <ChevronRight className="mt-1 size-4 shrink-0 text-fg-subtle" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}
