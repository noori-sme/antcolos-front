"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, History, XCircle } from "lucide-react";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Can } from "@/components/auth/can";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LOAD_RECORD_STATUS } from "@/config/statuses";
import { cancelSchema, correctSchema, intentOf } from "@/lib/load-records/forms";
import { correctionTargets, stepActions, stepLabel } from "@/lib/load-records/status";
import type { CancellationParty, LoadRecord, LoadRecordStatus } from "@/types/load-record";
import { useLoadAction, useLoadIntentKey } from "./hooks";

const SELECT =
  "h-control w-full rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg shadow-e1 hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35";

/**
 * What a person may do with this load now. Every button comes from the
 * API's allowedTransitions; the screen never decides a step on its own.
 */
export function LiveLoadActions({ load }: { load: LoadRecord }) {
  const action = useLoadAction(load.id);
  const keys = useLoadIntentKey();
  const { steps, canCancel } = stepActions(load.allowedTransitions);
  const targets = correctionTargets(load.status, load.requiresBrokerRelease);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [correctOpen, setCorrectOpen] = useState(false);

  const step = (to: LoadRecordStatus) =>
    action.mutate(
      { action: { kind: "step", to }, idempotencyKey: keys.keyFor(`step:${load.status}:${to}`) },
      // Keep the key after a failure: a retry of the same step (say, after a
      // lost response) replays the server's answer instead of a 409.
      { onSuccess: () => keys.clear() },
    );

  const nothing = steps.length === 0 && !canCancel && targets.length === 0;
  if (nothing) return null;

  return (
    <section aria-labelledby="load-actions" className="space-y-2">
      <h2 id="load-actions" className="sr-only">
        Actions
      </h2>
      <div className="flex flex-wrap gap-2">
        {steps.length ? (
          <Can permission="loads:edit">
            {steps.map((to) => (
              <Button key={to} variant="primary" disabled={action.isPending} onClick={() => step(to)}>
                <ArrowRight aria-hidden />
                {stepLabel(to)}
              </Button>
            ))}
          </Can>
        ) : null}
        {canCancel ? (
          <Can permission="loads:edit">
            <Button variant="secondary" disabled={action.isPending} onClick={() => setCancelOpen(true)}>
              <XCircle aria-hidden />
              Cancel load
            </Button>
          </Can>
        ) : null}
        {targets.length ? (
          <Can permission="loads:correct_status">
            <Button variant="ghost" disabled={action.isPending} onClick={() => setCorrectOpen(true)}>
              <History aria-hidden />
              Correct status
            </Button>
          </Can>
        ) : null}
      </div>
      {action.error && !cancelOpen && !correctOpen ? (
        <p role="alert" className="text-[0.8125rem] text-st-danger">
          {action.error.message}
        </p>
      ) : null}

      <CancelDialog load={load} open={cancelOpen} onOpenChange={setCancelOpen} />
      <CorrectDialog load={load} targets={targets} open={correctOpen} onOpenChange={setCorrectOpen} />
    </section>
  );
}

function CancelDialog({
  load, open, onOpenChange,
}: {
  load: LoadRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const action = useLoadAction(load.id);
  const keys = useLoadIntentKey();
  const id = useId();
  const form = useForm<z.infer<typeof cancelSchema>>({
    resolver: zodResolver(cancelSchema),
    defaultValues: { reason: "", party: "", tonuAmount: "" },
  });
  const errors = form.formState.errors;

  const submit = form.handleSubmit((values) =>
    action.mutate(
      {
        action: {
          kind: "cancel",
          input: {
            reason: values.reason,
            party: (values.party || undefined) as CancellationParty | undefined,
            tonuAmount: values.tonuAmount || undefined,
          },
        },
        idempotencyKey: keys.keyFor(intentOf("cancel", values)),
      },
      {
        onSuccess: () => {
          keys.clear();
          onOpenChange(false);
          form.reset();
        },
      },
    ),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) action.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent
        title={`Cancel load ${load.brokerLoadNumber}?`}
        description="The load stops here and its load number is free to book again. This can't be undone."
      >
        <form onSubmit={(e) => void submit(e)} className="mt-4 space-y-3">
          <Field label="Reason" htmlFor={`${id}-reason`} required error={errors.reason?.message}>
            <Textarea id={`${id}-reason`} rows={3} {...form.register("reason")} aria-invalid={Boolean(errors.reason)} />
          </Field>
          <Field label="Who cancelled" htmlFor={`${id}-party`} hint="Optional">
            <select id={`${id}-party`} className={SELECT} {...form.register("party")}>
              <option value="">Not recorded</option>
              <option value="broker">Broker</option>
              <option value="shipper">Shipper</option>
              <option value="carrier">Carrier (us)</option>
              <option value="other">Someone else</option>
            </select>
          </Field>
          <Field
            label="TONU amount (USD)"
            htmlFor={`${id}-tonu`}
            hint="Optional. Truck ordered not used, if one was agreed."
            error={errors.tonuAmount?.message}
          >
            <Input
              id={`${id}-tonu`}
              inputMode="decimal"
              placeholder="150.00"
              {...form.register("tonuAmount")}
              aria-invalid={Boolean(errors.tonuAmount)}
            />
          </Field>
          {action.error ? (
            <p role="alert" className="text-[0.8125rem] text-st-danger">
              {action.error.message}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Keep the load
            </Button>
            <Button type="submit" variant="danger" disabled={action.isPending}>
              {action.isPending ? "Cancelling…" : "Cancel load"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CorrectDialog({
  load, targets, open, onOpenChange,
}: {
  load: LoadRecord;
  targets: LoadRecordStatus[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const action = useLoadAction(load.id);
  const keys = useLoadIntentKey();
  const id = useId();
  const form = useForm<z.infer<typeof correctSchema>>({
    resolver: zodResolver(correctSchema),
    defaultValues: { to: targets[0] ?? "", reason: "" },
  });
  const errors = form.formState.errors;

  const submit = form.handleSubmit((values) =>
    action.mutate(
      {
        action: { kind: "correct", to: values.to as LoadRecordStatus, reason: values.reason },
        idempotencyKey: keys.keyFor(intentOf(`correct:${load.status}`, values)),
      },
      {
        onSuccess: () => {
          keys.clear();
          onOpenChange(false);
          form.reset({ to: "", reason: "" });
        },
      },
    ),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) form.reset({ to: targets[0] ?? "", reason: "" });
        else action.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent
        title="Correct the status"
        description={`Move the load back from "${LOAD_RECORD_STATUS[load.status].label}" when it was set by mistake. The correction and your reason are kept in the audit log.`}
      >
        <form onSubmit={(e) => void submit(e)} className="mt-4 space-y-3">
          <Field label="Go back to" htmlFor={`${id}-to`} required error={errors.to?.message}>
            <select id={`${id}-to`} className={SELECT} {...form.register("to")}>
              {targets.map((status) => (
                <option key={status} value={status}>
                  {LOAD_RECORD_STATUS[status].label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Reason" htmlFor={`${id}-reason`} required error={errors.reason?.message}>
            <Textarea id={`${id}-reason`} rows={3} {...form.register("reason")} aria-invalid={Boolean(errors.reason)} />
          </Field>
          {action.error ? (
            <p role="alert" className="text-[0.8125rem] text-st-danger">
              {action.error.message}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button type="submit" variant="primary" disabled={action.isPending}>
              {action.isPending ? "Correcting…" : "Correct status"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
