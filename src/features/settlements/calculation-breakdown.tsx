"use client";

import { Info, Lock, Package } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { money, ratePerMile } from "@/lib/utils/format";
import { formatBasisPoints } from "@/lib/settlements/money";
import { cn } from "@/lib/utils";
import type {
  CalculationStep,
  Settlement,
  SettlementCalculationSnapshot,
  SettlementLoadLine,
} from "@/types";
import { COMPENSATION_METHOD_LABEL, formatDateTime, formatMiles } from "./settlement-labels";

/**
 * How the net pay was reached, load by load and line by line.
 *
 * This screen exists to answer one question — "why was I paid this?" — without
 * anyone having to re-derive the arithmetic. Everything below is read from the
 * frozen snapshot, never recomputed, so it says the same thing today as it will
 * in three years.
 */

export function CalculationBreakdown({
  settlement,
  snapshot,
  resolvableLoadIds,
}: {
  settlement: Settlement;
  snapshot: SettlementCalculationSnapshot;
  resolvableLoadIds: string[];
}) {
  return (
    <div className="space-y-5">
      <SnapshotNotice snapshot={snapshot} />

      {settlement.loadLines.length > 0 ? (
        <section aria-labelledby="load-earnings" className="space-y-3">
          <h3 id="load-earnings" className="text-[0.875rem] font-semibold text-fg">
            What the loads earned
          </h3>
          <ul className="space-y-3">
            {settlement.loadLines.map((line) => (
              <li key={line.id}>
                <LoadLineCard
                  line={line}
                  linkable={resolvableLoadIds.includes(line.load.loadId)}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="rounded-lg border border-dashed border-border bg-surface px-4 py-6 text-center text-[0.8125rem] text-fg-muted">
          This settlement carries no loads. It only adjusts figures that were
          worked out elsewhere.
        </p>
      )}

      <StepLedger steps={snapshot.steps} />
      <TotalsPanel settlement={settlement} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Snapshot provenance                                                         */
/* -------------------------------------------------------------------------- */

function SnapshotNotice({ snapshot }: { snapshot: SettlementCalculationSnapshot }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-4 py-3 text-[0.8125rem] leading-relaxed",
        snapshot.frozen
          ? "border-st-info/35 bg-st-info-bg/40 text-fg-muted"
          : "border-border bg-surface-sunken/60 text-fg-muted",
      )}
    >
      {snapshot.frozen ? (
        <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-st-info" />
      ) : (
        <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
      )}
      <p>
        {snapshot.frozen ? (
          <>
            <span className="font-medium text-fg">These figures are frozen.</span>{" "}
            Worked out on {formatDateTime(snapshot.computedAt)} and locked on{" "}
            {formatDateTime(snapshot.frozenAt)}. A later change to a rate, a
            contract or a profile cannot alter them — a correction would be a new
            settlement, linked to this one.
          </>
        ) : (
          <>
            <span className="font-medium text-fg">Still being worked out.</span>{" "}
            Last calculated {formatDateTime(snapshot.computedAt)}. These figures
            can still change; they are frozen the moment the settlement is
            approved.
          </>
        )}{" "}
        <span className="text-fg-subtle">
          Revision {snapshot.revision} · {snapshot.engineVersion}
        </span>
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* One load                                                                    */
/* -------------------------------------------------------------------------- */

function LoadLineCard({ line, linkable }: { line: SettlementLoadLine; linkable: boolean }) {
  const { agreement } = line;

  return (
    <article className="rounded-lg border border-border bg-surface shadow-e1">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            {linkable ? (
              <Link
                href={`/loads/${line.load.loadId}`}
                className="text-[0.875rem] font-semibold text-primary underline-offset-4 hover:underline"
              >
                {line.load.referenceSnapshot}
              </Link>
            ) : (
              <span className="text-[0.875rem] font-semibold text-fg">
                {line.load.referenceSnapshot}
              </span>
            )}
            {line.invoice ? (
              <Badge tone="outline">Invoice {line.invoice.numberSnapshot}</Badge>
            ) : null}
          </p>
          <p className="mt-0.5 text-[0.75rem] text-fg-muted">
            {line.load.laneSnapshot ? `${line.load.laneSnapshot} · ` : null}
            {formatMiles(line.load.loadedMiles)} loaded
            {line.load.deadheadMiles > 0
              ? ` · ${formatMiles(line.load.deadheadMiles)} deadhead`
              : null}
          </p>
        </div>
        <p className="text-right">
          <span className="block text-[0.6875rem] text-fg-subtle">Earned</span>
          <span className="text-[1rem] font-semibold tabular-nums text-fg">
            {money(line.earningsCents)}
          </span>
        </p>
      </header>

      <div className="space-y-3 px-4 py-3">
        {/* The agreement that was applied, and why it was that one. */}
        <p className="text-[0.75rem] text-fg-muted">
          Paid under{" "}
          <span className="font-medium text-fg">
            {COMPENSATION_METHOD_LABEL[agreement.method].toLowerCase()}
          </span>{" "}
          terms, version {agreement.agreementVersion} — the agreement in force
          when this load ran.
        </p>

        <dl className="space-y-1.5">
          <Row label="Gross load revenue" amountCents={line.grossRevenueCents} muted />
          <Row label="Linehaul" amountCents={line.linehaulCents} muted />

          {line.components.map((component) => (
            <Row
              key={component.componentId}
              label={component.label}
              detail={component.explanation}
              amountCents={component.amountCents}
            />
          ))}

          {line.accessorials.map((accessorial) => (
            <Row
              key={accessorial.code}
              label={accessorial.label}
              detail={
                !accessorial.approved
                  ? `${money(accessorial.billedCents)} billed — not approved, so not paid`
                  : accessorial.includedInPercentageBasis
                    ? `${money(accessorial.billedCents)} billed — already inside the percentage above`
                    : `${formatBasisPoints(accessorial.shareBasisPoints)} of ${money(
                        accessorial.billedCents,
                      )} billed`
              }
              amountCents={accessorial.payeeShareCents}
              muted={accessorial.payeeShareCents === 0}
            />
          ))}
        </dl>

        {line.missingData.length > 0 ? (
          <ul className="space-y-1.5 rounded-md bg-st-warning-bg/50 px-3 py-2.5">
            {line.missingData.map((gap, i) => (
              <li key={i} className="flex items-start gap-2 text-[0.75rem] text-fg-muted">
                <span
                  aria-hidden
                  className={cn(
                    "mt-1.5 size-1.5 shrink-0 rounded-full",
                    gap.blocksApproval ? "bg-st-danger" : "bg-st-warning",
                  )}
                />
                <span>
                  {gap.summary}
                  {gap.blocksApproval ? (
                    <span className="ml-1 font-medium text-st-danger">
                      Blocks approval.
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  );
}

function Row({
  label,
  detail,
  amountCents,
  muted,
}: {
  label: string;
  detail?: string;
  amountCents: number;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="min-w-0">
        <span className={cn("text-[0.8125rem]", muted ? "text-fg-muted" : "text-fg")}>
          {label}
        </span>
        {detail ? (
          <span className="block text-[0.75rem] text-fg-subtle">{detail}</span>
        ) : null}
      </dt>
      <dd
        className={cn(
          "shrink-0 text-[0.8125rem] tabular-nums",
          muted ? "text-fg-subtle" : "font-medium text-fg",
        )}
      >
        {money(amountCents)}
      </dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The working                                                                 */
/* -------------------------------------------------------------------------- */

const GROUP_LABEL: Record<CalculationStep["group"], string> = {
  earnings: "Earnings",
  accessorial: "Accessorial",
  addition: "Added",
  subtraction: "Withheld",
  total: "Total",
};

/** Every step of the arithmetic, in the order the engine performed it. */
function StepLedger({ steps }: { steps: CalculationStep[] }) {
  return (
    <section aria-labelledby="working" className="space-y-3">
      <h3 id="working" className="text-[0.875rem] font-semibold text-fg">
        Step by step
      </h3>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-e1">
        <table className="w-full min-w-[34rem] border-collapse text-left">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="px-4 py-2.5 text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase">
                Step
              </th>
              <th scope="col" className="px-4 py-2.5 text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase">
                Working
              </th>
              <th scope="col" className="px-4 py-2.5 text-right text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {steps.map((step) => {
              const isTotal = step.group === "total";
              return (
                <tr
                  key={step.order}
                  className={cn(
                    "border-b border-border last:border-0",
                    isTotal && "bg-surface-sunken/60",
                  )}
                >
                  <td className="px-4 py-2.5 align-top">
                    <span
                      className={cn(
                        "block text-[0.8125rem]",
                        isTotal ? "font-semibold text-fg" : "text-fg",
                      )}
                    >
                      {step.label}
                    </span>
                    <span className="mt-0.5 block text-[0.6875rem] tracking-wider text-fg-subtle uppercase">
                      {GROUP_LABEL[step.group]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 align-top text-[0.75rem] text-fg-muted">
                    {step.detail}
                  </td>
                  <td
                    className={cn(
                      "px-4 py-2.5 text-right align-top text-[0.8125rem] tabular-nums",
                      isTotal ? "font-semibold text-fg" : "text-fg",
                      step.amountCents < 0 && "text-st-danger",
                    )}
                  >
                    {money(step.amountCents)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Totals                                                                      */
/* -------------------------------------------------------------------------- */

function TotalsPanel({ settlement }: { settlement: Settlement }) {
  const t = settlement.totals;

  // Only the kinds that actually moved. A statement listing six zeroes tells
  // the payee nothing and buries the two lines that matter.
  const kinds: { label: string; amountCents: number }[] = [
    { label: "Commission", amountCents: t.commissionCents },
    { label: "Reimbursements", amountCents: t.reimbursementsCents },
    { label: "Fuel advances", amountCents: t.fuelAdvancesCents },
    { label: "Lumper", amountCents: t.lumperCents },
    { label: "Other expenses", amountCents: t.otherExpensesCents },
    { label: "Deductions", amountCents: t.deductionsCents },
    { label: "Corrections", amountCents: t.adjustmentsCents },
  ].filter((k) => k.amountCents !== 0);

  return (
    <section aria-labelledby="totals" className="space-y-3">
      <h3 id="totals" className="text-[0.875rem] font-semibold text-fg">
        Totals
      </h3>
      <dl className="space-y-1.5 rounded-lg border border-border bg-surface px-4 py-3.5 shadow-e1">
        <Row label="Gross load revenue" amountCents={t.grossLoadRevenueCents} muted />
        <Row label="Linehaul earnings" amountCents={t.linehaulEarningsCents} />
        {t.accessorialEarningsCents !== 0 ? (
          <Row label="Accessorial earnings" amountCents={t.accessorialEarningsCents} />
        ) : null}

        <div className="flex items-baseline justify-between gap-4 border-t border-border pt-2">
          <dt className="text-[0.8125rem] font-medium text-fg">Gross earnings</dt>
          <dd className="text-[0.875rem] font-semibold tabular-nums text-fg">
            {money(t.grossEarningsCents)}
          </dd>
        </div>

        {kinds.map((kind) => (
          <Row key={kind.label} label={kind.label} amountCents={kind.amountCents} />
        ))}

        <div className="flex items-baseline justify-between gap-4 border-t border-border pt-2.5">
          <dt className="text-[0.9375rem] font-semibold text-fg">Net pay</dt>
          <dd
            className={cn(
              "text-[1.25rem] leading-7 font-semibold tabular-nums",
              t.netPayCents < 0 ? "text-st-danger" : "text-fg",
            )}
          >
            {money(t.netPayCents)}
          </dd>
        </div>

        {t.netPayCents < 0 ? (
          <p className="text-[0.75rem] text-st-danger">
            The deductions on this period come to more than it earned. Nothing is
            paid out, and the balance carries.
          </p>
        ) : null}

        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-[0.75rem] text-fg-subtle">
          <span className="inline-flex items-center gap-1.5">
            <Package aria-hidden className="size-3.5" />
            {t.loadCount} {t.loadCount === 1 ? "load" : "loads"}
          </span>
          {t.totalMiles > 0 ? (
            <>
              <span>{formatMiles(t.totalMiles)}</span>
              <span>{ratePerMile(t.netPerMileCents)} net</span>
            </>
          ) : null}
        </p>
      </dl>
    </section>
  );
}
