"use client";

import { ArrowLeft, FileText, ShieldCheck, UserMinus } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, LoadingSkeleton } from "@/components/data/states";
import { PermissionSummary } from "@/features/access/permission-summary";
import { DocumentStatusChip, ExpiryChip, RelationshipStatusChip } from "./status-chips";
import { ENGAGEMENT_LABEL, expiryState, formatDate, maskCdl } from "./driver-rules";
import {
  type CarrierDriver, mockEndCarrierRelationship, mockGetCarrierDriver,
} from "./mock-carrier-drivers";
import { cn } from "@/lib/utils";

/**
 * One driver, as this carrier sees them.
 *
 * Everything here came from the driver agreeing to share it. Ending the
 * relationship ends what the carrier receives from now on; it does not delete
 * the driver's profile, their account, or the snapshots already taken.
 */
export function CarrierDriverDetail({ relationshipId }: { relationshipId: string }) {
  const uid = useId();
  const [driver, setDriver] = useState<CarrierDriver | null | "missing">(null);
  const [ending, setEnding] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    mockGetCarrierDriver(relationshipId).then((found) => {
      if (!cancelled) setDriver(found ?? "missing");
    });
    return () => {
      cancelled = true;
    };
  }, [relationshipId]);

  if (driver === null) return <LoadingSkeleton rows={5} />;

  if (driver === "missing") {
    return (
      <EmptyState
        icon={FileText}
        title="Driver not found"
        description="This driver relationship does not exist, or is not yours to see."
        action={
          <Button variant="secondary" asChild>
            <Link href="/people/drivers">Back to drivers</Link>
          </Button>
        }
      />
    );
  }

  async function endRelationship() {
    if (driver === null || driver === "missing") return;
    if (reason.trim().length < 3) {
      setReasonError("Give a short reason. It is recorded on the relationship.");
      return;
    }
    setReasonError(null);
    setEnding(true);
    const updated = await mockEndCarrierRelationship(driver.id, reason);
    setDriver(updated);
    setEnding(false);
    setConfirming(false);
  }

  const ended = driver.status === "ended";

  return (
    <div className="space-y-section">
      <div>
        <Link
          href="/people/drivers"
          className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          All drivers
        </Link>
      </div>

      <PageHeader
        title={driver.name}
        description={`${ENGAGEMENT_LABEL[driver.engagementType]} · ${driver.roleName}`}
        actions={
          !ended ? (
            <Button variant="secondary" onClick={() => setConfirming(true)}>
              <UserMinus aria-hidden />
              End relationship
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <RelationshipStatusChip status={driver.status} />
        {ended && driver.endedAt ? (
          <span className="text-[0.75rem] text-fg-subtle">
            Ended {formatDate(driver.endedAt)}
            {driver.endReason ? ` · ${driver.endReason}` : ""}
          </span>
        ) : null}
      </div>

      {ended ? (
        <div className="flex gap-2.5 rounded-md border border-border bg-surface-sunken px-3.5 py-3">
          <ShieldCheck className="mt-px size-4 shrink-0 text-fg-subtle" aria-hidden />
          <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
            This relationship has ended. The documents below are the snapshots this driver shared
            with you and stay in your records. You no longer receive updates to their profile, and
            their Antcolos account and driver profile are unaffected.
          </p>
        </div>
      ) : null}

      {confirming ? (
        <div role="alert" className="rounded-lg border border-st-warning/40 bg-st-warning-bg/60 p-4">
          <p className="text-[0.875rem] font-medium text-fg">
            End your relationship with {driver.name}?
          </p>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">
            They stop appearing in dispatch and lose access to your loads. Their Antcolos account
            and driver profile are <strong className="font-medium text-fg">not</strong> deleted —
            they keep both and can work for another carrier. Documents they already shared stay in
            your records.
          </p>
          <div className="mt-3 max-w-md">
            <Field label="Reason" htmlFor={`${uid}-reason`} error={reasonError ?? undefined}>
              <Textarea
                id={`${uid}-reason`}
                rows={2}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  if (reasonError) setReasonError(null);
                }}
                placeholder="Left for another carrier."
              />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="danger" size="sm" onClick={endRelationship} disabled={ending} aria-busy={ending || undefined}>
              {ending ? "Ending…" : "End relationship"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={ending}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
          <h2 className="text-[0.9375rem] font-semibold text-fg">What {driver.name.split(" ")[0]} shared with you</h2>
          <p className="mt-0.5 text-[0.75rem] text-fg-muted">
            The driver controls this. You see what they agreed to share.
          </p>
          <dl className="mt-3 divide-y divide-border">
            <Row label="Email" value={driver.email} />
            <Row label="Licence number" value={driver.cdlNumber === "—" ? "Not shared yet" : maskCdl(driver.cdlNumber)} mono />
            <Row label="Issuing state" value={driver.cdlState} />
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
              <dt className="text-[0.75rem] text-fg-muted">CDL expiration</dt>
              <dd>
                {driver.cdlExpiresAt ? (
                  <ExpiryChip state={expiryState(driver.cdlExpiresAt)}>
                    {formatDate(driver.cdlExpiresAt)}
                  </ExpiryChip>
                ) : (
                  <span className="text-[0.8125rem] text-fg-subtle">Not shared yet</span>
                )}
              </dd>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
              <dt className="text-[0.75rem] text-fg-muted">Medical card expiration</dt>
              <dd>
                <ExpiryChip state={expiryState(driver.medicalExpiresAt)}>
                  {driver.medicalExpiresAt ? formatDate(driver.medicalExpiresAt) : ""}
                </ExpiryChip>
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <h2 className="text-[0.9375rem] font-semibold text-fg">Onboarding progress</h2>
            <p className="text-[0.8125rem] text-fg-muted tabular-nums">
              {driver.documentsDone} of {driver.documentsRequired}
            </p>
          </div>
          <div
            role="progressbar"
            aria-valuenow={Math.round((driver.documentsDone / Math.max(1, driver.documentsRequired)) * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Onboarding progress for ${driver.name}`}
            className="mt-2.5 h-2 overflow-hidden rounded-full bg-surface-sunken"
          >
            <div
              className={cn(
                "h-full rounded-full",
                driver.documentsDone === driver.documentsRequired ? "bg-st-success" : "bg-primary",
              )}
              style={{
                width: `${Math.round((driver.documentsDone / Math.max(1, driver.documentsRequired)) * 100)}%`,
              }}
            />
          </div>
          <h3 className="mt-4 text-[0.875rem] font-semibold text-fg">Assigned permissions</h3>
          <div className="mt-2">
            <PermissionSummary permissions={driver.permissions} />
          </div>
        </section>
      </div>

      <section>
        <h2 className="mb-1 text-[0.9375rem] font-semibold text-fg">Shared documents</h2>
        <p className="mb-2.5 text-[0.8125rem] leading-relaxed text-fg-muted">
          Snapshots taken when the driver shared them. They stay in your records even after the
          relationship ends.
        </p>
        {driver.sharedDocuments.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[0.8125rem] text-fg-muted">
            Nothing shared yet. Documents appear here once the driver submits them.
          </p>
        ) : (
          <ul className="space-y-2">
            {driver.sharedDocuments.map((doc) => (
              <li
                key={doc.key}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border border-border bg-surface px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-[0.8125rem] font-medium text-fg">{doc.label}</p>
                  <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                    {doc.fileName} · shared {formatDate(doc.sharedAt)}
                    {doc.expiresAt ? ` · expires ${formatDate(doc.expiresAt)}` : ""}
                  </p>
                </div>
                <DocumentStatusChip status={doc.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <Timeline title="Invitation history" events={driver.invitationHistory} />
        <Timeline title="Relationship timeline" events={driver.timeline} />
      </div>
    </div>
  );
}

function Timeline({
  title,
  events,
}: {
  title: string;
  events: Array<{ at: string; event: string; detail?: string }>;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <h2 className="text-[0.9375rem] font-semibold text-fg">{title}</h2>
      <ol className="mt-3 space-y-3">
        {events.map((e, i) => (
          <li key={`${e.at}-${i}`} className="flex gap-3">
            <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-border-strong" />
            <div className="min-w-0">
              <p className="text-[0.8125rem] font-medium text-fg">{e.event}</p>
              <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                {formatDate(e.at)}
                {e.detail ? ` · ${e.detail}` : ""}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5">
      <dt className="text-[0.75rem] text-fg-muted">{label}</dt>
      <dd className={cn("text-[0.8125rem] font-medium text-fg", mono && "font-mono")}>{value}</dd>
    </div>
  );
}
