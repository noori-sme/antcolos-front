"use client";

import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import {
  CATEGORY_LABEL, SEVERITY_LABEL,
  type NeedsYouCategory, type NeedsYouFilters, type NeedsYouItem,
  type NeedsYouSeverity, type NeedsYouStatus,
} from "@/types";

const SEVERITIES: NeedsYouSeverity[] = ["critical", "high", "medium", "low"];
const STATUSES: NeedsYouStatus[] = ["open", "escalated", "snoozed", "resolved"];
const STATUS_LABEL: Record<NeedsYouStatus, string> = {
  open: "Open", escalated: "Escalated", snoozed: "Snoozed", resolved: "Resolved",
};
const DUE_WINDOWS = [
  { label: "Next 2h", hours: 2 },
  { label: "Next 8h", hours: 8 },
  { label: "Today", hours: 24 },
];

function toggle<T>(list: T[] | undefined, value: T): T[] | undefined {
  const current = list ?? [];
  const next = current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value];
  return next.length > 0 ? next : undefined;
}

export function NeedsYouFilterBar({
  filters, onChange, allItems,
}: {
  filters: NeedsYouFilters;
  onChange: (next: NeedsYouFilters) => void;
  /** Unfiltered set, used only for chip counts. */
  allItems: NeedsYouItem[];
}) {
  const severityCount = (s: NeedsYouSeverity) =>
    allItems.filter((i) => i.severity === s).length;

  const categories = Array.from(new Set(allItems.map((i) => i.category)))
    .sort((a, b) => CATEGORY_LABEL[a].localeCompare(CATEGORY_LABEL[b]));

  const active =
    (filters.severity?.length ?? 0) +
    (filters.category?.length ?? 0) +
    (filters.status?.length ?? 0) +
    (filters.dueWithinHours ? 1 : 0) +
    (filters.owner && filters.owner !== "all" ? 1 : 0) +
    (filters.search ? 1 : 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle"
          />
          <Input
            type="search"
            value={filters.search ?? ""}
            onChange={(e) => onChange({ ...filters, search: e.target.value || undefined })}
            placeholder="Search items, loads, trucks…"
            aria-label="Search Needs You"
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-1.5">
          {(["all", "me", "unassigned"] as const).map((owner) => (
            <Chip
              key={owner}
              label={owner === "all" ? "Everyone" : owner === "me" ? "Mine" : "Unassigned"}
              selected={(filters.owner ?? "all") === owner}
              onToggle={() => onChange({ ...filters, owner })}
            />
          ))}
        </div>

        {active > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange({ status: ["open", "escalated"], owner: "all" })}
          >
            <X aria-hidden />
            Clear filters
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {SEVERITIES.map((s) => (
          <Chip
            key={s}
            label={SEVERITY_LABEL[s]}
            count={severityCount(s)}
            selected={filters.severity?.includes(s) ?? false}
            onToggle={() => onChange({ ...filters, severity: toggle(filters.severity, s) })}
          />
        ))}
        <span aria-hidden className="mx-1 h-5 w-px bg-border" />
        {DUE_WINDOWS.map((w) => (
          <Chip
            key={w.hours}
            label={w.label}
            selected={filters.dueWithinHours === w.hours}
            onToggle={() =>
              onChange({
                ...filters,
                dueWithinHours: filters.dueWithinHours === w.hours ? undefined : w.hours,
              })
            }
          />
        ))}
        <span aria-hidden className="mx-1 h-5 w-px bg-border" />
        {STATUSES.map((s) => (
          <Chip
            key={s}
            label={STATUS_LABEL[s]}
            selected={filters.status?.includes(s) ?? false}
            onToggle={() => onChange({ ...filters, status: toggle(filters.status, s) })}
          />
        ))}
      </div>

      {categories.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {categories.map((c: NeedsYouCategory) => (
            <Chip
              key={c}
              label={CATEGORY_LABEL[c]}
              selected={filters.category?.includes(c) ?? false}
              onToggle={() => onChange({ ...filters, category: toggle(filters.category, c) })}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
