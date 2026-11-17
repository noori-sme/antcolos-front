"use client";

import { Camera, FileText } from "lucide-react";
import { useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { canUpload } from "@/lib/driver-loads/milestones";
import type { DriverLoad } from "@/types/driver-load";
import { useDriverLoadAction, useIntentKeys } from "./hooks";

const WHEN = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";
const LABEL = { bol: "BOL", pod: "POD", rate_confirmation: "Rate Con" } as const;

/** BOL and POD on the load (contract §13): what is in, and the upload when it is due. */
export function DriverLoadDocuments({ load }: { load: DriverLoad }) {
  const current = load.documents.filter((d) => !d.superseded);
  const showBol = canUpload(load.status, "bol");
  const showPod = canUpload(load.status, "pod");
  if (!current.length && !showBol && !showPod) return null;
  return (
    <section aria-labelledby="driver-documents" className="space-y-2.5">
      <h2 id="driver-documents" className="text-[0.9375rem] font-semibold text-fg">Paperwork</h2>
      {current.length ? (
        <ul className="space-y-2">
          {current.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3 shadow-e1">
              <span className="flex min-w-0 items-center gap-2 text-[0.875rem] text-fg">
                <FileText className="size-4 shrink-0 text-fg-muted" aria-hidden />
                {LABEL[doc.type]}
                {doc.version > 1 ? <span className="text-fg-muted">· copy {doc.version}</span> : null}
              </span>
              <span className="flex items-center gap-2">
                <span className="text-[0.75rem] text-fg-muted">{WHEN.format(new Date(doc.receivedAt))}</span>
                <Badge tone="success">Sent</Badge>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        {showBol ? <UploadButton load={load} type="bol" /> : null}
        {showPod ? <UploadButton load={load} type="pod" /> : null}
      </div>
    </section>
  );
}

function UploadButton({ load, type }: { load: DriverLoad; type: "bol" | "pod" }) {
  const input = useRef<HTMLInputElement>(null);
  const action = useDriverLoadAction(load.id);
  const keys = useIntentKeys();
  const has = load.documents.some((d) => d.type === type && !d.superseded);
  const upload = (file: File) =>
    action.mutate(
      {
        action: { kind: "upload", type, stopSequence: null, file },
        // The same file retried keeps its key; another file is another intent.
        idempotencyKey: keys.keyFor(`${type}:${file.name}:${file.size}:${file.lastModified}`),
      },
      { onSuccess: () => keys.clear() },
    );
  const label = `${has ? "Send a better" : "Upload"} ${LABEL[type]}`;
  return (
    <div className="space-y-1">
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        capture="environment"
        className="sr-only"
        aria-label={label}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) upload(file);
        }}
      />
      <Button
        type="button"
        variant={has ? "secondary" : "primary"}
        className="h-11 w-full"
        disabled={action.isPending}
        onClick={() => input.current?.click()}
      >
        <Camera aria-hidden />
        {action.isPending ? "Uploading…" : label}
      </Button>
      {action.error ? <p role="alert" className="text-[0.8125rem] text-st-danger">{action.error.message}</p> : null}
    </div>
  );
}
