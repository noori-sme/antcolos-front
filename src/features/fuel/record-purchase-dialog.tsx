"use client";

import { useMemo, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { listFleet } from "@/lib/api/mock/truck-registry";
import { useTruckContext } from "@/features/fleet/use-truck-context";
import { useQuery } from "@tanstack/react-query";
import { MEMBER_JURISDICTIONS } from "@/lib/fuel/jurisdictions";
import { FUEL_TYPE_LABEL } from "@/lib/fuel/labels";
import { parseCents, parseGallons, parseMiles, parsePriceMills } from "@/lib/fuel/units";
import { qualifyForIfta } from "@/lib/fuel/ifta";
import type { FuelType } from "@/types";
import { useFuelAction } from "./hooks";

const SELECT =
  "h-control w-full rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg shadow-e1 hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35";

const FUEL_TYPES: FuelType[] = [
  "diesel", "biodiesel_blend", "gasoline", "def", "propane", "cng", "lng", "electric",
];

/**
 * Recording a purchase by hand.
 *
 * The form asks for what a receipt actually carries and nothing else. It does
 * NOT ask which carrier the fuel belongs to: that is resolved from the
 * operating-authority history at the moment of purchase, and letting somebody
 * pick it in a form is exactly how attribution gets rewritten.
 */
export function RecordPurchaseDialog({ onClose }: { onClose: () => void }) {
  const truckCtx = useTruckContext();
  const action = useFuelAction();

  const { data: fleet } = useQuery({
    queryKey: ["fuel", "record", "fleet", truckCtx?.organizationId],
    queryFn: () => listFleet(truckCtx!),
    enabled: Boolean(truckCtx),
  });

  const [truckId, setTruckId] = useState("");
  const [purchasedAt, setPurchasedAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [jurisdiction, setJurisdiction] = useState("IL");
  const [city, setCity] = useState("");
  const [merchant, setMerchant] = useState("");
  const [fuelType, setFuelType] = useState<FuelType>("diesel");
  const [gallons, setGallons] = useState("");
  const [price, setPrice] = useState("");
  const [total, setTotal] = useState("");
  const [odometer, setOdometer] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const qualification = useMemo(
    () => qualifyForIfta(fuelType, jurisdiction),
    [fuelType, jurisdiction],
  );

  const submit = async () => {
    setError(null);
    const parsedGallons = parseGallons(gallons);
    const parsedPrice = parsePriceMills(price);
    const parsedTotal = parseCents(total);
    const parsedOdometer = odometer.trim() ? parseMiles(odometer) : undefined;

    if (!truckId) return setError("Choose the truck the fuel went into.");
    if (parsedGallons === null || parsedGallons <= 0) return setError("Gallons must be a number, to three decimals at most.");
    if (parsedPrice === null) return setError("Price per gallon must be a number, to three decimals at most.");
    if (parsedTotal === null) return setError("Total must be an amount, to two decimals at most.");
    if (odometer.trim() && parsedOdometer === null) return setError("The odometer reading must be a whole number of miles.");
    if (!city.trim()) return setError("The city on the receipt is needed to place the purchase.");

    try {
      await action.mutateAsync({
        kind: "record",
        input: {
          truckId,
          purchasedAt: new Date(purchasedAt).toISOString(),
          location: {
            jurisdiction,
            address: { city: city.trim(), state: jurisdiction, country: "US" },
            merchantName: merchant.trim() || undefined,
          },
          odometerMiles: parsedOdometer ?? undefined,
          fuelType,
          gallonsThousandths: parsedGallons,
          pricePerGallonMills: parsedPrice,
          totalCostCents: parsedTotal,
          notes: notes.trim() || undefined,
        },
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The purchase could not be recorded.");
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="Record a fuel purchase"
        description="Once recorded, a purchase cannot be edited. A mistake is fixed with a correction, which keeps the original."
        className="max-h-[calc(100vh-3rem)] max-w-lg overflow-y-auto"
      >
        <div className="mt-4 space-y-3.5">
          <Field label="Truck" htmlFor="fuel-truck" hint="Only trucks your organization currently operates.">
            <select
              id="fuel-truck"
              className={SELECT}
              value={truckId}
              onChange={(e) => setTruckId(e.target.value)}
            >
              <option value="">Choose a truck…</option>
              {(fleet ?? []).map((t) => (
                <option key={t.truckId} value={t.truckId}>
                  Unit {t.unit}
                  {t.currentDriverName ? ` · ${t.currentDriverName}` : ""}
                </option>
              ))}
            </select>
          </Field>

          <Field label="When" htmlFor="fuel-at">
            <Input
              id="fuel-at"
              type="datetime-local"
              value={purchasedAt}
              onChange={(e) => setPurchasedAt(e.target.value)}
            />
          </Field>

          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="Jurisdiction" htmlFor="fuel-jurisdiction">
              <select
                id="fuel-jurisdiction"
                className={SELECT}
                value={jurisdiction}
                onChange={(e) => setJurisdiction(e.target.value)}
              >
                {MEMBER_JURISDICTIONS.map((j) => (
                  <option key={j.code} value={j.code}>{j.code} — {j.name}</option>
                ))}
              </select>
            </Field>
            <Field label="City" htmlFor="fuel-city">
              <Input id="fuel-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Effingham" />
            </Field>
          </div>

          <Field label="Truck stop" htmlFor="fuel-merchant" hint="Optional — whatever is printed at the top of the receipt.">
            <Input id="fuel-merchant" value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="Flying J Effingham" />
          </Field>

          <Field
            label="Fuel"
            htmlFor="fuel-type"
            hint={qualification.qualifies
              ? "Counts as tax-paid gallons on the return."
              : qualification.note}
          >
            <select
              id="fuel-type"
              className={SELECT}
              value={fuelType}
              onChange={(e) => setFuelType(e.target.value as FuelType)}
            >
              {FUEL_TYPES.map((f) => (
                <option key={f} value={f}>{FUEL_TYPE_LABEL[f]}</option>
              ))}
            </select>
          </Field>

          <div className="grid gap-3.5 sm:grid-cols-3">
            <Field label="Gallons" htmlFor="fuel-gallons" hint="e.g. 84.219">
              <Input id="fuel-gallons" inputMode="decimal" value={gallons} onChange={(e) => setGallons(e.target.value)} />
            </Field>
            <Field label="Price / gal" htmlFor="fuel-price" hint="e.g. 3.899">
              <Input id="fuel-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
            </Field>
            <Field label="Total" htmlFor="fuel-total" hint="As charged">
              <Input id="fuel-total" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} />
            </Field>
          </div>

          <Field label="Odometer" htmlFor="fuel-odometer" hint="Optional. Whole miles, as shown on the dash.">
            <Input id="fuel-odometer" inputMode="numeric" value={odometer} onChange={(e) => setOdometer(e.target.value)} />
          </Field>

          <Field label="Note" htmlFor="fuel-notes" hint="Optional. Anything the numbers do not say.">
            <Textarea id="fuel-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>

          {error ? (
            <p role="alert" className="rounded-md border border-st-danger/30 bg-st-danger-bg/50 px-3 py-2 text-[0.8125rem] text-st-danger">
              {error}
            </p>
          ) : null}

          <p className="text-[0.75rem] leading-relaxed text-fg-subtle">
            The carrier this purchase belongs to is worked out from the operating authority that
            was live at that moment — it is not something this form asks you to choose.
          </p>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={action.isPending}>
            {action.isPending ? "Recording…" : "Record purchase"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
