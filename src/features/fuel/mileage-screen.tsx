"use client";

import Link from "next/link";
import { Check, Map, PenLine, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Can } from "@/components/auth/can";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { jurisdictionName } from "@/lib/fuel/jurisdictions";
import type { MileageRecordFilters, MileageRecordState } from "@/types";
import { useFuelAction, useMileageRecords } from "./hooks";
import { MileageFlagChip, MileageStateChip } from "./chips";
import { RecordMileageDialog } from "./record-mileage-dialog";
import { CorrectMileageDialog } from "./correct-mileage-dialog";
import { PAGE_SIZE, ShowMore } from "./show-more";
import { cn } from "@/lib/utils";

const STATES: (MileageRecordState | "all")[] = [
  "all", "manual", "imported", "pending_review", "verified", "corrected", "rejected",
];

const STATE_LABEL: Record<string, string> = {
  all: "All", manual: "By hand", imported: "Imported", pending_review: "Pending review",
  verified: "Verified", corrected: "Corrected", rejected: "Rejected",
};

/**
 * Jurisdiction mileage, kept deliberately apart from fuel.
 *
 * Nothing on this screen mentions gallons or money, and nothing on the fuel
 * ledger mentions jurisdiction miles. They meet for the first time on the IFTA
 * quarter, which is the only place they are supposed to.
 */
export function MileageScreen() {
  const [search, setSearch] = useState("");
  const [state, setState] = useState<MileageRecordState | "all">("all");
  const [recording, setRecording] = useState(false);
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Tied to the filter it was asked for, so a new filter starts at the top.
  const [page, setPage] = useState({ key: "", shown: PAGE_SIZE });
  const action = useFuelAction();

  const filters: MileageRecordFilters = useMemo(
    () => ({ state: state === "all" ? undefined : [state] }),
    [state],
  );
  const { data, isPending, isError, refetch } = useMileageRecords(filters);

  const matching = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data ?? [];
    return (data ?? []).filter((r) =>
      [r.jurisdiction, jurisdictionName(r.jurisdiction), r.truckUnitSnapshot, r.driverNameSnapshot]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [data, search]);

  const filterKey = `${state}|${search.trim().toLowerCase()}`;
  const shown = page.key === filterKey ? page.shown : PAGE_SIZE;
  const visible = useMemo(() => matching.slice(0, shown), [matching, shown]);

  const correcting = matching.find((r) => r.id === correctingId) ?? null;

  const verify = async (id: string) => {
    setError(null);
    try {
      await action.mutateAsync({ kind: "verify_mileage", id });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    }
  };

  return (
    <div className="space-y-section">
      <PageHeader
        title="Jurisdiction mileage"
        description="Miles run in each state and province. A separate record from a fuel purchase — an IFTA return needs both, and neither can be derived from the other."
        actions={
          <Can permission="mileage:record">
            <Button variant="primary" onClick={() => setRecording(true)}>
              <Map aria-hidden />
              Record mileage
            </Button>
          </Can>
        }
      />

      <div className="relative min-w-0 sm:max-w-xs">
        <Search className="pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-fg-subtle" aria-hidden />
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Jurisdiction, unit or driver…"
          aria-label="Search mileage records"
          className="pl-9"
        />
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

      {error ? (
        <p role="alert" className="rounded-md border border-st-danger/30 bg-st-danger-bg/50 px-3.5 py-2.5 text-[0.8125rem] text-st-danger">
          {error}
        </p>
      ) : null}

      {isPending ? <LoadingSkeleton rows={6} /> : null}
      {isError ? <ErrorState onRetry={() => void refetch()} /> : null}

      {data && matching.length === 0 ? (
        <EmptyState
          icon={Map}
          title="No mileage records match"
          description="Record miles by hand, or connect an ELD when there is one to connect."
        />
      ) : null}

      {visible.length > 0 ? (
        <ul className="space-y-2">
          {visible.map((r) => (
            <li
              key={r.id}
              className={cn(
                "rounded-lg border border-border bg-surface p-4 shadow-e1",
                !r.revision.isCurrent && "opacity-70",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-[0.9375rem] font-semibold text-fg">
                      {r.jurisdiction} — {jurisdictionName(r.jurisdiction)}
                    </span>
                    <MileageStateChip state={r.state} />
                    {r.revision.number > 1 ? (
                      <span className="rounded-full bg-st-progress-bg px-2 py-0.5 text-[0.6875rem] font-medium text-st-progress">
                        Revision {r.revision.number}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.75rem] text-fg-muted">
                    <Link href={`/fleet/trucks/${r.truckId}`} className="hover:text-primary">
                      Unit {r.truckUnitSnapshot ?? "—"}
                    </Link>
                    <span>{r.driverNameSnapshot ?? "No driver recorded"}</span>
                    <span className="tabular-nums">
                      {new Date(r.travelStartedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                    <span>{r.attribution.carrierNameSnapshot}</span>
                  </p>
                </div>
                <dl className="flex flex-wrap items-center gap-x-6 gap-y-1 text-[0.8125rem] tabular-nums">
                  <div>
                    <dt className="text-[0.6875rem] text-fg-muted">Total</dt>
                    <dd className="font-semibold text-fg">{r.totalMiles.toLocaleString()} mi</dd>
                  </div>
                  <div>
                    <dt className="text-[0.6875rem] text-fg-muted">Taxable</dt>
                    <dd className="text-fg-muted">{r.taxableMiles.toLocaleString()} mi</dd>
                  </div>
                </dl>
              </div>

              {r.flags.length > 0 ? (
                <p className="mt-2.5 flex flex-wrap gap-1.5">
                  {r.flags.map((f) => <MileageFlagChip key={f} flag={f} />)}
                </p>
              ) : null}

              {r.revision.correctionReason ? (
                <p className="mt-2 text-[0.75rem] text-fg-muted">
                  Corrected: {r.revision.correctionReason}
                </p>
              ) : null}

              {r.revision.isCurrent ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Can permission="mileage:review">
                    {r.state !== "verified" ? (
                      <Button variant="secondary" size="sm" disabled={action.isPending} onClick={() => void verify(r.id)}>
                        <Check aria-hidden />
                        Verify
                      </Button>
                    ) : null}
                  </Can>
                  <Can permission="mileage:review">
                    <Button variant="ghost" size="sm" onClick={() => setCorrectingId(r.id)}>
                      <PenLine aria-hidden />
                      Correct
                    </Button>
                  </Can>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {data ? (
        <ShowMore
          shown={shown}
          total={matching.length}
          noun="mileage records"
          onMore={() => setPage({ key: filterKey, shown: shown + PAGE_SIZE })}
        />
      ) : null}

      {recording ? <RecordMileageDialog onClose={() => setRecording(false)} /> : null}
      {correcting ? (
        <CorrectMileageDialog record={correcting} onClose={() => setCorrectingId(null)} />
      ) : null}
    </div>
  );
}
