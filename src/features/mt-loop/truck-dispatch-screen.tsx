"use client";

import {
  AlertTriangle, ArrowLeft, Building2, CircleCheck, Clock3, Container, FileText,
  Lock, MapPin, Phone, Mail, RefreshCw, Truck as TruckIcon, User,
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AUTHORITY_STATUS_LABEL, CONTACT_ROLE_LABEL, CARRIER_DOCUMENT_LABEL,
  DRIVER_AVAILABILITY_LABEL, MT_LOOP_ACTION_LABEL, MT_LOOP_STATUS_LABEL,
  type CarrierView, type DriverView,
} from "@/types";
import type {
  DispatchBlocker, PlannedSection, TruckDispatchWorkspace,
} from "@/lib/api/mock/truck-dispatch-workspace";
import { cn } from "@/lib/utils";
import { useTruckDispatchWorkspace } from "./use-truck-dispatch";

/**
 * One truck's dispatch workspace.
 *
 * Opened by clicking a truck on the MT Loop board. It answers the question a
 * dispatcher actually has at that moment — "what am I working with, and what is
 * stopping me?" — for a person who may be running several carriers at once and
 * should not have to remember which one this truck belongs to.
 *
 * The carrier context is established by the service from the dispatcher's live
 * relationship with that carrier. There is no organization to switch, no second
 * account, and no second login. What the page CANNOT do is show anything the
 * relationship does not entitle the person to: every panel renders only what
 * the service handed it, and the service asked each registry in turn.
 *
 * Blockers lead, because a truck that cannot legally move is not a truck you
 * should be finding a load for.
 */
export function TruckDispatchScreen({ truckId }: { truckId: string }) {
  const query = useTruckDispatchWorkspace(truckId);

  if (query.isPending) {
    return (
      <div className="space-y-section">
        <Skeleton className="h-9 w-72" />
        <LoadingSkeleton rows={6} />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="space-y-section">
        <BackLink />
        <ErrorState
          title="Could not open this truck"
          description={query.error.message}
          onRetry={() => query.refetch()}
        />
      </div>
    );
  }

  if (!query.data) {
    return (
      <div className="space-y-section">
        <BackLink />
        <ErrorState
          title="This truck is not yours to dispatch"
          description="It either does not exist or no carrier has given this workspace access to it. Those two look the same here on purpose."
        />
      </div>
    );
  }

  const w = query.data;

  return (
    <div className="space-y-section">
      <BackLink />

      <PageHeader
        title={`Unit ${w.fleetTruck.unit}`}
        description={`${w.truck.year} ${w.truck.make} ${w.truck.model} · ${w.truck.equipmentType.replace(/_/g, " ")}${w.carrier ? ` · ${w.carrier.displayName}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {w.loopCard ? (
              <Badge tone={w.loopCard.status === "blocked" ? "danger" : "info"}>
                <RefreshCw aria-hidden className="size-3" />
                {MT_LOOP_STATUS_LABEL[w.loopCard.status]}
              </Badge>
            ) : null}
            <Button variant="secondary" size="sm" asChild>
              <Link href={`/fleet/trucks/${w.truck.truckId}`}>Truck record</Link>
            </Button>
          </div>
        }
      />

      <BlockerPanel blockers={w.blockers} />

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        {/* The cycle, then the equipment, then the person on it. The carrier
            sits alongside as the context all three run under. */}
        <div className="space-y-4">
          <LoopPanel w={w} />
          <TruckPanel w={w} />
          <TrailerPanel w={w} />
          <DriverPanel driver={w.driver} problems={w.driverDocumentProblems} />
        </div>
        <div className="space-y-4">
          <CarrierPanel carrier={w.carrier} withheld={w.carrierWithheld} />
        </div>
      </div>

      <PlannedPanel planned={w.planned} loopId={w.loop?.loopId} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function BackLink() {
  return (
    <Link
      href="/home"
      className="inline-flex items-center gap-1.5 text-[0.8125rem] text-fg-muted underline-offset-4 hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <ArrowLeft className="size-3.5" aria-hidden />
      Back to MT Loop
    </Link>
  );
}

function Panel({
  title, icon: Icon, description, count, action, children,
}: {
  title: string;
  icon?: typeof TruckIcon;
  description?: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg">
            {Icon ? <Icon className="size-4 text-fg-subtle" aria-hidden /> : null}
            {title}
            {count !== undefined ? (
              <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[0.6875rem] font-medium tabular-nums text-fg-muted">
                {count}
              </span>
            ) : null}
          </h2>
          {description ? (
            <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Label above, value below. The page is mostly these. */
function Field({ label, value, mono }: { label: string; value?: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.6875rem] font-medium tracking-wide text-fg-subtle uppercase">{label}</dt>
      <dd className={cn("mt-0.5 text-[0.8125rem] text-fg", mono && "font-mono text-[0.75rem]")}>
        {value ?? <span className="text-fg-subtle">Not recorded</span>}
      </dd>
    </div>
  );
}

/** The handful of permissions a driver is ever given, in plain words. */
const DRIVER_PERMISSION_LABEL: Record<string, string> = {
  "loads:view": "See their loads",
  "loads:status:update": "Update load status",
  "documents:view": "See documents",
  "documents:upload": "Upload documents",
  "settlements:view": "See their pay",
};

const EmptyNote = ({ children }: { children: React.ReactNode }) => (
  <p className="rounded-md border border-dashed border-border px-3.5 py-3 text-[0.75rem] leading-relaxed text-fg-muted">
    {children}
  </p>
);

/* -------------------------------------------------------------------------- */
/* Blockers                                                                    */
/* -------------------------------------------------------------------------- */

const OWNER_LABEL: Record<DispatchBlocker["owner"], string> = {
  carrier: "The carrier has to fix this",
  driver: "The driver has to fix this",
  dispatcher: "Yours to sort out",
};

function BlockerPanel({ blockers }: { blockers: DispatchBlocker[] }) {
  if (blockers.length === 0) {
    return (
      <section className="flex items-start gap-2.5 rounded-lg border border-st-success/40 bg-st-success-bg/50 px-4 py-3">
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-st-success" aria-hidden />
        <div>
          <h2 className="text-[0.875rem] font-semibold text-fg">Nothing is standing in the way</h2>
          <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-fg-muted">
            The carrier&rsquo;s authority, the paperwork, the driver and the equipment all check out for
            this truck right now.
          </p>
        </div>
      </section>
    );
  }

  const critical = blockers.filter((b) => b.severity === "critical").length;

  return (
    <section
      aria-labelledby="blockers-heading"
      className={cn(
        "rounded-lg border p-4",
        critical > 0 ? "border-st-danger/45 bg-st-danger-bg/40" : "border-st-warning/45 bg-st-warning-bg/35",
      )}
    >
      <h2 id="blockers-heading" className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg">
        <AlertTriangle className="size-4 text-st-danger" aria-hidden />
        {blockers.length === 1 ? "One thing is in the way" : `${blockers.length} things are in the way`}
      </h2>
      <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
        Every one of these means a load should not be booked on this truck until it is sorted out.
      </p>
      <ul className="mt-3 space-y-2">
        {blockers.map((b) => (
          <li key={b.key} className="rounded-md border border-border bg-surface px-3.5 py-2.5">
            <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium text-fg">
              {b.title}
              <Badge tone={b.severity === "critical" ? "danger" : b.severity === "high" ? "warning" : "neutral"}>
                {b.severity === "critical" ? "Stops everything" : b.severity === "high" ? "Serious" : "Needs a look"}
              </Badge>
            </p>
            <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">{b.detail}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[0.75rem] text-fg-subtle">
              <span>{OWNER_LABEL[b.owner]}</span>
              {b.href ? (
                <Link href={b.href} className="underline underline-offset-4 hover:text-fg">
                  Open it
                </Link>
              ) : null}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* The loop                                                                    */
/* -------------------------------------------------------------------------- */

function LoopPanel({ w }: { w: TruckDispatchWorkspace }) {
  if (!w.loop || !w.loopCard) {
    return (
      <Panel title="MT Loop" icon={RefreshCw} description="The cycle this truck is in.">
        <EmptyNote>
          This truck has no open cycle. One opens by itself the moment it becomes available or is
          expected to go empty.
        </EmptyNote>
      </Panel>
    );
  }

  const loop = w.loop;
  const where = [loop.expectedEmptyCity, loop.expectedEmptyState].filter(Boolean).join(", ");

  return (
    <Panel
      title="MT Loop"
      icon={RefreshCw}
      description="The same cycle, and the same id, from the moment this truck went empty until its next load is delivered and released."
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Status" value={MT_LOOP_STATUS_LABEL[loop.status]} />
        <Field
          label="Responsible"
          value={loop.responsibleName ?? <span className="text-st-warning">Nobody yet</span>}
        />
        <Field label="Empty at" value={where || undefined} />
        <Field
          label="Empty time"
          value={loop.expectedEmptyAt
            ? new Date(loop.expectedEmptyAt).toLocaleString(undefined, {
                month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
              })
            : undefined}
        />
        <Field label="Load on it" value={loop.loadReference} />
        <Field
          label="Opened"
          value={new Date(loop.openedAt).toLocaleString(undefined, {
            month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
          })}
        />
        <div className="col-span-2">
          <Field label="Loop id" value={loop.loopId} mono />
          <p className="mt-1 text-[0.75rem] leading-relaxed text-fg-subtle">
            Permanent. It does not change when the loop is handed over, paused, blocked or covered —
            and every later step of the cycle will hang off it.
          </p>
        </div>
      </dl>

      {w.handoffs.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-[0.75rem] font-semibold text-fg">Who has had it</h3>
          <ol className="mt-2 space-y-2">
            {w.handoffs.map((a) => (
              <li key={a.id} className="rounded-md border border-border bg-surface-sunken px-3 py-2">
                <p className="text-[0.8125rem] text-fg">
                  {a.assigneeName}
                  {a.endedAt ? null : <span className="ml-2 text-[0.75rem] text-st-success">Now</span>}
                </p>
                <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                  {new Date(a.assignedAt).toLocaleString(undefined, {
                    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                  })}
                  {a.assignedByName && a.assignedByMembershipId !== a.membershipId
                    ? ` · given by ${a.assignedByName}`
                    : " · took it themselves"}
                </p>
                {a.endReason ? (
                  <p className="mt-0.5 text-[0.75rem] text-fg-muted">{a.endReason}</p>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {loop.history.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-[0.75rem] font-semibold text-fg">What has happened to it</h3>
          <ol className="mt-2 space-y-1.5">
            {[...loop.history].reverse().slice(0, 10).map((e) => (
              <li key={e.id} className="flex gap-2.5">
                <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-border-strong" />
                <div className="min-w-0">
                  <p className="text-[0.8125rem] text-fg">
                    {MT_LOOP_ACTION_LABEL[e.action]}
                    {e.note ? <span className="text-fg-muted"> · {e.note}</span> : null}
                  </p>
                  <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                    {new Date(e.at).toLocaleString(undefined, {
                      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                    })}
                    {` · ${e.actorName}`}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Truck and trailer                                                           */
/* -------------------------------------------------------------------------- */

function TruckPanel({ w }: { w: TruckDispatchWorkspace }) {
  const t = w.truck;
  const f = w.fleetTruck;
  const specs = t.specs;
  // True only when this workspace is the carrier that actually operates it.
  const ownParameters = w.accessReason === "operating_carrier";

  return (
    <Panel title="The truck" icon={TruckIcon} description="What it is, where it is, and what it can carry.">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Unit" value={f.unit} />
        <Field label="Status" value={f.status.replace(/_/g, " ")} />
        <Field label="Plate" value={`${t.registration.plateNumber} · ${t.registration.plateState}`} />
        <Field
          label="Location"
          value={[f.currentCity, f.currentState].filter(Boolean).join(", ") || undefined}
        />
        <Field label="Payload" value={specs.maxPayloadLbs ? `${specs.maxPayloadLbs.toLocaleString()} lb` : undefined} />
        <Field label="Can tow" value={specs.maxTowableWeightLbs ? `${specs.maxTowableWeightLbs.toLocaleString()} lb` : undefined} />
        {/* These are the OPERATING CARRIER's parameters for this truck, and they
            live on that carrier's relationship. A dispatch workspace does not
            hold one, so showing the fallback would read as the carrier's real
            number — their minimum rate is in the carrier panel instead. */}
        {ownParameters ? (
          <>
            <Field label="Minimum rate" value={`$${(f.minimumRatePerMileCents / 100).toFixed(2)}/mi`} />
            <Field label="Maximum deadhead" value={`${f.maxDeadheadMiles} mi`} />
          </>
        ) : null}
      </dl>

      {ownParameters ? null : (
        <p className="mt-3 text-[0.75rem] leading-relaxed text-fg-subtle">
          The rate and deadhead limits for this truck belong to the carrier that operates it. Theirs
          are under their rules, alongside.
        </p>
      )}

      <div className="mt-4">
        <h3 className="flex items-center gap-1.5 text-[0.75rem] font-semibold text-fg">
          <FileText className="size-3.5 text-fg-subtle" aria-hidden />
          Its paperwork
        </h3>
        {w.truckDocuments.length === 0 ? (
          <p className="mt-1 text-[0.75rem] text-fg-muted">Nothing is on file for this truck.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {w.truckDocuments.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-fg">
                <span>{d.kind.replace(/_/g, " ")}</span>
                <Badge
                  tone={
                    d.status === "approved" ? "success"
                      : d.status === "expiring_soon" || d.status === "pending_review" ? "warning"
                        : d.status === "expired" || d.status === "rejected" || d.status === "missing" ? "danger"
                          : "neutral"
                  }
                >
                  {d.status.replace(/_/g, " ")}
                </Badge>
                {d.expiresAt ? (
                  <span className="text-[0.75rem] text-fg-subtle">
                    {new Date(d.expiresAt).toLocaleDateString()}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {w.truckDocumentProblems.length === 0 ? (
          <p className="mt-2 text-[0.75rem] text-fg-muted">It is all in order.</p>
        ) : null}
      </div>
    </Panel>
  );
}

function TrailerPanel({ w }: { w: TruckDispatchWorkspace }) {
  if (!w.trailerMissing && !w.trailer) {
    return (
      <Panel title="Trailer" icon={Container} description="What is hooked up to this truck.">
        <EmptyNote>
          This is a {w.fleetTruck.equipment.replace(/_/g, " ")}. It does not take a trailer, so there
          is nothing to show here.
        </EmptyNote>
      </Panel>
    );
  }

  if (!w.trailer) {
    return (
      <Panel title="Trailer" icon={Container} description="What is hooked up to this truck.">
        <EmptyNote>
          Nothing is hooked up. This is a tractor, so it needs a trailer before it can take a load.
        </EmptyNote>
      </Panel>
    );
  }

  const tr = w.trailer;
  return (
    <Panel title="Trailer" icon={Container} description="What is hooked up to this truck.">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Unit" value={tr.unit} />
        <Field label="Type" value={tr.trailerType.replace(/_/g, " ")} />
        <Field label="Status" value={tr.status.replace(/_/g, " ")} />
        <Field
          label="Location"
          value={[tr.currentCity, tr.currentState].filter(Boolean).join(", ") || undefined}
        />
      </dl>
      {tr.documentWarnings > 0 ? (
        <p className="mt-3 text-[0.75rem] text-st-warning">
          {tr.documentWarnings} document {tr.documentWarnings === 1 ? "problem" : "problems"} on this
          trailer.
        </p>
      ) : null}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Carrier                                                                     */
/* -------------------------------------------------------------------------- */

function CarrierPanel({ carrier, withheld }: { carrier?: CarrierView; withheld: boolean }) {
  if (!carrier) {
    return (
      <Panel title="The carrier" icon={Building2}>
        <EmptyNote>
          {withheld
            ? "This workspace has no relationship that entitles it to the carrier's record, so none of it is shown."
            : "No carrier record."}
        </EmptyNote>
      </Panel>
    );
  }

  const a = carrier.authority;

  return (
    <Panel
      title="The carrier"
      icon={Building2}
      description="Opened automatically from your relationship with them. You did not have to switch to anything."
      action={
        <Badge tone={carrier.canHaul ? "success" : "danger"}>
          {carrier.canHaul ? <CircleCheck aria-hidden className="size-3" /> : <Lock aria-hidden className="size-3" />}
          {carrier.canHaul ? "Can haul" : "Cannot haul"}
        </Badge>
      }
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Legal name" value={carrier.legalName} />
        <Field label="Authority" value={`${AUTHORITY_STATUS_LABEL[a.status]}${a.kind ? ` · ${a.kind}` : ""}`} />
        <Field label="MC number" value={carrier.mcNumber} />
        <Field label="DOT number" value={carrier.dotNumber} />
        <Field
          label="Last checked"
          value={a.verifiedAt ? new Date(a.verifiedAt).toLocaleDateString() : undefined}
        />
        <Field label="Trucks you dispatch" value={String(carrier.truckCount)} />
      </dl>

      {a.note ? (
        <p className="mt-3 rounded-md border border-border bg-surface-sunken px-3 py-2 text-[0.75rem] leading-relaxed text-fg-muted">
          {a.note}
        </p>
      ) : null}

      {carrier.dispatchNotes ? (
        <div className="mt-4">
          <h3 className="text-[0.75rem] font-semibold text-fg">What they have asked you to know</h3>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">{carrier.dispatchNotes}</p>
        </div>
      ) : null}

      <div className="mt-4">
        <h3 className="text-[0.75rem] font-semibold text-fg">Who to call</h3>
        {carrier.contacts.length === 0 ? (
          <p className="mt-1 text-[0.75rem] text-fg-muted">Nobody is recorded.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {carrier.contacts.map((c) => (
              <li key={c.id} className="rounded-md border border-border bg-surface-sunken px-3 py-2">
                <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium text-fg">
                  {c.name}
                  <Badge tone={c.isPrimary ? "info" : "outline"}>{CONTACT_ROLE_LABEL[c.role]}</Badge>
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.75rem] text-fg-subtle">
                  {c.phone ? (
                    <span className="inline-flex items-center gap-1">
                      <Phone className="size-3" aria-hidden />
                      {c.phone}
                    </span>
                  ) : null}
                  {c.email ? (
                    <span className="inline-flex items-center gap-1">
                      <Mail className="size-3" aria-hidden />
                      {c.email}
                    </span>
                  ) : null}
                  {c.hours ? <span>{c.hours}</span> : null}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4">
        <h3 className="text-[0.75rem] font-semibold text-fg">Their rules</h3>
        {carrier.rules.length === 0 ? (
          <p className="mt-1 text-[0.75rem] text-fg-muted">They have not set any.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {carrier.rules.map((r) => (
              <li key={r.id} className="rounded-md border border-border bg-surface-sunken px-3 py-2">
                <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] font-medium text-fg">
                  {r.label}
                  {r.blocking ? null : <Badge tone="outline">Ask first</Badge>}
                </p>
                <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">{r.detail}</p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-subtle">
          These are recorded so a load can be checked against them. Checking happens in milestone 4;
          today they are here to read.
        </p>
      </div>

      <div className="mt-4">
        <h3 className="text-[0.75rem] font-semibold text-fg">Their paperwork</h3>
        <ul className="mt-2 space-y-1.5">
          {carrier.documents.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-fg">
              <span>{CARRIER_DOCUMENT_LABEL[d.kind]}</span>
              <Badge
                tone={
                  d.status === "approved" ? "success"
                    : d.status === "expiring_soon" ? "warning"
                      : d.status === "expired" || d.status === "rejected" || d.status === "missing" ? "danger"
                        : "neutral"
                }
              >
                {d.status === "missing" ? "not provided" : d.status.replace(/_/g, " ")}
              </Badge>
              {d.expiresAt ? (
                <span className="text-[0.75rem] text-fg-subtle">
                  {new Date(d.expiresAt).toLocaleDateString()}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Driver                                                                      */
/* -------------------------------------------------------------------------- */

function DriverPanel({
  driver, problems,
}: {
  driver?: DriverView;
  problems: TruckDispatchWorkspace["driverDocumentProblems"];
}) {
  if (!driver) {
    return (
      <Panel title="The driver" icon={User}>
        <EmptyNote>
          Nobody is assigned to this truck. A load cannot be dispatched until somebody is.
        </EmptyNote>
      </Panel>
    );
  }

  const p = driver.preferences;
  const av = driver.availability;

  return (
    <Panel
      title="The driver"
      icon={User}
      description={`Through ${driver.carrierName}, as ${driver.engagementType === "owner_operator" ? "an owner-operator" : "a company driver"}.`}
      action={
        <Badge tone={av.status === "available" ? "success" : av.status === "inactive" ? "danger" : "neutral"}>
          {DRIVER_AVAILABILITY_LABEL[av.status]}
        </Badge>
      }
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Name" value={driver.legalName} />
        <Field label="Phone" value={driver.phone} />
        <Field label="Licence" value={`${driver.cdlState} · expires ${new Date(driver.cdlExpiresAt).toLocaleDateString()}`} />
        <Field
          label="Medical card"
          value={
            driver.medicalCardExpiresAt
              ? `Expires ${new Date(driver.medicalCardExpiresAt).toLocaleDateString()}`
              : driver.medicalCardShared
                ? undefined
                // Said precisely: the driver has one, they simply did not give
                // it to this carrier. "Not recorded" would be a different, and
                // wrong, statement about the person.
                : <span className="text-fg-subtle">Not shared with {driver.carrierName}</span>
          }
        />
        <Field
          label="Where they are"
          value={[av.currentCity, av.currentState].filter(Boolean).join(", ") || undefined}
        />
        <Field label="Home terminal" value={av.homeTerminal} />
      </dl>

      {driver.cdlNumber === undefined ? (
        <p className="mt-3 flex items-start gap-1.5 text-[0.75rem] leading-relaxed text-fg-subtle">
          <Lock className="mt-0.5 size-3 shrink-0" aria-hidden />
          The licence number stays with {driver.carrierName}. Dispatch needs to know the licence is
          current and where it is from, never the number itself.
        </p>
      ) : null}

      {av.hoursNote ? (
        <p className="mt-3 inline-flex items-start gap-1.5 text-[0.8125rem] leading-relaxed text-fg-muted">
          <Clock3 className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" aria-hidden />
          {av.hoursNote}
        </p>
      ) : null}

      <div className="mt-4">
        <h3 className="text-[0.75rem] font-semibold text-fg">What they have asked for</h3>
        {p.preferredStates || p.avoidStates || p.maxDaysOut || p.homeBy || p.endorsements || p.notes ? (
          <ul className="mt-2 space-y-1 text-[0.8125rem] text-fg-muted">
            {p.preferredStates?.length ? <li>Prefers {p.preferredStates.join(", ")}</li> : null}
            {p.avoidStates?.length ? <li>Would rather not run {p.avoidStates.join(", ")}</li> : null}
            {p.maxDaysOut ? <li>Up to {p.maxDaysOut} days out</li> : null}
            {p.homeBy ? <li>{p.homeBy}</li> : null}
            {p.endorsements?.length ? <li>Endorsements: {p.endorsements.join(", ")}</li> : null}
            {p.notes ? <li>{p.notes}</li> : null}
          </ul>
        ) : (
          <p className="mt-1 text-[0.75rem] text-fg-muted">They have not asked for anything.</p>
        )}
        <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-subtle">
          Preferences are not rules. A carrier rule stops a load; these are what to know before you
          pick up the phone.
        </p>
      </div>

      <div className="mt-4">
        <h3 className="text-[0.75rem] font-semibold text-fg">What they can do themselves</h3>
        {driver.permissions.length === 0 ? (
          <p className="mt-1 text-[0.75rem] text-fg-muted">
            Nothing. Everything has to be done for them.
          </p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {driver.permissions.map((key) => (
              <li key={key}>
                <Badge tone="outline">{DRIVER_PERMISSION_LABEL[key] ?? key}</Badge>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-subtle">
          Given by {driver.carrierName} when they were taken on. It is what to expect of them — who
          marks a stop arrived, and who has to upload the proof of delivery.
        </p>
      </div>

      <div className="mt-4">
        <h3 className="flex items-center gap-1.5 text-[0.75rem] font-semibold text-fg">
          <FileText className="size-3.5 text-fg-subtle" aria-hidden />
          Their paperwork
        </h3>
        {driver.documents.length === 0 ? (
          <p className="mt-1 text-[0.75rem] text-fg-muted">
            They have not shared any documents with {driver.carrierName}.
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {driver.documents.map((d) => {
              const req = driver.requirements.find((r) => r.key === d.requirementKey);
              return (
                <li key={d.requirementKey} className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-fg">
                  <span>{req?.label ?? d.requirementKey}</span>
                  <Badge
                    tone={
                      d.status === "approved" ? "success"
                        : d.status === "expiring_soon" ? "warning"
                          : d.status === "expired" || d.status === "rejected" ? "danger"
                            : "neutral"
                    }
                  >
                    {d.status.replace(/_/g, " ")}
                  </Badge>
                  {d.expiresAt ? (
                    <span className="text-[0.75rem] text-fg-subtle">
                      {new Date(d.expiresAt).toLocaleDateString()}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-subtle">
          Only what the driver agreed to share with {driver.carrierName}. Anything they held back is
          not shown, and is not counted as missing.
        </p>
        {problems.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {problems.map((pr) => (
              <li key={pr.requirementKey} className="text-[0.75rem] text-st-danger">
                {pr.label}: {pr.rejectionReason ?? pr.status.replace(/_/g, " ")}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* What comes next                                                             */
/* -------------------------------------------------------------------------- */

function PlannedPanel({ planned, loopId }: { planned: PlannedSection[]; loopId?: string }) {
  return (
    <section className="rounded-lg border border-dashed border-border bg-surface-sunken p-4">
      <h2 className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg">
        <MapPin className="size-4 text-fg-subtle" aria-hidden />
        The rest of the cycle is not built yet
      </h2>
      <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">
        These are named rather than mocked up, so nothing on this page pretends to work.
        {loopId ? " Every one of them will hang off this loop's id, which does not change." : ""}
      </p>
      <ol className="mt-3 grid gap-2 sm:grid-cols-2">
        {planned.map((s) => (
          <li key={s.key} className="rounded-md border border-border bg-surface px-3.5 py-2.5">
            <p className="flex items-center gap-2 text-[0.8125rem] font-medium text-fg">
              <span className="rounded-full bg-surface-sunken px-1.5 py-0.5 text-[0.6875rem] tabular-nums text-fg-subtle">
                {s.milestone}
              </span>
              {s.title}
            </p>
            <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">{s.description}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
