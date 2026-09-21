import {
  type ActorRef, type NeedsYouAutomation, type NeedsYouCategory,
  type NeedsYouDecisionOption, type NeedsYouItem, type NeedsYouPreworkStep,
} from "@/types";
import { money } from "@/lib/utils/format";
import type { ServiceContext } from "../contracts/context";
import { insuranceContextFrom, listPoliciesSync } from "./insurance-registry";
import { nowIso } from "./time";

/**
 * ★ THE 90% RULE ★
 *
 * Needs You is a decision queue. An item may only appear on it once everything
 * that CAN run unattended already has, and what is left is the one step a rule
 * must not take for somebody: a commitment of money, a commitment to a person,
 * or a judgement about which of two records is the same thing.
 *
 * This module writes that down for every work type. For each item it produces:
 *
 *   • the pre-work — what the system already did, in five-word labels;
 *   • the options — pre-priced, pre-compared, one press each;
 *   • what runs downstream the moment one is pressed.
 *
 * ★ NO INVENTED NUMBERS ★
 * An option carries a `metric` only where a real record backs it. The renewal
 * quotes below are priced off the policy's OWN premium and limits, read from the
 * insurance registry; every other work type gets options that name what will
 * happen rather than a figure nobody could check. A column filled with a
 * plausible-looking number that no record supports is worse than no column.
 *
 * ★ WHERE THIS LIVES ★
 * In the mock adapter, beside the producers whose items it describes, because
 * it is a statement about the BACKEND's behaviour: a real service would attach
 * the same shape from its own orchestrator. No screen derives any of this.
 */

/* -------------------------------------------------------------------------- */
/* Pre-work                                                                    */
/* -------------------------------------------------------------------------- */

const SOURCE_PREWORK: Record<NeedsYouItem["source"], string> = {
  system: "Condition detected",
  telegram: "Telegram message parsed",
  eld: "Telematics stream read",
  ocr: "Document read and extracted",
  manual: "Report taken in",
};

/**
 * The four steps every item goes through before anybody is told about it.
 *
 * All four are true of every item by construction — the queue cannot produce a
 * row without detecting a condition, resolving the record it is about, grading
 * it and routing it — so they are stated once here rather than repeated in
 * fifteen producers.
 */
function baselinePrework(item: NeedsYouItem): NeedsYouPreworkStep[] {
  return [
    {
      id: `${item.id}_pw_detect`,
      label: SOURCE_PREWORK[item.source],
      detail: item.reason,
      at: item.createdAt,
    },
    {
      id: `${item.id}_pw_entity`,
      label: "Record matched",
      detail: `Resolved to ${item.entity.label}.`,
      at: item.createdAt,
    },
    {
      id: `${item.id}_pw_grade`,
      label: "Graded and dated",
      detail: item.dueAt
        ? `Severity ${item.severity}; deadline taken from the record itself.`
        : `Severity ${item.severity}. This one has no deadline of its own.`,
      at: item.createdAt,
    },
    {
      id: `${item.id}_pw_route`,
      label: "Routed to a holder",
      detail:
        "The responsibility layer chose who this stops with, and who answers for it if it slips.",
      at: item.createdAt,
    },
  ];
}

function extraPrework(item: NeedsYouItem, labels: readonly string[]): NeedsYouPreworkStep[] {
  return labels.map((label, i) => ({
    id: `${item.id}_pw_x${i}`,
    label,
    at: item.createdAt,
  }));
}

/* -------------------------------------------------------------------------- */
/* Playbooks                                                                   */
/* -------------------------------------------------------------------------- */

interface Playbook {
  /** Domain pre-work, on top of the four baseline steps. */
  prework: readonly string[];
  /** The options, in the order they are offered. */
  options: (item: NeedsYouItem) => NeedsYouDecisionOption[];
}

/** The approve/decline pair most work types reduce to. */
function pair(
  item: NeedsYouItem,
  approve: { label: string; downstream: string[] },
  decline: { label: string; downstream: string[] },
): NeedsYouDecisionOption[] {
  return [
    {
      id: "approve",
      label: approve.label,
      intent: "approve",
      recommended: true,
      metrics: [],
      downstream: approve.downstream,
    },
    {
      id: "decline",
      label: decline.label,
      intent: "decline",
      metrics: [],
      downstream: decline.downstream,
    },
  ];
}

/**
 * What each work type has already had done to it, and what is left to press.
 *
 * Partial on purpose, unlike `CATEGORY_MODULE`: a work type with no entry gets
 * the generic playbook below, which is built from the item's own recommended
 * action and is always correct if unexciting. Being forced to invent a
 * playbook for a category nobody has automated yet would put words on a screen
 * that no backend behaviour stands behind.
 */
const PLAYBOOKS: Partial<Record<NeedsYouCategory, Playbook>> = {
  /* ---- Broker working policy: the one decision a rule must never take --- */
  /**
   * ★ WHY THIS IS A ONE-PRESS DECISION AND NOT A HANDOFF ★
   * Everything that could be worked out already has been: the broker was
   * resolved to its canonical profile, the scope decided whose policy this is,
   * and the routing put it in front of the one person entitled to answer. What
   * is left is a commercial judgement about who a company will work with, which
   * is exactly the kind of thing the queue exists to stop a rule from taking.
   *
   * Pressing either option runs the registry's own command against the
   * canonical policy — there is no second approval path — so the queue can
   * never say approved while the Broker policies screen says proposed.
   */
  broker_policy_approval: {
    prework: [
      "Broker resolved to its profile",
      "Scope and owner established",
      "Evidence gathered",
      "Routed to the owner",
    ],
    options: (item) =>
      pair(
        item,
        {
          label: "Approve the policy",
          downstream: [
            "Put the policy into force for this organization",
            "Apply it in Load Search, the Opportunity and Booking",
            "Write the decision to the audit ledger",
          ],
        },
        {
          label: "Reject it",
          downstream: [
            "Leave the broker unrestricted",
            "Keep the proposal and its history for the record",
          ],
        },
      ),
  },

  /* ---- Insurance renewal: the archetype -------------------------------- */
  expiring_policy: {
    prework: [
      "Broker notified",
      "Quotes collected",
      "Coverage compared",
      "Best three ranked",
    ],
    // Filled in by `renewalOptions` from the policy itself; this is the
    // fallback when the policy is not readable by this caller.
    options: (item) =>
      pair(
        item,
        {
          label: "Authorise the broker",
          downstream: [
            "Instruct the broker to quote",
            "Collect and rank the offers",
            "Bring the shortlist back here",
          ],
        },
        {
          label: "Let it lapse",
          downstream: ["Record the decision against the policy"],
        },
      ),
  },
  expired_policy: {
    prework: ["Gap measured", "Broker notified", "Replacement quotes requested"],
    options: (item) =>
      pair(
        item,
        {
          label: "Authorise replacement cover",
          downstream: [
            "Bind the shortlisted quote",
            "Collect the certificate",
            "Replace the document on file",
            "Update fleet compliance",
          ],
        },
        { label: "Run uninsured", downstream: ["Record the decision and who took it"] },
      ),
  },
  missing_coverage: {
    prework: ["Requirement read", "Market checked", "Quote requested"],
    options: (item) =>
      pair(
        item,
        {
          label: "Add the cover",
          downstream: [
            "Bind the quoted cover",
            "File the certificate",
            "Clear the requirement",
          ],
        },
        { label: "Accept the gap", downstream: ["Record the accepted gap"] },
      ),
  },

  /* ---- Rate confirmations ----------------------------------------------- */
  ratecon_waiting: {
    prework: ["Rate con read", "Checked against the booking", "Differences listed"],
    options: (item) =>
      pair(
        item,
        {
          label: "Confirm the rate con",
          downstream: [
            "Accept the document as the load's terms",
            "Update the load and the rate",
            "Release the load to dispatch",
          ],
        },
        {
          label: "Send it back",
          downstream: ["Draft the correction to the broker", "Hold the load"],
        },
      ),
  },
  rate_con_verification: {
    prework: ["Rate con read", "Checked against the booking", "Differences listed"],
    options: (item) =>
      pair(
        item,
        {
          label: "Confirm the rate con",
          downstream: [
            "Accept the document as the load's terms",
            "Update the load and the rate",
            "Release the load to dispatch",
          ],
        },
        { label: "Send it back", downstream: ["Draft the correction to the broker"] },
      ),
  },
  ratecon_disagrees: {
    prework: ["Rate con read", "Booking compared", "Every difference itemised"],
    options: (item) =>
      pair(
        item,
        {
          label: "Accept the broker's terms",
          downstream: [
            "Rewrite the load to match the document",
            "Re-price the settlement",
            "Tell the driver what changed",
          ],
        },
        {
          label: "Hold and dispute",
          downstream: ["Draft the dispute", "Keep the load unreleased"],
        },
      ),
  },

  /* ---- Negotiation and booking ------------------------------------------ */
  broker_replied: {
    prework: ["Reply parsed", "Offer priced against the lane", "Counter drafted"],
    options: (item) =>
      pair(
        item,
        {
          label: "Send the drafted reply",
          downstream: ["Send the message", "Keep the conversation on watch"],
        },
        { label: "Walk away", downstream: ["Close the conversation", "Resume the search"] },
      ),
  },
  agreed_not_booked: {
    prework: ["Price agreed", "Truck and driver checked", "Booking prepared"],
    options: (item) =>
      pair(
        item,
        {
          label: "Book it",
          downstream: [
            "Create the load at the agreed price",
            "Ask the broker for the rate confirmation",
            "Put it to the driver",
          ],
        },
        { label: "Do not book", downstream: ["Close the conversation", "Resume the search"] },
      ),
  },
  offer_expiring: {
    prework: ["Offer priced", "Expiry tracked", "Acceptance prepared"],
    options: (item) =>
      pair(
        item,
        {
          label: "Accept the offer",
          downstream: ["Accept before it lapses", "Move straight to booking"],
        },
        { label: "Let it lapse", downstream: ["Resume the search for this truck"] },
      ),
  },
  driver_countered: {
    prework: ["Counter received", "Margin recalculated", "Answer drafted"],
    options: (item) =>
      pair(
        item,
        {
          label: "Accept the counter",
          downstream: ["Re-price the load", "Confirm to the driver", "Record the change"],
        },
        { label: "Hold the original", downstream: ["Send the drafted answer to the driver"] },
      ),
  },
  draft_waiting: {
    prework: ["Message drafted", "Lane and rate checked", "Recipient resolved"],
    options: (item) =>
      pair(
        item,
        { label: "Send it", downstream: ["Send the message", "Watch for the reply"] },
        { label: "Discard", downstream: ["Drop the draft"] },
      ),
  },
  message_waiting: {
    prework: ["Message drafted", "Recipient resolved"],
    options: (item) =>
      pair(
        item,
        { label: "Send it", downstream: ["Send the message", "Watch for the reply"] },
        { label: "Discard", downstream: ["Drop the draft"] },
      ),
  },

  /* ---- Fuel -------------------------------------------------------------- */
  duplicate_fuel_purchase: {
    prework: ["Matching purchase found", "Truck and window compared", "Gallons and cost matched"],
    options: (item) =>
      pair(
        item,
        {
          label: "Merge the duplicate",
          downstream: [
            "Void the duplicate row",
            "Re-run the quarter's gallons",
            "Correct the fleet's MPG",
          ],
        },
        {
          label: "Keep both",
          downstream: ["Mark both as genuine", "Leave the quarter as it stands"],
        },
      ),
  },
  suspicious_fuel_transaction: {
    prework: ["Purchase flagged", "Card and truck checked", "Comparable purchases pulled"],
    options: (item) =>
      pair(
        item,
        { label: "Accept the purchase", downstream: ["Clear the flag", "Include it in IFTA"] },
        {
          label: "Reject it",
          downstream: ["Exclude it from IFTA", "Open it for the card holder"],
        },
      ),
  },
  missing_fuel_receipt: {
    prework: ["Purchase matched to a truck", "Receipt requested from the card feed"],
    options: (item) =>
      pair(
        item,
        {
          label: "Accept without a receipt",
          downstream: ["Record the acceptance", "Keep the purchase in IFTA"],
        },
        { label: "Chase the receipt", downstream: ["Ask the driver for the receipt"] },
      ),
  },

  /* ---- Contracts --------------------------------------------------------- */
  contract_expiring: {
    prework: ["Renewal window opened", "Terms compared with the market", "Renewal drafted"],
    options: (item) =>
      pair(
        item,
        {
          label: "Renew on the same terms",
          downstream: [
            "Write the renewal version",
            "Send it for signature",
            "Watch for the counter-signature",
          ],
        },
        { label: "Give notice", downstream: ["Draft the non-renewal notice", "Start the closeout"] },
      ),
  },
  contract_review_waiting: {
    prework: ["Draft received", "Changes against the last version listed"],
    options: (item) =>
      pair(
        item,
        {
          label: "Approve the draft",
          downstream: ["Move it to signature", "Notify the other party"],
        },
        { label: "Send it back", downstream: ["Return it with the marked changes"] },
      ),
  },

  /* ---- Workforce --------------------------------------------------------- */
  workforce_start_approval: {
    prework: ["Onboarding checked complete", "Qualification file verified", "Access prepared"],
    options: (item) =>
      pair(
        item,
        {
          label: "Start them",
          downstream: [
            "Activate the engagement",
            "Grant the prepared access",
            "Put them on the roster",
          ],
        },
        { label: "Hold the start", downstream: ["Keep the engagement pending"] },
      ),
  },
  workforce_applicant_review: {
    prework: ["Application parsed", "Record checks run", "Onboarding plan prepared"],
    options: (item) =>
      pair(
        item,
        {
          label: "Take them forward",
          downstream: ["Open the engagement", "Start onboarding", "Ask for the documents"],
        },
        { label: "Decline", downstream: ["Close the application", "Record the reason"] },
      ),
  },
  qualification_review_required: {
    prework: ["Shared version received", "Expiry and type read", "Checked against the requirement"],
    options: (item) =>
      pair(
        item,
        {
          label: "Adopt this version",
          downstream: [
            "Pin the version to the qualification file",
            "Satisfy the requirement",
            "Clear the compliance row",
          ],
        },
        { label: "Reject it", downstream: ["Tell the driver what is wrong with it"] },
      ),
  },
  qualification_replacement_available: {
    prework: ["Newer version detected", "Compared with the adopted one"],
    options: (item) =>
      pair(
        item,
        {
          label: "Adopt the newer version",
          downstream: ["Repin the file", "Re-run the requirement", "Refresh compliance"],
        },
        { label: "Keep the current one", downstream: ["Record why the newer one was not taken"] },
      ),
  },

  /* ---- Compliance and documents ------------------------------------------ */
  compliance_expiring: {
    prework: ["Requirement read", "Holder notified", "Renewal request prepared"],
    options: (item) =>
      pair(
        item,
        {
          label: "Send the renewal request",
          downstream: ["Ask the holder for the new evidence", "Watch for it to arrive"],
        },
        { label: "Not now", downstream: ["Hold the request"] },
      ),
  },
  expiring_document: {
    prework: ["Expiry read from the document", "Owner notified"],
    options: (item) =>
      pair(
        item,
        {
          label: "Request a replacement",
          downstream: ["Ask the owner for the new document", "Watch for the upload"],
        },
        { label: "Not now", downstream: ["Hold the request"] },
      ),
  },
  missing_document: {
    prework: ["Requirement read", "Owner identified", "Request prepared"],
    options: (item) =>
      pair(
        item,
        {
          label: "Send the request",
          downstream: ["Ask for the document", "Watch for the upload"],
        },
        { label: "Not now", downstream: ["Hold the request"] },
      ),
  },

  /* ---- Access and import -------------------------------------------------- */
  invitation_acceptance_incomplete: {
    prework: ["Acceptance replayed", "Failed step identified", "Recovery prepared"],
    options: (item) =>
      pair(
        item,
        {
          label: "Finish the acceptance",
          downstream: ["Re-run the failed step", "Complete the seat", "Tell the person"],
        },
        { label: "Withdraw it", downstream: ["Revoke the invitation", "Clean up the part record"] },
      ),
  },
  import_claim_unresolved: {
    prework: ["Row parsed", "Candidates matched", "Confidence scored"],
    options: (item) =>
      pair(
        item,
        {
          label: "Same person",
          downstream: [
            "Attach the row to the existing record",
            "Import the rest of the row",
            "Close the claim",
          ],
        },
        {
          label: "Somebody new",
          downstream: ["Create the new record", "Import the row against it"],
        },
      ),
  },

  /* ---- Fleet and maintenance ---------------------------------------------- */
  overdue_service: {
    prework: ["Meter read", "Interval compared", "Shop availability checked"],
    options: (item) =>
      pair(
        item,
        {
          label: "Book the service",
          downstream: ["Raise the work order", "Hold the truck out of dispatch", "Tell the driver"],
        },
        { label: "Defer it", downstream: ["Record the deferral and who took it"] },
      ),
  },
  critical_defect: {
    prework: ["Defect read", "Equipment availability checked", "Repair prepared"],
    options: (item) =>
      pair(
        item,
        {
          label: "Take it out of service",
          downstream: [
            "Mark the equipment out of service",
            "Raise the repair order",
            "Pull it from dispatch",
          ],
        },
        { label: "Keep it running", downstream: ["Record the decision against the defect"] },
      ),
  },
  missing_availability: {
    prework: ["Truck's last load read", "Empty time estimated", "Search prepared"],
    options: (item) =>
      pair(
        item,
        {
          label: "Use the estimate",
          downstream: ["Record the availability", "Start the search for the next load"],
        },
        { label: "Not yet", downstream: ["Keep the truck off the search"] },
      ),
  },
  no_search: {
    prework: ["Truck confirmed empty", "Lane candidates ranked"],
    options: (item) =>
      pair(
        item,
        {
          label: "Start the search",
          downstream: ["Open the MT Loop", "Work the ranked lanes", "Bring back the offers"],
        },
        { label: "Keep it parked", downstream: ["Record why the truck is not being worked"] },
      ),
  },
};

/**
 * The playbook for a work type nobody has automated yet.
 *
 * Still one press: the item's own recommended action becomes the approval, and
 * declining records the decision. It says nothing about pre-work it cannot
 * stand behind, which is why its `prework` is empty and its step count is the
 * baseline four.
 */
function genericPlaybook(item: NeedsYouItem): NeedsYouDecisionOption[] {
  return pair(
    item,
    {
      label: item.recommendedAction.label,
      downstream: ["Record the decision", "Close the item and tell whoever is watching it"],
    },
    {
      label: "Not mine to take",
      downstream: ["Hand it back to the responsibility layer"],
    },
  );
}

/* -------------------------------------------------------------------------- */
/* Insurance renewal: options priced off the policy itself                     */
/* -------------------------------------------------------------------------- */

/**
 * Three renewal quotes for an expiring policy.
 *
 * ★ PRICED OFF THE REAL RECORD ★
 * The premium, the interval, the insurer and the primary limit all come from
 * the policy this item is about. The market spread around it — one cheaper with
 * the same limit, one at the incumbent's own number, one dearer with a higher
 * limit — is the mock's stand-in for the broker traffic a real deployment does
 * over the wire. It is derived, not random: the same policy produces the same
 * three quotes on every read, which is what lets a person compare them across
 * two sessions and what keeps the tests deterministic.
 *
 * A policy whose premium this caller may not see (it needs
 * `insurance:sensitive:view`) produces NO quotes rather than blank columns, and
 * the item falls back to its playbook's authorise/lapse pair.
 */
function renewalOptions(
  item: NeedsYouItem,
  policy: {
    policyId: string;
    insurerName: string;
    agentName?: string;
    premium?: { amount: number; currency: string };
    premiumInterval?: string;
    coverage: { limitPerOccurrence: { amount: number } }[];
  },
): NeedsYouDecisionOption[] | null {
  const premium = policy.premium?.amount;
  if (premium == null || premium <= 0) return null;

  const limit = policy.coverage[0]?.limitPerOccurrence.amount;
  const interval = policy.premiumInterval === "annual" ? "/yr" : "/mo";
  const limitLabel = (cents: number) => money(cents, { compact: true });
  /** Whole dollars read as a price; "$5,368.00" reads as an accounting entry. */
  const price = (cents: number) => money(cents).replace(/\.00$/, "");

  // A round percentage either side of the incumbent's number. Whole cents, so
  // the figures a person compares are the figures the quote would carry.
  const cheaper = Math.round(premium * 0.88);
  const dearer = Math.round(premium * 1.12);
  const higherLimit = limit != null ? Math.round(limit * 1.5) : undefined;

  const coverageMetric = (cents?: number, note?: string) =>
    cents == null
      ? []
      : [{
          label: "Limit",
          value: limitLabel(cents),
          tone: "neutral" as const,
          detail: note,
        }];

  return [
    {
      id: "quote_value",
      name: "Broadline Mutual",
      label: `Bind ${price(cheaper)}${interval}`,
      intent: "approve",
      recommended: true,
      metrics: [
        {
          label: "Premium",
          value: `${price(cheaper)}${interval}`,
          tone: "good",
          detail: `${price(premium - cheaper)}${interval} under the expiring policy.`,
        },
        ...coverageMetric(limit, "Same primary limit as the expiring policy."),
        { label: "AM Best", value: "A−", tone: "neutral" },
      ],
      downstream: [
        "Bind the quote with the broker",
        "Wait for the premium to clear",
        "Take in the certificate",
        "Replace the policy document on file",
        "Update fleet compliance",
      ],
    },
    {
      id: "quote_incumbent",
      name: policy.insurerName,
      label: `Renew ${price(premium)}${interval}`,
      intent: "approve",
      metrics: [
        {
          label: "Premium",
          value: `${price(premium)}${interval}`,
          tone: "neutral",
          detail: "The expiring policy's own number, held for renewal.",
        },
        ...coverageMetric(limit, "Unchanged."),
        { label: "AM Best", value: "A", tone: "good" },
      ],
      downstream: [
        "Renew with the incumbent",
        "Write the new policy version",
        "Take in the certificate",
        "Update fleet compliance",
      ],
    },
    {
      id: "quote_upgrade",
      name: "Keystone Specialty",
      label: `Bind ${price(dearer)}${interval}`,
      intent: "approve",
      metrics: [
        {
          label: "Premium",
          value: `${price(dearer)}${interval}`,
          tone: "warn",
          detail: `${price(dearer - premium)}${interval} over the expiring policy.`,
        },
        ...coverageMetric(higherLimit, "Half again on the primary limit."),
        { label: "AM Best", value: "A+", tone: "good" },
      ],
      downstream: [
        "Bind the higher limit",
        "Wait for the premium to clear",
        "Take in the certificate",
        "Update fleet compliance and every certificate holder",
      ],
    },
    {
      id: "decline",
      label: "Reject all three",
      intent: "decline",
      metrics: [],
      downstream: [
        "Tell the broker none were taken",
        "Ask for a second round",
        "Bring the new shortlist back here",
      ],
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* The plan                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The automation record for one item.
 *
 * `options` is what a person may press. A DERIVED item gets exactly one, and it
 * is a link: those items are a view of another module's state, there is nothing
 * here to write to, and pressing an approval would hide the row without moving
 * the thing it is about. One press either way — it just lands in the module
 * that owns the record.
 */
export function planAutomation(
  item: NeedsYouItem,
  extra?: NeedsYouDecisionOption[] | null,
): NeedsYouAutomation {
  const playbook = PLAYBOOKS[item.category];
  const prework = [
    ...baselinePrework(item),
    ...extraPrework(item, playbook?.prework ?? []),
  ];

  if (item.derived) {
    const href = item.recommendedAction.href ?? item.entity.href;
    return {
      stage: "handoff",
      stepsDone: prework.length,
      stepsTotal: prework.length + 1,
      prework,
      options: [
        {
          id: "open",
          label: item.recommendedAction.label,
          intent: "open",
          recommended: true,
          metrics: [],
          downstream: ["Clears itself once the record no longer says this"],
          href,
        },
      ],
    };
  }

  const options = extra ?? playbook?.options(item) ?? genericPlaybook(item);

  // Resolved, snoozed or escalated items already carry their outcome in the
  // item's own fields; the decision record below is only ever written by
  // `executeDecision`, so a stored one is passed straight back through.
  const decision = item.automation?.decision;
  const longest = Math.max(...options.map((o) => o.downstream.length), 1);

  return {
    stage: decision ? "done" : "awaiting_decision",
    stepsDone: decision ? prework.length + longest : prework.length,
    stepsTotal: prework.length + 1 + longest,
    prework,
    options,
    decision,
  };
}

/**
 * Attaches an automation record to every item in a queue read.
 *
 * The one seam. Producers stay ignorant of it, so a module that learns to raise
 * a new work type gets a working decision card without touching this file, and
 * a work type that deserves a real playbook gets one by being named above.
 */
export function attachAutomation(
  ctx: ServiceContext,
  items: NeedsYouItem[],
): NeedsYouItem[] {
  const policies = renewalMarket(ctx, items);
  return items.map((item) => ({
    ...item,
    automation: planAutomation(item, policies.get(item.id) ?? null),
  }));
}

/**
 * The renewal quotes, looked up once per queue read rather than once per row.
 *
 * Reads through the insurance registry with the CALLER's context, so a
 * membership without `insurance:sensitive:view` never sees a premium here that
 * the policy screen would withhold from them.
 */
function renewalMarket(
  ctx: ServiceContext,
  items: NeedsYouItem[],
): Map<string, NeedsYouDecisionOption[]> {
  const out = new Map<string, NeedsYouDecisionOption[]>();
  const wants = items.filter(
    (i) => i.category === "expiring_policy" && i.entity.kind === "policy" && !i.derived,
  );
  if (wants.length === 0) return out;

  let policies;
  try {
    policies = listPoliciesSync(insuranceContextFrom(ctx), {});
  } catch {
    // A market lookup that cannot run is not a reason to withhold the queue.
    return out;
  }

  for (const item of wants) {
    const policy = policies.find((p) => p.policyId === item.entity.id);
    if (!policy) continue;
    const options = renewalOptions(item, policy);
    if (options) out.set(item.id, options);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Execution                                                                   */
/* -------------------------------------------------------------------------- */

export class UnknownOptionError extends Error {
  constructor(optionId: string) {
    super(`No such decision option: ${optionId}`);
    this.name = "UnknownOptionError";
  }
}

export class NotExecutableError extends Error {
  constructor() {
    super(
      "This one is worked out from the record itself. Open it, deal with what it is asking for, and the item clears on its own.",
    );
    this.name = "NotExecutableError";
  }
}

export interface DecisionOutcome {
  automation: NeedsYouAutomation;
  option: NeedsYouDecisionOption;
  /** Goes on the item's history and its resolution. */
  note: string;
}

/**
 * Takes the decision and runs everything downstream of it.
 *
 * The mock executes instantly, so every step comes back `done` with the time it
 * ran. A real orchestrator would hand back the same record with the long-running
 * steps still `running` and update them as they land — which is why the state is
 * per step rather than one flag on the record.
 */
export function executeDecision(
  item: NeedsYouItem,
  optionId: string,
  actor: ActorRef,
  at: string = nowIso(),
): DecisionOutcome {
  const automation = item.automation ?? planAutomation(item);
  const option = automation.options.find((o) => o.id === optionId);
  if (!option) throw new UnknownOptionError(optionId);
  if (option.intent === "open") throw new NotExecutableError();

  const steps = option.downstream.map((label) => ({
    label,
    state: "done" as const,
    at,
  }));

  return {
    option,
    note: `${option.label} — the system ran ${steps.length} step${steps.length === 1 ? "" : "s"} after it.`,
    automation: {
      ...automation,
      stage: "done",
      stepsDone: automation.prework.length + steps.length,
      stepsTotal: automation.prework.length + 1 + steps.length,
      decision: {
        optionId: option.id,
        optionLabel: option.label,
        decidedAt: at,
        actor,
        steps,
      },
    },
  };
}
