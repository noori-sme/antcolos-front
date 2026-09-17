import { Badge } from "@/components/ui/badge";
import {
  ONBOARDING_STEP_STATUS_LABEL, RETENTION_STATE_LABEL,
  WORKFORCE_CLASSIFICATION_LABEL, WORKFORCE_STATE_LABEL,
  type OnboardingStepStatus, type QualificationRetentionState,
  type WorkforceClassification, type WorkforceEngagementState,
} from "@/types";

/**
 * The one place a workforce state is turned into a colour.
 *
 * `waived` is deliberately NOT the success tone. It is a decision somebody
 * made to go ahead anyway, and a green tick beside it would tell the next
 * reader that the module which owns the step had agreed — which is the exact
 * confusion the five-status checklist exists to prevent.
 */
const STATE_TONE: Record<WorkforceEngagementState, "success" | "info" | "warning" | "neutral" | "danger"> = {
  prospective: "info",
  onboarding: "progress" as never,
  active: "success",
  suspended: "warning",
  ended: "neutral",
  rejected: "neutral",
  withdrawn: "neutral",
};

export function EngagementStateChip({ state }: { state: WorkforceEngagementState }) {
  return <Badge tone={STATE_TONE[state]}>{WORKFORCE_STATE_LABEL[state]}</Badge>;
}

export function ClassificationChip({ value }: { value: WorkforceClassification }) {
  return <Badge tone="outline">{WORKFORCE_CLASSIFICATION_LABEL[value]}</Badge>;
}

const STEP_TONE: Record<OnboardingStepStatus, "success" | "info" | "warning" | "neutral" | "danger"> = {
  completed: "success",
  awaiting_other_domain: "info",
  blocked: "danger",
  // Not success. See above.
  waived: "warning",
  not_applicable: "neutral",
};

export function StepStatusChip({ status }: { status: OnboardingStepStatus }) {
  return <Badge tone={STEP_TONE[status]}>{ONBOARDING_STEP_STATUS_LABEL[status]}</Badge>;
}

const RETENTION_TONE: Record<QualificationRetentionState, "success" | "info" | "warning" | "neutral"> = {
  active: "success",
  superseded_retained: "neutral",
  relationship_ended_retained: "info",
  eligible_for_disposal: "warning",
  disposed: "neutral",
};

export function RetentionStateChip({ state }: { state: QualificationRetentionState }) {
  return <Badge tone={RETENTION_TONE[state]}>{RETENTION_STATE_LABEL[state]}</Badge>;
}
