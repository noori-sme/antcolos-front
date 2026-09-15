"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Antenna, Cable, Link2Off, Radar, Satellite, ShieldAlert, TriangleAlert,
} from "lucide-react";
import type { EldConnection, EldShare, TelemetryEvent } from "@/types";
import {
  CONNECTION_STATE_DESCRIPTION, CONNECTION_STATE_LABEL, SIGNAL_CLASS_LABEL,
  TRANSPORT_LABEL,
} from "@/types";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { Chip } from "@/components/ui/chip";
import { useServiceContext } from "@/lib/api/use-service-context";
import { cn } from "@/lib/utils";
import { ConnectionStateChip, MockProviderBanner } from "./chips";
import { EventsTable } from "./events-table";
import { SignalsPanel } from "./signals-panel";
import { SnapshotCard } from "./snapshot-card";
import { IngestConsole } from "./ingest-console";
import { useEldDashboard, useEldEvents, useEldShares } from "./hooks";

/**
 * The organization-scoped ELD & Telematics dashboard.
 *
 * It answers one question the rest of Antcolos could not: what is the machine
 * layer under this fleet actually doing? Which devices exist, which links are
 * healthy, what came in, what was refused and why, what each truck currently
 * looks like as a result, and what has been queued for the modules that consume
 * it.
 *
 * Everything on it is scoped by the service layer. A carrier sees its own
 * devices and links; a dispatch workspace sees only the trucks a carrier
 * explicitly shared, in the signal classes it chose, with no devices, no links
 * and no driver names; a driver sees the truck they are on and their own clock.
 * None of that is decided here — this screen renders what it is given.
 */
type Tab = "equipment" | "devices" | "signals" | "stream";

const TABS: { id: Tab; label: string }[] = [
  { id: "equipment", label: "Equipment" },
  { id: "devices", label: "Devices and links" },
  { id: "signals", label: "Queued signals" },
  { id: "stream", label: "Signal stream" },
];

export function EldDashboardScreen() {
  const ctx = useServiceContext();
  const dashboard = useEldDashboard();
  const shares = useEldShares();
  const [tab, setTab] = useState<Tab>("equipment");
  const [ingestion, setIngestion] = useState<TelemetryEvent["ingestion"][]>([]);

  const eventQuery = useMemo(
    () => ({ ingestion: ingestion.length ? ingestion : undefined, limit: 120 }),
    [ingestion],
  );
  const events = useEldEvents(eventQuery);

  const isDispatchWorkspace = ctx?.workspaceKind !== "carrier_organization";
  const mayIngest = Boolean(ctx?.permissions.has("eld:ingest"));

  if (dashboard.isError) {
    return (
      <div className="space-y-section">
        <PageHeader title="ELD & Telematics" />
        <ErrorState
          title="The telematics picture could not be assembled"
          description={(dashboard.error as Error)?.message ?? "The request did not complete."}
          onRetry={() => dashboard.refetch()}
        />
      </div>
    );
  }

  if (dashboard.isPending || !dashboard.data) {
    return (
      <div className="space-y-section">
        <PageHeader title="ELD & Telematics" />
        <LoadingSkeleton />
      </div>
    );
  }

  const data = dashboard.data;
  const s = data.summary;

  return (
    <div className="space-y-section">
      <PageHeader
        title="ELD & Telematics"
        description={
          isDispatchWorkspace
            ? "Operational telemetry carriers have explicitly shared with this workspace."
            : "Devices, provider links and the normalized signal stream underneath your fleet."
        }
      />

      <MockProviderBanner />

      {/* ---- Summary ---------------------------------------------------- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={Satellite}
          label={isDispatchWorkspace ? "Trucks shared" : "Devices"}
          value={isDispatchWorkspace ? data.snapshots.length : s.devices}
          hint={isDispatchWorkspace
            ? "Devices are not part of a share"
            : s.unboundDevices ? `${s.unboundDevices} bound to nothing` : "All bound"}
        />
        <Stat icon={Cable} label="Connections" value={s.connections}
          hint={isDispatchWorkspace
            ? "The carrier holds its own links"
            : `${s.connectionCounts.connected} healthy`} />
        <Stat icon={Radar} label="Signals, 24 h" value={s.eventsLast24h}
          hint={`${s.flaggedLast24h} flagged · ${s.rejectedLast24h} refused`} />
        <Stat icon={TriangleAlert} label="Needs attention" value={s.staleSnapshots + s.activeCriticalDiagnostics}
          hint={`${s.staleSnapshots} stale · ${s.activeCriticalDiagnostics} critical faults`}
          tone={s.staleSnapshots + s.activeCriticalDiagnostics > 0 ? "warning" : undefined} />
      </div>

      {/* ---- Tabs ------------------------------------------------------- */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Chip key={t.id} label={t.label} selected={tab === t.id} onToggle={() => setTab(t.id)} />
        ))}
      </div>

      {tab === "equipment" ? (
        data.snapshots.length === 0 ? (
          <EmptyState
            icon={Satellite}
            title={isDispatchWorkspace ? "Nothing has been shared with you" : "No equipment telemetry"}
            description={
              isDispatchWorkspace
                ? "Telemetry reaches a dispatch workspace only when a carrier explicitly shares a truck with it. Nothing is shared by default."
                : "Bind a device to a truck and its signals will start appearing here."
            }
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {data.snapshots.map((snapshot) => (
              <SnapshotCard key={snapshot.truckId} snapshot={snapshot} />
            ))}
          </div>
        )
      ) : null}

      {tab === "devices" ? (
        <div className="space-y-3">
          {isDispatchWorkspace ? (
            <EmptyState
              icon={Link2Off}
              title="Devices are not shared"
              description="A share covers a truck's operational signals, not the carrier's hardware. Which units it runs, and how many, is not part of any grant."
            />
          ) : (
            <>
              <ConnectionsPanel connections={data.connections} />
              <Card>
                <CardHeader className="flex-col items-start gap-1">
                  <CardTitle>Devices</CardTitle>
                  <CardDescription>
                    A device is not a truck. It moves between them, it is swapped when it
                    fails, and it spends time bound to nothing — which is why every binding
                    below is a dated interval and why re-binding one never rewrites what an
                    old event was about.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {data.devices.length === 0 ? (
                    <EmptyState title="No devices registered" />
                  ) : (
                    <ul className="space-y-2">
                      {data.devices.map((view) => (
                        <li key={view.device.id}>
                          <Link
                            href={`/eld/devices/${view.device.id}`}
                            className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-sunken/40 px-3 py-2 hover:border-border-strong"
                          >
                            <Antenna className="size-3.5 text-fg-subtle" aria-hidden />
                            <span className="text-[0.8125rem] font-medium text-fg">
                              {view.device.serialNumber}
                            </span>
                            <ConnectionStateChip state={view.connectionState} />
                            <span className="text-[0.75rem] text-fg-muted">
                              {view.truckUnit ? `Unit ${view.truckUnit}` : "Bound to nothing"}
                            </span>
                            {view.driverName ? (
                              <span className="text-[0.75rem] text-fg-subtle">{view.driverName}</span>
                            ) : null}
                            <span className="tnum ml-auto text-[0.6875rem] text-fg-subtle">
                              {view.eventsLast24h} signals received / 24 h
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
              {mayIngest ? (
                <IngestConsole
                  connections={data.connections}
                  devices={data.devices}
                  snapshots={data.snapshots}
                />
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {tab === "signals" ? (
        <div className="space-y-3">
          <SignalsPanel signals={data.publishedSignals} />
          <SharesPanel
            shares={shares.data ?? []}
            isDispatchWorkspace={isDispatchWorkspace}
          />
        </div>
      ) : null}

      {tab === "stream" ? (
        <Card>
          <CardHeader className="flex-col items-start gap-2">
            <CardTitle>Normalized signal stream</CardTitle>
            <CardDescription>
              Every signal Antcolos made out of a provider&apos;s delivery, including the ones
              it refused. Nothing is deleted: a duplicate, a bad clock, an impossible jump and
              a late arrival are all still here, labelled, with the raw payload they came from
              still on file.
            </CardDescription>
            <div className="flex flex-wrap gap-2">
              {(["accepted", "flagged", "rejected"] as const).map((state) => (
                <Chip
                  key={state}
                  label={state[0].toUpperCase() + state.slice(1)}
                  selected={ingestion.includes(state)}
                  onToggle={() => setIngestion((prev) =>
                    prev.includes(state) ? prev.filter((x) => x !== state) : [...prev, state])}
                />
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {events.isPending ? <LoadingSkeleton /> : <EventsTable events={events.data ?? []} />}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Stat({
  icon: Icon, label, value, hint, tone,
}: {
  icon: typeof Satellite;
  label: string;
  value: number;
  hint?: string;
  tone?: "warning";
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="flex items-center gap-1.5 text-[0.75rem] font-medium text-fg-muted">
        <Icon className="size-3.5 text-fg-subtle" aria-hidden />
        {label}
      </p>
      <p className={cn("tnum mt-1 text-[1.5rem] font-semibold", tone === "warning" ? "text-st-warning" : "text-fg")}>
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-[0.75rem] text-fg-subtle">{hint}</p> : null}
    </div>
  );
}

/**
 * The seven connection states, spelled out.
 *
 * Every one of them carries its reason, because the difference between "stale"
 * and "disconnected" is the difference between somebody needing to go and look
 * at a truck and somebody needing to do nothing at all.
 */
function ConnectionsPanel({ connections }: { connections: readonly EldConnection[] }) {
  return (
    <Card>
      <CardHeader className="flex-col items-start gap-1">
        <CardTitle>Provider connections</CardTitle>
        <CardDescription>
          Each link says what it is doing and why. A link somebody took down reads as
          disconnected rather than as a fault, and a provider that cannot serve a signal
          reads as unsupported rather than as broken.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {connections.length === 0 ? (
          <EmptyState title="No provider connections" />
        ) : (
          <ul className="space-y-2">
            {connections.map((connection) => (
              <li
                key={connection.id}
                className="rounded-md border border-border bg-surface-sunken/40 p-3"
              >
                <p className="flex flex-wrap items-center gap-2">
                  <span className="text-[0.8125rem] font-medium text-fg">{connection.label}</span>
                  <ConnectionStateChip state={connection.state} />
                  <span className="text-[0.6875rem] text-fg-subtle">
                    {TRANSPORT_LABEL[connection.transport]} · expects data every{" "}
                    {connection.freshnessExpectationMinutes} min
                  </span>
                </p>
                {/* The reason this link is in this state, right now — not the
                    generic description of the state, which is the line below. */}
                <p className="mt-1 text-[0.75rem] leading-relaxed text-fg-muted">
                  {connection.stateReason ?? CONNECTION_STATE_DESCRIPTION[connection.state]}
                </p>
                {connection.unsupportedSignals?.length ? (
                  <p className="mt-1 text-[0.6875rem] text-fg-subtle">
                    Cannot serve: {connection.unsupportedSignals.join(", ")}.
                  </p>
                ) : null}
                {connection.stateReason ? (
                  <p className="mt-1 text-[0.6875rem] text-fg-subtle">
                    {CONNECTION_STATE_LABEL[connection.state]} —{" "}
                    {CONNECTION_STATE_DESCRIPTION[connection.state]}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function SharesPanel({
  shares, isDispatchWorkspace,
}: { shares: readonly EldShare[]; isDispatchWorkspace: boolean }) {
  return (
    <Card>
      <CardHeader className="flex-col items-start gap-1">
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="size-4 text-fg-subtle" aria-hidden />
          {isDispatchWorkspace ? "What you have been given" : "What you have shared"}
        </CardTitle>
        <CardDescription>
          Dispatch organizations and individual dispatchers see nothing from this module by
          default. Each grant below names one truck and the classes of signal it covers, and
          it can be revoked.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {shares.length === 0 ? (
          <EmptyState
            title={isDispatchWorkspace ? "Nothing shared with you" : "Nothing shared"}
            description="Telemetry stays with the carrier that collected it until somebody deliberately shares a truck."
          />
        ) : (
          <ul className="space-y-2">
            {shares.map((share) => (
              <li key={share.id} className="rounded-md border border-border bg-surface-sunken/40 p-3">
                <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-fg">
                  <Link href={`/fleet/trucks/${share.truckId}`} className="font-medium hover:underline">
                    One truck
                  </Link>
                  <span className="text-[0.75rem] text-fg-muted">
                    {share.signalClasses.map((c) => SIGNAL_CLASS_LABEL[c]).join(" · ")}
                  </span>
                </p>
                {share.note ? (
                  <p className="mt-1 text-[0.75rem] text-fg-muted">{share.note}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
