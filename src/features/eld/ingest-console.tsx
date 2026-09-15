"use client";

import { useMemo, useState } from "react";
import { FlaskConical, Send } from "lucide-react";
import type {
  EldConnection, EldDeviceView, EldIngestionResult, EquipmentTelemetrySnapshot,
} from "@/types";
import { ANOMALY_LABEL, SIGNAL_KIND_LABEL } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  MOCK_SCENARIO_EXPECTATION, MOCK_SCENARIO_LABEL, buildMockDelivery, type MockScenario,
} from "@/lib/eld/mock-console";
import { useIngestDelivery } from "./hooks";
import { IngestionChip } from "./chips";

const SCENARIOS: MockScenario[] = [
  "fresh_position", "duplicate", "impossible_jump", "future_timestamp",
  "invalid_timestamp", "out_of_order", "critical_diagnostic", "hos_summary",
  "unsupported_signal", "unknown_device",
];

/**
 * The developer affordance, and it says so in its title.
 *
 * It exists because the interesting behaviour of this module is what it does
 * with data it does not like, and there is no honest way to demonstrate that
 * without being able to send some. Every button here goes through the SAME
 * `ingest` path a webhook or a file import would use — there is no test-only
 * branch inside the pipeline, which is the only thing that makes this console
 * evidence of anything.
 *
 * It is gated on `eld:ingest`, and the payloads it sends are in a mock
 * provider's format. Nothing is received from anywhere.
 */
export function IngestConsole({
  connections, devices, snapshots,
}: {
  connections: readonly EldConnection[];
  devices: readonly EldDeviceView[];
  /** Used only to start each scenario from where the device actually is. */
  snapshots: readonly EquipmentTelemetrySnapshot[];
}) {
  const ingest = useIngestDelivery();
  const usable = useMemo(
    () => devices.filter((d) => d.device.state !== "disconnected"),
    [devices],
  );
  const [deviceId, setDeviceId] = useState(() => usable[0]?.device.id ?? "");
  const [scenario, setScenario] = useState<MockScenario>("fresh_position");
  const [result, setResult] = useState<EldIngestionResult | null>(null);

  const device = usable.find((d) => d.device.id === deviceId) ?? usable[0];
  const connection = device
    ? connections.find((c) => c.id === device.device.connectionId)
    : undefined;

  const send = () => {
    if (!device || !connection) return;
    // Start from the device's own last known position, so "a normal position"
    // is normal rather than a 200 mph jump out of wherever it was last seen.
    const here = snapshots.find((s) => s.deviceId === device.device.id)?.location.value;
    const delivery = buildMockDelivery({
      providerId: connection.providerId,
      deviceExternalId: device.device.externalRef.externalId,
      scenario,
      origin: here?.latitude != null && here.longitude != null
        ? { latitude: here.latitude, longitude: here.longitude, city: here.city, state: here.state }
        : undefined,
    });
    ingest.mutate(
      {
        connectionId: connection.id,
        transport: delivery.transport,
        body: delivery.body,
        externalId: delivery.externalId,
      },
      { onSuccess: setResult },
    );
  };

  return (
    <Card>
      <CardHeader className="flex-col items-start gap-1">
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="size-4 text-fg-subtle" aria-hidden />
          Mock provider console
        </CardTitle>
        <CardDescription>
          Sends a payload in a simulated provider&apos;s format through the same webhook and
          import boundary a real one would use. Nothing is received from any outside system.
          Use it to watch ingestion refuse a duplicate, a bad clock or an impossible movement —
          and to confirm that the refused row is still on file afterwards.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!device ? (
          <p className="text-[0.8125rem] text-fg-muted">
            No device on a live connection to send to.
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-[0.75rem] font-medium text-fg-muted">Device</span>
                <select
                  value={device.device.id}
                  onChange={(e) => setDeviceId(e.target.value)}
                  className="mt-1 h-control w-full rounded-md border border-border bg-surface px-2 text-[0.8125rem] text-fg"
                >
                  {usable.map((d) => (
                    <option key={d.device.id} value={d.device.id}>
                      {d.device.serialNumber}
                      {d.truckUnit ? ` — unit ${d.truckUnit}` : " — not bound"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[0.75rem] font-medium text-fg-muted">Scenario</span>
                <select
                  value={scenario}
                  onChange={(e) => setScenario(e.target.value as MockScenario)}
                  className="mt-1 h-control w-full rounded-md border border-border bg-surface px-2 text-[0.8125rem] text-fg"
                >
                  {SCENARIOS.map((s) => (
                    <option key={s} value={s}>{MOCK_SCENARIO_LABEL[s]}</option>
                  ))}
                </select>
              </label>
            </div>

            <p className="text-[0.75rem] leading-relaxed text-fg-muted">
              <span className="font-medium text-fg">Expected: </span>
              {MOCK_SCENARIO_EXPECTATION[scenario]}
            </p>

            <Button onClick={send} disabled={ingest.isPending} size="sm">
              <Send className="size-3.5" aria-hidden />
              {ingest.isPending ? "Sending…" : `Send to ${connection?.label ?? "connection"}`}
            </Button>

            {ingest.isError ? (
              <p className="text-[0.8125rem] text-st-danger">
                {(ingest.error as Error).message}
              </p>
            ) : null}

            {result ? (
              <div className="rounded-md border border-border bg-surface-sunken/40 p-3">
                <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-fg">
                  <span className="font-medium">
                    {result.accepted} accepted · {result.flagged} flagged · {result.rejected} rejected
                  </span>
                  <span className="text-[0.6875rem] text-fg-subtle">
                    Raw payload {result.rawPayloadId} stored
                  </span>
                </p>
                {result.deliveryRejectedReason ? (
                  <p className="mt-1 text-[0.75rem] text-st-danger">
                    Delivery refused: {result.deliveryRejectedReason}. The body was stored first,
                    so there is still something to look at.
                  </p>
                ) : null}
                <ul className="mt-2 space-y-1">
                  {result.outcomes.map((o, i) => (
                    <li key={o.eventId ?? `outcome-${i}`} className="flex flex-wrap items-center gap-2">
                      <IngestionChip state={o.state} />
                      <span className="text-[0.75rem] text-fg">
                        {/* A fragment with no signal kind is one of two very
                            different things, and calling both "unreadable"
                            would blame the payload for the provider's
                            capabilities. */}
                        {o.kind
                          ? SIGNAL_KIND_LABEL[o.kind]
                          : o.anomalies.includes("unsupported_signal")
                            ? "Signal this provider does not report"
                            : "Row the adapter could not read"}
                      </span>
                      <span className="text-[0.6875rem] text-fg-subtle">
                        {/* The adapter's own reason first: it names the
                            provider and the capability, where the generic
                            anomaly label only names the category. */}
                        {o.note
                          || o.anomalies.map((a) => ANOMALY_LABEL[a]).join("; ")
                          || "No anomalies"}
                      </span>
                    </li>
                  ))}
                </ul>
                {result.published.length ? (
                  <p className="mt-2 text-[0.6875rem] text-fg-subtle">
                    {result.published.length} signal(s) queued for other modules. Nothing was
                    transmitted.
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
