"use client";

import { AlertTriangle } from "lucide-react";
import type { TelemetryEvent } from "@/types";
import { ANOMALY_LABEL, SIGNAL_KIND_LABEL } from "@/types";
import { EmptyState } from "@/components/data/states";
import { IngestionChip, QualityChip } from "./chips";
import { INGESTION_DESCRIPTION, formatMeasurement } from "./labels";

/**
 * The normalized event stream, INCLUDING the rows the pipeline did not like.
 *
 * Showing flagged and rejected rows is the point of this table. A pipeline that
 * quietly dropped a duplicate, a jump or an out-of-order signal would leave
 * somebody staring at a gap with no way to find out what happened to it; here
 * the row is present, labelled, and says exactly why it is not being counted.
 *
 * Source time and received time are two columns, never one. A device that was
 * offline all afternoon and flushed its buffer at six o'clock produces rows
 * whose two clocks are hours apart, and collapsing them would make the day look
 * like it happened at six.
 */
export function EventsTable({ events }: { events: readonly TelemetryEvent[] }) {
  if (!events.length) {
    return (
      <EmptyState
        title="No signals"
        description="Nothing has been normalized here yet. Deliveries appear the moment a mock provider sends one."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] border-collapse text-[0.8125rem]">
        <thead>
          <tr className="border-b border-border text-left text-[0.75rem] text-fg-muted">
            <th scope="col" className="py-2 pr-3 font-medium">Signal</th>
            <th scope="col" className="py-2 pr-3 font-medium">Value</th>
            <th scope="col" className="py-2 pr-3 font-medium">Attributed to</th>
            <th scope="col" className="py-2 pr-3 font-medium">Observed by provider</th>
            <th scope="col" className="py-2 pr-3 font-medium">Received</th>
            <th scope="col" className="py-2 font-medium">State</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id} className="border-b border-border/60 align-top">
              <td className="py-2 pr-3 font-medium text-fg">{SIGNAL_KIND_LABEL[event.kind]}</td>
              <td className="py-2 pr-3 text-fg">
                {formatMeasurement(event.value)}
                <span className="mt-1 flex flex-wrap items-center gap-1.5">
                  <QualityChip quality={event.quality} />
                  {event.accuracyMeters != null ? (
                    <span className="text-[0.6875rem] text-fg-subtle">
                      ±{Math.round(event.accuracyMeters)} m
                    </span>
                  ) : null}
                  <span className="text-[0.6875rem] text-fg-subtle">
                    {Math.round(event.confidence * 100)}% confidence
                  </span>
                </span>
              </td>
              <td className="py-2 pr-3 text-fg-muted">
                {/* Attribution as at EVENT time, not as things stand today. */}
                {event.attribution.truckUnitSnapshot
                  ? `Unit ${event.attribution.truckUnitSnapshot}`
                  : "No truck"}
                {event.attribution.driverNameSnapshot ? (
                  <span className="block text-[0.75rem] text-fg-subtle">
                    {event.attribution.driverNameSnapshot}
                  </span>
                ) : null}
                {event.attribution.loadReferenceSnapshot ? (
                  <span className="block text-[0.75rem] text-fg-subtle">
                    Load {event.attribution.loadReferenceSnapshot}
                  </span>
                ) : null}
              </td>
              <td className="py-2 pr-3 tnum text-fg-muted">
                {new Date(event.sourceAt).toLocaleString()}
              </td>
              <td className="py-2 pr-3 tnum text-fg-subtle">
                {new Date(event.receivedAt).toLocaleString()}
              </td>
              <td className="py-2">
                <IngestionChip state={event.ingestion} />
                {event.anomalies.length ? (
                  <ul className="mt-1 space-y-0.5">
                    {event.anomalies.map((a) => (
                      <li
                        key={a}
                        className="flex items-start gap-1 text-[0.6875rem] leading-snug text-fg-muted"
                      >
                        <AlertTriangle className="mt-0.5 size-3 shrink-0 text-st-warning" aria-hidden />
                        {ANOMALY_LABEL[a]}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {event.ingestion !== "accepted" ? (
                  <p className="mt-1 max-w-[18rem] text-[0.6875rem] leading-snug text-fg-subtle">
                    {INGESTION_DESCRIPTION[event.ingestion]}
                  </p>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
