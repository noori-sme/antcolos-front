"use client";

import { ChevronDown, Plug, Radio } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { integrations, integrationsAreMocked } from "@/lib/integrations";
import { useServiceContext } from "@/lib/api/use-service-context";
import { dateTimeIn } from "@/lib/utils";
import type { DriverWorkflowView } from "@/types";
import { useIngestSignals, useIntegrationStatus, usePendingHandoffs } from "./hooks";

/**
 * What is actually connected, and what this trip has produced for modules that
 * do not exist yet.
 *
 * It is on the screen rather than in a README because a driver-facing product
 * that quietly implies its integrations work is worse than one that says
 * plainly which parts are placeholders. When the real adapters land this panel
 * reports them as real without a line changing here.
 */
export function IntegrationPanel({ view }: { view: DriverWorkflowView }) {
  const [open, setOpen] = useState(false);
  const status = useIntegrationStatus();
  const handoffs = usePendingHandoffs();
  const ingest = useIngestSignals();
  const ctx = useServiceContext();
  const mocked = integrationsAreMocked();

  const forThisTrip = (handoffs.data ?? []).filter((h) =>
    h.refs.some((r) => r.entityId === view.workflow.loadId),
  );

  async function simulateGeofence() {
    if (!ctx || !integrations.signals.simulate) return;
    const next = view.milestones.find((m) => m.state === "not_reached" || m.state === "skipped");
    if (!next) return;
    await integrations.signals.simulate({
      organizationId: ctx.organizationId,
      loadId: view.workflow.loadId,
      suggests: { kind: "milestone", value: next.kind },
      confidence: 0.76,
      observedAt: new Date().toISOString(),
      source: "geofence",
      rationale: "Simulated geofence crossing from the mock telematics adapter.",
    });
    ingest.mutate(view.workflow.id);
  }

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <Plug aria-hidden className="size-4 text-fg-subtle" />
            Connections
          </CardTitle>
          <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
            {mocked
              ? "Every outside module is a labelled placeholder on this branch. Nothing is sent anywhere."
              : "Live adapters are in use."}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Hide" : "Show"}
          <ChevronDown
            aria-hidden
            className={open ? "rotate-180 transition-transform" : "transition-transform"}
          />
        </Button>
      </CardHeader>

      {open ? (
        <CardContent className="space-y-5">
          <section>
            <h3 className="text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase">
              Modules this workflow talks to
            </h3>
            <ul className="mt-2 space-y-1.5">
              {(status.data ?? []).map((s) => (
                <li
                  key={`${s.module}-${s.adapter}`}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-md bg-surface-sunken px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-[0.875rem] font-medium text-fg">
                      {s.module.replace(/_/g, " ")}
                    </p>
                    <p className="mt-0.5 text-[0.75rem] text-fg-muted">{s.note}</p>
                    <p className="mt-0.5 text-[0.75rem] text-fg-subtle">Owned by {s.ownedBy}</p>
                  </div>
                  <Badge tone={s.mock ? "warning" : "success"}>
                    {s.mock ? "Placeholder" : "Connected"}
                  </Badge>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase">
              Queued for other modules from this trip
            </h3>
            {forThisTrip.length === 0 ? (
              <p className="mt-2 text-[0.8125rem] text-fg-muted">Nothing queued yet.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {forThisTrip.map((h) => (
                  <li key={h.id} className="rounded-md bg-surface-sunken px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[0.8125rem] text-fg">{h.operation}</span>
                      <Badge tone="outline">→ {h.target.replace(/_/g, " ")}</Badge>
                      <Badge tone="warning">Waiting</Badge>
                    </div>
                    <p className="mt-1 text-[0.75rem] text-fg-muted">{h.stateReason}</p>
                    <p className="mt-0.5 font-mono text-[0.6875rem] text-fg-subtle">
                      key {h.idempotencyKey} · {dateTimeIn(h.createdAt, "UTC")}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {mocked && integrations.signals.simulate && view.workflow.status === "active" ? (
            <section className="border-t border-border pt-4">
              <h3 className="text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase">
                Simulate a signal
              </h3>
              <p className="mt-1 text-[0.8125rem] text-fg-muted">
                Stands in for GPS, geofencing, ELD and telematics until those land. Whatever it
                suggests is recorded as inferred, with its source and confidence — never as
                something you did.
              </p>
              <Button
                variant="secondary"
                className="mt-3"
                disabled={ingest.isPending}
                onClick={simulateGeofence}
              >
                <Radio aria-hidden />
                {ingest.isPending ? "Reading…" : "Simulate a geofence crossing"}
              </Button>
            </section>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}
