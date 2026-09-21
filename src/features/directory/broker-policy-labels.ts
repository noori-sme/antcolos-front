import type {
  BrokerPolicyAction, BrokerPolicyEffect, BrokerPolicyReason, BrokerPolicyStatus,
} from "@/types";

/**
 * How a broker working policy READS.
 *
 * Kept here rather than in the type module for the same reason every other
 * label file in this codebase is: the vocabulary is shared, but how loudly a
 * screen says it is a screen's decision, and a domain type that carried a
 * Tailwind tone would be a domain type that knows what a badge looks like.
 */

export const ACTION_DESCRIPTION: Record<BrokerPolicyAction, string> = {
  hard_block:
    "Their freight is not offered for this organization's trucks, and it cannot be booked.",
  deprioritize:
    "Their freight stays on the board and ranks below everything else.",
  warning:
    "Their freight stays on the board, bookable, with a note attached.",
  temporary_safety_hold:
    "Stops their freight now and lifts by itself unless an owner approves it.",
};

export const REASON_DESCRIPTION: Record<BrokerPolicyReason, string> = {
  carrier_preference: "A preference. No allegation about the broker.",
  payment_experience: "How they actually paid this organization.",
  factoring_rejected: "A factor declined their paper for this carrier, on a date.",
  suspected_fraud: "Something about them does not add up.",
  identity_conflict: "Two records disagree about who this company is.",
  service_dispute: "Something went wrong on a load.",
  contract_restriction: "An agreement with somebody else forbids it.",
  other: "Something the categories above do not cover.",
};

export const STATUS_TONE: Record<
  BrokerPolicyStatus,
  "neutral" | "info" | "warning" | "danger" | "success" | "outline"
> = {
  proposed: "info",
  active: "danger",
  rejected: "neutral",
  expired: "neutral",
  revoked: "neutral",
};

export const ACTION_TONE: Record<
  BrokerPolicyAction,
  "neutral" | "info" | "warning" | "danger" | "outline"
> = {
  hard_block: "danger",
  temporary_safety_hold: "danger",
  deprioritize: "warning",
  warning: "warning",
};

export const EFFECT_TONE: Record<
  BrokerPolicyEffect,
  "neutral" | "info" | "warning" | "danger" | "success"
> = {
  none: "neutral",
  warning: "warning",
  deprioritize: "warning",
  blocked: "danger",
};

/** What the badge on a search result or an Opportunity says, in two words. */
export const EFFECT_LABEL: Record<BrokerPolicyEffect, string> = {
  none: "No policy",
  warning: "Broker warning",
  deprioritize: "Ranked down",
  blocked: "Broker blocked",
};

export function formatPolicyDate(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
}

export function formatPolicyDateTime(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

/** "in 6 hours", "in 3 days", or "already over". Never a bare timestamp. */
export function untilLabel(iso?: string): string {
  if (!iso) return "no expiry";
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return "already over";
  const hours = ms / 3_600_000;
  if (hours < 1) return `in ${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `in ${Math.round(hours)}h`;
  return `in ${Math.round(hours / 24)} days`;
}
