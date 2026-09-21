import type {
  BrokerWorkPolicy, NeedsYouHistoryEntry, NeedsYouItem, NeedsYouSeverity,
  PermissionKey,
} from "@/types";
import {
  ACCUSATORY_REASONS, BROKER_POLICY_ACTION_LABEL, BROKER_POLICY_REASON_LABEL,
  BROKER_POLICY_SCOPE_LABEL, awaitsOwnerDecision,
} from "@/types";
import type { ServiceContext } from "../contracts/context";
import {
  approveBrokerPolicySync, brokerPoliciesOwnedBy, rejectBrokerPolicySync,
} from "./broker-policy-registry";
import { nowIso } from "./time";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The one thing about a broker policy that genuinely needs a person: an owner
 * has not decided it.
 *
 * ★ THE EXISTING QUEUE, NOT A SECOND ONE ★
 * There is no broker-policy approval screen, no approval inbox and no second
 * notification system. A proposal and an unapproved safety hold are Needs You
 * items like every other decision in Antcolos, and they are approved or
 * rejected with the same one press.
 *
 * ★ ROUTED BY SCOPE, NEVER BY SESSION ★
 * The item is raised in the OWNING organization's queue and assigned to that
 * organization's owner, worked out when the policy was written. A Meridian
 * dispatcher proposing a Baxter carrier policy produces an item in BAXTER's
 * queue for BAXTER's owner. Where no eligible approver exists at all the item
 * is raised unassigned and escalated, and nothing is approved by default.
 *
 * DERIVED, like the rest of the queue: the item exists exactly while the policy
 * is waiting. Approve it, reject it, or let a temporary hold run out, and the
 * row stops being produced with nobody tidying anything.
 */

export const BROKER_POLICY_ITEM_PREFIX = "nybp_";

export function isBrokerPolicyNeedsYouId(id: string): boolean {
  return id.startsWith(BROKER_POLICY_ITEM_PREFIX);
}

/**
 * Seeing a private policy decision takes the private-customer permission — the
 * same key that already governs notes, ratings and blocked standing, because
 * this is the same kind of fact about the same kind of record.
 */
const REQUIRES: PermissionKey[] = ["customers:view", "customers:private:manage"];

/* -------------------------------------------------------------------------- */
/* What a person did to the row                                                */
/* -------------------------------------------------------------------------- */

interface ItemOverlay {
  status?: NeedsYouItem["status"];
  assigneeMembershipId?: string;
  snoozedUntil?: string;
  snoozeReason?: string;
  resolvedAt?: string;
  resolutionNote?: string;
  history: NeedsYouHistoryEntry[];
}

let overlays: Record<string, ItemOverlay> = {};

export function resetBrokerPolicyNeedsYou() {
  overlays = {};
}

/* -------------------------------------------------------------------------- */
/* Producing                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * How loudly.
 *
 * A temporary safety hold is CRITICAL without exception: it is stopping freight
 * right now on somebody's unverified suspicion, and the only two honest
 * outcomes are an owner standing behind it or an owner lifting it. Everything
 * else is graded by what it would do.
 */
function severityFor(policy: BrokerWorkPolicy): NeedsYouSeverity {
  if (policy.action === "temporary_safety_hold") return "critical";
  if (policy.action === "hard_block") return "high";
  return "medium";
}

function titleFor(policy: BrokerWorkPolicy): string {
  if (policy.action === "temporary_safety_hold") {
    return `Safety hold on ${policy.brokerNameSnapshot} — decide before it lapses`;
  }
  return `${BROKER_POLICY_ACTION_LABEL[policy.action]} proposed for ${policy.brokerNameSnapshot}`;
}

function reasonFor(policy: BrokerWorkPolicy): string {
  const who = policy.proposedBy.displayNameSnapshot;
  const scope = BROKER_POLICY_SCOPE_LABEL[policy.scope].toLowerCase();
  if (policy.action === "temporary_safety_hold") {
    return `${who} stopped this broker's freight now, as a ${scope}, for `
      + `${BROKER_POLICY_REASON_LABEL[policy.reason].toLowerCase()}. It is blocking `
      + "already and it lifts by itself unless you approve it.";
  }
  return `${who} asked for a ${scope} on ${policy.brokerNameSnapshot} for `
    + `${BROKER_POLICY_REASON_LABEL[policy.reason].toLowerCase()}. Nothing is `
    + "blocked, ranked down or warned about until you say so.";
}

/**
 * Every broker policy in this workspace that is waiting on somebody.
 *
 * Reads only THIS organization's own policies. A carrier never sees a dispatch
 * company's private proposals and a dispatch company never sees a carrier's.
 */
export function brokerPolicyNeedsYouItems(ctx: ServiceContext): NeedsYouItem[] {
  if (!REQUIRES.every((k) => ctx.permissions.has(k))) return [];
  const at = nowIso();

  return brokerPoliciesOwnedBy(ctx.organizationId)
    .filter((policy) => awaitsOwnerDecision(policy, at))
    .map((policy) => {
      const id = `${BROKER_POLICY_ITEM_PREFIX}${policy.policyId}`;
      const overlay = overlays[id];
      const item: NeedsYouItem = {
        id,
        organizationId: policy.organizationId,
        category: "broker_policy_approval",
        severity: severityFor(policy),
        // Escalated when nobody eligible could be found. Visible, unassigned,
        // and never quietly approved.
        status: overlay?.status ?? (policy.escalated ? "escalated" : "open"),
        title: titleFor(policy),
        reason: reasonFor(policy),
        /*
         * ★ WHAT A QUEUE CARD DELIBERATELY DOES NOT CARRY ★
         * A card is read over shoulders, forwarded and screenshotted. A
         * preference can be summarized on one safely; "we think they are
         * committing fraud" cannot, and neither can somebody's payment history
         * or a live service dispute. For those, the card says what kind of
         * decision it is and the sentence waits inside the policy, which the
         * owner opens in order to decide anyway.
         */
        detail: ACCUSATORY_REASONS.includes(policy.reason)
          ? `The reasoning is on the policy itself. Open it to read what ${policy.proposedBy.displayNameSnapshot} wrote before you decide.`
          : policy.explanation,
        entity: {
          kind: "broker_policy",
          id: policy.policyId,
          label: `${policy.brokerNameSnapshot} · ${BROKER_POLICY_SCOPE_LABEL[policy.scope]}`,
          href: `/directory/brokers/policies?policy=${policy.policyId}`,
        },
        relatedEntities: [
          {
            kind: "customer",
            id: policy.brokerPartyId,
            label: policy.brokerNameSnapshot,
            href: `/directory/${policy.brokerPartyId}`,
          },
        ],
        recommendedAction: {
          kind: "review_broker_policy",
          label: "Open the policy",
          requires: REQUIRES,
          href: `/directory/brokers/policies?policy=${policy.policyId}`,
        },
        // A hold's own expiry IS the deadline. Nothing else here has one: a
        // proposal that nobody answers blocks nothing, so inventing a due date
        // for it would be inventing urgency.
        dueAt: policy.action === "temporary_safety_hold" ? policy.expiresAt : undefined,
        // Routed by scope when the policy was written. Never re-derived from
        // whoever happens to be reading the queue.
        assigneeMembershipId: overlay?.assigneeMembershipId ?? policy.approverMembershipId,
        source: "system",
        requires: REQUIRES,
        // NOT derived: this item carries a real approve/reject decision, taken
        // here, through the queue's own one-press seam.
        derived: false,
        createdAt: policy.proposedAt,
        snoozedUntil: overlay?.snoozedUntil,
        snoozeReason: overlay?.snoozeReason,
        resolvedAt: overlay?.resolvedAt,
        resolutionNote: overlay?.resolutionNote,
        history: overlay?.history ?? [],
      };
      return item;
    });
}

export function findBrokerPolicyNeedsYouItem(
  ctx: ServiceContext,
  itemId: string,
): NeedsYouItem | undefined {
  return brokerPolicyNeedsYouItems(ctx).find((i) => i.id === itemId);
}

/* -------------------------------------------------------------------------- */
/* Acting                                                                      */
/* -------------------------------------------------------------------------- */

/** The policy id an item is about. */
export function policyIdFromItemId(itemId: string): string {
  return itemId.slice(BROKER_POLICY_ITEM_PREFIX.length);
}

/**
 * Records what the owner did.
 *
 * ★ THE DECISION LANDS ON THE POLICY, NOT ON THE ROW ★
 * Pressing approve here calls the SAME command the Broker policies screen
 * calls, against the same canonical record. There is no second approval path,
 * so a policy cannot end up approved in the queue and proposed in the
 * directory. The registry's own idempotence means a second press — two owners,
 * one moment — leaves one final state and writes one history entry.
 *
 * Anything that is not a decision (assigning it, snoozing it, writing a note)
 * is a statement about the QUEUE and is kept as an overlay, because it says
 * nothing about the policy and must not be written onto it.
 */
export function applyBrokerPolicyItemAction(
  ctx: ServiceContext,
  item: NeedsYouItem,
  change: Partial<Omit<ItemOverlay, "history">> & { historyEntry: NeedsYouHistoryEntry },
  decision?: { optionId: string; note?: string },
): NeedsYouItem {
  if (decision) {
    const policyId = policyIdFromItemId(item.id);
    if (decision.optionId === "approve") {
      approveBrokerPolicySync(ctx, policyId, { note: decision.note });
    } else if (decision.optionId === "reject") {
      rejectBrokerPolicySync(ctx, policyId, decision.note ?? "");
    }
  }

  const existing = overlays[item.id] ?? { history: item.history };
  const next: ItemOverlay = {
    ...existing,
    ...change,
    history: [...existing.history, change.historyEntry],
  };
  delete (next as Partial<ItemOverlay> & { historyEntry?: unknown }).historyEntry;
  overlays[item.id] = next;

  return {
    ...item,
    status: next.status ?? item.status,
    assigneeMembershipId: next.assigneeMembershipId,
    snoozedUntil: next.snoozedUntil,
    snoozeReason: next.snoozeReason,
    resolvedAt: next.resolvedAt,
    resolutionNote: next.resolutionNote,
    history: next.history,
  };
}
