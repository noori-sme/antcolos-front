"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { useRejectReceipt, useReceiptIntentKeys } from "./hooks";

/** Reject a receipt waiting for review, with the reason the uploader will see. */
export function RejectReceiptDialog({
  receiptId,
  open,
  onOpenChange,
  onRejected,
}: {
  receiptId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRejected?: () => void;
}) {
  const id = useId();
  const [reason, setReason] = useState("");
  const reject = useRejectReceipt();
  const keys = useReceiptIntentKeys();
  const trimmed = reason.trim();

  const close = () => {
    setReason("");
    reject.reset();
    onOpenChange(false);
  };

  const submit = () => {
    reject.mutate(
      { id: receiptId, reason: trimmed, idempotencyKey: keys.keyFor(`reject:${receiptId}:${trimmed}`) },
      {
        onSuccess: () => {
          keys.clear();
          close();
          onRejected?.();
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent
        title="Reject this receipt"
        description="It never reaches the books. The person who sent it sees your reason."
        className="max-w-md"
      >
        <div className="mt-4 space-y-4">
          <Field label="Reason" htmlFor={`${id}-reason`} required hint="Up to 500 characters.">
            <Textarea
              id={`${id}-reason`}
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </Field>
          {reject.error ? (
            <p role="alert" className="text-[0.8125rem] text-st-danger">{reject.error.message}</p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button variant="danger" onClick={submit} disabled={!trimmed || reject.isPending}>
              {reject.isPending ? "Rejecting…" : "Reject receipt"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
