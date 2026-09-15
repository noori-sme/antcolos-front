import type {
  Settlement,
  SettlementAttentionItem,
  SettlementAttentionKind,
} from "@/types";
import { money } from "@/lib/utils/format";
import { blockingDataGaps } from "./calculate";
import { canBeOverdue } from "./status";

/**
 * Real Needs You items, derived from settlement state.
 *
 * Nothing here is hand-written or seeded. Every item is computed from the
 * settlement in front of it, which means an item cannot go stale: fix the data,
 * approve the settlement or record the payment, and the item stops being
 * produced on the next read. There is no "resolve" that merely hides a row
 * while the underlying problem stays.
 */

const MS_PER_DAY = 86_400_000;

export function daysOverdue(dueAt: string, now: number): number {
  return Math.max(0, Math.floor((now - new Date(dueAt).getTime()) / MS_PER_DAY));
}

/** Overdue money gets louder the longer it sits. */
function overdueSeverity(days: number): SettlementAttentionItem["severity"] {
  if (days >= 14) return "critical";
  if (days >= 7) return "high";
  return "medium";
}

function item(
  settlement: Settlement,
  kind: SettlementAttentionKind,
  fields: Omit<
    SettlementAttentionItem,
    "id" | "kind" | "settlementId" | "settlementNumber" | "carrierOrganizationId" | "payee" | "createdAt"
  >,
): SettlementAttentionItem {
  return {
    id: `${settlement.id}:${kind}`,
    kind,
    settlementId: settlement.id,
    settlementNumber: settlement.number,
    carrierOrganizationId: settlement.carrierOrganizationId,
    payee: settlement.payee,
    createdAt: settlement.updatedAt,
    ...fields,
  };
}

/**
 * What this settlement needs from a human right now.
 *
 * A settlement can raise more than one: one that is missing a POD and has an
 * open dispute is two separate pieces of work for two different people.
 */
export function attentionItemsFor(
  settlement: Settlement,
  now: number = Date.now(),
): SettlementAttentionItem[] {
  const items: SettlementAttentionItem[] = [];

  if (settlement.status === "voided") return items;

  // --- Missing data ---------------------------------------------------------
  const gaps = blockingDataGaps(settlement.loadLines);
  if (gaps.length > 0) {
    items.push(
      item(settlement, "missing_data", {
        severity: "high",
        title: `${settlement.number} cannot be approved yet`,
        reason:
          gaps.length === 1
            ? gaps[0].summary
            : `${gaps.length} things are missing before this settlement can be approved. ${gaps[0].summary}`,
        amountCents: settlement.totals.netPayCents,
        requires: ["settlements:view"],
      }),
    );
  }

  // --- Awaiting approval ----------------------------------------------------
  if (settlement.status === "needs_review" && gaps.length === 0) {
    items.push(
      item(settlement, "awaiting_approval", {
        severity: "medium",
        title: `${settlement.number} is ready for sign-off`,
        reason: `${settlement.payee.displayNameSnapshot} is owed ${money(
          settlement.totals.netPayCents,
        )} for ${settlement.period.label}. Nothing is missing.`,
        amountCents: settlement.totals.netPayCents,
        requires: ["settlements:approve"],
      }),
    );
  }

  // --- Open disputes --------------------------------------------------------
  const open = settlement.disputes.filter(
    (d) => d.status === "open" || d.status === "under_review",
  );
  if (open.length > 0) {
    const first = open[0];
    items.push(
      item(settlement, "open_dispute", {
        severity: "high",
        title: `${settlement.payee.displayNameSnapshot} disputes ${settlement.number}`,
        reason: first.summary,
        amountCents: first.claimedAmountCents ?? settlement.totals.netPayCents,
        dueAt: undefined,
        requires: ["settlements:dispute:resolve"],
      }),
    );
  }

  // --- Overdue payment ------------------------------------------------------
  if (
    settlement.paymentDueAt &&
    settlement.amountOutstandingCents > 0 &&
    canBeOverdue(settlement.status) &&
    new Date(settlement.paymentDueAt).getTime() < now
  ) {
    const days = daysOverdue(settlement.paymentDueAt, now);
    items.push(
      item(settlement, "overdue_payment", {
        severity: overdueSeverity(days),
        title: `${settlement.number} is ${days} ${days === 1 ? "day" : "days"} past due`,
        reason: `${money(settlement.amountOutstandingCents)} is still owed to ${
          settlement.payee.displayNameSnapshot
        }.`,
        amountCents: settlement.amountOutstandingCents,
        dueAt: settlement.paymentDueAt,
        daysOverdue: days,
        requires: ["settlements:pay"],
      }),
    );
  }

  return items;
}

/** Severity-ordered, worst first, so a queue reads top-down. */
const SEVERITY_RANK: Record<SettlementAttentionItem["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function sortAttentionItems(
  items: readonly SettlementAttentionItem[],
): SettlementAttentionItem[] {
  return [...items].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    // Then by money at stake: the bigger cheque first.
    return (b.amountCents ?? 0) - (a.amountCents ?? 0);
  });
}
