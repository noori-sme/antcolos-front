"use client";

import Link from "next/link";
import { CalendarClock, ChevronRight, Lock } from "lucide-react";
import { ErrorState, EmptyState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { periodLabel } from "@/lib/fuel/periods";
import { formatGallons, formatMiles, formatMpg } from "@/lib/fuel/units";
import { READINESS_ISSUE_LABEL } from "@/lib/fuel/ifta";
import { useIftaPeriods } from "./hooks";
import { PeriodStateChip } from "./chips";
import { FilingNotice } from "./pieces";

/**
 * The quarters.
 *
 * A quarter's figures are recomputed from the current revisions of its records
 * every time this loads — nothing about a return is cached in the period row,
 * so a correction shows up here immediately and a filed quarter that has been
 * corrected says `amended` rather than quietly changing its numbers.
 */
export function IftaScreen() {
  const { data, isPending, isError, error, refetch } = useIftaPeriods();

  const denied = isError && /permission/i.test(error instanceof Error ? error.message : "");

  return (
    <div className="space-y-section">
      <PageHeader
        title="IFTA quarters"
        description="Jurisdiction miles and qualified fuel, brought together per quarter. Antcolos prepares the figures; it does not file and does not calculate tax owed."
      />

      <FilingNotice />

      {isPending ? <LoadingSkeleton rows={4} /> : null}

      {denied ? (
        <EmptyState
          icon={Lock}
          title="Tax filing information is not shared with you"
          description="Fuel and IFTA are separate powers. A dispatch organization sees operational fuel only when a carrier shares it, and tax filing only when that carrier authorizes it separately."
        />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : null}

      {data && data.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No quarters yet"
          description="A quarter appears as soon as there is fuel or mileage in it."
        />
      ) : null}

      {data && data.length > 0 ? (
        <ul className="space-y-2.5">
          {data.map((summary) => (
            <li key={summary.period.id}>
              <Link
                href={`/fuel/ifta/${summary.period.id}`}
                className="flex items-start gap-3 rounded-lg border border-border bg-surface p-4 shadow-e1 transition-colors hover:border-border-strong hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-fg-muted">
                  <CalendarClock className="size-[1.125rem]" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-[0.9375rem] font-semibold text-fg">
                      {periodLabel(summary.period.year, summary.period.quarter)}
                    </span>
                    <PeriodStateChip state={summary.period.state} />
                    {summary.period.amendments.length > 0 ? (
                      <span className="rounded-full bg-st-progress-bg px-2 py-0.5 text-[0.6875rem] font-medium text-st-progress">
                        {summary.period.amendments.length} amendment{summary.period.amendments.length === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.75rem] tabular-nums text-fg-muted">
                    <span>{summary.period.carrierNameSnapshot}</span>
                    <span>{formatMiles(summary.economy.totalMiles)}</span>
                    <span>{formatGallons(summary.economy.totalGallonsThousandths)}</span>
                    <span>{formatMpg(summary.economy.mpgHundredths)}</span>
                    <span>{summary.jurisdictions.length} jurisdiction{summary.jurisdictions.length === 1 ? "" : "s"}</span>
                    <span>Due {new Date(summary.period.dueOn).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
                  </p>
                  {summary.readiness.issues.length > 0 ? (
                    <p className="mt-2 text-[0.75rem] text-st-warning">
                      {summary.readiness.issues.map((i) => READINESS_ISSUE_LABEL[i]).join(" · ")}
                    </p>
                  ) : null}
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
