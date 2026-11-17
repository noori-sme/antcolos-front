"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useId } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { EXCEPTION_TYPE_LABEL, reportExceptionSchema } from "@/lib/load-exceptions/forms";
import {
  LOAD_EXCEPTION_SEVERITIES, LOAD_EXCEPTION_TYPES, type LoadExceptionSeverity,
  type LoadExceptionType,
} from "@/types/load-exception";

const SELECT =
  "h-control w-full rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg shadow-e1 hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35";

const SEVERITY_LABEL: Record<LoadExceptionSeverity, string> = {
  low: "Low: worth knowing",
  medium: "Medium: needs attention today",
  high: "High: the load is at risk",
  critical: "Critical: act now",
};

export interface ReportedException {
  type: LoadExceptionType;
  severity: LoadExceptionSeverity;
  notes: string;
  stopSequence: number | null;
}

/**
 * Report a problem on a load (F1.5). Shared by the dispatcher's load detail
 * and the driver app; each passes its own mutation. Reporting never changes
 * the load's status (spec §12).
 */
export function ReportExceptionDialog({
  loadNumber, stops, open, onOpenChange, onSubmit, pending, error,
}: {
  loadNumber: string;
  stops: { sequence: number; label: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Resolves when the API accepted it; the dialog then closes. */
  onSubmit: (input: ReportedException) => Promise<unknown>;
  pending: boolean;
  error: Error | null;
}) {
  const id = useId();
  const form = useForm<z.infer<typeof reportExceptionSchema>>({
    resolver: zodResolver(reportExceptionSchema),
    defaultValues: { type: "pickup_delay", severity: "medium", notes: "", stopSequence: "" },
  });
  const errors = form.formState.errors;

  const submit = form.handleSubmit(async (values) => {
    await onSubmit({
      type: values.type,
      severity: values.severity,
      notes: values.notes,
      stopSequence: values.stopSequence ? Number(values.stopSequence) : null,
    });
    form.reset();
    onOpenChange(false);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Report a problem"
        description={`On load ${loadNumber}. Dispatch sees it right away; the load's status does not change.`}
      >
        <form onSubmit={(e) => void submit(e).catch(() => undefined)} className="mt-4 space-y-3">
          <Field label="What happened" htmlFor={`${id}-type`} required>
            <select id={`${id}-type`} className={SELECT} {...form.register("type")}>
              {LOAD_EXCEPTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {EXCEPTION_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="How serious" htmlFor={`${id}-severity`} required>
            <select id={`${id}-severity`} className={SELECT} {...form.register("severity")}>
              {LOAD_EXCEPTION_SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {SEVERITY_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
          {stops.length ? (
            <Field label="Stop" htmlFor={`${id}-stop`} hint="Optional">
              <select id={`${id}-stop`} className={SELECT} {...form.register("stopSequence")}>
                <option value="">The whole load</option>
                {stops.map((s) => (
                  <option key={s.sequence} value={String(s.sequence)}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field label="Details" htmlFor={`${id}-notes`} required error={errors.notes?.message}>
            <Textarea
              id={`${id}-notes`}
              rows={4}
              {...form.register("notes")}
              aria-invalid={Boolean(errors.notes)}
            />
          </Field>
          {error ? (
            <p role="alert" className="text-[0.8125rem] text-st-danger">
              {error.message}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Reporting…" : "Report problem"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
