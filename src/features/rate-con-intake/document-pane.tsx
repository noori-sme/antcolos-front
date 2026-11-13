"use client";

import { FileWarning } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { FieldBox } from "@/types/rate-con-intake";
import { useDocumentFileUrl } from "./hooks";

export interface ActiveSource {
  label: string;
  page: number | null;
  box: FieldBox | null;
}

/**
 * The original Rate Con beside its fields (plan 13). An image gets the active
 * field's box drawn over it. A PDF opens in the browser's own viewer and jumps
 * to the active field's page; drawing boxes on a PDF needs a page renderer the
 * bundle does not have yet (plan 13, Backend asks).
 */
export function DocumentPane({
  documentId,
  filename,
  mimeType,
  active,
}: {
  documentId: string;
  filename: string;
  mimeType: string;
  active: ActiveSource | null;
}) {
  const file = useDocumentFileUrl(documentId);

  if (file.isPending) {
    return <Skeleton className="h-[60vh] w-full rounded-lg" />;
  }
  if (file.isError || !file.data.url) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface px-6 py-14 text-center">
        <FileWarning className="size-5 text-fg-subtle" aria-hidden />
        <p className="text-[0.875rem] font-medium text-fg">The document can&apos;t be shown here</p>
        <p className="max-w-sm text-[0.8125rem] text-fg-muted">
          You can still review the fields.
        </p>
        {file.error?.message ? (
          <p className="max-w-sm text-[0.75rem] text-fg-subtle">{file.error.message}</p>
        ) : null}
      </div>
    );
  }

  const isPdf = mimeType === "application/pdf";
  const page = active?.page ?? 1;

  return (
    <figure className="space-y-2">
      {isPdf ? (
        <iframe
          // The fragment moves the viewer to the active field's page.
          key={page}
          src={`${file.data.url}#page=${page}`}
          title={`Rate confirmation ${filename}`}
          className="h-[60vh] w-full rounded-lg border border-border bg-surface lg:h-[75vh]"
        />
      ) : (
        <div className="relative overflow-hidden rounded-lg border border-border bg-surface">
          {/* A short-lived signed URL: next/image would cache it past its life. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={file.data.url} alt={`Rate confirmation ${filename}`} className="block h-auto w-full" />
          {active?.box ? (
            <div
              aria-hidden
              className="pointer-events-none absolute rounded-sm border-2 border-primary bg-primary/10 motion-safe:transition-all"
              style={{
                left: `${active.box.x * 100}%`,
                top: `${active.box.y * 100}%`,
                width: `${active.box.width * 100}%`,
                height: `${active.box.height * 100}%`,
              }}
            />
          ) : null}
        </div>
      )}
      <figcaption className="text-[0.75rem] text-fg-subtle" aria-live="polite">
        {active
          ? active.page
            ? `${active.label}: page ${active.page}${isPdf ? "" : active.box ? ", outlined" : ""}`
            : `${active.label}: not found on the page; check it by eye`
          : "Point at a field to find it on the document."}
      </figcaption>
    </figure>
  );
}
