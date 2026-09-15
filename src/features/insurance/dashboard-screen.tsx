"use client";

import {
  ArrowRight, FileBadge, Shield, ShieldAlert, ShieldCheck, TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { INSURANCE_INTEGRATIONS } from "@/lib/insurance/extension-points";
import {
  COVERAGE_TYPE_LABEL, expiryLabel, insuranceDate,
} from "@/lib/insurance/labels";
import { money } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { InsuranceDashboard } from "@/types";
import {
  ClaimSeverityChip, ClaimStatusChip, DisclosureNotice, PolicyStatusChip,
} from "./chips";
import { useInsuranceDashboard } from "./hooks";

/**
 * The organization-scoped Insurance & Claims overview.
 *
 * Every number here is counted in the service layer from records this
 * membership may already open one at a time, so a tile can never hint at a
 * policy or a loss the viewer is not entitled to. A dispatch organization sees
 * a real overview too — made only of what a carrier deliberately shared.
 */
export function InsuranceDashboardScreen() {
  const { data, isPending, isError, refetch } = useInsuranceDashboard();

  return (
    <div className="space-y-section">
      <PageHeader
        title="Insurance and claims"
        description="What you are covered for, what is about to lapse, and every loss still open."
      />

      {isPending ? <LoadingSkeleton rows={6} /> : null}
      {isError ? <ErrorState onRetry={() => refetch()} /> : null}
      {data ? <DashboardBody data={data} /> : null}
    </div>
  );
}

function DashboardBody({ data }: { data: InsuranceDashboard }) {
  const totalPolicies =
    data.policies.active + data.policies.pending + data.policies.expiring + data.policies.expired;
  const openClaims = data.openClaims.length;

  if (totalPolicies === 0 && openClaims === 0 && data.coverageGaps.length === 0) {
    return (
      <>
        <EmptyState
          icon={Shield}
          title="No insurance recorded yet"
          description="Record a policy when you are ready. Antcolos will track the coverage, the expiry dates and the certificates you have sent out, and tell you before anything lapses."
        />
        <IntegrationHonesty />
      </>
    );
  }

  return (
    <>
      <DisclosureNotice level={data.disclosure} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Policies in force"
          value={data.policies.active + data.policies.expiring}
          hint={data.policies.expiring > 0 ? `${data.policies.expiring} expiring soon` : "All in date"}
          tone={data.policies.expiring > 0 ? "warning" : "success"}
          icon={ShieldCheck}
        />
        <Tile
          label="Coverage gaps"
          value={data.coverageGaps.length}
          hint={
            data.coverageGaps.filter((g) => g.severity === "critical").length > 0
              ? `${data.coverageGaps.filter((g) => g.severity === "critical").length} critical`
              : "Nothing running uncovered"
          }
          tone={data.coverageGaps.length > 0 ? "danger" : "success"}
          icon={ShieldAlert}
        />
        <Tile
          label="Open claims"
          value={openClaims}
          hint={
            data.claimsMissingEvidence > 0
              ? `${data.claimsMissingEvidence} missing paperwork`
              : "Paperwork complete"
          }
          tone={data.claimsMissingEvidence > 0 ? "warning" : "neutral"}
          icon={TriangleAlert}
        />
        <Tile
          label="Certificates out"
          value={data.certificates.issued}
          hint={
            data.certificates.expiringSoon > 0
              ? `${data.certificates.expiringSoon} expiring soon`
              : `${data.certificates.expired} expired`
          }
          tone={data.certificates.expiringSoon > 0 ? "warning" : "neutral"}
          icon={FileBadge}
        />
      </div>

      {data.claimFinancials ? (
        <Card>
          <CardHeader>
            <CardTitle>Claim money</CardTitle>
            <Badge tone="outline">Recorded by your team, not paid through Antcolos</Badge>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Figure label="Incurred" value={money(data.claimFinancials.totalIncurred.amount)} />
            <Figure label="Recorded as paid" value={money(data.claimFinancials.totalPaid.amount)} />
            <Figure label="Reserve outstanding" value={money(data.claimFinancials.outstandingReserve.amount)} />
            <Figure label="Deductibles you carried" value={money(data.claimFinancials.deductibleApplied.amount)} />
          </CardContent>
        </Card>
      ) : null}

      {data.coverageGaps.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Running without cover</CardTitle>
            <Link
              href="/needs-you"
              className="text-[0.8125rem] font-medium text-primary hover:underline"
            >
              Open in Needs You
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.coverageGaps.map((gap) => (
              <div
                key={gap.id}
                className={cn(
                  "flex flex-wrap items-start justify-between gap-x-4 gap-y-1 rounded-md border px-3.5 py-2.5",
                  gap.severity === "critical"
                    ? "border-st-danger/35 bg-st-danger-bg/40"
                    : "border-border bg-surface-sunken",
                )}
              >
                <div className="min-w-0">
                  <p className="text-[0.875rem] font-medium text-fg">
                    {gap.subjectLabel} · no {COVERAGE_TYPE_LABEL[gap.coverageType].toLowerCase()}
                  </p>
                  <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">{gap.reason}</p>
                </div>
                {gap.href ? (
                  <Link
                    href={gap.href}
                    className="shrink-0 text-[0.75rem] font-medium text-primary hover:underline"
                  >
                    Open the unit
                  </Link>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {data.expiringSoon.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Expiring and expired</CardTitle>
            <Link href="/insurance/policies" className="text-[0.8125rem] font-medium text-primary hover:underline">
              All policies
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.expiringSoon.map((p) => (
              <Link
                key={p.policyId}
                href={`/insurance/policies/${p.policyId}`}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md border border-border bg-surface px-3.5 py-2.5 hover:border-border-strong hover:bg-surface-hover"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-[0.875rem] font-medium text-fg">
                    {p.policyNumber}
                    <PolicyStatusChip status={p.status} />
                  </p>
                  <p className="mt-0.5 text-[0.75rem] text-fg-muted">
                    {p.insurerName} · {p.coverageTypes.map((t) => COVERAGE_TYPE_LABEL[t]).join(", ")}
                  </p>
                </div>
                <p className="shrink-0 text-[0.75rem] tabular-nums text-fg-muted">
                  {insuranceDate(p.expiresAt)} · {expiryLabel(p.daysUntilExpiry)}
                </p>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {data.openClaims.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Open claims</CardTitle>
            <Link href="/insurance/claims" className="text-[0.8125rem] font-medium text-primary hover:underline">
              All claims
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.openClaims.map((c) => (
              <Link
                key={c.claimId}
                href={`/insurance/claims/${c.claimId}`}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md border border-border bg-surface px-3.5 py-2.5 hover:border-border-strong hover:bg-surface-hover"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-[0.875rem] font-medium text-fg">
                    {c.claimReference}
                    <ClaimStatusChip status={c.status} />
                    <ClaimSeverityChip severity={c.severity} />
                    {c.missingRequiredEvidence > 0 ? (
                      <Badge tone="warning">
                        {c.missingRequiredEvidence} missing
                      </Badge>
                    ) : null}
                  </p>
                  <p className="mt-0.5 truncate text-[0.75rem] text-fg-muted">{c.title}</p>
                </div>
                <ArrowRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <IntegrationHonesty />
    </>
  );
}

function Tile({
  label, value, hint, tone, icon: Icon,
}: {
  label: string;
  value: number;
  hint: string;
  tone: "success" | "warning" | "danger" | "neutral";
  icon: typeof Shield;
}) {
  const toneClass = {
    success: "text-st-success",
    warning: "text-st-warning",
    danger: "text-st-danger",
    neutral: "text-fg-muted",
  }[tone];

  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <div className="flex items-center justify-between">
        <p className="text-[0.75rem] font-medium text-fg-muted">{label}</p>
        <Icon className={cn("size-4", toneClass)} aria-hidden />
      </div>
      <p className="mt-2 text-[1.75rem] leading-9 font-semibold tabular-nums text-fg">{value}</p>
      <p className={cn("mt-0.5 text-[0.75rem]", toneClass)}>{hint}</p>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[0.75rem] text-fg-muted">{label}</p>
      <p className="mt-0.5 text-[1.125rem] font-semibold tabular-nums text-fg">{value}</p>
    </div>
  );
}

/**
 * What is NOT connected, stated on the screen rather than left to be assumed.
 *
 * Read from the same table the adapters are declared in, so this list cannot
 * fall out of step with reality the day one of them is wired up.
 */
function IntegrationHonesty() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>What Antcolos has not done</CardTitle>
        <Badge tone="warning">Nothing here is connected</Badge>
      </CardHeader>
      <CardContent className="space-y-2.5">
        <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
          Everything on these screens is what your team recorded. Antcolos has not spoken to
          an insurer, filed a claim, moved any money, read any document or reported anything
          to any authority.
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {INSURANCE_INTEGRATIONS.map((integration) => (
            <li
              key={integration.kind}
              className="rounded-md border border-border bg-surface-sunken px-3.5 py-2.5"
            >
              <p className="text-[0.8125rem] font-medium text-fg">{integration.label}</p>
              <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
                {integration.today}
              </p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
