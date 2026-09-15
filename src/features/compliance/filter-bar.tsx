"use client";

import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import {
  COMPLIANCE_SEVERITY, COMPLIANCE_STATUS, COMPLIANCE_SUBJECT_PLURAL,
} from "@/config/compliance";
import type {
  ComplianceFilters, ComplianceRequirement, ComplianceSeverity,
  ComplianceStatus, ComplianceSubjectKind,
} from "@/types";

const STATUSES: ComplianceStatus[] = [
  "expired", "action_required", "expiring", "suspended", "compliant",
];
const KINDS: ComplianceSubjectKind[] = ["carrier", "driver", "truck", "trailer"];
const SEVERITIES: ComplianceSeverity[] = ["critical", "high", "medium", "low"];

function toggle<T>(list: T[] | undefined, value: T): T[] | undefined {
  const current = list ?? [];
  const next = current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value];
  return next.length ? next : undefined;
}

export function ComplianceFilterBar({
  filters, onChange, all,
}: {
  filters: ComplianceFilters;
  onChange: (next: ComplianceFilters) => void;
  /** Unfiltered set, so the counts do not move as you filter. */
  all: ComplianceRequirement[];
}) {
  // Counts describe the live, applicable set — the same set the list shows by
  // default. Counting the not-applicable rows would make every chip lie about
  // how much work is behind it.
  const live = all.filter((r) => !r.frozenAt && r.status !== "not_applicable");
  const statusCount = (status: ComplianceStatus) =>
    live.filter((r) => r.status === status).length;
  const kindCount = (kind: ComplianceSubjectKind) =>
    live.filter((r) => r.subject.kind === kind).length;

  const dirty =
    Boolean(filters.status || filters.subjectKind || filters.severity || filters.search) ||
    filters.responsibility === "me" ||
    Boolean(filters.includeNotApplicable) ||
    Boolean(filters.includeFrozen);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-fg-subtle"
          />
          <Input
            type="search"
            value={filters.search ?? ""}
            onChange={(e) => onChange({ ...filters, search: e.target.value || undefined })}
            placeholder="Requirement, unit, driver or document…"
            aria-label="Search compliance"
            className="pl-9"
          />
        </div>
        <Chip
          label="Mine"
          selected={filters.responsibility === "me"}
          onToggle={() =>
            onChange({
              ...filters,
              responsibility: filters.responsibility === "me" ? "all" : "me",
            })
          }
        />
        {dirty ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange({ responsibility: "all" })}
          >
            <X aria-hidden />
            Clear
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by state">
        {STATUSES.map((status) => (
          <Chip
            key={status}
            label={COMPLIANCE_STATUS[status].label}
            count={statusCount(status)}
            selected={filters.status?.includes(status) ?? false}
            onToggle={() => onChange({ ...filters, status: toggle(filters.status, status) })}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by what it is about">
        {/* A chip reading "Trailers 0" is a filter that does nothing, on a
            page that has no trailers. It is left out unless it is already on. */}
        {KINDS.filter((kind) => kindCount(kind) > 0 || filters.subjectKind?.includes(kind)).map(
          (kind) => (
            <Chip
              key={kind}
              label={COMPLIANCE_SUBJECT_PLURAL[kind]}
              count={kindCount(kind)}
              selected={filters.subjectKind?.includes(kind) ?? false}
              onToggle={() =>
                onChange({ ...filters, subjectKind: toggle(filters.subjectKind, kind) })
              }
            />
          ),
        )}
        {SEVERITIES.map((severity) => (
          <Chip
            key={severity}
            label={COMPLIANCE_SEVERITY[severity].label}
            selected={filters.severity?.includes(severity) ?? false}
            onToggle={() =>
              onChange({ ...filters, severity: toggle(filters.severity, severity) })
            }
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Show hidden records">
        {/*
          Both of these are hidden by default and neither is actionable. They
          are here because "why is this not on the list" is a real question, and
          the honest answer is a row that says so rather than an absence.
        */}
        <Chip
          label="Show not applicable"
          selected={Boolean(filters.includeNotApplicable)}
          onToggle={() =>
            onChange({ ...filters, includeNotApplicable: !filters.includeNotApplicable })
          }
        />
        <Chip
          label="Show ended relationships"
          selected={Boolean(filters.includeFrozen)}
          onToggle={() => onChange({ ...filters, includeFrozen: !filters.includeFrozen })}
        />
      </div>
    </div>
  );
}
