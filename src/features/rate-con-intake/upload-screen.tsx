"use client";

import { FileText, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { useIntentKey, useUploadRateCon } from "./hooks";

const ACCEPTED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp," + ACCEPTED_TYPES.join(",");

function formatSize(bytes: number): string {
  return bytes >= 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Step one of a load from a broker Rate Con (plan 13): store the file and
 * queue its reading, then hand over to the review screen, which polls.
 */
export function RateConUploadScreen() {
  const router = useRouter();
  const inputId = useId();
  const upload = useUploadRateCon();
  const { keyFor, clear } = useIntentKey();
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  function choose(chosen: File | undefined) {
    upload.reset();
    if (!chosen) {
      setFile(null);
      return;
    }
    if (chosen.type && !ACCEPTED_TYPES.includes(chosen.type)) {
      setFile(null);
      setProblem("Choose a PDF, JPEG, PNG or WEBP file.");
      return;
    }
    setProblem(null);
    setFile(chosen);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    // Retrying the same file reuses its key, so a lost response cannot upload twice.
    const idempotencyKey = keyFor(`${file.name}|${file.size}|${file.lastModified}`);
    upload.mutate(
      { file, idempotencyKey },
      {
        onSuccess: (document) => {
          clear();
          router.push(`/rate-cons/${document.id}`);
        },
      },
    );
  }

  const error = problem ?? (upload.error ? upload.error.message : null);

  return (
    <div className="space-y-section">
      <PageHeader
        title="New load from a Rate Con"
        description="Upload the broker's rate confirmation. Antcolos reads it, you check every value that matters, and the load is created from what you approved."
      />
      <Card className="max-w-xl">
        <CardContent className="space-y-5 pt-5">
          <form onSubmit={submit} className="space-y-5">
            <Field
              label="Rate confirmation"
              htmlFor={inputId}
              hint="PDF, JPEG, PNG or WEBP. Reading usually takes under a minute."
              error={error ?? undefined}
              required
            >
              <input
                id={inputId}
                type="file"
                accept={ACCEPT}
                disabled={upload.isPending}
                onChange={(event) => choose(event.target.files?.[0])}
                className="block w-full cursor-pointer rounded-md border border-border-strong bg-surface text-[0.875rem] text-fg file:mr-3 file:cursor-pointer file:border-0 file:border-r file:border-border file:bg-surface-sunken file:px-3 file:py-2 file:text-fg disabled:cursor-not-allowed disabled:opacity-60"
              />
            </Field>
            {file ? (
              <p className="flex items-center gap-2 text-[0.8125rem] text-fg-muted">
                <FileText className="size-4 shrink-0" aria-hidden />
                <span className="truncate">{file.name}</span>
                <span className="shrink-0 text-fg-subtle">{formatSize(file.size)}</span>
              </p>
            ) : null}
            <Button type="submit" variant="primary" disabled={!file || upload.isPending}>
              <Upload aria-hidden />
              {upload.isPending ? "Uploading…" : "Upload and read"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
