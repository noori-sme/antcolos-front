"use client";

import { useState } from "react";
import Link from "next/link";
import { FileSearch } from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import {
  RISK_CASE_STATE_LABEL, type RiskCaseFilters, type RiskCaseState,
  type RiskCaseSummary,
} from "@/types";
import { useActiveMembership } from "@/lib/session/hooks";
import { cn } from "@/lib/utils";
import { CaseStateBadge, SeverityBadge } from "./chips";
import { dueLabel, formatDateTime, isOverdue } from "./format";
import { useRiskCases } from "./use-audit";

const STATES: RiskCaseState[] = [
  "open", "investigating", "action_required", "escalated",
  "resolved", "accepted_risk", "dismissed",
];

function toggle<T>(list: T[] | undefined, value: T): T[] | undefined {
  const current = list ?? [];
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  return next.length ? next : undefined;
}

/**
 * Cases — the investigations.
 *
 * Sorted by urgency the same way the Needs You queue is: severity first, then
 * how close the due date is, with closed cases last.
 */
export function RiskCasesScreen({
  initialState, initialOwner,
}: {
  initialState?: RiskCaseState;
  initialOwner?: "me";
}) {
  const [filters, setFilters] = useState<RiskCaseFilters>({
    ...(initialState ? { state: [initialState] } : {}),
    ...(initialOwner ? { owner: initialOwner } : {}),
  });
  const cases = useRiskCases(filters);
  const { organization } = useActiveMembership();
  const timeZone = organization?.timeZone ?? "UTC";

  const count = (state: RiskCaseState) =>
    (cases.data ?? []).filter((c) => c.state === state).length;

  return (
    <div className="space-y-section">
      <PageHeader
        title="Risk cases"
        description="Investigations opened off one or more signals. A case is where the work happens; the ledger is where the facts stay."
      />

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="search"
            value={filters.search ?? ""}
            onChange={(e) => setFilters({ ...filters, search: e.target.value || undefined })}
            placeholder="Reference or title…"
            aria-label="Search risk cases"
            className="sm:max-w-xs"
          />
          <Chip
            label="Mine"
            selected={filters.owner === "me"}
            onToggle={() =>
              setFilters({ ...filters, owner: filters.owner === "me" ? "all" : "me" })
            }
          />
          <Chip
            label="Unassigned"
            selected={filters.owner === "unassigned"}
            onToggle={() =>
              setFilters({
                ...filters,
                owner: filters.owner === "unassigned" ? "all" : "unassigned",
              })
            }
          />
          <Chip
            label="Overdue"
            selected={Boolean(filters.overdue)}
            onToggle={() => setFilters({ ...filters, overdue: !filters.overdue || undefined })}
          />
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by state">
          {STATES.map((state) => (
            <Chip
              key={state}
              label={RISK_CASE_STATE_LABEL[state]}
              count={count(state)}
              selected={filters.state?.includes(state) ?? false}
              onToggle={() => setFilters({ ...filters, state: toggle(filters.state, state) })}
            />
          ))}
        </div>
      </div>

      {cases.isLoading ? <LoadingSkeleton rows={4} /> : null}
      {cases.isError ? <ErrorState onRetry={() => cases.refetch()} /> : null}

      {cases.data ? (
        cases.data.length === 0 ? (
          <EmptyState
            icon={FileSearch}
            title="No cases"
            description="Nothing has been opened for investigation. Cases are opened from a signal, on the Risk signals screen."
          />
        ) : (
          <ol className="space-y-2">
            {cases.data.map((riskCase) => (
              <li key={riskCase.id}>
                <CaseRow riskCase={riskCase} timeZone={timeZone} />
              </li>
            ))}
          </ol>
        )
      ) : null}
    </div>
  );
}

function CaseRow({
  riskCase, timeZone,
}: {
  riskCase: RiskCaseSummary;
  timeZone: string;
}) {
  const overdue = isOverdue(riskCase.dueAt)
    && !["resolved", "accepted_risk", "dismissed"].includes(riskCase.state);

  return (
    <Link
      href={`/audit/cases/${riskCase.id}`}
      className={cn(
        "block rounded-lg border bg-surface px-4 py-3.5 transition-colors hover:border-border-strong",
        overdue ? "border-st-warning/40" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="tnum text-[0.75rem] font-semibold text-fg-subtle">
          {riskCase.reference}
        </span>
        <SeverityBadge severity={riskCase.severity} />
        <CaseStateBadge state={riskCase.state} />
        {riskCase.independentReviewRequired ? (
          <span className="text-[0.6875rem] font-medium text-fg-subtle">
            Independent review required
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-[0.9375rem] font-semibold text-fg">{riskCase.title}</p>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.75rem] text-fg-subtle">
        <span>
          {riskCase.signalCount} signal{riskCase.signalCount === 1 ? "" : "s"}
        </span>
        <span aria-hidden>·</span>
        <span>
          {riskCase.assigneeName
            ? `With ${riskCase.assigneeName}`
            : riskCase.assigneeMembershipId
              ? `With ${riskCase.assigneeMembershipId}`
              : "Nobody is on it"}
        </span>
        <span aria-hidden>·</span>
        <span className={cn(overdue && "font-medium text-st-warning")}>
          {dueLabel(riskCase.dueAt)}
        </span>
        <span aria-hidden>·</span>
        <span>Opened {formatDateTime(riskCase.openedAt, timeZone)}</span>
      </p>
    </Link>
  );
}
