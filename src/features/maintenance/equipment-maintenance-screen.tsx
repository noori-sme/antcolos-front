"use client";

import { ArrowLeft, LoaderCircle, Lock, ShieldAlert, Wrench } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Can } from "@/components/auth/can";
import { EmptyState, LoadingSkeleton } from "@/components/data/states";
import { useCan } from "@/lib/session/hooks";
import { useNow } from "@/lib/utils/use-now";
import {
  DEFECT_AREA_LABEL, MAINTENANCE_CATEGORY_LABEL, MAINTENANCE_METER_SOURCE_LABEL,
  formatDowntime, formatEngineHours, formatMaintenanceDate,
  formatMaintenanceDateTime, formatMiles, formatMoney,
} from "@/lib/maintenance/labels";
import {
  equipmentAccess, equipmentSummary, listDefects, listRepairOrders,
  listRequirements, listServiceHistory, meterFor, openRepairOrder,
  recordCompletedService, recordMeterReading, returnToService,
  updateDefectState, updateRepairOrderStatus, activeHold,
  type ServiceHistoryEntry,
} from "@/lib/api/mock/maintenance-registry";
import type {
  EquipmentMeter, EquipmentServiceHold, MaintenanceEquipmentKind,
  MaintenanceEquipmentSummary, MaintenanceRequirementView, RepairOrder,
  ReportedDefect,
} from "@/types";
import {
  AvailabilityImpactChip, CriticalityChip, DefectSeverityChip, DefectStateChip,
  MaintenanceStateChip, RepairOrderStatusChip, StaleMeterChip, TriggerChip,
} from "./chips";
import { useMaintenanceContext } from "./use-maintenance-context";
import { cn } from "@/lib/utils";

const TABS = [
  ["schedule", "Service schedule"],
  ["defects", "Defects"],
  ["repairs", "Repair orders"],
  ["history", "Service history"],
] as const;
type Tab = (typeof TABS)[number][0];

/** Everything one load of this screen produces, resolved together. */
interface EquipmentView {
  allowed: "operator" | "driver";
  equipment: MaintenanceEquipmentSummary;
  requirements: MaintenanceRequirementView[];
  defects: ReportedDefect[];
  orders: RepairOrder[];
  history: ServiceHistoryEntry[];
  meter?: EquipmentMeter;
  hold?: EquipmentServiceHold;
}

/**
 * One machine's maintenance.
 *
 * An unknown id and equipment belonging to somebody else produce exactly the
 * same screen, because telling the two apart would turn the URL into a way of
 * probing other carriers' fleets.
 */
export function EquipmentMaintenanceScreen({
  equipmentKind, equipmentId,
}: {
  equipmentKind: MaintenanceEquipmentKind;
  equipmentId: string;
}) {
  const ctx = useMaintenanceContext();
  const uid = useId();
  const ref = { kind: equipmentKind, equipmentId };

  const [tab, setTab] = useState<Tab>("schedule");
  // Null until the first load resolves; "denied" when the caller has no
  // relationship with the equipment. The effect sets neither synchronously.
  const [view, setView] = useState<EquipmentView | null | "denied">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canManage = useCan("maintenance:manage");

  const load = useCallback(() => {
    if (!ctx) return;
    let cancelled = false;

    const access = equipmentAccess(ref, ctx);
    if (access === null) {
      // Resolved rather than set inline, so this is not a synchronous setState
      // inside the effect body.
      Promise.resolve().then(() => { if (!cancelled) setView("denied"); });
      return () => { cancelled = true; };
    }
    const allowed = access.kind === "operator" ? "operator" as const : "driver" as const;

    Promise.all([
      listRequirements(ctx, { equipment: ref }),
      listDefects(ctx, { equipment: ref }),
      listRepairOrders(ctx, { equipment: ref }),
      listServiceHistory(ref, ctx),
    ]).then(([requirements, defects, orders, history]) => {
      if (cancelled) return;
      setView({
        allowed,
        equipment: equipmentSummary(ref, ctx),
        requirements, defects, orders, history,
        meter: meterFor(ref),
        hold: activeHold(ref),
      });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, equipmentKind, equipmentId]);

  useEffect(() => load(), [load]);

  async function run(fn: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fn();
      setMessage(success);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!ctx || view === null) return <LoadingSkeleton rows={6} />;

  if (view === "denied") {
    return (
      <div className="space-y-section">
        <PageHeader title="Not found" description="This equipment does not exist, or you have no relationship with it." />
        <EmptyState
          icon={Wrench}
          title="No maintenance record here"
          description="Either the equipment does not exist or your organization has no current relationship with it. Access follows relationships, so it can change when one ends."
          action={
            <Button variant="secondary" asChild>
              <Link href="/maintenance"><ArrowLeft aria-hidden />Back to maintenance</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const { allowed, equipment, requirements, defects, orders, history, meter, hold } = view;

  return (
    <div className="space-y-section">
      <PageHeader
        title={`${equipment.unit} · Maintenance`}
        description={`${equipment.typeLabel}. Everything here is attached to the equipment's permanent record, not to your relationship with it.`}
        actions={
          <Button variant="secondary" asChild>
            <Link href={equipment.href}>Open equipment profile</Link>
          </Button>
        }
      />

      {hold ? (
        <section className="rounded-lg border border-st-danger/40 bg-st-danger-bg/40 p-4">
          <p className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg">
            <ShieldAlert aria-hidden className="size-4 text-st-danger" />
            Out of service since {formatMaintenanceDate(hold.placedAt)}
          </p>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">{hold.reason}</p>
          <p className="mt-1 text-[0.75rem] text-fg-subtle">
            Placed by {hold.placedBy.displayNameSnapshot}
          </p>
          {allowed === "operator" ? (
            <Can permission="maintenance:outofservice:manage">
              <ReturnToServiceControl
                uid={uid}
                busy={busy}
                onSubmit={(note) =>
                  run(() => returnToService(ref, note, ctx), "Returned to service.")
                }
              />
            </Can>
          ) : null}
        </section>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-md border border-st-danger/40 bg-st-danger-bg/50 px-3.5 py-2.5 text-[0.8125rem] text-fg">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="rounded-md border border-st-success/40 bg-st-success-bg/50 px-3.5 py-2.5 text-[0.8125rem] text-fg">
          {message}
        </p>
      ) : null}

      <MeterPanel
        uid={uid}
        meter={meter}
        busy={busy}
        canRecord={allowed === "operator" && canManage}
        onRecord={(reading) =>
          run(() => recordMeterReading(ref, reading, ctx), "Reading recorded.")
        }
      />

      {allowed === "driver" ? (
        <p className="rounded-md border border-st-info/35 bg-st-info-bg/40 px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-fg-muted">
          You are seeing this as the driver assigned to this equipment: the faults reported on it
          and the fact that it has been serviced. The service schedule, repair orders and costs
          belong to the carrier running it.
        </p>
      ) : null}

      <div role="tablist" aria-label="Maintenance sections" className="flex flex-wrap gap-1.5">
        {TABS.map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-[0.75rem] font-medium transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              tab === value
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "schedule" ? (
        requirements.length === 0 ? (
          <EmptyState
            icon={Wrench}
            title="No service schedule"
            description={
              allowed === "driver"
                ? "The service schedule belongs to the carrier running this equipment."
                : "Nothing has been scheduled for this equipment yet."
            }
          />
        ) : (
          <ul className="space-y-2">
            {requirements.map((view) => (
              <li key={view.requirement.id} className="rounded-lg border border-border bg-surface px-4 py-3 shadow-e1">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                  <p className="text-[0.875rem] font-medium text-fg">{view.requirement.title}</p>
                  <p className={cn(
                    "text-[0.8125rem] font-medium",
                    view.state === "overdue" ? "text-st-danger" : "text-fg-muted",
                  )}>
                    {view.due.label}
                  </p>
                </div>
                {view.requirement.description ? (
                  <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">
                    {view.requirement.description}
                  </p>
                ) : null}
                <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[0.75rem] text-fg-subtle">
                  <MaintenanceStateChip state={view.state} />
                  <TriggerChip kind={view.requirement.trigger.kind} />
                  <CriticalityChip criticality={view.requirement.criticality} />
                  <span>{MAINTENANCE_CATEGORY_LABEL[view.requirement.category]}</span>
                  {view.responsibleName ? <span>· {view.responsibleName}</span> : null}
                  {view.due.meterStale ? <StaleMeterChip /> : null}
                </p>
                {view.due.unknown ? (
                  <p className="mt-2 rounded-md border border-st-warning/35 bg-st-warning-bg/40 px-3 py-2 text-[0.75rem] text-fg">
                    This cannot be worked out until somebody records a reading. It is not overdue
                    and it is not fine — nobody knows.
                  </p>
                ) : null}
                {view.requirement.deferral ? (
                  <p className="mt-2 rounded-md border border-st-info/35 bg-st-info-bg/40 px-3 py-2 text-[0.75rem] text-fg">
                    Deferred by {view.requirement.deferral.deferredBy.displayNameSnapshot}:{" "}
                    {view.requirement.deferral.reason}
                    {view.requirement.deferral.until
                      ? ` Runs out ${formatMaintenanceDate(view.requirement.deferral.until)}.`
                      : ""}
                  </p>
                ) : null}
                {allowed === "operator" && view.state !== "completed" && !view.requirement.activeRepairOrderId ? (
                  <Can permission="maintenance:repairs:manage">
                    <div className="mt-3">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          run(
                            () => openRepairOrder({
                              equipment: ref,
                              title: view.requirement.title,
                              requirementIds: [view.requirement.id],
                            }, ctx),
                            "Repair order opened.",
                          )
                        }
                      >
                        {busy ? <LoaderCircle aria-hidden className="animate-spin" /> : null}
                        Open a repair order
                      </Button>
                    </div>
                  </Can>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}

      {tab === "defects" ? (
        defects.length === 0 ? (
          <EmptyState icon={Wrench} title="Nothing reported" description="No defect has been reported on this equipment." />
        ) : (
          <ul className="space-y-2">
            {defects.map((defect) => (
              <li key={defect.id} className="rounded-lg border border-border bg-surface px-4 py-3 shadow-e1">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                  <p className="text-[0.875rem] font-medium text-fg">{defect.summary}</p>
                  <p className="text-[0.75rem] text-fg-subtle">{formatMaintenanceDateTime(defect.reportedAt)}</p>
                </div>
                {defect.detail ? (
                  <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">{defect.detail}</p>
                ) : null}
                <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[0.75rem] text-fg-subtle">
                  <DefectSeverityChip severity={defect.severity} />
                  <AvailabilityImpactChip impact={defect.availabilityImpact} />
                  <DefectStateChip state={defect.state} />
                  <span>{DEFECT_AREA_LABEL[defect.area]}</span>
                  <span>· {defect.reportedByName}</span>
                </p>
                {defect.meterAtReport?.odometerMiles !== undefined ? (
                  <p className="mt-1 text-[0.75rem] text-fg-subtle">
                    Odometer at report: {formatMiles(defect.meterAtReport.odometerMiles)} (entered by hand)
                  </p>
                ) : null}

                <HistoryTrail entries={defect.history} />

                {allowed === "operator" && defect.state !== "resolved" && defect.state !== "dismissed" ? (
                  <Can permission="maintenance:defects:manage">
                    <DefectActions
                      uid={`${uid}-${defect.id}`}
                      busy={busy}
                      onAcknowledge={() =>
                        run(() => updateDefectState(defect.id, "acknowledged", undefined, ctx), "Defect acknowledged.")
                      }
                      onResolve={(note) =>
                        run(() => updateDefectState(defect.id, "resolved", note, ctx), "Defect resolved.")
                      }
                    />
                  </Can>
                ) : null}

                {defect.resolutionNote ? (
                  <p className="mt-2 rounded-md border border-st-success/30 bg-st-success-bg/40 px-3 py-2 text-[0.75rem] text-fg">
                    {defect.resolutionNote}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}

      {tab === "repairs" ? (
        orders.length === 0 ? (
          <EmptyState icon={Wrench} title="No repair orders" description="Nothing has been raised for this equipment." />
        ) : (
          <ul className="space-y-2">
            {orders.map((order) => (
              <li key={order.id} className="rounded-lg border border-border bg-surface px-4 py-3 shadow-e1">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                  <p className="text-[0.875rem] font-medium text-fg">
                    <span className="font-mono text-[0.8125rem] text-fg-muted">{order.number}</span>
                    {" · "}{order.title}
                  </p>
                  <RepairOrderStatusChip status={order.status} />
                </div>
                <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.75rem] text-fg-subtle">
                  {order.vendor ? <span>{order.vendor.name}</span> : <span>No vendor yet</span>}
                  <span>Opened {formatMaintenanceDate(order.openedAt)}</span>
                  {order.scheduledFor ? <span>Booked {formatMaintenanceDate(order.scheduledFor)}</span> : null}
                  {order.responsibleName ? <span>{order.responsibleName}</span> : null}
                  {order.downtime.hours !== undefined ? <span>{formatDowntime(order.downtime.hours)} down</span> : null}
                </p>
                {order.cost.estimate || order.cost.actual ? (
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-4 text-[0.75rem] text-fg-muted">
                    {order.cost.estimate ? <span>Estimate {formatMoney(order.cost.estimate)}</span> : null}
                    {order.cost.actual ? <span>Actual {formatMoney(order.cost.actual)}</span> : null}
                  </p>
                ) : null}
                {order.lines.length > 0 && order.cost.actual ? (
                  <ul className="mt-2 space-y-0.5">
                    {order.lines.map((line) => (
                      <li key={line.id} className="flex justify-between gap-4 text-[0.75rem] text-fg-subtle">
                        <span>{line.description}</span>
                        <span className="tnum">{formatMoney({ amount: line.totalCents, currency: "USD" })}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {order.notes ? (
                  <p className="mt-1.5 text-[0.8125rem] text-fg-muted">{order.notes}</p>
                ) : null}

                <HistoryTrail entries={order.history} />

                {order.status !== "completed" && order.status !== "cancelled" ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Can permission="maintenance:repairs:manage">
                      {order.status !== "in_progress" ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          onClick={() =>
                            run(() => updateRepairOrderStatus(order.id, "in_progress", undefined, ctx), "Marked as in progress.")
                          }
                        >
                          Mark in progress
                        </Button>
                      ) : null}
                    </Can>
                    <Can permission="maintenance:service:record">
                      <CompleteServiceControl
                        uid={`${uid}-${order.id}`}
                        busy={busy}
                        onSubmit={(input) =>
                          run(
                            () => recordCompletedService({ repairOrderId: order.id, ...input }, ctx),
                            "Service recorded. The record is permanent.",
                          )
                        }
                      />
                    </Can>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}

      {tab === "history" ? <ServiceHistoryPanel entries={history} /> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Service history                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The whole machine's history, whoever did the work.
 *
 * Records written by another organization are shown, and shown AS another
 * organization's — the date, the work and the meter, with their commercial
 * detail removed. That is the honest answer to "what has happened to this
 * truck", and it is why the history survives a change of hands.
 */
function ServiceHistoryPanel({ entries }: { entries: ServiceHistoryEntry[] }) {
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={Wrench}
        title="No service recorded"
        description="Nothing has been completed on this equipment yet."
      />
    );
  }

  const foreign = entries.filter((e) => !e.ownRecord).length;

  return (
    <div className="space-y-3">
      <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
        Every service ever recorded against this machine&apos;s permanent record. Nothing here can
        be edited or deleted, and an ownership or carrier change never removes a line of it.
        {foreign > 0
          ? ` ${foreign} record${foreign === 1 ? " was" : "s were"} written by another organization — you can see what was done, not what they paid.`
          : ""}
      </p>
      <ol className="space-y-2">
        {entries.map(({ record, ownRecord }) => (
          <li
            key={record.id}
            className={cn(
              "rounded-lg border bg-surface px-4 py-3 shadow-e1",
              ownRecord ? "border-border" : "border-dashed border-border-strong",
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
              <p className="text-[0.875rem] font-medium text-fg">{record.title}</p>
              <p className="text-[0.75rem] text-fg-subtle">{formatMaintenanceDate(record.performedAt)}</p>
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.75rem] text-fg-subtle">
              <span>{MAINTENANCE_CATEGORY_LABEL[record.category]}</span>
              {record.meter?.odometerMiles !== undefined ? (
                <span>{formatMiles(record.meter.odometerMiles)}</span>
              ) : null}
              {record.meter?.engineHours !== undefined ? (
                <span>{formatEngineHours(record.meter.engineHours)}</span>
              ) : null}
              {record.downtimeHours !== undefined ? <span>{formatDowntime(record.downtimeHours)} down</span> : null}
              {record.vendor ? <span>{record.vendor.name}</span> : null}
              {record.cost?.actual ? <span>{formatMoney(record.cost.actual)}</span> : null}
              {record.repairOrderNumber ? <span className="font-mono">{record.repairOrderNumber}</span> : null}
            </p>
            {record.summary ? (
              <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-fg-muted">{record.summary}</p>
            ) : null}
            {!ownRecord ? (
              <p className="mt-2 flex flex-wrap items-center gap-2 text-[0.75rem] text-fg-subtle">
                <Badge tone="outline">
                  <Lock aria-hidden className="size-3" />
                  {record.performedForOrganizationName}
                </Badge>
                <span>
                  Done under another organization&apos;s authority. Cost, vendor and notes are theirs.
                </span>
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Small controls                                                              */
/* -------------------------------------------------------------------------- */

function HistoryTrail({ entries }: { entries: { id: string; at: string; actor: { displayNameSnapshot: string }; action: string; note?: string }[] }) {
  if (entries.length === 0) return null;
  return (
    <ol className="mt-3 space-y-1 border-l border-border pl-3">
      {entries.map((entry) => (
        <li key={entry.id} className="text-[0.75rem] text-fg-subtle">
          <span className="text-fg-muted">{entry.actor.displayNameSnapshot}</span>
          {" · "}
          {formatMaintenanceDateTime(entry.at)}
          {entry.note ? <span className="block text-fg-muted">{entry.note}</span> : null}
        </li>
      ))}
    </ol>
  );
}

function MeterPanel({
  uid, meter, busy, canRecord, onRecord,
}: {
  uid: string;
  meter?: EquipmentMeter;
  busy: boolean;
  canRecord: boolean;
  onRecord: (reading: { odometerMiles?: number; engineHours?: number; note?: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [miles, setMiles] = useState("");
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");

  const latest = meter?.latest;
  // A ticking "now" from the shared hook rather than Date.now() during render,
  // so the staleness badge stays pure and does not differ between server and
  // client on the first paint.
  const now = useNow();
  const stale =
    latest && meter && now !== null
      ? (now - new Date(latest.readAt).getTime()) / 86_400_000 > meter.staleAfterDays
      : false;

  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <h2 className="text-[0.875rem] font-semibold text-fg">Meter</h2>
          {latest ? (
            <>
              <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem] text-fg-muted">
                <span>Odometer {formatMiles(latest.odometerMiles)}</span>
                <span>Engine hours {formatEngineHours(latest.engineHours)}</span>
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-[0.75rem] text-fg-subtle">
                {/* Always says where the reading came from. Maintenance keeps no
                    meter of its own: this is the canonical Equipment Meter
                    Ledger's accepted value, and it may have been contributed by
                    this screen, by fleet operations or by a fuel receipt. */}
                Read {formatMaintenanceDate(latest.readAt)}
                {latest.recordedBy ? ` · entered by ${latest.recordedBy.displayNameSnapshot}` : ""}
                {` (${MAINTENANCE_METER_SOURCE_LABEL[latest.source].toLowerCase()})`}
                {stale ? <StaleMeterChip /> : null}
              </p>
            </>
          ) : (
            <p className="mt-1 text-[0.8125rem] text-fg-muted">
              Nobody has recorded a reading. Mileage and hour-based service cannot be worked out
              until somebody does.
            </p>
          )}
        </div>
        {canRecord ? (
          <Button size="sm" variant="secondary" onClick={() => setOpen((v) => !v)}>
            {open ? "Cancel" : "Record a reading"}
          </Button>
        ) : null}
      </div>

      {open && canRecord ? (
        <form
          className="mt-3 grid gap-3 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            onRecord({
              odometerMiles: miles.trim() ? Number(miles) : undefined,
              engineHours: hours.trim() ? Number(hours) : undefined,
              note: note.trim() || undefined,
            });
            setOpen(false);
            setMiles(""); setHours(""); setNote("");
          }}
        >
          <Field label="Odometer (mi)" htmlFor={`${uid}-miles`}>
            <Input id={`${uid}-miles`} inputMode="numeric" value={miles} onChange={(e) => setMiles(e.target.value)} />
          </Field>
          <Field label="Engine hours" htmlFor={`${uid}-hours`}>
            <Input id={`${uid}-hours`} inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} />
          </Field>
          <Field label="Note" htmlFor={`${uid}-note`}>
            <Input id={`${uid}-note`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Where it was read" />
          </Field>
          <div className="sm:col-span-3">
            <Button type="submit" size="sm" variant="primary" disabled={busy}>
              {busy ? <LoaderCircle aria-hidden className="animate-spin" /> : null}
              Save reading
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function ReturnToServiceControl({
  uid, busy, onSubmit,
}: { uid: string; busy: boolean; onSubmit: (note: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2"
      onSubmit={(e) => { e.preventDefault(); onSubmit(note); setNote(""); }}
    >
      <Field label="What was done" htmlFor={`${uid}-rts`} className="min-w-0 flex-1">
        <Input
          id={`${uid}-rts`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Road tested, holds pressure"
        />
      </Field>
      <Button type="submit" size="sm" variant="primary" disabled={busy}>
        {busy ? <LoaderCircle aria-hidden className="animate-spin" /> : null}
        Return to service
      </Button>
    </form>
  );
}

function DefectActions({
  uid, busy, onAcknowledge, onResolve,
}: {
  uid: string;
  busy: boolean;
  onAcknowledge: () => void;
  onResolve: (note: string) => void;
}) {
  const [resolving, setResolving] = useState(false);
  const [note, setNote] = useState("");

  if (resolving) {
    return (
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => { e.preventDefault(); onResolve(note); setResolving(false); setNote(""); }}
      >
        <Field label="What was done to fix it" htmlFor={`${uid}-fix`} className="min-w-0 flex-1">
          <Textarea
            id={`${uid}-fix`}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Chambers replaced and road tested"
          />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" size="sm" variant="primary" disabled={busy}>Resolve</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setResolving(false)}>Cancel</Button>
        </div>
      </form>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" disabled={busy} onClick={onAcknowledge}>Acknowledge</Button>
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => setResolving(true)}>Resolve</Button>
    </div>
  );
}

function CompleteServiceControl({
  uid, busy, onSubmit,
}: {
  uid: string;
  busy: boolean;
  onSubmit: (input: { summary?: string; downtimeHours?: number; meter?: { odometerMiles?: number } }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [downtime, setDowntime] = useState("");
  const [miles, setMiles] = useState("");

  if (!open) {
    return (
      <Button size="sm" variant="primary" disabled={busy} onClick={() => setOpen(true)}>
        Record completed service
      </Button>
    );
  }

  return (
    <form
      className="mt-2 w-full space-y-3 rounded-md border border-border bg-surface-sunken p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          summary: summary.trim() || undefined,
          downtimeHours: downtime.trim() ? Number(downtime) : undefined,
          meter: miles.trim() ? { odometerMiles: Number(miles) } : undefined,
        });
        setOpen(false);
        setSummary(""); setDowntime(""); setMiles("");
      }}
    >
      <p className="text-[0.75rem] leading-relaxed text-fg-muted">
        This writes the permanent service record. It cannot be edited or deleted afterwards,
        and it stays with the equipment if it changes hands.
      </p>
      <Field label="What was done" htmlFor={`${uid}-summary`}>
        <Textarea id={`${uid}-summary`} rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Downtime (hours)" htmlFor={`${uid}-down`}>
          <Input id={`${uid}-down`} inputMode="decimal" value={downtime} onChange={(e) => setDowntime(e.target.value)} />
        </Field>
        <Field label="Odometer at completion (mi)" htmlFor={`${uid}-odo`}>
          <Input id={`${uid}-odo`} inputMode="numeric" value={miles} onChange={(e) => setMiles(e.target.value)} />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={busy}>
          {busy ? <LoaderCircle aria-hidden className="animate-spin" /> : null}
          Write the permanent record
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}
