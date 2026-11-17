"use client";

import { ArrowLeft, Phone } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { LoadRecordStatusBadge } from "@/components/common/status-badge";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { milestoneConfirm, milestoneLabel, stopName } from "@/lib/driver-loads/milestones";
import { equipmentLabel, stopWindow } from "@/lib/load-records/format";
import type { DriverLoad, NextMilestone } from "@/types/driver-load";
import type { LoadRecordStop } from "@/types/load-record";
import { DriverAnswerCard } from "./live-trip-answer";
import { DriverLoadDocuments } from "./live-trip-documents";
import { DriverLoadProblems } from "./live-trip-problems";
import { useDriverLoad, useDriverLoadAction, useIntentKeys } from "./hooks";

const TIME = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const isNotFound = (error: Error) => /not found|404/i.test(error.message);

/** One of the driver's loads (F1.4, plan 16): what to do next, where, and the paperwork. */
export function DriverLoadScreen({ loadId }: { loadId: string }) {
  const query = useDriverLoad(loadId);

  if (query.isPending) {
    return (
      <div className="space-y-section">
        <PageHeader title="Load" />
        <LoadingSkeleton rows={4} />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="space-y-section">
        <BackLink />
        <ErrorState
          title={isNotFound(query.error) ? "This load isn't assigned to you" : "Couldn't open this load"}
          description={isNotFound(query.error) ? "Ask dispatch, or go back to your loads." : query.error.message}
          onRetry={isNotFound(query.error) ? undefined : () => void query.refetch()}
        />
      </div>
    );
  }

  const load = query.data;
  return (
    <div className="space-y-section">
      <BackLink />
      <PageHeader title={`Load ${load.brokerLoadNumber}`} actions={<LoadRecordStatusBadge status={load.status} />} />
      {load.status === "driver_assigned" ? <DriverAnswerCard load={load} /> : <NextAction load={load} />}
      <Stops stops={load.stops} />
      <Details load={load} />
      <DriverLoadDocuments load={load} />
      <DriverLoadProblems load={load} />
    </div>
  );
}

function BackLink() {
  return (
    <Button asChild size="sm" variant="ghost" className="-ml-2">
      <Link href="/driver/loads">
        <ArrowLeft aria-hidden />
        My loads
      </Link>
    </Button>
  );
}

/** The one big button: the earliest milestone the load can take now. */
function NextAction({ load }: { load: DriverLoad }) {
  const action = useDriverLoadAction(load.id);
  const keys = useIntentKeys();
  const [next, ...others] = load.nextMilestones;
  if (!next) return null;
  const record = (m: NextMilestone) =>
    action.mutate(
      { action: { kind: "milestone", next: m }, idempotencyKey: keys.keyFor(`${m.milestone}:${m.stopSequence ?? ""}`) },
      { onSuccess: () => keys.clear() },
    );
  return (
    <section aria-labelledby="next-action" className="space-y-2 rounded-lg border border-primary bg-surface px-4 py-3.5 shadow-e1">
      <h2 id="next-action" className="text-[0.75rem] font-medium text-fg-muted">Next</h2>
      <ConfirmDialog
        title={milestoneLabel(next, load.stops)}
        description={milestoneConfirm(next, load.stops)}
        confirmLabel="Record it"
        onConfirm={() => record(next)}
        trigger={
          <Button variant="primary" className="h-12 w-full text-[0.9375rem]" disabled={action.isPending}>
            {action.isPending ? "Saving…" : milestoneLabel(next, load.stops)}
          </Button>
        }
      />
      {others.map((m) => (
        <ConfirmDialog
          key={`${m.milestone}:${m.stopSequence ?? ""}`}
          title={milestoneLabel(m, load.stops)}
          description={milestoneConfirm(m, load.stops)}
          confirmLabel="Record it"
          onConfirm={() => record(m)}
          trigger={
            <Button variant="secondary" className="w-full" disabled={action.isPending}>
              {milestoneLabel(m, load.stops)}
            </Button>
          }
        />
      ))}
      {action.error ? (
        <p role="alert" className="text-[0.8125rem] text-st-danger">{action.error.message}</p>
      ) : null}
    </section>
  );
}

function Stops({ stops }: { stops: LoadRecordStop[] }) {
  return (
    <section aria-labelledby="driver-stops" className="space-y-2.5">
      <h2 id="driver-stops" className="text-[0.9375rem] font-semibold text-fg">Stops</h2>
      <ol className="space-y-2">
        {stops.map((stop) => {
          const address = [stop.addressLine1, `${stop.city}, ${stop.state}`, stop.postalCode].filter(Boolean).join(", ");
          const window = stopWindow(stop);
          return (
            <li key={stop.sequence} className="rounded-lg border border-border bg-surface px-4 py-3 shadow-e1">
              <p className="text-[0.75rem] font-medium uppercase tracking-wide text-fg-muted">
                {stopName(stops, stop.sequence)}
              </p>
              <p className="mt-0.5 text-[0.9375rem] font-medium text-fg">{stop.facilityName ?? address}</p>
              {stop.facilityName ? <p className="text-[0.8125rem] text-fg-muted">{address}</p> : null}
              <p className="mt-1 text-[0.8125rem] text-fg">
                {stop.scheduledDate ? DAY.format(new Date(`${stop.scheduledDate}T00:00:00Z`)) : "Date not set"}
                {window ? ` · ${window}` : ""}
                {stop.appointmentConfirmed ? " · Appointment confirmed" : ""}
              </p>
              <Actuals stop={stop} />
              {stop.contactPhone ? (
                <a
                  href={`tel:${stop.contactPhone}`}
                  className="mt-1 inline-flex items-center gap-1 text-[0.8125rem] text-primary underline-offset-4 hover:underline"
                >
                  <Phone className="size-3.5" aria-hidden />
                  {[stop.contactName, stop.contactPhone].filter(Boolean).join(" · ")}
                </a>
              ) : null}
              {stop.notes ? <p className="mt-1 text-[0.8125rem] text-fg-muted">{stop.notes}</p> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Actuals({ stop }: { stop: LoadRecordStop }) {
  const done = stop.type === "pickup" ? "Loaded" : "Delivered";
  const parts = [
    stop.actualArrivalAt ? `Arrived ${TIME.format(new Date(stop.actualArrivalAt))}` : null,
    stop.actualCompletedAt ? `${done} ${TIME.format(new Date(stop.actualCompletedAt))}` : null,
    stop.actualDepartureAt ? `Left ${TIME.format(new Date(stop.actualDepartureAt))}` : null,
  ].filter(Boolean);
  return parts.length ? <p className="mt-1 text-[0.8125rem] font-medium text-st-success">{parts.join(" · ")}</p> : null;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.75rem] text-fg-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-[0.875rem] text-fg">{children ?? "—"}</dd>
    </div>
  );
}

function Details({ load }: { load: DriverLoad }) {
  return (
    <section aria-labelledby="driver-details" className="rounded-lg border border-border bg-surface px-4 py-4 shadow-e1">
      <h2 id="driver-details" className="sr-only">Details</h2>
      {load.specialInstructions ? (
        <div className="mb-3 border-b border-border pb-3">
          <p className="text-[0.75rem] text-fg-muted">Instructions</p>
          <p className="mt-0.5 whitespace-pre-line text-[0.875rem] text-fg">{load.specialInstructions}</p>
        </div>
      ) : null}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Fact label="Equipment">{equipmentLabel(load.equipmentType)}</Fact>
        <Fact label="Weight">{load.weightLbs !== null ? `${load.weightLbs.toLocaleString("en-US")} lbs` : null}</Fact>
        <Fact label="Commodity">{load.commodity}</Fact>
        <Fact label="References">{load.referenceNumbers.length ? load.referenceNumbers.join(", ") : null}</Fact>
        {load.requiresBrokerRelease ? <Fact label="Broker release">Wait for it after loading</Fact> : null}
      </dl>
    </section>
  );
}
