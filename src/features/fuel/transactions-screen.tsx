"use client";

import Link from "next/link";
import { ChevronRight, Fuel, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Can } from "@/components/auth/can";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { money } from "@/lib/utils/format";
import { formatGallons } from "@/lib/fuel/units";
import type { FuelTransactionFilters, FuelTransactionState } from "@/types";
import { useFuelTransactions } from "./hooks";
import { FlagChip, FuelStateChip, QualifiesChip, SourceChip } from "./chips";
import { RecordPurchaseDialog } from "./record-purchase-dialog";
import { PAGE_SIZE, ShowMore } from "./show-more";
import { cn } from "@/lib/utils";

const STATES: (FuelTransactionState | "all")[] = [
  "all", "manual", "imported", "pending_review", "verified", "corrected", "duplicate", "rejected",
];

const STATE_LABEL: Record<string, string> = {
  all: "All", manual: "By hand", imported: "Imported", pending_review: "Pending review",
  verified: "Verified", corrected: "Corrected", duplicate: "Duplicate", rejected: "Rejected",
};

/**
 * The fuel ledger.
 *
 * Superseded revisions are hidden by default and can be shown, because "what
 * does this quarter say" and "what did we originally write down" are both
 * legitimate questions and the second one is the whole point of keeping them.
 */
export function FuelTransactionsScreen() {
  const [search, setSearch] = useState("");
  const [state, setState] = useState<FuelTransactionState | "all">("all");
  const [includeSuperseded, setIncludeSuperseded] = useState(false);
  const [recording, setRecording] = useState(false);
  // How many rows are showing, tied to the filter they were asked for. Keeping
  // the two together means a new filter starts at the top without an effect
  // reaching back in to reset it.
  const [page, setPage] = useState({ key: "", shown: PAGE_SIZE });

  const filters: FuelTransactionFilters = useMemo(
    () => ({
      search: search.trim() || undefined,
      state: state === "all" ? undefined : [state],
      includeSuperseded,
    }),
    [search, state, includeSuperseded],
  );

  const { data, isPending, isError, refetch } = useFuelTransactions(filters);

  const filterKey = JSON.stringify(filters);
  const shown = page.key === filterKey ? page.shown : PAGE_SIZE;
  const visible = useMemo(() => (data ?? []).slice(0, shown), [data, shown]);

  return (
    <div className="space-y-section">
      <PageHeader
        title="Fuel purchases"
        description="Every purchase, immutable once written. A mistake is corrected with a new revision; the original stays."
        actions={
          <Can permission="fuel:record">
            <Button variant="primary" onClick={() => setRecording(true)}>
              <Fuel aria-hidden />
              Record a purchase
            </Button>
          </Can>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-fg-subtle" aria-hidden />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Truck stop, city, unit or driver…"
            aria-label="Search fuel purchases"
            className="pl-9"
          />
        </div>
        <label className="flex items-center gap-2 text-[0.8125rem] text-fg-muted">
          <input
            type="checkbox"
            checked={includeSuperseded}
            onChange={(e) => setIncludeSuperseded(e.target.checked)}
            className="size-4 rounded border-border-strong accent-[var(--brand-primary)]"
          />
          Show superseded revisions
        </label>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by state">
        {STATES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={state === s}
            onClick={() => setState(s)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-[0.75rem] font-medium transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              state === s
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg",
            )}
          >
            {STATE_LABEL[s]}
          </button>
        ))}
      </div>

      {isPending ? <LoadingSkeleton rows={6} /> : null}
      {isError ? <ErrorState onRetry={() => void refetch()} /> : null}

      {data && data.length === 0 ? (
        <EmptyState
          icon={Fuel}
          title="No purchases match"
          description="Try a different search or state filter."
        />
      ) : null}

      {data && data.length > 0 ? (
        <ul className="space-y-2">
          {visible.map((t) => (
            <li key={t.id}>
              <Link
                href={`/fuel/transactions/${t.id}`}
                className={cn(
                  "flex items-start gap-3 rounded-lg border border-border bg-surface p-4 shadow-e1 transition-colors",
                  "hover:border-border-strong hover:bg-surface-hover",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  !t.revision.isCurrent && "opacity-70",
                )}
              >
                <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-fg-muted">
                  <Fuel className="size-[1.125rem]" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-[0.9375rem] font-semibold text-fg">
                      {t.location.merchantName ?? "Fuel purchase"}
                    </span>
                    <FuelStateChip state={t.state} />
                    <QualifiesChip qualifies={t.qualifiesForIfta} />
                    <SourceChip source={t.source} />
                    {t.revision.number > 1 ? (
                      <span className="rounded-full bg-st-progress-bg px-2 py-0.5 text-[0.6875rem] font-medium text-st-progress">
                        Revision {t.revision.number}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.75rem] text-fg-muted">
                    <span>Unit {t.truckUnitSnapshot ?? "—"}</span>
                    <span>{t.driverNameSnapshot ?? "No driver recorded"}</span>
                    <span>{t.location.address.city}, {t.location.jurisdiction}</span>
                    <span className="tabular-nums">
                      {new Date(t.purchasedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                    <span className="tabular-nums">{formatGallons(t.gallonsThousandths)}</span>
                    {t.cost ? <span className="tabular-nums">{money(t.cost.totalCostCents)}</span> : null}
                  </p>
                  {t.flags.length > 0 ? (
                    <p className="mt-2 flex flex-wrap gap-1.5">
                      {t.flags.map((f) => <FlagChip key={f} flag={f} />)}
                    </p>
                  ) : null}
                </div>
                <ChevronRight className="mt-1 size-4 shrink-0 text-fg-subtle" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {data ? (
        <ShowMore
          shown={shown}
          total={data.length}
          noun="purchases"
          onMore={() => setPage({ key: filterKey, shown: shown + PAGE_SIZE })}
        />
      ) : null}

      {recording ? <RecordPurchaseDialog onClose={() => setRecording(false)} /> : null}
    </div>
  );
}
