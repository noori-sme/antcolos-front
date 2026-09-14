import type {
  CarrierDriverPolicy, Cents, CounterofferKind, CurrencyCode,
  DisclosableRateField, DisclosedRate, EngagementType, ProposalPolicy,
  TripPolicy,
} from "@/types";
import { FINANCIAL_COUNTEROFFER_KINDS } from "@/types";
import { PolicyDeniedError } from "./errors";

/**
 * Carrier policy, and the one function that turns money into what a driver may
 * see of it.
 *
 * The rule the whole feature rests on: a driver never receives a
 * `LoadFinancials`. They receive a `DisclosedRate` built here, containing the
 * fields policy permits and a NAMED list of the ones it withheld. Redaction
 * happens where the value is assembled, not where it is rendered, so a
 * rendering bug has nothing to leak.
 */

/** Everything money, for an owner-operator whose pay depends on it. */
const OWNER_OPERATOR_RATE_FIELDS: DisclosableRateField[] = [
  "linehaul", "total_rate", "rate_per_mile", "accessorials",
  "loaded_miles", "deadhead_miles",
];

/**
 * A company driver is paid by the carrier, not by the load. The default is that
 * they see the distance they will drive and their own share when the carrier
 * publishes one — and not what the carrier is being paid.
 */
const COMPANY_DRIVER_RATE_FIELDS: DisclosableRateField[] = [
  "loaded_miles", "deadhead_miles", "driver_share",
];

const OPERATIONAL_COUNTEROFFERS: CounterofferKind[] = [
  "schedule", "route", "home_time", "hos", "pickup", "delivery",
  "equipment", "condition", "other",
];

const DEFAULT_PAUSE_DURATIONS = [5, 15, 30, 60];

function ownerOperatorPolicy(organizationId: string): CarrierDriverPolicy {
  return {
    organizationId,
    engagementType: "owner_operator",
    label: "Owner-operator policy",
    proposals: {
      disclosedRateFields: [...OWNER_OPERATOR_RATE_FIELDS],
      // The money is theirs to argue about, so every subject is open.
      allowedCounterofferKinds: [
        ...FINANCIAL_COUNTEROFFER_KINDS,
        ...OPERATIONAL_COUNTEROFFERS,
      ],
      maxOpenCounteroffers: 4,
      allowComments: true,
      allowReject: true,
      allowPause: true,
      pauseDurationsMinutes: [...DEFAULT_PAUSE_DURATIONS],
      maxPauses: 3,
      // Still false. Continuing to negotiate is not agreeing to be booked,
      // whoever owns the truck.
      approvalGrantsBookingConsent: false,
    },
    trip: {
      disclosedRateFields: [...OWNER_OPERATOR_RATE_FIELDS],
      showCustomerContacts: true,
      requirePodBeforeCompletion: true,
      allowReceiptUploads: true,
    },
  };
}

function companyDriverPolicy(organizationId: string): CarrierDriverPolicy {
  return {
    organizationId,
    engagementType: "company_driver",
    label: "Company driver policy",
    proposals: {
      disclosedRateFields: [...COMPANY_DRIVER_RATE_FIELDS],
      // Schedule, route, home time, hours — the things that are actually
      // theirs to raise. Rate and accessorials are absent by design.
      allowedCounterofferKinds: [...OPERATIONAL_COUNTEROFFERS],
      maxOpenCounteroffers: 2,
      allowComments: true,
      allowReject: true,
      allowPause: true,
      pauseDurationsMinutes: [...DEFAULT_PAUSE_DURATIONS],
      maxPauses: 2,
      approvalGrantsBookingConsent: false,
    },
    trip: {
      disclosedRateFields: [...COMPANY_DRIVER_RATE_FIELDS],
      showCustomerContacts: true,
      requirePodBeforeCompletion: true,
      allowReceiptUploads: true,
    },
  };
}

/**
 * Per-carrier overrides, held as data. A carrier that wants its company drivers
 * to see the linehaul, or wants approval to carry booking consent, changes a
 * value here rather than a branch in the code.
 *
 * ███ MOCK ONLY ███ — the real policy record belongs to the Carrier settings
 * module. This table is the placeholder behind the same shape.
 */
const CARRIER_OVERRIDES: Record<
  string,
  Partial<Record<EngagementType, {
    label?: string;
    proposals?: Partial<ProposalPolicy>;
    trip?: Partial<TripPolicy>;
  }>>
> = {
  // Cascade tells its company drivers what the load pays but keeps the
  // negotiation operational — a real and common middle position.
  org_cascade: {
    company_driver: {
      label: "Cascade Haul — company driver policy",
      proposals: {
        disclosedRateFields: ["loaded_miles", "deadhead_miles", "driver_share", "rate_per_mile"],
        maxOpenCounteroffers: 2,
      },
      trip: {
        disclosedRateFields: ["loaded_miles", "deadhead_miles", "driver_share"],
      },
    },
  },
  org_stonebridge: {
    owner_operator: {
      label: "Stonebridge Carriers — owner-operator agreement",
      proposals: {
        // Stonebridge lets an owner-operator run several open counters at once.
        maxOpenCounteroffers: 5,
        maxPauses: 4,
        pauseDurationsMinutes: [5, 10, 20, 45, 90],
      },
    },
  },
};

/**
 * THE policy resolver. Everything that asks "may this driver see or do X" comes
 * through here, so there is exactly one place a carrier's rules are decided.
 */
export function resolvePolicy(
  organizationId: string,
  engagementType: EngagementType,
): CarrierDriverPolicy {
  const base =
    engagementType === "owner_operator"
      ? ownerOperatorPolicy(organizationId)
      : companyDriverPolicy(organizationId);

  const override = CARRIER_OVERRIDES[organizationId]?.[engagementType];
  if (!override) return base;

  return {
    ...base,
    label: override.label ?? base.label,
    proposals: { ...base.proposals, ...override.proposals },
    trip: { ...base.trip, ...override.trip },
  };
}

const FIELD_LABEL: Record<DisclosableRateField, string> = {
  linehaul: "the linehaul",
  total_rate: "the total rate",
  rate_per_mile: "the rate per mile",
  accessorials: "accessorial charges",
  driver_share: "your share",
  loaded_miles: "loaded miles",
  deadhead_miles: "deadhead miles",
};

/** The full money on a load or proposal, before policy touches it. */
export interface FullRate {
  currency: CurrencyCode;
  linehaulCents: Cents;
  totalRateCents: Cents;
  ratePerMileCents: Cents;
  driverShareCents?: Cents;
  loadedMiles: number;
  deadheadMiles: number;
  accessorials: { code: string; label: string; amountCents: Cents }[];
}

/**
 * Build what this driver may see. Returns `undefined` — not an empty object —
 * when policy discloses nothing at all, so the caller omits the whole section
 * rather than rendering an empty money card.
 *
 * `overrideFields` exists for the caller who holds `rates:view` through the
 * ordinary permission system: policy is the floor for drivers, not a ceiling
 * for a dispatcher reading the same record.
 */
export function discloseRate(
  full: FullRate,
  allowed: readonly DisclosableRateField[],
  policyLabel: string,
): DisclosedRate | undefined {
  if (allowed.length === 0) return undefined;

  const has = (f: DisclosableRateField) => allowed.includes(f);
  const withheld: { field: string; reason: string }[] = [];
  const reason = `Not shared under ${policyLabel}.`;

  const all: DisclosableRateField[] = [
    "linehaul", "total_rate", "rate_per_mile", "accessorials",
    "driver_share", "loaded_miles", "deadhead_miles",
  ];
  for (const field of all) {
    // A field the carrier simply does not have is not "withheld".
    if (field === "driver_share" && full.driverShareCents == null) continue;
    if (field === "accessorials" && full.accessorials.length === 0) continue;
    if (!has(field)) withheld.push({ field: FIELD_LABEL[field], reason });
  }

  return {
    currency: full.currency,
    linehaulCents: has("linehaul") ? full.linehaulCents : undefined,
    totalRateCents: has("total_rate") ? full.totalRateCents : undefined,
    ratePerMileCents: has("rate_per_mile") ? full.ratePerMileCents : undefined,
    driverShareCents: has("driver_share") ? full.driverShareCents : undefined,
    loadedMiles: has("loaded_miles") ? full.loadedMiles : undefined,
    deadheadMiles: has("deadhead_miles") ? full.deadheadMiles : undefined,
    accessorials: has("accessorials") ? full.accessorials.map((a) => ({ ...a })) : undefined,
    withheld,
  };
}

/** Everything, for a caller who holds `rates:view` in their own right. */
export function discloseEverything(full: FullRate): DisclosedRate {
  return {
    currency: full.currency,
    linehaulCents: full.linehaulCents,
    totalRateCents: full.totalRateCents,
    ratePerMileCents: full.ratePerMileCents,
    driverShareCents: full.driverShareCents,
    loadedMiles: full.loadedMiles,
    deadheadMiles: full.deadheadMiles,
    accessorials: full.accessorials.map((a) => ({ ...a })),
    withheld: [],
  };
}

/**
 * Enforced at the service, not in the form. A company driver who POSTs a rate
 * counteroffer directly gets this, exactly as if they had used the UI that
 * never offered the option.
 */
export function assertCounterofferAllowed(
  policy: ProposalPolicy,
  kind: CounterofferKind,
  policyLabel: string,
): void {
  if (policy.allowedCounterofferKinds.includes(kind)) return;

  const financial = FINANCIAL_COUNTEROFFER_KINDS.includes(kind);
  throw new PolicyDeniedError(
    "counteroffer_kind",
    financial
      ? `${policyLabel} does not let you negotiate the rate on this load. Schedule, route, home time, hours and equipment are open.`
      : `${policyLabel} does not accept "${kind.replace(/_/g, " ")}" as a counteroffer subject on this load.`,
  );
}

/** The one place pause durations are validated, for every channel. */
export function assertPauseDurationAllowed(
  policy: ProposalPolicy,
  minutes: number,
  policyLabel: string,
): void {
  if (!policy.allowPause) {
    throw new PolicyDeniedError("pause", `${policyLabel} does not allow pausing a proposal.`);
  }
  if (!policy.pauseDurationsMinutes.includes(minutes)) {
    throw new PolicyDeniedError(
      "pause_duration",
      `${policyLabel} allows pauses of ${policy.pauseDurationsMinutes.join(", ")} minutes.`,
    );
  }
}
