"use client";

import {
  ArrowLeft, Building2, Clock3, FileText, Lock, MapPin, Package, Truck,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { LoadStatusBadge } from "@/components/common/status-badge";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DOCUMENT_KIND_LABEL, EVENT_SOURCE_LABEL, OCR_STATE_LABEL,
  VERIFICATION_STATE_LABEL,
} from "@/config/documents";
import { EQUIPMENT_LABEL } from "@/config/statuses";
import { useActiveMembership, useCan } from "@/lib/session/hooks";
import { dateTimeIn, money, ratePerMile, useNow } from "@/lib/utils";
import {
  destinationStop, missingRequiredDocuments, originStop, type Stop,
} from "@/types";
import { DRIVER_NAMES } from "./driver-names";
import { useLoad, useLoadDocuments, useLoadEvents } from "./hooks";
import { LoadTimeline } from "./timeline";

export function LoadDetail({ loadId }: { loadId: string }) {
  const load = useLoad(loadId);
  const events = useLoadEvents(loadId);
  const documents = useLoadDocuments(loadId);
  const canSeeRates = useCan("rates:view");
  const canSeeDocuments = useCan("documents:view");
  const { organization } = useActiveMembership();
  const now = useNow();

  const orgTz = organization?.timeZone ?? "UTC";

  if (load.isPending) {
    return (
      <div className="space-y-section">
        <Skeleton className="h-9 w-72" />
        <LoadingSkeleton rows={6} />
      </div>
    );
  }

  if (load.isError) {
    return (
      <div className="space-y-stack">
        <Button asChild variant="ghost" size="sm">
          <Link href="/loads">
            <ArrowLeft aria-hidden />
            All loads
          </Link>
        </Button>
        <ErrorState
          title="This load is not available"
          description={
            /not found/i.test(load.error.message)
              ? "It does not exist in this organization, or it is outside what your membership can see."
              : load.error.message
          }
        />
      </div>
    );
  }

  const l = load.data;
  const pickup = originStop(l);
  const delivery = destinationStop(l);
  const missing = missingRequiredDocuments(l);

  const stopLabel = (stopId?: string) => {
    if (!stopId) return undefined;
    const stop = l.stops.find((s) => s.id === stopId);
    if (!stop) return undefined;
    return `${stop.kind === "pickup" ? "Pickup" : "Delivery"} · ${stop.address.city}`;
  };

  return (
    <div className="space-y-section">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link href="/loads">
            <ArrowLeft aria-hidden />
            All loads
          </Link>
        </Button>

        {/* Stable header: identity, status and the lane never move. */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-mono text-[1.5rem] leading-8 font-semibold tracking-[-0.01em] text-fg">
                {l.reference}
              </h1>
              <LoadStatusBadge status={l.status} />
              {l.customerReference ? (
                <Badge tone="outline">Customer ref {l.customerReference}</Badge>
              ) : null}
            </div>
            <p className="mt-1.5 text-[0.9375rem] text-fg-muted">
              {pickup.address.city}, {pickup.address.state}
              <span className="mx-1.5 text-fg-subtle">→</span>
              {delivery.address.city}, {delivery.address.state}
              <span className="mx-1.5 text-fg-subtle">·</span>
              {l.customer.name}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {missing.length > 0 ? (
              <Badge tone="warning">
                {missing.length} document{missing.length > 1 ? "s" : ""} missing
              </Badge>
            ) : (
              <Badge tone="success">Documents complete</Badge>
            )}
          </div>
        </header>
      </div>

      <div className="grid grid-cols-1 gap-stack lg:grid-cols-3">
        <div className="space-y-stack lg:col-span-2">
          {/* Stops and appointments */}
          <Card>
            <CardHeader>
              <CardTitle>Stops and appointments</CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <ol className="divide-y divide-border border-t border-border">
                {l.stops.map((stop) => (
                  <StopRow key={stop.id} stop={stop} now={now} />
                ))}
              </ol>
            </CardContent>
          </Card>

          {/* Timeline */}
          <Card>
            <CardHeader>
              <div className="min-w-0">
                <CardTitle>Timeline</CardTitle>
                <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
                  Every event, whatever interface it came from.
                </p>
              </div>
              <Badge tone="outline">{events.data?.length ?? 0} events</Badge>
            </CardHeader>
            <CardContent className="border-t border-border px-0 pb-0">
              {events.isPending ? (
                <div className="px-5 py-4">
                  <LoadingSkeleton rows={4} />
                </div>
              ) : events.isError ? (
                <div className="px-5 py-4">
                  <ErrorState description={events.error.message} onRetry={() => events.refetch()} />
                </div>
              ) : (
                <LoadTimeline
                  events={events.data}
                  timeZone={orgTz}
                  stopLabel={stopLabel}
                />
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-stack">
          {/* Overview */}
          <Card>
            <CardHeader>
              <CardTitle>Overview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-0 border-t border-border pt-0">
              <Row icon={Building2} label="Customer">
                <span className="text-fg">{l.customer.name}</span>
                <span className="block text-[0.75rem] text-fg-subtle capitalize">
                  {l.customer.kind}
                  {l.customer.mcNumber ? ` · ${l.customer.mcNumber}` : ""}
                </span>
                {l.customer.contact?.name ? (
                  <span className="block text-[0.75rem] text-fg-subtle">
                    {l.customer.contact.name}
                    {l.customer.contact.phone ? ` · ${l.customer.contact.phone}` : ""}
                  </span>
                ) : null}
              </Row>
              <Row icon={Package} label="Equipment">
                <span className="text-fg">{EQUIPMENT_LABEL[l.equipment]}</span>
                {l.weightLbs ? (
                  <span className="block text-[0.75rem] text-fg-subtle">
                    {l.weightLbs.toLocaleString()} lbs
                    {l.commodity ? ` · ${l.commodity}` : ""}
                  </span>
                ) : null}
              </Row>
              <Row icon={Clock3} label="Created">
                <span className="text-fg">{dateTimeIn(l.createdAt, orgTz)}</span>
                <span className="block text-[0.75rem] text-fg-subtle">
                  by {l.createdBy.displayNameSnapshot}
                </span>
              </Row>
            </CardContent>
          </Card>

          {/* Assignment */}
          <Card>
            <CardHeader>
              <CardTitle>Assignment</CardTitle>
            </CardHeader>
            <CardContent className="border-t border-border pt-0">
              {l.assignment ? (
                <>
                  <Row icon={UserRound} label="Driver">
                    <span className="text-fg">
                      {DRIVER_NAMES[l.assignment.driverId ?? ""] ?? "Assigned"}
                    </span>
                  </Row>
                  <Row icon={Truck} label="Truck">
                    <span className="text-fg">
                      {l.assignment.truckId
                        ? `Unit ${l.assignment.truckId.split("_").pop()}`
                        : "Not set"}
                    </span>
                    {l.assignment.carrierOrganizationId ? (
                      <span className="block text-[0.75rem] text-fg-subtle">
                        Runs under a partner carrier&apos;s authority
                      </span>
                    ) : null}
                  </Row>
                  <Row icon={Clock3} label="Driver consent">
                    <ConsentBadge status={l.assignment.consent.status} />
                    {l.assignment.consent.respondedAt ? (
                      <span className="mt-1 block text-[0.75rem] text-fg-subtle">
                        {dateTimeIn(l.assignment.consent.respondedAt, orgTz)}
                      </span>
                    ) : null}
                  </Row>
                </>
              ) : (
                <p className="py-4 text-[0.875rem] text-fg-muted">
                  No truck or driver assigned yet.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Rate — gated at the service, not here */}
          <Card>
            <CardHeader>
              <CardTitle>Rate</CardTitle>
            </CardHeader>
            <CardContent className="border-t border-border pt-0">
              {canSeeRates && l.financials ? (
                <dl className="divide-y divide-border">
                  <Money label="Linehaul" cents={l.financials.linehaulCents} />
                  {l.financials.accessorials.map((a) => (
                    <Money key={a.code} label={a.label} cents={a.amountCents} />
                  ))}
                  <Money label="Total rate" cents={l.financials.totalRateCents} strong />
                  <div className="flex items-baseline justify-between py-2.5">
                    <dt className="text-[0.8125rem] text-fg-muted">Miles</dt>
                    <dd className="tnum text-[0.875rem] text-fg">
                      {l.financials.loadedMiles} loaded · {l.financials.deadheadMiles} deadhead
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between py-2.5">
                    <dt className="text-[0.8125rem] text-fg-muted">Rate per mile</dt>
                    <dd className="tnum text-[0.875rem] font-medium text-fg">
                      {ratePerMile(l.financials.ratePerMileCents)}
                    </dd>
                  </div>
                  {l.financials.driverShareCents ? (
                    <Money label="Driver share" cents={l.financials.driverShareCents} />
                  ) : null}
                </dl>
              ) : (
                <p className="flex items-start gap-2 py-4 text-[0.875rem] text-fg-muted">
                  <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
                  <span>
                    Rate information is not part of this membership. The service
                    omits it entirely — it is not hidden in the page.
                  </span>
                </p>
              )}
            </CardContent>
          </Card>

          {/* Documents */}
          <Card>
            <CardHeader>
              <CardTitle>Documents</CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {!canSeeDocuments ? (
                <p className="border-t border-border px-5 py-4 text-[0.875rem] text-fg-muted">
                  Documents need <code className="font-mono text-[0.8125rem]">documents:view</code>.
                </p>
              ) : documents.isPending ? (
                <div className="border-t border-border px-5 py-4">
                  <LoadingSkeleton rows={2} />
                </div>
              ) : documents.isError ? (
                <div className="border-t border-border px-5 py-4">
                  <ErrorState description={documents.error.message} />
                </div>
              ) : (
                <ul className="divide-y divide-border border-t border-border">
                  {l.documentRequirements.map((req) => {
                    const doc = documents.data.find((d) => d.id === req.satisfiedByDocumentId);
                    return (
                      <li key={req.kind} className="flex items-start gap-3 px-5 py-3">
                        <FileText
                          aria-hidden
                          className={
                            "mt-0.5 size-4 shrink-0 " +
                            (doc ? "text-fg-subtle" : "text-st-warning")
                          }
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[0.875rem] font-medium text-fg">
                            {DOCUMENT_KIND_LABEL[req.kind]}
                          </span>
                          {doc ? (
                            <>
                              <span className="block truncate text-[0.75rem] text-fg-subtle">
                                {doc.fileName} · {EVENT_SOURCE_LABEL[doc.source] ?? doc.source} ·{" "}
                                {dateTimeIn(doc.uploadedAt, orgTz)}
                              </span>
                              <span className="mt-1 flex flex-wrap gap-1.5">
                                <Badge tone="outline">
                                  {VERIFICATION_STATE_LABEL[doc.verification.state]}
                                </Badge>
                                {doc.ocr.state !== "not_applicable" ? (
                                  <Badge tone="neutral">
                                    {OCR_STATE_LABEL[doc.ocr.state]}
                                    {doc.ocr.confidence
                                      ? ` · ${Math.round(doc.ocr.confidence * 100)}%`
                                      : ""}
                                  </Badge>
                                ) : null}
                              </span>
                            </>
                          ) : (
                            <span className="block text-[0.75rem] text-st-warning">
                              Required, not received
                            </span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <p className="text-[0.75rem] text-fg-subtle">
        Read-only. Verification, assignment, status updates and document upload
        are later milestones and are deliberately absent rather than stubbed.
      </p>
    </div>
  );
}

function StopRow({ stop, now }: { stop: Stop; now: number | null }) {
  const late =
    now !== null && !stop.arrivedAt && new Date(stop.appointmentAt).getTime() < now;

  return (
    <li className="flex gap-3.5 px-5 py-4">
      <span className="flex flex-col items-center">
        <span
          aria-hidden
          className={
            "mt-1 size-2.5 rounded-full " +
            (stop.kind === "pickup" ? "bg-fg-subtle" : "bg-primary")
          }
        />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase">
            {stop.kind === "pickup" ? "Pick up" : "Deliver"}
          </span>
          <Badge tone="outline">
            {stop.appointmentType === "fcfs"
              ? "FCFS"
              : stop.appointmentType === "window"
                ? "Window"
                : "Appointment"}
          </Badge>
          {stop.arrivedAt ? (
            <Badge tone="success">Arrived</Badge>
          ) : late ? (
            <Badge tone="danger">Past due</Badge>
          ) : null}
        </div>

        <p className="mt-1 flex items-center gap-1.5 text-[1rem] font-semibold text-fg">
          <MapPin aria-hidden className="size-4 shrink-0 text-fg-subtle" />
          {stop.address.city}, {stop.address.state}
        </p>
        {stop.facilityName ? (
          <p className="text-[0.8125rem] text-fg-muted">{stop.facilityName}</p>
        ) : null}

        <p className="mt-1 text-[0.875rem] text-fg-muted">
          {dateTimeIn(stop.appointmentAt, stop.timeZone)}
          {stop.appointmentEndAt
            ? ` – ${dateTimeIn(stop.appointmentEndAt, stop.timeZone)}`
            : ""}
          <span className="ml-1.5 text-[0.75rem] text-fg-subtle">
            local ({stop.timeZone.split("/").pop()?.replace("_", " ")})
          </span>
        </p>

        {stop.arrivedAt || stop.departedAt ? (
          <p className="mt-1 text-[0.75rem] text-fg-subtle">
            {stop.arrivedAt ? `Arrived ${dateTimeIn(stop.arrivedAt, stop.timeZone)}` : ""}
            {stop.arrivedAt && stop.departedAt ? " · " : ""}
            {stop.departedAt ? `Departed ${dateTimeIn(stop.departedAt, stop.timeZone)}` : ""}
          </p>
        ) : null}

        {stop.instructions ? (
          <p className="mt-2 rounded-md bg-surface-sunken px-3 py-2 text-[0.8125rem] leading-5 text-fg-muted">
            {stop.instructions}
          </p>
        ) : null}

        {stop.referenceNumbers?.length ? (
          <p className="mt-2 flex flex-wrap gap-1.5">
            {stop.referenceNumbers.map((r) => (
              <Badge key={r.label} tone="neutral">
                {r.label} {r.value}
              </Badge>
            ))}
          </p>
        ) : null}

        {stop.contact?.name || stop.contact?.phone ? (
          <p className="mt-2 text-[0.75rem] text-fg-subtle">
            {stop.contact.name}
            {stop.contact.name && stop.contact.phone ? " · " : ""}
            {stop.contact.phone}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function Row({
  icon: Icon, label, children,
}: {
  icon: typeof Clock3;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-border py-3 last:border-0">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
      <div className="min-w-0 flex-1">
        <p className="text-[0.75rem] text-fg-subtle">{label}</p>
        <div className="mt-0.5 text-[0.875rem]">{children}</div>
      </div>
    </div>
  );
}

function Money({
  label, cents, strong,
}: {
  label: string;
  cents: number;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between py-2.5">
      <dt className="text-[0.8125rem] text-fg-muted">{label}</dt>
      <dd
        className={
          "tnum text-[0.875rem] " + (strong ? "font-semibold text-fg" : "text-fg")
        }
      >
        {money(cents)}
      </dd>
    </div>
  );
}

function ConsentBadge({ status }: { status: string }) {
  if (status === "accepted") return <Badge tone="success">Accepted</Badge>;
  if (status === "pending") return <Badge tone="warning">Awaiting driver</Badge>;
  if (status === "declined") return <Badge tone="danger">Declined</Badge>;
  return <Badge tone="neutral">Not required</Badge>;
}
