"use client";

import {
  ArrowLeft, CalendarClock, History, Layers, Share2, Shield, Undo2,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Can } from "@/components/auth/can";
import { EmptyState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import {
  COVERAGE_TYPE_DESCRIPTION, COVERAGE_TYPE_LABEL, expiryLabel, insuranceDate,
  insuranceDateTime, SUBJECT_KIND_LABEL,
} from "@/lib/insurance/labels";
import { money } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { PolicyProfileView } from "@/lib/api/mock/insurance-registry";
import {
  CertificateStatusChip, ClaimStatusChip, CoverageStatusChip, DisclosureNotice,
  PolicyStatusChip, VerificationChip,
} from "./chips";
import { usePolicyAction, usePolicyProfile } from "./hooks";

export function PolicyProfileScreen({ policyId }: { policyId: string }) {
  const { data, isPending, isError } = usePolicyProfile(policyId);

  if (isPending) return <LoadingSkeleton rows={8} />;
  if (isError || !data) {
    return (
      <EmptyState
        icon={Shield}
        title="Policy not found"
        description="Either it does not exist or your organization has not been given it. Antcolos answers both the same way on purpose."
        action={<Button variant="secondary" asChild><Link href="/insurance/policies">Back to policies</Link></Button>}
      />
    );
  }

  return <Profile data={data} />;
}

function Profile({ data }: { data: PolicyProfileView }) {
  const { policy } = data;
  const full = policy.disclosure === "full";

  return (
    <div className="space-y-section">
      <Link
        href="/insurance/policies"
        className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-fg-muted hover:text-fg"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Policies
      </Link>

      <PageHeader
        title={policy.policyNumber}
        description={`${policy.insurerName} · ${policy.carrierName}`}
        actions={
          full ? (
            <Can permission="insurance:manage">
              <RenewControl policyId={policy.policyId} policyNumber={policy.policyNumber} />
            </Can>
          ) : null
        }
      />

      <DisclosureNotice level={policy.disclosure} />

      <div className="flex flex-wrap items-center gap-2">
        <PolicyStatusChip status={policy.status} />
        <VerificationChip state={policy.insurerVerification} />
        <Badge tone="outline">Version {policy.versionNumber}</Badge>
        {policy.supersededByPolicyId ? <Badge tone="neutral">Replaced by a later version</Badge> : null}
      </div>

      <Card>
        <CardHeader><CardTitle>Term</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Effective from" value={insuranceDate(policy.effectiveFrom)} />
          <Fact label="Expires" value={`${insuranceDate(policy.expiresAt)} · ${expiryLabel(policy.daysUntilExpiry)}`} />
          <Fact label="Agent" value={policy.agentName ?? "Not recorded"} />
          <Fact
            label="Premium"
            value={
              policy.premium
                ? `${money(policy.premium.amount)}${policy.premiumInterval ? ` · ${policy.premiumInterval}` : ""}`
                : full ? "Not recorded" : "Not shared with you"
            }
          />
          {policy.notes ? (
            <p className="sm:col-span-2 lg:col-span-4 rounded-md bg-surface-sunken px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-fg-muted">
              {policy.notes}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Coverage</CardTitle>
          <Badge tone="outline">{policy.coverage.length} lines</Badge>
        </CardHeader>
        <CardContent className="space-y-2">
          {policy.coverage.length === 0 ? (
            <p className="text-[0.8125rem] text-fg-muted">No coverage lines were shared with you.</p>
          ) : null}
          {policy.coverage.map((line) => (
            <div key={line.coverageId} className="rounded-md border border-border bg-surface-sunken px-3.5 py-3">
              <p className="flex flex-wrap items-center gap-2">
                <span className="text-[0.875rem] font-medium text-fg">
                  {COVERAGE_TYPE_LABEL[line.coverageType]}
                </span>
                <CoverageStatusChip status={line.status} />
                {line.endorsement ? <Badge tone="outline">Form {line.endorsement}</Badge> : null}
              </p>
              <p className="mt-0.5 text-[0.75rem] text-fg-muted">
                {COVERAGE_TYPE_DESCRIPTION[line.coverageType]}
              </p>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.75rem] tabular-nums text-fg-muted">
                <span>{money(line.limitPerOccurrence.amount, { compact: true })} per occurrence</span>
                {line.aggregateLimit ? (
                  <span>{money(line.aggregateLimit.amount, { compact: true })} aggregate</span>
                ) : null}
                <span>
                  {line.deductible
                    ? `${money(line.deductible.amount)} deductible`
                    : "Deductible not shared with you"}
                </span>
                <span>{insuranceDate(line.effectiveFrom)} – {insuranceDate(line.expiresAt)}</span>
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What is on the schedule</CardTitle>
          <Badge tone="outline">{data.subjects.filter((s) => !s.removedAt).length} on cover now</Badge>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
            Rows are dated rather than deleted. A unit taken off the schedule is still
            covered for anything that happened before it came off.
          </p>
          {data.subjects.length === 0 ? (
            <p className="text-[0.8125rem] text-fg-muted">Nothing is scheduled on this policy.</p>
          ) : null}
          {data.subjects.map((row) => (
            <div
              key={row.id}
              className={cn(
                "flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md border px-3.5 py-2.5",
                row.removedAt ? "border-dashed border-border bg-transparent" : "border-border bg-surface-sunken",
              )}
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-[0.875rem] font-medium text-fg">
                  {row.subjectLabel}
                  <Badge tone="outline">{SUBJECT_KIND_LABEL[row.subjectKind]}</Badge>
                  {row.removedAt ? <Badge tone="neutral">Off the schedule</Badge> : null}
                </p>
                {row.removalReason ? (
                  <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">{row.removalReason}</p>
                ) : null}
              </div>
              <p className="shrink-0 text-[0.75rem] tabular-nums text-fg-muted">
                {insuranceDate(row.addedAt)} – {row.removedAt ? insuranceDate(row.removedAt) : "on cover"}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      {data.versions.length > 1 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="size-4 text-fg-subtle" aria-hidden />
              Every version of this policy
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
              A renewal writes a new version. The previous ones are kept whole — their
              coverage, their certificates and the claims attributed to them are unchanged.
            </p>
            {data.versions.map((v) => (
              <Link
                key={v.policyId}
                href={`/insurance/policies/${v.policyId}`}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md border px-3.5 py-2.5",
                  v.policyId === policy.policyId
                    ? "border-primary/40 bg-primary/5"
                    : "border-border bg-surface hover:border-border-strong hover:bg-surface-hover",
                )}
              >
                <p className="flex flex-wrap items-center gap-2 text-[0.875rem] font-medium text-fg">
                  Version {v.versionNumber} · {v.policyNumber}
                  <PolicyStatusChip status={v.status} />
                  {v.policyId === policy.policyId ? <Badge tone="info">You are here</Badge> : null}
                </p>
                <p className="text-[0.75rem] tabular-nums text-fg-muted">
                  {insuranceDate(v.effectiveFrom)} – {insuranceDate(v.expiresAt)}
                </p>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {data.certificates.length > 0 ? (
        <Card>
          <CardHeader><CardTitle>Certificates issued against this version</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.certificates.map((cert) => (
              <div key={cert.certificateId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md border border-border bg-surface-sunken px-3.5 py-2.5">
                <p className="flex flex-wrap items-center gap-2 text-[0.875rem] font-medium text-fg">
                  {cert.holderName}
                  <span className="font-normal text-fg-muted">{cert.certificateNumber}</span>
                  <CertificateStatusChip status={cert.status} />
                </p>
                <p className="text-[0.75rem] tabular-nums text-fg-muted">
                  {insuranceDate(cert.expiresAt)} · {expiryLabel(cert.daysUntilExpiry)}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {full ? <SharingCard data={data} /> : null}

      {full && data.claims.length > 0 ? (
        <Card>
          <CardHeader><CardTitle>Claims attributed to this version</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.claims.map((claim) => (
              <Link
                key={claim.claimId}
                href={`/insurance/claims/${claim.claimId}`}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md border border-border bg-surface px-3.5 py-2.5 hover:border-border-strong hover:bg-surface-hover"
              >
                <p className="flex flex-wrap items-center gap-2 text-[0.875rem] font-medium text-fg">
                  {claim.claimReference}
                  <ClaimStatusChip status={claim.status} />
                  <span className="font-normal text-fg-muted">{claim.title}</span>
                </p>
                <p className="text-[0.75rem] tabular-nums text-fg-muted">{insuranceDate(claim.eventAt)}</p>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="size-4 text-fg-subtle" aria-hidden />
            History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {data.events.map((event) => (
              <li key={event.id} className="flex gap-3">
                <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-border-strong" />
                <div className="min-w-0">
                  <p className="text-[0.875rem] font-medium text-fg">{event.summary}</p>
                  {event.detail ? (
                    <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-fg-muted">{event.detail}</p>
                  ) : null}
                  <p className="mt-0.5 text-[0.75rem] tabular-nums text-fg-subtle">
                    {insuranceDateTime(event.at)}
                    {event.actorName ? ` · ${event.actorName}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[0.75rem] text-fg-muted">{label}</p>
      <p className="mt-0.5 text-[0.875rem] font-medium text-fg">{value}</p>
    </div>
  );
}

/**
 * Renewal, from the screen.
 *
 * The form asks only for the new term, because everything else is carried
 * forward by the service: a renewal that made the operator re-key the schedule
 * would be a renewal that quietly loses units.
 */
function RenewControl({ policyId, policyNumber }: { policyId: string; policyNumber: string }) {
  const action = usePolicyAction();
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState(`${policyNumber}-R`);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  if (!open) {
    return (
      <Button variant="primary" onClick={() => setOpen(true)}>
        <CalendarClock aria-hidden />
        Renew
      </Button>
    );
  }

  return (
    <form
      className="w-full max-w-md space-y-2 rounded-lg border border-border bg-surface p-3.5 shadow-e1"
      onSubmit={(e) => {
        e.preventDefault();
        action.mutate(
          {
            kind: "renew",
            policyId,
            input: {
              policyNumber: number,
              effectiveFrom: new Date(from).toISOString(),
              expiresAt: new Date(to).toISOString(),
              reason: "renewal",
            },
          },
          { onSuccess: () => setOpen(false) },
        );
      }}
    >
      <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
        Renewing writes a new version and carries the coverage and the schedule forward.
        This version is kept exactly as it is.
      </p>
      <Input
        value={number}
        onChange={(e) => setNumber(e.target.value)}
        aria-label="New policy number"
        placeholder="New policy number"
        required
      />
      <div className="flex gap-2">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="New term starts" required />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="New term ends" required />
      </div>
      {action.isError ? (
        <p className="text-[0.75rem] text-st-danger">{action.error.message}</p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={action.isPending}>
          {action.isPending ? "Recording…" : "Record the renewal"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}

const SHAREABLE = [
  { id: "org_meridian", name: "Meridian Dispatch" },
  { id: "org_summit", name: "Summit Dispatch" },
];

/**
 * Who outside the carrier can see this policy, and why.
 *
 * Every grant carries a written purpose and can be taken away. Nothing is ever
 * shared by default, and a share never carries premiums, private notes or
 * claim money.
 */
function SharingCard({ data }: { data: PolicyProfileView }) {
  const action = usePolicyAction();
  const [target, setTarget] = useState(SHAREABLE[0].id);
  const [purpose, setPurpose] = useState("");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Share2 className="size-4 text-fg-subtle" aria-hidden />
          Shared with
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
          Dispatch organizations see nothing of your insurance unless you share it here.
          A share carries the coverage summary only — never your premium, your private
          notes, your deductibles or anything to do with a claim&apos;s money.
        </p>

        {data.shares.length === 0 ? (
          <p className="text-[0.8125rem] text-fg-muted">This policy has not been shared with anybody.</p>
        ) : null}

        {data.shares.map((share) => (
          <div key={share.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 rounded-md border border-border bg-surface-sunken px-3.5 py-2.5">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-[0.875rem] font-medium text-fg">
                {share.sharedWithName}
                {share.revokedAt ? <Badge tone="neutral">Access taken away</Badge> : <Badge tone="success">Can see it</Badge>}
              </p>
              <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">{share.purpose}</p>
              <p className="mt-0.5 text-[0.75rem] tabular-nums text-fg-subtle">
                Shared {insuranceDate(share.sharedAt)} by {share.sharedByName}
                {share.revokedAt ? ` · taken away ${insuranceDate(share.revokedAt)}` : ""}
              </p>
            </div>
            {share.revokedAt ? null : (
              <Can permission="insurance:share:manage">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={action.isPending}
                  onClick={() => action.mutate({ kind: "revoke_share", shareId: share.id })}
                >
                  <Undo2 aria-hidden />
                  Take access away
                </Button>
              </Can>
            )}
          </div>
        ))}

        <Can permission="insurance:share:manage">
          <form
            className="space-y-2 rounded-md border border-dashed border-border px-3.5 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              const org = SHAREABLE.find((o) => o.id === target)!;
              action.mutate(
                {
                  kind: "share",
                  policyId: data.policy.policyId,
                  input: {
                    organizationId: org.id,
                    organizationName: org.name,
                    purpose,
                    scope: "coverage_summary",
                  },
                },
                { onSuccess: () => setPurpose("") },
              );
            }}
          >
            <div className="flex flex-wrap gap-2">
              <label className="sr-only" htmlFor="share-target">Organization to share with</label>
              <select
                id="share-target"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="h-control rounded-md border border-border bg-surface px-3 text-[0.8125rem] text-fg shadow-e1"
              >
                {SHAREABLE.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <Input
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="Why do they need it?"
                aria-label="Purpose of the share"
                className="min-w-0 flex-1"
                required
              />
              <Button type="submit" variant="secondary" disabled={action.isPending}>Share</Button>
            </div>
            {action.isError ? (
              <p className="text-[0.75rem] text-st-danger">{action.error.message}</p>
            ) : null}
          </form>
        </Can>
      </CardContent>
    </Card>
  );
}
