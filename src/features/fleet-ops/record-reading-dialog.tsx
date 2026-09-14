"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { FleetAssetKind } from "@/types";
import { useRecordTelemetry } from "./hooks";

/**
 * Records where the equipment is, what its odometer says and how long its
 * engine has run.
 *
 * Deliberately a form somebody fills in. There is no device behind this and the
 * dialog says so: a reading saved here is stamped "entered by hand" with the
 * name of whoever entered it and the time they say it was true, and it is
 * appended rather than replacing the last one. The history of what was believed
 * and when survives every correction.
 */
export function RecordReadingDialog({
  assetKind, assetId, unit,
}: { assetKind: FleetAssetKind; assetId: string; unit: string }) {
  const [open, setOpen] = useState(false);
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [description, setDescription] = useState("");
  const [odometer, setOdometer] = useState("");
  const [engineHours, setEngineHours] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const record = useRecordTelemetry();

  const reset = () => {
    setCity(""); setState(""); setDescription("");
    setOdometer(""); setEngineHours(""); setNote(""); setError(null);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const num = (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return undefined;
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : NaN;
    };
    const odometerMiles = num(odometer);
    const hours = num(engineHours);
    if (Number.isNaN(odometerMiles) || Number.isNaN(hours)) {
      setError("Odometer and engine hours have to be numbers.");
      return;
    }

    record.mutate(
      {
        assetKind,
        assetId,
        location: (city.trim() || state.trim() || description.trim())
          ? {
            city: city.trim() || undefined,
            state: state.trim().toUpperCase() || undefined,
            description: description.trim() || undefined,
          }
          : undefined,
        odometerMiles,
        engineHours: hours,
        note: note.trim() || undefined,
      },
      {
        onSuccess: () => { reset(); setOpen(false); },
        onError: (err) => setError((err as Error).message),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">Record a reading</Button>
      </DialogTrigger>
      <DialogContent
        title={`Record a reading for ${unit}`}
        description="Nothing is read from a device. This is written down as entered by hand, with your name and the time you say it was true."
      >
        <form onSubmit={submit} className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="City" htmlFor="reading-city">
              <Input
                id="reading-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Chicago"
              />
            </Field>
            <Field label="State" htmlFor="reading-state">
              <Input
                id="reading-state"
                value={state}
                onChange={(e) => setState(e.target.value)}
                maxLength={2}
                placeholder="IL"
              />
            </Field>
          </div>

          <Field label="Where exactly" htmlFor="reading-where" hint="A yard, a customer, a mile marker. Optional.">
            <Input
              id="reading-where"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Dock 6"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Odometer (miles)" htmlFor="reading-odo">
              <Input
                id="reading-odo"
                inputMode="numeric"
                value={odometer}
                onChange={(e) => setOdometer(e.target.value)}
                placeholder="118442"
              />
            </Field>
            <Field label="Engine hours" htmlFor="reading-hours">
              <Input
                id="reading-hours"
                inputMode="numeric"
                value={engineHours}
                onChange={(e) => setEngineHours(e.target.value)}
                placeholder="4210"
              />
            </Field>
          </div>

          <Field label="Note" htmlFor="reading-note" hint="Optional. Anything the next person should know.">
            <Textarea
              id="reading-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>

          {error ? (
            <p role="alert" className="rounded-md bg-st-danger-bg px-3 py-2 text-[0.8125rem] text-st-danger">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={record.isPending}>
              {record.isPending ? "Saving…" : "Save reading"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
