"use client";

import { Camera } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { KIND_LABEL } from "@/lib/receipts/receipt-rules";
import { cn } from "@/lib/utils";
import { RECEIPT_KINDS, type ReceiptKind } from "@/types/receipt";
import { useReceiptIntentKeys, useUploadReceipt } from "./hooks";

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";

/**
 * Send in a receipt photo or PDF (F2.1). The backend links it to the sender's
 * current truck and its load; a fuel receipt is read right away.
 */
export function UploadReceiptCard({ onUploaded }: { onUploaded: (receiptId: string) => void }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<ReceiptKind>("FUEL");
  const [file, setFile] = useState<File | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const upload = useUploadReceipt();
  const keys = useReceiptIntentKeys();

  const submit = () => {
    if (!file) return;
    setNotice(null);
    const intent = `upload:${kind}:${file.name}:${file.size}:${file.lastModified}`;
    upload.mutate(
      { input: { file, kind }, idempotencyKey: keys.keyFor(intent) },
      {
        onSuccess: ({ receipt, duplicate }) => {
          keys.clear();
          setFile(null);
          if (input.current) input.current.value = "";
          setNotice(duplicate ? "You already sent this receipt. Here it is." : null);
          onUploaded(receipt.id);
        },
      },
    );
  };

  return (
    <Card className="space-y-4 p-4">
      <fieldset>
        <legend className="text-[0.8125rem] font-medium text-fg">What kind of receipt?</legend>
        <div className="mt-2 flex flex-wrap gap-2" role="radiogroup">
          {RECEIPT_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={cn(
                "h-control rounded-md border px-3.5 text-[0.875rem] transition-colors",
                kind === k
                  ? "border-primary bg-primary text-primary-fg"
                  : "border-border-strong bg-surface text-fg hover:bg-surface-hover",
              )}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor={`${id}-file`} className="block text-[0.8125rem] font-medium text-fg">
          Photo or PDF
        </label>
        <input
          ref={input}
          id={`${id}-file`}
          type="file"
          accept={ACCEPT}
          capture="environment"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mt-1.5 block w-full text-[0.875rem] text-fg file:mr-3 file:h-control file:rounded-md file:border file:border-border-strong file:bg-surface file:px-3 file:text-fg"
        />
        <p className="mt-1 text-[0.75rem] text-fg-subtle">
          {kind === "FUEL"
            ? "We read fuel receipts for you; you check anything unclear."
            : "You'll enter the amounts yourself after sending it."}
        </p>
      </div>

      {upload.error ? (
        <p role="alert" className="text-[0.8125rem] text-st-danger">{upload.error.message}</p>
      ) : null}
      {notice ? <p role="status" className="text-[0.8125rem] text-fg-muted">{notice}</p> : null}

      <Button variant="primary" onClick={submit} disabled={!file || upload.isPending} className="w-full sm:w-auto">
        <Camera aria-hidden />
        {upload.isPending ? "Sending…" : "Send receipt"}
      </Button>
    </Card>
  );
}
