"use client";

import { Search, X } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import type { DocumentFilters } from "@/lib/api/contracts/documents";
import { DOCUMENT_STATUS_LABEL, SUBJECT_KIND_LABEL } from "@/lib/documents/labels";
import type { DocumentStatus, DocumentSubjectKind } from "@/types";

/** The states a person actually filters by. "Superseded" has its own switch. */
const STATUSES: DocumentStatus[] = [
  "missing", "rejected", "expired", "expiring_soon",
  "pending_review", "selected_local", "approved",
];

const SUBJECTS: DocumentSubjectKind[] = ["organization", "driver", "truck", "trailer"];

export function DocumentFilterBar({
  filters,
  onChange,
  counts,
}: {
  filters: DocumentFilters;
  onChange: (next: DocumentFilters) => void;
  counts?: Partial<Record<DocumentStatus, number>>;
}) {
  const uid = useId();

  function toggle<T>(list: T[] | undefined, value: T): T[] | undefined {
    const set = new Set(list ?? []);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    return set.size ? [...set] : undefined;
  }

  const active =
    Boolean(filters.search)
    || Boolean(filters.status?.length)
    || Boolean(filters.subjectKind?.length)
    || filters.includeShared === false
    || filters.includeSuperseded === true;

  return (
    <div className="space-y-2.5">
      <div className="relative max-w-md">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle"
        />
        <Input
          id={`${uid}-search`}
          type="search"
          value={filters.search ?? ""}
          onChange={(e) => onChange({ ...filters, search: e.target.value || undefined })}
          placeholder="Search documents, files, drivers, units"
          aria-label="Search documents"
          className="pl-9"
        />
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by state">
        {STATUSES.map((status) => (
          <Chip
            key={status}
            label={DOCUMENT_STATUS_LABEL[status]}
            count={counts?.[status]}
            selected={Boolean(filters.status?.includes(status))}
            onToggle={() => onChange({ ...filters, status: toggle(filters.status, status) })}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by what the document is about">
        {SUBJECTS.map((kind) => (
          <Chip
            key={kind}
            label={SUBJECT_KIND_LABEL[kind]}
            selected={Boolean(filters.subjectKind?.includes(kind))}
            onToggle={() => onChange({ ...filters, subjectKind: toggle(filters.subjectKind, kind) })}
          />
        ))}
        <Chip
          label="Shared with us"
          selected={filters.includeShared !== false}
          onToggle={() =>
            onChange({ ...filters, includeShared: filters.includeShared === false ? undefined : false })
          }
        />
        <Chip
          label="Earlier versions"
          selected={filters.includeSuperseded === true}
          onToggle={() =>
            onChange({ ...filters, includeSuperseded: filters.includeSuperseded ? undefined : true })
          }
        />
        {active ? (
          <Button variant="ghost" size="sm" onClick={() => onChange({})}>
            <X aria-hidden />
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}
