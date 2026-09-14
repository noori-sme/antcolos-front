import type {
  NeedsYouCategory,
  NeedsYouItem,
  NeedsYouRecommendedAction,
  SettlementAttentionItem,
} from "@/types";
import { attentionItemsFor } from "@/lib/settlements/attention";
import type { ServiceContext } from "../contracts/context";
import { settlementStore } from "./settlement-registry";

/**
 * Settlement work, projected into the Needs You queue.
 *
 * The settlement module already derives its own attention items from live
 * state. This file is only the translation — it invents nothing and stores
 * nothing, so an item disappears the moment the settlement stops producing it.
 *
 * That is why every item here is marked `derived`. There is no row to snooze,
 * assign or resolve: hiding "this settlement cannot be approved, the mileage is
 * missing" would not supply the mileage, and the queue would then be lying. The
 * only way to clear one is to fix the thing it is about.
 */

/** Derived ids are namespaced so a mutation can refuse one by name. */
export const DERIVED_ID_PREFIX = "ny_stl:";

export function isDerivedSettlementItem(itemId: string): boolean {
  return itemId.startsWith(DERIVED_ID_PREFIX);
}

const CATEGORY: Record<SettlementAttentionItem["kind"], NeedsYouCategory> = {
  missing_data: "settlement_missing_data",
  awaiting_approval: "settlement_review",
  open_dispute: "settlement_dispute",
  overdue_payment: "settlement_payment_overdue",
};

const ACTION: Record<SettlementAttentionItem["kind"], NeedsYouRecommendedAction> = {
  missing_data: {
    kind: "review",
    label: "Open the settlement",
    requires: ["settlements:view"],
  },
  awaiting_approval: {
    kind: "approve_settlement",
    label: "Review and approve",
    requires: ["settlements:approve"],
  },
  open_dispute: {
    kind: "resolve_dispute",
    label: "Open the dispute",
    requires: ["settlements:dispute:resolve"],
  },
  overdue_payment: {
    kind: "record_payment",
    label: "Record the payment",
    requires: ["settlements:pay"],
  },
};

function toNeedsYouItem(
  carrierOrganizationId: string,
  attention: SettlementAttentionItem,
): NeedsYouItem {
  return {
    id: `${DERIVED_ID_PREFIX}${attention.id}`,
    organizationId: carrierOrganizationId,
    category: CATEGORY[attention.kind],
    severity: attention.severity,
    // Always open: a derived item has no other state it could be in.
    status: "open",
    title: attention.title,
    reason: attention.reason,
    detail:
      attention.kind === "overdue_payment"
        ? "Antcolos does not move money. Record the payment here once it has been made."
        : undefined,
    entity: {
      kind: "settlement",
      id: attention.settlementId,
      label: `${attention.settlementNumber} · ${attention.payee.displayNameSnapshot}`,
      href: `/finance/settlements/${attention.settlementId}`,
    },
    recommendedAction: ACTION[attention.kind],
    dueAt: attention.dueAt,
    source: "system",
    requires: attention.requires,
    derived: true,
    createdAt: attention.createdAt,
    // Derived items have no history of their own. The settlement's audit trail
    // is the history, and it is on the settlement where it belongs.
    history: [],
  };
}

/**
 * Settlement items this caller may see.
 *
 * Carrier isolation and payee privacy are applied the same way the settlement
 * service applies them, because they are the same rules — a driver scoped to
 * their own money gets attention items about their own settlements only.
 */
export function settlementNeedsYouItems(ctx: ServiceContext): NeedsYouItem[] {
  if (!ctx.permissions.has("settlements:view")) return [];

  let settlements;
  try {
    settlements = settlementStore.carrier(ctx.organizationId).settlements;
  } catch {
    // A carrier with no settlement partition contributes nothing to the queue.
    return [];
  }

  const payeeOnly = ctx.scope.financials === "own";
  const now = Date.now();

  return settlements
    .filter((s) => {
      if (!payeeOnly) return true;
      if (ctx.driverProfileId && s.payee.driverProfileId === ctx.driverProfileId) return true;
      return Boolean(s.payee.membershipId && s.payee.membershipId === ctx.membershipId);
    })
    .flatMap((s) => attentionItemsFor(s, now))
    // An item nobody can act on is noise, not information.
    .filter((a) => a.requires.every((k) => ctx.permissions.has(k)))
    .map((a) => toNeedsYouItem(ctx.organizationId, a));
}
