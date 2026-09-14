import { describe, expect, it } from "vitest";
import type {
  ActorRef,
  CompensationAgreementSnapshot,
  SettlementAdjustment,
} from "@/types";
import {
  applyBasisPoints,
  centsPerMile,
  formatBasisPoints,
  perMileAmount,
  sumCents,
} from "./money";
import {
  blockingDataGaps,
  calculate,
  calculateLoadLine,
  type LoadLineInput,
} from "./calculate";
import { agreementEffectiveAt, isEffectiveAt } from "./agreements";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const ACTOR: ActorRef = {
  userId: "usr_test",
  membershipId: "mem_test",
  displayNameSnapshot: "Test",
  source: "web",
};

function agreement(
  over: Partial<CompensationAgreementSnapshot> = {},
): CompensationAgreementSnapshot {
  return {
    agreementId: "cma_test",
    agreementVersion: 1,
    method: "percentage",
    components: [],
    accessorialSharing: [],
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    capturedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function line(over: Partial<LoadLineInput> = {}): LoadLineInput {
  return {
    id: "sll_1",
    load: {
      loadId: "load_1",
      referenceSnapshot: "TL-100",
      performedAt: "2026-06-01T12:00:00.000Z",
      loadedMiles: 500,
      deadheadMiles: 50,
    },
    agreement: agreement(),
    linehaulCents: 100_000,
    accessorials: [],
    ...over,
  };
}

function adjustment(over: Partial<SettlementAdjustment> = {}): SettlementAdjustment {
  return {
    id: "adj_1",
    kind: "deduction",
    direction: "subtraction",
    label: "Test deduction",
    amountCents: 10_000,
    addedAt: "2026-06-02T00:00:00.000Z",
    addedBy: ACTOR,
    ...over,
  };
}

/* -------------------------------------------------------------------------- */
/* Money                                                                       */
/* -------------------------------------------------------------------------- */

describe("money", () => {
  it("applies basis points and rounds exactly once", () => {
    expect(applyBasisPoints(100_000, 2_800)).toBe(28_000);
    expect(applyBasisPoints(104_100, 7_200)).toBe(74_952);
  });

  it("rounds half away from zero, the way a paper statement does", () => {
    // 1 cent at 50% is half a cent, and the payee gets the cent.
    expect(applyBasisPoints(1, 5_000)).toBe(1);
    // 3 cents at 50% is 1.5 -> 2, not banker's-rounded down to 2... (2 either way)
    expect(applyBasisPoints(3, 5_000)).toBe(2);
    // 5 cents at 50% is 2.5 -> 3. Banker's rounding would give 2.
    expect(applyBasisPoints(5, 5_000)).toBe(3);
  });

  it("never produces a fractional cent", () => {
    for (let amount = 0; amount < 2_000; amount += 7) {
      for (const bps of [333, 2_600, 7_200, 9_999]) {
        expect(Number.isInteger(applyBasisPoints(amount, bps))).toBe(true);
      }
    }
  });

  it("refuses non-integer and negative rates rather than guessing", () => {
    expect(() => applyBasisPoints(100.5, 2_800)).toThrow(RangeError);
    expect(() => applyBasisPoints(100, -1)).toThrow(RangeError);
    expect(() => perMileAmount(-58, 100)).toThrow(RangeError);
  });

  it("multiplies per-mile exactly", () => {
    expect(perMileAmount(58, 533)).toBe(30_914);
  });

  it("returns zero rather than Infinity for a settlement with no miles", () => {
    expect(centsPerMile(50_000, 0)).toBe(0);
  });

  it("formats basis points for humans", () => {
    expect(formatBasisPoints(2_800)).toBe("28.00%");
    expect(formatBasisPoints(500)).toBe("5.00%");
    expect(formatBasisPoints(7_250)).toBe("72.50%");
  });

  it("sums without floating point drift", () => {
    expect(sumCents([10, 20, 30])).toBe(60);
  });
});

/* -------------------------------------------------------------------------- */
/* The four compensation methods                                               */
/* -------------------------------------------------------------------------- */

describe("compensation methods", () => {
  it("pays a percentage of linehaul", () => {
    const result = calculateLoadLine(
      line({
        agreement: agreement({
          method: "percentage",
          components: [
            {
              id: "c1",
              kind: "percentage",
              label: "Share",
              percentageBasisPoints: 2_600,
              percentageBasis: "linehaul",
            },
          ],
        }),
      }),
    );
    expect(result.earningsCents).toBe(26_000);
  });

  it("pays a fixed amount per load", () => {
    const result = calculateLoadLine(
      line({
        agreement: agreement({
          method: "fixed",
          components: [
            { id: "c1", kind: "fixed", label: "Flat", fixedAmountCents: 7_500 },
          ],
        }),
      }),
    );
    expect(result.earningsCents).toBe(7_500);
  });

  it("pays per loaded mile", () => {
    const result = calculateLoadLine(
      line({
        agreement: agreement({
          method: "per_mile",
          components: [
            {
              id: "c1",
              kind: "per_mile",
              label: "Mileage",
              perMileRateCents: 55,
              mileageBasis: "loaded",
            },
          ],
        }),
      }),
    );
    expect(result.earningsCents).toBe(27_500);
  });

  it("pays loaded and deadhead miles at different rates", () => {
    const result = calculateLoadLine(
      line({
        agreement: agreement({
          method: "combined",
          components: [
            { id: "c1", kind: "per_mile", label: "Loaded", perMileRateCents: 54, mileageBasis: "loaded" },
            { id: "c2", kind: "per_mile", label: "Deadhead", perMileRateCents: 22, mileageBasis: "deadhead" },
          ],
        }),
      }),
    );
    // 500 loaded x 54c + 50 deadhead x 22c
    expect(result.earningsCents).toBe(27_000 + 1_100);
  });

  it("combines several components into one figure, keeping each one visible", () => {
    const result = calculateLoadLine(
      line({
        agreement: agreement({
          method: "combined",
          components: [
            {
              id: "c1",
              kind: "per_mile",
              label: "Mileage",
              perMileRateCents: 58,
              mileageBasis: "loaded_plus_deadhead",
            },
            { id: "c2", kind: "fixed", label: "Stop pay", fixedAmountCents: 3_000 },
          ],
        }),
      }),
    );
    expect(result.earningsCents).toBe(550 * 58 + 3_000);
    expect(result.components).toHaveLength(2);
    expect(result.components[0].explanation).toContain("loaded + deadhead miles");
    expect(result.components[1].explanation).toContain("Flat");
  });
});

/* -------------------------------------------------------------------------- */
/* Accessorials — the double-pay trap                                          */
/* -------------------------------------------------------------------------- */

describe("accessorial sharing", () => {
  const detention = { code: "detention", label: "Detention", billedCents: 8_000, approved: true };

  it("pays a shared accessorial separately when the percentage is linehaul-only", () => {
    const result = calculateLoadLine(
      line({
        accessorials: [detention],
        agreement: agreement({
          components: [
            {
              id: "c1",
              kind: "percentage",
              label: "Share",
              percentageBasisPoints: 2_600,
              percentageBasis: "linehaul",
            },
          ],
          accessorialSharing: [{ code: "detention", shareBasisPoints: 5_000 }],
        }),
      }),
    );
    // 26% of linehaul, plus half the detention paid on its own.
    expect(result.earningsCents).toBe(26_000 + 4_000);
    expect(result.accessorials[0].payeeShareCents).toBe(4_000);
    expect(result.accessorials[0].includedInPercentageBasis).toBe(false);
  });

  it("does NOT pay a shared accessorial twice when the basis is gross revenue", () => {
    const result = calculateLoadLine(
      line({
        accessorials: [detention],
        agreement: agreement({
          components: [
            {
              id: "c1",
              kind: "percentage",
              label: "Share",
              percentageBasisPoints: 7_200,
              percentageBasis: "gross_revenue",
            },
          ],
          accessorialSharing: [{ code: "detention", shareBasisPoints: 10_000 }],
        }),
      }),
    );
    // 72% of (100_000 + 8_000). The detention is inside that, not on top.
    expect(result.earningsCents).toBe(77_760);
    expect(result.accessorials[0].payeeShareCents).toBe(0);
    expect(result.accessorials[0].includedInPercentageBasis).toBe(true);
  });

  it("pays accessorials to a per-mile payee, who has no percentage to absorb them", () => {
    const result = calculateLoadLine(
      line({
        accessorials: [detention],
        agreement: agreement({
          method: "per_mile",
          components: [
            { id: "c1", kind: "per_mile", label: "Mileage", perMileRateCents: 55, mileageBasis: "loaded" },
          ],
          accessorialSharing: [{ code: "detention", shareBasisPoints: 10_000 }],
        }),
      }),
    );
    expect(result.earningsCents).toBe(27_500 + 8_000);
  });

  it("never pays an unapproved accessorial, and raises it instead of dropping it", () => {
    const result = calculateLoadLine(
      line({
        accessorials: [{ ...detention, approved: false }],
        agreement: agreement({
          method: "per_mile",
          components: [
            { id: "c1", kind: "per_mile", label: "Mileage", perMileRateCents: 55, mileageBasis: "loaded" },
          ],
          accessorialSharing: [{ code: "detention", shareBasisPoints: 10_000 }],
        }),
      }),
    );
    expect(result.earningsCents).toBe(27_500);
    expect(result.missingData.some((g) => g.kind === "unapproved_expense")).toBe(true);
  });

  it("excludes an unapproved accessorial from gross revenue too", () => {
    const result = calculateLoadLine(
      line({ accessorials: [{ ...detention, approved: false }] }),
    );
    expect(result.grossRevenueCents).toBe(100_000);
  });
});

/* -------------------------------------------------------------------------- */
/* Totals and net pay                                                          */
/* -------------------------------------------------------------------------- */

describe("net pay", () => {
  const perMile = agreement({
    method: "per_mile",
    components: [
      { id: "c1", kind: "per_mile", label: "Mileage", perMileRateCents: 55, mileageBasis: "loaded" },
    ],
  });

  it("is gross earnings plus additions minus subtractions", () => {
    const { totals } = calculate({
      currency: "USD",
      loadLines: [line({ agreement: perMile })],
      adjustments: [
        adjustment({ id: "a1", kind: "deduction", direction: "subtraction", amountCents: 5_000 }),
        adjustment({ id: "a2", kind: "reimbursement", direction: "addition", amountCents: 1_200 }),
      ],
    });
    expect(totals.grossEarningsCents).toBe(27_500);
    expect(totals.totalAdditionsCents).toBe(1_200);
    expect(totals.totalSubtractionsCents).toBe(5_000);
    expect(totals.netPayCents).toBe(27_500 + 1_200 - 5_000);
  });

  it("signs each adjustment kind by its effect on the net", () => {
    const { totals } = calculate({
      currency: "USD",
      loadLines: [line({ agreement: perMile })],
      adjustments: [
        adjustment({ id: "a1", kind: "deduction", direction: "subtraction", amountCents: 5_000 }),
        adjustment({ id: "a2", kind: "commission", direction: "addition", amountCents: 9_000 }),
        adjustment({ id: "a3", kind: "fuel_advance", direction: "subtraction", amountCents: 40_000 }),
      ],
    });
    expect(totals.deductionsCents).toBe(-5_000);
    expect(totals.commissionCents).toBe(9_000);
    expect(totals.fuelAdvancesCents).toBe(-40_000);
  });

  it("keeps the per-kind and directional views of the adjustments in agreement", () => {
    const { totals } = calculate({
      currency: "USD",
      loadLines: [line({ agreement: perMile })],
      adjustments: [
        adjustment({ id: "a1", kind: "lumper", direction: "addition", amountCents: 12_500 }),
        adjustment({ id: "a2", kind: "other_expense", direction: "subtraction", amountCents: 700 }),
        adjustment({ id: "a3", kind: "adjustment", direction: "addition", amountCents: 300 }),
      ],
    });
    const byKind =
      totals.commissionCents +
      totals.reimbursementsCents +
      totals.fuelAdvancesCents +
      totals.lumperCents +
      totals.otherExpensesCents +
      totals.deductionsCents +
      totals.adjustmentsCents;
    expect(byKind).toBe(totals.totalAdditionsCents - totals.totalSubtractionsCents);
  });

  it("lets the net go negative when the deductions exceed the earnings", () => {
    // A real and important case: a light week against a fixed escrow. It must
    // produce a negative net honestly rather than clamping to zero.
    const { totals } = calculate({
      currency: "USD",
      loadLines: [],
      adjustments: [adjustment({ amountCents: 25_000 })],
    });
    expect(totals.netPayCents).toBe(-25_000);
  });

  it("reports zero per-mile for a settlement with no miles", () => {
    const { totals } = calculate({
      currency: "USD",
      loadLines: [],
      adjustments: [adjustment({ direction: "addition", kind: "commission", amountCents: 5_000 })],
    });
    expect(totals.totalMiles).toBe(0);
    expect(totals.netPerMileCents).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Reproducibility                                                             */
/* -------------------------------------------------------------------------- */

describe("reproducibility", () => {
  it("returns the same answer for the same inputs, every time", () => {
    const input = {
      currency: "USD" as const,
      loadLines: [
        line({
          accessorials: [
            { code: "detention", label: "Detention", billedCents: 8_000, approved: true },
          ],
          agreement: agreement({
            components: [
              {
                id: "c1",
                kind: "percentage" as const,
                label: "Share",
                percentageBasisPoints: 7_200,
                percentageBasis: "gross_revenue" as const,
              },
            ],
            accessorialSharing: [{ code: "detention", shareBasisPoints: 10_000 }],
          }),
        }),
      ],
      adjustments: [adjustment()],
    };
    const a = calculate(input);
    const b = calculate(input);
    expect(a.totals).toEqual(b.totals);
    expect(a.steps).toEqual(b.steps);
  });

  it("shows its working, step by step, ending at the net", () => {
    const { steps, totals } = calculate({
      currency: "USD",
      loadLines: [
        line({
          agreement: agreement({
            components: [
              {
                id: "c1",
                kind: "percentage",
                label: "Share",
                percentageBasisPoints: 2_600,
                percentageBasis: "linehaul",
              },
            ],
          }),
        }),
      ],
      adjustments: [adjustment()],
    });
    expect(steps[0].detail).toBe("26.00% of $1,000.00 linehaul");
    expect(steps.map((s) => s.order)).toEqual(steps.map((_, i) => i + 1));
    const last = steps[steps.length - 1];
    expect(last.label).toBe("Net pay");
    expect(last.amountCents).toBe(totals.netPayCents);
  });
});

/* -------------------------------------------------------------------------- */
/* Data gaps                                                                   */
/* -------------------------------------------------------------------------- */

describe("data gaps", () => {
  it("blocks a per-mile load that came back with no mileage", () => {
    const result = calculateLoadLine(
      line({
        load: {
          loadId: "load_2",
          referenceSnapshot: "TL-200",
          performedAt: "2026-06-01T12:00:00.000Z",
          loadedMiles: 0,
          deadheadMiles: 0,
        },
        agreement: agreement({
          method: "per_mile",
          components: [
            { id: "c1", kind: "per_mile", label: "Mileage", perMileRateCents: 55, mileageBasis: "loaded" },
          ],
        }),
      }),
    );
    expect(blockingDataGaps([result])).toHaveLength(1);
    expect(blockingDataGaps([result])[0].kind).toBe("missing_miles");
  });

  it("does not treat zero deadhead as missing data", () => {
    const result = calculateLoadLine(
      line({
        load: {
          loadId: "load_3",
          referenceSnapshot: "TL-300",
          performedAt: "2026-06-01T12:00:00.000Z",
          loadedMiles: 400,
          deadheadMiles: 0,
        },
        agreement: agreement({
          method: "combined",
          components: [
            { id: "c1", kind: "per_mile", label: "Loaded", perMileRateCents: 54, mileageBasis: "loaded" },
            { id: "c2", kind: "per_mile", label: "Deadhead", perMileRateCents: 22, mileageBasis: "deadhead" },
          ],
        }),
      }),
    );
    expect(blockingDataGaps([result])).toHaveLength(0);
  });

  it("blocks a load with no compensation terms at all", () => {
    const result = calculateLoadLine(line({ agreement: agreement({ components: [] }) }));
    expect(blockingDataGaps([result])[0].kind).toBe("missing_agreement");
  });

  it("blocks a percentage load with no rate", () => {
    const result = calculateLoadLine(
      line({
        linehaulCents: 0,
        agreement: agreement({
          components: [
            {
              id: "c1",
              kind: "percentage",
              label: "Share",
              percentageBasisPoints: 2_600,
              percentageBasis: "linehaul",
            },
          ],
        }),
      }),
    );
    expect(blockingDataGaps([result])[0].kind).toBe("missing_rate");
  });

  it("carries through gaps another module reported", () => {
    const result = calculateLoadLine(
      line({
        agreement: agreement({
          components: [{ id: "c1", kind: "fixed", label: "Flat", fixedAmountCents: 100 }],
        }),
        missingData: [
          { kind: "missing_document", summary: "No POD.", blocksApproval: true },
        ],
      }),
    );
    expect(blockingDataGaps([result])[0].kind).toBe("missing_document");
  });
});

/* -------------------------------------------------------------------------- */
/* Effective-dated agreements                                                  */
/* -------------------------------------------------------------------------- */

describe("agreement selection", () => {
  const v1 = agreement({
    agreementVersion: 1,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: "2026-07-01T00:00:00.000Z",
  });
  const v2 = agreement({
    agreementVersion: 2,
    effectiveFrom: "2026-07-01T00:00:00.000Z",
  });

  it("uses the agreement in force when the work was performed", () => {
    expect(agreementEffectiveAt([v1, v2], "2026-06-15T00:00:00.000Z")?.agreementVersion).toBe(1);
    expect(agreementEffectiveAt([v1, v2], "2026-08-15T00:00:00.000Z")?.agreementVersion).toBe(2);
  });

  it("treats the boundary as half-open, so one instant maps to one version", () => {
    expect(isEffectiveAt(v1, "2026-07-01T00:00:00.000Z")).toBe(false);
    expect(isEffectiveAt(v2, "2026-07-01T00:00:00.000Z")).toBe(true);
  });

  it("returns null rather than falling back to the newest terms", () => {
    expect(agreementEffectiveAt([v1, v2], "2025-12-31T00:00:00.000Z")).toBeNull();
  });

  it("does not let a later agreement change what an older load already earned", () => {
    const load = line({
      load: {
        loadId: "load_old",
        referenceSnapshot: "TL-OLD",
        performedAt: "2026-06-15T00:00:00.000Z",
        loadedMiles: 500,
        deadheadMiles: 0,
      },
    });
    const pick = (at: string) =>
      agreementEffectiveAt(
        [
          { ...v1, components: [{ id: "c", kind: "percentage", label: "Share", percentageBasisPoints: 6_800, percentageBasis: "gross_revenue" }] },
          { ...v2, components: [{ id: "c", kind: "percentage", label: "Share", percentageBasisPoints: 7_200, percentageBasis: "gross_revenue" }] },
        ],
        at,
      )!;

    const asPerformed = calculateLoadLine({ ...load, agreement: pick(load.load.performedAt) });
    const asToday = calculateLoadLine({ ...load, agreement: pick("2026-09-14T00:00:00.000Z") });

    expect(asPerformed.earningsCents).toBe(68_000);
    // Reading today's agreement instead would silently overpay by $40 a load.
    expect(asToday.earningsCents).toBe(72_000);
  });
});
