import { BadgeCheck, CircleHelp, Clock, ShieldAlert, TriangleAlert } from "lucide-react";
import type {
  AuthorityStatus, BrokerIdentityState, MatchConfidence, PartyClaimState,
  PartyRecordStatus, PartyRole, PartyStanding, PartyVerificationState,
} from "@/types";
import { cn } from "@/lib/utils";
import {
  AUTHORITY_DESCRIPTION, AUTHORITY_LABEL, CLAIM_DESCRIPTION, CLAIM_LABEL,
  CONFIDENCE_LABEL, IDENTITY_DESCRIPTION, IDENTITY_LABEL, PARTY_ROLE_LABEL,
  PARTY_STATUS_LABEL, STANDING_LABEL, VERIFICATION_LABEL,
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

const CLAIM_TONE: Record<PartyClaimState, string> = {
  unclaimed: "bg-st-neutral-bg text-st-neutral",
  claim_pending: "bg-st-warning-bg text-st-warning",
  claimed: "bg-st-success-bg text-st-success",
};

/**
 * Whether the company behind this profile has claimed it.
 *
 * Neutral-toned on purpose. Unclaimed is not a problem to be fixed — it is the
 * ordinary state of a broker who has never heard of Antcolos — and colouring it
 * amber would tell dispatchers to distrust perfectly good register data.
 */
export function ClaimChip({
  state,
  className,
  showUnclaimed = false,
}: {
  state: PartyClaimState;
  className?: string;
  showUnclaimed?: boolean;
}) {
  if (state === "unclaimed" && !showUnclaimed) return null;
  return (
    <span className={cn(CHIP, CLAIM_TONE[state], className)} title={CLAIM_DESCRIPTION[state]}>
      {CLAIM_LABEL[state]}
    </span>
  );
}

const IDENTITY_TONE: Record<BrokerIdentityState, string> = {
  verified: "bg-st-success-bg text-st-success",
  pending: "bg-st-neutral-bg text-st-neutral",
  conflicted: "bg-st-danger-bg text-st-danger",
};

const IDENTITY_ICON = {
  verified: BadgeCheck,
  pending: Clock,
  conflicted: TriangleAlert,
} as const;

/**
 * What FMCSA said about who this company is.
 *
 * The axis people most want to collapse into "verified", and the reason this
 * chip exists separately from `ClaimChip`: a profile is routinely
 * "FMCSA verified" and "Unclaimed" at the same time, and both chips render
 * side by side rather than fighting over one word.
 */
export function IdentityChip({
  state,
  className,
}: {
  state: BrokerIdentityState;
  className?: string;
}) {
  const Icon = IDENTITY_ICON[state];
  return (
    <span
      className={cn(CHIP, "inline-flex items-center gap-1", IDENTITY_TONE[state], className)}
      title={IDENTITY_DESCRIPTION[state]}
    >
      <Icon aria-hidden className="size-3" />
      {IDENTITY_LABEL[state]}
    </span>
  );
}

const AUTHORITY_TONE: Record<AuthorityStatus, string> = {
  active: "bg-st-success-bg text-st-success",
  inactive: "bg-st-warning-bg text-st-warning",
  revoked: "bg-st-danger-bg text-st-danger",
  unknown: "bg-st-neutral-bg text-st-neutral",
};

/**
 * Whether they may broker freight today.
 *
 * Hidden when `active`, like every other "nothing to see here" chip in this
 * file: a row of green authority badges would bury the revoked one, which is
 * the only one anybody needs to act on.
 */
export function AuthorityChip({
  status,
  className,
  showActive = false,
}: {
  status: AuthorityStatus;
  className?: string;
  showActive?: boolean;
}) {
  if (status === "active" && !showActive) return null;
  const Icon = status === "unknown" ? CircleHelp : ShieldAlert;
  return (
    <span
      className={cn(CHIP, "inline-flex items-center gap-1", AUTHORITY_TONE[status], className)}
      title={AUTHORITY_DESCRIPTION[status]}
    >
      <Icon aria-hidden className="size-3" />
      {AUTHORITY_LABEL[status]}
    </span>
  );
}
