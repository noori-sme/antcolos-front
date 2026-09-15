"use client";

import { useState } from "react";
import Link from "next/link";
import { Radar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { RISK_SIGNAL_KIND_DESCRIPTION } from "@/config/audit";
import { useActiveMembership } from "@/lib/session/hooks";
import {
  RISK_SIGNAL_KIND_LABEL, type RiskSeverity, type RiskSignal,
  type RiskSignalFilters, type RiskSignalStatus,
} from "@/types";
import { MockBadge, SeverityBadge, SignalStatusBadge } from "./chips";
import { DismissSignalDialog, OpenCaseDialog } from "./signal-actions";
import { formatDateTime } from "./format";
import { RulesNotice } from "./notices";
import { useRiskSignals } from "./use-audit";

const SEVERITIES: RiskSeverity[] = ["critical", "high", "medium", "low", "informational"];
const STATUSES: RiskSignalStatus[] = ["new", "linked", "dismissed"];
const STATUS_LABEL: Record<RiskSignalStatus, string> = {
  new: "Not looked at", linked: "In a case", dismissed: "Dismissed",
};

function toggle<T>(list: T[] | undefined, value: T): T[] | undefined {
  const current = list ?? [];
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  return next.length ? next : undefined;
}

/**
 * Signals — possible concerns, not findings.
 *
 * Every row says which mock rule spoke and what it rests on. Nothing on this
 * screen edits an audit event; dismissing a signal records a judgement beside
 * the record, and leaves the record alone.
 */
export function RiskSignalsScreen({ initialSeverity }: { initialSeverity?: RiskSeverity }) {
  const [filters, setFilters] = useState<RiskSignalFilters>(
    initialSeverity ? { severity: [initialSeverity] } : {},
  );
  const signals = useRiskSignals(filters);
  const { organization } = useActiveMembership();
  const timeZone = organization?.timeZone ?? "UTC";

  const count = (predicate: (s: RiskSignal) => boolean) =>
    (signals.data ?? []).filter(predicate).length;

  return (
    <div className="space-y-section">
      <PageHeader
        title="Risk signals"
        description="Things the mock rules flagged as possibly worth a look. A signal is not a finding."
      />

      <RulesNotice />

      <div className="space-y-3">
        <Input
          type="search"
          value={filters.search ?? ""}
          onChange={(e) => setFilters({ ...filters, search: e.target.value || undefined })}
          placeholder="Search signals…"
          aria-label="Search risk signals"
          className="sm:max-w-sm"
        />
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by severity">
          {SEVERITIES.map((severity) => (
            <Chip
              key={severity}
              label={severity[0].toUpperCase() + severity.slice(1)}
              count={count((s) => s.severity === severity)}
              selected={filters.severity?.includes(severity) ?? false}
              onToggle={() =>
                setFilters({ ...filters, severity: toggle(filters.severity, severity) })
              }
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by state">
          {STATUSES.map((status) => (
            <Chip
              key={status}
              label={STATUS_LABEL[status]}
              count={count((s) => s.status === status)}
              selected={filters.status?.includes(status) ?? false}
              onToggle={() => setFilters({ ...filters, status: toggle(filters.status, status) })}
            />
          ))}
        </div>
      </div>

      {signals.isLoading ? <LoadingSkeleton rows={5} /> : null}
      {signals.isError ? <ErrorState onRetry={() => signals.refetch()} /> : null}

      {signals.data ? (
        signals.data.length === 0 ? (
          <EmptyState
            icon={Radar}
            title="Nothing flagged"
            description="No mock rule has anything to say about what is in the ledger right now. That is what these rules can see — not a clean bill of health."
          />
        ) : (
          <ol className="space-y-2">
            {signals.data.map((signal) => (
              <li key={signal.id}>
                <SignalRow signal={signal} timeZone={timeZone} />
              </li>
            ))}
          </ol>
        )
      ) : null}
    </div>
  );
}

function SignalRow({ signal, timeZone }: { signal: RiskSignal; timeZone: string }) {
  const [dismissing, setDismissing] = useState(false);
  const [opening, setOpening] = useState(false);

  return (
    <article className="rounded-lg border border-border bg-surface px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={signal.severity} />
        <SignalStatusBadge status={signal.status} />
        <MockBadge />
        <span className="text-[0.75rem] text-fg-subtle">
          {RISK_SIGNAL_KIND_LABEL[signal.kind]}
        </span>
      </div>

      <h3 className="mt-1.5 text-[0.9375rem] font-semibold text-fg">{signal.title}</h3>
      <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">{signal.rationale}</p>
      <p className="mt-1 text-[0.75rem] leading-relaxed text-fg-subtle">
        {RISK_SIGNAL_KIND_DESCRIPTION[signal.kind]}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.75rem] text-fg-subtle">
        {signal.entity.href ? (
          <Link href={signal.entity.href} className="text-primary hover:underline">
            {signal.entity.label}
          </Link>
        ) : (
          <span>{signal.entity.label}</span>
        )}
        <span aria-hidden>·</span>
        <time dateTime={signal.detectedAt}>{formatDateTime(signal.detectedAt, timeZone)}</time>
        {signal.auditEventIds.length ? (
          <>
            <span aria-hidden>·</span>
            <Link
              href={`/audit/events?entity=${encodeURIComponent(signal.entity.id)}`}
              className="text-primary hover:underline"
            >
              {signal.auditEventIds.length} audit event
              {signal.auditEventIds.length === 1 ? "" : "s"} behind it
            </Link>
          </>
        ) : null}
      </div>

      {signal.status === "dismissed" ? (
        <p className="mt-2 rounded-md border border-dashed border-border bg-surface-sunken px-3 py-2 text-[0.75rem] leading-relaxed text-fg-muted">
          Dismissed by {signal.dismissedBy?.displayNameSnapshot ?? "somebody"}:{" "}
          {signal.dismissalReason}. The audit events behind it were not changed.
        </p>
      ) : null}

      {signal.caseId ? (
        <Link
          href={`/audit/cases/${signal.caseId}`}
          className="mt-2 inline-block text-[0.8125rem] text-primary hover:underline"
        >
          Open the case
        </Link>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setOpening(true)}>
            Open a case
          </Button>
          {signal.status !== "dismissed" ? (
            <Button variant="ghost" size="sm" onClick={() => setDismissing(true)}>
              Not a concern
            </Button>
          ) : null}
        </div>
      )}

      {opening ? <OpenCaseDialog signal={signal} onClose={() => setOpening(false)} /> : null}
      {dismissing ? (
        <DismissSignalDialog signal={signal} onClose={() => setDismissing(false)} />
      ) : null}
    </article>
  );
}
