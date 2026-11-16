"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Can } from "@/components/auth/can";
import { LoadingSkeleton } from "@/components/data/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { intentOf } from "@/lib/load-records/forms";
import { useCan } from "@/lib/session/hooks";
import type { LoadRecord } from "@/types/load-record";
import { useDriverOptions, useLoadAction, useLoadDriver, useLoadIntentKey } from "./hooks";
import { CrewCard, InlineError, SELECT } from "./live-load-crew";

const WHEN = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
});

const rejectSchema = z.object({
  reason: z.string().trim().min(1, "Say why the driver turned it down.").max(500, "Keep it under 500 characters."),
});

/** The driver on a load and what may be done about them (F1.3, plan 15). */
export function DriverCard({ load, editable }: { load: LoadRecord; editable: boolean }) {
  const canSeeDrivers = useCan("members:list_drivers");
  const driver = useLoadDriver(canSeeDrivers ? load.driverUserId : null);
  const action = useLoadAction(load.id);
  const keys = useLoadIntentKey();
  const [dialog, setDialog] = useState<"assign" | "reject" | null>(null);
  const simple = (kind: "unassignDriver" | "acceptForDriver") =>
    action.mutate(
      { action: { kind }, idempotencyKey: keys.keyFor(`${kind}:${load.driverUserId}`) },
      // An error shows in this card (action.error below).
      { onSuccess: () => keys.clear() },
    );

  return (
    <CrewCard icon={<UserRound className="size-3.5" aria-hidden />} title="Driver">
      {!load.driverUserId ? (
        <p className="text-[0.875rem] text-fg-muted">No driver assigned.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {!canSeeDrivers ? (
              <span className="text-[0.9375rem] text-fg">A driver is assigned</span>
            ) : driver.isPending ? (
              <LoadingSkeleton rows={1} />
            ) : driver.isError ? (
              <InlineError message="Couldn't load the driver." onRetry={() => void driver.refetch()} />
            ) : (
              <span className="text-[0.9375rem] font-medium text-fg">{driver.data.name}</span>
            )}
            {load.driverAcceptedAt ? (
              <Badge tone="success">Accepted</Badge>
            ) : load.status === "driver_assigned" ? (
              <Badge tone="warning">Waiting for an answer</Badge>
            ) : null}
          </div>
          <p className="text-[0.8125rem] text-fg-muted">
            {driver.data?.phone ? `${driver.data.phone} · ` : ""}
            {load.driverAcceptedAt
              ? `accepted ${WHEN.format(new Date(load.driverAcceptedAt))}`
              : load.driverAssignedAt
                ? `assigned ${WHEN.format(new Date(load.driverAssignedAt))}`
                : ""}
          </p>
        </>
      )}
      {action.error ? <InlineError message={action.error.message} /> : null}
      {editable ? (
        <Can permission="loads:edit">
          <div className="flex flex-wrap gap-2">
            {load.driverUserId && load.status === "driver_assigned" ? (
              <Can permission="loads:respond">
                <Button size="sm" variant="secondary" disabled={action.isPending} onClick={() => simple("acceptForDriver")}>
                  Driver accepted
                </Button>
                <Button size="sm" variant="secondary" disabled={action.isPending} onClick={() => setDialog("reject")}>
                  Driver turned it down
                </Button>
              </Can>
            ) : null}
            <Can permission="members:list_drivers">
              <Button
                size="sm"
                variant={load.driverUserId ? "ghost" : "secondary"}
                disabled={action.isPending}
                onClick={() => setDialog("assign")}
              >
                {load.driverUserId ? "Change driver" : "Assign a driver"}
              </Button>
            </Can>
            {load.driverUserId ? (
              <ConfirmDialog
                title="Take the driver off this load?"
                description="The load goes back to waiting for a driver."
                confirmLabel="Take them off"
                destructive
                onConfirm={() => simple("unassignDriver")}
                trigger={<Button size="sm" variant="ghost" disabled={action.isPending}>Take driver off</Button>}
              />
            ) : null}
          </div>
          {dialog === "assign" ? <AssignDriverDialog load={load} onClose={() => setDialog(null)} /> : null}
          {dialog === "reject" ? <RejectDialog load={load} onClose={() => setDialog(null)} /> : null}
        </Can>
      ) : null}
    </CrewCard>
  );
}

/** Search waits for a pause in typing before asking the API. */
function useDebounced(value: string, ms = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** Mounted only while open, so a reopened dialog starts clean. */
function AssignDriverDialog({ load, onClose }: { load: LoadRecord; onClose: () => void }) {
  const [q, setQ] = useState("");
  const drivers = useDriverOptions(useDebounced(q), true);
  const action = useLoadAction(load.id);
  const keys = useLoadIntentKey();
  const id = useId();
  const [userId, setUserId] = useState("");
  const choices = (drivers.data?.data ?? []).filter((d) => d.userId !== load.driverUserId);
  // A choice no longer in the (searched) list cannot be submitted.
  const chosen = choices.some((d) => d.userId === userId);

  const assign = () =>
    action.mutate(
      { action: { kind: "assignDriver", userId }, idempotencyKey: keys.keyFor(`assign:${userId}`) },
      { onSuccess: () => { keys.clear(); onClose(); } },
    );

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        title={load.driverUserId ? "Change the driver" : "Assign a driver"}
        description="Active drivers of this organization. Assigning a new driver resets the acceptance."
      >
        <div className="mt-4 space-y-3">
          <Field label="Search drivers" htmlFor={`${id}-q`}>
            <Input id={`${id}-q`} value={q} onChange={(e) => { setQ(e.target.value); setUserId(""); }} placeholder="Name" />
          </Field>
          {drivers.isPending ? (
            <LoadingSkeleton rows={2} />
          ) : drivers.isError ? (
            <InlineError message={drivers.error.message} onRetry={() => void drivers.refetch()} />
          ) : choices.length === 0 ? (
            <p className="text-[0.875rem] text-fg-muted">
              No driver found. Invite one in{" "}
              <Link href="/people/drivers" className="text-primary underline-offset-4 hover:underline">Drivers</Link>.
            </p>
          ) : (
            <Field label="Driver" htmlFor={`${id}-driver`} required>
              <select id={`${id}-driver`} className={SELECT} value={chosen ? userId : ""} onChange={(e) => setUserId(e.target.value)}>
                <option value="">Choose a driver</option>
                {choices.map((d) => (
                  <option key={d.userId} value={d.userId}>
                    {d.name}{d.phone ? ` · ${d.phone}` : ""}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {action.error ? <InlineError message={action.error.message} /> : null}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
            <Button variant="primary" disabled={!chosen || action.isPending} onClick={assign}>
              {action.isPending ? "Assigning…" : "Assign driver"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({ load, onClose }: { load: LoadRecord; onClose: () => void }) {
  const action = useLoadAction(load.id);
  const keys = useLoadIntentKey();
  const id = useId();
  const form = useForm<z.infer<typeof rejectSchema>>({
    resolver: zodResolver(rejectSchema),
    defaultValues: { reason: "" },
  });
  const submit = form.handleSubmit((values) =>
    action.mutate(
      { action: { kind: "rejectForDriver", reason: values.reason }, idempotencyKey: keys.keyFor(intentOf("reject", values)) },
      { onSuccess: () => { keys.clear(); onClose(); } },
    ),
  );
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        title="The driver turned the load down"
        description={`They come off ${load.brokerLoadNumber}, and the load waits for another driver. The reason is kept on the timeline.`}
      >
        <form onSubmit={(e) => void submit(e)} className="mt-4 space-y-3">
          <Field label="Reason" htmlFor={`${id}-reason`} required error={form.formState.errors.reason?.message}>
            <Textarea id={`${id}-reason`} rows={3} {...form.register("reason")} />
          </Field>
          {action.error ? <InlineError message={action.error.message} /> : null}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
            <Button type="submit" variant="danger" disabled={action.isPending}>
              {action.isPending ? "Saving…" : "Record it"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
