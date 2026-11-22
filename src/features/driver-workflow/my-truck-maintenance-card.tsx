"use client";

import { useId, useState } from "react";
import { Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Can } from "@/components/auth/can";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { MaintenanceDueBadge, MaintenanceTaskBadge } from "@/components/common/status-badge";
import { dueSummary, taskDueSummary } from "@/lib/maintenance/due";
import { useAcknowledgeMyTask, useIntentKeys, useMyTruckMaintenance, useRecordMyReading } from "./hooks";

/**
 * The driver's own truck (F2.3, plan 24): what it is due for, its odometer,
 * and acknowledging a task. Renders nothing without `maintenance:own:view`
 * or when the driver drives no truck here.
 */
export function MyTruckMaintenanceCard() {
  return (
    <Can permission="maintenance:own:view">
      <MyTruckMaintenance />
    </Can>
  );
}

function MyTruckMaintenance() {
  const id = useId();
  const { data, isLoading, isError, error, refetch } = useMyTruckMaintenance();
  const acknowledge = useAcknowledgeMyTask();
  const reading = useRecordMyReading();
  const keys = useIntentKeys();
  const [odometer, setOdometer] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  if (isLoading) return <LoadingSkeleton rows={1} />;
  if (isError) {
    return <ErrorState title="Couldn't load your truck's maintenance" description={error?.message} onRetry={() => refetch()} />;
  }
  if (!data) return null;

  const due = data.schedules.filter((s) => s.due.status === "DUE_SOON" || s.due.status === "OVERDUE");
  const latest = data.latestReading.odometerMiles;

  const record = () => {
    const value = odometer.trim();
    if (!/^\d+$/.test(value)) {
      setFormError("Enter the odometer in whole miles.");
      return;
    }
    if (latest !== null && Number(value) < latest) {
      setFormError(`That's lower than the last reading (${latest.toLocaleString()} mi).`);
      return;
    }
    setFormError(null);
    reading.mutate(
      { input: { odometerMiles: Number(value) }, idempotencyKey: keys.keyFor(`odometer:${value}`) },
      { onSuccess: () => { keys.clear(); setOdometer(""); } },
    );
  };

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <div className="flex items-center gap-2">
        <Wrench aria-hidden className="size-4 text-fg-muted" />
        <h2 id={`${id}-title`} className="text-[0.9375rem] font-semibold text-fg">
          Unit {data.unitNumber ?? "—"} maintenance
        </h2>
      </div>

      {data.openTasks.length === 0 && due.length === 0 ? (
        <p className="mt-2 text-[0.8125rem] text-fg-muted">Nothing due on your truck.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {data.openTasks.map((task) => {
            const schedule = data.schedules.find((s) => s.id === task.scheduleId);
            return (
              <li key={task.id} className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-fg">{task.title}</span>
                    <MaintenanceTaskBadge status={task.status} />
                    {schedule && <MaintenanceDueBadge status={schedule.due.status} />}
                  </div>
                  <p className="text-[0.8125rem] text-fg-muted">
                    {schedule ? dueSummary(schedule.due) : taskDueSummary(task)}
                  </p>
                </div>
                {task.status === "OPEN" && (
                  <Can permission="maintenance:own:update">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={acknowledge.isPending}
                      onClick={() =>
                        acknowledge.mutate(
                          { taskId: task.id, idempotencyKey: keys.keyFor(`ack:${task.id}`) },
                          { onSuccess: () => keys.clear() },
                        )
                      }
                    >
                      Got it
                    </Button>
                  </Can>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {acknowledge.error && (
        <p role="alert" className="mt-2 text-[0.8125rem] text-st-danger">{acknowledge.error.message}</p>
      )}

      <Can permission="maintenance:own:update">
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field
            label="Odometer (miles)"
            htmlFor={`${id}-odometer`}
            hint={latest !== null ? `Last: ${latest.toLocaleString()} mi` : undefined}
            error={formError ?? reading.error?.message}
            className="sm:max-w-xs"
          >
            <Input
              id={`${id}-odometer`}
              inputMode="numeric"
              value={odometer}
              onChange={(event) => setOdometer(event.target.value)}
            />
          </Field>
          <Button variant="primary" size="sm" onClick={record} disabled={reading.isPending}>
            Record odometer
          </Button>
        </div>
      </Can>
    </section>
  );
}
