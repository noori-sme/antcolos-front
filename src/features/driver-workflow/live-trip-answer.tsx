"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import type { DriverLoad } from "@/types/driver-load";
import { useDriverLoadAction, useIntentKeys } from "./hooks";

const rejectSchema = z.object({
  reason: z.string().trim().min(1, "Tell dispatch why.").max(500, "Keep it under 500 characters."),
});

/** Accept or turn down a load dispatch assigned (contract §10). */
export function DriverAnswerCard({ load }: { load: DriverLoad }) {
  const action = useDriverLoadAction(load.id);
  const keys = useIntentKeys();
  const [rejecting, setRejecting] = useState(false);
  const accept = () =>
    action.mutate(
      { action: { kind: "accept" }, idempotencyKey: keys.keyFor("accept") },
      { onSuccess: () => keys.clear() },
    );
  return (
    <section aria-labelledby="driver-answer" className="space-y-2 rounded-lg border border-primary bg-surface px-4 py-3.5 shadow-e1">
      <h2 id="driver-answer" className="text-[0.9375rem] font-semibold text-fg">Dispatch assigned you this load</h2>
      <p className="text-[0.8125rem] text-fg-muted">Accept it, or turn it down and say why.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="primary" className="h-11" disabled={action.isPending} onClick={accept}>
          {action.isPending ? "Saving…" : "Accept load"}
        </Button>
        <Button variant="secondary" className="h-11" disabled={action.isPending} onClick={() => setRejecting(true)}>
          Turn it down
        </Button>
      </div>
      {action.error ? <p role="alert" className="text-[0.8125rem] text-st-danger">{action.error.message}</p> : null}
      {rejecting ? <RejectDialog load={load} onClose={() => setRejecting(false)} /> : null}
    </section>
  );
}

function RejectDialog({ load, onClose }: { load: DriverLoad; onClose: () => void }) {
  const action = useDriverLoadAction(load.id);
  const keys = useIntentKeys();
  const id = useId();
  const form = useForm<z.infer<typeof rejectSchema>>({
    resolver: zodResolver(rejectSchema),
    defaultValues: { reason: "" },
  });
  const submit = form.handleSubmit((values) =>
    action.mutate(
      { action: { kind: "reject", reason: values.reason }, idempotencyKey: keys.keyFor(`reject:${values.reason.trim()}`) },
      { onSuccess: () => { keys.clear(); onClose(); } },
    ),
  );
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent title="Turn down this load" description={`You come off load ${load.brokerLoadNumber}. Dispatch sees your reason.`}>
        <form onSubmit={(e) => void submit(e)} className="mt-4 space-y-3">
          <Field label="Reason" htmlFor={`${id}-reason`} required error={form.formState.errors.reason?.message}>
            <Textarea id={`${id}-reason`} rows={3} {...form.register("reason")} />
          </Field>
          {action.error ? <p role="alert" className="text-[0.8125rem] text-st-danger">{action.error.message}</p> : null}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
            <Button type="submit" variant="danger" disabled={action.isPending}>
              {action.isPending ? "Saving…" : "Turn it down"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
