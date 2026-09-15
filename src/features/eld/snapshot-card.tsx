"use client";

import Link from "next/link";
import { EyeOff, Fuel, Gauge, MapPin, Timer } from "lucide-react";
import type { EquipmentTelemetrySnapshot, SnapshotField } from "@/types";
import { DATA_QUALITY_DESCRIPTION } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConnectionStateChip, DiagnosticSeverityChip, QualityChip } from "./chips";
import { formatAge, formatHoursMinutes, formatMeasurement } from "./labels";

/**
 * One truck's current picture, derived from its accepted events.
 *
 * Every value on this card carries its quality chip, its age and the provider
 * that said it. That is not decoration: a dispatcher deciding whether to commit
 * a truck to a load needs to know whether the position is nine minutes old or
 * nine hours old, and whether anybody has confirmed it or a device simply
 * reported it. Hiding either behind a hover would make the card look more
 * authoritative than it is.
 */
/** The parts of a snapshot field this card renders, whatever the value type is. */
type ReadingMeta = Pick<
  SnapshotField<never>, "quality" | "ageHours" | "stale" | "providerName"
>;

function Reading({
  icon: Icon, label, field, formatted,
}: {
  icon: typeof MapPin;
  label: string;
  field: ReadingMeta;
  formatted: string;
}) {
  return (
    <div className="rounded-md border border-border bg-surface-sunken/40 p-3">
      <p className="flex items-center gap-1.5 text-[0.75rem] font-medium text-fg-muted">
        <Icon className="size-3.5 text-fg-subtle" aria-hidden />
        {label}
      </p>
      <p className="mt-1 text-[0.9375rem] font-semibold text-fg">{formatted}</p>
      <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <QualityChip quality={field.quality} />
        <span className={field.stale ? "text-[0.6875rem] text-st-warning" : "text-[0.6875rem] text-fg-subtle"}>
          {formatAge(field.ageHours)}
        </span>
      </p>
      {field.providerName ? (
        <p className="mt-1 truncate text-[0.6875rem] text-fg-subtle">{field.providerName}</p>
      ) : null}
    </div>
  );
}

export function SnapshotCard({ snapshot }: { snapshot: EquipmentTelemetrySnapshot }) {
  const position = snapshot.location.value;
  const coordinatesWithheld = Boolean(position) && position?.precise === false;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <Link href={`/fleet/trucks/${snapshot.truckId}`} className="hover:underline">
            Unit {snapshot.truckUnit}
          </Link>
          <ConnectionStateChip state={snapshot.connectionState} />
        </CardTitle>
        {snapshot.deviceId ? (
          <Link
            href={`/eld/devices/${snapshot.deviceId}`}
            className="shrink-0 text-[0.75rem] text-fg-muted hover:text-fg hover:underline"
          >
            {snapshot.deviceSerial ?? "Device"}
          </Link>
        ) : (
          <span className="shrink-0 text-[0.75rem] text-fg-subtle">
            {/* "No device" and "a device you may not know about" are different
                facts, and one empty field cannot say both. */}
            {snapshot.deviceWithheld ? "Device not shared" : "No device bound"}
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Reading
            icon={MapPin}
            label="Location"
            field={snapshot.location}
            formatted={formatMeasurement(
              position ? { ...position, latitude: position.latitude ?? 0, longitude: position.longitude ?? 0 } : undefined,
            )}
          />
          <Reading
            icon={Gauge}
            label="Odometer"
            field={snapshot.odometer}
            formatted={formatMeasurement(snapshot.odometer.value)}
          />
          <Reading
            icon={Timer}
            label="Engine hours"
            field={snapshot.engineHours}
            formatted={formatMeasurement(snapshot.engineHours.value)}
          />
          <Reading
            icon={Gauge}
            label="Speed"
            field={snapshot.speed}
            formatted={formatMeasurement(snapshot.speed.value)}
          />
          <Reading
            icon={Fuel}
            label="Fuel level"
            field={snapshot.fuelLevel}
            formatted={formatMeasurement(snapshot.fuelLevel.value)}
          />
          <Reading
            icon={Timer}
            label="Ignition and motion"
            field={snapshot.ignition}
            formatted={`${formatMeasurement(snapshot.ignition.value)} · ${formatMeasurement(snapshot.motion.value)}`}
          />
        </div>

        {coordinatesWithheld ? (
          <p className="flex items-start gap-2 rounded-md bg-surface-sunken/60 px-3 py-2 text-[0.75rem] text-fg-muted">
            <EyeOff className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" aria-hidden />
            Exact coordinates are withheld from this membership. The city the provider
            geocoded is shown instead — it is the same observation, less precisely.
          </p>
        ) : null}

        {snapshot.hos ? (
          <div className="rounded-md border border-border bg-surface-sunken/40 p-3">
            <p className="text-[0.75rem] font-medium text-fg-muted">
              Hours of service — availability summary
            </p>
            <p className="mt-1 text-[0.9375rem] font-semibold text-fg">
              {formatMeasurement(snapshot.hos.value)}
            </p>
            {snapshot.hos.value ? (
              <p className="mt-1 text-[0.75rem] text-fg-muted">
                Shift {formatHoursMinutes(snapshot.hos.value.shiftSecondsRemaining)} ·
                {" "}Cycle {formatHoursMinutes(snapshot.hos.value.cycleSecondsRemaining)}
              </p>
            ) : null}
            <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <QualityChip quality={snapshot.hos.quality} />
              <span className="text-[0.6875rem] text-fg-subtle">
                {formatAge(snapshot.hos.ageHours)}
              </span>
            </p>
            <p className="mt-1.5 text-[0.6875rem] leading-relaxed text-fg-subtle">
              A summary of a clock, not a record of duty status. Antcolos holds no logs,
              certifications or edits, and nothing here has been filed with anybody.
            </p>
          </div>
        ) : null}

        {snapshot.diagnostics.length ? (
          <ul className="space-y-1.5">
            {snapshot.diagnostics.map((d) => (
              <li
                key={d.eventId}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-sunken/40 px-3 py-2"
              >
                <DiagnosticSeverityChip severity={d.severity} />
                <span className="text-[0.8125rem] font-medium text-fg">{d.code}</span>
                {d.description ? (
                  <span className="text-[0.75rem] text-fg-muted">{d.description}</span>
                ) : null}
                <span className="ml-auto text-[0.6875rem] text-fg-subtle">
                  Reported by the provider — not interpreted
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <p className="text-[0.6875rem] leading-relaxed text-fg-subtle">
          Derived from {snapshot.eventsConsidered} accepted signals. Nothing on this card is
          stored: it is recomputed from the event history every time it is read, and the raw
          provider payloads behind it are untouched.{" "}
          {DATA_QUALITY_DESCRIPTION[snapshot.location.quality]}
        </p>
      </CardContent>
    </Card>
  );
}
