"use client";

import Link from "next/link";
import { ArrowLeft, CheckCircle2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Can } from "@/components/auth/can";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/utils/format";
import { formatGallons, formatMpg } from "@/lib/fuel/units";
import { jurisdictionName } from "@/lib/fuel/jurisdictions";
import { periodLabel } from "@/lib/fuel/periods";
import { READINESS_ISSUE_LABEL } from "@/lib/fuel/ifta";
import { useFuelAction, useIftaPeriod } from "./hooks";
import { PeriodStateChip } from "./chips";
import { Figure, FilingNotice, SectionHeading, Withheld } from "./pieces";
import { cn } from "@/lib/utils";

/**
 * One quarter, in full.
 *
 * The jurisdiction table is the return, up to the point where a rate would be
 * needed — and the row that would carry tax owed is deliberately absent rather
 * than empty, with a line saying why. An interface that shows a blank money
 * column invites somebody to assume it means zero.
 */
export function IftaPeriodDetail({ periodId }: { periodId: string }) {
  const { data, isPending, isError, refetch } = useIftaPeriod(periodId);
  const action = useFuelAction();
  const [error, setError] = useState<string | null>(null);

  if (isPending) return <LoadingSkeleton rows={6} />;
  if (isError || !data) {
    return (
      <ErrorState
        title="Quarter not available"
        description="It may belong to another organization, or tax filing information may not be shared with you."
        onRetry={() => void refetch()}
      />
    );
  }

  const { period, economy, jurisdictions, readiness } = data;

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    }
  };

  const totals = jurisdictions.reduce(
    (acc, j) => ({
      totalMiles: acc.totalMiles + j.totalMiles,
      taxableMiles: acc.taxableMiles + j.taxableMiles,
      taxPaid: acc.taxPaid + j.taxPaidGallonsThousandths,
      taxable: acc.taxable + j.taxableGallonsThousandths,
      net: acc.net + j.netTaxableGallonsThousandths,
      spend: acc.spend + (j.spendCents ?? 0),
    }),
    { totalMiles: 0, taxableMiles: 0, taxPaid: 0, taxable: 0, net: 0, spend: 0 },
  );

  return (
    <div className="space-y-section">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link href="/fuel/ifta">
            <ArrowLeft aria-hidden />
            All quarters
          </Link>
        </Button>
      </div>

      <PageHeader
        title={`${periodLabel(period.year, period.quarter)} · ${period.carrierNameSnapshot}`}
        description={`${new Date(`${period.startsOn}T12:00:00Z`).toLocaleDateString(undefined, { month: "long", day: "numeric" })} to ${new Date(`${period.endsOn}T12:00:00Z`).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })} · due ${new Date(`${period.dueOn}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {readiness.ready && period.state === "ready" ? (
              <Can permission="ifta:manage">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={action.isPending}
                  onClick={() => {
                    const reference = window.prompt(
                      "Antcolos does not file this. If you have already filed it elsewhere, enter the confirmation reference the jurisdiction gave you.",
                    );
                    if (reference !== null) {
                      void run(() =>
                        action.mutateAsync({
                          kind: "record_filing",
                          periodId: period.id,
                          input: { confirmationReference: reference || undefined },
                        }),
                      );
                    }
                  }}
                >
                  Record that it was filed
                </Button>
              </Can>
            ) : null}
            {period.state === "filed" || period.state === "amended" ? (
              <Can permission="ifta:manage">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={action.isPending}
                  onClick={() => {
                    const reason = window.prompt("What is being amended, and why?");
                    if (reason) void run(() => action.mutateAsync({ kind: "amend", periodId: period.id, reason }));
                  }}
                >
                  Open an amendment
                </Button>
              </Can>
            ) : null}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <PeriodStateChip state={period.state} />
        {period.lockedAt ? (
          <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[0.6875rem] font-medium text-fg-muted">
            Locked {new Date(period.lockedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
          </span>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-st-danger/30 bg-st-danger-bg/50 px-3.5 py-2.5 text-[0.8125rem] text-st-danger">
          {error}
        </p>
      ) : null}

      <FilingNotice />

      <section aria-labelledby="period-figures" className="space-y-3">
        <SectionHeading title="The quarter" description="Recomputed from the current revision of every record in it." />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Figure label="Fleet MPG" value={formatMpg(economy.mpgHundredths)} hint="Total miles ÷ total gallons" />
          <Figure label="Total miles" value={economy.totalMiles.toLocaleString()} hint="From mileage records" />
          <Figure label="Gallons" value={formatGallons(economy.totalGallonsThousandths, { unit: false })} hint="From fuel purchases" />
          <Figure
            label="Fuel spend"
            value={economy.totalSpendCents === undefined ? <Withheld what="fuel cost" /> : money(economy.totalSpendCents)}
            hint="Operational only. Never part of the return."
          />
        </div>
      </section>

      <section aria-labelledby="period-readiness" className="space-y-3">
        <SectionHeading title="Readiness" />
        {readiness.issues.length === 0 ? (
          <p className="flex items-start gap-2 rounded-lg border border-st-success/30 bg-st-success-bg/40 px-4 py-3 text-[0.8125rem] text-fg-muted">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-st-success" aria-hidden />
            Nothing outstanding. Every record in the quarter has been reviewed, every qualified
            purchase has a receipt, and every mile is attributed to a carrier authority.
          </p>
        ) : (
          <ul className="space-y-2">
            {readiness.issues.map((issue) => (
              <li key={issue} className="flex items-start gap-2 rounded-lg border border-st-warning/30 bg-st-warning-bg/30 px-4 py-3 text-[0.8125rem] text-fg-muted">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-st-warning" aria-hidden />
                {READINESS_ISSUE_LABEL[issue]}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="period-jurisdictions" className="space-y-3">
        <SectionHeading
          title="Jurisdictions"
          description="Miles from the mileage records, tax-paid gallons from qualified purchases. Two separate record sets, joined here for the first time."
        />
        <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-e1">
          <table className="w-full min-w-[44rem] text-[0.8125rem]">
            <caption className="sr-only">Per-jurisdiction figures for the quarter</caption>
            <thead className="border-b border-border text-left text-[0.75rem] text-fg-muted">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">Jurisdiction</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Total miles</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Taxable miles</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Taxable gallons</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Tax-paid gallons</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Net gallons</th>
              </tr>
            </thead>
            <tbody>
              {jurisdictions.map((j) => (
                <tr key={j.jurisdiction} className="border-b border-border last:border-0">
                  <th scope="row" className="px-4 py-2.5 text-left font-medium text-fg">
                    {j.jurisdiction}
                    <span className="ml-2 font-normal text-fg-subtle">{jurisdictionName(j.jurisdiction)}</span>
                  </th>
                  <td className="px-4 py-2.5 text-right tabular-nums text-fg-muted">{j.totalMiles.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-fg-muted">{j.taxableMiles.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-fg-muted">{formatGallons(j.taxableGallonsThousandths, { unit: false })}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-fg-muted">{formatGallons(j.taxPaidGallonsThousandths, { unit: false })}</td>
                  <td className={cn(
                    "px-4 py-2.5 text-right font-medium tabular-nums",
                    j.netTaxableGallonsThousandths > 0 ? "text-fg" : "text-st-success",
                  )}>
                    {formatGallons(j.netTaxableGallonsThousandths, { unit: false })}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-border-strong">
              <tr className="text-[0.8125rem] font-semibold text-fg">
                <th scope="row" className="px-4 py-2.5 text-left">Total</th>
                <td className="px-4 py-2.5 text-right tabular-nums">{totals.totalMiles.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{totals.taxableMiles.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatGallons(totals.taxable, { unit: false })}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatGallons(totals.taxPaid, { unit: false })}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatGallons(totals.net, { unit: false })}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="text-[0.75rem] leading-relaxed text-fg-subtle">
          There is no tax column, and that is deliberate. Turning net gallons into money needs each
          jurisdiction&apos;s rate for this quarter, and no rate source is connected — so the
          calculation stops here rather than showing a number nobody can stand behind.
          {" "}Positive net gallons mean more was burned in a jurisdiction than was bought there;
          negative means the opposite.
        </p>
      </section>

      {period.filing ? (
        <section aria-labelledby="period-filing" className="space-y-3">
          <SectionHeading title="Filing" />
          <div className="rounded-lg border border-border bg-surface p-4 shadow-e1">
            <p className="text-[0.875rem] text-fg">
              Recorded as filed on{" "}
              {new Date(period.filing.filedAt).toLocaleDateString(undefined, { dateStyle: "medium" })} by{" "}
              {period.filing.filedBy.displayNameSnapshot}
              {period.filing.confirmationReference ? `, reference ${period.filing.confirmationReference}` : ""}.
            </p>
            {period.filing.note ? (
              <p className="mt-1 text-[0.8125rem] text-fg-muted">{period.filing.note}</p>
            ) : null}
            <p className="mt-2 text-[0.75rem] text-fg-subtle">
              This is a note about something a person did somewhere else. Antcolos did not submit
              a return and did not pay anything.
            </p>
          </div>
        </section>
      ) : null}

      {period.amendments.length > 0 ? (
        <section aria-labelledby="period-amendments" className="space-y-3">
          <SectionHeading
            title="Amendments"
            description="Corrections made after the quarter was filed. The difference between what was submitted and what the records now say."
          />
          <ol className="space-y-2">
            {period.amendments.map((a) => (
              <li key={a.id} className="rounded-lg border border-border bg-surface px-4 py-3 shadow-e1">
                <p className="text-[0.8125rem] text-fg">{a.reason}</p>
                <p className="mt-1 text-[0.75rem] text-fg-subtle">
                  {a.by.displayNameSnapshot} ·{" "}
                  {new Date(a.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                  {a.transactionIds.length > 0 ? ` · ${a.transactionIds.length} fuel record` : ""}
                  {a.mileageRecordIds.length > 0 ? ` · ${a.mileageRecordIds.length} mileage record` : ""}
                </p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
