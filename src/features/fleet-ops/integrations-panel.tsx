"use client";

import { PlugZap } from "lucide-react";
import type { FleetIntegrationDescriptor } from "@/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The extension points, stated as what they are.
 *
 * This panel exists so nobody has to guess where the data on this screen comes
 * from. Every row says "not connected", because every row is not connected —
 * there is no ELD, no GPS, no telematics, no fuel card, no toll feed and no
 * state registration lookup behind any number on this dashboard.
 *
 * The alternative — leaving the panel out — reads as though the question had
 * never come up, and somebody would reasonably assume the locations were live.
 */
export function IntegrationsPanel({
  integrations,
}: { integrations: FleetIntegrationDescriptor[] }) {
  return (
    <Card>
      <CardHeader className="flex-col items-start gap-1">
        <CardTitle>Where this data comes from</CardTitle>
        <CardDescription>
          Locations, mileage and engine hours on this screen were typed in by a person or
          seeded as sample data. None of the systems below is connected, and nothing here is
          reading from a device.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2 sm:grid-cols-2">
          {integrations.map((i) => (
            <li
              key={i.kind}
              className="rounded-md border border-dashed border-border bg-surface-sunken/40 p-3"
            >
              <p className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-[0.8125rem] font-medium text-fg">
                  <PlugZap className="size-3.5 text-fg-subtle" aria-hidden />
                  {i.label}
                </span>
                <span className="shrink-0 rounded-full bg-st-neutral-bg px-2 py-0.5 text-[0.6875rem] font-medium text-st-neutral">
                  Not connected
                </span>
              </p>
              <p className="mt-1 text-[0.75rem] leading-relaxed text-fg-muted">{i.description}</p>
              <p className="mt-1.5 text-[0.6875rem] text-fg-subtle">
                Would fill in: {i.wouldPopulate.join(", ")}.
              </p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
