"use client";

import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { AUDIT_MODULE_LABEL, AUDIT_SOURCE_LABEL } from "@/lib/audit/actions";
import type {
  AuditEvent, AuditEventFilters, AuditEventSource, AuditModule, AuditOutcome,
} from "@/types";

const SOURCES: AuditEventSource[] = ["human", "system", "integration", "imported", "inferred"];
const OUTCOMES: AuditOutcome[] = ["succeeded", "denied", "failed"];
const OUTCOME_LABEL: Record<AuditOutcome, string> = {
  succeeded: "Succeeded", denied: "Refused", failed: "Failed",
};

function toggle<T>(list: T[] | undefined, value: T): T[] | undefined {
  const current = list ?? [];
  const next = current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value];
  return next.length ? next : undefined;
}

export function AuditFilterBar({
  filters, onChange, all, loaded, total,
}: {
  filters: AuditEventFilters;
  onChange: (next: AuditEventFilters) => void;
  /** The events currently loaded. The counts below describe exactly these. */
  all: readonly AuditEvent[];
  loaded: number;
  total: number;
}) {
  const modules = [...new Set(all.map((e) => e.module))].sort();
  const count = <T,>(pick: (e: AuditEvent) => T, value: T) =>
    all.filter((e) => pick(e) === value).length;

  const dirty = Boolean(
    filters.search || filters.module || filters.source || filters.outcome
    || filters.actorMembershipId || filters.entityId || filters.correlationId,
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-fg-subtle"
          />
          <Input
            type="search"
            value={filters.search ?? ""}
            onChange={(e) => onChange({ ...filters, search: e.target.value || undefined })}
            placeholder="Who, what, or which record…"
            aria-label="Search the audit log"
            className="pl-9"
          />
        </div>
        {dirty ? (
          <Button variant="ghost" size="sm" onClick={() => onChange({})}>
            <X aria-hidden />
            Clear
          </Button>
        ) : null}
      </div>

      {/* The counts describe what is LOADED, not the whole ledger. Saying so
          matters: a chip reading "Refused 0" over a partly-loaded log would be
          read as "nothing was ever refused", which is the opposite of true. */}
      {total > loaded ? (
        <p className="text-[0.75rem] text-fg-subtle">
          The counts below are for the {loaded} events loaded so far, of {total} matching.
          Load the rest to count them all.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by outcome">
        {OUTCOMES.map((outcome) => (
          <Chip
            key={outcome}
            label={OUTCOME_LABEL[outcome]}
            count={count((e) => e.outcome, outcome)}
            selected={filters.outcome?.includes(outcome) ?? false}
            onToggle={() => onChange({ ...filters, outcome: toggle(filters.outcome, outcome) })}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by where it came from">
        {SOURCES.map((source) => (
          <Chip
            key={source}
            label={AUDIT_SOURCE_LABEL[source]}
            count={count((e) => e.source, source)}
            selected={filters.source?.includes(source) ?? false}
            onToggle={() => onChange({ ...filters, source: toggle(filters.source, source) })}
          />
        ))}
      </div>

      {/* A module chip reading "0" is a filter that does nothing, so only the
          modules that actually contributed something are offered. */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by module">
        {modules.map((module: AuditModule) => (
          <Chip
            key={module}
            label={AUDIT_MODULE_LABEL[module]}
            count={count((e) => e.module, module)}
            selected={filters.module?.includes(module) ?? false}
            onToggle={() => onChange({ ...filters, module: toggle(filters.module, module) })}
          />
        ))}
      </div>
    </div>
  );
}
