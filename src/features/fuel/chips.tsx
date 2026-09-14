import type {
  FuelTransactionFlag, FuelTransactionSource, FuelTransactionState,
  IftaPeriodState, MileageRecordFlag, MileageRecordState,
} from "@/types";
import {
  FUEL_FLAG_LABEL, FUEL_SOURCE_LABEL, FUEL_STATE_LABEL, IFTA_PERIOD_STATE_LABEL,
  MILEAGE_FLAG_LABEL, MILEAGE_STATE_LABEL,
} from "@/lib/fuel/labels";
import { cn } from "@/lib/utils";

const CHIP = "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium";

/**
 * Colour carries meaning here, so it is assigned once per vocabulary rather
 * than picked per screen: green is accepted, grey is history, amber wants a
 * person, red is excluded from every total.
 */
const FUEL_STATE_TONE: Record<FuelTransactionState, string> = {
  manual: "bg-st-neutral-bg text-st-neutral",
  imported: "bg-st-info-bg text-st-info",
  pending_review: "bg-st-warning-bg text-st-warning",
  verified: "bg-st-success-bg text-st-success",
  corrected: "bg-st-neutral-bg text-st-neutral",
  duplicate: "bg-st-danger-bg text-st-danger",
  rejected: "bg-st-danger-bg text-st-danger",
};

export function FuelStateChip({ state, className }: { state: FuelTransactionState; className?: string }) {
  return <span className={cn(CHIP, FUEL_STATE_TONE[state], className)}>{FUEL_STATE_LABEL[state]}</span>;
}

const MILEAGE_STATE_TONE: Record<MileageRecordState, string> = {
  manual: "bg-st-neutral-bg text-st-neutral",
  imported: "bg-st-info-bg text-st-info",
  pending_review: "bg-st-warning-bg text-st-warning",
  verified: "bg-st-success-bg text-st-success",
  corrected: "bg-st-neutral-bg text-st-neutral",
  rejected: "bg-st-danger-bg text-st-danger",
};

export function MileageStateChip({ state, className }: { state: MileageRecordState; className?: string }) {
  return <span className={cn(CHIP, MILEAGE_STATE_TONE[state], className)}>{MILEAGE_STATE_LABEL[state]}</span>;
}

const PERIOD_TONE: Record<IftaPeriodState, string> = {
  incomplete: "bg-st-neutral-bg text-st-neutral",
  needs_review: "bg-st-warning-bg text-st-warning",
  ready: "bg-st-success-bg text-st-success",
  filed: "bg-st-info-bg text-st-info",
  amended: "bg-st-progress-bg text-st-progress",
};

export function PeriodStateChip({ state, className }: { state: IftaPeriodState; className?: string }) {
  return <span className={cn(CHIP, PERIOD_TONE[state], className)}>{IFTA_PERIOD_STATE_LABEL[state]}</span>;
}

export function SourceChip({ source }: { source: FuelTransactionSource }) {
  return (
    <span className={cn(CHIP, "bg-surface-sunken text-fg-muted")}>{FUEL_SOURCE_LABEL[source]}</span>
  );
}

/** A flag is always amber: it is a request to look, never a verdict. */
export function FlagChip({ flag }: { flag: FuelTransactionFlag }) {
  return <span className={cn(CHIP, "bg-st-warning-bg text-st-warning")}>{FUEL_FLAG_LABEL[flag]}</span>;
}

export function MileageFlagChip({ flag }: { flag: MileageRecordFlag }) {
  return <span className={cn(CHIP, "bg-st-warning-bg text-st-warning")}>{MILEAGE_FLAG_LABEL[flag]}</span>;
}

/** Qualification is a fact about the purchase, not a state somebody set. */
export function QualifiesChip({ qualifies }: { qualifies: boolean }) {
  return (
    <span
      className={cn(
        CHIP,
        qualifies ? "bg-st-success-bg text-st-success" : "bg-surface-sunken text-fg-subtle",
      )}
    >
      {qualifies ? "Counts for IFTA" : "Does not count"}
    </span>
  );
}
