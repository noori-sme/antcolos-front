"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { listFleet } from "@/lib/api/mock/truck-registry";
import { useTruckContext } from "@/features/fleet/use-truck-context";
import { MEMBER_JURISDICTIONS } from "@/lib/fuel/jurisdictions";
import { parseMiles } from "@/lib/fuel/units";
import { useFuelAction } from "./hooks";

const SELECT =
  "h-control w-full rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg shadow-e1 hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35";

/**
 * Recording a stretch of travel inside one jurisdiction.
 *
 * Total and taxable miles are asked for separately, and taxable defaults to
 * total rather than being computed from it: toll miles and jurisdiction
 * exemptions are the difference, and Antcolos has no way to know about either.
 */
export function RecordMileageDialog({ onClose }: { onClose: () => void }) {
  const truckCtx = useTruckContext();
  const action = useFuelAction();

  const { data: fleet } = useQuery({
    queryKey: ["fuel", "mileage", "fleet", truckCtx?.organizationId],
    queryFn: () => listFleet(truckCtx!),
    enabled: Boolean(truckCtx),
  });

  const [truckId, setTruckId] = useState("");
  const [jurisdiction, setJurisdiction] = useState("IL");
  const [startedAt, setStartedAt] = useState(() =>
    new Date(Date.now() - 4 * 3_600_000).toISOString().slice(0, 16),
  );
  const [endedAt, setEndedAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [totalMiles, setTotalMiles] = useState("");
  const [taxableMiles, setTaxableMiles] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const total = parseMiles(totalMiles);
    const taxable = taxableMiles.trim() ? parseMiles(taxableMiles) : total;

    if (!truckId) return setError("Choose the truck these miles were run on.");
    if (total === null) return setError("Total miles must be a whole number.");
    if (taxable === null) return setError("Taxable miles must be a whole number.");
    if (taxable > total) return setError("Taxable miles cannot exceed the total run in the jurisdiction.");

    try {
      await action.mutateAsync({
        kind: "record_mileage",
        input: {
          truckId,
          jurisdiction,
          travelStartedAt: new Date(startedAt).toISOString(),
          travelEndedAt: new Date(endedAt).toISOString(),
          totalMiles: total,
          taxableMiles: taxable,
          notes: notes.trim() || undefined,
        },
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The mileage could not be recorded.");
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="Record jurisdiction mileage"
        description="One continuous stretch inside one jurisdiction. Split a trip that crosses a line into one record per side."
        className="max-h-[calc(100vh-3rem)] max-w-lg overflow-y-auto"
      >
        <div className="mt-4 space-y-3.5">
          <Field label="Truck" htmlFor="mileage-truck">
            <select id="mileage-truck" className={SELECT} value={truckId} onChange={(e) => setTruckId(e.target.value)}>
              <option value="">Choose a truck…</option>
              {(fleet ?? []).map((t) => (
                <option key={t.truckId} value={t.truckId}>Unit {t.unit}</option>
              ))}
            </select>
          </Field>

          <Field label="Jurisdiction" htmlFor="mileage-jurisdiction">
            <select
              id="mileage-jurisdiction"
              className={SELECT}
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value)}
            >
              {MEMBER_JURISDICTIONS.map((j) => (
                <option key={j.code} value={j.code}>{j.code} — {j.name}</option>
              ))}
            </select>
          </Field>

          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="Entered the jurisdiction" htmlFor="mileage-start">
              <Input id="mileage-start" type="datetime-local" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} />
            </Field>
            <Field label="Left the jurisdiction" htmlFor="mileage-end">
              <Input id="mileage-end" type="datetime-local" value={endedAt} onChange={(e) => setEndedAt(e.target.value)} />
            </Field>
          </div>

          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="Total miles" htmlFor="mileage-total" hint="Every mile run inside the jurisdiction.">
              <Input id="mileage-total" inputMode="numeric" value={totalMiles} onChange={(e) => setTotalMiles(e.target.value)} />
            </Field>
            <Field
              label="Taxable miles"
              htmlFor="mileage-taxable"
              hint="Leave blank if the same as total. Toll miles and exemptions are what make it lower."
            >
              <Input id="mileage-taxable" inputMode="numeric" value={taxableMiles} onChange={(e) => setTaxableMiles(e.target.value)} />
            </Field>
          </div>

          <Field label="Note" htmlFor="mileage-notes" hint="Optional.">
            <Textarea id="mileage-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>

          {error ? (
            <p role="alert" className="rounded-md border border-st-danger/30 bg-st-danger-bg/50 px-3 py-2 text-[0.8125rem] text-st-danger">
              {error}
            </p>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={action.isPending}>
            {action.isPending ? "Recording…" : "Record mileage"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
