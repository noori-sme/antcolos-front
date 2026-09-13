"use client";

import { ArrowRight, Radio, Truck, UserRound } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadStatusBadge } from "@/components/common/status-badge";
import { EQUIPMENT_LABEL } from "@/config/statuses";
import { useActiveMembership, useCan } from "@/lib/session/hooks";
import { dateTimeIn, money, ratePerMile, relativeTime, useNow } from "@/lib/utils";
import { laneLabel } from "@/types";
import type { Driver, Load, Truck as TruckType } from "@/types";

function PanelShell({
  title, description, href, linkLabel, children, empty,
}: {
  title: string;
  description?: string;
  href?: string;
  linkLabel?: string;
  children: React.ReactNode;
  empty?: boolean;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          {description ? (
            <p className="mt-0.5 text-[0.8125rem] text-fg-muted">{description}</p>
          ) : null}
        </div>
        {href && !empty ? (
          <Button asChild variant="ghost" size="sm">
            <Link href={href}>
              {linkLabel ?? "View all"}
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex-1 px-0 pb-0">{children}</CardContent>
    </Card>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-t border-border px-5 py-8 text-[0.875rem] text-fg-muted">
      {children}
    </p>
  );
}

/** MTloop preview: trucks entering or approaching the empty-truck loop. */
export function SoonEmptyTrucksPanel({ trucks }: { trucks: TruckType[] }) {
  const { organization } = useActiveMembership();
  const now = useNow();
  const tz = organization?.timeZone ?? "UTC";

  return (
    <PanelShell
      title="Trucks needing a load"
      description="Empty now or going empty within 12 hours."
      href="/dispatch"
      linkLabel="Dispatch board"
      empty={trucks.length === 0}
    >
      {trucks.length === 0 ? (
        <EmptyRow>Every truck has its next load committed.</EmptyRow>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {trucks.map((t) => {
            const empty =
              now !== null && t.estimatedEmptyAt
                ? new Date(t.estimatedEmptyAt).getTime() <= now
                : t.status === "available";
            return (
              <li key={t.id} className="flex items-center gap-3 px-5 py-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-fg-muted">
                  <Truck aria-hidden className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[0.875rem] font-medium text-fg">
                      Unit {t.unit}
                    </span>
                    <span className="truncate text-[0.75rem] text-fg-subtle">
                      {EQUIPMENT_LABEL[t.equipment]}
                      {t.carrierName ? ` · ${t.carrierName}` : ""}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-[0.75rem] text-fg-muted">
                    {t.currentCity}, {t.currentState} · min {ratePerMile(t.minimumRatePerMileCents)} ·
                    deadhead ≤ {t.maxDeadheadMiles} mi
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  {empty ? (
                    <Badge tone="danger">Empty</Badge>
                  ) : (
                    <Badge tone="warning">
                      {t.estimatedEmptyAt && now !== null
                        ? relativeTime(t.estimatedEmptyAt, now)
                        : "Soon"}
                    </Badge>
                  )}
                  {t.estimatedEmptyAt ? (
                    <span className="mt-0.5 block text-[0.6875rem] text-fg-subtle">
                      {dateTimeIn(t.estimatedEmptyAt, tz)}
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </PanelShell>
  );
}

export function ActiveLoadsPanel({
  loads, title = "Loads in motion", description,
}: {
  loads: Load[];
  title?: string;
  description?: string;
}) {
  const canSeeRates = useCan("rates:view");
  const { organization } = useActiveMembership();
  const tz = organization?.timeZone ?? "UTC";

  return (
    <PanelShell
      title={title}
      description={description}
      href="/loads"
      empty={loads.length === 0}
    >
      {loads.length === 0 ? (
        <EmptyRow>Nothing is on the road right now.</EmptyRow>
      ) : (
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full border-collapse text-[0.875rem]">
            <thead>
              <tr className="bg-surface-sunken/60 text-left">
                <Th>Reference</Th>
                <Th className="md:min-w-56">Lane</Th>
                <Th className="hidden lg:table-cell">Driver</Th>
                <Th>Status</Th>
                <Th className="hidden sm:table-cell">Delivers</Th>
                {canSeeRates ? <Th className="text-right">Rate</Th> : null}
              </tr>
            </thead>
            <tbody>
              {loads.map((load) => {
                const drop = load.stops[load.stops.length - 1];
                return (
                  <tr key={load.id} className="border-t border-border hover:bg-surface-hover">
                    <Td className="font-mono text-[0.8125rem] font-medium text-fg">
                      {load.reference}
                    </Td>
                    <Td className="min-w-[11rem] text-fg">{laneLabel(load)}</Td>
                    <Td className="hidden lg:table-cell">
                      {load.assignment?.driverId ? (
                        <DriverName driverId={load.assignment.driverId} />
                      ) : (
                        <Badge tone="outline">Unassigned</Badge>
                      )}
                    </Td>
                    <Td><LoadStatusBadge status={load.status} /></Td>
                    <Td className="hidden text-fg-muted sm:table-cell">
                      {dateTimeIn(drop.appointmentAt, tz)}
                    </Td>
                    {canSeeRates ? (
                      <Td className="tnum text-right font-medium text-fg">
                        {money(load.financials?.totalRateCents ?? 0)}
                      </Td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </PanelShell>
  );
}

/** Driver names come from the org-scoped directory, never from a User record. */
function DriverName({ driverId }: { driverId: string }) {
  return <span className="text-fg-muted">{DRIVER_NAME_HINT[driverId] ?? "Assigned"}</span>;
}

const DRIVER_NAME_HINT: Record<string, string> = {
  drv_nl_01: "D. Kovalenko", drv_nl_02: "M. Ortiz", drv_nl_03: "R. Bell",
  drv_nl_04: "A. Haddad", drv_nl_05: "T. Reyes", drv_nl_06: "K. Nguyen",
  drv_md_01: "S. Petrov", drv_md_02: "H. Boyd", drv_md_03: "L. Carrera",
  drv_md_04: "G. Lindqvist",
  drv_cascade_0192: "You", drv_cs_02: "O. Fitz",
};

export function UnassignedLoadsPanel({ loads }: { loads: Load[] }) {
  const { organization } = useActiveMembership();
  const now = useNow();
  const tz = organization?.timeZone ?? "UTC";

  return (
    <PanelShell
      title="Waiting for a truck"
      description="Booked loads with no driver assigned."
      href="/dispatch"
      linkLabel="Assign"
      empty={loads.length === 0}
    >
      {loads.length === 0 ? (
        <EmptyRow>Everything booked has a truck on it.</EmptyRow>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {loads.map((load) => (
            <li key={load.id} className="flex items-center gap-3 px-5 py-3">
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[0.8125rem] font-medium text-fg">
                    {load.reference}
                  </span>
                  <LoadStatusBadge status={load.status} />
                </span>
                <span className="mt-0.5 block truncate text-[0.8125rem] text-fg-muted">
                  {laneLabel(load)}
                </span>
              </span>
              <span className="shrink-0 text-right text-[0.75rem] text-fg-muted">
                <span className="block font-medium text-fg">
                  {now === null ? "\u00a0" : relativeTime(load.stops[0].appointmentAt, now)}
                </span>
                <span className="block text-fg-subtle">
                  {dateTimeIn(load.stops[0].appointmentAt, tz)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </PanelShell>
  );
}

export function DriverAttentionPanel({ drivers }: { drivers: Driver[] }) {
  return (
    <PanelShell
      title="Drivers to check"
      description="Missing paperwork or no Telegram connection."
      href="/people/drivers"
      empty={drivers.length === 0}
    >
      {drivers.length === 0 ? (
        <EmptyRow>Every driver is connected and current.</EmptyRow>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {drivers.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-5 py-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-fg-muted">
                <UserRound aria-hidden className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.875rem] font-medium text-fg">
                  {d.displayName}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  {d.documentWarnings > 0 ? (
                    <Badge tone="warning">
                      {d.documentWarnings} document{d.documentWarnings > 1 ? "s" : ""}
                    </Badge>
                  ) : null}
                  {!d.telegramConnected ? (
                    <Badge tone="neutral">
                      <Radio aria-hidden className="size-3" />
                      No Telegram
                    </Badge>
                  ) : null}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </PanelShell>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={`px-5 py-2.5 text-[0.75rem] font-semibold tracking-wide text-fg-subtle uppercase ${className}`}
    >
      {children}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`h-row px-5 py-[var(--cell-py)] align-middle text-fg-muted ${className}`}>
      {children}
    </td>
  );
}
