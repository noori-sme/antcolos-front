"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { LoadRecordStatusBadge } from "@/components/common/status-badge";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { equipmentLabel, money, routeSummary, stopWindow } from "@/lib/load-records/format";
import type { LoadRecord, LoadRecordStop } from "@/types/load-record";
import { useLoadRecord } from "./hooks";
import { LiveLoadActions } from "./live-load-actions";
import { LiveLoadTimeline } from "./live-load-timeline";

const SINCE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const DAY = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const isNotFound = (error: Error) => /not found|404/i.test(error.message);

/** One load on the real API: facts, stops, actions and timeline (F1.2, plan 14). */
export function LiveLoadDetail({ loadId }: { loadId: string }) {
  const query = useLoadRecord(loadId);

  if (query.isPending) {
    return (
      <div className="space-y-section">
        <PageHeader title="Load" />
        <LoadingSkeleton rows={5} />
      </div>
    );
  }
  if (query.isError && !query.data) {
    return (
      <div className="space-y-section">
        <PageHeader title="Load" />
        {isNotFound(query.error) ? (
          <ErrorState
            title="This load doesn't exist or isn't in this organization"
            description="Check the link, or find it in the loads list."
          />
        ) : (
          <ErrorState
            title="Couldn't open this load"
            description={query.error.message}
            onRetry={() => void query.refetch()}
          />
        )}
        <BackLink />
      </div>
    );
  }

  const load = query.data!;
  return (
    <div className="space-y-section">
      <BackLink />
      <PageHeader
        title={`Load ${load.brokerLoadNumber}`}
        description={`${load.brokerName} · ${routeSummary(load.stops)}`}
        actions={<LoadRecordStatusBadge status={load.status} />}
      />
      <p className="-mt-3 text-[0.8125rem] text-fg-muted">
        In this status since{" "}
        <time dateTime={load.statusChangedAt}>{SINCE.format(new Date(load.statusChangedAt))}</time>
        {load.status === "cancelled" && load.cancelReason ? ` · “${load.cancelReason}”` : ""}
      </p>

      <LiveLoadActions load={load} />

      <div className="grid gap-section lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0 space-y-section">
          <Facts load={load} />
          <Stops stops={load.stops} />
        </div>
        <div className="min-w-0">
          <LiveLoadTimeline loadId={load.id} />
        </div>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Button asChild size="sm" variant="ghost" className="-ml-2">
      <Link href="/loads">
        <ArrowLeft aria-hidden />
        All loads
      </Link>
    </Button>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.75rem] text-fg-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-[0.875rem] text-fg">{children ?? "—"}</dd>
    </div>
  );
}

function Facts({ load }: { load: LoadRecord }) {
  const contact = [load.brokerContactName, load.brokerPhone, load.brokerEmail].filter(Boolean).join(" · ");
  return (
    <section
      aria-labelledby="load-facts"
      className="rounded-lg border border-border bg-surface px-4 py-4 shadow-e1"
    >
      <h2 id="load-facts" className="sr-only">
        Details
      </h2>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Fact label="Broker">{load.brokerName}</Fact>
        <Fact label="Broker MC">{load.brokerMcNumber}</Fact>
        <Fact label="Rate">{money(load.rateTotal)}</Fact>
        <Fact label="Equipment">{equipmentLabel(load.equipmentType)}</Fact>
        <Fact label="Weight">{load.weightLbs !== null ? `${load.weightLbs.toLocaleString("en-US")} lbs` : null}</Fact>
        <Fact label="Commodity">{load.commodity}</Fact>
        <Fact label="Miles">{load.totalMiles !== null ? load.totalMiles.toLocaleString("en-US") : null}</Fact>
        <Fact label="References">{load.referenceNumbers.length ? load.referenceNumbers.join(", ") : null}</Fact>
        <Fact label="Broker contact">{contact || null}</Fact>
        {load.requiresBrokerRelease ? <Fact label="Broker release">Required after loading</Fact> : null}
        {load.tonuAmount ? <Fact label="TONU">{money(load.tonuAmount)}</Fact> : null}
      </dl>
      {load.specialInstructions ? (
        <div className="mt-4 border-t border-border pt-3">
          <p className="text-[0.75rem] text-fg-muted">Special instructions</p>
          <p className="mt-0.5 whitespace-pre-line text-[0.875rem] text-fg">{load.specialInstructions}</p>
        </div>
      ) : null}
    </section>
  );
}

function Stops({ stops }: { stops: LoadRecordStop[] }) {
  return (
    <section aria-labelledby="load-stops" className="space-y-2.5">
      <h2 id="load-stops" className="text-[0.9375rem] font-semibold text-fg">
        Stops
      </h2>
      <ol className="space-y-2">
        {stops.map((stop, index) => {
          // "Pickup 1", "Delivery 1": numbered within their type, as on the Rate Con.
          const ordinal = stops.slice(0, index + 1).filter((s) => s.type === stop.type).length;
          const address = [stop.addressLine1, `${stop.city}, ${stop.state}`, stop.postalCode]
            .filter(Boolean)
            .join(", ");
          const window = stopWindow(stop);
          return (
            <li
              key={stop.sequence}
              className="rounded-lg border border-border bg-surface px-4 py-3 shadow-e1"
            >
              <p className="text-[0.75rem] font-medium uppercase tracking-wide text-fg-muted">
                {stop.type === "pickup" ? "Pickup" : "Delivery"} {ordinal}
              </p>
              <p className="mt-0.5 text-[0.9375rem] font-medium text-fg">{stop.facilityName ?? address}</p>
              {stop.facilityName ? <p className="text-[0.8125rem] text-fg-muted">{address}</p> : null}
              <p className="mt-1 text-[0.8125rem] text-fg">
                {stop.scheduledDate ? DAY.format(new Date(`${stop.scheduledDate}T00:00:00Z`)) : "Date not set"}
                {window ? ` · ${window}` : ""}
                {stop.appointmentConfirmed ? " · Appointment confirmed" : ""}
              </p>
              {stop.contactName || stop.contactPhone ? (
                <p className="text-[0.8125rem] text-fg-muted">
                  {[stop.contactName, stop.contactPhone].filter(Boolean).join(" · ")}
                </p>
              ) : null}
              {stop.notes ? <p className="mt-1 text-[0.8125rem] text-fg-muted">{stop.notes}</p> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
