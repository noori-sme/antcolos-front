"use client";

import { ChevronRight, Search, UsersRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, LoadingSkeleton } from "@/components/data/states";
import type { EngagementType, RelationshipStatus } from "@/types";
import { RelationshipStatusChip, ExpiryChip } from "./status-chips";
import { ENGAGEMENT_LABEL, daysUntil, expiryState, formatDate } from "./driver-rules";
import { type CarrierDriver, mockListCarrierDrivers } from "./mock-carrier-drivers";
import { cn } from "@/lib/utils";

type StatusFilter = RelationshipStatus | "all";
type EngagementFilter = EngagementType | "all";

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "invited", label: "Invited" },
  { value: "onboarding", label: "Onboarding" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "ended", label: "Ended" },
];

/** The carrier's roster: who is working, who is still onboarding, who lapsed. */
export function CarrierDriversScreen() {
  const [drivers, setDrivers] = useState<CarrierDriver[] | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [engagement, setEngagement] = useState<EngagementFilter>("all");

  useEffect(() => {
    let cancelled = false;
    mockListCarrierDrivers().then((list) => {
      if (!cancelled) setDrivers(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (drivers ?? []).filter((d) => {
      if (status !== "all" && d.status !== status) return false;
      if (engagement !== "all" && d.engagementType !== engagement) return false;
      if (!q) return true;
      return d.name.toLowerCase().includes(q) || d.email.toLowerCase().includes(q);
    });
  }, [drivers, query, status, engagement]);

  return (
    <div className="space-y-section">
      <PageHeader
        title="Drivers"
        description="Everyone driving for you, and everyone still getting set up."
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-fg-subtle" aria-hidden />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or email…"
            aria-label="Search drivers"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by engagement type">
          {([["all", "All types"], ["company_driver", "Company"], ["owner_operator", "Owner-Operator"]] as const).map(
            ([value, label]) => (
              <FilterChip
                key={value}
                label={label}
                active={engagement === value}
                onClick={() => setEngagement(value as EngagementFilter)}
              />
            ),
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by relationship status">
        {STATUS_FILTERS.map((f) => (
          <FilterChip
            key={f.value}
            label={f.label}
            count={
              f.value === "all"
                ? drivers?.length ?? 0
                : drivers?.filter((d) => d.status === f.value).length ?? 0
            }
            active={status === f.value}
            onClick={() => setStatus(f.value)}
          />
        ))}
      </div>

      {drivers === null ? <LoadingSkeleton rows={4} /> : null}

      {drivers !== null && visible.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title="No drivers match"
          description="Try a different search or filter. New drivers appear here as soon as you invite them."
        />
      ) : null}

      {visible.length > 0 ? (
        <ul className="space-y-2.5">
          {visible.map((driver) => (
            <li key={driver.id}>
              <Link
                href={`/people/drivers/${driver.id}`}
                className={cn(
                  "flex items-start gap-3 rounded-lg border border-border bg-surface p-4 shadow-e1 transition-colors",
                  "hover:border-border-strong hover:bg-surface-hover",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-[0.9375rem] font-semibold text-fg">{driver.name}</span>
                    <RelationshipStatusChip status={driver.status} />
                    <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[0.6875rem] font-medium text-fg-muted">
                      {ENGAGEMENT_LABEL[driver.engagementType]}
                    </span>
                  </p>
                  <p className="mt-0.5 truncate text-[0.8125rem] text-fg-muted">{driver.email}</p>

                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.75rem]">
                    <span className="text-fg-muted tabular-nums">
                      Documents {driver.documentsDone}/{driver.documentsRequired}
                    </span>
                    <span className="text-fg-muted">Role: {driver.roleName}</span>
                    {driver.cdlExpiresAt ? (
                      <span className="text-fg-muted">
                        CDL{" "}
                        <ExpiryChip state={expiryState(driver.cdlExpiresAt)}>
                          {formatDate(driver.cdlExpiresAt)}
                        </ExpiryChip>
                      </span>
                    ) : null}
                    {driver.medicalExpiresAt ? (
                      <span className="text-fg-muted">
                        Medical{" "}
                        <ExpiryChip state={expiryState(driver.medicalExpiresAt)}>
                          {formatDate(driver.medicalExpiresAt)}
                        </ExpiryChip>
                      </span>
                    ) : null}
                  </div>
                </div>
                <ChevronRight className="mt-1 size-4 shrink-0 text-fg-subtle" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-[0.75rem] font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg",
      )}
    >
      {label}
      {count !== undefined ? <span className="ml-1.5 tabular-nums opacity-70">{count}</span> : null}
    </button>
  );
}

export { daysUntil };
