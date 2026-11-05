"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { EmptyState, ErrorState } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useIdempotencyKey } from "@/lib/api/use-idempotency-key";
import { normalizeVin, validateVin } from "@/lib/fleet/vin";
import {
  TRUCK_EQUIPMENT_TYPES, type CreateTruckInput, type TruckEquipmentType, type TruckLookup,
} from "@/types/fleet-truck";
import { useCreateTruck, useTruckLookup } from "./hooks";
import { DialogError, SELECT_CLASS } from "./truck-dialog-parts";

const EQUIPMENT_LABEL: Record<TruckEquipmentType, string> = {
  DRY_VAN: "Dry Van", REEFER: "Reefer", FLATBED: "Flatbed", STEP_DECK: "Step Deck",
  POWER_ONLY: "Power Only", TANKER: "Tanker", OTHER: "Other",
};

const state = z
  .string()
  .trim()
  .refine((v) => v === "" || /^[A-Za-z]{2}$/.test(v), "Use the two-letter state code.");
const date = z
  .string()
  .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Use a full date.");

/** Mirrors contract §1: unit number required; plate and its state together. */
const schema = z
  .object({
    unitNumber: z.string().trim().min(1, "Give this truck a unit number."),
    equipmentType: z.enum(TRUCK_EQUIPMENT_TYPES),
    ownershipType: z.enum(["COMPANY", "OWNER_OPERATOR", "LEASED"]),
    year: z.string().trim().refine((v) => v === "" || /^\d{4}$/.test(v), "Enter a four-digit year."),
    make: z.string().trim(),
    model: z.string().trim(),
    color: z.string().trim(),
    licensePlate: z.string().trim(),
    licensePlateState: state,
    homeTerminalCity: z.string().trim(),
    homeTerminalState: state,
    registrationExpiresAt: date,
    insuranceExpiresAt: date,
    notes: z.string().trim(),
  })
  .refine((v) => Boolean(v.licensePlate) === Boolean(v.licensePlateState), {
    message: "Enter the plate and its state together.",
    path: ["licensePlateState"],
  });
type FormValues = z.infer<typeof schema>;

const EMPTY: FormValues = {
  unitNumber: "", equipmentType: "DRY_VAN", ownershipType: "COMPANY", year: "", make: "",
  model: "", color: "", licensePlate: "", licensePlateState: "", homeTerminalCity: "",
  homeTerminalState: "", registrationExpiresAt: "", insuranceExpiresAt: "", notes: "",
};

/** Body for `POST /trucks`: empty optional fields are left out; codes uppercased. */
function toInput(vin: string, v: FormValues, attach: boolean): CreateTruckInput {
  const opt = (s: string) => (s ? s : undefined);
  const base: CreateTruckInput = {
    vin,
    unitNumber: v.unitNumber,
    equipmentType: v.equipmentType,
    homeTerminalCity: opt(v.homeTerminalCity),
    homeTerminalState: opt(v.homeTerminalState.toUpperCase()),
    notes: opt(v.notes),
  };
  // Attach ignores identity fields (§1), so don't send them.
  if (attach) return base;
  return {
    ...base,
    ownershipType: v.ownershipType,
    year: v.year ? Number(v.year) : undefined,
    make: opt(v.make),
    model: opt(v.model),
    color: opt(v.color),
    licensePlate: opt(v.licensePlate),
    licensePlateState: opt(v.licensePlateState.toUpperCase()),
    registrationExpiresAt: opt(v.registrationExpiresAt),
    insuranceExpiresAt: opt(v.insuranceExpiresAt),
  };
}

/**
 * Add a truck (fleet contract §1, §1b): look the VIN up, then attach the
 * existing truck to this fleet or create it. The owner is always this
 * organization; hand ownership to an owner-operator from the truck profile.
 */
export function TruckCreateScreen() {
  const id = useId();
  const router = useRouter();
  const [vinInput, setVinInput] = useState("");
  const [vin, setVin] = useState<string | null>(null);
  const [vinError, setVinError] = useState<string | null>(null);
  const lookup = useTruckLookup(vin ?? "", Boolean(vin));
  const create = useCreateTruck();
  const { key, renew } = useIdempotencyKey();
  const {
    register, handleSubmit, formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: EMPTY });

  const found: TruckLookup | null | undefined = vin ? lookup.data : undefined;
  const attach = Boolean(found);

  const startLookup = () => {
    const error = validateVin(vinInput);
    setVinError(error);
    if (error) return;
    renew(); // a different VIN is a different intent
    create.reset();
    setVin(normalizeVin(vinInput));
  };

  const onSubmit = (values: FormValues) => {
    if (!vin) return;
    create.mutate(
      { input: toInput(vin, values, attach), idempotencyKey: key },
      { onSuccess: (truck) => router.push(`/fleet/trucks/${truck.id}`) },
    );
  };

  const text = (name: keyof FormValues, label: string, hint?: string, required = false) => (
    <Field label={label} htmlFor={`${id}-${name}`} error={errors[name]?.message} hint={hint} required={required}>
      <Input id={`${id}-${name}`} {...register(name)} />
    </Field>
  );

  return (
    <div className="space-y-section">
      <Link
        href="/fleet/trucks"
        className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-fg-muted hover:text-fg"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        All trucks
      </Link>
      <PageHeader
        title="Add a truck"
        description="Start with the VIN. If the truck is already in Antcolos, it is added to your fleet; otherwise a new truck is created."
      />

      <form
        className="flex max-w-xl items-end gap-2"
        onSubmit={(e) => { e.preventDefault(); startLookup(); }}
        noValidate
      >
        <div className="flex-1">
          <Field label="VIN" htmlFor={`${id}-vin`} error={vinError ?? undefined} required>
            <Input
              id={`${id}-vin`}
              value={vinInput}
              onChange={(e) => setVinInput(e.target.value)}
              autoComplete="off"
              className="font-mono uppercase"
            />
          </Field>
        </div>
        <Button type="submit" variant="secondary" disabled={lookup.isFetching}>
          <Search className="mr-1.5 size-4" aria-hidden />
          Look up
        </Button>
      </form>

      {vin && lookup.isPending && <p className="text-[0.8125rem] text-fg-muted">Looking up {vin}…</p>}
      {vin && lookup.isError && (
        <ErrorState description={lookup.error.message} onRetry={() => lookup.refetch()} />
      )}
      {found?.archived && (
        <EmptyState
          title="This truck is archived"
          description="An archived truck can't be added to a fleet. Check the VIN, or contact its owner."
        />
      )}
      {found?.alreadyOnFleet && !found.archived && (
        <EmptyState
          title={`Already on your fleet${found.unitNumber ? ` as unit ${found.unitNumber}` : ""}`}
          description="Nothing to add."
          action={
            <Button variant="secondary" asChild>
              <Link href={`/fleet/trucks/${found.id}`}>Open the truck</Link>
            </Button>
          }
        />
      )}

      {vin && lookup.isSuccess && !found?.archived && !found?.alreadyOnFleet && (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="max-w-2xl space-y-section">
          <section className="space-y-4 rounded-lg border border-border bg-surface p-5 shadow-e1">
            <h2 className="text-[0.9375rem] font-semibold text-fg">
              {attach ? "Add this truck to your fleet" : "New truck"}
            </h2>
            {found && (
              <p className="text-[0.8125rem] text-fg-muted">
                {[found.year, found.make, found.model].filter(Boolean).join(" ") || "Truck"}
                {found.equipmentType ? ` · ${EQUIPMENT_LABEL[found.equipmentType]}` : ""}
                {found.licensePlate ? ` · ${found.licensePlate} ${found.licensePlateState ?? ""}` : ""}
                . Its identity and owner stay as they are.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {text("unitNumber", "Unit number", "Your organization's number for it", true)}
              {!attach && (
                <Field label="Equipment" htmlFor={`${id}-equipmentType`} required>
                  <select id={`${id}-equipmentType`} className={SELECT_CLASS} {...register("equipmentType")}>
                    {TRUCK_EQUIPMENT_TYPES.map((t) => (
                      <option key={t} value={t}>{EQUIPMENT_LABEL[t]}</option>
                    ))}
                  </select>
                </Field>
              )}
              {text("homeTerminalCity", "Home terminal city")}
              {text("homeTerminalState", "Home terminal state", "Two letters, like CA")}
            </div>
            {!attach && (
              <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
                <Field label="Ownership" htmlFor={`${id}-ownershipType`}>
                  <select id={`${id}-ownershipType`} className={SELECT_CLASS} {...register("ownershipType")}>
                    <option value="COMPANY">Company</option>
                    <option value="OWNER_OPERATOR">Owner-operator</option>
                    <option value="LEASED">Leased</option>
                  </select>
                </Field>
                {text("year", "Year")}
                {text("make", "Make")}
                {text("model", "Model")}
                {text("color", "Color")}
                {text("licensePlate", "License plate")}
                {text("licensePlateState", "Plate state", "Two letters, like CA")}
                <Field label="Registration expires" htmlFor={`${id}-reg`} error={errors.registrationExpiresAt?.message}>
                  <Input id={`${id}-reg`} type="date" {...register("registrationExpiresAt")} />
                </Field>
                <Field label="Insurance expires" htmlFor={`${id}-ins`} error={errors.insuranceExpiresAt?.message}>
                  <Input id={`${id}-ins`} type="date" {...register("insuranceExpiresAt")} />
                </Field>
              </div>
            )}
            <Field label="Notes" htmlFor={`${id}-notes`}>
              <Textarea id={`${id}-notes`} rows={2} {...register("notes")} />
            </Field>
          </section>
          <div>
            <Button type="submit" variant="primary" disabled={create.isPending} aria-busy={create.isPending || undefined}>
              {attach ? "Add to fleet" : "Create truck"}
            </Button>
            <DialogError error={create.error} />
          </div>
        </form>
      )}
    </div>
  );
}
