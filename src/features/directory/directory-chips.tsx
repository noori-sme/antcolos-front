import type {
  MatchConfidence, PartyRecordStatus, PartyRole, PartyStanding,
  PartyVerificationState,
} from "@/types";
import { cn } from "@/lib/utils";
import {
  CONFIDENCE_LABEL, PARTY_ROLE_LABEL, PARTY_STATUS_LABEL, STANDING_LABEL,
  VERIFICATION_LABEL,
} from "./directory-labels";

const CHIP = "shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium";

const ROLE_TONE: Record<PartyRole, string> = {
  broker: "bg-st-info-bg text-st-info",
  shipper: "bg-st-progress-bg text-st-progress",
  receiver: "bg-st-success-bg text-st-success",
};

export function RoleChip({ role, className }: { role: PartyRole; className?: string }) {
  return <span className={cn(CHIP, ROLE_TONE[role], className)}>{PARTY_ROLE_LABEL[role]}</span>;
}

const STATUS_TONE: Record<PartyRecordStatus, string> = {
  active: "bg-st-success-bg text-st-success",
  provisional: "bg-st-warning-bg text-st-warning",
  merged: "bg-st-neutral-bg text-st-neutral",
  archived: "bg-st-neutral-bg text-st-neutral",
};

export function PartyStatusChip({
  status,
  className,
}: {
  status: PartyRecordStatus;
  className?: string;
}) {
  // A confirmed profile is the unremarkable case, so it gets no chip at all —
  // a row of green "Confirmed" badges would bury the one that says otherwise.
  if (status === "active") return null;
  return <span className={cn(CHIP, STATUS_TONE[status], className)}>{PARTY_STATUS_LABEL[status]}</span>;
}

const STANDING_TONE: Record<PartyStanding, string> = {
  preferred: "bg-st-success-bg text-st-success",
  standard: "bg-st-neutral-bg text-st-neutral",
  watch: "bg-st-warning-bg text-st-warning",
  blocked: "bg-st-danger-bg text-st-danger",
};

export function StandingChip({
  standing,
  className,
  showStandard = false,
}: {
  standing: PartyStanding;
  className?: string;
  showStandard?: boolean;
}) {
  if (standing === "standard" && !showStandard) return null;
  return (
    <span className={cn(CHIP, STANDING_TONE[standing], className)}>
      {STANDING_LABEL[standing]}
    </span>
  );
}

const VERIFICATION_TONE: Record<PartyVerificationState, string> = {
  unverified: "bg-st-neutral-bg text-st-neutral",
  dispatcher_confirmed: "bg-st-info-bg text-st-info",
  externally_verified: "bg-st-success-bg text-st-success",
};

export function VerificationChip({
  state,
  className,
}: {
  state: PartyVerificationState;
  className?: string;
}) {
  return (
    <span className={cn(CHIP, VERIFICATION_TONE[state], className)}>
      {VERIFICATION_LABEL[state]}
    </span>
  );
}

/**
 * How sure the matcher is.
 *
 * "Identifier matched" is info-blue rather than green on purpose. Green reads
 * as done, and nothing here is done until a dispatcher says so — the colour
 * should not be quietly arguing with the confirmation step next to it.
 */
const CONFIDENCE_TONE: Record<MatchConfidence, string> = {
  exact: "bg-st-info-bg text-st-info",
  strong: "bg-st-progress-bg text-st-progress",
  possible: "bg-st-warning-bg text-st-warning",
  none: "bg-st-neutral-bg text-st-neutral",
};

export function ConfidenceChip({
  confidence,
  className,
}: {
  confidence: MatchConfidence;
  className?: string;
}) {
  return (
    <span className={cn(CHIP, CONFIDENCE_TONE[confidence], className)}>
      {CONFIDENCE_LABEL[confidence]}
    </span>
  );
}

/** This carrier's own rating. Never an average across carriers. */
export function RatingStars({ rating }: { rating?: number }) {
  if (!rating) return <span className="text-[0.75rem] text-fg-subtle">Not rated</span>;
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating} out of 5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span
          key={i}
          aria-hidden
          className={cn(
            "text-[0.8125rem] leading-none",
            i < rating ? "text-st-warning" : "text-border-strong",
          )}
        >
          ★
        </span>
      ))}
    </span>
  );
}
