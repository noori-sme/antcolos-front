"use client";

import { Camera, FileUp } from "lucide-react";
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
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
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
          setNotice(duplicate ? "You already sent this receipt. Here it is." : null);
          onUploaded(receipt.id);
        },
      },
    );
  };

  const pick = (files: FileList | null) => {
    const chosen = files?.[0];
    if (chosen) setFile(chosen);
  };

  return (
    <Card className="space-y-4 p-4">
      <fieldset>
        <legend className="text-[0.8125rem] font-medium text-fg">What kind of receipt?</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {RECEIPT_KINDS.map((k) => (
            <label key={k} className="cursor-pointer">
              <input
                type="radio"
                name={`${id}-kind`}
                value={k}
                checked={kind === k}
                onChange={() => setKind(k)}
                className="peer sr-only"
              />
              <span
                className={cn(
                  "inline-flex h-control items-center rounded-md border px-3.5 text-[0.875rem] transition-colors",
                  "peer-focus-visible:ring-2 peer-focus-visible:ring-ring/35",
                  kind === k
                    ? "border-primary bg-primary text-primary-fg"
                    : "border-border-strong bg-surface text-fg hover:bg-surface-hover",
                )}
              >
                {KIND_LABEL[k]}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <p className="text-[0.8125rem] font-medium text-fg">Photo or PDF</p>
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          tabIndex={-1}
          aria-label="Take a photo of the receipt"
          className="sr-only"
          onChange={(e) => {
            pick(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          tabIndex={-1}
          aria-label="Choose a photo or PDF of the receipt"
          className="sr-only"
          onChange={(e) => {
            pick(e.target.files);
            e.target.value = "";
          }}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {/* The camera first: the receipt is in the driver's hand. */}
          <Button type="button" onClick={() => cameraInput.current?.click()}>
            <Camera aria-hidden />
            Take photo
          </Button>
          <Button type="button" variant="ghost" onClick={() => fileInput.current?.click()}>
            <FileUp aria-hidden />
            Choose file
          </Button>
        </div>
        <p className="mt-2 text-[0.8125rem] text-fg-muted" aria-live="polite">
          {file ? `Ready to send: ${file.name}` : "No receipt chosen yet."}
        </p>
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
        {upload.isPending ? "Sending…" : "Send receipt"}
      </Button>
    </Card>
  );
}
