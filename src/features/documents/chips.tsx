import { Badge } from "@/components/ui/badge";
import {
  APPLICABILITY_LABEL, DOCUMENT_STATUS_LABEL, DOCUMENT_STATUS_TONE,
  SUBJECT_KIND_LABEL,
} from "@/lib/documents/labels";
import type { DocumentApplicability, DocumentStatus, DocumentSubjectKind } from "@/types";
import { cn } from "@/lib/utils";

export function DocumentStatusBadge({
  status,
  className,
}: {
  status: DocumentStatus;
  className?: string;
}) {
  return (
    <Badge tone={DOCUMENT_STATUS_TONE[status]} className={className}>
      {DOCUMENT_STATUS_LABEL[status]}
    </Badge>
  );
}

export function SubjectBadge({ kind }: { kind: DocumentSubjectKind }) {
  return <Badge tone="outline">{SUBJECT_KIND_LABEL[kind]}</Badge>;
}

/** Optional is stated plainly, never as a warning: it is not an outstanding item. */
export function ApplicabilityLabel({ value }: { value: DocumentApplicability }) {
  if (value === "required") return null;
  return (
    <span className="text-[0.6875rem] text-fg-subtle">{APPLICABILITY_LABEL[value]}</span>
  );
}

export function SharedBadge({ from }: { from?: string }) {
  return (
    <Badge tone="info" title={from ? `Shared by ${from}` : undefined}>
      Shared with you
    </Badge>
  );
}

/**
 * The line every document surface carries.
 *
 * It is repeated deliberately rather than shown once at the top of a page: a
 * person who scrolls past a banner and then reads "Approved" on a row should
 * still not come away thinking a file was stored or checked.
 */
export function MockUploadNotice({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "rounded-md border border-dashed border-border px-3 py-2.5 text-[0.75rem] leading-relaxed text-fg-subtle",
        className,
      )}
    >
      Preview build: choosing a file records its name, type and size and nothing else. No file is
      uploaded, stored, transmitted, read, OCR-processed, verified or submitted to anybody, and no
      document here has been checked against any external register.
    </p>
  );
}
