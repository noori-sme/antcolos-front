import type { Cents, CurrencyCode, IsoDateTime } from "./common";
import type { PermissionKey } from "./permission";
import type { ActorRef } from "./user";

/**
 * THE settlement: what one carrier owes one payee for a defined period of work.
 *
 * Everything a settlement is *about* — Loads, Invoices, Documents, Drivers,
 * Owner-Operators, Dispatchers, Dispatch Organizations and expenses — is built
 * in its own module. This module owns none of it. It receives confirmed data
 * through the typed references below and, at the moment the money is worked
 * out, takes a SNAPSHOT.
 *
 * The snapshot is the whole point. A settlement is a financial record of what
 * was agreed at a moment in time. When a driver's percentage changes next
 * month, or a Load's rate is corrected, or a profile is renamed, last month's
 * settlement must say exactly what it said when it was approved. So the
 * references carry ids for navigation and integration, and the snapshots carry
 * the values the math actually used. Nothing recomputes from a live record.
 */

/* -------------------------------------------------------------------------- */
/* Payees                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Who gets paid. A settlement is always between one Carrier and one payee, and
 * the payee kind decides which module owns the underlying record — not what the
 * settlement is allowed to contain.
 */
export type PayeeKind =
  /** Paid by the carrier that employs them. Drivers module. */
  | "company_driver"
  /** Runs their own authority or equipment under the carrier. Drivers module. */
  | "owner_operator"
  /** A person who dispatches freight for commission. Dispatchers module. */
  | "dispatcher"
  /** An agency that dispatches for commission. Dispatch Organizations module. */
  | "dispatch_organization"
  /** Anyone else the carrier has approved to be paid through settlements. */
  | "other_payee";

/**
 * A typed reference to a payee record owned by another module.
 *
 * `displayNameSnapshot` is deliberately a snapshot: a settlement approved for
 * "Amir Haddad" keeps saying "Amir Haddad" after the profile is renamed. The id
 * is what integration resolves; the snapshot is what the statement prints.
 */
export interface PayeeRef {
  /** Permanent id in the owning module. Opaque — never parsed. */
  id: string;
  kind: PayeeKind;
  /** The name as it stood when this settlement was calculated. */
  displayNameSnapshot: string;
  /** For organization payees: their organization id. */
  payeeOrganizationId?: string;
  /** Set when the payee drives, so "own records" scope can resolve. */
  driverProfileId?: string;
  /**
   * Set when the payee signs in to Antcolos. This is how a payee is shown their
   * own settlement and nobody else's — see `PayeePrivacy` below.
   */
  membershipId?: string;
}

/* -------------------------------------------------------------------------- */
/* References into other modules                                               */
/* -------------------------------------------------------------------------- */

/**
 * A Load as this settlement received it. The Loads module owns the record; the
 * fields here are the confirmed values the money was worked out from, frozen.
 */
export interface SettlementLoadRef {
  loadId: string;
  /** The load's human reference, e.g. "NL-24812". Snapshot. */
  referenceSnapshot: string;
  /** "Chicago, IL → Columbus, OH". Snapshot, for the statement. */
  laneSnapshot?: string;
  /** When the work was performed. Decides which agreement applies. */
  performedAt: IsoDateTime;
  deliveredAt?: IsoDateTime;
  loadedMiles: number;
  deadheadMiles: number;
}

/** An Invoice as this settlement received it. The Invoices module owns it. */
export interface SettlementInvoiceRef {
  invoiceId: string;
  numberSnapshot: string;
  issuedAt?: IsoDateTime;
  /** Whether the customer had paid when this settlement was calculated. */
  customerPaidAt?: IsoDateTime;
}

/** A Document as this settlement received it. The Documents module owns it. */
export interface SettlementDocumentRef {
  documentId: string;
  kind: string;
  fileNameSnapshot: string;
}

/**
 * An expense as this settlement received it. The expense module owns approval;
 * a settlement only ever consumes an expense that is already approved, and
 * records which approval it relied on.
 */
export interface SettlementExpenseRef {
  expenseId: string;
  approvedAt: IsoDateTime;
  approvedBySnapshot: string;
  receiptDocumentId?: string;
}

/* -------------------------------------------------------------------------- */
/* Compensation agreements                                                     */
/* -------------------------------------------------------------------------- */

/** How a payee earns. "combined" is any two or more of the others together. */
export type CompensationMethod = "percentage" | "fixed" | "per_mile" | "combined";

/** What a percentage is a percentage *of*. Getting this wrong changes the pay. */
export type PercentageBasis =
  /** Everything the load billed, linehaul plus receivable accessorials. */
  | "gross_revenue"
  /** Linehaul only — accessorials handled separately by the sharing rules. */
  | "linehaul"
  /** Linehaul plus only those accessorials the agreement shares. */
  | "linehaul_plus_shared_accessorials";

/**
 * Which miles a per-mile rate is paid on. Deadhead is separate because plenty
 * of agreements pay it at a different rate from loaded miles, which needs two
 * components rather than one.
 */
export type MileageBasis = "loaded" | "deadhead" | "loaded_plus_deadhead";

/**
 * One term of a compensation agreement. A "combined" agreement is simply an
 * agreement with more than one component; there is no separate shape for it,
 * so the engine has one code path rather than four.
 */
export interface CompensationComponent {
  id: string;
  kind: "percentage" | "fixed" | "per_mile";
  label: string;
  /** Percentage only. Basis points: 2800 = 28.00%. Integers, never floats. */
  percentageBasisPoints?: number;
  percentageBasis?: PercentageBasis;
  /** Fixed only. A flat amount per load. */
  fixedAmountCents?: Cents;
  /** Per-mile only. Rate per mile in cents. */
  perMileRateCents?: Cents;
  mileageBasis?: MileageBasis;
}

/** Whether an accessorial code reaches the payee, and how much of it. */
export interface AccessorialSharingRule {
  /** Accessorial code, e.g. "detention", "lumper", "layover". */
  code: string;
  /** Basis points of the accessorial paid to the payee. 10000 = all of it. */
  shareBasisPoints: number;
}

/**
 * A compensation agreement as it stood when the Load was performed.
 *
 * The agreement itself is owned elsewhere and is effective-dated. This is the
 * frozen copy the settlement math read. `effectiveFrom`/`effectiveTo` are kept
 * so a reviewer can see *which* version was applied and why — the question
 * "why was this load paid at 28% when the driver is on 30%?" has to be
 * answerable from the settlement alone, years later.
 */
export interface CompensationAgreementSnapshot {
  agreementId: string;
  /** Increments in the owning module each time the agreement is amended. */
  agreementVersion: number;
  method: CompensationMethod;
  components: CompensationComponent[];
  accessorialSharing: AccessorialSharingRule[];
  effectiveFrom: IsoDateTime;
  /** Absent while the agreement is still the current one. */
  effectiveTo?: IsoDateTime;
  /** When this copy was taken. */
  capturedAt: IsoDateTime;
}

/* -------------------------------------------------------------------------- */
/* Settlement periods                                                          */
/* -------------------------------------------------------------------------- */

export type SettlementCadence = "weekly" | "biweekly" | "semimonthly" | "monthly" | "custom";

/**
 * The window of work a settlement covers. A load belongs to the period its
 * work was performed in, not the period it was invoiced or paid in.
 */
export interface SettlementPeriod {
  id: string;
  carrierOrganizationId: string;
  label: string;
  cadence: SettlementCadence;
  startAt: IsoDateTime;
  /** Exclusive. A load performed exactly at `endAt` belongs to the next period. */
  endAt: IsoDateTime;
  /** When settlements in this period are expected to be paid. */
  payDate?: IsoDateTime;
  closedAt?: IsoDateTime;
}

/* -------------------------------------------------------------------------- */
/* Earnings and adjustments                                                    */
/* -------------------------------------------------------------------------- */

/** An accessorial as the settlement received it, plus what the payee got. */
export interface SettlementAccessorial {
  code: string;
  label: string;
  /** What the customer was billed. */
  billedCents: Cents;
  /** Basis points of it shared with the payee, from the agreement. */
  shareBasisPoints: number;
  /**
   * billedCents × shareBasisPoints, rounded once — but only when this
   * accessorial is paid on its own. Zero when it already sits inside the
   * percentage basis, so it can never be counted twice.
   */
  payeeShareCents: Cents;
  /**
   * True when the agreement's percentage already applies to this accessorial
   * (a basis of gross revenue, or of linehaul plus shared accessorials). The
   * payee is still paid for it — inside the percentage line above, not as a
   * separate line — and the statement says so rather than showing a bare zero.
   */
  includedInPercentageBasis: boolean;
  /** Approved accessorials only. An unapproved one never reaches a settlement. */
  approved: boolean;
}

/** The result of applying one compensation component to one load. */
export interface EarningsComponentResult {
  componentId: string;
  kind: CompensationComponent["kind"];
  label: string;
  /** Plain-language arithmetic: "28.00% of $1,048.00 gross". */
  explanation: string;
  /** The number the rate was applied to — revenue in cents, or a mile count. */
  basisValue: number;
  amountCents: Cents;
}

/**
 * One Load's contribution to a settlement.
 *
 * Every money field is a snapshot. Recalculating a draft re-reads the Load;
 * recalculating is impossible once the settlement is approved.
 */
export interface SettlementLoadLine {
  id: string;
  load: SettlementLoadRef;
  invoice?: SettlementInvoiceRef;
  /** The agreement effective when `load.performedAt` happened. */
  agreement: CompensationAgreementSnapshot;
  /** Linehaul plus receivable accessorials, as billed to the customer. */
  grossRevenueCents: Cents;
  linehaulCents: Cents;
  accessorials: SettlementAccessorial[];
  /** Per-component working, in the order the engine applied them. */
  components: EarningsComponentResult[];
  /** Sum of `components` plus shared accessorials. What this load earned. */
  earningsCents: Cents;
  /**
   * Data this line needed and did not get. A settlement with any blocked line
   * cannot be approved, and each entry becomes a Needs You item.
   */
  missingData: SettlementDataGap[];
}

/** Something a settlement needs before it can honestly be approved. */
export interface SettlementDataGap {
  kind:
    | "missing_agreement"
    | "missing_rate"
    | "missing_miles"
    | "missing_document"
    | "missing_invoice"
    | "unapproved_expense"
    | "missing_payee_profile";
  /** What is missing, in the operator's language. */
  summary: string;
  /** The record that would resolve it, when there is one to point at. */
  entityId?: string;
  /** Blocks approval outright, rather than merely warning. */
  blocksApproval: boolean;
}

/**
 * Everything that is not load earnings: money added to or taken off the net.
 *
 * Direction is explicit rather than implied by sign, so a negative amount can
 * never silently flip a deduction into a payment. `amountCents` is always
 * positive; `direction` decides which way it moves.
 */
export type SettlementAdjustmentKind =
  /** Commission owed to a dispatcher or dispatch organization. */
  | "commission"
  /** Money the payee spent on the carrier's behalf, paid back in full. */
  | "reimbursement"
  /** Anything withheld: insurance, escrow, plate share, damage, child support. */
  | "deduction"
  /** Money already advanced against this settlement. Recovered here. */
  | "fuel_advance"
  /** Lumper fees the payee paid at a dock. */
  | "lumper"
  /** Any other approved expense. */
  | "other_expense"
  /** A correction carried in from an adjustment settlement. */
  | "adjustment";

export type AdjustmentDirection = "addition" | "subtraction";

export interface SettlementAdjustment {
  id: string;
  kind: SettlementAdjustmentKind;
  direction: AdjustmentDirection;
  label: string;
  /** Always positive. `direction` carries the sign. */
  amountCents: Cents;
  /** Set when the adjustment belongs to one load rather than the period. */
  loadId?: string;
  /** The approved expense this came from, when it came from the expense module. */
  expense?: SettlementExpenseRef;
  /** Receipt or backup, when one exists. */
  document?: SettlementDocumentRef;
  note?: string;
  /** Who put it on the settlement, and when. */
  addedAt: IsoDateTime;
  addedBy: ActorRef;
  /**
   * Recurring deductions often run over several periods — "escrow, 3 of 6".
   * Display only; the schedule itself is owned by the deductions module.
   */
  installment?: { number: number; of: number };
}

/* -------------------------------------------------------------------------- */
/* Totals and the calculation snapshot                                         */
/* -------------------------------------------------------------------------- */

/**
 * Every total a statement shows. All derived; all integer cents.
 *
 * The per-kind fields are SIGNED by their effect on the net: positive when the
 * payee is paid it, negative when it is withheld. So a driver's escrow reads
 * −45000 and a dispatcher's commission reads +45000, and a statement can print
 * each one without first having to look up which way that kind usually runs.
 * Their sum always equals `totalAdditionsCents − totalSubtractionsCents`.
 */
export interface SettlementTotals {
  currency: CurrencyCode;
  /** Gross revenue of every load in the period, as billed to customers. */
  grossLoadRevenueCents: Cents;
  /** The payee's share of linehaul, before accessorials. */
  linehaulEarningsCents: Cents;
  /** The payee's separately-paid share of approved accessorials. */
  accessorialEarningsCents: Cents;
  /** linehaul + accessorial earnings. What the loads earned the payee. */
  grossEarningsCents: Cents;
  /** Signed. Positive when paid to the payee, negative when withheld. */
  commissionCents: Cents;
  reimbursementsCents: Cents;
  fuelAdvancesCents: Cents;
  lumperCents: Cents;
  otherExpensesCents: Cents;
  deductionsCents: Cents;
  adjustmentsCents: Cents;
  /** Everything that moves the net up. Always positive. */
  totalAdditionsCents: Cents;
  /** Everything that moves the net down. Always positive. */
  totalSubtractionsCents: Cents;
  /** grossEarnings + additions − subtractions. The number that gets paid. */
  netPayCents: Cents;
  loadCount: number;
  totalMiles: number;
  /** netPay ÷ totalMiles. Sent so every client rounds identically. */
  netPerMileCents: Cents;
}

/** One auditable step of the arithmetic, in the order it was performed. */
export interface CalculationStep {
  order: number;
  label: string;
  /** "28.00% of $1,048.00" — the working, not just the answer. */
  detail: string;
  amountCents: Cents;
  /** Which load produced it, for steps that belong to one. */
  loadId?: string;
  group: "earnings" | "accessorial" | "addition" | "subtraction" | "total";
}

/**
 * The frozen record of how the net pay was reached.
 *
 * This is what makes a settlement survivable. It holds the inputs, the
 * agreement versions, the engine version and every step of arithmetic. Once
 * `frozen` is true nothing recalculates it — a later change to a contract, a
 * profile, a rate or the engine itself cannot rewrite history, because history
 * is not recomputed from live records, it is read from here.
 */
export interface SettlementCalculationSnapshot {
  id: string;
  settlementId: string;
  /** Increments on each recalculation while the settlement is still editable. */
  revision: number;
  computedAt: IsoDateTime;
  computedBy: ActorRef;
  /**
   * The calculation engine that produced this. If the engine changes, old
   * snapshots keep their old version, so a discrepancy is visible rather than
   * silent.
   */
  engineVersion: string;
  /** True once approved. A frozen snapshot is never recomputed or replaced. */
  frozen: boolean;
  frozenAt?: IsoDateTime;
  /** Exactly what the math read. Kept whole so the result is reproducible. */
  inputs: {
    loadLines: SettlementLoadLine[];
    adjustments: SettlementAdjustment[];
    agreementIds: string[];
  };
  steps: CalculationStep[];
  totals: SettlementTotals;
}

/* -------------------------------------------------------------------------- */
/* Status, approval, dispute, payment                                          */
/* -------------------------------------------------------------------------- */

/**
 * Where a settlement is.
 *
 * The order below is the usual path, but it is not a straight line: a disputed
 * settlement returns to needs_review, a partially paid one finishes at paid,
 * and any of them can be voided. `lib/settlements/status.ts` owns the legal
 * transitions; nothing else may invent one.
 */
export type SettlementStatus =
  /** Being built. Recalculates freely. */
  | "draft"
  /** Complete enough to look at, waiting for a human. */
  | "needs_review"
  /** Signed off. The calculation snapshot is frozen from here on. */
  | "approved"
  /** Somebody disagrees with it. Cannot be paid while open. */
  | "disputed"
  /** Approved and queued for payment. Antcolos does not move the money. */
  | "ready_for_payment"
  /** Some of the net has been recorded as paid. */
  | "partially_paid"
  /** The whole net has been recorded as paid. */
  | "paid"
  /** Cancelled. Never edited away — it stays visible, with its reason. */
  | "voided";

export interface SettlementApproval {
  id: string;
  approvedAt: IsoDateTime;
  approvedBy: ActorRef;
  note?: string;
  /** The snapshot revision that was approved. Pins the approval to the math. */
  snapshotRevision: number;
}

export type DisputeReason =
  | "missing_load"
  | "incorrect_rate"
  | "incorrect_miles"
  | "unexpected_deduction"
  | "missing_reimbursement"
  | "incorrect_commission"
  | "other";

export type DisputeStatus = "open" | "under_review" | "resolved" | "withdrawn";

export type DisputeResolution =
  /** The settlement was right. Nothing changes. */
  | "upheld"
  /** The payee was right. An adjustment settlement is raised. */
  | "adjusted"
  /** Raised in error, by the payee themselves. */
  | "withdrawn";

export interface DisputeMessage {
  id: string;
  at: IsoDateTime;
  actor: ActorRef;
  body: string;
}

export interface SettlementDispute {
  id: string;
  settlementId: string;
  status: DisputeStatus;
  reason: DisputeReason;
  /** The payee's own words. */
  summary: string;
  /** The line being disputed, when the dispute is about one. */
  relatedLoadId?: string;
  relatedAdjustmentId?: string;
  /** What the payee believes they are owed, when they name a figure. */
  claimedAmountCents?: Cents;
  raisedAt: IsoDateTime;
  raisedBy: ActorRef;
  /**
   * Where the settlement stood when the dispute was raised. A dispute that is
   * upheld returns the settlement here — a paid settlement goes back to paid,
   * an approved one back to approved. Without this the resolver would have to
   * guess, and a paid settlement could quietly land back in review.
   */
  statusBeforeDispute: SettlementStatus;
  messages: DisputeMessage[];
  resolution?: DisputeResolution;
  resolutionNote?: string;
  resolvedAt?: IsoDateTime;
  resolvedBy?: ActorRef;
  /** Set when resolving raised a correction. */
  adjustmentSettlementId?: string;
}

/**
 * A payment as RECORDED, not as executed.
 *
 * Antcolos does not move money. There is no ACH, no banking, no payroll and no
 * payment execution here, and this record deliberately holds no account
 * details. It is a bookkeeping note that a payment happened elsewhere.
 */
/** How a settlement is paid out. Distinct from the invoice module's
 * PaymentMethod, which is how an invoice is paid IN. */
export type SettlementPaymentMethod = "ach" | "check" | "wire" | "fuel_card" | "cash" | "other";

export interface SettlementPayment {
  id: string;
  settlementId: string;
  amountCents: Cents;
  /** How it was paid, outside Antcolos. No account numbers, ever. */
  method: SettlementPaymentMethod;
  /** Check number, transfer reference — whatever the carrier wants to keep. */
  referenceNumber?: string;
  /** When the money actually moved, per the person recording it. */
  paidAt: IsoDateTime;
  recordedAt: IsoDateTime;
  recordedBy: ActorRef;
  note?: string;
  /** Set when a recorded payment was later reversed. Never deleted. */
  reversedAt?: IsoDateTime;
  reversalReason?: string;
}

/* -------------------------------------------------------------------------- */
/* Audit                                                                       */
/* -------------------------------------------------------------------------- */

export type SettlementAuditAction =
  | "created"
  | "recalculated"
  | "line_added"
  | "line_removed"
  | "adjustment_added"
  | "adjustment_removed"
  | "submitted_for_review"
  | "approved"
  | "snapshot_frozen"
  | "dispute_raised"
  | "dispute_message"
  | "dispute_resolved"
  | "marked_ready_for_payment"
  | "payment_recorded"
  | "payment_reversed"
  | "statement_generated"
  | "voided"
  | "adjustment_settlement_created"
  | "superseded";

/**
 * Append-only. Nothing in this module updates or deletes an audit entry, and a
 * correction is a new entry rather than an edit to an old one.
 */
export interface SettlementAuditEntry {
  id: string;
  settlementId: string;
  at: IsoDateTime;
  actor: ActorRef;
  action: SettlementAuditAction;
  /** What changed, in the operator's language. */
  summary: string;
  /** Status either side of the action, for the transitions that move it. */
  fromStatus?: SettlementStatus;
  toStatus?: SettlementStatus;
  /** Net pay either side, for the actions that move money. */
  fromNetPayCents?: Cents;
  toNetPayCents?: Cents;
  /** The related record, when the action has one. */
  relatedId?: string;
}

/* -------------------------------------------------------------------------- */
/* Statements                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A generated payee statement. Generating one produces an immutable, numbered
 * document tied to one snapshot revision — regenerating after a correction
 * produces a NEW statement rather than reprinting the old number.
 */
export interface SettlementStatement {
  id: string;
  settlementId: string;
  /** Human statement number, unique within the carrier. */
  number: string;
  /** The snapshot revision this statement printed. */
  snapshotRevision: number;
  generatedAt: IsoDateTime;
  generatedBy: ActorRef;
  /** Set once a real document is produced by the Documents module. */
  document?: SettlementDocumentRef;
  /** Superseded when a later statement replaces it. Never deleted. */
  supersededByStatementId?: string;
}

/* -------------------------------------------------------------------------- */
/* The settlement                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Why a settlement exists. An adjustment never rewrites the settlement it
 * corrects — it points at it, and both stay on the record.
 */
export type SettlementKind =
  /** The ordinary settlement for a period. */
  | "regular"
  /** A correction to an already-approved or paid settlement. */
  | "adjustment"
  /** A re-issue that supersedes an earlier version of the same period. */
  | "revision";

export interface Settlement {
  /**
   * Immutable UUID. Assigned once, at creation, and never reused — not when the
   * settlement is corrected, revised, voided or superseded. A correction gets
   * its own UUID and points back with `correctsSettlementId`.
   */
  id: string;
  /** The Carrier that owes the money. The isolation boundary. */
  carrierOrganizationId: string;
  /** Human-facing number, unique within the carrier. */
  number: string;
  kind: SettlementKind;
  status: SettlementStatus;
  payee: PayeeRef;
  period: SettlementPeriod;
  currency: CurrencyCode;

  /** Load earnings. Empty for an adjustment that only carries a correction. */
  loadLines: SettlementLoadLine[];
  adjustments: SettlementAdjustment[];

  /**
   * How the net was reached. Frozen on approval — this is what stops a later
   * contract or profile change from rewriting a historical settlement.
   */
  snapshot: SettlementCalculationSnapshot;
  /** Convenience mirror of `snapshot.totals`, so a list need not open it. */
  totals: SettlementTotals;

  approvals: SettlementApproval[];
  disputes: SettlementDispute[];
  payments: SettlementPayment[];
  statements: SettlementStatement[];
  /** Append-only. The complete history of this record. */
  audit: SettlementAuditEntry[];

  /** 1-based. A revision increments it and points back with `supersedes`. */
  version: number;
  /** Set on a revision: the settlement this one replaces. */
  supersedesSettlementId?: string;
  /** Set on the replaced settlement, once superseded. */
  supersededBySettlementId?: string;
  /** Set on an adjustment: the settlement it corrects. */
  correctsSettlementId?: string;
  /** Set on the corrected settlement: every adjustment raised against it. */
  adjustmentSettlementIds?: string[];

  /** Sum of non-reversed payments. Derived, mirrored for lists. */
  amountPaidCents: Cents;
  /** netPay − amountPaid. Zero when fully paid. */
  amountOutstandingCents: Cents;
  /** When payment is expected. Past this, with money outstanding, is overdue. */
  paymentDueAt?: IsoDateTime;

  createdAt: IsoDateTime;
  createdBy: ActorRef;
  updatedAt: IsoDateTime;
  approvedAt?: IsoDateTime;
  paidAt?: IsoDateTime;
  voidedAt?: IsoDateTime;
  voidReason?: string;
}

/**
 * The list projection. A list never carries snapshots, audit trails or dispute
 * threads — the detail screen asks for those. Keeping them out of the list
 * keeps a payee's full financial history from travelling to a screen that only
 * needed a row.
 */
export interface SettlementSummary {
  id: string;
  carrierOrganizationId: string;
  number: string;
  kind: SettlementKind;
  status: SettlementStatus;
  payee: PayeeRef;
  periodLabel: string;
  periodStartAt: IsoDateTime;
  periodEndAt: IsoDateTime;
  currency: CurrencyCode;
  netPayCents: Cents;
  grossEarningsCents: Cents;
  loadCount: number;
  amountPaidCents: Cents;
  amountOutstandingCents: Cents;
  paymentDueAt?: IsoDateTime;
  openDisputeCount: number;
  blockingGapCount: number;
  updatedAt: IsoDateTime;
}

/* -------------------------------------------------------------------------- */
/* Filters and sorting                                                         */
/* -------------------------------------------------------------------------- */

export interface SettlementFilters {
  /** Matches settlement number, payee name, period label or a load reference. */
  search?: string;
  status?: SettlementStatus[];
  payeeKind?: PayeeKind[];
  payeeId?: string;
  periodId?: string;
  kind?: SettlementKind[];
  /** Named groupings the list offers as tabs. */
  view?:
    | "all"
    | "needs_attention"
    | "awaiting_approval"
    | "disputed"
    | "unpaid"
    | "overdue"
    | "paid";
  /** Period start, inclusive. */
  periodFrom?: string;
  /** Period end, inclusive. */
  periodTo?: string;
  /** Only settlements blocked by missing data. */
  hasBlockingGaps?: boolean;
  /** Only settlements with an open dispute. */
  hasOpenDispute?: boolean;
  /** Only settlements past their payment due date with money outstanding. */
  overdueOnly?: boolean;
  minNetPayCents?: number;
  maxNetPayCents?: number;
}

export type SettlementSortField =
  | "number" | "payee" | "period" | "status" | "netPay" | "outstanding" | "updatedAt";

export interface SettlementSort {
  field: SettlementSortField;
  direction: "asc" | "desc";
}

/* -------------------------------------------------------------------------- */
/* Needs You                                                                   */
/* -------------------------------------------------------------------------- */

/** Why a settlement is asking for a human. */
export type SettlementAttentionKind =
  | "missing_data"
  | "awaiting_approval"
  | "open_dispute"
  | "overdue_payment";

/**
 * A real, derived attention item — computed from settlement state, never
 * hand-written. The Needs You surface renders these alongside its own items.
 */
export interface SettlementAttentionItem {
  id: string;
  kind: SettlementAttentionKind;
  settlementId: string;
  settlementNumber: string;
  carrierOrganizationId: string;
  payee: PayeeRef;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  /** Why this is here, in the operator's language. */
  reason: string;
  /** The money at stake, when there is a figure worth showing. */
  amountCents?: Cents;
  /** Operational deadline, when the item has one. */
  dueAt?: IsoDateTime;
  /** How overdue, in whole days. Only for overdue_payment. */
  daysOverdue?: number;
  /** Permission required to see this item at all. */
  requires: PermissionKey[];
  createdAt: IsoDateTime;
}

/* -------------------------------------------------------------------------- */
/* Privacy                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * How much of a settlement a caller may see.
 *
 * A payee viewing their own settlement is not a weaker version of an
 * accountant: they see their own money in full, and nobody else's at all. This
 * is decided in the service layer and carried on the record so a screen cannot
 * mistake one for the other.
 */
export type PayeePrivacy =
  /** The caller administers settlements for the carrier. */
  | "carrier_full"
  /** The caller IS the payee. Full detail of their own, nothing else. */
  | "payee_self";
