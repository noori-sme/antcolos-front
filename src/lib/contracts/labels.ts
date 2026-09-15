import {
  CONTRACT_STATUS_LABEL, RENEWAL_KIND_LABEL,
  basisPointsToPercent,
  type CompensationRule, type ContractPartyRole, type ContractStatus,
  type ContractTerms, type IsoDateTime, type RenewalTerms,
} from "@/types";
import { money } from "@/lib/utils";
import { daysBetween } from "./status";

/**
 * Display strings for Contracts, in one file.
 *
 * Every sentence a contract screen shows about a date, a percentage or a
 * compensation rule is built here, so the same term never reads two ways in two
 * places — and so the honest wording about mock signatures and unconnected
 * integrations cannot be quietly rewritten in a component.
 */

export const PARTY_ROLE_LABEL: Record<ContractPartyRole, string> = {
  carrier: "Carrier",
  driver: "Company driver",
  owner_operator: "Owner-operator",
  dispatch_organization: "Dispatch organization",
  individual_dispatcher: "Individual dispatcher",
  equipment_owner: "Equipment owner",
  other: "Other party",
};

/** Short, absolute date. Contracts are about dates, so they are never relative. */
export function contractDate(iso?: IsoDateTime): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric", timeZone: "UTC",
  });
}

export function contractDateTime(iso?: IsoDateTime): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZone: "UTC",
  });
}

/** "1 Mar 2026 – 28 Feb 2027", or "from 1 Mar 2026" when open-ended. */
export function effectiveRangeLabel(terms: Pick<ContractTerms, "effective">): string {
  const from = contractDate(terms.effective.from);
  if (!terms.effective.to) return `From ${from} · open-ended`;
  return `${from} – ${contractDate(terms.effective.to)}`;
}

/**
 * How long is left, in the words an operator would use.
 *
 * Says "ran out" rather than a negative number, because a contract 12 days past
 * its end date is not "-12 days" to anybody reading a list.
 */
export function endsInLabel(
  terms: Pick<ContractTerms, "effective">,
  now: IsoDateTime,
): string {
  if (!terms.effective.to) return "No end date";
  const days = daysBetween(now, terms.effective.to);
  if (days < 0) return `Ran out ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`;
  if (days === 0) return "Ends today";
  if (days === 1) return "Ends tomorrow";
  if (days < 45) return `Ends in ${days} days`;
  return `Ends ${contractDate(terms.effective.to)}`;
}

export function renewalLabel(renewal: RenewalTerms): string {
  const base = RENEWAL_KIND_LABEL[renewal.kind];
  if (renewal.kind === "none") return base;
  const term = renewal.termDays ? ` for ${renewal.termDays} days` : "";
  const notice = renewal.noticeDays ? `, unless ${renewal.noticeDays} days' notice is given` : "";
  return `${base}${term}${notice}`;
}

/**
 * One compensation rule, as a sentence.
 *
 * Percentages come from basis points and money from cents, so nothing on a
 * contract screen has ever been through a float.
 */
export function compensationLabel(rule: CompensationRule): string {
  switch (rule.kind) {
    case "percentage_of_revenue":
      return rule.percentageBasisPoints == null
        ? "A percentage of revenue"
        : `${basisPointsToPercent(rule.percentageBasisPoints)}% of revenue`;
    case "rate_per_loaded_mile":
      return rule.rateCents == null ? "A rate per loaded mile"
        : `${money(rule.rateCents)} per loaded mile`;
    case "rate_per_all_mile":
      return rule.rateCents == null ? "A rate per mile"
        : `${money(rule.rateCents)} per mile, loaded and empty`;
    case "hourly":
      return rule.rateCents == null ? "An hourly rate" : `${money(rule.rateCents)} per hour`;
    case "flat_per_period":
      return rule.amountCents == null ? "A flat amount per period"
        : `${money(rule.amountCents)} per ${rule.per ?? "period"}`;
    case "flat_per_load":
      return rule.amountCents == null ? "A flat amount per load"
        : `${money(rule.amountCents)} per load`;
    case "deduction":
      return rule.amountCents == null ? "A deduction" : `${money(rule.amountCents)} deducted`;
    case "accessorial":
      return rule.amountCents == null ? "An accessorial" : `${money(rule.amountCents)} accessorial`;
    case "other":
      return rule.detail;
  }
}

/** When a rule applied, when it did not apply for the whole version. */
export function compensationWindowLabel(rule: CompensationRule): string | undefined {
  if (!rule.appliesFrom && !rule.appliesTo) return undefined;
  if (rule.appliesFrom && rule.appliesTo) {
    return `${contractDate(rule.appliesFrom)} – ${contractDate(rule.appliesTo)}`;
  }
  if (rule.appliesFrom) return `From ${contractDate(rule.appliesFrom)}`;
  return `Until ${contractDate(rule.appliesTo)}`;
}

export function statusLabel(status: ContractStatus): string {
  return CONTRACT_STATUS_LABEL[status];
}

/**
 * The tone a status badge takes.
 *
 * Kept here rather than in a component so "expiring" is amber everywhere and a
 * terminated contract never reads as a failure — ending an agreement on its
 * terms is a normal thing to have done.
 */
export function statusTone(status: ContractStatus): "neutral" | "info" | "success" | "warning" | "danger" {
  switch (status) {
    case "draft": return "neutral";
    case "pending_review": return "info";
    case "awaiting_signature": return "info";
    case "active": return "success";
    case "expiring": return "warning";
    case "expired": return "danger";
    case "terminated": return "neutral";
    case "cancelled": return "neutral";
    case "superseded": return "neutral";
  }
}

/**
 * The line every screen showing a signature has to carry.
 *
 * One constant, used everywhere, so the disclosure cannot go missing from one
 * screen while being present on four others.
 */
export const MOCK_SIGNATURE_DISCLOSURE =
  "Signatures in Antcolos are typed names recorded against a version. No identity is verified, no e-signature service is used, nothing has been reviewed by a lawyer, nothing is delivered to anybody, and none of it is legally binding.";

/** The same, for a whole contract record. */
export const MOCK_CONTRACT_DISCLOSURE =
  "Antcolos supplies no wording, gives no legal advice, verifies nobody's identity, processes no payments and sends nothing to anybody. What a contract records here is what your team typed.";
