"use client";

import Link from "next/link";
import { ArrowRight, Fuel, Gauge, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Can } from "@/components/auth/can";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/utils/format";
import {
  formatCostPerMile, formatGallons, formatMiles, formatPricePerGallon,
} from "@/lib/fuel/units";
import { jurisdictionName } from "@/lib/fuel/jurisdictions";
import { periodLabel } from "@/lib/fuel/periods";
import { READINESS_ISSUE_LABEL } from "@/lib/fuel/ifta";
import type { FuelDashboardWindow } from "@/lib/api/contracts/fuel";
import { useFuelDashboard } from "./hooks";
import { Figure, FilingNotice, SectionHeading, Withheld } from "./pieces";
import { FuelStateChip, PeriodStateChip, QualifiesChip } from "./chips";
import { IntegrationsPanel } from "./integrations-panel";
import { RecordPurchaseDialog } from "./record-purchase-dialog";
import { cn } from "@/lib/utils";

const WINDOWS: { key: FuelDashboardWindow["kind"]; label: string }[] = [
  { key: "current_quarter", label: "This quarter" },
  { key: "last_90_days", label: "Last 90 days" },
];

/**
 * The organization-scoped Fuel & IFTA dashboard.
 *
 * Everything on it is derived by the service from the current revisions of
 * this organization's own records — the screen does no arithmetic of its own,
 * which is why the numbers here and on the IFTA quarter cannot drift apart.
 */
export function FuelDashboardScreen() {
  const [windowKind, setWindowKind] = useState<FuelDashboardWindow["kind"]>("current_quarter");
  const { data, isPending, isError, refetch } = useFuelDashboard({ kind: windowKind });
  const [recording, setRecording] = useState(false);

  return (
    <div className="space-y-section">
      <PageHeader
        title="Fuel & IFTA"
        description="Fuel purchases, jurisdiction mileage and the quarterly return — kept as separate records, because a return needs both."
        actions={
          <Can permission="fuel:record">
            <Button variant="primary" onClick={() => setRecording(true)}>
              <Fuel aria-hidden />
              Record a purchase
            </Button>
          </Can>
        }
      />

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Reporting window">
        {WINDOWS.map((w) => (
          <button
            key={w.key}
            type="button"
            aria-pressed={windowKind === w.key}
            onClick={() => setWindowKind(w.key)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-[0.75rem] font-medium transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              windowKind === w.key
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg",
            )}
          >
            {w.label}
          </button>
        ))}
      </div>

      {isPending ? <LoadingSkeleton rows={6} /> : null}
      {isError ? <ErrorState onRetry={() => void refetch()} /> : null}

      {data ? (
        <>
          <section aria-labelledby="fuel-economy" className="space-y-3">
            <SectionHeading
              title="Fuel economy"
              description={`${data.window.label} · miles from mileage records, gallons from fuel purchases. Neither is derived from the other.`}
            />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Figure
                label="Fleet MPG"
                value={data.economy.mpgHundredths ? (data.economy.mpgHundredths / 100).toFixed(2) : "—"}
                hint={
                  data.economy.mpgHundredths
                    ? `${formatMiles(data.economy.totalMiles)} on ${formatGallons(data.economy.totalGallonsThousandths)}`
                    : "No miles or no gallons recorded yet"
                }
              />
              <Figure
                label="Miles"
                value={data.economy.totalMiles.toLocaleString()}
                hint="From jurisdiction mileage records"
              />
              <Figure
                label="Gallons"
                value={formatGallons(data.economy.totalGallonsThousandths, { unit: false })}
                hint="Propulsion fuel only — DEF is spend, not gallons"
              />
              <Figure
                label="Cost per mile"
                value={
                  data.economy.costPerMileMills === undefined
                    ? <Withheld what="fuel cost" />
                    : formatCostPerMile(data.economy.costPerMileMills)
                }
                hint={
                  data.economy.totalSpendCents === undefined
                    ? "Requires permission to see fuel cost"
                    : `${money(data.economy.totalSpendCents)} spent · ${formatPricePerGallon(data.economy.averagePricePerGallonMills ?? 0)}/gal average`
                }
              />
            </div>
          </section>

          <section aria-labelledby="fuel-attention" className="space-y-3">
            <SectionHeading
              title="Needs attention"
              description="The same counts the Needs You queue works from — one derivation, not two."
            />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Figure
                label="Awaiting review"
                value={data.counts.awaitingReview}
                tone={data.counts.awaitingReview > 0 ? "warning" : "default"}
                hint={`${data.counts.transactionsTotal} purchases in the ledger`}
              />
              <Figure
                label="Missing receipts"
                value={data.counts.missingReceipts}
                tone={data.counts.missingReceipts > 0 ? "warning" : "default"}
                hint="A qualified purchase needs one"
              />
              <Figure
                label="Possible duplicates"
                value={data.counts.duplicates}
                tone={data.counts.duplicates > 0 ? "danger" : "default"}
                hint="Counted twice, they overstate gallons"
              />
              <Figure
                label="Mileage to review"
                value={data.counts.mileageAwaitingReview}
                tone={data.counts.mileageAwaitingReview > 0 ? "warning" : "default"}
                hint={`${data.counts.mileageRecords} mileage records`}
              />
            </div>
          </section>

          {data.currentPeriod ? (
            <section aria-labelledby="fuel-period" className="space-y-3">
              <SectionHeading
                title="This quarter"
                actions={
                  <Button variant="secondary" size="sm" asChild>
                    <Link href={`/fuel/ifta/${data.currentPeriod.period.id}`}>
                      Open the quarter
                      <ArrowRight aria-hidden />
                    </Link>
                  </Button>
                }
              />
              <div className="rounded-lg border border-border bg-surface p-4 shadow-e1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="text-[0.9375rem] font-semibold text-fg">
                    {periodLabel(data.currentPeriod.period.year, data.currentPeriod.period.quarter)}
                  </span>
                  <PeriodStateChip state={data.currentPeriod.period.state} />
                  <span className="text-[0.75rem] text-fg-subtle">
                    Due {new Date(data.currentPeriod.period.dueOn).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                </p>
                {data.currentPeriod.readiness.issues.length > 0 ? (
                  <ul className="mt-3 space-y-1.5">
                    {data.currentPeriod.readiness.issues.map((issue) => (
                      <li key={issue} className="flex items-start gap-2 text-[0.8125rem] text-fg-muted">
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-st-warning" aria-hidden />
                        {READINESS_ISSUE_LABEL[issue]}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-[0.8125rem] text-fg-muted">
                    Nothing outstanding. Antcolos still does not file it — you do.
                  </p>
                )}
                <FilingNotice className="mt-3" />
              </div>
            </section>
          ) : null}

          <section aria-labelledby="fuel-by-truck" className="space-y-3">
            <SectionHeading
              title="By truck"
              description="Ranked by economy. A truck with miles and no fuel, or fuel and no miles, shows what it has."
            />
            {data.byTruck.length === 0 ? (
              <EmptyState icon={Gauge} title="Nothing recorded in this window" />
            ) : (
              <ul className="space-y-2">
                {data.byTruck.map((truck) => (
                  <li
                    key={truck.truckId}
                    className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-lg border border-border bg-surface px-4 py-3 shadow-e1"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/fleet/trucks/${truck.truckId}`}
                        className="text-[0.875rem] font-semibold text-fg hover:text-primary"
                      >
                        Unit {truck.unit}
                      </Link>
                      <p className="mt-0.5 text-[0.75rem] text-fg-muted">
                        {truck.currentDriverName ?? "No driver recorded"}
                      </p>
                    </div>
                    <dl className="flex flex-wrap items-center gap-x-6 gap-y-1 text-[0.8125rem] tabular-nums text-fg-muted">
                      <div><dt className="sr-only">MPG</dt><dd className="font-semibold text-fg">{truck.mpgHundredths ? (truck.mpgHundredths / 100).toFixed(2) : "—"} MPG</dd></div>
                      <div><dt className="sr-only">Miles</dt><dd>{formatMiles(truck.totalMiles)}</dd></div>
                      <div><dt className="sr-only">Gallons</dt><dd>{formatGallons(truck.totalGallonsThousandths)}</dd></div>
                      <div>
                        <dt className="sr-only">Cost per mile</dt>
                        <dd>{truck.costPerMileMills === undefined ? "—" : formatCostPerMile(truck.costPerMileMills)}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="fuel-by-jurisdiction" className="space-y-3">
            <SectionHeading
              title="By jurisdiction"
              description="Miles run in each jurisdiction, and the tax-paid gallons bought there. The two are joined here and nowhere earlier."
            />
            {data.byJurisdiction.length === 0 ? (
              <EmptyState icon={Fuel} title="No jurisdiction activity in this window" />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-e1">
                <table className="w-full min-w-[36rem] text-[0.8125rem]">
                  <caption className="sr-only">Miles and fuel by jurisdiction</caption>
                  <thead className="border-b border-border text-left text-[0.75rem] text-fg-muted">
                    <tr>
                      <th scope="col" className="px-4 py-2.5 font-medium">Jurisdiction</th>
                      <th scope="col" className="px-4 py-2.5 text-right font-medium">Total miles</th>
                      <th scope="col" className="px-4 py-2.5 text-right font-medium">Taxable miles</th>
                      <th scope="col" className="px-4 py-2.5 text-right font-medium">Tax-paid gallons</th>
                      <th scope="col" className="px-4 py-2.5 text-right font-medium">Net gallons</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byJurisdiction.map((line) => (
                      <tr key={line.jurisdiction} className="border-b border-border last:border-0">
                        <th scope="row" className="px-4 py-2.5 text-left font-medium text-fg">
                          {line.jurisdiction}
                          <span className="ml-2 font-normal text-fg-subtle">{jurisdictionName(line.jurisdiction)}</span>
                        </th>
                        <td className="px-4 py-2.5 text-right tabular-nums text-fg-muted">{line.totalMiles.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-fg-muted">{line.taxableMiles.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-fg-muted">{formatGallons(line.taxPaidGallonsThousandths, { unit: false })}</td>
                        <td className={cn(
                          "px-4 py-2.5 text-right tabular-nums font-medium",
                          line.netTaxableGallonsThousandths > 0 ? "text-fg" : "text-st-success",
                        )}>
                          {formatGallons(line.netTaxableGallonsThousandths, { unit: false })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <FilingNotice />
          </section>

          <section aria-labelledby="fuel-recent" className="space-y-3">
            <SectionHeading
              title="Recent purchases"
              actions={
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/fuel/transactions">
                    All purchases
                    <ArrowRight aria-hidden />
                  </Link>
                </Button>
              }
            />
            {data.recentTransactions.length === 0 ? (
              <EmptyState
                icon={Fuel}
                title="No fuel purchases yet"
                description="Record one by hand, or connect a fuel card when there is one to connect."
              />
            ) : (
              <ul className="space-y-2">
                {data.recentTransactions.map((t) => (
                  <li key={t.id}>
                    <Link
                      href={`/fuel/transactions/${t.id}`}
                      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-lg border border-border bg-surface px-4 py-3 shadow-e1 transition-colors hover:border-border-strong hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2">
                          <span className="text-[0.875rem] font-semibold text-fg">
                            {t.location.merchantName ?? "Fuel purchase"}
                          </span>
                          <FuelStateChip state={t.state} />
                          <QualifiesChip qualifies={t.qualifiesForIfta} />
                        </p>
                        <p className="mt-0.5 text-[0.75rem] text-fg-muted">
                          Unit {t.truckUnitSnapshot ?? "—"} · {t.location.address.city}, {t.location.jurisdiction} ·{" "}
                          {new Date(t.purchasedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </p>
                      </div>
                      <p className="text-[0.8125rem] tabular-nums text-fg-muted">
                        {formatGallons(t.gallonsThousandths)}
                        {t.cost ? ` · ${money(t.cost.totalCostCents)}` : ""}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="fuel-integrations" className="space-y-3">
            <SectionHeading
              title="Integrations"
              description="Every one of these is an extension point with nothing behind it yet."
            />
            <IntegrationsPanel />
          </section>
        </>
      ) : null}

      {recording ? <RecordPurchaseDialog onClose={() => setRecording(false)} /> : null}
    </div>
  );
}
