"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { buildTruckPatch } from "@/lib/fleet/truck-patch";
import type { FleetTruck } from "@/types/fleet-truck";
import { useUpdateTruck } from "./hooks";
import { DialogActions, DialogError } from "./truck-dialog-parts";

const optionalState = z
  .string()
  .trim()
  .refine((v) => v === "" || /^[A-Za-z]{2}$/.test(v), "Use the two-letter state code.");
const optionalDate = z
  .string()
  .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Use a full date.");

/** Mirrors contract §4: unitNumber can't be cleared; states are two letters. */
const schema = z.object({
  unitNumber: z.string().trim().min(1, "Give this truck a unit number."),
  homeTerminalCity: z.string().trim(),
  homeTerminalState: optionalState,
  notes: z.string().trim(),
  licensePlate: z.string().trim(),
  licensePlateState: optionalState,
  year: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{4}$/.test(v), "Enter a four-digit year."),
  make: z.string().trim(),
  model: z.string().trim(),
  color: z.string().trim(),
  registrationExpiresAt: optionalDate,
  insuranceExpiresAt: optionalDate,
  eldProvider: z.string().trim(),
  eldDeviceId: z.string().trim(),
});
type FormValues = z.infer<typeof schema>;

const OPERATING_FIELDS = ["unitNumber", "homeTerminalCity", "homeTerminalState", "notes"] as const;
const IDENTITY_FIELDS = [
  "licensePlate", "licensePlateState", "year", "make", "model", "color",
  "registrationExpiresAt", "insuranceExpiresAt", "eldProvider", "eldDeviceId",
] as const;

function initialValues(truck: FleetTruck): FormValues {
  const op = truck.operating;
  const values: FormValues = {
    unitNumber: op?.unitNumber ?? truck.unitNumber ?? "",
    homeTerminalCity: op?.homeTerminalCity ?? truck.homeTerminalCity ?? "",
    homeTerminalState: op?.homeTerminalState ?? truck.homeTerminalState ?? "",
    notes: op?.notes ?? truck.notes ?? "",
    licensePlate: truck.licensePlate ?? "",
    licensePlateState: truck.licensePlateState ?? "",
    year: truck.year ? String(truck.year) : "",
    make: truck.make ?? "",
    model: truck.model ?? "",
    color: truck.color ?? "",
    registrationExpiresAt: truck.registrationExpiresAt?.slice(0, 10) ?? "",
    insuranceExpiresAt: truck.insuranceExpiresAt?.slice(0, 10) ?? "",
    eldProvider: truck.eldProvider ?? "",
    eldDeviceId: truck.eldDeviceId ?? "",
  };
  return Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k, v.trim()]),
  ) as FormValues;
}

export function TruckEditDialog({
  truck,
  isLegalOwner,
  open,
  onOpenChange,
}: {
  truck: FleetTruck;
  /** Identity fields are editable only by the current legal owner (§4). */
  isLegalOwner: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const update = useUpdateTruck(truck.id);
  // Captured when the dialog opens: a background refetch must not reset what
  // the user is typing. Trimmed like the schema output, so untouched fields
  // never show up as changes.
  const [defaults] = useState(() => initialValues(truck));
  const {
    register, handleSubmit, reset, formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults });
  const editable = isLegalOwner ? [...OPERATING_FIELDS, ...IDENTITY_FIELDS] : OPERATING_FIELDS;

  const close = () => {
    reset(defaults);
    update.reset();
    onOpenChange(false);
  };

  const onSubmit = (values: FormValues) => {
    const patch = buildTruckPatch(defaults, values, editable);
    if (Object.keys(patch).length === 0) return close();
    update.mutate(patch, { onSuccess: close });
  };

  const text = (name: keyof FormValues, label: string, hint?: string) => (
    <Field label={label} htmlFor={`${id}-${name}`} error={errors[name]?.message} hint={hint}>
      <Input id={`${id}-${name}`} {...register(name)} />
    </Field>
  );
  const date = (name: keyof FormValues, label: string) => (
    <Field label={label} htmlFor={`${id}-${name}`} error={errors[name]?.message}>
      <Input id={`${id}-${name}`} type="date" {...register(name)} />
    </Field>
  );

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent
        title="Edit truck"
        description={
          isLegalOwner
            ? "Changes apply to this truck for everyone. Unit number, terminal and notes are your organization's own."
            : "You can change your organization's unit number, terminal and notes. Only the legal owner can change the truck's identity."
        }
        className="max-w-xl"
      >
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-4">
          <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
            <div className="grid gap-3 sm:grid-cols-2">
              {text("unitNumber", "Unit number")}
              {text("homeTerminalCity", "Home terminal city")}
              {text("homeTerminalState", "Home terminal state", "Two letters, like CA")}
            </div>
            <Field label="Notes" htmlFor={`${id}-notes`}>
              <Textarea id={`${id}-notes`} rows={2} {...register("notes")} />
            </Field>
            {isLegalOwner && (
              <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
                {text("licensePlate", "License plate")}
                {text("licensePlateState", "Plate state", "Two letters, like CA")}
                {text("year", "Year")}
                {text("make", "Make")}
                {text("model", "Model")}
                {text("color", "Color")}
                {date("registrationExpiresAt", "Registration expires")}
                {date("insuranceExpiresAt", "Insurance expires")}
                {text("eldProvider", "ELD provider")}
                {text("eldDeviceId", "ELD device ID")}
              </div>
            )}
          </div>
          <DialogError error={update.error} />
          <DialogActions onCancel={close} submitLabel="Save changes" pending={update.isPending} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
