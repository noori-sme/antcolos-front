import { PlugZap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { TrackingSignalSourceDescriptor } from "@/types";

/**
 * What is and is not connected.
 *
 * On the board rather than buried, because the honest answer to "why is that
 * truck stale" is usually "because nothing is plugged in yet", and a
 * dispatcher is entitled to read that from the same page as the stale row.
 * Every row below says `not_connected` today.
 */
export function SourcesPanel({ sources }: { sources: TrackingSignalSourceDescriptor[] }) {
  return (
    <section
      aria-labelledby="sources-heading"
      className="rounded-lg border border-border bg-surface p-4 shadow-e1"
    >
      <h2
        id="sources-heading"
        className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg"
      >
        <PlugZap className="size-4 text-fg-subtle" aria-hidden />
        Where positions would come from
      </h2>
      <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
        Each of these is a typed adapter this module already reads through. None of them is
        connected, so nothing on this page came from a device. When one is wired up it registers
        itself and the rows above start moving — no screen changes.
      </p>

      <ul className="mt-3 divide-y divide-border">
        {sources.map((source) => (
          <li key={source.transport} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:gap-4">
            <div className="min-w-0 sm:w-56 sm:shrink-0">
              <p className="flex items-center gap-2 text-[0.8125rem] font-medium text-fg">
                {source.label}
                <Badge tone={source.status === "connected" ? "success" : "outline"}>
                  {source.status === "connected" ? "Connected" : "Not connected"}
                </Badge>
              </p>
              <p className="mt-0.5 text-[0.6875rem] text-fg-subtle">{source.ownedBy}</p>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[0.75rem] leading-relaxed text-fg-muted">{source.description}</p>
              <p className="mt-1 text-[0.6875rem] text-fg-subtle">
                Would populate: {source.wouldPopulate.join(", ")}.
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
