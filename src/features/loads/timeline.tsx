"use client";

import {
  ArrowRightLeft, CheckCircle2, CircleDot, FileText, MapPin, PackageCheck,
  Radio, Receipt, ScanLine, Send, TriangleAlert, Truck, XCircle,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EVENT_SOURCE_LABEL } from "@/config/documents";
import { dateTimeIn } from "@/lib/utils";
import type { LoadEvent, LoadEventKind } from "@/types";

const LABEL: Record<LoadEventKind, string> = {
  "load.created": "Load created",
  "load.rate_confirmation_received": "Rate confirmation received",
  "load.fields_extracted": "Fields extracted",
  "load.verified": "Verified",
  "load.updated": "Load updated",
  "load.offered": "Offered to driver",
  "load.accepted": "Driver accepted",
  "load.declined": "Driver declined",
  "assignment.created": "Assigned",
  "assignment.changed": "Assignment changed",
  "assignment.removed": "Assignment removed",
  "load.dispatched": "Dispatched",
  "stop.arrived": "Arrived",
  "stop.loading_started": "Loading started",
  "stop.loaded": "Loaded",
  "stop.departed": "Departed",
  "stop.unloading_started": "Unloading started",
  "stop.unloaded": "Unloaded",
  "load.in_transit": "In transit",
  "load.delivered": "Delivered",
  "load.location_reported": "Location reported",
  "load.eta_updated": "ETA updated",
  "exception.delay_reported": "Delay reported",
  "exception.detention_started": "Detention started",
  "exception.detention_ended": "Detention ended",
  "exception.problem_reported": "Problem reported",
  "document.uploaded": "Document uploaded",
  "document.verified": "Document verified",
  "document.rejected": "Document rejected",
  "load.ready_to_invoice": "Ready to invoice",
  "load.invoiced": "Invoiced",
  "load.paid": "Paid",
  "load.settled": "Settled",
  "load.cancelled": "Cancelled",
};

const ICON: Partial<Record<LoadEventKind, LucideIcon>> = {
  "load.created": CircleDot,
  "load.rate_confirmation_received": FileText,
  "load.fields_extracted": ScanLine,
  "load.verified": CheckCircle2,
  "load.offered": Send,
  "load.accepted": CheckCircle2,
  "load.declined": XCircle,
  "assignment.created": Truck,
  "assignment.changed": ArrowRightLeft,
  "load.dispatched": Send,
  "stop.arrived": MapPin,
  "stop.loaded": PackageCheck,
  "stop.departed": Truck,
  "stop.unloaded": PackageCheck,
  "load.in_transit": Truck,
  "load.delivered": CheckCircle2,
  "load.location_reported": Radio,
  "load.eta_updated": TriangleAlert,
  "exception.detention_started": TriangleAlert,
  "exception.delay_reported": TriangleAlert,
  "exception.problem_reported": TriangleAlert,
  "document.uploaded": FileText,
  "load.ready_to_invoice": Receipt,
  "load.invoiced": Receipt,
  "load.paid": CheckCircle2,
  "load.cancelled": XCircle,
};

function isException(kind: LoadEventKind) {
  return kind.startsWith("exception.") || kind === "load.cancelled" || kind === "load.declined";
}

/**
 * The execution record. Telegram, the driver portal, an ELD and the office all
 * append here, which is why every entry names its source.
 */
export function LoadTimeline({
  events, timeZone, stopLabel,
}: {
  events: LoadEvent[];
  timeZone: string;
  stopLabel: (stopId?: string) => string | undefined;
}) {
  if (events.length === 0) {
    return (
      <p className="px-5 py-8 text-[0.875rem] text-fg-muted">
        Nothing has happened on this load yet.
      </p>
    );
  }

  return (
    <ol className="relative px-5 py-4">
      <span
        aria-hidden
        className="absolute top-6 bottom-6 left-[1.8125rem] w-px bg-border"
      />
      {events.map((event) => {
        const Icon = ICON[event.kind] ?? CircleDot;
        const exception = isException(event.kind);
        const stop = stopLabel(event.payload?.stopId);
        return (
          <li key={event.id} className="relative flex gap-3.5 pb-5 last:pb-0">
            <span
              className={
                "z-10 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border " +
                (exception
                  ? "border-st-danger/40 bg-st-danger-bg text-st-danger"
                  : "border-border bg-surface text-fg-subtle")
              }
            >
              <Icon aria-hidden className="size-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[0.875rem] font-medium text-fg">
                  {LABEL[event.kind]}
                </span>
                {stop ? <Badge tone="outline">{stop}</Badge> : null}
                <Badge tone={event.source === "telegram" ? "info" : "neutral"}>
                  {EVENT_SOURCE_LABEL[event.source] ?? event.source}
                </Badge>
              </span>
              {event.payload?.note ? (
                <span className="mt-1 block text-[0.8125rem] leading-5 text-fg-muted">
                  {event.payload.note}
                </span>
              ) : null}
              {event.payload?.etaAt ? (
                <span className="mt-1 block text-[0.8125rem] text-fg-muted">
                  New ETA {dateTimeIn(event.payload.etaAt, timeZone)}
                </span>
              ) : null}
              {event.payload?.durationMinutes ? (
                <span className="mt-1 block text-[0.8125rem] text-fg-muted">
                  {Math.floor(event.payload.durationMinutes / 60)}h{" "}
                  {event.payload.durationMinutes % 60}m
                </span>
              ) : null}
              <span className="mt-1 block text-[0.75rem] text-fg-subtle">
                {dateTimeIn(event.occurredAt, timeZone)} ·{" "}
                {event.actor.displayNameSnapshot}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
