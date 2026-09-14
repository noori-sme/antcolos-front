"use client";

import {
  ChevronRight, ClipboardList, Plug, Search, TriangleAlert, Wrench,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState, LoadingSkeleton } from "@/components/data/states";
import {
  MAINTENANCE_CATEGORY_LABEL, DEFECT_AREA_LABEL, SHARE_SCOPE_DESCRIPTION,
  SHARE_SCOPE_LABEL, formatDowntime, formatMaintenanceDate,
  formatMaintenanceDateTime, formatMoney,
} from "@/lib/maintenance/labels";
import { MAINTENANCE_INTEGRATION_POINTS } from "@/lib/maintenance/integrations";
import {
  listDefects, listRepairOrders, listRequirements, listOwnServiceRecords,
  listSharedWithMe, maintenanceRole, maintenanceSummary,
} from "@/lib/api/mock/maintenance-registry";
import type {
  MaintenanceRequirementView, MaintenanceState, MaintenanceSummary, RepairOrder,
  ReportedDefect, ServiceRecord, SharedMaintenanceView,
} from "@/types";
import {
  AvailabilityImpactChip, CriticalityChip, DefectSeverityChip, DefectStateChip,
  MaintenanceStateChip, RepairOrderStatusChip, StaleMeterChip, TriggerChip,
} from "./chips";
import { useMaintenanceContext } from "./use-maintenance-context";
import { cn } from "@/lib/utils";

const TABS = [
  ["overview", "Overview"],
  ["requirements", "Service schedule"],
  ["defects", "Reported defects"],
  ["repairs", "Repair orders"],
  ["history", "Service history"],
  ["shared", "Shared with dispatch"],
  ["integrations", "Integrations"],
] as const;
type Tab = (typeof TABS)[number][0];

interface DashboardData {
  summary: MaintenanceSummary;
  requirements: MaintenanceRequirementView[];
  defects: ReportedDefect[];
  orders: RepairOrder[];
  history: ServiceRecord[];
  shared: SharedMaintenanceView[];
}

const STATE_FILTERS: Array<MaintenanceState | "all"> = [
  "all", "overdue", "due_soon", "in_service", "upcoming", "deferred", "completed",
];

/**
 * The organization's maintenance.
 *
 * Everything on this screen is scoped by the registry, not by this file: the
 * equipment is whatever the organization still has a live relationship with,
 * the records are its own, and the money is absent entirely for anyone without
 * the cost permission. A dispatch organization that reaches this screen sees
 * the shared view and nothing else, because that is all the registry will give
 * it.
 */
export function MaintenanceDashboard() {
  const ctx = useMaintenanceContext();
  const [tab, setTab] = useState<Tab>("overview");

  // One state object that is null until the first load resolves, so the effect
  // never sets state synchronously and "loading" is a fact about the data
  // rather than a second flag that can disagree with it.
  const [data, setData] = useState<DashboardData | null>(null);

  const [query, setQuery] = useState("");
  const [state, setState] = useState<MaintenanceState | "all">("all");

  const load = useCallback(() => {
    if (!ctx) return;
    let cancelled = false;
    Promise.all([
      maintenanceSummary(ctx),
      listRequirements(ctx),
      listDefects(ctx),
      listRepairOrders(ctx),
      listOwnServiceRecords(ctx),
      listSharedWithMe(ctx),
    ]).then(([summary, requirements, defects, orders, history, shared]) => {
      if (cancelled) return;
      setData({ summary, requirements, defects, orders, history, shared });
    });
    return () => { cancelled = true; };
  }, [ctx]);

  useEffect(() => load(), [load]);

  const summary = data?.summary ?? null;
  const requirements = useMemo(() => data?.requirements ?? [], [data]);
  const defects = data?.defects ?? [];
  const orders = data?.orders ?? [];
  const history = data?.history ?? [];
  const shared = data?.shared ?? [];
  const loading = data === null;

  const visibleRequirements = useMemo(() => {
    const q = query.trim().toLowerCase();
    return requirements
      .filter((v) => (state === "all" ? true : v.state === state))
      .filter((v) => {
        if (!q) return true;
        return `${v.requirement.title} ${v.equipment.unit} ${MAINTENANCE_CATEGORY_LABEL[v.requirement.category]}`
          .toLowerCase().includes(q);
      });
  }, [requirements, query, state]);

  /**
   * A dispatch organization gets nothing but the shared view.
   *
   * Asked of the registry rather than inferred from empty lists, so an
   * organization that dispatches but operates nothing sees the dispatch answer
   * even before anything has been shared with it — instead of a carrier
   * dashboard full of zeros implying it could run a shop.
   */
  const dispatchOnly = !loading && ctx !== null && maintenanceRole(ctx) === "dispatch_viewer";

  if (!ctx) return <LoadingSkeleton rows={6} />;

  if (dispatchOnly) {
    return (
      <div className="space-y-section">
        <PageHeader
          title="Maintenance"
          description="What the carriers you dispatch for have chosen to share with you."
        />
        <SharedPanel shared={shared} />
      </div>
    );
  }

  return (
    <div className="space-y-section">
      <PageHeader
        title="Maintenance"
        description="What your equipment is due for, what has been reported broken, and what has been done to it."
        actions={
          summary ? (
            <div className="flex flex-wrap items-center gap-2">
              {summary.overdue > 0 ? <Badge tone="danger">{summary.overdue} overdue</Badge> : null}
              {summary.equipmentOutOfService > 0 ? (
                <Badge tone="danger">{summary.equipmentOutOfService} out of service</Badge>
              ) : null}
              {summary.openDefects > 0 ? <Badge tone="warning">{summary.openDefects} open defects</Badge> : null}
            </div>
          ) : null
        }
      />

      {loading ? <LoadingSkeleton rows={6} /> : (
        <>
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

          {tab === "overview" && summary ? (
            <OverviewTab summary={summary} requirements={requirements} defects={defects} />
          ) : null}

          {tab === "requirements" ? (
            <section className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-0 flex-1 sm:max-w-xs">
                  <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search the schedule"
                    aria-label="Search the service schedule"
                    className="pl-9"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {STATE_FILTERS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={state === value}
                      onClick={() => setState(value)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-[0.75rem] font-medium transition-colors",
                        state === value
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg",
                      )}
                    >
                      {value === "all" ? "All" : label(value)}
                    </button>
                  ))}
                </div>
              </div>
              <RequirementList views={visibleRequirements} />
            </section>
          ) : null}

          {tab === "defects" ? <DefectList defects={defects} /> : null}
          {tab === "repairs" ? <RepairOrderList orders={orders} /> : null}
          {tab === "history" ? <HistoryList records={history} /> : null}
          {tab === "shared" ? <SharedPanel shared={shared} /> : null}
          {tab === "integrations" ? <IntegrationsPanel /> : null}
        </>
      )}
    </div>
  );
}

function label(state: MaintenanceState): string {
  return {
    upcoming: "Upcoming", due_soon: "Due soon", overdue: "Overdue",
    in_service: "In service", completed: "Completed", deferred: "Deferred",
  }[state];
}

/* -------------------------------------------------------------------------- */
/* Overview                                                                    */
/* -------------------------------------------------------------------------- */

function OverviewTab({
  summary, requirements, defects,
}: {
  summary: MaintenanceSummary;
  requirements: MaintenanceRequirementView[];
  defects: ReportedDefect[];
}) {
  const attention = requirements.filter((v) => v.state === "overdue" || v.state === "due_soon").slice(0, 6);
  const openDefects = defects
    .filter((d) => d.state !== "resolved" && d.state !== "dismissed")
    .slice(0, 5);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Overdue" value={summary.overdue} tone={summary.overdue > 0 ? "danger" : "neutral"} />
        <Tile label="Due soon" value={summary.dueSoon} tone={summary.dueSoon > 0 ? "warning" : "neutral"} />
        <Tile label="In service" value={summary.inService} tone="progress" />
        <Tile label="Out of service" value={summary.equipmentOutOfService} tone={summary.equipmentOutOfService > 0 ? "danger" : "neutral"} />
        <Tile label="Open defects" value={summary.openDefects} tone={summary.criticalDefects > 0 ? "danger" : "neutral"} hint={summary.criticalDefects > 0 ? `${summary.criticalDefects} critical` : undefined} />
        <Tile label="Open repair orders" value={summary.openRepairOrders} tone="neutral" />
        <Tile label="Deferred" value={summary.deferred} tone={summary.deferred > 0 ? "info" : "neutral"} />
        <Tile label="Completed, 30 days" value={summary.completedLast30Days} tone="success" />
      </div>

      {/* Money appears only when the permission is held. It is absent, not zero. */}
      {summary.costLast30Days ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Tile label="Cost, last 30 days" value={formatMoney(summary.costLast30Days)} tone="neutral" />
          <Tile
            label="Downtime, last 30 days"
            value={formatDowntime(summary.downtimeHoursLast30Days)}
            tone="neutral"
          />
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <Panel title="Needs attention">
          {attention.length === 0 ? (
            <p className="text-[0.8125rem] text-fg-muted">
              Nothing is overdue or due soon.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {attention.map((view) => (
                <li key={view.requirement.id}>
                  <Link
                    href={`/maintenance/${view.equipment.kind}/${view.equipment.equipmentId}`}
                    className="flex items-center justify-between gap-3 py-2.5 hover:text-primary"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[0.8125rem] font-medium text-fg">
                        {view.requirement.title}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[0.75rem] text-fg-subtle">
                        {view.equipment.unit}
                        <MaintenanceStateChip state={view.state} />
                        <span>{view.due.label}</span>
                        {view.due.meterStale ? <StaleMeterChip /> : null}
                      </span>
                    </span>
                    <ChevronRight aria-hidden className="size-4 shrink-0 text-fg-subtle" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Open defects">
          {openDefects.length === 0 ? (
            <p className="text-[0.8125rem] text-fg-muted">Nothing has been reported.</p>
          ) : (
            <ul className="divide-y divide-border">
              {openDefects.map((defect) => (
                <li key={defect.id} className="py-2.5">
                  <p className="text-[0.8125rem] font-medium text-fg">{defect.summary}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.75rem] text-fg-subtle">
                    <DefectSeverityChip severity={defect.severity} />
                    <AvailabilityImpactChip impact={defect.availabilityImpact} />
                    <span>
                      {DEFECT_AREA_LABEL[defect.area]} · reported by {defect.reportedByName}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Tile({
  label, value, tone, hint,
}: {
  label: string;
  value: number | string;
  tone: "neutral" | "danger" | "warning" | "success" | "info" | "progress";
  hint?: string;
}) {
  const toneClass = {
    neutral: "text-fg",
    danger: "text-st-danger",
    warning: "text-st-warning",
    success: "text-st-success",
    info: "text-st-info",
    progress: "text-st-progress",
  }[tone];

  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <p className="text-[0.75rem] text-fg-muted">{label}</p>
      <p className={cn("tnum mt-1 text-[1.375rem] font-semibold leading-7", toneClass)}>{value}</p>
      {hint ? <p className="mt-0.5 text-[0.75rem] text-st-danger">{hint}</p> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Lists                                                                       */
/* -------------------------------------------------------------------------- */

function RequirementList({ views }: { views: MaintenanceRequirementView[] }) {
  if (views.length === 0) {
    return (
      <EmptyState
        icon={Wrench}
        title="Nothing here"
        description="No requirement matches what you are looking at."
      />
    );
  }
  return (
    <ul className="space-y-2">
      {views.map((view) => (
        <li key={view.requirement.id}>
          <Link
            href={`/maintenance/${view.equipment.kind}/${view.equipment.equipmentId}`}
            className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface px-4 py-3 shadow-e1 transition-colors hover:border-border-strong"
          >
            <div className="min-w-0">
              <p className="truncate text-[0.875rem] font-medium text-fg">{view.requirement.title}</p>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.75rem] text-fg-subtle">
                <span className="font-medium text-fg-muted">{view.equipment.unit}</span>
                <span>{view.equipment.typeLabel}</span>
                <MaintenanceStateChip state={view.state} />
                <TriggerChip kind={view.requirement.trigger.kind} />
                <CriticalityChip criticality={view.requirement.criticality} />
                {view.due.meterStale ? <StaleMeterChip /> : null}
              </p>
              {view.requirement.deferral ? (
                <p className="mt-1.5 text-[0.75rem] text-st-info">
                  Deferred: {view.requirement.deferral.reason}
                  {view.requirement.deferral.until
                    ? ` (until ${formatMaintenanceDate(view.requirement.deferral.until)})`
                    : ""}
                </p>
              ) : null}
            </div>
            <div className="shrink-0 text-right">
              <p className={cn(
                "text-[0.8125rem] font-medium",
                view.state === "overdue" ? "text-st-danger" : "text-fg-muted",
              )}>
                {view.due.label}
              </p>
              {view.responsibleName ? (
                <p className="mt-0.5 text-[0.75rem] text-fg-subtle">{view.responsibleName}</p>
              ) : null}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function DefectList({ defects }: { defects: ReportedDefect[] }) {
  if (defects.length === 0) {
    return (
      <EmptyState
        icon={TriangleAlert}
        title="No defects reported"
        description="Nothing has been reported on the equipment you can see."
      />
    );
  }
  return (
    <ul className="space-y-2">
      {defects.map((defect) => (
        <li
          key={defect.id}
          className="rounded-lg border border-border bg-surface px-4 py-3 shadow-e1"
        >
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
            <p className="text-[0.875rem] font-medium text-fg">{defect.summary}</p>
            <p className="text-[0.75rem] text-fg-subtle">
              {formatMaintenanceDateTime(defect.reportedAt)}
            </p>
          </div>
          {defect.detail ? (
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">{defect.detail}</p>
          ) : null}
          <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[0.75rem] text-fg-subtle">
            <DefectSeverityChip severity={defect.severity} />
            <AvailabilityImpactChip impact={defect.availabilityImpact} />
            <DefectStateChip state={defect.state} />
            <span>{DEFECT_AREA_LABEL[defect.area]}</span>
            <span>· reported by {defect.reportedByName}</span>
          </p>
          {defect.resolutionNote ? (
            <p className="mt-2 rounded-md border border-st-success/30 bg-st-success-bg/40 px-3 py-2 text-[0.75rem] text-fg">
              {defect.resolutionNote}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function RepairOrderList({ orders }: { orders: RepairOrder[] }) {
  if (orders.length === 0) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="No repair orders"
        description="Nothing has been raised on the equipment you can see."
      />
    );
  }
  return (
    <ul className="space-y-2">
      {orders.map((order) => (
        <li key={order.id} className="rounded-lg border border-border bg-surface px-4 py-3 shadow-e1">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
            <p className="text-[0.875rem] font-medium text-fg">
              <span className="font-mono text-[0.8125rem] text-fg-muted">{order.number}</span>
              {" · "}
              {order.title}
            </p>
            <RepairOrderStatusChip status={order.status} />
          </div>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.75rem] text-fg-subtle">
            {order.vendor ? <span>{order.vendor.name}</span> : <span>No vendor yet</span>}
            <span>Opened {formatMaintenanceDate(order.openedAt)}</span>
            {order.scheduledFor ? <span>Booked {formatMaintenanceDate(order.scheduledFor)}</span> : null}
            {order.responsibleName ? <span>{order.responsibleName}</span> : null}
          </p>
          {/* Cost is absent entirely without the permission — never zeroed. */}
          {order.cost.estimate || order.cost.actual ? (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-4 text-[0.75rem] text-fg-muted">
              {order.cost.estimate ? <span>Estimate {formatMoney(order.cost.estimate)}</span> : null}
              {order.cost.actual ? <span>Actual {formatMoney(order.cost.actual)}</span> : null}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function HistoryList({ records }: { records: ServiceRecord[] }) {
  if (records.length === 0) {
    return (
      <EmptyState
        icon={Wrench}
        title="No completed service yet"
        description="Completing a repair order writes a permanent record here."
      />
    );
  }
  return (
    <>
      <p className="text-[0.8125rem] text-fg-muted">
        Your organization&apos;s completed work. Every record here is permanent — it can never
        be edited or deleted, and it stays with the equipment if it changes hands.
      </p>
      <ul className="mt-3 space-y-2">
        {records.map((record) => (
          <li key={record.id} className="rounded-lg border border-border bg-surface px-4 py-3 shadow-e1">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
              <p className="text-[0.875rem] font-medium text-fg">{record.title}</p>
              <p className="text-[0.75rem] text-fg-subtle">{formatMaintenanceDate(record.performedAt)}</p>
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.75rem] text-fg-subtle">
              <span>{MAINTENANCE_CATEGORY_LABEL[record.category]}</span>
              {record.vendor ? <span>{record.vendor.name}</span> : null}
              {record.meter?.odometerMiles !== undefined ? (
                <span>{record.meter.odometerMiles.toLocaleString()} mi</span>
              ) : null}
              {record.downtimeHours !== undefined ? (
                <span>{formatDowntime(record.downtimeHours)} down</span>
              ) : null}
              {record.cost?.actual ? <span>{formatMoney(record.cost.actual)}</span> : null}
            </p>
            {record.summary ? (
              <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-fg-muted">{record.summary}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Sharing                                                                     */
/* -------------------------------------------------------------------------- */

function SharedPanel({ shared }: { shared: SharedMaintenanceView[] }) {
  if (shared.length === 0) {
    return (
      <EmptyState
        icon={Wrench}
        title="Nothing shared with you"
        description="Carriers decide, one piece of equipment at a time, whether a dispatch organization sees its maintenance. None has been shared with you."
      />
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
        This is availability information for planning freight — it never includes cost,
        vendors, notes or what the fault actually is.
      </p>
      <ul className="space-y-2">
        {shared.map((view) => (
          <li
            key={view.equipment.equipmentId}
            className="rounded-lg border border-border bg-surface px-4 py-3 shadow-e1"
          >
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
              <p className="text-[0.875rem] font-medium text-fg">
                {view.equipment.unit} · {view.equipment.typeLabel}
              </p>
              <Badge tone={view.outOfService ? "danger" : "success"}>
                {view.outOfService ? "Cannot take a load" : "Available"}
              </Badge>
            </div>
            <p className="mt-1 text-[0.75rem] text-fg-subtle">
              Shared by {view.sharedByOrganizationName} · {SHARE_SCOPE_LABEL[view.scope]}
            </p>
            {view.outOfServiceReason ? (
              <p className="mt-2 rounded-md border border-st-danger/30 bg-st-danger-bg/40 px-3 py-2 text-[0.75rem] text-fg">
                {view.outOfServiceReason}
              </p>
            ) : null}
            {view.expectedBackAt ? (
              <p className="mt-1.5 text-[0.75rem] text-fg-muted">
                Booked in for {formatMaintenanceDate(view.expectedBackAt)}
              </p>
            ) : null}
            {view.openRequirements ? (
              <ul className="mt-2 space-y-1">
                {view.openRequirements.slice(0, 4).map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 text-[0.75rem] text-fg-muted">
                    <MaintenanceStateChip state={r.state} />
                    <span>{r.title}</span>
                    <span className="text-fg-subtle">{r.dueLabel}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-2 text-[0.75rem] text-fg-subtle">
              {view.openDefectCount === 0
                ? "No open defects."
                : `${view.openDefectCount} open defect${view.openDefectCount === 1 ? "" : "s"} on record.`}
            </p>
            <p className="mt-1 text-[0.6875rem] text-fg-subtle">
              {SHARE_SCOPE_DESCRIPTION[view.scope]}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Integrations                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The extension points, listed honestly.
 *
 * Every row says "Not connected" because every row IS not connected. There is
 * no toggle, no "connect" button and no configuration screen behind any of
 * them, because there is nothing on the other end to configure.
 */
function IntegrationsPanel() {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-st-warning/35 bg-st-warning-bg/40 p-4">
        <p className="text-[0.875rem] font-semibold text-fg">Nothing below is connected</p>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">
          Antcolos reads no ELD, telematics feed, repair shop, parts catalogue, tire sensor,
          warranty registry or roadside network. Every odometer and engine-hour reading in
          maintenance was typed in by a person, and every screen showing one says who typed it.
          These are the places each integration will plug into when it is built.
        </p>
      </div>
      <ul className="space-y-2">
        {MAINTENANCE_INTEGRATION_POINTS.map((point) => (
          <li
            key={point.kind}
            className="rounded-lg border border-border bg-surface px-4 py-3 shadow-e1"
          >
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
              <p className="flex items-center gap-2 text-[0.875rem] font-medium text-fg">
                <Plug aria-hidden className="size-4 text-fg-subtle" />
                {point.label}
              </p>
              <Badge tone="neutral">Not connected</Badge>
            </div>
            <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-fg-muted">
              {point.description}
            </p>
            <p className="mt-1.5 font-mono text-[0.6875rem] text-fg-subtle">{point.provides}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <h2 className="text-[0.875rem] font-semibold text-fg">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}
