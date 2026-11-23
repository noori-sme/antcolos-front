"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useId, useMemo } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  confirmFormSchema, toConfirmInput, toFormValues, type ConfirmFormValues,
} from "@/lib/receipts/confirm-form";
import type { ReceiptDetail } from "@/types/receipt";
import { useConfirmReceipt, useReceiptIntentKeys } from "./hooks";

/**
 * Check what was read and confirm it (F2.1). Fields start from what the model
 * read; only what the person changes is sent as a correction.
 */
export function ConfirmReceiptForm({ receipt, onDone }: { receipt: ReceiptDetail; onDone?: () => void }) {
  const id = useId();
  const confirm = useConfirmReceipt();
  const keys = useReceiptIntentKeys();
  const initial = useMemo(() => toFormValues(receipt, receipt.fields), [receipt]);
  const { register, handleSubmit, formState: { errors } } = useForm<ConfirmFormValues>({
    resolver: zodResolver(confirmFormSchema),
    defaultValues: initial,
  });

  const onSubmit = (values: ConfirmFormValues) => {
    const input = toConfirmInput(values, initial);
    confirm.mutate(
      { id: receipt.id, input, idempotencyKey: keys.keyFor(`confirm:${receipt.id}:${JSON.stringify(input)}`) },
      {
        onSuccess: () => {
          keys.clear();
          onDone?.();
        },
      },
    );
  };

  const field = (name: keyof ConfirmFormValues, label: string, props: { hint?: string; inputMode?: "decimal" | "numeric"; type?: string; required?: boolean } = {}) => (
    <Field label={label} htmlFor={`${id}-${name}`} error={errors[name]?.message} hint={props.hint} required={props.required}>
      <Input
        id={`${id}-${name}`}
        type={props.type ?? "text"}
        inputMode={props.inputMode}
        autoComplete="off"
        {...register(name)}
      />
    </Field>
  );

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {field("purchasedOn", "Date on the receipt", { type: "date", required: true })}
        {field("totalAmount", "Total (USD)", { inputMode: "decimal", required: true })}
        {receipt.kind === "FUEL" ? (
          <>
            {field("gallons", "Gallons", { inputMode: "decimal" })}
            {field("unitPrice", "Price per gallon", { inputMode: "decimal" })}
          </>
        ) : null}
        {receipt.kind === "REPAIR" ? (
          <>
            {field("partsAmount", "Parts", { inputMode: "decimal" })}
            {field("laborAmount", "Labor", { inputMode: "decimal" })}
          </>
        ) : null}
        {field("vendor", receipt.kind === "TOLL" ? "Toll authority" : "Vendor")}
        {receipt.kind !== "TOLL" ? field("odometerMiles", "Odometer (miles)", { inputMode: "numeric" }) : null}
        {field("city", "City")}
        {field("state", "State")}
      </div>
      {confirm.error ? (
        <p role="alert" className="text-[0.8125rem] text-st-danger">{confirm.error.message}</p>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={confirm.isPending}>
          {confirm.isPending ? "Confirming…" : "Confirm receipt"}
        </Button>
      </div>
    </form>
  );
}
