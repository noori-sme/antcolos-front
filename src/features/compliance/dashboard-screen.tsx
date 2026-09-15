"use client";

import {
  AlertOctagon, Archive, CalendarClock, Info, ShieldCheck,
} from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { COMPLIANCE_STATUS, COMPLIANCE_SUBJECT_PLURAL } from "@/config/compliance";
import { useActiveMembership } from "@/lib/session/hooks";
import type { ComplianceFilters, ComplianceStatus } from "@/types";
import { cn } from "@/lib/utils";
import { ComplianceFilterBar } from "./filter-bar";
import { ExtensionPointsPanel } from "./extension-points";
import { SharingPanel } from "./sharing-panel";
import { SubjectGroup } from "./subject-group";
import {
  useComplianceGroups, useComplianceList, useComplianceSummary,
} from "./use-compliance";

const DEFAULT_FILTERS: ComplianceFilters = { responsibility: "all" };

function StatTile({
  label, value, tone = "default", hint,
}: {
  label: string;
  value: number;
  tone?: "default" | "danger" | "warning" | "success" | "muted";
  hint?: string;
}) {
  const valueClass = {
    default: "text-fg",
    danger: "text-st-danger",
    warning: "text-st-warning",
    success: "text-st-success",
    muted: "text-fg-subtle",
  }[tone];
  return (
    <Card>
      <CardContent className="pt-4">
        <span className="block text-[0.8125rem] font-medium text-fg-muted">{label}</span>
        <span
          className={cn(
            "tnum mt-1 block text-[1.5rem] leading-8 font-semibold tracking-[-0.02em]",
            valueClass,
          )}
        >
          {value}
        </span>
        <span className="mt-0.5 block min-h-4 text-[0.75rem] text-fg-subtle">{hint}</span>
      </CardContent>
    </Card>
  );
}

const TILE_TONE: Record<ComplianceStatus, "danger" | "warning" | "success" | "muted"> = {
  expired: "danger",
  action_required: "danger",
  expiring: "warning",
  compliant: "success",
  suspended: "muted",
  not_applicable: "muted",
};

const TILE_ORDER: ComplianceStatus[] = [
  "action_required", "expiring", "expired", "compliant", "suspended", "not_applicable",
];

/**
 * Safety & Compliance.
 *
 * One organization's obligations about its own record, its drivers and its
 * equipment — as requirements in their own right, separate from the documents
 * that may satisfy them. What appears here is decided by the service layer:
 * permissions, relationship scope, responsibility scope and, for a dispatch
 * organization, the shares a carrier explicitly granted.
 */
export function ComplianceDashboardScreen() {
  const [filters, setFilters] = useState<ComplianceFilters>(DEFAULT_FILTERS);
  const { organization, membership, isDriverMembership } = useActiveMembership();

  const summary = useComplianceSummary();
  // Unfiltered, so the chip counts stay still while you filter.
  const all = useComplianceList({
    responsibility: "all", includeNotApplicable: true, includeFrozen: true,
  });
  const groups = useComplianceGroups(filters);

  const rows = useMemo(() => groups.data ?? [], [groups.data]);
  const counts = summary.data?.counts;

  const isDispatchOrganization = organization?.type === "DISPATCH_AGENCY";

  return (
    <div className="space-y-section">
      <PageHeader
        title="Safety & Compliance"
        description={
          isDriverMembership
            ? "What you owe this carrier, and when each of it is due."
            : "Every requirement this organization is answerable for, and what satisfies it."
        }
        actions={
          summary.data ? (
            <div className="flex items-center gap-2">
              {summary.data.criticalOpen > 0 ? (
                <Badge tone="danger">
                  <AlertOctagon aria-hidden className="size-3" />
                  {summary.data.criticalOpen} critical
                </Badge>
              ) : null}
              <Badge tone="outline">
                <CalendarClock aria-hidden className="size-3" />
                {summary.data.dueWithin30Days} due in 30 days
              </Badge>
            </div>
          ) : null
        }
      />

      {/*
        The honesty line. It is not a disclaimer tucked into a footer: what the
        product does and does not know is part of reading any number below it.
      */}
      <p className="flex items-start gap-2 rounded-lg border border-border bg-surface-sunken px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-fg-muted">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
        <span>
          Every date here was recorded in Antcolos or read from a document somebody
          uploaded. Antcolos is <strong className="font-semibold text-fg">not connected</strong> to
          FMCSA, the Drug &amp; Alcohol Clearinghouse, any state agency, any insurance
          provider, any ELD or any monitoring service, and nothing on this page has
          been checked with any of them.
        </span>
      </p>

      {counts ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {TILE_ORDER.map((status) => (
            <StatTile
              key={status}
              label={COMPLIANCE_STATUS[status].label}
              value={counts[status]}
              tone={TILE_TONE[status]}
              hint={
                status === "not_applicable"
                  ? "Explained, not hidden"
                  : status === "suspended"
                    ? "Paused deliberately"
                    : undefined
              }
            />
          ))}
        </div>
      ) : null}

      {summary.data && summary.data.frozenRecords > 0 ? (
        <p className="flex items-center gap-2 text-[0.8125rem] text-fg-subtle">
          <Archive aria-hidden className="size-4" />
          {summary.data.frozenRecords} record
          {summary.data.frozenRecords === 1 ? "" : "s"} from relationships that have ended are
          kept as history. They are never actionable and never counted above.
        </p>
      ) : null}

      {isDispatchOrganization ? (
        <p className="rounded-lg border border-st-info/35 bg-st-info-bg/40 px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-fg-muted">
          You are working inside a dispatch organization. Beyond your own paperwork you
          see only the compliance a carrier has explicitly shared with you, for the
          units you book — never their insurance file and never their drivers&apos;
          records.
        </p>
      ) : null}

      <ComplianceFilterBar filters={filters} onChange={setFilters} all={all.data ?? []} />

      {groups.isPending ? (
        <LoadingSkeleton rows={6} />
      ) : groups.isError ? (
        <ErrorState
          title="Could not load compliance"
          description={groups.error.message}
          onRetry={() => groups.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={
            (all.data ?? []).length === 0
              ? "Nothing is tracked here yet"
              : "Nothing matches these filters"
          }
          description={
            (all.data ?? []).length === 0
              ? "Requirements appear as soon as this organization has a driver, a truck or a trailer to be answerable for."
              : "Clear a filter to widen the list."
          }
        />
      ) : (
        <div className="space-y-4">
          {rows.map((group) => (
            <SubjectGroup key={group.subject.id} group={group} />
          ))}
        </div>
      )}

      {membership?.scope.loads === "assigned" ? (
        <p className="text-[0.75rem] text-fg-subtle">
          Showing only the compliance about you. Your carrier&apos;s equipment and
          organization records are not yours to see.
        </p>
      ) : null}

      <SharingPanel />
      <ExtensionPointsPanel />

      <p className="text-[0.75rem] leading-relaxed text-fg-subtle">
        Grouped by {COMPLIANCE_SUBJECT_PLURAL.driver.toLowerCase()}, trucks, trailers and
        the organization itself. A requirement and the document that satisfies it are
        separate records: replacing, rejecting or removing a document changes what this
        page says, and never removes the requirement.
      </p>
    </div>
  );
}
