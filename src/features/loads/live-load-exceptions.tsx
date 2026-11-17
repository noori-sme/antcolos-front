"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, CheckCircle2, Hand } from "lucide-react";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Can } from "@/components/auth/can";
import { ExceptionSeverityBadge, ExceptionStatusBadge } from "@/components/common/status-badge";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import {
  ReportExceptionDialog, type ReportedException,
} from "@/components/load-exceptions/report-exception-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  EXCEPTION_TYPE_LABEL, resolveExceptionSchema, sortExceptions, unresolvedCount,
} from "@/lib/load-exceptions/forms";
import { money } from "@/lib/load-records/format";
import { intentOf } from "@/lib/load-records/forms";
import type { LoadException } from "@/types/load-exception";
import type { LoadRecord } from "@/types/load-record";
import { useExceptionAction, useLoadExceptions, useLoadIntentKey } from "./hooks";

const WHEN = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Problems beside the load's status (F1.5, contract §14). */
export function LiveLoadExceptions({ load }: { load: LoadRecord }) {
  const query = useLoadExceptions(load.id);
  const action = useExceptionAction(load.id);
  const keys = useLoadIntentKey();
  const [reportOpen, setReportOpen] = useState(false);
  const [resolving, setResolving] = useState<LoadException | null>(null);

  const stops = load.stops.map((s) => ({
    sequence: s.sequence,
    label: `Stop ${s.sequence} · ${s.type === "pickup" ? "Pickup" : "Delivery"} · ${s.city}, ${s.state}`,
  }));

  const report = (input: ReportedException) =>
    action
      .mutateAsync({
        action: { kind: "report", input: { ...input, source: "web" } },
        idempotencyKey: keys.keyFor(intentOf("report", { ...input, stopSequence: String(input.stopSequence) })),
      })
      .then(() => keys.clear());

  const acknowledge = (exception: LoadException) =>
    action.mutate(
      {
        action: { kind: "acknowledge", exceptionId: exception.id },
        idempotencyKey: keys.keyFor(`ack:${exception.id}`),
      },
      { onSuccess: () => keys.clear() },
    );

  const items = query.data ? sortExceptions(query.data) : [];
  const open = unresolvedCount(items);

  return (
    <section aria-labelledby="load-exceptions" className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="load-exceptions" className="text-[0.9375rem] font-semibold text-fg">
          Problems{open ? ` · ${open} open` : ""}
        </h2>
        <Can permission="loads:edit">
          <Button size="sm" variant="secondary" onClick={() => setReportOpen(true)}>
            <AlertTriangle aria-hidden />
            Report a problem
          </Button>
        </Can>
      </div>

      {query.isPending ? (
        <LoadingSkeleton rows={2} />
      ) : query.isError ? (
        <ErrorState
          title="Couldn't load the problems"
          description={query.error.message}
          onRetry={() => void query.refetch()}
        />
      ) : items.length === 0 ? (
        <p className="text-[0.8125rem] text-fg-muted">No problems reported on this load.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((exception) => (
            <li
              key={exception.id}
              className="rounded-lg border border-border bg-surface px-4 py-3.5 shadow-e1"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[0.875rem] font-medium text-fg">
                    {EXCEPTION_TYPE_LABEL[exception.type]}
                    {exception.stopSequence != null ? ` · stop ${exception.stopSequence}` : ""}
                  </p>
                  <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                    Reported <time dateTime={exception.openedAt}>{WHEN.format(new Date(exception.openedAt))}</time>
                    {exception.source === "mobile_web" ? " by the driver" : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <ExceptionSeverityBadge severity={exception.severity} />
                  <ExceptionStatusBadge status={exception.status} />
                </div>
              </div>
              <p className="mt-2 whitespace-pre-line break-words text-[0.8125rem] text-fg">{exception.notes}</p>
              {exception.status === "resolved" ? (
                <p className="mt-2 text-[0.8125rem] text-fg-muted">
                  Resolved: {exception.resolution}
                  {exception.financialImpact ? ` · cost ${money(exception.financialImpact)}` : ""}
                </p>
              ) : (
                <Can permission="loads:edit">
                  <div className="mt-3 flex flex-wrap gap-2">
                    {exception.status === "open" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={action.isPending}
                        onClick={() => acknowledge(exception)}
                      >
                        <Hand aria-hidden />
                        Take it
                      </Button>
                    ) : null}
                    <Button size="sm" variant="primary" disabled={action.isPending} onClick={() => setResolving(exception)}>
                      <CheckCircle2 aria-hidden />
                      Resolve
                    </Button>
                  </div>
                </Can>
              )}
            </li>
          ))}
        </ul>
      )}
      {action.error && !reportOpen && !resolving ? (
        <p role="alert" className="text-[0.8125rem] text-st-danger">
          {action.error.message}
        </p>
      ) : null}

      <ReportExceptionDialog
        loadNumber={load.brokerLoadNumber}
        stops={stops}
        open={reportOpen}
        onOpenChange={(next) => {
          if (!next) action.reset();
          setReportOpen(next);
        }}
        onSubmit={report}
        pending={action.isPending}
        error={action.error}
      />
      <ResolveDialog loadId={load.id} exception={resolving} onClose={() => setResolving(null)} />
    </section>
  );
}

function ResolveDialog({
  loadId, exception, onClose,
}: {
  loadId: string;
  exception: LoadException | null;
  onClose: () => void;
}) {
  const action = useExceptionAction(loadId);
  const keys = useLoadIntentKey();
  const id = useId();
  const form = useForm<z.infer<typeof resolveExceptionSchema>>({
    resolver: zodResolver(resolveExceptionSchema),
    defaultValues: { resolution: "", financialImpact: "" },
  });
  const errors = form.formState.errors;

  const submit = form.handleSubmit((values) => {
    if (!exception) return;
    action.mutate(
      {
        action: { kind: "resolve", exceptionId: exception.id, input: values },
        idempotencyKey: keys.keyFor(intentOf(`resolve:${exception.id}`, values)),
      },
      {
        onSuccess: () => {
          keys.clear();
          form.reset();
          onClose();
        },
      },
    );
  });

  return (
    <Dialog
      open={exception !== null}
      onOpenChange={(next) => {
        if (!next) {
          action.reset();
          onClose();
        }
      }}
    >
      <DialogContent
        title="Resolve the problem"
        description={exception ? `${EXCEPTION_TYPE_LABEL[exception.type]}: say how it ended. It stays on the load as history.` : ""}
      >
        <form onSubmit={(e) => void submit(e)} className="mt-4 space-y-3">
          <Field label="Resolution" htmlFor={`${id}-resolution`} required error={errors.resolution?.message}>
            <Textarea
              id={`${id}-resolution`}
              rows={3}
              {...form.register("resolution")}
              aria-invalid={Boolean(errors.resolution)}
            />
          </Field>
          <Field
            label="Cost (USD)"
            htmlFor={`${id}-impact`}
            hint="Optional. Detention, lumper, repair, TONU…"
            error={errors.financialImpact?.message}
          >
            <Input
              id={`${id}-impact`}
              inputMode="decimal"
              placeholder="150.00"
              {...form.register("financialImpact")}
              aria-invalid={Boolean(errors.financialImpact)}
            />
          </Field>
          {action.error ? (
            <p role="alert" className="text-[0.8125rem] text-st-danger">
              {action.error.message}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button type="submit" variant="primary" disabled={action.isPending}>
              {action.isPending ? "Resolving…" : "Resolve"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
