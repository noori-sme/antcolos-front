import type { Settlement, SettlementPeriod } from "@/types";
import { OrganizationScopeError } from "../contracts/context";
import {
  AGREEMENTS,
  buildSettlement,
  periodsFor,
  type SettlementSeed,
} from "./settlement-seed";
import { mockStore } from "./store";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The settlement store, PARTITIONED BY CARRIER.
 *
 * Every accessor requires a carrier organization id, and there is no method
 * that reads across the partition. That is the same shape the loads store uses,
 * and for the same reason: a cross-carrier read should be impossible to write
 * by accident, not merely discouraged.
 *
 * Built lazily on first access so the loads store is fully seeded by the time
 * settlement load references are resolved against it.
 */

/* -------------------------------------------------------------------------- */
/* Resolving load references                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Finds the Loads module's id for a load this settlement references.
 *
 * The Loads module is built separately and holds only current freight, so this
 * legitimately returns undefined for an archived period. That is not an error:
 * the settlement keeps its snapshot of the load either way, and the service
 * reports which ids actually resolve rather than handing the UI a link that
 * would 404.
 */
function loadIdResolver(carrierOrganizationId: string) {
  return (reference: string): string | undefined => {
    try {
      return mockStore
        .org(carrierOrganizationId)
        .loads.find((l) => l.reference === reference)?.id;
    } catch {
      // No loads seeded for this organization. Nothing to resolve against.
      return undefined;
    }
  };
}

/* -------------------------------------------------------------------------- */
/* Seed data                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Northline — the full picture. Every payee kind, every compensation method,
 * every status, and the three things that actually need a human: a settlement
 * blocked by missing data, an open dispute, and money that is past due.
 */
const NORTHLINE_SEEDS: SettlementSeed[] = [
  {
    // Owner-operator on 72% of gross. The detention on NL-24805 is inside that
    // gross, so it is NOT paid again as its own line — the breakdown says so.
    number: "NL-STL-1042",
    status: "needs_review",
    payeeKey: "amir",
    agreement: AGREEMENTS.amirPercentage,
    weeksAgo: 0,
    loads: [
      {
        ref: "NL-24812",
        lane: "Milwaukee, WI → Kansas City, MO",
        performedDaysAgo: 2,
        linehaul: 99_800,
        loaded: 512,
        deadhead: 21,
        invoiceNumber: "INV-4471",
      },
      {
        ref: "NL-24805",
        lane: "Rockford, IL → Memphis, TN",
        performedDaysAgo: 3,
        linehaul: 104_100,
        loaded: 548,
        deadhead: 18,
        accessorials: [{ code: "detention", label: "Detention, 1.5 hrs", cents: 8_000 }],
        invoiceNumber: "INV-4468",
      },
    ],
    adjustments: [
      {
        kind: "fuel_advance",
        direction: "subtraction",
        label: "Fuel advance, Rockford",
        cents: 40_000,
        note: "Advanced against this period on the 3rd.",
        expenseId: "exp_nl_9912",
      },
      {
        kind: "deduction",
        direction: "subtraction",
        label: "Occupational accident insurance",
        cents: 18_500,
        note: "Weekly premium per the owner-operator agreement.",
      },
      {
        kind: "deduction",
        direction: "subtraction",
        label: "Maintenance escrow",
        cents: 25_000,
        installment: { number: 3, of: 6 },
      },
      {
        kind: "reimbursement",
        direction: "addition",
        label: "Scale ticket, Memphis",
        cents: 1_400,
        expenseId: "exp_nl_9918",
      },
    ],
    dueInDays: 4,
  },

  {
    // Blocked: one load came back with no mileage, and a POD never arrived.
    // This is the "missing data" Needs You item, derived rather than written.
    number: "NL-STL-1041",
    status: "draft",
    payeeKey: "ray",
    agreement: AGREEMENTS.rayPerMile,
    weeksAgo: 0,
    loads: [
      {
        ref: "NL-24799",
        lane: "Chicago, IL → Detroit, MI",
        performedDaysAgo: 6,
        linehaul: 34_500,
        loaded: 283,
        deadhead: 11,
        invoiceNumber: "INV-4455",
      },
      {
        ref: "NL-24788",
        lane: "Detroit, MI → Indianapolis, IN",
        performedDaysAgo: 5,
        linehaul: 29_800,
        loaded: 0,
        deadhead: 0,
        mileageMissing: true,
        gaps: [
          {
            kind: "missing_document",
            summary: "No proof of delivery has been uploaded for load NL-24788.",
            blocks: true,
          },
        ],
      },
    ],
    dueInDays: 4,
  },

  {
    // Approved a fortnight ago and still not paid. Drives the overdue item.
    number: "NL-STL-1039",
    status: "approved",
    payeeKey: "dmitri",
    agreement: AGREEMENTS.dmitriCombined,
    weeksAgo: 1,
    loads: [
      {
        ref: "NL-24771",
        lane: "Chicago, IL → Columbus, OH",
        performedDaysAgo: 9,
        linehaul: 41_200,
        loaded: 356,
        deadhead: 14,
        invoiceNumber: "INV-4431",
        invoicePaidDaysAgo: 2,
      },
      {
        ref: "NL-24768",
        lane: "Columbus, OH → Louisville, KY",
        performedDaysAgo: 10,
        linehaul: 28_900,
        loaded: 211,
        deadhead: 8,
        accessorials: [{ code: "detention", label: "Detention, 2 hrs", cents: 10_000 }],
        invoiceNumber: "INV-4429",
      },
      {
        ref: "NL-24760",
        lane: "Louisville, KY → Chicago, IL",
        performedDaysAgo: 11,
        linehaul: 37_400,
        loaded: 297,
        deadhead: 6,
        invoiceNumber: "INV-4424",
      },
    ],
    adjustments: [
      {
        kind: "reimbursement",
        direction: "addition",
        label: "Lumper, Columbus",
        cents: 12_500,
        expenseId: "exp_nl_9840",
      },
      {
        kind: "deduction",
        direction: "subtraction",
        label: "Uniform advance",
        cents: 6_000,
        installment: { number: 2, of: 4 },
      },
    ],
    dueInDays: -9,
  },

  {
    // Marisol is on a LINEHAUL percentage, so her detention is paid as its own
    // line at the agreed 50% — the opposite of Amir's case, in one list.
    number: "NL-STL-1038",
    status: "disputed",
    payeeKey: "marisol",
    agreement: AGREEMENTS.marisolLinehaul,
    weeksAgo: 1,
    loads: [
      {
        ref: "NL-24774",
        lane: "Chicago, IL → Des Moines, IA",
        performedDaysAgo: 9,
        linehaul: 33_800,
        loaded: 333,
        deadhead: 12,
        accessorials: [
          { code: "detention", label: "Detention, 3 hrs", cents: 15_000 },
          { code: "layover", label: "Layover, 1 night", cents: 20_000 },
        ],
        invoiceNumber: "INV-4433",
      },
      {
        ref: "NL-24769",
        lane: "Des Moines, IA → Chicago, IL",
        performedDaysAgo: 10,
        linehaul: 26_400,
        loaded: 333,
        deadhead: 4,
        invoiceNumber: "INV-4430",
      },
    ],
    adjustments: [
      {
        kind: "deduction",
        direction: "subtraction",
        label: "Cargo claim contribution",
        cents: 25_000,
        note: "Damaged pallet, Des Moines. Recorded against this period.",
      },
    ],
    disputes: [
      {
        reason: "unexpected_deduction",
        summary:
          "I was not told about the cargo claim deduction and I do not think the damage was mine.",
        claimedCents: 25_000,
        raisedDaysAgo: 5,
        messages: [
          {
            from: "office",
            body: "Thanks Marisol — pulling the photos from the Des Moines delivery now.",
            daysAgo: 4,
          },
        ],
      },
    ],
    dueInDays: -2,
  },

  {
    // An individual dispatcher, paid commission. Same engine, different words.
    number: "NL-STL-1036",
    status: "ready_for_payment",
    payeeKey: "priya",
    agreement: AGREEMENTS.priyaCommission,
    weeksAgo: 1,
    loads: [
      {
        ref: "NL-24771",
        lane: "Chicago, IL → Columbus, OH",
        performedDaysAgo: 9,
        linehaul: 41_200,
        loaded: 356,
        deadhead: 14,
      },
      {
        ref: "NL-24774",
        lane: "Chicago, IL → Des Moines, IA",
        performedDaysAgo: 9,
        linehaul: 33_800,
        loaded: 333,
        deadhead: 12,
        accessorials: [
          { code: "detention", label: "Detention, 3 hrs", cents: 15_000 },
          { code: "layover", label: "Layover, 1 night", cents: 20_000 },
        ],
      },
    ],
    dueInDays: 2,
  },

  {
    // A dispatch ORGANIZATION, part-paid. Commission plus a per-load fee.
    number: "NL-STL-1035",
    status: "partially_paid",
    payeeKey: "meridian",
    agreement: AGREEMENTS.meridianCommission,
    weeksAgo: 2,
    loads: [
      {
        ref: "NL-24742",
        lane: "Chicago, IL → Pittsburgh, PA",
        performedDaysAgo: 16,
        linehaul: 62_700,
        loaded: 461,
        deadhead: 22,
      },
      {
        ref: "NL-24738",
        lane: "Pittsburgh, PA → Cleveland, OH",
        performedDaysAgo: 17,
        linehaul: 21_300,
        loaded: 133,
        deadhead: 7,
      },
      {
        ref: "NL-24733",
        lane: "Cleveland, OH → Chicago, IL",
        performedDaysAgo: 18,
        linehaul: 44_900,
        loaded: 345,
        deadhead: 9,
      },
    ],
    payments: [{ cents: 3_000, method: "ach", reference: "ACH-88120", paidDaysAgo: 6 }],
    dueInDays: -4,
  },

  {
    // Paid, and priced under the SUPERSEDED 68% agreement, because that is what
    // was in force when the work was done. Amir is on 72% today.
    number: "NL-STL-1030",
    status: "paid",
    payeeKey: "amir",
    agreement: AGREEMENTS.amirPercentageV1,
    weeksAgo: 3,
    loads: [
      {
        ref: "NL-24710",
        lane: "Chicago, IL → Nashville, TN",
        performedDaysAgo: 23,
        linehaul: 87_400,
        loaded: 474,
        deadhead: 17,
        invoiceNumber: "INV-4380",
        invoicePaidDaysAgo: 10,
      },
      {
        ref: "NL-24704",
        lane: "Nashville, TN → St. Louis, MO",
        performedDaysAgo: 24,
        linehaul: 51_600,
        loaded: 310,
        deadhead: 11,
        invoiceNumber: "INV-4376",
        invoicePaidDaysAgo: 12,
      },
    ],
    adjustments: [
      {
        kind: "deduction",
        direction: "subtraction",
        label: "Occupational accident insurance",
        cents: 18_500,
      },
      {
        kind: "deduction",
        direction: "subtraction",
        label: "Maintenance escrow",
        cents: 25_000,
        installment: { number: 1, of: 6 },
      },
    ],
    payments: [{ cents: 50_012, method: "ach", reference: "ACH-87744", paidDaysAgo: 17 }],
    dueInDays: -17,
  },

  {
    // An approved non-driver payee on a flat referral fee.
    number: "NL-STL-1028",
    status: "paid",
    payeeKey: "harbor",
    agreement: AGREEMENTS.harborPointReferral,
    weeksAgo: 2,
    loads: [
      { ref: "NL-24742", lane: "Chicago, IL → Pittsburgh, PA", performedDaysAgo: 16, linehaul: 62_700, loaded: 461, deadhead: 22 },
      { ref: "NL-24733", lane: "Cleveland, OH → Chicago, IL", performedDaysAgo: 18, linehaul: 44_900, loaded: 345, deadhead: 9 },
    ],
    payments: [{ cents: 15_000, method: "check", reference: "CHK-2041", paidDaysAgo: 9 }],
    dueInDays: -9,
  },

  {
    // Raised twice by mistake. Voided rather than deleted — it stays visible
    // with its reason, because a settlement that can vanish is not a record.
    number: "NL-STL-1044",
    status: "voided",
    payeeKey: "marisol",
    agreement: AGREEMENTS.marisolLinehaul,
    weeksAgo: 0,
    loads: [
      { ref: "NL-24774", lane: "Chicago, IL → Des Moines, IA", performedDaysAgo: 9, linehaul: 33_800, loaded: 333, deadhead: 12 },
    ],
    voidReason: "Raised twice for the same period. This is the duplicate.",
  },
];

/** Cascade — where the signed-in user is a DRIVER, and sees only their own. */
const CASCADE_SEEDS: SettlementSeed[] = [
  {
    number: "CS-STL-0442",
    status: "needs_review",
    payeeKey: "sam",
    agreement: AGREEMENTS.cascadePerMile,
    weeksAgo: 0,
    loads: [
      {
        ref: "CS-3309",
        lane: "Seattle, WA → Portland, OR",
        performedDaysAgo: 3,
        linehaul: 24_400,
        loaded: 174,
        deadhead: 5,
        accessorials: [{ code: "detention", label: "Detention, 1 hr", cents: 5_000 }],
        invoiceNumber: "INV-CS-2210",
      },
    ],
    adjustments: [
      { kind: "reimbursement", direction: "addition", label: "Lumper, Portland", cents: 8_000, expenseId: "exp_cs_441" },
    ],
    dueInDays: 3,
  },
  {
    number: "CS-STL-0441",
    status: "paid",
    payeeKey: "sam",
    agreement: AGREEMENTS.cascadePerMile,
    weeksAgo: 1,
    loads: [
      { ref: "CS-3294", lane: "Portland, OR → Boise, ID", performedDaysAgo: 9, linehaul: 46_800, loaded: 430, deadhead: 9 },
      { ref: "CS-3288", lane: "Boise, ID → Seattle, WA", performedDaysAgo: 11, linehaul: 52_100, loaded: 501, deadhead: 14 },
    ],
    payments: [{ cents: 53_212, method: "ach", reference: "ACH-CS-1180", paidDaysAgo: 4 }],
    dueInDays: -4,
  },
  {
    // Another Cascade driver. Sam is scoped to their own financials, so this
    // one must never appear for them — not redacted, absent.
    number: "CS-STL-0440",
    status: "approved",
    payeeKey: "owen",
    agreement: AGREEMENTS.cascadePerMile,
    weeksAgo: 1,
    loads: [
      { ref: "CS-3291", lane: "Portland, OR → Bend, OR", performedDaysAgo: 10, linehaul: 31_200, loaded: 258, deadhead: 6 },
    ],
    dueInDays: 1,
  },
];

/** Baxter — a second carrier, so isolation has something to isolate from. */
const BAXTER_SEEDS: SettlementSeed[] = [
  {
    number: "BX-STL-0088",
    status: "ready_for_payment",
    payeeKey: "baxterDriver",
    agreement: AGREEMENTS.baxterPercentage,
    weeksAgo: 1,
    loads: [
      { ref: "BX-1902", lane: "Newark, NJ → Boston, MA", performedDaysAgo: 9, linehaul: 48_600, loaded: 224, deadhead: 12 },
      { ref: "BX-1898", lane: "Boston, MA → Albany, NY", performedDaysAgo: 10, linehaul: 29_400, loaded: 170, deadhead: 5 },
    ],
    dueInDays: 1,
  },
];

const SEEDS_BY_CARRIER: Record<string, SettlementSeed[]> = {
  org_northline: NORTHLINE_SEEDS,
  org_cascade: CASCADE_SEEDS,
  org_baxter: BAXTER_SEEDS,
  // Summit is a dispatch agency that has not settled anything yet. An empty
  // module is a real state, and the screens have to handle it.
  org_summit: [],
  org_meridian: [],
};

/* -------------------------------------------------------------------------- */
/* The store                                                                   */
/* -------------------------------------------------------------------------- */

interface CarrierSettlements {
  settlements: Settlement[];
  periods: SettlementPeriod[];
  /** Next number in this carrier's sequence, for adjustments and revisions. */
  nextSequence: number;
}

class SettlementStore {
  private data: Record<string, CarrierSettlements> | null = null;

  private build(): Record<string, CarrierSettlements> {
    const out: Record<string, CarrierSettlements> = {};
    for (const [carrierOrganizationId, seeds] of Object.entries(SEEDS_BY_CARRIER)) {
      const resolve = loadIdResolver(carrierOrganizationId);
      out[carrierOrganizationId] = {
        settlements: seeds.map((s) => buildSettlement(carrierOrganizationId, s, resolve)),
        periods: periodsFor(carrierOrganizationId),
        nextSequence: 1,
      };
    }
    return out;
  }

  private all(): Record<string, CarrierSettlements> {
    // Lazy, so the loads store is fully seeded before references resolve.
    if (!this.data) this.data = this.build();
    return this.data;
  }

  /**
   * Every read starts here. A carrier that has never settled anything gets an
   * empty partition rather than an error — but a carrier that does not exist at
   * all is a scope error, not an empty list.
   */
  carrier(carrierOrganizationId: string): CarrierSettlements {
    const data = this.all()[carrierOrganizationId];
    if (!data) throw new OrganizationScopeError(carrierOrganizationId, "(no settlement partition)");
    return data;
  }

  /** Guards against a settlement from one carrier being read through another. */
  assertOwned(carrierOrganizationId: string, recordCarrierId: string) {
    if (carrierOrganizationId !== recordCarrierId) {
      throw new OrganizationScopeError(recordCarrierId, carrierOrganizationId);
    }
  }

  /** Replaces a settlement in place. The caller has already checked the rules. */
  replace(next: Settlement) {
    const carrier = this.carrier(next.carrierOrganizationId);
    const i = carrier.settlements.findIndex((s) => s.id === next.id);
    if (i >= 0) carrier.settlements[i] = next;
    else carrier.settlements.push(next);
  }

  add(settlement: Settlement) {
    this.carrier(settlement.carrierOrganizationId).settlements.push(settlement);
  }

  /** Next settlement number in this carrier's sequence. */
  nextNumber(carrierOrganizationId: string, base: string, suffix: string): string {
    const carrier = this.carrier(carrierOrganizationId);
    return `${base}-${suffix}${carrier.nextSequence++}`;
  }

  /** Test helper. Not used by the UI. */
  reset() {
    this.data = null;
  }
}

export const settlementStore = new SettlementStore();
