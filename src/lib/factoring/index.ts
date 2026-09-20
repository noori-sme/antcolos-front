import type {
  FactoringCheckPolicy, FactoringDecision, FactoringFilterKey,
  FactoringStatusView, FactoringVisibility,
} from "@/types";
import { isFactoringApproved } from "@/types";

/**
 * The pure rules a screen and a service both have to agree about.
 *
 * Nothing here reads a store, takes a context or writes anything: it is the
 * arithmetic of "does this row match the filter" and "what does this carrier's
 * policy do with this answer". Kept out of the mock on purpose, so the Load
 * Search filter and whatever ranks the results cannot drift apart, and so the
 * whole set is testable without a world behind it.
 */

/* -------------------------------------------------------------------------- */
/* The Load Search filter                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Does this row belong under this filter?
 *
 * ★ "NOT CHECKED" AND "PENDING/UNKNOWN" ARE NOT THE SAME FILTER ★
 * A load nobody has asked about and a load somebody asked about an hour ago
 * that has not come back are two different piles of work: the first needs a
 * check started, the second needs chasing. Collapsing them would make the
 * second pile invisible inside the first.
 *
 * `not_connected` and `provider_unavailable` deliberately match only "Show
 * all". Neither is a fact about the broker, so putting them under "Rejected" or
 * "Pending" would file an Antcolos problem in the broker's column.
 */
export function matchesFactoringFilter(
  view: FactoringStatusView | undefined,
  filter: FactoringFilterKey,
): boolean {
  if (filter === "all") return true;
  // A row with no factoring view at all — a listing with no broker MC, say —
  // is only ever "not checked". It is never quietly counted as approved.
  const decision: FactoringDecision = view?.decision ?? "unknown";
  const everChecked = view?.everChecked ?? false;

  switch (filter) {
    case "approved":
      return isFactoringApproved(decision);
    case "approved_conditional":
      return isFactoringApproved(decision) || decision === "conditional";
    case "rejected":
      return decision === "rejected";
    case "pending_unknown":
      // "Unknown" here means asked-and-unanswerable, which is why a row nobody
      // has ever asked about is excluded: it belongs under "Not checked".
      return decision === "pending" || (decision === "unknown" && everChecked);
    case "stale":
      return decision === "stale";
    case "not_checked":
      return !everChecked;
    default:
      return true;
  }
}

/* -------------------------------------------------------------------------- */
/* Policy                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * What the carrier's policy says to do with a row carrying this answer.
 *
 * Only three decisions have a policy at all — rejected, unknown and stale.
 * Everything else shows normally, including `not_connected` and
 * `provider_unavailable`: a carrier that has not connected a factor does not
 * thereby want its whole load search hidden.
 */
export function visibilityFor(
  decision: FactoringDecision,
  policy: Pick<FactoringCheckPolicy, "rejected" | "unknown" | "stale">,
): FactoringVisibility {
  if (decision === "rejected") return policy.rejected;
  if (decision === "stale") return policy.stale;
  if (decision === "unknown") return policy.unknown;
  return "show";
}

/** True when the carrier's policy says not to show this row at all. */
export function hiddenByPolicy(
  view: FactoringStatusView | undefined,
  policy: Pick<FactoringCheckPolicy, "rejected" | "unknown" | "stale">,
): boolean {
  if (!view) return false;
  return visibilityFor(view.decision, policy) === "hide";
}

/** True when the row may be shown but must never reach the short list. */
export function deprioritizedByPolicy(
  view: FactoringStatusView | undefined,
  policy: Pick<FactoringCheckPolicy, "rejected" | "unknown" | "stale">,
): boolean {
  if (!view) return false;
  return visibilityFor(view.decision, policy) === "deprioritize";
}

/* -------------------------------------------------------------------------- */
/* What a driver may be told                                                   */
/* -------------------------------------------------------------------------- */

/**
 * What an opportunity sent to a driver is allowed to claim.
 *
 * ★ A DRIVER IS NEVER TOLD A LOAD IS FACTORING-APPROVED WHEN IT IS NOT ★
 * The label is derived from the answer in force, not from the fact that
 * somebody sent it. An unchecked opportunity says booking still needs approval,
 * which is the truth and is also the thing that gets a dispatcher to go and
 * check it.
 */
export interface DriverFactoringLabel {
  /** True when the carrier's policy allows sending this at all. */
  mayShareWithDriver: boolean;
  /** The sentence the opportunity carries. Never "approved" unless it is. */
  label: string;
}

export function driverFactoringLabel(
  view: FactoringStatusView | undefined,
  policy: Pick<
    FactoringCheckPolicy, "requireApprovalToBook" | "allowDriverReviewBeforeApproval" | "conditionalMayBook"
  >,
): DriverFactoringLabel {
  const decision: FactoringDecision = view?.decision ?? "unknown";

  if (!policy.requireApprovalToBook) {
    return { mayShareWithDriver: true, label: "Driver review" };
  }

  if (isFactoringApproved(decision)) {
    return { mayShareWithDriver: true, label: "Factoring approved" };
  }

  if (decision === "conditional" && policy.conditionalMayBook) {
    return {
      mayShareWithDriver: true,
      label: "Factoring approved with conditions",
    };
  }

  return {
    mayShareWithDriver: policy.allowDriverReviewBeforeApproval,
    label: policy.allowDriverReviewBeforeApproval
      ? "Driver review allowed · Booking requires factoring approval"
      : "Booking requires factoring approval",
  };
}
