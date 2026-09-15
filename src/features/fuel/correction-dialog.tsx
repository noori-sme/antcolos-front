"use client";

import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MEMBER_JURISDICTIONS } from "@/lib/fuel/jurisdictions";
import { formatGallons, parseCents, parseGallons, parseMiles, parsePriceMills } from "@/lib/fuel/units";
import type { FuelTransaction } from "@/types";
import { useFuelAction } from "./hooks";

const SELECT =
  "h-control w-full rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg shadow-e1 hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35";

/**
 * Correcting a purchase.
 *
 * The dialog says plainly what is about to happen — a new revision, the
 * original kept — because an operator who thinks they are editing a row will
 * not understand why the old figure is still on the screen afterwards.
 *
 * The truck and the carrier are not offered. A purchase against the wrong
 * truck is a rejection and a fresh record, and attribution is never a field
 * anybody types.
 */
export function CorrectionDialog({
  transaction,
  onClose,
}: {
  transaction: FuelTransaction;
  onClose: () => void;
}) {
  const action = useFuelAction();
  const [reason, setReason] = useState("");
  const [gallons, setGallons] = useState(formatGallons(transaction.gallonsThousandths, { unit: false }));
  const [price, setPrice] = useState(
    transaction.cost ? (transaction.cost.pricePerGallonMills / 1000).toFixed(3) : "",
  );
  const [total, setTotal] = useState(
    transaction.cost ? (transaction.cost.totalCostCents / 100).toFixed(2) : "",
  );
  const [jurisdiction, setJurisdiction] = useState(transaction.location.jurisdiction);
  const [odometer, setOdometer] = useState(
    transaction.odometerMiles !== undefined ? String(transaction.odometerMiles) : "",
  );
  const [error, setError] = useState<string | null>(null);

  const costEditable = transaction.cost !== undefined;

  const submit = async () => {
    setError(null);
    if (!reason.trim()) return setError("A correction needs a reason. It becomes part of the record.");

    const parsedGallons = parseGallons(gallons);
    if (parsedGallons === null || parsedGallons <= 0) return setError("Gallons must be a number, to three decimals at most.");

    const parsedPrice = costEditable ? parsePriceMills(price) : undefined;
    const parsedTotal = costEditable ? parseCents(total) : undefined;
    if (costEditable && (parsedPrice === null || parsedTotal === null)) {
      return setError("Price and total must be amounts.");
    }
    const parsedOdometer = odometer.trim() ? parseMiles(odometer) : undefined;
    if (odometer.trim() && parsedOdometer === null) return setError("The odometer reading must be a whole number of miles.");

    try {
      await action.mutateAsync({
        kind: "correct",
        id: transaction.id,
        input: {
          reason: reason.trim(),
          gallonsThousandths: parsedGallons,
          pricePerGallonMills: parsedPrice ?? undefined,
          totalCostCents: parsedTotal ?? undefined,
          odometerMiles: parsedOdometer ?? undefined,
          location:
            jurisdiction === transaction.location.jurisdiction
              ? undefined
              : {
                  ...transaction.location,
                  jurisdiction,
                  address: { ...transaction.location.address, state: jurisdiction },
                },
        },
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The correction could not be recorded.");
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="Correct this purchase"
        description="This does not change the existing record. It writes a new revision that supersedes it, and both stay readable with your reason attached."
        className="max-h-[calc(100vh-3rem)] max-w-lg overflow-y-auto"
      >
        <div className="mt-4 space-y-3.5">
          <Field
            label="Why"
            htmlFor="correction-reason"
            hint="Goes onto the record and into the audit trail. Somebody will read it in an audit."
          >
            <Textarea
              id="correction-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Gallons were keyed in with the decimal point one place out."
            />
          </Field>

          <Field label="Gallons" htmlFor="correction-gallons">
            <Input id="correction-gallons" inputMode="decimal" value={gallons} onChange={(e) => setGallons(e.target.value)} />
          </Field>

          {costEditable ? (
            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field label="Price / gal" htmlFor="correction-price">
                <Input id="correction-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
              </Field>
              <Field label="Total" htmlFor="correction-total">
                <Input id="correction-total" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} />
              </Field>
            </div>
          ) : (
            <p className="rounded-md border border-border bg-surface-sunken px-3 py-2 text-[0.75rem] text-fg-muted">
              You do not have permission to see or change what this purchase cost, so the money on
              it is left exactly as it is.
            </p>
          )}

          <Field
            label="Jurisdiction"
            htmlFor="correction-jurisdiction"
            hint="Changing this moves the tax-paid gallons to a different jurisdiction on the return."
          >
            <select
              id="correction-jurisdiction"
              className={SELECT}
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value)}
            >
              {MEMBER_JURISDICTIONS.map((j) => (
                <option key={j.code} value={j.code}>{j.code} — {j.name}</option>
              ))}
            </select>
          </Field>

          <Field label="Odometer" htmlFor="correction-odometer" hint="Optional.">
            <Input id="correction-odometer" inputMode="numeric" value={odometer} onChange={(e) => setOdometer(e.target.value)} />
          </Field>

          {error ? (
            <p role="alert" className="rounded-md border border-st-danger/30 bg-st-danger-bg/50 px-3 py-2 text-[0.8125rem] text-st-danger">
              {error}
            </p>
          ) : null}

          <p className="text-[0.75rem] leading-relaxed text-fg-subtle">
            The truck and the carrier this purchase belongs to are not editable. If the wrong truck
            was recorded, reject this purchase and record the right one — moving attribution after
            the fact is how a filed quarter stops matching what was filed.
          </p>
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
