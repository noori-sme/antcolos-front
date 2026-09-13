"use client";

import { Package, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import type { LoadFilters, LoadSort } from "@/lib/api/contracts/loads";
import { useActiveMembership } from "@/lib/session/hooks";
import { cn } from "@/lib/utils";
import { useLoadsList } from "./hooks";
import { LoadCards } from "./load-cards";
import { LoadsTable } from "./loads-table";
import { DRIVER_NAMES } from "./driver-names";

const VIEWS: { id: NonNullable<LoadFilters["view"]>; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "upcoming", label: "Upcoming" },
  { id: "completed", label: "Completed" },
  { id: "exceptions", label: "Exceptions" },
  { id: "cancelled", label: "Cancelled" },
  { id: "all", label: "All" },
];

export function LoadsScreen() {
  const [view, setView] = useState<NonNullable<LoadFilters["view"]>>("active");
  const [search, setSearch] = useState("");
  const [missingDocuments, setMissingDocuments] = useState(false);
  const [sort, setSort] = useState<LoadSort>({ field: "pickupAt", direction: "desc" });
  const { membership } = useActiveMembership();

  const filters: LoadFilters = useMemo(
    () => ({
      view,
      search: search.trim() || undefined,
      missingDocuments: missingDocuments || undefined,
    }),
    [view, search, missingDocuments],
  );

  const query = useLoadsList(filters, sort);
  const loads = query.data?.items ?? [];
  const total = query.data?.totalCount ?? 0;

  const driverName = (driverId?: string) =>
    (driverId && DRIVER_NAMES[driverId]) || "Assigned";

  const filtered = Boolean(search.trim()) || missingDocuments;

  return (
    <div className="space-y-section">
      <PageHeader
        title="Loads"
        description={
          membership?.scope.loads === "assigned"
            ? "Loads assigned to you."
            : "Every load in this organization."
        }
        actions={<Badge tone="outline">{total} shown</Badge>}
      />

      <div className="space-y-3">
        <div
          role="tablist"
          aria-label="Load views"
          className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1"
        >
          {VIEWS.map((v) => (
            <button
              key={v.id}
              role="tab"
              aria-selected={view === v.id}
              onClick={() => setView(v.id)}
              className={cn(
                "h-control shrink-0 rounded-md px-3 text-[0.875rem] font-medium transition-colors",
                view === v.id
                  ? "bg-surface-hover text-fg shadow-e1 ring-1 ring-border"
                  : "text-fg-muted hover:bg-surface-hover hover:text-fg",
              )}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-sm">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle"
            />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Reference, customer, city…"
              aria-label="Search loads"
              className="pl-9"
            />
          </div>
          <Chip
            label="Missing documents"
            selected={missingDocuments}
            onToggle={() => setMissingDocuments((v) => !v)}
          />
          {filtered ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setMissingDocuments(false);
              }}
            >
              <X aria-hidden />
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      {query.isPending ? (
        <LoadingSkeleton rows={6} />
      ) : query.isError ? (
        <ErrorState
          title="Could not load this list"
          description={query.error.message}
          onRetry={() => query.refetch()}
        />
      ) : loads.length === 0 ? (
        <EmptyState
          icon={Package}
          title={filtered ? "No loads match these filters" : `No ${view} loads`}
          description={
            filtered
              ? "Clear the search or the document filter to widen the list."
              : "Loads appear here once a rate confirmation is verified."
          }
        />
      ) : (
        <>
          {/* Table on tablet and up; purpose-built cards on a phone. */}
          <div className="hidden md:block">
            <LoadsTable
              loads={loads}
              sort={sort}
              onSortChange={setSort}
              driverName={driverName}
            />
          </div>
          <div className="md:hidden">
            <LoadCards loads={loads} driverName={driverName} />
          </div>
        </>
      )}

      <p className="text-[0.75rem] text-fg-subtle">
        Read-only for now. Assignment, status changes and the dispatch board
        arrive in later milestones.
      </p>
    </div>
  );
}
