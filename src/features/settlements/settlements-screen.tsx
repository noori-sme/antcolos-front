"use client";

import { ChevronRight, Receipt, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PAYEE_KIND_LABEL, SETTLEMENT_STATUS } from "@/config/statuses";
import { canBeOverdue } from "@/lib/settlements/status";
import { useActiveMembership } from "@/lib/session/hooks";
import { money } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import type {
  PayeeKind, SettlementFilters, SettlementSortField, SettlementStatus, SettlementSummary,
} from "@/types";
import {
  BlockedChip, DisputeChip, OverdueChip, PayeeKindChip, SettlementKindChip,
  SettlementStatusChip,
} from "./settlement-chips";
import { daysPast, dueLabel, formatDate } from "./settlement-labels";
import {
  useSettlementList, useSettlementPayees, useSettlementPeriods, useSettlementTotals,
} from "./hooks";

/**
 * The settlement list.
 *
 * Two audiences read this screen and they are not the same person. A carrier's
 * office sees every payee, with a roll-up of what the business owes. A payee
 * sees their own pay statements and no roll-up at all — that difference is
 * decided at the service, not here, so this screen renders what it is given.
 */

type ViewKey = NonNullable<SettlementFilters["view"]>;

const VIEWS: { key: ViewKey; label: string }[] = [
  { key: "needs_attention", label: "Needs attention" },
  { key: "awaiting_approval", label: "Awaiting approval" },
  { key: "disputed", label: "Disputed" },
  { key: "unpaid", label: "Unpaid" },
  { key: "overdue", label: "Overdue" },
  { key: "paid", label: "Paid" },
  { key: "all", label: "All" },
];

const STATUSES = Object.keys(SETTLEMENT_STATUS) as SettlementStatus[];
const PAYEE_KINDS = Object.keys(PAYEE_KIND_LABEL) as PayeeKind[];

const SELECT =
  "h-control rounded-md border border-border bg-surface px-3 text-[0.8125rem] text-fg shadow-e1 " +
  "hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35";

export function SettlementsScreen() {
  const { membership } = useActiveMembership();
  const isPayeeView = membership?.scope.financials === "own";

  const [view, setView] = useState<ViewKey>("all");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<SettlementStatus | "all">("all");
  const [payeeKind, setPayeeKind] = useState<PayeeKind | "all">("all");
  const [payeeId, setPayeeId] = useState<string>("all");
  const [periodId, setPeriodId] = useState<string>("all");
  const [sortField, setSortField] = useState<SettlementSortField>("period");
  const [showFilters, setShowFilters] = useState(false);

  const filters = useMemo<SettlementFilters>(
    () => ({
      view,
      search: search.trim() || undefined,
      status: status === "all" ? undefined : [status],
      payeeKind: payeeKind === "all" ? undefined : [payeeKind],
      payeeId: payeeId === "all" ? undefined : payeeId,
      periodId: periodId === "all" ? undefined : periodId,
    }),
    [view, search, status, payeeKind, payeeId, periodId],
  );

  const list = useSettlementList(filters, { field: sortField, direction: "desc" });
  const totals = useSettlementTotals(filters);
  const payees = useSettlementPayees();
  const periods = useSettlementPeriods();

  const items = list.data?.items ?? [];
  const filtersApplied =
    Boolean(search.trim()) ||
    status !== "all" ||
    payeeKind !== "all" ||
    payeeId !== "all" ||
    periodId !== "all" ||
    view !== "all";

  return (
    <div className="space-y-section">
      <PageHeader
        title={isPayeeView ? "My settlements" : "Settlements"}
        description={
          isPayeeView
            ? "What you have been paid, what is still owed, and how each figure was worked out."
            : "What this carrier owes each payee, for which period, and what is holding a settlement up."
        }
        actions={
          <Button
            variant="secondary"
            aria-expanded={showFilters}
            onClick={() => setShowFilters((v) => !v)}
          >
            <SlidersHorizontal aria-hidden />
            Filters
          </Button>
        }
      />

      {totals.data ? <SettlementTotalsRail totals={totals.data} /> : null}

      {/* Views ------------------------------------------------------------ */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by view">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            aria-pressed={view === v.key}
            onClick={() => setView(v.key)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-[0.75rem] font-medium transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              view === v.key
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg",
            )}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* Search + filters ------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-fg-subtle"
          />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Settlement number, payee, period or load…"
            aria-label="Search settlements"
            className="pl-9"
          />
        </div>

        <label className="sr-only" htmlFor="sort-field">Sort settlements by</label>
        <select
          id="sort-field"
          value={sortField}
          onChange={(e) => setSortField(e.target.value as SettlementSortField)}
          className={SELECT}
        >
          <option value="period">Newest period first</option>
          <option value="netPay">Largest net pay</option>
          <option value="outstanding">Most outstanding</option>
          <option value="payee">Payee</option>
          <option value="number">Settlement number</option>
          <option value="updatedAt">Recently changed</option>
        </select>
      </div>

      {showFilters ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-sunken/50 p-3">
          <label className="sr-only" htmlFor="status-filter">Filter by status</label>
          <select
            id="status-filter"
            value={status}
            onChange={(e) => setStatus(e.target.value as SettlementStatus | "all")}
            className={SELECT}
          >
            <option value="all">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{SETTLEMENT_STATUS[s].label}</option>
            ))}
          </select>

          {!isPayeeView ? (
            <>
              <label className="sr-only" htmlFor="payee-kind-filter">Filter by payee type</label>
              <select
                id="payee-kind-filter"
                value={payeeKind}
                onChange={(e) => setPayeeKind(e.target.value as PayeeKind | "all")}
                className={SELECT}
              >
                <option value="all">Any payee type</option>
                {PAYEE_KINDS.map((k) => (
                  <option key={k} value={k}>{PAYEE_KIND_LABEL[k]}</option>
                ))}
              </select>

              <label className="sr-only" htmlFor="payee-filter">Filter by payee</label>
              <select
                id="payee-filter"
                value={payeeId}
                onChange={(e) => setPayeeId(e.target.value)}
                className={SELECT}
              >
                <option value="all">Everyone</option>
                {(payees.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.displayNameSnapshot}</option>
                ))}
              </select>
            </>
          ) : null}

          <label className="sr-only" htmlFor="period-filter">Filter by period</label>
          <select
            id="period-filter"
            value={periodId}
            onChange={(e) => setPeriodId(e.target.value)}
            className={SELECT}
          >
            <option value="all">Any period</option>
            {(periods.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>

          {filtersApplied ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setStatus("all");
                setPayeeKind("all");
                setPayeeId("all");
                setPeriodId("all");
                setView("all");
              }}
            >
              Clear
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* Results ----------------------------------------------------------- */}
      {list.isPending ? <LoadingSkeleton rows={5} /> : null}

      {list.isError ? (
        <ErrorState
          title="Could not load settlements"
          description={list.error.message}
          onRetry={() => list.refetch()}
        />
      ) : null}

      {list.isSuccess && items.length === 0 ? (
        <EmptyState
          icon={filtersApplied ? Search : Receipt}
          title={filtersApplied ? "No settlements match" : "No settlements yet"}
          description={
            filtersApplied
              ? "Try a different search, status, payee or period."
              : isPayeeView
                ? "When this carrier settles a pay period for you, it will appear here with the full working behind every figure."
                : "Settlements appear here once there is delivered work to pay for. Nothing is calculated until then."
          }
        />
      ) : null}

      {items.length > 0 ? (
        <>
          <ul className="space-y-2.5">
            {items.map((settlement) => (
              <li key={settlement.id}>
                <SettlementRow settlement={settlement} showPayee={!isPayeeView} />
              </li>
            ))}
          </ul>
          <p className="text-[0.75rem] text-fg-subtle">
            {items.length} of {list.data?.totalCount ?? items.length}
            {isPayeeView ? " · Showing only settlements you are the payee of." : null}
          </p>
        </>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Roll-up                                                                     */
/* -------------------------------------------------------------------------- */

function SettlementTotalsRail({
  totals,
}: {
  totals: NonNullable<ReturnType<typeof useSettlementTotals>["data"]>;
}) {
  const tiles: { label: string; value: string; tone?: "danger" | "warning" }[] = [
    { label: "Settlements", value: String(totals.settlementCount) },
    { label: "Net pay", value: money(totals.netPayCents, { compact: true }) },
    { label: "Still owed", value: money(totals.outstandingCents, { compact: true }) },
    {
      label: "Overdue",
      value: String(totals.overdueCount),
      tone: totals.overdueCount > 0 ? "danger" : undefined,
    },
    {
      label: "Disputed",
      value: String(totals.disputedCount),
      tone: totals.disputedCount > 0 ? "danger" : undefined,
    },
    {
      label: "Blocked",
      value: String(totals.blockedCount),
      tone: totals.blockedCount > 0 ? "warning" : undefined,
    },
  ];

  return (
    <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded-lg border border-border bg-surface p-3.5 shadow-e1">
          <dt className="text-[0.75rem] text-fg-muted">{tile.label}</dt>
          <dd
            className={cn(
              "mt-1 text-[1.125rem] leading-7 font-semibold tabular-nums text-fg",
              tile.tone === "danger" && "text-st-danger",
              tile.tone === "warning" && "text-st-warning",
            )}
          >
            {tile.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* -------------------------------------------------------------------------- */
/* Row                                                                         */
/* -------------------------------------------------------------------------- */

function SettlementRow({
  settlement,
  showPayee,
}: {
  settlement: SettlementSummary;
  showPayee: boolean;
}) {
  // The same test the service applies: a settlement is only late if somebody is
  // still owed AND it is in a status that could be paid. A paid or voided one is
  // never late, whatever its due date says.
  const overdueDays =
    settlement.paymentDueAt &&
    settlement.amountOutstandingCents > 0 &&
    canBeOverdue(settlement.status)
      ? daysPast(settlement.paymentDueAt)
      : 0;

  return (
    <Link
      href={`/finance/settlements/${settlement.id}`}
      className={cn(
        "flex items-start gap-3 rounded-lg border border-border bg-surface p-4 shadow-e1 transition-colors",
        "hover:border-border-strong hover:bg-surface-hover",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        settlement.status === "voided" && "opacity-65",
      )}
    >
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-fg-muted"
      >
        <Receipt className="size-[1.125rem]" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[0.9375rem] font-semibold text-fg">{settlement.number}</span>
          <SettlementStatusChip status={settlement.status} />
          <SettlementKindChip kind={settlement.kind} />
          <BlockedChip count={settlement.blockingGapCount} />
          <DisputeChip
            count={settlement.status === "disputed" ? 0 : settlement.openDisputeCount}
          />
          <OverdueChip days={overdueDays} />
        </span>

        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] text-fg-muted">
          {showPayee ? (
            <>
              <span className="font-medium text-fg">{settlement.payee.displayNameSnapshot}</span>
              <PayeeKindChip kind={settlement.payee.kind} />
            </>
          ) : null}
          <span>{settlement.periodLabel}</span>
          <span>
            {settlement.loadCount} {settlement.loadCount === 1 ? "load" : "loads"}
          </span>
        </span>

        <span className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-[0.75rem] text-fg-subtle">
            Net{" "}
            <span className="text-[0.9375rem] font-semibold tabular-nums text-fg">
              {money(settlement.netPayCents)}
            </span>
          </span>
          {settlement.amountOutstandingCents > 0 &&
          settlement.amountOutstandingCents !== settlement.netPayCents ? (
            <span className="text-[0.75rem] text-fg-subtle">
              Still owed{" "}
              <span className="font-semibold tabular-nums text-fg">
                {money(settlement.amountOutstandingCents)}
              </span>
            </span>
          ) : null}
          {settlement.status === "paid" ? (
            <span className="text-[0.75rem] text-fg-subtle">Paid in full</span>
          ) : settlement.status === "disputed" ? (
            // Past its date, but not in the overdue queue — the dispute is why
            // it has not been paid, and saying "overdue" would send somebody
            // chasing a payment that is deliberately on hold.
            <span className="text-[0.75rem] text-fg-subtle">On hold while disputed</span>
          ) : settlement.paymentDueAt &&
            settlement.amountOutstandingCents > 0 &&
            settlement.status !== "voided" ? (
            <span
              className={cn(
                "text-[0.75rem]",
                overdueDays > 0 ? "font-medium text-st-danger" : "text-fg-subtle",
              )}
            >
              {dueLabel(settlement.paymentDueAt)}
            </span>
          ) : null}
        </span>
      </span>

      <span className="flex shrink-0 flex-col items-end gap-1.5">
        <Badge tone="outline">{formatDate(settlement.periodEndAt)}</Badge>
        <ChevronRight aria-hidden className="size-4 text-fg-subtle" />
      </span>
    </Link>
  );
}
