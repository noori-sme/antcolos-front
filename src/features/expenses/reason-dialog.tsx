"use client";

import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { isReason } from "@/lib/expenses/expense-rules";

/**
 * A decision that needs a reason (void, dismiss, route). The reason is kept on
 * the record; the confirm button stays disabled until one is given.
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  ...form
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  pending: boolean;
  error: Error | null;
  onConfirm: (reason: string) => void;
  children?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={title}
        description={description}
        className="max-h-[calc(100dvh-2rem)] max-w-md overflow-y-auto"
      >
        {/* Mounted only while open, so the reason starts empty every time. */}
        <ReasonForm {...form} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ReasonForm({
  confirmLabel,
  danger,
  pending,
  error,
  onConfirm,
  onCancel,
  children,
}: {
  confirmLabel: string;
  danger?: boolean;
  pending: boolean;
  error: Error | null;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const id = useId();
  const [reason, setReason] = useState("");
  return (
    <div className="mt-4 space-y-4">
      {children}
      <Field label="Reason" htmlFor={`${id}-reason`} required hint="Kept on the record. Up to 500 characters.">
        <Textarea id={`${id}-reason`} value={reason} maxLength={500} rows={3} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {error ? (
        <p role="alert" className="text-[0.8125rem] text-st-danger">{error.message}</p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button
          variant={danger ? "danger" : "primary"}
          disabled={!isReason(reason) || pending}
          onClick={() => onConfirm(reason.trim())}
        >
          {pending ? "Saving…" : confirmLabel}
        </Button>
      </div>
    </div>
  );
}
