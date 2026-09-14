"use client";

import { ChevronRight, Search, ShieldOff, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { CLAIM_STATUS_LABEL } from "@/lib/insurance/claim-states";
import { insuranceDate } from "@/lib/insurance/labels";
import { cn } from "@/lib/utils";
import type { ClaimStatus } from "@/types";
import { ClaimSeverityChip, ClaimStatusChip, ClaimTypeChip } from "./chips";
import { useClaims } from "./hooks";

const STATUS_FILTERS: Array<ClaimStatus | "all" | "open"> = [
  "all", "open", "reported", "under_review", "investigating", "submitted",
  "approved", "denied", "paid", "closed",
];

const FILTER_LABEL = (s: ClaimStatus | "all" | "open") =>
  s === "all" ? "All" : s === "open" ? "Open" : CLAIM_STATUS_LABEL[s];

/** Every claim this organization may see, newest event first. */
export function ClaimsScreen() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ClaimStatus | "all" | "open">("all");
  const [uncoveredOnly, setUncoveredOnly] = useState(false);

  const { data, isPending, isError, refetch } = useClaims({});

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? []).filter((c) => {
      if (status === "open" && !["reported", "under_review", "submitted", "investigating", "approved"].includes(c.status)) return false;
      if (status !== "all" && status !== "open" && c.status !== status) return false;
      if (uncoveredOnly && c.covered) return false;
      if (!q) return true;
      return `${c.claimReference} ${c.title} ${c.truckLabel ?? ""} ${c.trailerLabel ?? ""} ${c.driverName ?? ""} ${c.loadReference ?? ""}`
        .toLowerCase().includes(q);
    });
  }, [data, query, status, uncoveredOnly]);

  const uncovered = (data ?? []).filter((c) => !c.covered).length;

  return (
    <div className="space-y-section">
      <PageHeader
        title="Claims"
        description="Accidents, cargo damage and every other insured event, with what coverage answered at the time."
      />

      {uncovered > 0 ? (
        <div className="flex items-start gap-3 rounded-lg border border-st-danger/35 bg-st-danger-bg/40 p-4">
          <ShieldOff className="mt-0.5 size-4 shrink-0 text-st-danger" aria-hidden />
          <div>
            <p className="text-[0.875rem] font-semibold text-fg">
              {uncovered === 1 ? "One claim has" : `${uncovered} claims have`} no coverage answering
            </p>
            <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-fg-muted">
              Coverage was read as at the date of each event. Where nothing answered, the
              carrier is exposed for the loss itself.
            </p>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-fg-subtle" aria-hidden />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Reference, unit, driver or load…"
            aria-label="Search claims"
            className="pl-9"
          />
        </div>
        <label className="flex h-control items-center gap-2 rounded-md border border-border bg-surface px-3 text-[0.8125rem] text-fg-muted shadow-e1">
          <input
            type="checkbox"
            checked={uncoveredOnly}
            onChange={(e) => setUncoveredOnly(e.target.checked)}
            className="size-3.5 accent-[var(--color-primary)]"
          />
          Uncovered only
        </label>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-[0.75rem] font-medium transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              status === s
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg",
            )}
          >
            {FILTER_LABEL(s)}
          </button>
        ))}
      </div>

      {isPending ? <LoadingSkeleton rows={4} /> : null}
      {isError ? <ErrorState onRetry={() => refetch()} /> : null}

      {data && data.length === 0 ? (
        <EmptyState
          icon={TriangleAlert}
          title="No claims you can see"
          description="A claim belongs to the carrier that reported it. You will see one here when your organization reports it, or when a carrier shares one with you."
        />
      ) : null}

      {data && data.length > 0 && visible.length === 0 ? (
        <EmptyState icon={Search} title="No claims match" description="Try a different search or status." />
      ) : null}

      {visible.length > 0 ? (
        <ul className="space-y-2.5">
          {visible.map((claim) => (
            <li key={claim.claimId}>
              <Link
                href={`/insurance/claims/${claim.claimId}`}
                className={cn(
                  "flex items-start gap-3 rounded-lg border bg-surface p-4 shadow-e1 transition-colors",
                  "hover:border-border-strong hover:bg-surface-hover",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  claim.covered ? "border-border" : "border-st-danger/35",
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-[0.9375rem] font-semibold text-fg">{claim.claimReference}</span>
                    <ClaimStatusChip status={claim.status} />
                    <ClaimTypeChip type={claim.claimType} />
                    <ClaimSeverityChip severity={claim.severity} />
                    {claim.covered ? null : <Badge tone="danger">No coverage answered</Badge>}
                    {claim.missingRequiredEvidence > 0 ? (
                      <Badge tone="warning">
                        {claim.missingRequiredEvidence}{" "}
                        {claim.missingRequiredEvidence === 1 ? "document" : "documents"} missing
                      </Badge>
                    ) : null}
                    {claim.disclosure === "shared_summary" ? (
                      <Badge tone="outline">Shared with you</Badge>
                    ) : null}
                  </p>
                  <p className="mt-1 text-[0.875rem] text-fg">{claim.title}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.75rem] text-fg-muted">
                    <span className="tabular-nums">{insuranceDate(claim.eventAt)}</span>
                    {claim.truckLabel ? <span>{claim.truckLabel}</span> : null}
                    {claim.trailerLabel ? <span>{claim.trailerLabel}</span> : null}
                    {claim.driverName ? <span>{claim.driverName}</span> : null}
                    {claim.loadReference ? <span>Load {claim.loadReference}</span> : null}
                    {claim.insurerName ? <span>{claim.insurerName}</span> : null}
                  </p>
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
