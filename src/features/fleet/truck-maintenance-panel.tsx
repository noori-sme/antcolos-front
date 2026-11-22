"use client";

import { useRef, useState } from "react";
import { Gauge, Plus, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Can } from "@/components/auth/can";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { MaintenanceDueBadge, MaintenanceTaskBadge } from "@/components/common/status-badge";
import { categoryLabel, dueSummary, intervalSummary } from "@/lib/maintenance/due";
import { OPEN_TASK_STATUSES, type MaintenanceSchedule, type MaintenanceTask } from "@/types/maintenance-live";
import {
  useAcknowledgeTask, useArchiveSchedule, useMaintenanceTasks, useRecordReading, useTruckMaintenance,
} from "./maintenance-hooks";
import { CompleteDialog, DeferDialog, ReadingDialog, ScheduleDialog } from "./maintenance-dialogs";
import { TruckConfirmDialog } from "./truck-dialog-parts";

type Open =
  | { kind: "schedule"; schedule?: MaintenanceSchedule }
  | { kind: "archive"; schedule: MaintenanceSchedule }
  | { kind: "reading" }
  | { kind: "defer" | "complete"; task: MaintenanceTask }
  | null;

const meter = (value: number | null, unit: string, at: string | null) =>
  value === null
    ? `No ${unit === "mi" ? "odometer" : "engine hours"} yet`
    : `${value.toLocaleString()} ${unit}${at ? ` · ${new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}`;

/**
 * Service intervals of one truck (F2.3, plan 24): due state per schedule,
 * latest meters, and the open task's actions. Read with maintenance:view;
 * schedule and task actions need maintenance:manage; a reading needs
 * maintenance:readings:record.
 */
export function TruckMaintenancePanel({ truckId }: { truckId: string }) {
  const { data, isLoading, isError, error, refetch } = useTruckMaintenance(truckId);
  const tasks = useMaintenanceTasks({ truckId, status: OPEN_TASK_STATUSES, page: 1, pageSize: 100 });
  const reading = useRecordReading(truckId);
  const archive = useArchiveSchedule(truckId);
  const acknowledge = useAcknowledgeTask(truckId);
  const [open, setOpen] = useState<Open>(null);
  // One key per one-click intent, kept until it succeeds so a retry reuses it.
  const intent = useRef(new Map<string, string>());
  const keyFor = (what: string) => {
    if (!intent.current.has(what)) intent.current.set(what, crypto.randomUUID());
    return intent.current.get(what)!;
  };
  const taskById = new Map((tasks.data?.data ?? []).map((t) => [t.id, t]));
  const schedules = data?.schedules ?? [];

  return (
    <section aria-labelledby="truck-maintenance" className="rounded-lg border border-border bg-surface p-5 shadow-e1">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="truck-maintenance" className="text-[0.9375rem] font-semibold text-fg">Maintenance</h2>
        <div className="flex gap-2">
          <Can permission="maintenance:readings:record">
            <Button variant="secondary" size="sm" onClick={() => setOpen({ kind: "reading" })}>
              <Gauge aria-hidden /> Record reading
            </Button>
          </Can>
          <Can permission="maintenance:manage">
            <Button variant="secondary" size="sm" onClick={() => setOpen({ kind: "schedule" })}>
              <Plus aria-hidden /> Add interval
            </Button>
          </Can>
        </div>
      </div>

      {isLoading && <div className="mt-4"><LoadingSkeleton rows={2} /></div>}
      {isError && (
        <div className="mt-4">
          <ErrorState title="Couldn't load maintenance" description={error?.message} onRetry={() => refetch()} />
        </div>
      )}
      {data && (
        <>
          <p className="mt-2 text-[0.8125rem] text-fg-muted">
            {meter(data.latestReading.odometerMiles, "mi", data.latestReading.odometerReadAt)} ·{" "}
            {meter(data.latestReading.engineHours, "h", data.latestReading.engineHoursReadAt)}
          </p>
          {schedules.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                icon={Wrench}
                title="No service intervals yet"
                description="Add one, like an oil change every 15,000 miles, and you'll be told when it comes due."
              />
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-border rounded-md border border-border">
              {schedules.map((schedule) => {
                const task = schedule.openTask ? taskById.get(schedule.openTask.id) : undefined;
                return (
                  <li key={schedule.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-fg">{schedule.title}</span>
                        <MaintenanceDueBadge status={schedule.due.status} />
                        {schedule.openTask && <MaintenanceTaskBadge status={schedule.openTask.status} />}
                      </div>
                      <p className="text-[0.8125rem] text-fg-muted">
                        {categoryLabel(schedule.category)} · {intervalSummary(schedule)}
                      </p>
                      <p className="text-[0.8125rem] text-fg">{dueSummary(schedule.due)}</p>
                      {task?.status === "DEFERRED" && task.deferReason && (
                        <p className="text-[0.8125rem] text-fg-muted">Deferred: {task.deferReason}</p>
                      )}
                    </div>
                    <Can permission="maintenance:manage">
                      <div className="flex shrink-0 flex-wrap gap-2">
                        {task?.status === "OPEN" && (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={acknowledge.isPending}
                            onClick={() =>
                              acknowledge.mutate(
                                { taskId: task.id, idempotencyKey: keyFor(`ack:${task.id}`) },
                                { onSuccess: () => intent.current.delete(`ack:${task.id}`) },
                              )
                            }
                          >
                            Acknowledge
                          </Button>
                        )}
                        {task && (task.status === "OPEN" || task.status === "ACKNOWLEDGED") && (
                          <Button variant="secondary" size="sm" onClick={() => setOpen({ kind: "defer", task })}>Defer</Button>
                        )}
                        {task && (
                          <Button variant="primary" size="sm" onClick={() => setOpen({ kind: "complete", task })}>Complete</Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => setOpen({ kind: "schedule", schedule })}>Edit</Button>
                        <Button variant="ghost" size="sm" onClick={() => setOpen({ kind: "archive", schedule })}>Archive</Button>
                      </div>
                    </Can>
                  </li>
                );
              })}
            </ul>
          )}
          {acknowledge.error && (
            <p role="alert" className="mt-3 text-[0.8125rem] text-st-danger">{acknowledge.error.message}</p>
          )}
        </>
      )}

      {open?.kind === "schedule" && (
        <ScheduleDialog truckId={truckId} schedule={open.schedule} onClose={() => setOpen(null)} />
      )}
      {open?.kind === "reading" && (
        <ReadingDialog
          title="Record a reading"
          latest={data?.latestReading}
          pending={reading.isPending}
          error={reading.error}
          save={(input, idempotencyKey) => reading.mutateAsync({ input, idempotencyKey })}
          onClose={() => { reading.reset(); setOpen(null); }}
        />
      )}
      {open?.kind === "defer" && <DeferDialog task={open.task} truckId={truckId} onClose={() => setOpen(null)} />}
      {open?.kind === "complete" && <CompleteDialog task={open.task} truckId={truckId} onClose={() => setOpen(null)} />}
      {open?.kind === "archive" && (
        <TruckConfirmDialog
          open
          onOpenChange={(next) => { if (!next) { archive.reset(); setOpen(null); } }}
          title={`Archive ${open.schedule.title}?`}
          description="It stops coming due, and its open task is cancelled. Its history stays."
          confirmLabel="Archive"
          pending={archive.isPending}
          error={archive.error}
          onConfirm={() =>
            archive.mutate(
              { scheduleId: open.schedule.id, idempotencyKey: keyFor(`archive:${open.schedule.id}`) },
              {
                onSuccess: () => {
                  intent.current.delete(`archive:${open.schedule.id}`);
                  setOpen(null);
                },
              },
            )
          }
        />
      )}
    </section>
  );
}
