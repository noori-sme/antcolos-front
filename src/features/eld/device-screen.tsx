"use client";

import Link from "next/link";
import { ArrowLeft, History } from "lucide-react";
import { BINDING_END_REASON_LABEL, TRANSPORT_LABEL, DEVICE_KIND_LABEL } from "@/types";
import type { EldDriverBinding, EldVehicleBinding } from "@/types";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { ConnectionStateChip, MockProviderBanner } from "./chips";
import { EventsTable } from "./events-table";
import { SnapshotCard } from "./snapshot-card";
import { useEldDevice } from "./hooks";

/**
 * One device, its bindings, their history, and what it has reported.
 *
 * The binding tables are the reason this screen exists. A device that has been
 * on three trucks in a year has three intervals, all of them still here, none
 * of them edited — and every event on the right-hand side still says which
 * truck it was about at the time. That is the property the whole module turns
 * on, and it is only believable if you can see it.
 */
export function EldDeviceScreen({ deviceId }: { deviceId: string }) {
  const query = useEldDevice(deviceId);

  if (query.isError) {
    return (
      <div className="space-y-section">
        <BackLink />
        <ErrorState
          title="That device is not available"
          description={
            (query.error as Error)?.message
            ?? "It does not exist, or it belongs to an organization you are not in. Antcolos does not say which."
          }
        />
      </div>
    );
  }

  if (query.isPending || !query.data) {
    return (
      <div className="space-y-section">
        <BackLink />
        <LoadingSkeleton />
      </div>
    );
  }

  const { view, vehicleBindings, driverBindings, bindingHistory, recentEvents, snapshot } = query.data;

  return (
    <div className="space-y-section">
      <BackLink />
      <PageHeader
        title={view.device.serialNumber}
        description={`${DEVICE_KIND_LABEL[view.device.kind]} · ${view.providerName}`}
      />
      <MockProviderBanner />

      <Card>
        <CardHeader className="flex-row flex-wrap items-center gap-2">
          <CardTitle>{view.connectionLabel}</CardTitle>
          <ConnectionStateChip state={view.connectionState} />
        </CardHeader>
        <CardContent className="space-y-1 text-[0.8125rem] text-fg-muted">
          <p>{view.device.stateReason}</p>
          <p className="text-[0.75rem] text-fg-subtle">
            Provider id {view.device.externalRef.externalId} ·{" "}
            {TRANSPORT_LABEL[view.connectionTransport]} ·{" "}
            {view.eventsLast24h} signals received in the last 24 hours
            {view.device.firmware ? ` · firmware ${view.device.firmware}` : ""}
          </p>
        </CardContent>
      </Card>

      {snapshot ? <SnapshotCard snapshot={snapshot} /> : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <BindingCard
          title="Truck bindings"
          description="Which truck this device reported for, and when. Intervals close; they are never edited or removed, because every event already attributed to one has to stay explicable."
          rows={vehicleBindings.map((b) => ({
            id: b.id,
            subject: `Unit ${b.truckUnitSnapshot}`,
            href: `/fleet/trucks/${b.truckId}`,
            binding: b,
          }))}
        />
        <BindingCard
          title="Driver bindings"
          description="Who was operating this device, and when. A driver membership sees its own intervals and nobody else's."
          rows={driverBindings.map((b) => ({
            id: b.id,
            subject: b.driverNameSnapshot,
            binding: b,
          }))}
        />
      </div>

      <Card>
        <CardHeader className="flex-col items-start gap-1">
          <CardTitle className="flex items-center gap-2">
            <History className="size-4 text-fg-subtle" aria-hidden />
            Binding history
          </CardTitle>
          <CardDescription>
            Every change, kept separately from the bindings themselves — so even a correction
            leaves both the original claim and the correction standing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {bindingHistory.length === 0 ? (
            <EmptyState title="No binding changes recorded" />
          ) : (
            <ul className="space-y-1.5">
              {bindingHistory.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-baseline gap-2 text-[0.8125rem]">
                  <span className="tnum text-[0.75rem] text-fg-subtle">
                    {new Date(entry.at).toLocaleString()}
                  </span>
                  <span className="text-fg">{entry.detail}</span>
                  <span className="text-[0.75rem] text-fg-subtle">{entry.actorName}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-col items-start gap-1">
          <CardTitle>Recent signals</CardTitle>
          <CardDescription>
            Newest first, including the rows ingestion refused. Each one is attributed to the
            truck, driver, carrier, operating authority and load that were in force at the
            moment it happened — not to whatever is true today.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EventsTable events={recentEvents} />
        </CardContent>
      </Card>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/eld"
      className="inline-flex items-center gap-1.5 text-[0.8125rem] text-fg-muted hover:text-fg"
    >
      <ArrowLeft className="size-3.5" aria-hidden />
      ELD &amp; Telematics
    </Link>
  );
}

function BindingCard({
  title, description, rows,
}: {
  title: string;
  description: string;
  rows: {
    id: string;
    subject: string;
    href?: string;
    binding: EldVehicleBinding | EldDriverBinding;
  }[];
}) {
  return (
    <Card>
      <CardHeader className="flex-col items-start gap-1">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState title="None recorded" />
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li key={row.id} className="rounded-md border border-border bg-surface-sunken/40 p-3">
                <p className="flex flex-wrap items-center gap-2">
                  {row.href ? (
                    <Link href={row.href} className="text-[0.8125rem] font-medium text-fg hover:underline">
                      {row.subject}
                    </Link>
                  ) : (
                    <span className="text-[0.8125rem] font-medium text-fg">{row.subject}</span>
                  )}
                  <span
                    className={
                      row.binding.effectiveTo
                        ? "rounded-full bg-st-neutral-bg px-2 py-0.5 text-[0.6875rem] font-medium text-st-neutral"
                        : "rounded-full bg-st-success-bg px-2 py-0.5 text-[0.6875rem] font-medium text-st-success"
                    }
                  >
                    {row.binding.effectiveTo ? "Ended" : "Live"}
                  </span>
                </p>
                <p className="mt-1 tnum text-[0.75rem] text-fg-muted">
                  {new Date(row.binding.effectiveFrom).toLocaleString()}
                  {" → "}
                  {row.binding.effectiveTo
                    ? new Date(row.binding.effectiveTo).toLocaleString()
                    : "now"}
                </p>
                {row.binding.endReason ? (
                  <p className="mt-0.5 text-[0.6875rem] text-fg-subtle">
                    {BINDING_END_REASON_LABEL[row.binding.endReason]}
                  </p>
                ) : null}
                {row.binding.note ? (
                  <p className="mt-0.5 text-[0.75rem] text-fg-muted">{row.binding.note}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
