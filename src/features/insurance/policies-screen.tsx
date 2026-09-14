"use client";

import { ChevronRight, Search, Shield } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { COVERAGE_TYPE_LABEL, expiryLabel, insuranceDate } from "@/lib/insurance/labels";
import { money } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { InsurancePolicyStatus } from "@/types";
import { CoverageTypeChip, PolicyStatusChip, VerificationChip } from "./chips";
import { usePolicies } from "./hooks";

const STATUS_FILTERS: Array<InsurancePolicyStatus | "all"> = [
  "all", "active", "expiring", "expired", "pending", "cancelled",
];

/**
 * Every policy this organization may see.
 *
 * Superseded versions are hidden by default — renewals pile up quickly and a
 * list that shows five years of the same policy line is not a list anybody
 * reads. They are never deleted, and one switch brings them back.
 */
export function PoliciesScreen() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<InsurancePolicyStatus | "all">("all");
  const [includeSuperseded, setIncludeSuperseded] = useState(false);

  const filters = useMemo(() => ({ includeSuperseded }), [includeSuperseded]);
  const { data, isPending, isError, refetch } = usePolicies(filters);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? []).filter((p) => {
      if (status !== "all" && p.status !== status) return false;
      if (!q) return true;
      return `${p.policyNumber} ${p.insurerName} ${p.agentName ?? ""} ${p.coverage.map((c) => COVERAGE_TYPE_LABEL[c.coverageType]).join(" ")}`
        .toLowerCase().includes(q);
    });
  }, [data, query, status]);

  return (
    <div className="space-y-section">
      <PageHeader
        title="Policies"
        description="Every policy on file, what it covers, and when it runs out."
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-fg-subtle" aria-hidden />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Policy number, insurer, agent or cover…"
            aria-label="Search policies"
            className="pl-9"
          />
        </div>
        <label className="flex h-control items-center gap-2 rounded-md border border-border bg-surface px-3 text-[0.8125rem] text-fg-muted shadow-e1">
          <input
            type="checkbox"
            checked={includeSuperseded}
            onChange={(e) => setIncludeSuperseded(e.target.checked)}
            className="size-3.5 accent-[var(--color-primary)]"
          />
          Show superseded versions
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
            {s === "all" ? "All" : s[0].toUpperCase() + s.slice(1)}
            <span className="ml-1.5 tabular-nums opacity-70">
              {s === "all" ? data?.length ?? 0 : (data ?? []).filter((p) => p.status === s).length}
            </span>
          </button>
        ))}
      </div>

      {isPending ? <LoadingSkeleton rows={4} /> : null}
      {isError ? <ErrorState onRetry={() => refetch()} /> : null}

      {data && data.length === 0 ? (
        <EmptyState
          icon={Shield}
          title="No policies you can see"
          description="Policies belong to the carrier that holds them. You will see one here when your organization records it, or when a carrier shares theirs with you."
        />
      ) : null}

      {data && data.length > 0 && visible.length === 0 ? (
        <EmptyState icon={Search} title="No policies match" description="Try a different search or status." />
      ) : null}

      {visible.length > 0 ? (
        <ul className="space-y-2.5">
          {visible.map((policy) => (
            <li key={policy.policyId}>
              <Link
                href={`/insurance/policies/${policy.policyId}`}
                className={cn(
                  "flex items-start gap-3 rounded-lg border border-border bg-surface p-4 shadow-e1 transition-colors",
                  "hover:border-border-strong hover:bg-surface-hover",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                )}
              >
                <span
                  aria-hidden
                  className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-fg-muted"
                >
                  <Shield className="size-[1.125rem]" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-[0.9375rem] font-semibold text-fg">{policy.policyNumber}</span>
                    <PolicyStatusChip status={policy.status} />
                    {policy.versionNumber > 1 ? (
                      <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[0.6875rem] font-medium text-fg-muted">
                        Version {policy.versionNumber}
                      </span>
                    ) : null}
                    <VerificationChip state={policy.insurerVerification} />
                  </p>
                  <p className="mt-1.5 flex flex-wrap gap-1.5">
                    {policy.coverage.map((c) => (
                      <CoverageTypeChip key={c.coverageId} type={c.coverageType} />
                    ))}
                  </p>
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.75rem] text-fg-muted">
                    <span>{policy.insurerName}</span>
                    <span>{policy.carrierName}</span>
                    <span className="tabular-nums">
                      {insuranceDate(policy.effectiveFrom)} – {insuranceDate(policy.expiresAt)} ·{" "}
                      {expiryLabel(policy.daysUntilExpiry)}
                    </span>
                    <span>{policy.subjectCount} scheduled</span>
                    {policy.premium ? (
                      <span className="tabular-nums">{money(policy.premium.amount)} a year</span>
                    ) : null}
                    {policy.disclosure === "shared_summary" ? (
                      <span>Shared summary</span>
                    ) : null}
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
