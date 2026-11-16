"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Truck as TruckIcon, UserRound } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Can } from "@/components/auth/can";
import { TruckOperationalBadge } from "@/components/common/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { equipmentLabel } from "@/lib/load-records/format";
import { intentOf } from "@/lib/load-records/forms";
import type { LoadRecord, LoadRecordStatus } from "@/types/load-record";
import {
  useBookableTrucks, useDriverOptions, useLoadAction, useLoadDriver, useLoadIntentKey,
  useLoadTruck,
} from "./hooks";

/** A truck or driver changes only before the trip starts (contract §9, §10). */
const BEFORE_TRIP: readonly LoadRecordStatus[] = [
  "booked", "rc_received", "driver_assigned", "driver_accepted",
];

const WHEN = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
});

const SELECT =
  "h-control w-full rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg shadow-e1 hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35";

const rejectSchema = z.object({
  reason: z.string().trim().min(1, "Say why the driver turned it down.").max(500, "Keep it under 500 characters."),
});

/**
 * The truck and the driver on a load (F1.3, plan 15): who and what, and the
 * actions to book, assign, take off and record the driver's answer.
 */
export function LiveLoadCrew({ load }: { load: LoadRecord }) {
  const action = useLoadAction(load.id);
  const editable = BEFORE_TRIP.includes(load.status);
  return (
    <section aria-labelledby="load-crew" className="space-y-2.5">
      <h2 id="load-crew" className="text-[0.9375rem] font-semibold text-fg">
        Truck & driver
      </h2>
      <div className="grid gap-2 sm:grid-cols-2">
        <TruckCard load={load} editable={editable} action={action} />
        <DriverCard load={load} editable={editable} action={action} />
      </div>
      {action.error ? (
        <p role="alert" className="text-[0.8125rem] text-st-danger">
          {action.error.message}
        </p>
      ) : null}
    </section>
  );
}

type Action = ReturnType<typeof useLoadAction>;

function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3 shadow-e1">
      <p className="flex items-center gap-1.5 text-[0.75rem] font-medium text-fg-muted">
        {icon}
        {title}
      </p>
      <div className="mt-1.5 space-y-2">{children}</div>
    </div>
  );
}

function TruckCard({ load, editable, action }: { load: LoadRecord; editable: boolean; action: Action }) {
  const truck = useLoadTruck(load.truckId);
  const keys = useLoadIntentKey();
  const [open, setOpen] = useState(false);
  const run = (kind: "unbookTruck") =>
    action.mutateAsync({ action: { kind }, idempotencyKey: keys.keyFor(`${kind}:${load.truckId}`) })
      .then(() => keys.clear())
      .catch(() => {});

  return (
    <Card icon={<TruckIcon className="size-3.5" aria-hidden />} title="Truck">
      {load.truckId ? (
        truck.isPending ? (
          <p className="text-[0.875rem] text-fg-muted">Loading…</p>
        ) : truck.data ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/fleet/trucks/${truck.data.id}`}
                className="text-[0.9375rem] font-medium text-fg hover:underline"
              >
                Unit {truck.data.unitNumber ?? truck.data.operating?.unitNumber ?? truck.data.vin}
              </Link>
              {truck.data.operationalStatus ? (
                <TruckOperationalBadge status={truck.data.operationalStatus} />
              ) : null}
            </div>
            <p className="text-[0.8125rem] text-fg-muted">
              {truck.data.equipmentType ? equipmentLabel(truck.data.equipmentType) : "Equipment not set"}
            </p>
          </>
        ) : (
          <p className="text-[0.875rem] text-fg-muted">This truck can&apos;t be shown ({truck.error?.message}).</p>
        )
      ) : (
        <p className="text-[0.875rem] text-fg-muted">No truck booked.</p>
      )}
      {editable ? (
        <Can permission="loads:edit">
          <div className="flex flex-wrap gap-2">
            {load.truckId ? (
              <ConfirmDialog
                title="Take the truck off this load?"
                description="The truck becomes available for other loads."
                confirmLabel="Take it off"
                destructive
                onConfirm={() => run("unbookTruck")}
                trigger={<Button size="sm" variant="ghost" disabled={action.isPending}>Take truck off</Button>}
              />
            ) : (
              <Button size="sm" variant="secondary" disabled={action.isPending} onClick={() => setOpen(true)}>
                Book a truck
              </Button>
            )}
          </div>
          <BookTruckDialog load={load} open={open} onOpenChange={setOpen} action={action} />
        </Can>
      ) : null}
    </Card>
  );
}

function BookTruckDialog({
  load, open, onOpenChange, action,
}: { load: LoadRecord; open: boolean; onOpenChange: (open: boolean) => void; action: Action }) {
  const trucks = useBookableTrucks(open);
  const keys = useLoadIntentKey();
  const id = useId();
  const [truckId, setTruckId] = useState("");
  const choices = trucks.data?.data ?? [];

  const book = () =>
    action.mutate(
      { action: { kind: "bookTruck", truckId }, idempotencyKey: keys.keyFor(`book:${truckId}`) },
      { onSuccess: () => { keys.clear(); onOpenChange(false); setTruckId(""); } },
    );

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) action.reset(); onOpenChange(next); }}>
      <DialogContent
        title={`Book a truck for ${load.brokerLoadNumber}`}
        description="Only available trucks are listed. The truck then moves with this load."
      >
        <div className="mt-4 space-y-3">
          {trucks.isPending ? (
            <p className="text-[0.875rem] text-fg-muted">Loading trucks…</p>
          ) : trucks.isError ? (
            <p role="alert" className="text-[0.8125rem] text-st-danger">{trucks.error.message}</p>
          ) : choices.length === 0 ? (
            <p className="text-[0.875rem] text-fg-muted">
              No truck is available right now. Mark one available in{" "}
              <Link href="/fleet/trucks" className="text-primary underline-offset-4 hover:underline">Fleet</Link>.
            </p>
          ) : (
            <Field label="Truck" htmlFor={`${id}-truck`} required>
              <select
                id={`${id}-truck`}
                className={SELECT}
                value={truckId}
                onChange={(e) => setTruckId(e.target.value)}
              >
                <option value="">Choose a truck</option>
                {choices.map((t) => (
                  <option key={t.id} value={t.id}>
                    Unit {t.unitNumber ?? t.operating?.unitNumber ?? t.vin}
                    {t.equipmentType ? ` · ${equipmentLabel(t.equipmentType)}` : ""}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {action.error ? (
            <p role="alert" className="text-[0.8125rem] text-st-danger">{action.error.message}</p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
            <Button variant="primary" disabled={!truckId || action.isPending} onClick={book}>
              {action.isPending ? "Booking…" : "Book truck"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DriverCard({ load, editable, action }: { load: LoadRecord; editable: boolean; action: Action }) {
  const driver = useLoadDriver(load.driverUserId);
  const keys = useLoadIntentKey();
  const [assignOpen, setAssignOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const simple = (kind: "unassignDriver" | "acceptForDriver") =>
    action.mutateAsync({ action: { kind }, idempotencyKey: keys.keyFor(`${kind}:${load.driverUserId}`) })
      .then(() => keys.clear())
      .catch(() => {});

  return (
    <Card icon={<UserRound className="size-3.5" aria-hidden />} title="Driver">
      {load.driverUserId ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[0.9375rem] font-medium text-fg">
              {driver.data?.name ?? (driver.isPending ? "Loading…" : "A driver")}
            </span>
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
      ) : (
        <p className="text-[0.875rem] text-fg-muted">No driver assigned.</p>
      )}
      {editable ? (
        <Can permission="loads:edit">
          <div className="flex flex-wrap gap-2">
            {load.driverUserId ? (
              <>
                {load.status === "driver_assigned" ? (
                  <Can permission="loads:respond">
                    <Button size="sm" variant="secondary" disabled={action.isPending} onClick={() => void simple("acceptForDriver")}>
                      Driver accepted
                    </Button>
                    <Button size="sm" variant="secondary" disabled={action.isPending} onClick={() => setRejectOpen(true)}>
                      Driver turned it down
                    </Button>
                  </Can>
                ) : null}
                <Button size="sm" variant="ghost" disabled={action.isPending} onClick={() => setAssignOpen(true)}>
                  Change driver
                </Button>
                <ConfirmDialog
                  title="Take the driver off this load?"
                  description="The load goes back to waiting for a driver."
                  confirmLabel="Take them off"
                  destructive
                  onConfirm={() => simple("unassignDriver")}
                  trigger={<Button size="sm" variant="ghost" disabled={action.isPending}>Take driver off</Button>}
                />
              </>
            ) : (
              <Button size="sm" variant="secondary" disabled={action.isPending} onClick={() => setAssignOpen(true)}>
                Assign a driver
              </Button>
            )}
          </div>
          <AssignDriverDialog load={load} open={assignOpen} onOpenChange={setAssignOpen} action={action} />
          <RejectDialog load={load} open={rejectOpen} onOpenChange={setRejectOpen} action={action} />
        </Can>
      ) : null}
    </Card>
  );
}

function AssignDriverDialog({
  load, open, onOpenChange, action,
}: { load: LoadRecord; open: boolean; onOpenChange: (open: boolean) => void; action: Action }) {
  const [q, setQ] = useState("");
  const drivers = useDriverOptions(q, open);
  const keys = useLoadIntentKey();
  const id = useId();
  const [userId, setUserId] = useState("");
  const choices = (drivers.data?.data ?? []).filter((d) => d.userId !== load.driverUserId);

  const assign = () =>
    action.mutate(
      { action: { kind: "assignDriver", userId }, idempotencyKey: keys.keyFor(`assign:${userId}`) },
      { onSuccess: () => { keys.clear(); onOpenChange(false); setUserId(""); } },
    );

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) action.reset(); onOpenChange(next); }}>
      <DialogContent
        title={load.driverUserId ? "Change the driver" : "Assign a driver"}
        description="Active drivers of this organization. Assigning a new driver resets the acceptance."
      >
        <div className="mt-4 space-y-3">
          <Field label="Search drivers" htmlFor={`${id}-q`}>
            <Input id={`${id}-q`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name" />
          </Field>
          {drivers.isPending ? (
            <p className="text-[0.875rem] text-fg-muted">Loading drivers…</p>
          ) : drivers.isError ? (
            <p role="alert" className="text-[0.8125rem] text-st-danger">{drivers.error.message}</p>
          ) : choices.length === 0 ? (
            <p className="text-[0.875rem] text-fg-muted">
              No driver found. Invite one in{" "}
              <Link href="/people/drivers" className="text-primary underline-offset-4 hover:underline">Drivers</Link>.
            </p>
          ) : (
            <Field label="Driver" htmlFor={`${id}-driver`} required>
              <select id={`${id}-driver`} className={SELECT} value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">Choose a driver</option>
                {choices.map((d) => (
                  <option key={d.userId} value={d.userId}>
                    {d.name}{d.phone ? ` · ${d.phone}` : ""}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {action.error ? (
            <p role="alert" className="text-[0.8125rem] text-st-danger">{action.error.message}</p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
            <Button variant="primary" disabled={!userId || action.isPending} onClick={assign}>
              {action.isPending ? "Assigning…" : "Assign driver"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({
  load, open, onOpenChange, action,
}: { load: LoadRecord; open: boolean; onOpenChange: (open: boolean) => void; action: Action }) {
  const keys = useLoadIntentKey();
  const id = useId();
  const form = useForm<z.infer<typeof rejectSchema>>({
    resolver: zodResolver(rejectSchema),
    defaultValues: { reason: "" },
  });
  const submit = form.handleSubmit((values) =>
    action.mutate(
      { action: { kind: "rejectForDriver", reason: values.reason }, idempotencyKey: keys.keyFor(intentOf("reject", values)) },
      { onSuccess: () => { keys.clear(); onOpenChange(false); form.reset(); } },
    ),
  );
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) action.reset(); onOpenChange(next); }}>
      <DialogContent
        title="The driver turned the load down"
        description={`They come off ${load.brokerLoadNumber}, and the load waits for another driver. The reason is kept on the timeline.`}
      >
        <form onSubmit={(e) => void submit(e)} className="mt-4 space-y-3">
          <Field label="Reason" htmlFor={`${id}-reason`} required error={form.formState.errors.reason?.message}>
            <Textarea id={`${id}-reason`} rows={3} {...form.register("reason")} />
          </Field>
          {action.error ? (
            <p role="alert" className="text-[0.8125rem] text-st-danger">{action.error.message}</p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
            <Button type="submit" variant="danger" disabled={action.isPending}>
              {action.isPending ? "Saving…" : "Record it"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
