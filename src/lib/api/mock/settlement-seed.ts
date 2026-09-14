import type {
  ActorRef,
  Cents,
  CompensationAgreementSnapshot,
  DisputeReason,
  DisputeResolution,
  PayeeRef,
  PaymentMethod,
  Settlement,
  SettlementAdjustment,
  SettlementAdjustmentKind,
  SettlementAuditAction,
  SettlementAuditEntry,
  SettlementKind,
  SettlementPeriod,
  SettlementStatus,
} from "@/types";
import { money } from "@/lib/utils/format";
import { buildSnapshot, calculate, type LoadLineInput } from "@/lib/settlements/calculate";
import { blockingDataGaps } from "@/lib/settlements/calculate";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * Honest seed data for the settlement module.
 *
 * "Honest" means two specific things here:
 *
 *  1. Every figure is produced by the REAL calculation engine. Nothing in this
 *     file writes a net pay by hand. If the engine is wrong, this data is
 *     visibly wrong too — which is the point of seeding through it rather than
 *     around it.
 *  2. Nothing pretends to be integrated. Loads, Invoices, Documents, Drivers,
 *     Owner-Operators, Dispatchers, Dispatch Organizations and expenses are
 *     built in their own modules. What appears below is what this module would
 *     have RECEIVED from them: typed references plus the snapshot values the
 *     money was worked out from.
 */

/* -------------------------------------------------------------------------- */
/* Time                                                                        */
/* -------------------------------------------------------------------------- */

const DAY_MS = 86_400_000;
const BASE = Date.now();

const iso = (ms: number) => new Date(ms).toISOString();
const daysAgo = (d: number) => iso(BASE - d * DAY_MS);
const daysAhead = (d: number) => iso(BASE + d * DAY_MS);

/** Midnight-aligned week boundaries so periods read like real pay weeks. */
function weekStartMs(weeksAgo: number): number {
  const d = new Date(BASE);
  d.setUTCHours(0, 0, 0, 0);
  // Monday-based weeks.
  const shift = (d.getUTCDay() + 6) % 7;
  return d.getTime() - shift * DAY_MS - weeksAgo * 7 * DAY_MS;
}

/* -------------------------------------------------------------------------- */
/* Ids                                                                         */
/* -------------------------------------------------------------------------- */

let seq = 0;
const rowId = (prefix: string) => `${prefix}_${(++seq).toString(36).padStart(4, "0")}`;

/**
 * A settlement's permanent id is a UUID and nothing else. It is never derived
 * from the number, the payee or the period, so nothing can reach a settlement
 * by guessing one.
 */
export function settlementUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += "-";
    else if (i === 14) out += "4";
    else out += hex[Math.floor(Math.random() * 16)];
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Actors                                                                      */
/* -------------------------------------------------------------------------- */

export const SYSTEM_ACTOR: ActorRef = {
  userId: "system",
  membershipId: "system",
  displayNameSnapshot: "Antcolos",
  source: "system",
};

const OWNER_ACTOR: ActorRef = {
  userId: "usr_sam",
  membershipId: "mem_northline_owner",
  displayNameSnapshot: "Sam Murtaza",
  source: "web",
};

const BOOKKEEPER_ACTOR: ActorRef = {
  userId: "usr_dana",
  membershipId: "mem_northline_bookkeeper",
  displayNameSnapshot: "Dana Whitfield",
  source: "web",
};

function payeeActor(payee: PayeeRef): ActorRef {
  return {
    userId: payee.id,
    membershipId: payee.membershipId ?? payee.id,
    displayNameSnapshot: payee.displayNameSnapshot,
    source: "web",
  };
}

/* -------------------------------------------------------------------------- */
/* Compensation agreements                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Agreements as this module received them from the compensation module. Each
 * one is effective-dated; the engine picks the version in force when the load
 * ran, never the newest.
 */
function agreement(
  id: string,
  version: number,
  method: CompensationAgreementSnapshot["method"],
  components: CompensationAgreementSnapshot["components"],
  sharing: CompensationAgreementSnapshot["accessorialSharing"] = [],
  effectiveFromDaysAgo = 400,
  effectiveToDaysAgo?: number,
): CompensationAgreementSnapshot {
  return {
    agreementId: id,
    agreementVersion: version,
    method,
    components,
    accessorialSharing: sharing,
    effectiveFrom: daysAgo(effectiveFromDaysAgo),
    effectiveTo: effectiveToDaysAgo === undefined ? undefined : daysAgo(effectiveToDaysAgo),
    capturedAt: daysAgo(effectiveFromDaysAgo),
  };
}

export const AGREEMENTS = {
  /** Company driver, combined: per-mile on all miles plus flat stop pay. */
  dmitriCombined: agreement(
    "cma_nl_dmitri",
    3,
    "combined",
    [
      {
        id: "cmp_dmitri_mile",
        kind: "per_mile",
        label: "Mileage",
        perMileRateCents: 58,
        mileageBasis: "loaded_plus_deadhead",
      },
      { id: "cmp_dmitri_stop", kind: "fixed", label: "Stop pay", fixedAmountCents: 3_000 },
    ],
    [{ code: "detention", shareBasisPoints: 10_000 }],
  ),

  /**
   * Owner-operator on a straight percentage of gross. Because the basis is
   * gross revenue, accessorials are already inside it — the engine must not pay
   * the detention share a second time, and the statement says so explicitly.
   */
  amirPercentage: agreement(
    "cma_nl_amir",
    2,
    "percentage",
    [
      {
        id: "cmp_amir_pct",
        kind: "percentage",
        label: "Owner-operator share",
        percentageBasisPoints: 7_200,
        percentageBasis: "gross_revenue",
      },
    ],
    [{ code: "detention", shareBasisPoints: 10_000 }],
    // Took effect a fortnight ago. Loads run before then are paid under v1.
    14,
  ),

  /**
   * The superseded version of Amir's agreement — 68%, ended a fortnight ago.
   * Loads performed while this was in force are still paid at 68%, which is
   * exactly what the snapshot rule exists to guarantee.
   */
  amirPercentageV1: agreement(
    "cma_nl_amir",
    1,
    "percentage",
    [
      {
        id: "cmp_amir_pct",
        kind: "percentage",
        label: "Owner-operator share",
        percentageBasisPoints: 6_800,
        percentageBasis: "gross_revenue",
      },
    ],
    [{ code: "detention", shareBasisPoints: 10_000 }],
    400,
    14,
  ),

  /** Percentage of linehaul only, so detention IS paid as its own line. */
  marisolLinehaul: agreement(
    "cma_nl_marisol",
    1,
    "percentage",
    [
      {
        id: "cmp_marisol_pct",
        kind: "percentage",
        label: "Linehaul share",
        percentageBasisPoints: 2_600,
        percentageBasis: "linehaul",
      },
    ],
    [
      { code: "detention", shareBasisPoints: 5_000 },
      { code: "layover", shareBasisPoints: 10_000 },
    ],
  ),

  /** Straight per-mile, loaded miles only. */
  rayPerMile: agreement(
    "cma_nl_ray",
    1,
    "per_mile",
    [
      {
        id: "cmp_ray_mile",
        kind: "per_mile",
        label: "Loaded mileage",
        perMileRateCents: 55,
        mileageBasis: "loaded",
      },
    ],
    [{ code: "detention", shareBasisPoints: 10_000 }],
  ),

  /** An individual dispatcher's commission. Same engine, different label. */
  priyaCommission: agreement(
    "cma_nl_priya",
    1,
    "percentage",
    [
      {
        id: "cmp_priya_pct",
        kind: "percentage",
        label: "Dispatch commission",
        percentageBasisPoints: 500,
        percentageBasis: "gross_revenue",
      },
    ],
  ),

  /** A dispatch organization: percentage of linehaul plus a per-load fee. */
  meridianCommission: agreement(
    "cma_nl_meridian",
    2,
    "combined",
    [
      {
        id: "cmp_meridian_pct",
        kind: "percentage",
        label: "Dispatch commission",
        percentageBasisPoints: 400,
        percentageBasis: "linehaul",
      },
      { id: "cmp_meridian_fee", kind: "fixed", label: "Per-load fee", fixedAmountCents: 1_500 },
    ],
  ),

  /** An approved non-driver payee on a flat per-load referral fee. */
  harborPointReferral: agreement(
    "cma_nl_harbor",
    1,
    "fixed",
    [{ id: "cmp_harbor_fee", kind: "fixed", label: "Referral fee", fixedAmountCents: 7_500 }],
  ),

  /** Cascade's company drivers. */
  cascadePerMile: agreement(
    "cma_cs_driver",
    2,
    "combined",
    [
      {
        id: "cmp_cs_mile",
        kind: "per_mile",
        label: "Loaded mileage",
        perMileRateCents: 54,
        mileageBasis: "loaded",
      },
      {
        id: "cmp_cs_dh",
        kind: "per_mile",
        label: "Deadhead",
        perMileRateCents: 22,
        mileageBasis: "deadhead",
      },
    ],
    [{ code: "detention", shareBasisPoints: 10_000 }],
  ),

  /** Baxter, so a second carrier's data exists to be isolated from. */
  baxterPercentage: agreement(
    "cma_bx_driver",
    1,
    "percentage",
    [
      {
        id: "cmp_bx_pct",
        kind: "percentage",
        label: "Driver share",
        percentageBasisPoints: 2_800,
        percentageBasis: "linehaul",
      },
    ],
  ),
} as const;

/* -------------------------------------------------------------------------- */
/* Payees                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Payees as received from their owning modules. `membershipId` is what lets a
 * payee be shown their own settlement and nothing else — see the privacy rule
 * in the service.
 */
export const PAYEES: Record<string, PayeeRef> = {
  dmitri: {
    id: "drv_nl_01",
    kind: "company_driver",
    displayNameSnapshot: "Dmitri Kovalenko",
    driverProfileId: "drv_nl_01",
  },
  amir: {
    id: "drv_nl_04",
    kind: "owner_operator",
    displayNameSnapshot: "Amir Haddad",
    driverProfileId: "drv_nl_04",
  },
  marisol: {
    id: "drv_nl_02",
    kind: "company_driver",
    displayNameSnapshot: "Marisol Ortiz",
    driverProfileId: "drv_nl_02",
  },
  ray: {
    id: "drv_nl_03",
    kind: "company_driver",
    displayNameSnapshot: "Ray Bell",
    driverProfileId: "drv_nl_03",
  },
  priya: {
    id: "dsp_nl_01",
    kind: "dispatcher",
    displayNameSnapshot: "Priya Raman",
    membershipId: "mem_northline_dispatcher",
  },
  meridian: {
    id: "org_meridian",
    kind: "dispatch_organization",
    displayNameSnapshot: "Meridian Dispatch",
    payeeOrganizationId: "org_meridian",
  },
  harbor: {
    id: "pay_nl_harbor",
    kind: "other_payee",
    displayNameSnapshot: "Harbor Point Logistics",
  },
  /** Cascade — this is the signed-in user, seen from the payee side. */
  sam: {
    id: "drv_cascade_0192",
    kind: "company_driver",
    displayNameSnapshot: "Sam Murtaza",
    driverProfileId: "drv_cascade_0192",
    membershipId: "mem_cascade_driver",
  },
  owen: {
    id: "drv_cs_02",
    kind: "company_driver",
    displayNameSnapshot: "Owen Fitz",
    driverProfileId: "drv_cs_02",
  },
  baxterDriver: {
    id: "drv_bx_01",
    kind: "company_driver",
    displayNameSnapshot: "Nadia Farrow",
    driverProfileId: "drv_bx_01",
  },
};

/* -------------------------------------------------------------------------- */
/* Periods                                                                     */
/* -------------------------------------------------------------------------- */

function weeklyPeriod(carrierOrganizationId: string, weeksAgo: number): SettlementPeriod {
  const start = weekStartMs(weeksAgo);
  const end = start + 7 * DAY_MS;
  const startDate = new Date(start);
  const endDate = new Date(end - DAY_MS);
  const fmt = (d: Date) =>
    `${d.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${d.getUTCDate()}`;
  return {
    id: `per_${carrierOrganizationId}_w${weeksAgo}`,
    carrierOrganizationId,
    label: `${fmt(startDate)} – ${fmt(endDate)}`,
    cadence: "weekly",
    startAt: iso(start),
    endAt: iso(end),
    // Carriers commonly pay the Friday after the week closes.
    payDate: iso(end + 4 * DAY_MS),
    closedAt: weeksAgo > 0 ? iso(end) : undefined,
  };
}

export function periodsFor(carrierOrganizationId: string): SettlementPeriod[] {
  return [0, 1, 2, 3].map((w) => weeklyPeriod(carrierOrganizationId, w));
}

/* -------------------------------------------------------------------------- */
/* Seed shapes                                                                 */
/* -------------------------------------------------------------------------- */

interface AccessorialSeed {
  code: string;
  label: string;
  cents: Cents;
  /** Unapproved accessorials are raised as gaps rather than paid. */
  approved?: boolean;
}

interface LoadSeed {
  /** The load's own reference, as the Loads module knows it. */
  ref: string;
  /** Resolved against the Loads module at read time when it is present there. */
  loadId?: string;
  lane: string;
  /** Days before now the work was performed. Decides which agreement applies. */
  performedDaysAgo: number;
  linehaul: Cents;
  loaded: number;
  deadhead: number;
  accessorials?: AccessorialSeed[];
  invoiceNumber?: string;
  invoicePaidDaysAgo?: number;
  /** Gaps another module reported, e.g. a POD that never arrived. */
  gaps?: { kind: "missing_document" | "missing_invoice" | "missing_payee_profile"; summary: string; blocks: boolean }[];
  /** Forces the mileage to zero, to exercise a blocking calculation gap. */
  mileageMissing?: boolean;
}

interface AdjustmentSeed {
  kind: SettlementAdjustmentKind;
  direction: "addition" | "subtraction";
  label: string;
  cents: Cents;
  note?: string;
  installment?: { number: number; of: number };
  expenseId?: string;
}

interface PaymentSeed {
  cents: Cents;
  method: PaymentMethod;
  reference?: string;
  paidDaysAgo: number;
}

interface DisputeSeed {
  reason: DisputeReason;
  summary: string;
  claimedCents?: Cents;
  raisedDaysAgo: number;
  messages?: { from: "payee" | "office"; body: string; daysAgo: number }[];
  resolution?: DisputeResolution;
  resolutionNote?: string;
  resolvedDaysAgo?: number;
}

export interface SettlementSeed {
  number: string;
  kind?: SettlementKind;
  status: SettlementStatus;
  payeeKey: keyof typeof PAYEES;
  agreement: CompensationAgreementSnapshot;
  weeksAgo: number;
  loads: LoadSeed[];
  adjustments?: AdjustmentSeed[];
  payments?: PaymentSeed[];
  disputes?: DisputeSeed[];
  /** Days from now the payment is due. Negative is already overdue. */
  dueInDays?: number;
  voidReason?: string;
  /** Set on an adjustment settlement: the number of the settlement it corrects. */
  correctsNumber?: string;
}

/* -------------------------------------------------------------------------- */
/* Building                                                                    */
/* -------------------------------------------------------------------------- */

function toLoadLineInput(
  seed: LoadSeed,
  agreementSnapshot: CompensationAgreementSnapshot,
  resolveLoadId: (ref: string) => string | undefined,
): LoadLineInput {
  const resolved = seed.loadId ?? resolveLoadId(seed.ref);
  return {
    id: rowId("sll"),
    load: {
      // A settlement always has a load id. When the Loads module does not hold
      // the record in this mock, the id is still stable and still opaque — it
      // simply will not resolve, and the view reports that rather than guessing.
      loadId: resolved ?? `load_archived_${seed.ref.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
      referenceSnapshot: seed.ref,
      laneSnapshot: seed.lane,
      performedAt: daysAgo(seed.performedDaysAgo),
      deliveredAt: daysAgo(seed.performedDaysAgo),
      loadedMiles: seed.mileageMissing ? 0 : seed.loaded,
      deadheadMiles: seed.mileageMissing ? 0 : seed.deadhead,
    },
    invoice: seed.invoiceNumber
      ? {
          invoiceId: `inv_${seed.invoiceNumber.toLowerCase()}`,
          numberSnapshot: seed.invoiceNumber,
          issuedAt: daysAgo(Math.max(0, seed.performedDaysAgo - 2)),
          customerPaidAt:
            seed.invoicePaidDaysAgo === undefined ? undefined : daysAgo(seed.invoicePaidDaysAgo),
        }
      : undefined,
    agreement: agreementSnapshot,
    linehaulCents: seed.linehaul,
    accessorials: (seed.accessorials ?? []).map((a) => ({
      code: a.code,
      label: a.label,
      billedCents: a.cents,
      approved: a.approved ?? true,
    })),
    missingData: (seed.gaps ?? []).map((g) => ({
      kind: g.kind,
      summary: g.summary,
      blocksApproval: g.blocks,
    })),
  };
}

function toAdjustment(seed: AdjustmentSeed, addedAt: string, actor: ActorRef): SettlementAdjustment {
  return {
    id: rowId("adj"),
    kind: seed.kind,
    direction: seed.direction,
    label: seed.label,
    amountCents: seed.cents,
    note: seed.note,
    addedAt,
    addedBy: actor,
    installment: seed.installment,
    expense: seed.expenseId
      ? {
          expenseId: seed.expenseId,
          approvedAt: addedAt,
          approvedBySnapshot: BOOKKEEPER_ACTOR.displayNameSnapshot,
        }
      : undefined,
  };
}

function audit(
  settlementId: string,
  at: string,
  actor: ActorRef,
  action: SettlementAuditAction,
  summary: string,
  extra: Partial<SettlementAuditEntry> = {},
): SettlementAuditEntry {
  return { id: rowId("aud"), settlementId, at, actor, action, summary, ...extra };
}

/**
 * Builds one settlement, running the REAL engine and GENERATING the audit
 * trail from the status — rather than hand-writing a history that happens to
 * agree with it. Same reasoning as the load seeds: the derivation gets
 * exercised, so a settlement whose trail contradicts its state cannot be
 * seeded by accident.
 */
export function buildSettlement(
  carrierOrganizationId: string,
  seed: SettlementSeed,
  resolveLoadId: (ref: string) => string | undefined,
): Settlement {
  const id = settlementUuid();
  const payee = PAYEES[seed.payeeKey];
  const period = weeklyPeriod(carrierOrganizationId, seed.weeksAgo);
  const createdAt = daysAgo(seed.weeksAgo * 7);

  const adjustments = (seed.adjustments ?? []).map((a) =>
    toAdjustment(a, createdAt, BOOKKEEPER_ACTOR),
  );
  const result = calculate({
    currency: "USD",
    loadLines: seed.loads.map((l) => toLoadLineInput(l, seed.agreement, resolveLoadId)),
    adjustments,
  });

  const snapshot = buildSnapshot({
    id: rowId("snap"),
    settlementId: id,
    revision: 1,
    computedAt: createdAt,
    computedBy: SYSTEM_ACTOR,
    result,
    adjustments,
  });

  const entries: SettlementAuditEntry[] = [
    audit(id, createdAt, SYSTEM_ACTOR, "created", `Settlement opened for ${period.label}.`, {
      toStatus: "draft",
    }),
    audit(
      id,
      createdAt,
      SYSTEM_ACTOR,
      "recalculated",
      `${result.loadLines.length} ${result.loadLines.length === 1 ? "load" : "loads"} priced, net ${money(
        result.totals.netPayCents,
      )}.`,
      { toNetPayCents: result.totals.netPayCents },
    ),
  ];

  const reached = (s: SettlementStatus) => STATUS_PATH[seed.status].includes(s);

  if (reached("needs_review")) {
    entries.push(
      audit(id, daysAgo(seed.weeksAgo * 7 - 1), SYSTEM_ACTOR, "submitted_for_review",
        "Ready for a human to look at.", { fromStatus: "draft", toStatus: "needs_review" }),
    );
  }

  let approvedAt: string | undefined;
  if (reached("approved")) {
    approvedAt = daysAgo(Math.max(0, seed.weeksAgo * 7 - 2));
    snapshot.frozen = true;
    snapshot.frozenAt = approvedAt;
    entries.push(
      audit(id, approvedAt, OWNER_ACTOR, "approved", `Approved at ${money(result.totals.netPayCents)}.`, {
        fromStatus: "needs_review",
        toStatus: "approved",
      }),
      audit(id, approvedAt, SYSTEM_ACTOR, "snapshot_frozen",
        `Calculation revision ${snapshot.revision} frozen. Later changes to rates or agreements cannot alter it.`),
    );
  }

  if (reached("ready_for_payment")) {
    entries.push(
      audit(id, daysAgo(Math.max(0, seed.weeksAgo * 7 - 3)), BOOKKEEPER_ACTOR,
        "marked_ready_for_payment", "Queued for payment outside Antcolos.",
        { fromStatus: "approved", toStatus: "ready_for_payment" }),
    );
  }

  // --- Payments -------------------------------------------------------------
  const payments = (seed.payments ?? []).map((p) => ({
    id: rowId("pay"),
    settlementId: id,
    amountCents: p.cents,
    method: p.method,
    referenceNumber: p.reference,
    paidAt: daysAgo(p.paidDaysAgo),
    recordedAt: daysAgo(p.paidDaysAgo),
    recordedBy: BOOKKEEPER_ACTOR,
  }));
  for (const p of payments) {
    entries.push(
      audit(id, p.recordedAt, BOOKKEEPER_ACTOR, "payment_recorded",
        `${money(p.amountCents)} recorded as paid by ${p.method}${
          p.referenceNumber ? ` (${p.referenceNumber})` : ""
        }.`, { relatedId: p.id }),
    );
  }
  const amountPaidCents = payments.reduce((n, p) => n + p.amountCents, 0);

  // --- Disputes -------------------------------------------------------------
  const disputes = (seed.disputes ?? []).map((d) => {
    const disputeId = rowId("dsp");
    const statusBeforeDispute: SettlementStatus = reached("ready_for_payment")
      ? "ready_for_payment"
      : reached("approved")
        ? "approved"
        : "needs_review";
    return {
      id: disputeId,
      settlementId: id,
      status: d.resolution ? ("resolved" as const) : ("open" as const),
      reason: d.reason,
      summary: d.summary,
      claimedAmountCents: d.claimedCents,
      raisedAt: daysAgo(d.raisedDaysAgo),
      raisedBy: payeeActor(payee),
      statusBeforeDispute,
      messages: (d.messages ?? []).map((m) => ({
        id: rowId("msg"),
        at: daysAgo(m.daysAgo),
        actor: m.from === "payee" ? payeeActor(payee) : BOOKKEEPER_ACTOR,
        body: m.body,
      })),
      resolution: d.resolution,
      resolutionNote: d.resolutionNote,
      resolvedAt: d.resolvedDaysAgo === undefined ? undefined : daysAgo(d.resolvedDaysAgo),
      resolvedBy: d.resolution ? OWNER_ACTOR : undefined,
    };
  });
  for (const d of disputes) {
    entries.push(
      audit(id, d.raisedAt, d.raisedBy, "dispute_raised", d.summary, {
        toStatus: "disputed",
        relatedId: d.id,
      }),
    );
    if (d.resolvedAt) {
      entries.push(
        audit(id, d.resolvedAt, OWNER_ACTOR, "dispute_resolved",
          `${d.resolution === "upheld" ? "Settlement stands" : "Corrected"}: ${d.resolutionNote ?? ""}`.trim(),
          { relatedId: d.id }),
      );
    }
  }

  // --- Void -----------------------------------------------------------------
  const voidedAt = seed.status === "voided" ? daysAgo(Math.max(0, seed.weeksAgo * 7 - 3)) : undefined;
  if (voidedAt) {
    entries.push(
      audit(id, voidedAt, OWNER_ACTOR, "voided", seed.voidReason ?? "Voided.", {
        toStatus: "voided",
      }),
    );
  }

  const paidAt =
    seed.status === "paid" && payments.length > 0
      ? payments[payments.length - 1].paidAt
      : undefined;

  const netPayCents = result.totals.netPayCents;

  return {
    id,
    carrierOrganizationId,
    number: seed.number,
    kind: seed.kind ?? "regular",
    status: seed.status,
    payee,
    period,
    currency: "USD",
    loadLines: result.loadLines,
    adjustments,
    snapshot,
    totals: result.totals,
    approvals: approvedAt
      ? [
          {
            id: rowId("apr"),
            approvedAt,
            approvedBy: OWNER_ACTOR,
            snapshotRevision: snapshot.revision,
          },
        ]
      : [],
    disputes,
    payments,
    statements: [],
    audit: entries.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()),
    version: 1,
    correctsSettlementId: undefined,
    amountPaidCents,
    amountOutstandingCents: Math.max(0, netPayCents - amountPaidCents),
    paymentDueAt: seed.dueInDays === undefined ? period.payDate : daysAhead(seed.dueInDays),
    createdAt,
    createdBy: SYSTEM_ACTOR,
    updatedAt: entries[entries.length - 1].at,
    approvedAt,
    paidAt,
    voidedAt,
    voidReason: seed.voidReason,
  };
}

/**
 * Which earlier statuses a settlement in a given status must have passed
 * through. Used to generate a trail that agrees with the state.
 */
const STATUS_PATH: Record<SettlementStatus, SettlementStatus[]> = {
  draft: ["draft"],
  needs_review: ["draft", "needs_review"],
  approved: ["draft", "needs_review", "approved"],
  disputed: ["draft", "needs_review", "approved"],
  ready_for_payment: ["draft", "needs_review", "approved", "ready_for_payment"],
  partially_paid: ["draft", "needs_review", "approved", "ready_for_payment", "partially_paid"],
  paid: ["draft", "needs_review", "approved", "ready_for_payment", "paid"],
  voided: ["draft"],
};

/** Exposed so the registry can report on blocked settlements. */
export { blockingDataGaps };
