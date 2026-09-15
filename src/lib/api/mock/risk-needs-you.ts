import type { NeedsYouItem, RiskCase, RiskSeverity } from "@/types";
import { RISK_CASE_OPEN_STATES } from "@/types";
import { RISK_CASE_STATE_LABEL } from "@/types";
import type { ServiceContext } from "../contracts/context";
import { riskStore } from "./risk-store";

/**
 * Risk cases in the Needs You queue.
 *
 * DERIVED from the cases themselves on every read, like the fleet, maintenance,
 * insurance and settlement items before them. Nothing is seeded, and an item
 * stops existing the moment the case it is about is closed — which is the only
 * honest way to close it. Snoozing an item would hide the row without moving
 * the case, so these are `derived` and the queue refuses to act on them: the
 * case screen is where a case is worked.
 *
 * Only HIGH and CRITICAL cases that somebody has been made responsible for
 * reach the queue. An unassigned case is a queue problem for the risk screen,
 * not a personal to-do for whoever happens to open Home.
 */

const ID_PREFIX = "ny_risk_";

export function isRiskNeedsYouId(id: string): boolean {
  return id.startsWith(ID_PREFIX);
}

const SEVERITY_MAP: Partial<Record<RiskSeverity, NeedsYouItem["severity"]>> = {
  critical: "critical",
  high: "high",
};

function itemFor(riskCase: RiskCase, now: number): NeedsYouItem | null {
  if (!RISK_CASE_OPEN_STATES.includes(riskCase.state)) return null;
  if (!riskCase.assigneeMembershipId) return null;
  const severity = SEVERITY_MAP[riskCase.severity];
  if (!severity) return null;

  const overdue = Boolean(riskCase.dueAt && new Date(riskCase.dueAt).getTime() < now);
  const category = overdue
    ? "risk_case_overdue"
    : riskCase.severity === "critical"
      ? "risk_case_critical"
      : "risk_case_assigned";

  return {
    id: `${ID_PREFIX}${riskCase.id}`,
    organizationId: riskCase.organizationId,
    category,
    severity,
    status: riskCase.state === "escalated" ? "escalated" : "open",
    title: `${riskCase.reference} — ${riskCase.title}`,
    reason: overdue
      ? `This ${riskCase.severity} case passed its due date and is still ${RISK_CASE_STATE_LABEL[riskCase.state].toLowerCase()}.`
      : `A ${riskCase.severity} risk case is open and assigned to ${riskCase.assigneeName ?? "a member of this organization"}.`,
    detail: riskCase.summary,
    entity: {
      kind: "risk_case",
      id: riskCase.id,
      label: `${riskCase.reference} — ${riskCase.title}`,
      href: `/audit/cases/${riskCase.id}`,
    },
    recommendedAction: {
      kind: "investigate_risk",
      label: "Open the case",
      requires: ["risk:view"],
    },
    dueAt: riskCase.dueAt,
    assigneeMembershipId: riskCase.assigneeMembershipId,
    source: "system",
    requires: ["risk:view"],
    // Computed from the case. It clears when the case is closed, and never
    // because somebody tidied the queue.
    derived: true,
    createdAt: riskCase.openedAt,
    history: [],
  };
}

export function riskNeedsYouItems(ctx: ServiceContext): NeedsYouItem[] {
  if (!ctx.permissions.has("risk:view")) return [];
  const now = Date.now();
  return riskStore
    .cases(ctx.organizationId)
    .map((c) => itemFor(c, now))
    .filter((item): item is NeedsYouItem => item !== null);
}

/**
 * The message the queue gives when somebody tries to snooze or resolve one.
 *
 * Deliberately not a permission error: nothing is forbidden, there is simply
 * nothing here to write to. The case is the record.
 */
export const RISK_ITEM_IS_DERIVED_MESSAGE =
  "This is worked out from the risk case itself. Open the case and work it there — the item clears when the case is closed.";
