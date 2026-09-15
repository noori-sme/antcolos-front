"use client";

import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MEMBER_JURISDICTIONS } from "@/lib/fuel/jurisdictions";
import { parseMiles } from "@/lib/fuel/units";
import type { JurisdictionMileageRecord } from "@/types";
import { useFuelAction } from "./hooks";

const SELECT =
  "h-control w-full rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg shadow-e1 hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35";

/** Same rule as a fuel correction: a new revision, the original kept. */
export function CorrectMileageDialog({
  record,
  onClose,
}: {
  record: JurisdictionMileageRecord;
  onClose: () => void;
}) {
  const action = useFuelAction();
  const [reason, setReason] = useState("");
  const [jurisdiction, setJurisdiction] = useState(record.jurisdiction);
  const [totalMiles, setTotalMiles] = useState(String(record.totalMiles));
  const [taxableMiles, setTaxableMiles] = useState(String(record.taxableMiles));
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!reason.trim()) return setError("A correction needs a reason. It becomes part of the record.");
    const total = parseMiles(totalMiles);
    const taxable = parseMiles(taxableMiles);
    if (total === null || taxable === null) return setError("Miles must be whole numbers.");
    if (taxable > total) return setError("Taxable miles cannot exceed the total run in the jurisdiction.");

    try {
      await action.mutateAsync({
        kind: "correct_mileage",
        id: record.id,
        input: { reason: reason.trim(), jurisdiction, totalMiles: total, taxableMiles: taxable },
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The correction could not be recorded.");
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="Correct this mileage record"
        description="The existing record is kept and marked superseded. This writes a new revision with your reason attached."
        className="max-w-lg"
      >
        <div className="mt-4 space-y-3.5">
          <Field label="Why" htmlFor="mileage-correction-reason">
            <Textarea
              id="mileage-correction-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="The ELD sent a revised total after the segment closed."
            />
          </Field>

          <Field label="Jurisdiction" htmlFor="mileage-correction-jurisdiction">
            <select
              id="mileage-correction-jurisdiction"
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
            <Field label="Total miles" htmlFor="mileage-correction-total">
              <Input id="mileage-correction-total" inputMode="numeric" value={totalMiles} onChange={(e) => setTotalMiles(e.target.value)} />
            </Field>
            <Field label="Taxable miles" htmlFor="mileage-correction-taxable">
              <Input id="mileage-correction-taxable" inputMode="numeric" value={taxableMiles} onChange={(e) => setTaxableMiles(e.target.value)} />
            </Field>
          </div>

          {error ? (
            <p role="alert" className="rounded-md border border-st-danger/30 bg-st-danger-bg/50 px-3 py-2 text-[0.8125rem] text-st-danger">
              {error}
            </p>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={action.isPending}>
            {action.isPending ? "Recording…" : "Write the correction"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
