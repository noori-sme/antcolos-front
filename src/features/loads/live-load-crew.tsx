"use client";

import { Truck as TruckIcon } from "lucide-react";
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { Can } from "@/components/auth/can";
import { TruckOperationalBadge } from "@/components/common/status-badge";
import { LoadingSkeleton } from "@/components/data/states";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { equipmentLabel } from "@/lib/load-records/format";
import { useCan } from "@/lib/session/hooks";
import type { LoadRecord, LoadRecordStatus } from "@/types/load-record";
import { useBookableTrucks, useLoadAction, useLoadIntentKey, useLoadTruck } from "./hooks";
import { DriverCard } from "./live-load-driver";

/** A truck or driver changes only before the trip starts (contract §9, §10). */
const BEFORE_TRIP: readonly LoadRecordStatus[] = [
  "booked", "rc_received", "driver_assigned", "driver_accepted",
];

export const SELECT =
  "h-control w-full rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg shadow-e1 hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35";

/**
 * The truck and the driver on a load (F1.3, plan 15): who and what, and the
 * actions to book, assign, take off and record the driver's answer.
 */
export function LiveLoadCrew({ load }: { load: LoadRecord }) {
  const editable = BEFORE_TRIP.includes(load.status);
  return (
    <section aria-labelledby="load-crew" className="space-y-2.5">
      <h2 id="load-crew" className="text-[0.9375rem] font-semibold text-fg">
        Truck & driver
      </h2>
      <div className="grid gap-2 sm:grid-cols-2">
        <TruckCard load={load} editable={editable} />
        <DriverCard load={load} editable={editable} />
      </div>
    </section>
  );
}

export function CrewCard({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
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

/** A small inline error with a retry, for a card or a dialog. */
export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <p role="alert" className="text-[0.8125rem] text-st-danger">
      {message}{" "}
      {onRetry ? (
        <Button size="sm" variant="link" className="h-auto p-0" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </p>
  );
}

function TruckCard({ load, editable }: { load: LoadRecord; editable: boolean }) {
  const canSeeTrucks = useCan("trucks:view");
  const truck = useLoadTruck(canSeeTrucks ? load.truckId : null);
  const action = useLoadAction(load.id);
  const keys = useLoadIntentKey();
  const [open, setOpen] = useState(false);
  const takeOff = () =>
    action.mutate(
      { action: { kind: "unbookTruck" }, idempotencyKey: keys.keyFor(`unbook:${load.truckId}`) },
      { onSuccess: () => keys.clear() },
    );

  return (
    <CrewCard icon={<TruckIcon className="size-3.5" aria-hidden />} title="Truck">
      {!load.truckId ? (
        <p className="text-[0.875rem] text-fg-muted">No truck booked.</p>
      ) : !canSeeTrucks ? (
        <p className="text-[0.875rem] text-fg">A truck is booked.</p>
      ) : truck.isPending ? (
        <LoadingSkeleton rows={1} />
      ) : truck.isError ? (
        <InlineError message="Couldn't load the truck." onRetry={() => void truck.refetch()} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/fleet/trucks/${truck.data.id}`} className="text-[0.9375rem] font-medium text-fg hover:underline">
              Unit {truck.data.unitNumber ?? truck.data.operating?.unitNumber ?? truck.data.vin}
            </Link>
            {truck.data.operationalStatus ? <TruckOperationalBadge status={truck.data.operationalStatus} /> : null}
          </div>
          <p className="text-[0.8125rem] text-fg-muted">
            {truck.data.equipmentType ? equipmentLabel(truck.data.equipmentType) : "Equipment not set"}
          </p>
        </>
      )}
      {action.error ? <InlineError message={action.error.message} /> : null}
      {editable ? (
        <Can permission="loads:edit">
          <div className="flex flex-wrap gap-2">
            {load.truckId ? (
              <ConfirmDialog
                title="Take the truck off this load?"
                description="The truck becomes available for other loads."
                confirmLabel="Take it off"
                destructive
                onConfirm={takeOff}
                trigger={<Button size="sm" variant="ghost" disabled={action.isPending}>Take truck off</Button>}
              />
            ) : (
              <Can permission="trucks:view">
                <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
                  Book a truck
                </Button>
              </Can>
            )}
          </div>
          {open ? <BookTruckDialog load={load} onClose={() => setOpen(false)} /> : null}
        </Can>
      ) : null}
    </CrewCard>
  );
}

/** Mounted only while open, so a reopened dialog starts clean. */
function BookTruckDialog({ load, onClose }: { load: LoadRecord; onClose: () => void }) {
  const trucks = useBookableTrucks(true);
  const action = useLoadAction(load.id);
  const keys = useLoadIntentKey();
  const id = useId();
  const [truckId, setTruckId] = useState("");
  const choices = trucks.data?.data ?? [];
  // A choice that left the list (booked elsewhere) cannot be submitted.
  const chosen = choices.some((t) => t.id === truckId);

  const book = () =>
    action.mutate(
      { action: { kind: "bookTruck", truckId }, idempotencyKey: keys.keyFor(`book:${truckId}`) },
      { onSuccess: () => { keys.clear(); onClose(); } },
    );

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        title={`Book a truck for ${load.brokerLoadNumber}`}
        description="Only available trucks are listed. The truck then moves with this load."
      >
        <div className="mt-4 space-y-3">
          {trucks.isPending ? (
            <LoadingSkeleton rows={2} />
          ) : trucks.isError ? (
            <InlineError message={trucks.error.message} onRetry={() => void trucks.refetch()} />
          ) : choices.length === 0 ? (
            <p className="text-[0.875rem] text-fg-muted">
              No truck is available right now. Mark one available in{" "}
              <Link href="/fleet/trucks" className="text-primary underline-offset-4 hover:underline">Fleet</Link>.
            </p>
          ) : (
            <Field label="Truck" htmlFor={`${id}-truck`} required>
              <select id={`${id}-truck`} className={SELECT} value={chosen ? truckId : ""} onChange={(e) => setTruckId(e.target.value)}>
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
          {action.error ? <InlineError message={action.error.message} /> : null}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
            <Button variant="primary" disabled={!chosen || action.isPending} onClick={book}>
              {action.isPending ? "Booking…" : "Book truck"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
