"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CATEGORY_LABELS, MAX_DEFER_DAYS, maxDeferDate, scheduleChanges } from "@/lib/maintenance/due";
import {
  MAINTENANCE_CATEGORIES, type MaintenanceSchedule, type MaintenanceTask, type ReadingInput,
  type ScheduleInput,
} from "@/types/maintenance-live";
import { DialogActions, DialogError, SELECT_CLASS } from "./truck-dialog-parts";
import { useCompleteTask, useCreateSchedule, useDeferTask, useUpdateSchedule } from "./hooks";

/** One key per intent: made when the dialog opens, reused if the submit is retried. */
const useIntentKey = () => useState(() => crypto.randomUUID())[0];

/** "" → undefined; otherwise a whole number in range. */
const count = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d+$/.test(v), `${label} must be a whole number.`)
    .refine((v) => v === "" || (Number(v) >= min && Number(v) <= max), `${label} must be ${min.toLocaleString()}–${max.toLocaleString()}.`);
const tenths = (max: number, label: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d+(\.\d)?$/.test(v), `${label} takes at most one decimal.`)
    .refine((v) => v === "" || Number(v) <= max, `${label} is too large.`);
const toNum = (v: string) => (v === "" ? null : Number(v));

// ── Schedule ────────────────────────────────────────────────────────────

const scheduleSchema = z
  .object({
    title: z.string().trim().min(1, "Name the service.").max(120, "Keep it under 120 characters."),
    category: z.enum(MAINTENANCE_CATEGORIES),
    everyMiles: count(100, 1_000_000, "Miles"),
    everyDays: count(1, 3650, "Days"),
    everyEngineHours: count(1, 100_000, "Engine hours"),
    warnMiles: count(1, 1_000_000, "Warning miles"),
    warnDays: count(1, 3650, "Warning days"),
    warnEngineHours: count(1, 100_000, "Warning hours"),
    lastServiceOdometerMiles: count(0, 5_000_000, "Odometer"),
    lastServiceEngineHours: tenths(500_000, "Engine hours"),
  })
  .refine((v) => v.everyMiles !== "" || v.everyDays !== "" || v.everyEngineHours !== "", {
    message: "Set at least one interval: miles, days or engine hours.",
    path: ["everyMiles"],
  })
  .superRefine((v, ctx) => {
    for (const [warn, every, name] of [
      ["warnMiles", "everyMiles", "miles"],
      ["warnDays", "everyDays", "days"],
      ["warnEngineHours", "everyEngineHours", "engine hours"],
    ] as const) {
      if (v[warn] === "") continue;
      if (v[every] === "") {
        ctx.addIssue({ code: "custom", path: [warn], message: `Set an interval in ${name} first.` });
      } else if (Number(v[warn]) >= Number(v[every])) {
        ctx.addIssue({ code: "custom", path: [warn], message: "The warning must be shorter than the interval." });
      }
    }
  });
type ScheduleForm = z.infer<typeof scheduleSchema>;

const str = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

function toInput(v: ScheduleForm): ScheduleInput {
  return {
    title: v.title,
    category: v.category,
    everyMiles: toNum(v.everyMiles),
    everyDays: toNum(v.everyDays),
    everyEngineHours: toNum(v.everyEngineHours),
    warnMiles: toNum(v.warnMiles),
    warnDays: toNum(v.warnDays),
    warnEngineHours: toNum(v.warnEngineHours),
    lastServiceOdometerMiles: toNum(v.lastServiceOdometerMiles),
    lastServiceEngineHours: toNum(v.lastServiceEngineHours),
  };
}

/** Add or edit a service interval (`maintenance:manage`). */
export function ScheduleDialog({
  truckId, schedule, onClose,
}: {
  truckId: string;
  /** Edit when given; create otherwise. */
  schedule?: MaintenanceSchedule;
  onClose: () => void;
}) {
  const id = useId();
  const key = useIntentKey();
  const create = useCreateSchedule(truckId);
  const update = useUpdateSchedule(truckId);
  const mutation = schedule ? update : create;
  const { register, handleSubmit, formState: { errors } } = useForm<ScheduleForm>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: {
      title: schedule?.title ?? "Oil change",
      category: (MAINTENANCE_CATEGORIES as readonly string[]).includes(schedule?.category ?? "")
        ? (schedule!.category as ScheduleForm["category"])
        : "OIL_CHANGE",
      everyMiles: str(schedule?.everyMiles),
      everyDays: str(schedule?.everyDays),
      everyEngineHours: str(schedule?.everyEngineHours),
      warnMiles: str(schedule?.warnMiles),
      warnDays: str(schedule?.warnDays),
      warnEngineHours: str(schedule?.warnEngineHours),
      lastServiceOdometerMiles: str(schedule?.lastServiceOdometerMiles),
      lastServiceEngineHours: str(schedule?.lastServiceEngineHours),
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    const input = toInput(values);
    if (schedule) {
      const changes = scheduleChanges(schedule, input);
      if (Object.keys(changes).length) await update.mutateAsync({ scheduleId: schedule.id, input: changes });
    } else {
      // A blank baseline is left out so the API starts from the latest reading.
      const body = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== null)) as ScheduleInput;
      await create.mutateAsync({ input: body, idempotencyKey: key });
    }
    onClose();
  });

  const num = (name: keyof ScheduleForm, label: string, hint?: string) => (
    <Field label={label} htmlFor={`${id}-${name}`} hint={hint} error={errors[name]?.message}>
      <Input id={`${id}-${name}`} inputMode="numeric" {...register(name)} />
    </Field>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && !mutation.isPending && onClose()}>
      <DialogContent
        title={schedule ? "Edit service interval" : "Add service interval"}
        description="Due by whichever comes first. Leave an interval blank if it doesn't apply."
        className="max-w-xl"
      >
        <form onSubmit={onSubmit} noValidate className="mt-4">
          <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Service" htmlFor={`${id}-title`} error={errors.title?.message}>
                <Input id={`${id}-title`} {...register("title")} />
              </Field>
              <Field label="Kind" htmlFor={`${id}-category`}>
                <select id={`${id}-category`} className={SELECT_CLASS} {...register("category")}>
                  {MAINTENANCE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {num("everyMiles", "Every (miles)")}
              {num("everyDays", "Every (days)")}
              {num("everyEngineHours", "Every (engine hours)")}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {num("warnMiles", "Warn before (miles)", "Default 1,000")}
              {num("warnDays", "Warn before (days)", "Default 14")}
              {num("warnEngineHours", "Warn before (hours)", "Default 50")}
            </div>
            <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
              {num("lastServiceOdometerMiles", "Odometer at last service", "Blank: the latest reading")}
              {num("lastServiceEngineHours", "Engine hours at last service", "Blank: the latest reading")}
            </div>
          </div>
          <DialogError error={mutation.error} />
          <DialogActions onCancel={onClose} submitLabel={schedule ? "Save" : "Add interval"} pending={mutation.isPending} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Reading ─────────────────────────────────────────────────────────────

const readingSchema = z
  .object({ odometerMiles: count(0, 5_000_000, "Odometer"), engineHours: tenths(500_000, "Engine hours") })
  .refine((v) => v.odometerMiles !== "" || v.engineHours !== "", {
    message: "Enter the odometer, the engine hours, or both.",
    path: ["odometerMiles"],
  });
type ReadingForm = z.infer<typeof readingSchema>;

/** Record the odometer and/or engine hours; `save` is the fleet or the driver's own route. */
export function ReadingDialog({
  title, save, pending, error, onClose, latest,
}: {
  title: string;
  save: (input: ReadingInput, idempotencyKey: string) => Promise<unknown>;
  pending: boolean;
  error: Error | null;
  onClose: () => void;
  latest?: { odometerMiles: number | null; engineHours: number | null };
}) {
  const id = useId();
  const key = useIntentKey();
  const { register, handleSubmit, formState: { errors } } = useForm<ReadingForm>({
    resolver: zodResolver(readingSchema),
    defaultValues: { odometerMiles: "", engineHours: "" },
  });
  const onSubmit = handleSubmit(async (v) => {
    const input: ReadingInput = {};
    if (v.odometerMiles !== "") input.odometerMiles = Number(v.odometerMiles);
    if (v.engineHours !== "") input.engineHours = Number(v.engineHours);
    await save(input, key);
    onClose();
  });
  const last = (value: number | null | undefined, unit: string) =>
    value === null || value === undefined ? undefined : `Last: ${value.toLocaleString()} ${unit}`;

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent title={title} description="Readings only go forward; a lower number than the last one is refused.">
        <form onSubmit={onSubmit} noValidate className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Odometer (miles)" htmlFor={`${id}-odo`} hint={last(latest?.odometerMiles, "mi")} error={errors.odometerMiles?.message}>
              <Input id={`${id}-odo`} inputMode="numeric" {...register("odometerMiles")} />
            </Field>
            <Field label="Engine hours" htmlFor={`${id}-hours`} hint={last(latest?.engineHours, "h")} error={errors.engineHours?.message}>
              <Input id={`${id}-hours`} inputMode="decimal" {...register("engineHours")} />
            </Field>
          </div>
          <DialogError error={error} />
          <DialogActions onCancel={onClose} submitLabel="Record reading" pending={pending} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Defer ───────────────────────────────────────────────────────────────

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function DeferDialog({ task, truckId, onClose }: { task: MaintenanceTask; truckId?: string; onClose: () => void }) {
  const id = useId();
  const key = useIntentKey();
  const defer = useDeferTask(truckId);
  const today = new Date();
  const max = maxDeferDate(today);
  const schema = z.object({
    reason: z.string().trim().min(1, "Say why it waits.").max(500, "Keep it under 500 characters."),
    until: z
      .string()
      .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), "Pick a date.")
      .refine((v) => v > isoDay(today), "Pick a date after today.")
      .refine((v) => v <= isoDay(max), `At most ${MAX_DEFER_DAYS} days out.`),
  });
  const { register, handleSubmit, formState: { errors } } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { reason: "", until: "" },
  });
  const onSubmit = handleSubmit(async (v) => {
    // The start of the chosen (UTC) day: after today, so in the future, and never past the
    // 90-day cap even on its last day.
    await defer.mutateAsync({ taskId: task.id, reason: v.reason, deferredUntil: `${v.until}T00:00:00.000Z`, idempotencyKey: key });
    onClose();
  });
  return (
    <Dialog open onOpenChange={(open) => !open && !defer.isPending && onClose()}>
      <DialogContent title={`Defer ${task.title}`} description="It comes back as open on that date.">
        <form onSubmit={onSubmit} noValidate className="mt-4 space-y-4">
          <Field label="Until" htmlFor={`${id}-until`} error={errors.until?.message}>
            <Input id={`${id}-until`} type="date" min={isoDay(new Date(today.getTime() + 86_400_000))} max={isoDay(max)} {...register("until")} />
          </Field>
          <Field label="Reason" htmlFor={`${id}-reason`} error={errors.reason?.message}>
            <Textarea id={`${id}-reason`} rows={2} {...register("reason")} />
          </Field>
          <DialogError error={defer.error} />
          <DialogActions onCancel={onClose} submitLabel="Defer" pending={defer.isPending} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Complete ────────────────────────────────────────────────────────────

const completeSchema = z.object({
  date: z.string().refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), "Pick a date."),
  odometerMiles: count(0, 5_000_000, "Odometer"),
  engineHours: tenths(500_000, "Engine hours"),
  note: z.string().trim().max(1000, "Keep it under 1,000 characters."),
});
type CompleteForm = z.infer<typeof completeSchema>;

export function CompleteDialog({ task, truckId, onClose }: { task: MaintenanceTask; truckId?: string; onClose: () => void }) {
  const id = useId();
  const key = useIntentKey();
  const complete = useCompleteTask(truckId);
  const today = isoDay(new Date());
  const opened = task.openedAt.slice(0, 10);
  const { register, handleSubmit, formState: { errors }, setError } = useForm<CompleteForm>({
    resolver: zodResolver(completeSchema),
    defaultValues: { date: today, odometerMiles: "", engineHours: "", note: "" },
  });
  const onSubmit = handleSubmit(async (v) => {
    if (v.date > today || v.date < opened) {
      setError("date", { message: "Between the day it opened and today." });
      return;
    }
    // Today means now; an earlier day means the end of that day, not before the task opened.
    const completedAt = v.date === today ? new Date().toISOString() : `${v.date}T23:59:00.000Z`;
    await complete.mutateAsync({
      taskId: task.id,
      idempotencyKey: key,
      input: {
        completedAt,
        ...(v.odometerMiles !== "" ? { odometerMiles: Number(v.odometerMiles) } : {}),
        ...(v.engineHours !== "" ? { engineHours: Number(v.engineHours) } : {}),
        ...(v.note ? { note: v.note } : {}),
      },
    });
    onClose();
  });
  return (
    <Dialog open onOpenChange={(open) => !open && !complete.isPending && onClose()}>
      <DialogContent title={`Complete ${task.title}`} description="The next interval starts from this service.">
        <form onSubmit={onSubmit} noValidate className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Done on" htmlFor={`${id}-date`} error={errors.date?.message}>
              <Input id={`${id}-date`} type="date" min={opened} max={today} {...register("date")} />
            </Field>
            <Field label="Odometer (miles)" htmlFor={`${id}-odo`} error={errors.odometerMiles?.message}>
              <Input id={`${id}-odo`} inputMode="numeric" {...register("odometerMiles")} />
            </Field>
            <Field label="Engine hours" htmlFor={`${id}-hours`} error={errors.engineHours?.message}>
              <Input id={`${id}-hours`} inputMode="decimal" {...register("engineHours")} />
            </Field>
          </div>
          <Field label="What was done" htmlFor={`${id}-note`} error={errors.note?.message}>
            <Textarea id={`${id}-note`} rows={2} {...register("note")} />
          </Field>
          <DialogError error={complete.error} />
          <DialogActions onCancel={onClose} submitLabel="Complete" pending={complete.isPending} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
