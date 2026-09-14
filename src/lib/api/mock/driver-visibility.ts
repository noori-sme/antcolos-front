import type {
  DriverVisibilityField, DriverVisibilityPolicy, EffectiveVisibility,
  EngagementType,
} from "@/types";
import { FINANCIAL_FIELDS, VISIBILITY_FIELD_LABEL } from "@/types";
import type { MtLoopContext } from "./mt-loop";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * What a driver is shown of a load, and who decides.
 *
 * Three things narrow it, in this order, and each can only take away:
 *
 *   1. The pay model. A company driver is paid by the mile and has no business
 *      seeing what the carrier bills the broker. An owner-operator IS the
 *      business: the rate is the entire basis on which they accept or refuse,
 *      and hiding it from them is treating a partner like an employee.
 *
 *   2. The carrier's own policy. Carriers genuinely differ on this — some show
 *      their company drivers everything, some show almost nothing — so it is
 *      configurable per carrier per pay model rather than decided here.
 *
 *   3. The sender's permission. A dispatcher who may not see rates cannot send
 *      one, whatever the carrier's policy says, because they would be
 *      forwarding a number they are not entitled to read. This one is not
 *      configurable and is not meant to be.
 *
 * The result is applied ONCE, at the boundary, in `redact`. No screen and no
 * service re-decides it, because a redaction that happens in two places is a
 * redaction that will eventually happen in one.
 */

const nowIso = () => new Date().toISOString();

/* -------------------------------------------------------------------------- */
/* Defaults                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * What ships, before any carrier changes anything.
 *
 * Chosen to be defensible rather than generous: a company driver sees
 * everything about the WORK and nothing about the money except their own
 * estimated pay; an owner-operator sees the money too, except the dispatch
 * agency's margin, which is not the carrier's to show and not the driver's to
 * see.
 */
const DEFAULTS: Record<EngagementType, DriverVisibilityField[]> = {
  company_driver: [
    "driver_pay_estimate",
    "broker_name",
    "deadhead_miles",
    "loaded_miles",
    "pickup_window",
    "commodity_and_weight",
    "accessorial_terms",
  ],
  owner_operator: [
    "total_rate",
    "rate_per_mile",
    "estimated_profit",
    "driver_pay_estimate",
    "broker_name",
    "broker_contact",
    "deadhead_miles",
    "loaded_miles",
    "pickup_window",
    "commodity_and_weight",
    "accessorial_terms",
  ],
};

/** Every field, for a settings screen that has to offer the ones that are off. */
export const ALL_VISIBILITY_FIELDS: DriverVisibilityField[] =
  Object.keys(VISIBILITY_FIELD_LABEL) as DriverVisibilityField[];

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

const policies = new Map<string, DriverVisibilityPolicy>();
const key = (carrierOrganizationId: string, engagementType: EngagementType) =>
  `${carrierOrganizationId}::${engagementType}`;

export function resetDriverVisibility() {
  policies.clear();
}

export function policyFor(
  carrierOrganizationId: string,
  engagementType: EngagementType,
): DriverVisibilityPolicy {
  const existing = policies.get(key(carrierOrganizationId, engagementType));
  if (existing) return existing;
  return {
    carrierOrganizationId,
    engagementType,
    visible: [...DEFAULTS[engagementType]],
    customized: false,
  };
}

/** Both policies for one carrier, for a settings screen. */
export function policiesFor(carrierOrganizationId: string): DriverVisibilityPolicy[] {
  return (["company_driver", "owner_operator"] as EngagementType[])
    .map((t) => policyFor(carrierOrganizationId, t));
}

/**
 * Turn one field on or off for a carrier's drivers on one pay model.
 *
 * Records who changed it. "Who decided the drivers can see the rate" is a
 * question that gets asked, usually after somebody has seen something.
 */
export function setVisibilityField(
  carrierOrganizationId: string,
  engagementType: EngagementType,
  field: DriverVisibilityField,
  visible: boolean,
  byName: string,
): DriverVisibilityPolicy {
  const current = policyFor(carrierOrganizationId, engagementType);
  const next: DriverVisibilityPolicy = {
    ...current,
    visible: visible
      ? [...new Set([...current.visible, field])]
      : current.visible.filter((f) => f !== field),
    customized: true,
    updatedAt: nowIso(),
    updatedByName: byName,
  };
  policies.set(key(carrierOrganizationId, engagementType), next);
  return next;
}

export function resetPolicyToDefault(
  carrierOrganizationId: string,
  engagementType: EngagementType,
  byName: string,
): DriverVisibilityPolicy {
  const next: DriverVisibilityPolicy = {
    carrierOrganizationId,
    engagementType,
    visible: [...DEFAULTS[engagementType]],
    customized: false,
    updatedAt: nowIso(),
    updatedByName: byName,
  };
  policies.set(key(carrierOrganizationId, engagementType), next);
  return next;
}

/* -------------------------------------------------------------------------- */
/* The effective policy                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The carrier's policy, narrowed by what the sender may see.
 *
 * Every removal carries its reason, so the screen can say "the carrier does not
 * show this to company drivers" and "you cannot see rates yourself" as the
 * different problems they are.
 */
export function effectiveVisibility(
  carrierOrganizationId: string,
  engagementType: EngagementType,
  ctx: MtLoopContext,
): EffectiveVisibility {
  const policy = policyFor(carrierOrganizationId, engagementType);
  const withheld: EffectiveVisibility["withheld"] = [];
  const visible: DriverVisibilityField[] = [];

  const senderSeesMoney = ctx.permissions.has("rates:view");

  for (const field of ALL_VISIBILITY_FIELDS) {
    if (!policy.visible.includes(field)) {
      withheld.push({
        field,
        because: policy.customized
          ? `${labelOf(engagementType)} are not shown this by this carrier.`
          : `Not shown to ${labelOf(engagementType).toLowerCase()} by default.`,
      });
      continue;
    }
    if (FINANCIAL_FIELDS.includes(field) && !senderSeesMoney) {
      withheld.push({
        field,
        because: "You cannot see rates yourself, so you cannot send one.",
      });
      continue;
    }
    visible.push(field);
  }

  return { engagementType, visible, withheld };
}

export function labelOf(engagementType: EngagementType): string {
  return engagementType === "company_driver" ? "Company drivers" : "Owner-operators";
}

/* -------------------------------------------------------------------------- */
/* Redaction                                                                   */
/* -------------------------------------------------------------------------- */

/** Everything Dispatch knows, before the policy is applied. */
export interface FullOpportunityFacts {
  originCity: string;
  originState: string;
  destinationCity: string;
  destinationState: string;
  equipmentLabel: string;
  pickupAt?: string;
  deliverBy?: string;
  loadedMiles?: number;
  deadheadMiles?: number;
  commodity?: string;
  weightLbs?: number;
  brokerName?: string;
  brokerContact?: string;
  totalRateCents?: number;
  ratePerMileCents?: number;
  estimatedProfitCents?: number;
  driverPayEstimateCents?: number;
  accessorialTerms?: string;
}

/** The subset of an outgoing opportunity that the policy governs. */
export type RedactedFacts = Partial<FullOpportunityFacts> &
  Pick<FullOpportunityFacts,
    "originCity" | "originState" | "destinationCity" | "destinationState" | "equipmentLabel">;

/**
 * Apply the policy. The only place a driver-bound payload is ever built.
 *
 * A withheld field is REMOVED, not set to null or zero. The Driver Workflow
 * must not be able to tell the difference between a field that was withheld and
 * one nobody knows, because a driver who can see that a number exists but is
 * hidden from them has been told something about the carrier's margin.
 *
 * The lane, the equipment and the truck are never redacted: without those there
 * is no opportunity to review, and a driver asked to accept a load they cannot
 * identify is not being asked anything.
 */
export function redact(
  facts: FullOpportunityFacts,
  visibility: EffectiveVisibility,
): RedactedFacts {
  const can = (field: DriverVisibilityField) => visibility.visible.includes(field);

  const out: RedactedFacts = {
    originCity: facts.originCity,
    originState: facts.originState,
    destinationCity: facts.destinationCity,
    destinationState: facts.destinationState,
    equipmentLabel: facts.equipmentLabel,
  };

  if (can("pickup_window")) {
    if (facts.pickupAt !== undefined) out.pickupAt = facts.pickupAt;
    if (facts.deliverBy !== undefined) out.deliverBy = facts.deliverBy;
  }
  if (can("loaded_miles") && facts.loadedMiles !== undefined) out.loadedMiles = facts.loadedMiles;
  if (can("deadhead_miles") && facts.deadheadMiles !== undefined) out.deadheadMiles = facts.deadheadMiles;
  if (can("commodity_and_weight")) {
    if (facts.commodity !== undefined) out.commodity = facts.commodity;
    if (facts.weightLbs !== undefined) out.weightLbs = facts.weightLbs;
  }
  if (can("broker_name") && facts.brokerName !== undefined) out.brokerName = facts.brokerName;
  if (can("broker_contact") && facts.brokerContact !== undefined) out.brokerContact = facts.brokerContact;
  if (can("total_rate") && facts.totalRateCents !== undefined) out.totalRateCents = facts.totalRateCents;
  if (can("rate_per_mile") && facts.ratePerMileCents !== undefined) out.ratePerMileCents = facts.ratePerMileCents;
  if (can("estimated_profit") && facts.estimatedProfitCents !== undefined) {
    out.estimatedProfitCents = facts.estimatedProfitCents;
  }
  if (can("driver_pay_estimate") && facts.driverPayEstimateCents !== undefined) {
    out.driverPayEstimateCents = facts.driverPayEstimateCents;
  }
  if (can("accessorial_terms") && facts.accessorialTerms !== undefined) {
    out.accessorialTerms = facts.accessorialTerms;
  }

  return out;
}

/** May any money at all reach this driver? Used to gate progress updates. */
export function sendsAnyMoney(visibility: EffectiveVisibility): boolean {
  return visibility.visible.some((f) => FINANCIAL_FIELDS.includes(f));
}
