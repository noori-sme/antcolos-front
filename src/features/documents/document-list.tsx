"use client";

import { FileText } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/data/states";
import type { DocumentView } from "@/lib/api/contracts/documents";
import { documentTypeLabel } from "@/lib/documents/catalog";
import { formatDocumentDate, formatFileSize } from "@/lib/documents/labels";
import { DocumentStatusBadge, SharedBadge, SubjectBadge } from "./chips";
import { cn } from "@/lib/utils";

/**
 * The list.
 *
 * Rows carry the three things somebody scanning for work needs: what it is,
 * what it is about, and what state it is in. Everything else is one click away
 * on the detail screen, which is where version history and access live.
 */
export function DocumentList({ documents }: { documents: DocumentView[] }) {
  if (documents.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No documents match"
        description="Change the filters, or add a document against one of the requirements above."
      />
    );
  }

  return (
    <ul className="space-y-2">
      {documents.map((view) => (
        <li key={view.document.documentId}>
          <Link
            href={`/documents/${view.document.documentId}`}
            className={cn(
              "block rounded-lg border border-border bg-surface p-3.5 transition-colors",
              "hover:border-border-strong hover:bg-surface-hover",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="text-[0.875rem] font-medium text-fg">
                    {view.requirement?.label ?? documentTypeLabel(view.document.typeKey)}
                  </span>
                  <DocumentStatusBadge status={view.status} />
                  <SubjectBadge kind={view.subject.kind} />
                  {view.shared ? <SharedBadge from={view.document.owner.name} /> : null}
                </p>
                <p className="mt-0.5 truncate text-[0.8125rem] text-fg-muted">
                  {view.subject.label}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.75rem] text-fg-subtle">
                  <span className="truncate">{view.document.file?.fileName ?? "No file"}</span>
                  {view.document.file ? (
                    <span className="tabular-nums">{formatFileSize(view.document.file.sizeBytes)}</span>
                  ) : null}
                  <span>Version {view.document.version}</span>
                  {view.versionCount > 1 ? (
                    <span>{view.versionCount} versions kept</span>
                  ) : null}
                  {view.document.expiresAt ? (
                    <span>Expires {formatDocumentDate(view.document.expiresAt)}</span>
                  ) : null}
                </p>
              </div>
              <p className="shrink-0 text-[0.75rem] text-fg-subtle tabular-nums">
                {formatDocumentDate(view.document.updatedAt)}
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
