import type {
  DefectSeverity, DefectState, EquipmentAvailabilityImpact, MaintenanceCriticality,
  MaintenanceState, MaintenanceTriggerKind, RepairOrderStatus,
} from "@/types";
import {
  AVAILABILITY_IMPACT_LABEL, CRITICALITY_LABEL, DEFECT_SEVERITY_LABEL,
  DEFECT_STATE_LABEL, MAINTENANCE_STATE_LABEL, REPAIR_ORDER_STATUS_LABEL,
  TRIGGER_KIND_LABEL,
} from "@/lib/maintenance/labels";
import { cn } from "@/lib/utils";

const CHIP = "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[0.6875rem] font-medium";

const STATE_TONE: Record<MaintenanceState, string> = {
  upcoming: "bg-st-neutral-bg text-st-neutral",
  due_soon: "bg-st-warning-bg text-st-warning",
  overdue: "bg-st-danger-bg text-st-danger",
  in_service: "bg-st-progress-bg text-st-progress",
  completed: "bg-st-success-bg text-st-success",
  deferred: "bg-st-info-bg text-st-info",
};

export function MaintenanceStateChip({
  state, className,
}: { state: MaintenanceState; className?: string }) {
  return <span className={cn(CHIP, STATE_TONE[state], className)}>{MAINTENANCE_STATE_LABEL[state]}</span>;
}

const SEVERITY_TONE: Record<DefectSeverity, string> = {
  minor: "bg-st-neutral-bg text-st-neutral",
  major: "bg-st-warning-bg text-st-warning",
  critical: "bg-st-danger-bg text-st-danger",
  out_of_service: "bg-st-danger text-white",
};

export function DefectSeverityChip({
  severity, className,
}: { severity: DefectSeverity; className?: string }) {
  return (
    <span className={cn(CHIP, SEVERITY_TONE[severity], className)}>
      {DEFECT_SEVERITY_LABEL[severity]}
    </span>
  );
}

const DEFECT_STATE_TONE: Record<DefectState, string> = {
  reported: "bg-st-warning-bg text-st-warning",
  acknowledged: "bg-st-info-bg text-st-info",
  in_repair: "bg-st-progress-bg text-st-progress",
  resolved: "bg-st-success-bg text-st-success",
  dismissed: "bg-st-neutral-bg text-st-neutral",
};

export function DefectStateChip({
  state, className,
}: { state: DefectState; className?: string }) {
  return <span className={cn(CHIP, DEFECT_STATE_TONE[state], className)}>{DEFECT_STATE_LABEL[state]}</span>;
}

const IMPACT_TONE: Record<EquipmentAvailabilityImpact, string> = {
  none: "bg-st-success-bg text-st-success",
  reduced: "bg-st-warning-bg text-st-warning",
  out_of_service: "bg-st-danger-bg text-st-danger",
};

export function AvailabilityImpactChip({
  impact, className,
}: { impact: EquipmentAvailabilityImpact; className?: string }) {
  return (
    <span className={cn(CHIP, IMPACT_TONE[impact], className)}>
      {AVAILABILITY_IMPACT_LABEL[impact]}
    </span>
  );
}

const RO_TONE: Record<RepairOrderStatus, string> = {
  draft: "bg-st-neutral-bg text-st-neutral",
  open: "bg-st-info-bg text-st-info",
  scheduled: "bg-st-info-bg text-st-info",
  in_progress: "bg-st-progress-bg text-st-progress",
  awaiting_parts: "bg-st-warning-bg text-st-warning",
  completed: "bg-st-success-bg text-st-success",
  cancelled: "bg-st-neutral-bg text-st-neutral",
};

export function RepairOrderStatusChip({
  status, className,
}: { status: RepairOrderStatus; className?: string }) {
  return <span className={cn(CHIP, RO_TONE[status], className)}>{REPAIR_ORDER_STATUS_LABEL[status]}</span>;
}

const CRITICALITY_TONE: Record<MaintenanceCriticality, string> = {
  routine: "bg-st-neutral-bg text-st-neutral",
  important: "bg-st-warning-bg text-st-warning",
  safety_critical: "bg-st-danger-bg text-st-danger",
};

export function CriticalityChip({
  criticality, className,
}: { criticality: MaintenanceCriticality; className?: string }) {
  return (
    <span className={cn(CHIP, CRITICALITY_TONE[criticality], className)}>
      {CRITICALITY_LABEL[criticality]}
    </span>
  );
}

/** The trigger kind, so a row says what is actually driving its due date. */
export function TriggerChip({
  kind, className,
}: { kind: MaintenanceTriggerKind; className?: string }) {
  return (
    <span className={cn(CHIP, "border border-border bg-transparent text-fg-subtle", className)}>
      {TRIGGER_KIND_LABEL[kind]}
    </span>
  );
}

/** Shown wherever a figure rests on a meter reading that is out of date. */
export function StaleMeterChip({ className }: { className?: string }) {
  return (
    <span className={cn(CHIP, "bg-st-warning-bg text-st-warning", className)}>
      Reading out of date
    </span>
  );
}
