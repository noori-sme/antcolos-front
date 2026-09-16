"use client";

import { Building2, Eye, EyeOff, IdCard, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, LoadingSkeleton } from "@/components/data/states";
import type { CarrierRelationship } from "@/types";
import { RelationshipStatusChip, ExpiryChip, DocumentStatusChip } from "./status-chips";
import {
  ENGAGEMENT_LABEL, daysUntil, expiryState, formatDate, maskCdl,
} from "./driver-rules";
import { completion, documentRequirements } from "./mock-driver";
import { currentRelationship, useDriverData } from "./use-driver-data";
import { cn } from "@/lib/utils";

/**
 * The driver's permanent profile.
 *
 * It belongs to the driver, not to any carrier: it survives leaving one, and
 * follows them to the next. Carriers appear here as relationships — current and
 * former — rather than as owners of the record.
 */
export function DriverProfileScreen() {
  const data = useDriverData();
  const [revealed, setRevealed] = useState(false);

  if (data.loading) return <LoadingSkeleton rows={5} />;

  if (!data.profile) {
    return (
      <div className="space-y-section">
        <PageHeader title="My driver profile" />
        <EmptyState
          icon={IdCard}
          title="You don't have a driver profile yet"
          description="Your driver profile is created when you sign up as a driver, or when you accept a carrier's invitation. Either way it belongs to you and follows you between carriers."
        />
      </div>
    );
  }

  const profile = data.profile;
  const current = data.relationships.filter((r) => r.status !== "ended");
  const previous = data.relationships.filter((r) => r.status === "ended");
  const active = currentRelationship(current);
  const progress = active
    ? completion(documentRequirements(active.engagementType, active.carrierId), data.documents)
    : null;

  return (
    <div className="space-y-section">
      <PageHeader
        title="My driver profile"
        description="This profile is yours. It stays with you when you change carriers."
      />

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
          <h2 className="text-[0.9375rem] font-semibold text-fg">Identity and licence</h2>
          <dl className="mt-3 divide-y divide-border">
            <Row label="Full legal name" value={profile.legalName} />
            <Row label="Username" value={`@${profile.username}`} />
            <Row label="Email" value={profile.email} />
            <Row label="Phone" value={profile.phone ?? "Not added yet"} />
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
              <dt className="text-[0.75rem] text-fg-muted">Licence number</dt>
              <dd className="flex items-center gap-2">
                <span className="font-mono text-[0.8125rem] font-medium text-fg">
                  {revealed ? profile.cdlNumber : maskCdl(profile.cdlNumber)}
                </span>
                <button
                  type="button"
                  onClick={() => setRevealed((v) => !v)}
                  aria-pressed={revealed}
                  className="rounded-sm p-1 text-fg-subtle transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {revealed ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                  <span className="sr-only">
                    {revealed ? "Hide licence number" : "Show licence number"}
                  </span>
                </button>
              </dd>
            </div>
            <Row label="Issuing state" value={profile.cdlState} />
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
              <dt className="text-[0.75rem] text-fg-muted">CDL expiration</dt>
              <dd>
                <ExpiryChip state={expiryState(profile.cdlExpiresAt)}>
                  {formatDate(profile.cdlExpiresAt)}
                  {expiryState(profile.cdlExpiresAt) !== "ok"
                    ? ` · ${daysUntil(profile.cdlExpiresAt)} days`
                    : ""}
                </ExpiryChip>
              </dd>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
              <dt className="text-[0.75rem] text-fg-muted">Medical card expiration</dt>
              <dd>
                <ExpiryChip state={expiryState(profile.medicalCardExpiresAt)}>
                  {profile.medicalCardExpiresAt ? formatDate(profile.medicalCardExpiresAt) : ""}
                  {profile.medicalCardExpiresAt && expiryState(profile.medicalCardExpiresAt) !== "ok"
                    ? ` · ${daysUntil(profile.medicalCardExpiresAt)} days`
                    : ""}
                </ExpiryChip>
              </dd>
            </div>
          </dl>
        </section>

        <div className="space-y-4">
          {progress ? (
            <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <h2 className="text-[0.9375rem] font-semibold text-fg">Profile completion</h2>
                <p className="text-[0.8125rem] text-fg-muted tabular-nums">{progress.percent}%</p>
              </div>
              <div
                role="progressbar"
                aria-valuenow={progress.percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Profile completion"
                className="mt-2.5 h-2 overflow-hidden rounded-full bg-surface-sunken"
              >
                <div
                  className={cn(
                    "h-full rounded-full",
                    progress.percent === 100 ? "bg-st-success" : "bg-primary",
                  )}
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
              <p className="mt-2 text-[0.8125rem] text-fg-muted">
                {progress.done} of {progress.required} required documents in for{" "}
                {active?.carrierName}.
              </p>
              <Button variant="secondary" size="sm" className="mt-3" asChild>
                <Link href="/driver/documents">Go to my documents</Link>
              </Button>
            </section>
          ) : null}

          <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
            <h2 className="text-[0.9375rem] font-semibold text-fg">Document status</h2>
            {data.documents.length === 0 ? (
              <p className="mt-2 text-[0.8125rem] text-fg-muted">Nothing uploaded yet.</p>
            ) : (
              <ul className="mt-2.5 space-y-1.5">
                {data.documents.map((doc) => (
                  <li key={doc.requirementKey} className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-[0.8125rem] text-fg">
                      {doc.fileName ?? doc.requirementKey}
                    </span>
                    <DocumentStatusChip status={doc.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <section>
        <h2 className="mb-2.5 text-[0.9375rem] font-semibold text-fg">Current carriers</h2>
        {current.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="You are not working with a carrier right now"
            description="Open the invitation link a carrier sends you to start working with them."
          />
        ) : (
          <ul className="space-y-2.5">
            {current.map((r) => <RelationshipRow key={r.id} relationship={r} />)}
          </ul>
        )}
      </section>

      {previous.length > 0 ? (
        <section>
          <h2 className="mb-1 text-[0.9375rem] font-semibold text-fg">Previous carriers</h2>
          <p className="mb-2.5 text-[0.8125rem] leading-relaxed text-fg-muted">
            These relationships have ended. Your profile and account were not affected — only their
            access stopped.
          </p>
          <ul className="space-y-2.5">
            {previous.map((r) => <RelationshipRow key={r.id} relationship={r} />)}
          </ul>
        </section>
      ) : null}

      <p className="flex items-start gap-2.5 rounded-md border border-dashed border-border px-3.5 py-3 text-[0.75rem] leading-relaxed text-fg-subtle">
        <ShieldCheck className="mt-px size-4 shrink-0" aria-hidden />
        Preview build: this profile is mock data. Nothing here is verified, stored permanently, or
        shared with anyone.
      </p>
    </div>
  );
}

function RelationshipRow({ relationship }: { relationship: CarrierRelationship }) {
  const ended = relationship.status === "ended";
  return (
    // The carrier is on the row itself: a test that asks "did signing up add a
    // carrier?" should not have to read layout to answer it.
    <li
      data-carrier-id={relationship.carrierId}
      className="rounded-lg border border-border bg-surface p-4 shadow-e1"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-[0.9375rem] font-semibold text-fg">{relationship.carrierName}</span>
            <RelationshipStatusChip status={relationship.status} />
          </p>
          <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
            {ENGAGEMENT_LABEL[relationship.engagementType]} · {relationship.roleName}
          </p>
          <p className="mt-1 text-[0.75rem] text-fg-subtle">
            {relationship.startedAt ? `Started ${formatDate(relationship.startedAt)}` : `Invited ${formatDate(relationship.invitedAt)}`}
            {ended && relationship.endedAt ? ` · ended ${formatDate(relationship.endedAt)}` : ""}
          </p>
          {ended && relationship.endReason ? (
            <p className="mt-1 text-[0.75rem] text-fg-subtle">Reason: {relationship.endReason}</p>
          ) : null}
        </div>
        <p className="shrink-0 text-[0.75rem] text-fg-subtle tabular-nums">
          {relationship.sharedDocumentKeys.length} documents shared
        </p>
      </div>
    </li>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5">
      <dt className="text-[0.75rem] text-fg-muted">{label}</dt>
      <dd className="text-[0.8125rem] font-medium text-fg">{value}</dd>
    </div>
  );
}
