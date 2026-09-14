"use client";

import Link from "next/link";
import { ArrowLeft, Check, Copy, FileText, PenLine, X } from "lucide-react";
import { useState } from "react";
import { Can } from "@/components/auth/can";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/utils/format";
import { formatGallons, formatPricePerGallon } from "@/lib/fuel/units";
import { jurisdictionName } from "@/lib/fuel/jurisdictions";
import { FUEL_FLAG_DESCRIPTION, FUEL_STATE_DESCRIPTION, FUEL_TYPE_LABEL } from "@/lib/fuel/labels";
import { periodLabel, quarterOf, yearOf } from "@/lib/fuel/periods";
import { useFuelAction, useFuelTransaction } from "./hooks";
import { FlagChip, FuelStateChip, QualifiesChip, SourceChip } from "./chips";
import { CorrectionDialog } from "./correction-dialog";
import { Withheld } from "./pieces";
import { cn } from "@/lib/utils";

const BASIS_SENTENCE: Record<string, string> = {
  operating_lease:
    "Established from the operating-authority lease that was live at the time, and frozen when the record was written.",
  carrier_relationship:
    "Established from the only approved carrier relationship covering that moment, and frozen when the record was written.",
  manual_declaration:
    "Stated by a person, because nothing in the operating-authority history covered that moment. Recorded as a declaration rather than as something the system knew.",
  unresolved:
    "Nothing in the operating-authority history covers that moment, so responsibility could not be established. The purchase is kept and flagged rather than attributed to whoever holds the truck today.",
};

/**
 * One purchase, everything about it, and everything that has happened to it.
 *
 * The correction chain is shown in full and in order. That is not a nicety:
 * a return built on a corrected record has to be explainable, and "here is
 * what it said, here is what it says, here is who changed it and why" is the
 * whole explanation.
 */
export function FuelTransactionDetail({ transactionId }: { transactionId: string }) {
  const { data, isPending, isError, refetch } = useFuelTransaction(transactionId);
  const action = useFuelAction();
  const [correcting, setCorrecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isPending) return <LoadingSkeleton rows={6} />;
  if (isError || !data) {
    return (
      <ErrorState
        title="Purchase not found"
        description="It may have been recorded by another organization, or the truck it belongs to is no longer yours."
        onRetry={() => void refetch()}
      />
    );
  }

  const { transaction: t, revisions, audit, receipt, duplicateOf } = data;
  const quarter = periodLabel(yearOf(t.purchasedAt), quarterOf(t.purchasedAt));

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    }
  };

  return (
    <div className="space-y-section">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link href="/fuel/transactions">
            <ArrowLeft aria-hidden />
            All purchases
          </Link>
        </Button>
      </div>

      <PageHeader
        title={t.location.merchantName ?? "Fuel purchase"}
        description={`${t.location.address.city}, ${jurisdictionName(t.location.jurisdiction)} · ${new Date(t.purchasedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {t.revision.isCurrent && t.state !== "verified" ? (
              <Can permission="fuel:review">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={action.isPending}
                  onClick={() => run(() => action.mutateAsync({ kind: "verify", id: t.id }))}
                >
                  <Check aria-hidden />
                  Verify
                </Button>
              </Can>
            ) : null}
            {t.revision.isCurrent ? (
              <Can permission="fuel:correct">
                <Button variant="secondary" size="sm" onClick={() => setCorrecting(true)}>
                  <PenLine aria-hidden />
                  Correct
                </Button>
              </Can>
            ) : null}
            {t.revision.isCurrent && duplicateOf && t.state !== "duplicate" ? (
              <Can permission="fuel:review">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={action.isPending}
                  onClick={() =>
                    run(() => action.mutateAsync({ kind: "duplicate", id: t.id, duplicateOfId: duplicateOf.id }))
                  }
                >
                  <Copy aria-hidden />
                  Confirm duplicate
                </Button>
              </Can>
            ) : null}
            {t.revision.isCurrent && t.state !== "rejected" ? (
              <Can permission="fuel:review">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={action.isPending}
                  onClick={() => {
                    const reason = window.prompt("Why is this not a real purchase for this carrier?");
                    if (reason) void run(() => action.mutateAsync({ kind: "reject", id: t.id, reason }));
                  }}
                >
                  <X aria-hidden />
                  Reject
                </Button>
              </Can>
            ) : null}
          </div>
        }
      />

      {error ? (
        <p role="alert" className="rounded-md border border-st-danger/30 bg-st-danger-bg/50 px-3.5 py-2.5 text-[0.8125rem] text-st-danger">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <FuelStateChip state={t.state} />
        <QualifiesChip qualifies={t.qualifiesForIfta} />
        <SourceChip source={t.source} />
        <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[0.6875rem] font-medium text-fg-muted">
          Revision {t.revision.number}
          {t.revision.isCurrent ? " · current" : " · superseded"}
        </span>
        <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[0.6875rem] font-medium text-fg-muted">
          {quarter}
        </span>
      </div>

      <p className="text-[0.8125rem] text-fg-muted">{FUEL_STATE_DESCRIPTION[t.state]}</p>

      {!t.qualifiesForIfta && t.qualificationNote ? (
        <p className="rounded-md border border-border bg-surface-sunken px-3.5 py-2.5 text-[0.8125rem] text-fg-muted">
          {t.qualificationNote}
        </p>
      ) : null}

      <section aria-labelledby="fuel-detail-figures" className="space-y-3">
        <h2 id="fuel-detail-figures" className="text-[1rem] font-semibold text-fg">What was recorded</h2>
        <dl className="grid gap-x-8 gap-y-3 rounded-lg border border-border bg-surface p-4 shadow-e1 sm:grid-cols-3">
          <Row label="Truck" value={t.truckUnitSnapshot ? `Unit ${t.truckUnitSnapshot}` : "—"} href={`/fleet/trucks/${t.truckId}`} />
          <Row label="Driver" value={t.driverNameSnapshot ?? "Not recorded"} />
          <Row label="Load" value={t.loadReferenceSnapshot ?? "Not on a load"} href={t.loadId ? `/loads/${t.loadId}` : undefined} />
          <Row label="Fuel" value={FUEL_TYPE_LABEL[t.fuelType]} />
          <Row label="Gallons" value={formatGallons(t.gallonsThousandths)} />
          <Row label="Odometer" value={t.odometerMiles ? `${t.odometerMiles.toLocaleString()} mi` : "Not recorded"} />
          <Row label="Price / gal" value={t.cost ? formatPricePerGallon(t.cost.pricePerGallonMills) : <Withheld what="fuel cost" />} />
          <Row label="Total" value={t.cost ? money(t.cost.totalCostCents) : <Withheld what="fuel cost" />} />
          <Row label="Jurisdiction" value={`${t.location.jurisdiction} — ${jurisdictionName(t.location.jurisdiction)}`} />
        </dl>
        {t.notes ? <p className="text-[0.8125rem] text-fg-muted">{t.notes}</p> : null}
      </section>

      <section aria-labelledby="fuel-detail-attribution" className="space-y-3">
        <h2 id="fuel-detail-attribution" className="text-[1rem] font-semibold text-fg">Who it belongs to</h2>
        <div
          className={cn(
            "rounded-lg border p-4 shadow-e1",
            t.attribution.basis === "unresolved"
              ? "border-st-warning/35 bg-st-warning-bg/40"
              : "border-border bg-surface",
          )}
        >
          <p className="text-[0.875rem] font-medium text-fg">{t.attribution.carrierNameSnapshot}</p>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">
            {BASIS_SENTENCE[t.attribution.basis]}
          </p>
          {t.attribution.basis !== "unresolved" ? (
            <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-fg-muted">
              Later ownership, lease, driver or carrier changes do not alter it — a filed quarter
              has to read the same next year as it did the day it was filed.
            </p>
          ) : null}
        </div>
      </section>

      {t.flags.length > 0 ? (
        <section aria-labelledby="fuel-detail-flags" className="space-y-3">
          <h2 id="fuel-detail-flags" className="text-[1rem] font-semibold text-fg">Flagged for a person</h2>
          <ul className="space-y-2">
            {t.flags.map((flag) => (
              <li key={flag} className="rounded-lg border border-st-warning/30 bg-st-warning-bg/30 px-4 py-3">
                <FlagChip flag={flag} />
                <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-fg-muted">
                  {FUEL_FLAG_DESCRIPTION[flag]}
                </p>
              </li>
            ))}
          </ul>
          {duplicateOf ? (
            <p className="text-[0.8125rem] text-fg-muted">
              Looks like{" "}
              <Link href={`/fuel/transactions/${duplicateOf.id}`} className="font-medium text-primary hover:underline">
                the purchase recorded at {new Date(duplicateOf.purchasedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
              </Link>
              .
            </p>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="fuel-detail-receipt" className="space-y-3">
        <h2 id="fuel-detail-receipt" className="text-[1rem] font-semibold text-fg">Receipt</h2>
        {receipt ? (
          <p className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-[0.8125rem] text-fg-muted shadow-e1">
            <FileText className="size-4 shrink-0" aria-hidden />
            <span className="font-medium text-fg">{receipt.fileName}</span>
            <span>· {(receipt.sizeBytes / 1024).toFixed(0)} KB · nothing has been read off it, no OCR provider is connected</span>
          </p>
        ) : (
          <p className="rounded-lg border border-dashed border-border bg-surface px-4 py-3 text-[0.8125rem] text-fg-muted">
            No receipt attached. A qualified purchase needs one before the quarter can be called ready.
          </p>
        )}
      </section>

      <section aria-labelledby="fuel-detail-revisions" className="space-y-3">
        <h2 id="fuel-detail-revisions" className="text-[1rem] font-semibold text-fg">
          Correction history
        </h2>
        <ol className="space-y-2">
          {revisions.map((rev) => (
            <li
              key={rev.id}
              className={cn(
                "rounded-lg border px-4 py-3 shadow-e1",
                rev.id === t.id ? "border-primary/40 bg-primary/[0.04]" : "border-border bg-surface",
              )}
            >
              <p className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
                <span className="font-semibold text-fg">Revision {rev.revision.number}</span>
                <FuelStateChip state={rev.state} />
                {rev.revision.isCurrent ? (
                  <span className="text-[0.6875rem] font-medium text-primary">Counts toward totals</span>
                ) : (
                  <span className="text-[0.6875rem] text-fg-subtle">Superseded — excluded from every total</span>
                )}
              </p>
              <p className="mt-1 text-[0.75rem] tabular-nums text-fg-muted">
                {formatGallons(rev.gallonsThousandths)}
                {rev.cost ? ` · ${money(rev.cost.totalCostCents)} · ${formatPricePerGallon(rev.cost.pricePerGallonMills)}/gal` : ""}
                {" · "}
                {rev.location.jurisdiction}
              </p>
              {rev.revision.correctionReason ? (
                <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-fg-muted">
                  {rev.revision.correctionReason}
                </p>
              ) : null}
              <p className="mt-1 text-[0.75rem] text-fg-subtle">
                Written by {rev.createdBy.displayNameSnapshot} on{" "}
                {new Date(rev.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="fuel-detail-audit" className="space-y-3">
        <h2 id="fuel-detail-audit" className="text-[1rem] font-semibold text-fg">Audit trail</h2>
        {audit.length === 0 ? (
          <p className="text-[0.8125rem] text-fg-muted">
            Nothing has happened to this record since it was written.
          </p>
        ) : (
          <ol className="space-y-2">
            {audit.map((entry) => (
              <li key={entry.id} className="rounded-lg border border-border bg-surface px-4 py-3 shadow-e1">
                <p className="text-[0.8125rem] text-fg">{entry.summary}</p>
                <p className="mt-1 text-[0.75rem] text-fg-subtle">
                  {entry.actor.displayNameSnapshot} ·{" "}
                  {new Date(entry.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      {correcting ? (
        <CorrectionDialog transaction={t} onClose={() => setCorrecting(false)} />
      ) : null}
    </div>
  );
}

function Row({ label, value, href }: { label: string; value: React.ReactNode; href?: string }) {
  return (
    <div>
      <dt className="text-[0.75rem] font-medium text-fg-muted">{label}</dt>
      <dd className="mt-0.5 text-[0.875rem] text-fg">
        {href ? (
          <Link href={href} className="text-primary hover:underline">{value}</Link>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
