"use client";

import {
  ArrowLeft, ExternalLink, Gauge, History, Lock, MapPin, ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { Can } from "@/components/auth/can";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import type {
  FleetAssetKind, FleetAssignmentRecord, FleetEquipmentRow, FleetRecordLink,
  FleetRecordLinks, FleetTelemetryReading, FleetUtilizationSummary,
} from "@/types";
import { EQUIPMENT_LABEL } from "@/lib/fleet/equipment";
import { TRAILER_TYPE_LABEL } from "@/lib/fleet/trailer-equipment";
import { OperationalStatusChip, ReadinessChip, TelemetrySourceChip } from "./chips";
import {
  READINESS_KIND_LABEL, STATUS_SOURCE_LABEL, formatAge, formatDate, formatDateTime,
  formatEngineHours, formatHours, formatMiles, formatPlace,
} from "./labels";
import { RecordReadingDialog } from "./record-reading-dialog";
import { useFleetAsset } from "./hooks";
import { cn } from "@/lib/utils";

/**
 * One asset's operational picture.
 *
 * The whole point of this screen is that every number on it says where it came
 * from. The status shows which record decided it and what the other records
 * said; the location shows who recorded it and when; the readiness shows
 * whether Antcolos holds the paperwork or simply does not track it; the
 * utilization shows whether the window was fully covered by records.
 *
 * Nothing here is a place to change a fact. Changing the driver, the status,
 * the attachment or the documents happens on the modules that own those
 * records, which is what the links at the bottom are for.
 */
export function FleetAssetScreen({
  assetKind, assetId,
}: { assetKind: FleetAssetKind; assetId: string }) {
  const query = useFleetAsset(assetKind, assetId);

  if (query.isPending) {
    return (
      <div className="space-y-section">
        <BackLink />
        <LoadingSkeleton rows={5} />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className="space-y-section">
        <BackLink />
        <ErrorState
          title="This equipment is not available to you"
          description={
            "Either it does not exist, or your organization has no relationship with it. "
            + "Antcolos gives the same answer to both so an address bar cannot be used to "
            + "find out which."
          }
        />
      </div>
    );
  }

  const { row, utilization, telemetryHistory, assignmentHistory } = query.data;
  const title = row.assetKind === "truck" ? `Unit ${row.unit}` : `Trailer ${row.unit}`;

  return (
    <div className="space-y-section">
      <BackLink />

      <PageHeader
        title={title}
        description={
          row.assetKind === "truck"
            ? EQUIPMENT_LABEL[row.truckEquipmentType!]
            : TRAILER_TYPE_LABEL[row.trailerType!]
        }
        actions={
          <Can permission="fleet:telemetry:record">
            <RecordReadingDialog
              assetKind={row.assetKind}
              assetId={row.assetId}
              unit={title}
            />
          </Can>
        }
      />

      <StatusCard row={row} />
      <TelemetryCard row={row} history={telemetryHistory} />
      <ReadinessCard row={row} />
      <UtilizationCard utilization={utilization} />
      <AssignmentHistoryCard records={assignmentHistory} assetKind={row.assetKind} />
      <LinksCard links={row.links} />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/fleet"
      className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline"
    >
      <ArrowLeft className="size-3.5" aria-hidden />
      Back to the fleet
    </Link>
  );
}

/* -------------------------------------------------------------------------- */

function StatusCard({ row }: { row: FleetEquipmentRow }) {
  return (
    <Card>
      <CardHeader className="flex-col items-start gap-1">
        <CardTitle className="flex flex-wrap items-center gap-2">
          Operational status
          <OperationalStatusChip status={row.derivation.status} />
        </CardTitle>
        <CardDescription>{row.derivation.reason}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!row.authority.availableToOrganization && row.authority.blockedReason ? (
          <p
            className={cn(
              "flex items-start gap-2 rounded-md px-3 py-2.5 text-[0.8125rem]",
              row.authority.lockedByOtherAuthority
                ? "bg-st-neutral-bg text-fg-muted"
                : "bg-st-warning-bg text-st-warning",
            )}
          >
            <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              {row.authority.blockedReason}
              {row.authority.lockedByOtherAuthority && !row.authority.operatingCarrierName ? (
                <span className="mt-1 block text-[0.75rem] text-fg-subtle">
                  You are told the equipment is busy, never who has it or what they are hauling.
                  Only one operating authority can be live on a piece of equipment at a time.
                </span>
              ) : null}
            </span>
          </p>
        ) : null}

        <div>
          <p className="text-[0.8125rem] font-medium text-fg">What this was worked out from</p>
          <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
            Read in this order. The first record that settles the question wins, and it is
            marked below — so if the answer looks wrong, that is the record to go and fix.
          </p>
          <ul className="mt-2.5 space-y-1.5">
            {row.derivation.inputs.map((input, i) => {
              const decided = input.source === row.derivation.decidedBy;
              return (
                <li
                  key={`${input.source}-${i}`}
                  className={cn(
                    "flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-md border px-3 py-2 text-[0.8125rem]",
                    decided
                      ? "border-primary/40 bg-primary/5 text-fg"
                      : "border-border bg-surface-sunken/40 text-fg-muted",
                  )}
                >
                  <span className="font-medium">{STATUS_SOURCE_LABEL[input.source]}</span>
                  <span>{input.label}</span>
                  {decided ? (
                    <span className="ml-auto rounded-full bg-primary/12 px-2 py-0.5 text-[0.6875rem] font-medium text-primary">
                      Decided it
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>

        {row.myLoadReference || row.leaseExpectedEndAt ? (
          <dl className="grid gap-x-6 gap-y-2 text-[0.8125rem] sm:grid-cols-2">
            {row.myLoadReference ? (
              <div>
                <dt className="text-fg-muted">Your reference on it</dt>
                <dd className="font-medium text-fg">{row.myLoadReference}</dd>
              </div>
            ) : null}
            {row.leaseExpectedEndAt ? (
              <div>
                <dt className="text-fg-muted">Planned end of your lease</dt>
                <dd className="font-medium text-fg">
                  {formatDateTime(row.leaseExpectedEndAt)}
                  <span className="mt-0.5 block text-[0.75rem] font-normal text-fg-subtle">
                    Reaching it releases nothing on its own.
                  </span>
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

function TelemetryCard({
  row, history,
}: { row: FleetEquipmentRow; history: FleetTelemetryReading[] }) {
  const latest = row.telemetry.reading;
  return (
    <Card>
      <CardHeader className="flex-col items-start gap-1">
        <CardTitle className="flex items-center gap-2">
          <MapPin className="size-4 text-fg-subtle" aria-hidden />
          Last known location, mileage and engine hours
        </CardTitle>
        <CardDescription>
          Every reading is dated twice — when it was true, and when Antcolos was told. Readings
          are appended, never edited, so a correction never erases what was believed before it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!latest ? (
          <p className="rounded-md bg-st-warning-bg px-3 py-2.5 text-[0.8125rem] text-st-warning">
            Nobody has ever recorded a location, an odometer or engine hours for this equipment.
            No GPS, ELD or telematics feed is connected, so this stays empty until somebody
            records one.
          </p>
        ) : (
          <>
            <dl className="grid gap-x-6 gap-y-3 text-[0.8125rem] sm:grid-cols-2 lg:grid-cols-4">
              <Fact label="Location" value={formatPlace(latest.location)} />
              {/* A trailer has no odometer and no engine. An empty cell would
                  read as missing data rather than as a question that does not
                  apply to this equipment. */}
              {row.assetKind === "truck" ? (
                <>
                  <Fact label="Mileage" value={formatMiles(latest.odometerMiles)} />
                  <Fact label="Engine hours" value={formatEngineHours(latest.engineHours)} />
                </>
              ) : null}
              <Fact
                label="Last updated"
                value={formatDateTime(latest.observedAt)}
                hint={`${formatAge(row.telemetry.ageHours)}${row.telemetry.stale ? ` — past the ${row.telemetry.freshnessExpectationHours}-hour expectation` : ""}`}
                tone={row.telemetry.stale ? "warning" : "default"}
              />
            </dl>

            <p className="flex flex-wrap items-center gap-2 text-[0.75rem] text-fg-subtle">
              <span>Source:</span>
              <TelemetrySourceChip source={latest.source} stale={row.telemetry.stale} />
              {latest.recordedByName ? <span>by {latest.recordedByName}</span> : null}
              <span>· written up {formatDateTime(latest.recordedAt)}</span>
            </p>
            {latest.note ? (
              <p className="rounded-md bg-surface-sunken/50 px-3 py-2 text-[0.8125rem] text-fg-muted">
                {latest.note}
              </p>
            ) : null}
          </>
        )}

        {history.length > 1 ? (
          <div>
            <p className="text-[0.8125rem] font-medium text-fg">Earlier readings</p>
            <ul className="mt-2 space-y-1.5">
              {history.slice(1, 6).map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-surface-sunken/30 px-3 py-2 text-[0.75rem] text-fg-muted"
                >
                  <span className="font-medium text-fg">{formatPlace(r.location)}</span>
                  {r.odometerMiles != null ? <span className="tnum">{formatMiles(r.odometerMiles)}</span> : null}
                  <TelemetrySourceChip source={r.source} />
                  <span className="ml-auto">{formatDateTime(r.observedAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

function ReadinessCard({ row }: { row: FleetEquipmentRow }) {
  return (
    <Card>
      <CardHeader className="flex-col items-start gap-1">
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-fg-subtle" aria-hidden />
          Registration, plate, permit and IFTA
        </CardTitle>
        <CardDescription>
          What Antcolos holds, and what it does not. Nothing below has been checked with a
          state or a government system — no registration lookup is connected.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {row.readiness.items.map((r) => (
            <li
              key={r.kind}
              className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-md border border-border bg-surface-sunken/30 px-3.5 py-2.5"
            >
              <span className="flex min-w-[7rem] items-center gap-2 text-[0.8125rem] font-medium text-fg">
                {READINESS_KIND_LABEL[r.kind]}
                <ReadinessChip state={r.state} />
              </span>
              <span className="min-w-0 flex-1 text-[0.8125rem] text-fg-muted">{r.detail}</span>
              {r.expiresAt ? (
                <span className="text-[0.75rem] whitespace-nowrap text-fg-subtle">
                  {formatDate(r.expiresAt)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

function UtilizationCard({ utilization }: { utilization: FleetUtilizationSummary }) {
  return (
    <Card>
      <CardHeader className="flex-col items-start gap-1">
        <CardTitle className="flex items-center gap-2">
          <Gauge className="size-4 text-fg-subtle" aria-hidden />
          Utilization over the last {utilization.windowDays} days
        </CardTitle>
        <CardDescription>{utilization.basis}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid gap-x-6 gap-y-3 text-[0.8125rem] sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Utilization" value={`${utilization.utilizationPct}%`} />
          <Fact label="Availability" value={`${utilization.availabilityPct}%`} />
          <Fact label="Idle time" value={formatHours(utilization.idleHours)} />
          <Fact label="Operational downtime" value={formatHours(utilization.downtimeHours)} />
        </dl>
        {!utilization.fullyDerived ? (
          <p className="rounded-md bg-st-warning-bg px-3 py-2 text-[0.75rem] text-st-warning">
            These figures do not cover the whole window. Treat them as partial rather than as a
            measure of how hard this equipment has been worked.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

function AssignmentHistoryCard({
  records, assetKind,
}: { records: FleetAssignmentRecord[]; assetKind: FleetAssetKind }) {
  return (
    <Card>
      <CardHeader className="flex-col items-start gap-1">
        <CardTitle className="flex items-center gap-2">
          <History className="size-4 text-fg-subtle" aria-hidden />
          Assignment history
        </CardTitle>
        <CardDescription>
          Every dated assignment, open and closed. Reassigning a driver or a trailer ends the
          previous record and opens a new one — it never deletes one, so this list only ever
          grows.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {records.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-4 text-[0.8125rem] text-fg-muted">
            {assetKind === "truck"
              ? "No driver has been assigned to this truck and no trailer has been hooked to it under your organization."
              : "This trailer has not been attached to a power unit under your organization."}
          </p>
        ) : (
          <ul className="space-y-2">
            {records.map((r) => (
              <li
                key={r.id}
                className={cn(
                  "rounded-md border px-3.5 py-2.5",
                  r.effectiveTo
                    ? "border-border bg-surface-sunken/30"
                    : "border-st-success/35 bg-st-success-bg/30",
                )}
              >
                <p className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
                  <span className="font-medium text-fg">
                    {r.kind === "driver_truck"
                      ? `${r.driverName} on unit ${r.truckUnit}`
                      : `Trailer ${r.trailerUnit} on unit ${r.truckUnit}`}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[0.6875rem] font-medium",
                      r.effectiveTo
                        ? "bg-st-neutral-bg text-st-neutral"
                        : "bg-st-success-bg text-st-success",
                    )}
                  >
                    {r.effectiveTo ? "Ended" : "Live"}
                  </span>
                </p>
                <p className="mt-1 text-[0.75rem] text-fg-muted">
                  {formatDate(r.effectiveFrom)} → {r.effectiveTo ? formatDate(r.effectiveTo) : "now"}
                  {r.endReason ? ` · ${r.endReason}` : ""}
                </p>
                <p className="mt-0.5 font-mono text-[0.6875rem] break-all text-fg-subtle">
                  {r.source === "truck_driver_assignment"
                    ? "Truck driver assignment"
                    : "Trailer attachment"}{" "}
                  · {r.sourceId}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

function LinksCard({ links }: { links: FleetRecordLinks }) {
  const entries = (Object.entries(links) as Array<[string, FleetRecordLink | undefined]>)
    .filter((e): e is [string, FleetRecordLink] => Boolean(e[1]));

  return (
    <Card>
      <CardHeader className="flex-col items-start gap-1">
        <CardTitle>The records behind this</CardTitle>
        <CardDescription>
          This screen changes nothing. The driver, the status, the attachment, the paperwork
          and the lease each live on the module that owns them, which is where they are
          changed — one fact, one place.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2 sm:grid-cols-2">
          {entries.map(([key, link]) => (
            <li key={key}>
              {link.deferred ? (
                <span className="flex items-center justify-between gap-2 rounded-md border border-dashed border-border px-3 py-2.5 text-[0.8125rem] text-fg-subtle">
                  {link.label}
                  <span className="shrink-0 text-[0.6875rem] font-medium">Not built yet</span>
                </span>
              ) : (
                <Link
                  href={link.href}
                  className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2.5 text-[0.8125rem] text-fg transition-colors hover:border-border-strong hover:bg-surface-hover"
                >
                  {link.label}
                  <ExternalLink className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
                </Link>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Fact({
  label, value, hint, tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "warning";
}) {
  return (
    <div>
      <dt className="text-[0.75rem] text-fg-muted">{label}</dt>
      <dd
        className={cn(
          "tnum mt-0.5 text-[0.9375rem] font-semibold",
          tone === "warning" ? "text-st-warning" : "text-fg",
        )}
      >
        {value}
      </dd>
      {hint ? <p className="mt-0.5 text-[0.6875rem] text-fg-subtle">{hint}</p> : null}
    </div>
  );
}
