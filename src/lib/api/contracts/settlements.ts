import type {
  Cents,
  DisputeReason,
  DisputeResolution,
  Page,
  PageRequest,
  PayeeKind,
  PayeePrivacy,
  PayeeRef,
  PaymentMethod,
  Settlement,
  SettlementAdjustmentKind,
  SettlementAttentionItem,
  SettlementCalculationSnapshot,
  SettlementFilters,
  SettlementPeriod,
  SettlementSort,
  SettlementStatement,
  SettlementSummary,
} from "@/types";
import type { ServiceContext } from "./context";

/**
 * The settlements seam.
 *
 * Three rules hold for every method below, and the adapter — not the UI —
 * enforces all three:
 *
 *  1. CARRIER ISOLATION. Results are narrowed to `ctx.organizationId`. A
 *     settlement belonging to another carrier is NOT FOUND, never "forbidden";
 *     a 403 would confirm the record exists.
 *  2. PAYEE PRIVACY. A membership scoped to its own financials receives only
 *     the settlements it is the payee of — in full, and nobody else's at all.
 *     It is not a redacted view of the carrier's list; it is a different list.
 *  3. IMMUTABILITY. No method edits an approved, disputed, queued, paid or
 *     voided settlement. `createAdjustment` is the only correction path, and
 *     it creates a new record with its own UUID.
 *
 * Deliberately absent: anything that moves money. There is no `payNow`, no
 * bank account, no ACH file, no payroll export and no accounting push.
 * `recordPayment` writes down that a payment happened somewhere else.
 */

/* -------------------------------------------------------------------------- */
/* Inputs                                                                      */
/* -------------------------------------------------------------------------- */

export interface ApproveSettlementInput {
  note?: string;
}

export interface RaiseDisputeInput {
  reason: DisputeReason;
  /** The payee's own words. Shown verbatim to whoever resolves it. */
  summary: string;
  relatedLoadId?: string;
  relatedAdjustmentId?: string;
  claimedAmountCents?: Cents;
}

export interface DisputeMessageInput {
  body: string;
}

export interface ResolveDisputeInput {
  resolution: DisputeResolution;
  note: string;
  /**
   * For a resolution of "adjusted": the correction to raise. The disputed
   * settlement is never edited — this becomes a new adjustment settlement,
   * linked both ways.
   */
  adjustment?: CreateAdjustmentInput;
}

export interface AdjustmentLineInput {
  kind: SettlementAdjustmentKind;
  direction: "addition" | "subtraction";
  label: string;
  /** Always positive; `direction` carries the sign. */
  amountCents: Cents;
  loadId?: string;
  note?: string;
}

export interface CreateAdjustmentInput {
  /** Why this correction exists, for the audit trail and the statement. */
  reason: string;
  lines: AdjustmentLineInput[];
}

export interface RecordPaymentInput {
  amountCents: Cents;
  method: PaymentMethod;
  /** Check number or transfer reference. Never an account number. */
  referenceNumber?: string;
  paidAt: string;
  note?: string;
}

export interface VoidSettlementInput {
  reason: string;
}

/* -------------------------------------------------------------------------- */
/* Views                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A settlement plus what the caller is allowed to do with it.
 *
 * The capabilities are computed at the seam from permissions, status and the
 * caller's relationship to the payee — so a screen renders the buttons the
 * service will actually honour, rather than guessing and failing on click.
 */
export interface SettlementView {
  settlement: Settlement;
  privacy: PayeePrivacy;
  /**
   * Which of the settlement's referenced Loads the caller can actually open.
   *
   * The Loads module owns those records and is built separately, so a
   * settlement can legitimately reference a load this caller cannot reach — an
   * archived period, or one outside their record scope. Only the seam knows,
   * so the seam says, and a screen links a load reference only when it appears
   * here. Everything else renders from the snapshot, which never goes missing.
   */
  resolvableLoadIds: string[];
  capabilities: {
    canRecalculate: boolean;
    canSubmitForReview: boolean;
    canApprove: boolean;
    canDispute: boolean;
    canResolveDispute: boolean;
    canMarkReadyForPayment: boolean;
    canRecordPayment: boolean;
    canCreateAdjustment: boolean;
    canVoid: boolean;
    canGenerateStatement: boolean;
    canExport: boolean;
  };
}

/** Totals across a filtered list. Only ever returned to a carrier-full caller. */
export interface SettlementListTotals {
  settlementCount: number;
  netPayCents: Cents;
  outstandingCents: Cents;
  overdueCount: number;
  disputedCount: number;
  blockedCount: number;
}

/* -------------------------------------------------------------------------- */
/* The service                                                                 */
/* -------------------------------------------------------------------------- */

export interface SettlementsService {
  /**
   * Summaries only — never whole settlements. A list has no business carrying
   * snapshots, audit trails or dispute threads across the wire.
   */
  list(
    ctx: ServiceContext,
    filters?: SettlementFilters,
    sort?: SettlementSort,
    page?: PageRequest,
  ): Promise<Page<SettlementSummary>>;

  /** Roll-up for the filtered list. Null for a payee viewing their own. */
  listTotals(ctx: ServiceContext, filters?: SettlementFilters): Promise<SettlementListTotals | null>;

  get(ctx: ServiceContext, settlementId: string): Promise<SettlementView>;

  /** The frozen arithmetic behind the net pay. */
  breakdown(ctx: ServiceContext, settlementId: string): Promise<SettlementCalculationSnapshot>;

  /** Append-only history. */
  audit(ctx: ServiceContext, settlementId: string): Promise<Settlement["audit"]>;

  /** Periods this carrier settles over, newest first. */
  periods(ctx: ServiceContext): Promise<SettlementPeriod[]>;

  /** Payees with at least one settlement, for the list filters. */
  payees(ctx: ServiceContext, kinds?: PayeeKind[]): Promise<PayeeRef[]>;

  /** Derived attention items. Computed from state, never stored. */
  attention(ctx: ServiceContext): Promise<SettlementAttentionItem[]>;

  // --- Building ------------------------------------------------------------

  /** Re-runs the engine. Draft and needs_review only; never after approval. */
  recalculate(ctx: ServiceContext, settlementId: string): Promise<SettlementView>;

  submitForReview(ctx: ServiceContext, settlementId: string): Promise<SettlementView>;

  // --- Signing off ---------------------------------------------------------

  /** Freezes the calculation snapshot. Refused while a blocking gap remains. */
  approve(
    ctx: ServiceContext,
    settlementId: string,
    input?: ApproveSettlementInput,
  ): Promise<SettlementView>;

  // --- Disputes ------------------------------------------------------------

  raiseDispute(
    ctx: ServiceContext,
    settlementId: string,
    input: RaiseDisputeInput,
  ): Promise<SettlementView>;

  addDisputeMessage(
    ctx: ServiceContext,
    settlementId: string,
    disputeId: string,
    input: DisputeMessageInput,
  ): Promise<SettlementView>;

  resolveDispute(
    ctx: ServiceContext,
    settlementId: string,
    disputeId: string,
    input: ResolveDisputeInput,
  ): Promise<SettlementView>;

  // --- Payment (recording only — Antcolos moves no money) ------------------

  markReadyForPayment(ctx: ServiceContext, settlementId: string): Promise<SettlementView>;

  recordPayment(
    ctx: ServiceContext,
    settlementId: string,
    input: RecordPaymentInput,
  ): Promise<SettlementView>;

  // --- Corrections ---------------------------------------------------------

  /**
   * The only way to correct a settlement that has been signed off. Creates a
   * NEW settlement with its own immutable UUID, linked to the original in both
   * directions. The original is never touched.
   */
  createAdjustment(
    ctx: ServiceContext,
    settlementId: string,
    input: CreateAdjustmentInput,
  ): Promise<SettlementView>;

  void(
    ctx: ServiceContext,
    settlementId: string,
    input: VoidSettlementInput,
  ): Promise<SettlementView>;

  // --- Statements ----------------------------------------------------------

  /** Numbered and tied to one snapshot revision. Regenerating supersedes. */
  generateStatement(ctx: ServiceContext, settlementId: string): Promise<SettlementStatement>;

  statements(ctx: ServiceContext, settlementId: string): Promise<SettlementStatement[]>;
}
