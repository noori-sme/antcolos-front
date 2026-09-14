"use client";

import { CircleCheck, FileWarning } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { ChecklistView } from "@/lib/api/contracts/documents";
import { DOCUMENT_STATUS_DESCRIPTION, formatDocumentDate } from "@/lib/documents/labels";
import type { DocumentChecklistItem, DocumentSubjectRef } from "@/types";
import { ApplicabilityLabel, DocumentStatusBadge } from "./chips";
import { FilePicker } from "./file-picker";
import { cn } from "@/lib/utils";

/**
 * The CHECKLIST, which is not the documents.
 *
 * A requirement with nothing against it is a line here and no record anywhere —
 * "missing" is a fact about what was asked for, not a document in a missing
 * state. That separation is why the same document can satisfy a requirement in
 * one workspace and sit under no requirement at all in another.
 */
export function RequirementsPanel({
  checklist,
  subject,
  canUpload,
  onAdd,
  busy,
}: {
  checklist: ChecklistView;
  subject: DocumentSubjectRef;
  canUpload: boolean;
  onAdd: (item: DocumentChecklistItem, file: { name: string; type: string; size: number }) => void;
  busy?: boolean;
}) {
  const outstanding = checklist.items.filter(
    (i) => i.requirement.applicability === "required"
      && !["approved", "expiring_soon", "pending_review"].includes(i.status),
  );
  const done = outstanding.length === 0;

  return (
    <section className="space-y-3" aria-labelledby="requirements-heading">
      <div
        className={cn(
          "rounded-lg border p-4",
          done ? "border-st-success/35 bg-st-success-bg/40" : "border-border bg-surface",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <h2 id="requirements-heading" className="flex items-center gap-2 text-[0.9375rem] font-semibold text-fg">
            {done ? <CircleCheck className="size-4 text-st-success" aria-hidden /> : null}
            {checklist.set.label}
          </h2>
          <p className="text-[0.8125rem] text-fg-muted tabular-nums">
            {checklist.satisfied} of {checklist.required} required
          </p>
        </div>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">
          {checklist.set.description}
        </p>
        <div
          role="progressbar"
          aria-valuenow={checklist.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${checklist.set.label} completion`}
          className="mt-3 h-2 overflow-hidden rounded-full bg-surface-sunken"
        >
          <div
            className={cn("h-full rounded-full transition-[width]", done ? "bg-st-success" : "bg-primary")}
            style={{ width: `${checklist.percent}%` }}
          />
        </div>
      </div>

      {checklist.items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3.5 py-6 text-center text-[0.8125rem] text-fg-muted">
          Nothing is asked of this workspace yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {checklist.items.map((item) => (
            <ChecklistRow
              key={item.requirement.key}
              item={item}
              subject={subject}
              canUpload={canUpload}
              busy={busy}
              onAdd={onAdd}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ChecklistRow({
  item,
  subject,
  canUpload,
  busy,
  onAdd,
}: {
  item: DocumentChecklistItem;
  subject: DocumentSubjectRef;
  canUpload: boolean;
  busy?: boolean;
  onAdd: (item: DocumentChecklistItem, file: { name: string; type: string; size: number }) => void;
}) {
  const needsWork = ["missing", "rejected", "expired", "expiring_soon"].includes(item.status);
  const optional = item.requirement.applicability !== "required";

  return (
    <li
      className={cn(
        "rounded-lg border bg-surface p-3.5",
        // An optional requirement nobody filled is not a problem, and must not
        // be coloured like one.
        needsWork && !optional ? "border-st-warning/40" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-[0.875rem] font-medium text-fg">{item.requirement.label}</span>
            <DocumentStatusBadge status={item.status} />
            <ApplicabilityLabel value={item.requirement.applicability} />
            {item.linkedFromOtherContext ? (
              <span className="rounded-full bg-st-info-bg px-1.5 py-0.5 text-[0.6875rem] font-medium text-st-info">
                Linked, not a second copy
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
            {item.requirement.reason}
          </p>

          {item.status === "missing" ? (
            <p className="mt-1 text-[0.75rem] text-fg-subtle">
              {DOCUMENT_STATUS_DESCRIPTION.missing}
            </p>
          ) : null}

          {item.document ? (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.75rem] text-fg-subtle">
              <span className="truncate">{item.document.file?.fileName ?? "No file"}</span>
              <span>Version {item.document.version}</span>
              {item.versionCount > 1 ? <span>{item.versionCount} versions kept</span> : null}
              {item.document.expiresAt ? (
                <span>Expires {formatDocumentDate(item.document.expiresAt)}</span>
              ) : null}
            </p>
          ) : null}

          {item.status === "rejected" ? (
            <p className="mt-2 flex gap-2 rounded-md border border-st-danger/35 bg-st-danger-bg/50 px-3 py-2 text-[0.8125rem] leading-relaxed">
              <FileWarning className="mt-px size-4 shrink-0 text-st-danger" aria-hidden />
              <span className="min-w-0 text-fg-muted">
                {item.document?.links.find((l) => l.review.rejectionReason)?.review.rejectionReason
                  ?? "Sent back without a recorded reason."}
              </span>
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {item.document ? (
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/documents/${item.document.documentId}`}>Open</Link>
            </Button>
          ) : null}
          {canUpload ? (
            <FilePicker
              label={item.document ? "Replace" : "Select file"}
              disabled={busy}
              onPick={(file) => onAdd(item, file)}
            />
          ) : null}
        </div>
      </div>
      <span className="sr-only">{`Applies to ${subject.label}`}</span>
    </li>
  );
}
