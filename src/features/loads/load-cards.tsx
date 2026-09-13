"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { LoadStatusBadge } from "@/components/common/status-badge";
import { Badge } from "@/components/ui/badge";
import { useCan } from "@/lib/session/hooks";
import { dateTimeIn, money, ratePerMile } from "@/lib/utils";
import { destinationStop, originStop, type Load } from "@/types";
import { DocumentStatus } from "./shared";

/**
 * Phone layout for the loads list. Deliberately a different component, not a
 * table squeezed into 390px: the columns that matter on a phone are the
 * reference, the lane, when it moves and whether the paperwork is done.
 */
export function LoadCards({
  loads, driverName,
}: {
  loads: Load[];
  driverName: (driverId?: string) => string;
}) {
  const canSeeRates = useCan("rates:view");

  return (
    <ul className="space-y-2.5">
      {loads.map((load) => {
        const pickup = originStop(load);
        const delivery = destinationStop(load);
        return (
          <li key={load.id}>
            <Link
              href={`/loads/${load.id}`}
              className="block rounded-lg border border-border bg-surface p-4 transition-colors active:bg-surface-hover"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-[0.9375rem] font-semibold text-fg">
                    {load.reference}
                  </p>
                  <p className="mt-0.5 truncate text-[0.8125rem] text-fg-muted">
                    {load.customer.name}
                  </p>
                </div>
                <LoadStatusBadge status={load.status} />
              </div>

              <div className="mt-3 space-y-2">
                <StopLine
                  label="Pick up"
                  city={`${pickup.address.city}, ${pickup.address.state}`}
                  when={dateTimeIn(pickup.appointmentAt, pickup.timeZone)}
                />
                <StopLine
                  label="Deliver"
                  city={`${delivery.address.city}, ${delivery.address.state}`}
                  when={dateTimeIn(delivery.appointmentAt, delivery.timeZone)}
                  last
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                {load.assignment?.driverId ? (
                  <span className="text-[0.8125rem] text-fg-muted">
                    {driverName(load.assignment.driverId)}
                  </span>
                ) : (
                  <Badge tone="outline">Unassigned</Badge>
                )}
                <DocumentStatus load={load} />
                {canSeeRates && load.financials ? (
                  <span className="tnum ml-auto text-[0.875rem] font-semibold text-fg">
                    {money(load.financials.totalRateCents)}
                    <span className="ml-1.5 text-[0.75rem] font-normal text-fg-subtle">
                      {ratePerMile(load.financials.ratePerMileCents)}
                    </span>
                  </span>
                ) : (
                  <ArrowRight aria-hidden className="ml-auto size-4 text-fg-subtle" />
                )}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function StopLine({
  label, city, when, last,
}: {
  label: string;
  city: string;
  when: string;
  last?: boolean;
}) {
  return (
    <div className="flex gap-2.5">
      <span className="flex flex-col items-center pt-1">
        <span
          aria-hidden
          className={`size-2 rounded-full ${last ? "bg-primary" : "bg-fg-subtle"}`}
        />
        {!last ? <span aria-hidden className="my-0.5 w-px flex-1 bg-border" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase">
          {label}
        </span>
        <span className="block truncate text-[0.875rem] font-medium text-fg">{city}</span>
        <span className="block text-[0.75rem] text-fg-muted">{when}</span>
      </span>
    </div>
  );
}
