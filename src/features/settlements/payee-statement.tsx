"use client";

import { ArrowLeft, FileText, Printer } from "lucide-react";
import Link from "next/link";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { Button } from "@/components/ui/button";
import { PAYEE_KIND_LABEL } from "@/config/statuses";
import { money, ratePerMile } from "@/lib/utils/format";
import { formatBasisPoints } from "@/lib/settlements/money";
import { cn } from "@/lib/utils";
import type { Settlement } from "@/types";
import { SettlementStatusChip } from "./settlement-chips";
import {
  ADJUSTMENT_KIND_LABEL, COMPENSATION_METHOD_LABEL, formatDate, formatDateTime,
  formatMiles,
} from "./settlement-labels";
import { useSettlement, useSettlementAction, useSettlementStatements } from "./hooks";

/**
 * The payee statement.
 *
 * This is the page a driver opens when they want to know what they were paid
 * and why — so it reads top to bottom in plain language, shows the arithmetic
 * rather than only the answer, and never uses a word the payee would have to
 * look up. It is generated from the frozen snapshot, so it says the same thing
 * every time it is opened.
 */
export function PayeeStatementScreen({ settlementId }: { settlementId: string }) {
  const query = useSettlement(settlementId);
  const statements = useSettlementStatements(settlementId);
  const action = useSettlementAction();

  if (query.isPending) return <LoadingSkeleton rows={6} />;
  if (query.isError) {
    return (
      <ErrorState
        title="Could not open this statement"
        description={query.error.message}
        onRetry={() => query.refetch()}
      />
    );
  }

  const { settlement, capabilities } = query.data;
  const issued = (statements.data ?? []).filter((s) => !s.supersededByStatementId);
  const current = issued[0];

  return (
    <div className="space-y-section">
      <div className="print:hidden">
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2">
          <Link href={`/finance/settlements/${settlement.id}`}>
            <ArrowLeft aria-hidden />
            Back to the settlement
          </Link>
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[1.375rem] leading-8 font-semibold tracking-[-0.015em] text-fg">
              Statement
            </h1>
            <p className="mt-1 text-[0.875rem] text-fg-muted">
              {current
                ? `Statement ${current.number}, produced ${formatDateTime(current.generatedAt)} from calculation revision ${current.snapshotRevision}.`
                : "No statement has been produced yet. The figures below are what one would show."}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer aria-hidden />
              Print
            </Button>
            {capabilities.canGenerateStatement ? (
              <Button
                variant="primary"
                disabled={action.isPending}
                onClick={() =>
                  action.mutate({ id: settlement.id, action: { kind: "generateStatement" } })
                }
              >
                <FileText aria-hidden />
                {current ? "Produce a new one" : "Produce statement"}
              </Button>
            ) : null}
          </div>
        </div>

        {action.isError ? (
          <p role="alert" className="mt-3 rounded-md bg-st-danger-bg/60 px-4 py-3 text-[0.8125rem] text-st-danger">
            {action.error.message}
          </p>
        ) : null}

        {issued.length > 0 && (statements.data ?? []).length > issued.length ? (
          <p className="mt-3 rounded-md bg-surface-sunken px-4 py-2.5 text-[0.8125rem] text-fg-muted">
            An earlier statement for this settlement was superseded. Statement
            numbers are never reused, so the payee can always tell which one they
            are holding.
          </p>
        ) : null}
      </div>

      <StatementDocument settlement={settlement} statementNumber={current?.number} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The document                                                                */
/* -------------------------------------------------------------------------- */

function StatementDocument({
  settlement,
  statementNumber,
}: {
  settlement: Settlement;
  statementNumber?: string;
}) {
  const t = settlement.totals;

  return (
    <article className="overflow-hidden rounded-lg border border-border bg-surface shadow-e1">
      {/* Masthead --------------------------------------------------------- */}
      <header className="border-b border-border px-5 py-5 sm:px-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase">
              Settlement statement
            </p>
            <h2 className="mt-1 text-[1.25rem] leading-7 font-semibold text-fg">
              {settlement.payee.displayNameSnapshot}
            </h2>
            <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
              {PAYEE_KIND_LABEL[settlement.payee.kind]}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[0.8125rem] font-medium text-fg">{settlement.number}</p>
            {statementNumber ? (
              <p className="text-[0.75rem] text-fg-muted">{statementNumber}</p>
            ) : null}
            <div className="mt-1.5 flex justify-end">
              <SettlementStatusChip status={settlement.status} />
            </div>
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-[0.8125rem] sm:grid-cols-4">
          <div>
            <dt className="text-fg-subtle">Pay period</dt>
            <dd className="font-medium text-fg">{settlement.period.label}</dd>
          </div>
          <div>
            <dt className="text-fg-subtle">Loads</dt>
            <dd className="font-medium tabular-nums text-fg">{t.loadCount}</dd>
          </div>
          <div>
            <dt className="text-fg-subtle">Miles</dt>
            <dd className="font-medium tabular-nums text-fg">
              {t.totalMiles > 0 ? formatMiles(t.totalMiles) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-fg-subtle">Payment due</dt>
            <dd className="font-medium text-fg">{formatDate(settlement.paymentDueAt)}</dd>
          </div>
        </dl>
      </header>

      {/* Loads ------------------------------------------------------------ */}
      {settlement.loadLines.length > 0 ? (
        <section className="border-b border-border px-5 py-5 sm:px-7">
          <h3 className="text-[0.875rem] font-semibold text-fg">Your loads</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-left">
              <thead>
                <tr className="border-b border-border">
                  <Th>Load</Th>
                  <Th>Lane</Th>
                  <Th>Delivered</Th>
                  <Th align="right">Miles</Th>
                  <Th align="right">Load paid</Th>
                  <Th align="right">You earned</Th>
                </tr>
              </thead>
              <tbody>
                {settlement.loadLines.map((line) => (
                  <tr key={line.id} className="border-b border-border last:border-0">
                    <Td>
                      <span className="font-medium text-fg">{line.load.referenceSnapshot}</span>
                    </Td>
                    <Td muted>{line.load.laneSnapshot ?? "—"}</Td>
                    <Td muted>{formatDate(line.load.deliveredAt ?? line.load.performedAt)}</Td>
                    <Td align="right" muted>
                      {line.load.loadedMiles > 0 ? line.load.loadedMiles.toLocaleString("en-US") : "—"}
                    </Td>
                    <Td align="right" muted>{money(line.grossRevenueCents)}</Td>
                    <Td align="right">
                      <span className="font-medium text-fg">{money(line.earningsCents)}</span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* How each load was priced, in words. */}
          <ul className="mt-4 space-y-2">
            {settlement.loadLines.map((line) => (
              <li key={line.id} className="text-[0.75rem] leading-relaxed text-fg-muted">
                <span className="font-medium text-fg">{line.load.referenceSnapshot}</span>{" "}
                — {COMPENSATION_METHOD_LABEL[line.agreement.method].toLowerCase()} terms
                (version {line.agreement.agreementVersion}):{" "}
                {line.components.map((c) => c.explanation).join(", ")}
                {line.accessorials
                  .filter((a) => a.payeeShareCents > 0)
                  .map(
                    (a) =>
                      `, plus ${formatBasisPoints(a.shareBasisPoints)} of ${money(
                        a.billedCents,
                      )} ${a.label.toLowerCase()}`,
                  )
                  .join("")}
                {line.accessorials.some((a) => a.includedInPercentageBasis) ? (
                  <>
                    {" "}
                    Accessorials on this load are already inside that percentage,
                    so they are not listed separately.
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Adjustments ------------------------------------------------------ */}
      {settlement.adjustments.length > 0 ? (
        <section className="border-b border-border px-5 py-5 sm:px-7">
          <h3 className="text-[0.875rem] font-semibold text-fg">
            Added to, and taken off, your pay
          </h3>
          <dl className="mt-3 space-y-2">
            {settlement.adjustments.map((adjustment) => (
              <div key={adjustment.id} className="flex items-baseline justify-between gap-4">
                <dt className="min-w-0">
                  <span className="text-[0.8125rem] text-fg">{adjustment.label}</span>
                  <span className="ml-2 text-[0.6875rem] text-fg-subtle">
                    {ADJUSTMENT_KIND_LABEL[adjustment.kind]}
                    {adjustment.installment
                      ? ` · ${adjustment.installment.number} of ${adjustment.installment.of}`
                      : ""}
                  </span>
                  {adjustment.note ? (
                    <span className="block text-[0.75rem] text-fg-subtle">{adjustment.note}</span>
                  ) : null}
                </dt>
                <dd
                  className={cn(
                    "shrink-0 text-[0.8125rem] font-medium tabular-nums",
                    adjustment.direction === "addition" ? "text-fg" : "text-st-danger",
                  )}
                >
                  {adjustment.direction === "addition" ? "+" : "−"}
                  {money(adjustment.amountCents)}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {/* The bottom line -------------------------------------------------- */}
      <section className="px-5 py-5 sm:px-7">
        <dl className="space-y-2">
          <SummaryRow label="Gross earnings" amountCents={t.grossEarningsCents} />
          {t.totalAdditionsCents > 0 ? (
            <SummaryRow label="Added" amountCents={t.totalAdditionsCents} />
          ) : null}
          {t.totalSubtractionsCents > 0 ? (
            <SummaryRow label="Withheld" amountCents={-t.totalSubtractionsCents} />
          ) : null}

          <div className="flex items-baseline justify-between gap-4 border-t border-border pt-3">
            <dt className="text-[1rem] font-semibold text-fg">Net pay</dt>
            <dd
              className={cn(
                "text-[1.5rem] leading-8 font-semibold tabular-nums",
                t.netPayCents < 0 ? "text-st-danger" : "text-fg",
              )}
            >
              {money(t.netPayCents)}
            </dd>
          </div>
        </dl>

        {t.totalMiles > 0 ? (
          <p className="mt-1 text-right text-[0.75rem] text-fg-subtle">
            {ratePerMile(t.netPerMileCents)} across {formatMiles(t.totalMiles)}
          </p>
        ) : null}

        {settlement.amountPaidCents > 0 ? (
          <p className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-sunken px-4 py-3 text-[0.8125rem]">
            <span className="text-fg-muted">
              Paid so far {money(settlement.amountPaidCents)}
            </span>
            <span className="font-medium text-fg">
              {settlement.amountOutstandingCents > 0
                ? `${money(settlement.amountOutstandingCents)} still to come`
                : "Paid in full"}
            </span>
          </p>
        ) : null}

        {settlement.disputes.some((d) => d.status === "open" || d.status === "under_review") ? (
          <p className="mt-4 rounded-md bg-st-danger-bg/50 px-4 py-3 text-[0.8125rem] text-fg-muted">
            <span className="font-medium text-fg">This settlement is being disputed.</span>{" "}
            The figures above stand until the dispute is closed. If it is decided in
            the payee&apos;s favour, a separate correction is raised — this statement
            is not rewritten.
          </p>
        ) : null}
      </section>

      {/* Provenance ------------------------------------------------------- */}
      <footer className="border-t border-border bg-surface-sunken/50 px-5 py-4 sm:px-7">
        <p className="text-[0.75rem] leading-relaxed text-fg-subtle">
          {settlement.snapshot.frozen ? (
            <>
              These figures were frozen on {formatDate(settlement.snapshot.frozenAt)} and
              cannot change. A later change to a rate or a pay agreement does not
              affect them.
            </>
          ) : (
            <>
              These figures are not final. They are frozen when the settlement is
              approved, and this statement is not official until then.
            </>
          )}{" "}
          Calculation revision {settlement.snapshot.revision}.
        </p>
        <p className="mt-1.5 text-[0.75rem] text-fg-subtle">
          Antcolos does not move money. Payments shown here were made elsewhere and
          recorded against this settlement.
        </p>
        {settlement.correctsSettlementId ? (
          <p className="mt-1.5 text-[0.75rem] text-fg-subtle">
            This is a correction to an earlier settlement, which keeps its own
            figures and its own statement.
          </p>
        ) : null}
      </footer>
    </article>
  );
}

/* -------------------------------------------------------------------------- */
/* Table bits                                                                  */
/* -------------------------------------------------------------------------- */

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      className={cn(
        "px-2 py-2 text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase first:pl-0 last:pr-0",
        align === "right" && "text-right",
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  muted,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  muted?: boolean;
}) {
  return (
    <td
      className={cn(
        "px-2 py-2.5 text-[0.8125rem] first:pl-0 last:pr-0",
        align === "right" && "text-right tabular-nums",
        muted ? "text-fg-muted" : "text-fg",
      )}
    >
      {children}
    </td>
  );
}

function SummaryRow({ label, amountCents }: { label: string; amountCents: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-[0.875rem] text-fg-muted">{label}</dt>
      <dd
        className={cn(
          "text-[0.875rem] font-medium tabular-nums",
          amountCents < 0 ? "text-st-danger" : "text-fg",
        )}
      >
        {money(amountCents)}
      </dd>
    </div>
  );
}
