"use client";

import { Lock, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  AUDIT_OUTCOME_TONE, AUDIT_SOURCE_TONE, RISK_CASE_STATE_TONE,
  RISK_SEVERITY_TONE, RISK_SIGNAL_STATUS_LABEL, RISK_SIGNAL_STATUS_TONE,
} from "@/config/audit";
import {
  AUDIT_OUTCOME_LABEL, AUDIT_SOURCE_LABEL, AUDIT_SOURCE_DESCRIPTION,
} from "@/lib/audit/actions";
import {
  RISK_CASE_STATE_LABEL, RISK_SEVERITY_LABEL,
  type AuditEventSource, type AuditOutcome, type RiskCaseState,
  type RiskSeverity, type RiskSignalStatus,
} from "@/types";

export function SeverityBadge({ severity }: { severity: RiskSeverity }) {
  return <Badge tone={RISK_SEVERITY_TONE[severity]}>{RISK_SEVERITY_LABEL[severity]}</Badge>;
}

export function CaseStateBadge({ state }: { state: RiskCaseState }) {
  return <Badge tone={RISK_CASE_STATE_TONE[state]}>{RISK_CASE_STATE_LABEL[state]}</Badge>;
}

export function SignalStatusBadge({ status }: { status: RiskSignalStatus }) {
  return (
    <Badge tone={RISK_SIGNAL_STATUS_TONE[status]}>{RISK_SIGNAL_STATUS_LABEL[status]}</Badge>
  );
}

/**
 * The source badge carries a title, because `inferred` is the one value on this
 * screen that must never be read as an observation.
 */
export function SourceBadge({ source }: { source: AuditEventSource }) {
  return (
    <Badge tone={AUDIT_SOURCE_TONE[source]} title={AUDIT_SOURCE_DESCRIPTION[source]}>
      {AUDIT_SOURCE_LABEL[source]}
    </Badge>
  );
}

/** A success needs no badge; a refusal does. */
export function OutcomeBadge({ outcome }: { outcome: AuditOutcome }) {
  if (outcome === "succeeded") return null;
  return (
    <Badge tone={AUDIT_OUTCOME_TONE[outcome]}>
      <TriangleAlert aria-hidden className="size-3" />
      {AUDIT_OUTCOME_LABEL[outcome]}
    </Badge>
  );
}

export function AppendOnlyMark() {
  return (
    <span className="inline-flex items-center gap-1 text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase">
      <Lock aria-hidden className="size-3" />
      Append-only
    </span>
  );
}

/**
 * The label every mock rule and mock adapter carries.
 *
 * Not a footnote at the bottom of the page: it sits next to the thing it is
 * about, because somebody scanning a list of signals will not scroll.
 */
export function MockBadge({ label = "Mock rule" }: { label?: string }) {
  return <Badge tone="outline">{label}</Badge>;
}
