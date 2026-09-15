import {
  AlertOctagon, AlertTriangle, CheckCircle2, CircleSlash, MinusCircle,
  PauseCircle, type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  COMPLIANCE_SEVERITY, COMPLIANCE_STATUS, EVIDENCE_STATE,
} from "@/config/compliance";
import type {
  ComplianceEvidenceState, ComplianceSeverity, ComplianceStatus,
} from "@/types";
import { cn } from "@/lib/utils";

const STATUS_ICON: Record<ComplianceStatus, LucideIcon> = {
  compliant: CheckCircle2,
  action_required: AlertOctagon,
  expiring: AlertTriangle,
  expired: CircleSlash,
  suspended: PauseCircle,
  not_applicable: MinusCircle,
};

export function ComplianceStatusBadge({
  status, className,
}: {
  status: ComplianceStatus;
  className?: string;
}) {
  const meta = COMPLIANCE_STATUS[status];
  const Icon = STATUS_ICON[status];
  return (
    <Badge tone={meta.tone} className={className}>
      <Icon aria-hidden className="size-3" />
      {meta.label}
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: ComplianceSeverity }) {
  const meta = COMPLIANCE_SEVERITY[severity];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function EvidenceStateBadge({ state }: { state: ComplianceEvidenceState }) {
  const meta = EVIDENCE_STATE[state];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

const STATUS_BAR: Record<ComplianceStatus, string> = {
  compliant: "bg-st-success",
  action_required: "bg-st-danger",
  expiring: "bg-st-warning",
  expired: "bg-st-danger",
  suspended: "bg-st-neutral",
  not_applicable: "bg-border",
};

export function StatusBar({
  status, className,
}: {
  status: ComplianceStatus;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("w-1 shrink-0 rounded-full", STATUS_BAR[status], className)}
    />
  );
}
