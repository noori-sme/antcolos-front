"use client";

import Link from "next/link";
import { Radar, ScrollText, ShieldAlert, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Can } from "@/components/auth/can";
import { RISK_CASE_STATE_TONE, RISK_SEVERITY_TONE } from "@/config/audit";
import {
  RISK_CASE_STATE_LABEL, RISK_SEVERITY_LABEL, type RiskCaseState,
  type RiskSeverity,
} from "@/types";
import { useCan } from "@/lib/session/hooks";
import { cn } from "@/lib/utils";
import { ExtensionPointsPanel } from "./extension-points";
import { ScopeNotice } from "./notices";
import { RulesPanel } from "./rules-panel";
import { SourcesPanel } from "./sources-panel";
import { useRiskDashboard } from "./use-audit";

const SEVERITIES: RiskSeverity[] = ["critical", "high", "medium", "low", "informational"];
const CASE_STATES: RiskCaseState[] = [
  "open", "investigating", "action_required", "escalated",
  "resolved", "accepted_risk", "dismissed",
];

/**
 * The organization-scoped Audit & Risk dashboard.
 *
 * Counts, not analytics. Every number on it is a count of something a person
 * can click through to and read in full — there is no score, no index and no
 * trend line, because none of those would be anything but invented.
 */
export function AuditRiskDashboardScreen() {
  const canSeeRisk = useCan("risk:view");
  const dashboard = useRiskDashboard();

  return (
    <div className="space-y-section">
      <PageHeader
        title="Audit & Risk"
        description="What happened in this organization, what has been flagged, and what is being looked into."
      />

      <ScopeNotice />

      {!canSeeRisk ? (
        <section className="rounded-lg border border-border bg-surface p-4">
          <p className="text-[0.8125rem] text-fg-muted">
            You can read the audit log. Risk signals and cases need separate permission —
            reading the record of what happened and working an investigation are different
            jobs, so they are different keys.
          </p>
          <Link
            href="/audit/events"
            className="mt-3 inline-flex items-center gap-1.5 text-[0.8125rem] text-primary hover:underline"
          >
            <ScrollText aria-hidden className="size-4" />
            Open the audit log
          </Link>
        </section>
      ) : null}

      <Can permission="risk:view">
        {dashboard.isLoading ? <LoadingSkeleton rows={4} /> : null}
        {dashboard.isError ? <ErrorState onRetry={() => dashboard.refetch()} /> : null}

        {dashboard.data ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat
                icon={ScrollText}
                label="Recorded actions"
                value={dashboard.data.auditEventCount}
                detail={`In the last ${Math.round(dashboard.data.windowHours / 24)} days`}
                href="/audit/events"
              />
              <Stat
                icon={TriangleAlert}
                label="Refused or failed"
                value={dashboard.data.deniedActionCount}
                detail="Attempts that did not go through"
                href="/audit/events"
              />
              <Stat
                icon={Radar}
                label="Open signals"
                value={dashboard.data.openSignalCount}
                detail="Flagged by the mock rules"
                href="/audit/signals"
              />
              <Stat
                icon={ShieldAlert}
                label="Open cases"
                value={dashboard.data.openCaseCount}
                detail={
                  dashboard.data.overdueCaseCount
                    ? `${dashboard.data.overdueCaseCount} past their due date`
                    : "None past their due date"
                }
                href="/audit/cases"
                emphasis={dashboard.data.overdueCaseCount > 0}
              />
            </div>

            {dashboard.data.myAttentionCount > 0 ? (
              <Link
                href="/audit/cases?owner=me"
                className="flex items-center justify-between gap-3 rounded-lg border border-st-warning/40 bg-st-warning-bg/40 px-4 py-3 transition-colors hover:border-st-warning"
              >
                <span className="text-[0.875rem] font-medium text-fg">
                  {dashboard.data.myAttentionCount} high or critical case
                  {dashboard.data.myAttentionCount === 1 ? " is" : "s are"} assigned to you
                </span>
                <Badge tone="warning">Needs you</Badge>
              </Link>
            ) : null}

            <section
              aria-labelledby="signals-by-severity"
              className="rounded-lg border border-border bg-surface p-4"
            >
              <h2 id="signals-by-severity" className="text-[0.875rem] font-semibold text-fg">
                Signals by severity
              </h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {SEVERITIES.map((severity) => (
                  <li key={severity}>
                    <Link
                      href={`/audit/signals?severity=${severity}`}
                      className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 transition-colors hover:border-border-strong"
                    >
                      <Badge tone={RISK_SEVERITY_TONE[severity]}>
                        {RISK_SEVERITY_LABEL[severity]}
                      </Badge>
                      <span className="tnum text-[0.875rem] font-semibold text-fg">
                        {dashboard.data.signalsBySeverity[severity]}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            <section
              aria-labelledby="cases-by-state"
              className="rounded-lg border border-border bg-surface p-4"
            >
              <h2 id="cases-by-state" className="text-[0.875rem] font-semibold text-fg">
                Cases by state
              </h2>
              <p className="mt-1 text-[0.8125rem] text-fg-muted">
                Resolved, accepted risk and dismissed are three different endings and are
                counted separately, because they are the three different answers an auditor
                asks about.
              </p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {CASE_STATES.map((state) => (
                  <li key={state}>
                    <Link
                      href={`/audit/cases?state=${state}`}
                      className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 transition-colors hover:border-border-strong"
                    >
                      <Badge tone={RISK_CASE_STATE_TONE[state]}>
                        {RISK_CASE_STATE_LABEL[state]}
                      </Badge>
                      <span className="tnum text-[0.875rem] font-semibold text-fg">
                        {dashboard.data.casesByState[state]}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            <RulesPanel />
          </>
        ) : null}
      </Can>

      <SourcesPanel />
      <ExtensionPointsPanel />
    </div>
  );
}

function Stat({
  icon: Icon, label, value, detail, href, emphasis,
}: {
  icon: typeof ScrollText;
  label: string;
  value: number;
  detail: string;
  href: string;
  emphasis?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-lg border bg-surface px-4 py-3.5 transition-colors hover:border-border-strong",
        emphasis ? "border-st-warning/40" : "border-border",
      )}
    >
      <div className="flex items-center gap-2 text-fg-subtle">
        <Icon aria-hidden className="size-4" />
        <span className="text-[0.75rem] font-medium">{label}</span>
      </div>
      <p className="tnum mt-1.5 text-[1.5rem] leading-8 font-semibold text-fg">{value}</p>
      <p className="text-[0.75rem] text-fg-subtle">{detail}</p>
    </Link>
  );
}
