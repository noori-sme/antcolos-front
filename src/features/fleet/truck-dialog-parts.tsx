"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";

/** Native select styled like the roster filters (there is no Select primitive). */
export const SELECT_CLASS =
  "h-control w-full rounded-md border border-border bg-surface px-3 text-[0.8125rem] text-fg shadow-e1 hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35";

/** Server error shown next to a dialog's submit button. */
export function DialogError({ error }: { error: Error | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-3 text-[0.8125rem] text-st-danger">
      {error.message}
    </p>
  );
}

/** Cancel + submit row; the submit disables and spins while pending. */
export function DialogActions({
  onCancel,
  submitLabel,
  pending,
  destructive = false,
  disabled = false,
  onSubmit,
}: {
  onCancel: () => void;
  submitLabel: string;
  pending: boolean;
  destructive?: boolean;
  disabled?: boolean;
  /** Omit for a `type="submit"` button inside a form. */
  onSubmit?: () => void;
}) {
  return (
    <div className="mt-5 flex justify-end gap-2">
      <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
        Cancel
      </Button>
      <Button
        type={onSubmit ? "button" : "submit"}
        variant={destructive ? "danger" : "primary"}
        onClick={onSubmit}
        disabled={pending || disabled}
        aria-busy={pending || undefined}
      >
        {pending && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
        {submitLabel}
      </Button>
    </div>
  );
}

/**
 * Controlled confirmation for destructive truck actions opened from a menu.
 * Unlike `ConfirmDialog`, it keeps the dialog open and shows the server's
 * reason when the action fails.
 */
export function TruckConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  pending: boolean;
  error: Error | null;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent title={title} description={description}>
        <DialogError error={error} />
        <DialogActions
          onCancel={() => onOpenChange(false)}
          submitLabel={confirmLabel}
          pending={pending}
          destructive
          onSubmit={onConfirm}
        />
      </DialogContent>
    </Dialog>
  );
}
