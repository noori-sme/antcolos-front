import type {
  ActorRef,
  CalculationStep,
  Cents,
  CompensationAgreementSnapshot,
  CompensationComponent,
  CurrencyCode,
  EarningsComponentResult,
  SettlementAccessorial,
  SettlementAdjustment,
  SettlementCalculationSnapshot,
  SettlementDataGap,
  SettlementInvoiceRef,
  SettlementLoadLine,
  SettlementLoadRef,
  SettlementTotals,
} from "@/types";
import { money } from "@/lib/utils/format";
import {
  applyBasisPoints,
  CALCULATION_ENGINE_VERSION,
  centsPerMile,
  formatBasisPoints,
  perMileAmount,
  sumBy,
  sumCents,
} from "./money";

/**
 * THE settlement calculation engine.
 *
 * Pure. It takes confirmed inputs and returns lines, arithmetic and totals; it
 * reads no store, calls no service, and knows nothing about who is asking.
 * That is what makes it testable to the cent, and what lets the same function
 * produce a draft today and reproduce an approved settlement from three years
 * ago — given the same inputs it returns the same answer, forever.
 *
 * Every result carries its working. `steps` is not a debug aid: it is what the
 * breakdown screen renders and what a payee is shown when they ask why they
 * were paid what they were paid.
 */

/* -------------------------------------------------------------------------- */
/* Inputs                                                                      */
/* -------------------------------------------------------------------------- */

/** An accessorial as it arrives, before the agreement has been applied. */
export interface AccessorialInput {
  code: string;
  label: string;
  billedCents: Cents;
  /**
   * Only approved accessorials are paid. An unapproved one still appears on
   * the settlement — as a gap, so somebody chases it, rather than vanishing.
   */
  approved: boolean;
}

/** One load's confirmed figures, before the money has been worked out. */
export interface LoadLineInput {
  id: string;
  load: SettlementLoadRef;
  invoice?: SettlementInvoiceRef;
  /** The agreement effective when `load.performedAt` happened. */
  agreement: CompensationAgreementSnapshot;
  linehaulCents: Cents;
  accessorials: AccessorialInput[];
  /** Gaps the caller already knows about, e.g. a missing POD from Documents. */
  missingData?: SettlementDataGap[];
}

export interface CalculationInput {
  currency: CurrencyCode;
  loadLines: LoadLineInput[];
  adjustments: SettlementAdjustment[];
}

export interface CalculationResult {
  loadLines: SettlementLoadLine[];
  steps: CalculationStep[];
  totals: SettlementTotals;
}

/* -------------------------------------------------------------------------- */
/* Accessorial handling                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Whether shared accessorials are paid as their own lines, or are already
 * inside the percentage.
 *
 * This is the one genuinely easy way to pay a driver twice. If an agreement
 * pays 28% of GROSS revenue, the detention is already in that gross — paying
 * the detention share again on top would overpay, silently, on every load with
 * an accessorial. So sharing is applied separately only when the percentage
 * does not already reach the accessorials: a linehaul-only percentage, or an
 * agreement with no percentage component at all (a per-mile driver still gets
 * their detention).
 */
function accessorialsAreInsidePercentage(agreement: CompensationAgreementSnapshot): boolean {
  return agreement.components.some(
    (c) =>
      c.kind === "percentage" &&
      (c.percentageBasis === "gross_revenue" ||
        c.percentageBasis === "linehaul_plus_shared_accessorials"),
  );
}

function shareBasisPointsFor(
  agreement: CompensationAgreementSnapshot,
  code: string,
): number {
  return agreement.accessorialSharing.find((r) => r.code === code)?.shareBasisPoints ?? 0;
}

/** Resolves each accessorial against the agreement's sharing rules. */
function resolveAccessorials(
  agreement: CompensationAgreementSnapshot,
  inputs: readonly AccessorialInput[],
): SettlementAccessorial[] {
  const absorbed = accessorialsAreInsidePercentage(agreement);
  return inputs.map((a) => {
    const shareBasisPoints = shareBasisPointsFor(agreement, a.code);
    // An unapproved accessorial is never paid, whatever the agreement says.
    const payable = a.approved && !absorbed && shareBasisPoints > 0;
    return {
      code: a.code,
      label: a.label,
      billedCents: a.billedCents,
      shareBasisPoints,
      payeeShareCents: payable ? applyBasisPoints(a.billedCents, shareBasisPoints) : 0,
      includedInPercentageBasis: absorbed && a.approved && shareBasisPoints > 0,
      approved: a.approved,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Percentage bases                                                            */
/* -------------------------------------------------------------------------- */

/** Linehaul plus every approved accessorial, as billed. */
function grossRevenueOf(linehaulCents: Cents, accessorials: readonly SettlementAccessorial[]): Cents {
  return linehaulCents + sumBy(accessorials.filter((a) => a.approved), (a) => a.billedCents);
}

/** Linehaul plus only the approved accessorials the agreement shares. */
function linehaulPlusSharedOf(
  linehaulCents: Cents,
  accessorials: readonly SettlementAccessorial[],
): Cents {
  return (
    linehaulCents +
    sumBy(
      accessorials.filter((a) => a.approved && a.shareBasisPoints > 0),
      (a) => a.billedCents,
    )
  );
}

function percentageBasisAmount(
  component: CompensationComponent,
  linehaulCents: Cents,
  accessorials: readonly SettlementAccessorial[],
): { amount: Cents; label: string } {
  switch (component.percentageBasis) {
    case "gross_revenue":
      return { amount: grossRevenueOf(linehaulCents, accessorials), label: "gross revenue" };
    case "linehaul_plus_shared_accessorials":
      return {
        amount: linehaulPlusSharedOf(linehaulCents, accessorials),
        label: "linehaul plus shared accessorials",
      };
    case "linehaul":
    default:
      return { amount: linehaulCents, label: "linehaul" };
  }
}

const MILEAGE_BASIS_LABEL: Record<NonNullable<CompensationComponent["mileageBasis"]>, string> = {
  loaded: "loaded miles",
  deadhead: "deadhead miles",
  loaded_plus_deadhead: "loaded + deadhead miles",
};

function milesFor(component: CompensationComponent, load: SettlementLoadRef): number {
  switch (component.mileageBasis) {
    case "loaded_plus_deadhead": return load.loadedMiles + load.deadheadMiles;
    case "deadhead": return load.deadheadMiles;
    case "loaded":
    default: return load.loadedMiles;
  }
}

/* -------------------------------------------------------------------------- */
/* Components                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Applies one compensation component to one load.
 *
 * A "combined" agreement is not a special case here — it is simply an
 * agreement with more than one component, so this function runs more than
 * once. There is one code path for all four compensation methods.
 */
function applyComponent(
  component: CompensationComponent,
  line: LoadLineInput,
  accessorials: readonly SettlementAccessorial[],
): { result: EarningsComponentResult; gaps: SettlementDataGap[] } {
  const gaps: SettlementDataGap[] = [];

  switch (component.kind) {
    case "percentage": {
      const bps = component.percentageBasisPoints ?? 0;
      const { amount, label } = percentageBasisAmount(component, line.linehaulCents, accessorials);
      if (line.linehaulCents <= 0) {
        gaps.push({
          kind: "missing_rate",
          summary: `Load ${line.load.referenceSnapshot} has no rate, so the percentage cannot be worked out.`,
          entityId: line.load.loadId,
          blocksApproval: true,
        });
      }
      return {
        result: {
          componentId: component.id,
          kind: "percentage",
          label: component.label,
          explanation: `${formatBasisPoints(bps)} of ${money(amount)} ${label}`,
          basisValue: amount,
          amountCents: applyBasisPoints(amount, bps),
        },
        gaps,
      };
    }

    case "per_mile": {
      const rate = component.perMileRateCents ?? 0;
      const miles = milesFor(component, line.load);
      const basisLabel = MILEAGE_BASIS_LABEL[component.mileageBasis ?? "loaded"];
      // Deadhead is legitimately zero on a load that started where the last one
      // ended, so only loaded mileage being absent is a gap worth raising.
      if (miles <= 0 && component.mileageBasis !== "deadhead") {
        gaps.push({
          kind: "missing_miles",
          summary: `Load ${line.load.referenceSnapshot} has no mileage, so per-mile pay cannot be worked out.`,
          entityId: line.load.loadId,
          blocksApproval: true,
        });
      }
      return {
        result: {
          componentId: component.id,
          kind: "per_mile",
          label: component.label,
          explanation: `${money(rate)}/mi × ${miles.toLocaleString("en-US")} ${basisLabel}`,
          basisValue: miles,
          amountCents: perMileAmount(rate, miles),
        },
        gaps,
      };
    }

    case "fixed":
    default: {
      const amount = component.fixedAmountCents ?? 0;
      return {
        result: {
          componentId: component.id,
          kind: "fixed",
          label: component.label,
          explanation: `Flat ${money(amount)} for the load`,
          basisValue: amount,
          amountCents: amount,
        },
        gaps,
      };
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Load lines                                                                  */
/* -------------------------------------------------------------------------- */

/** Works out one load's earnings, and what it was missing. */
export function calculateLoadLine(input: LoadLineInput): SettlementLoadLine {
  const accessorials = resolveAccessorials(input.agreement, input.accessorials);
  const gaps: SettlementDataGap[] = [...(input.missingData ?? [])];

  if (input.agreement.components.length === 0) {
    gaps.push({
      kind: "missing_agreement",
      summary: `No compensation terms were in effect when load ${input.load.referenceSnapshot} ran, so it cannot be paid.`,
      entityId: input.load.loadId,
      blocksApproval: true,
    });
  }

  const components: EarningsComponentResult[] = [];
  for (const component of input.agreement.components) {
    const { result, gaps: componentGaps } = applyComponent(component, input, accessorials);
    components.push(result);
    gaps.push(...componentGaps);
  }

  // An accessorial nobody approved is not silently dropped — it is raised, so
  // the office either approves it or tells the driver why not.
  for (const a of accessorials) {
    if (!a.approved) {
      gaps.push({
        kind: "unapproved_expense",
        summary: `${a.label} on load ${input.load.referenceSnapshot} has not been approved, so it is not being paid.`,
        entityId: input.load.loadId,
        blocksApproval: false,
      });
    }
  }

  const componentEarnings = sumBy(components, (c) => c.amountCents);
  const accessorialEarnings = sumBy(accessorials, (a) => a.payeeShareCents);

  return {
    id: input.id,
    load: input.load,
    invoice: input.invoice,
    agreement: input.agreement,
    grossRevenueCents: grossRevenueOf(input.linehaulCents, accessorials),
    linehaulCents: input.linehaulCents,
    accessorials,
    components,
    earningsCents: componentEarnings + accessorialEarnings,
    missingData: gaps,
  };
}

/* -------------------------------------------------------------------------- */
/* Totals                                                                      */
/* -------------------------------------------------------------------------- */

/** The signed effect of one adjustment on the net. */
function signedAmount(adjustment: SettlementAdjustment): Cents {
  return adjustment.direction === "addition" ? adjustment.amountCents : -adjustment.amountCents;
}

function signedTotalFor(
  adjustments: readonly SettlementAdjustment[],
  kind: SettlementAdjustment["kind"],
): Cents {
  return sumBy(adjustments.filter((a) => a.kind === kind), signedAmount);
}

export function calculateTotals(
  currency: CurrencyCode,
  loadLines: readonly SettlementLoadLine[],
  adjustments: readonly SettlementAdjustment[],
): SettlementTotals {
  const linehaulEarningsCents = sumCents(
    loadLines.map((l) => sumBy(l.components, (c) => c.amountCents)),
  );
  const accessorialEarningsCents = sumCents(
    loadLines.map((l) => sumBy(l.accessorials, (a) => a.payeeShareCents)),
  );
  const grossEarningsCents = linehaulEarningsCents + accessorialEarningsCents;

  const totalAdditionsCents = sumBy(
    adjustments.filter((a) => a.direction === "addition"),
    (a) => a.amountCents,
  );
  const totalSubtractionsCents = sumBy(
    adjustments.filter((a) => a.direction === "subtraction"),
    (a) => a.amountCents,
  );

  const netPayCents = grossEarningsCents + totalAdditionsCents - totalSubtractionsCents;
  const totalMiles = sumCents(loadLines.map((l) => l.load.loadedMiles));

  const totals: SettlementTotals = {
    currency,
    grossLoadRevenueCents: sumBy(loadLines, (l) => l.grossRevenueCents),
    linehaulEarningsCents,
    accessorialEarningsCents,
    grossEarningsCents,
    commissionCents: signedTotalFor(adjustments, "commission"),
    reimbursementsCents: signedTotalFor(adjustments, "reimbursement"),
    fuelAdvancesCents: signedTotalFor(adjustments, "fuel_advance"),
    lumperCents: signedTotalFor(adjustments, "lumper"),
    otherExpensesCents: signedTotalFor(adjustments, "other_expense"),
    deductionsCents: signedTotalFor(adjustments, "deduction"),
    adjustmentsCents: signedTotalFor(adjustments, "adjustment"),
    totalAdditionsCents,
    totalSubtractionsCents,
    netPayCents,
    loadCount: loadLines.length,
    totalMiles,
    netPerMileCents: centsPerMile(netPayCents, totalMiles),
  };

  assertTotalsConsistent(totals);
  return totals;
}

/**
 * The per-kind signed totals and the directional totals are two views of the
 * same adjustments. If they ever disagree, an adjustment kind has been added
 * without being summed — a silent way to lose money off a statement. Checked
 * here rather than trusted.
 */
function assertTotalsConsistent(totals: SettlementTotals): void {
  const byKind = sumCents([
    totals.commissionCents,
    totals.reimbursementsCents,
    totals.fuelAdvancesCents,
    totals.lumperCents,
    totals.otherExpensesCents,
    totals.deductionsCents,
    totals.adjustmentsCents,
  ]);
  const byDirection = totals.totalAdditionsCents - totals.totalSubtractionsCents;
  if (byKind !== byDirection) {
    throw new Error(
      `Settlement totals disagree: adjustments by kind sum to ${byKind}, by direction to ${byDirection}`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* The working                                                                 */
/* -------------------------------------------------------------------------- */

const ADJUSTMENT_STEP_LABEL: Record<SettlementAdjustment["kind"], string> = {
  commission: "Commission",
  reimbursement: "Reimbursement",
  deduction: "Deduction",
  fuel_advance: "Fuel advance",
  lumper: "Lumper",
  other_expense: "Expense",
  adjustment: "Correction",
};

/** Builds the ordered, human-readable arithmetic behind the net pay. */
export function buildCalculationSteps(
  loadLines: readonly SettlementLoadLine[],
  adjustments: readonly SettlementAdjustment[],
  totals: SettlementTotals,
): CalculationStep[] {
  const steps: CalculationStep[] = [];
  let order = 1;

  for (const line of loadLines) {
    for (const component of line.components) {
      steps.push({
        order: order++,
        label: `${line.load.referenceSnapshot} — ${component.label}`,
        detail: component.explanation,
        amountCents: component.amountCents,
        loadId: line.load.loadId,
        group: "earnings",
      });
    }
    for (const a of line.accessorials) {
      if (a.payeeShareCents > 0) {
        steps.push({
          order: order++,
          label: `${line.load.referenceSnapshot} — ${a.label}`,
          detail: `${formatBasisPoints(a.shareBasisPoints)} of ${money(a.billedCents)} billed`,
          amountCents: a.payeeShareCents,
          loadId: line.load.loadId,
          group: "accessorial",
        });
      } else if (a.includedInPercentageBasis) {
        // Shown at zero on purpose: the payee IS paid for it, inside the
        // percentage above. A statement that omitted it would look like the
        // accessorial had been pocketed.
        steps.push({
          order: order++,
          label: `${line.load.referenceSnapshot} — ${a.label}`,
          detail: `${money(a.billedCents)} billed, already inside the percentage above`,
          amountCents: 0,
          loadId: line.load.loadId,
          group: "accessorial",
        });
      }
    }
  }

  steps.push({
    order: order++,
    label: "Gross earnings",
    detail: `${totals.loadCount} ${totals.loadCount === 1 ? "load" : "loads"}`,
    amountCents: totals.grossEarningsCents,
    group: "total",
  });

  for (const adjustment of adjustments) {
    const prefix = ADJUSTMENT_STEP_LABEL[adjustment.kind];
    const installment = adjustment.installment
      ? ` (${adjustment.installment.number} of ${adjustment.installment.of})`
      : "";
    steps.push({
      order: order++,
      label: `${prefix} — ${adjustment.label}${installment}`,
      detail: adjustment.note ?? (adjustment.direction === "addition" ? "Paid to the payee" : "Withheld"),
      amountCents: signedAmount(adjustment),
      loadId: adjustment.loadId,
      group: adjustment.direction === "addition" ? "addition" : "subtraction",
    });
  }

  steps.push({
    order: order++,
    label: "Net pay",
    detail: `Gross earnings ${money(totals.grossEarningsCents)} + additions ${money(
      totals.totalAdditionsCents,
    )} − subtractions ${money(totals.totalSubtractionsCents)}`,
    amountCents: totals.netPayCents,
    group: "total",
  });

  return steps;
}

/* -------------------------------------------------------------------------- */
/* The whole calculation                                                       */
/* -------------------------------------------------------------------------- */

export function calculate(input: CalculationInput): CalculationResult {
  const loadLines = input.loadLines.map(calculateLoadLine);
  const totals = calculateTotals(input.currency, loadLines, input.adjustments);
  const steps = buildCalculationSteps(loadLines, input.adjustments, totals);
  return { loadLines, steps, totals };
}

/**
 * Wraps a calculation into the snapshot that gets stored on the settlement.
 *
 * `revision` increments on each recalculation while the settlement is still
 * editable. Once approved the snapshot is frozen and this is never called for
 * that settlement again — which is precisely why a later change to a contract
 * or a profile cannot rewrite a historical settlement.
 */
export function buildSnapshot(args: {
  id: string;
  settlementId: string;
  revision: number;
  computedAt: string;
  computedBy: ActorRef;
  result: CalculationResult;
  adjustments: SettlementAdjustment[];
}): SettlementCalculationSnapshot {
  const agreementIds = Array.from(
    new Set(args.result.loadLines.map((l) => l.agreement.agreementId)),
  );
  return {
    id: args.id,
    settlementId: args.settlementId,
    revision: args.revision,
    computedAt: args.computedAt,
    computedBy: args.computedBy,
    engineVersion: CALCULATION_ENGINE_VERSION,
    frozen: false,
    inputs: {
      loadLines: args.result.loadLines,
      adjustments: args.adjustments,
      agreementIds,
    },
    steps: args.result.steps,
    totals: args.result.totals,
  };
}

/* -------------------------------------------------------------------------- */
/* Gaps                                                                        */
/* -------------------------------------------------------------------------- */

export function allDataGaps(loadLines: readonly SettlementLoadLine[]): SettlementDataGap[] {
  return loadLines.flatMap((l) => l.missingData);
}

export function blockingDataGaps(loadLines: readonly SettlementLoadLine[]): SettlementDataGap[] {
  return allDataGaps(loadLines).filter((g) => g.blocksApproval);
}
