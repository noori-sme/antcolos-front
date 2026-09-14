import type {
  Page,
  PageRequest,
  PayeeKind,
  PayeePrivacy,
  PayeeRef,
  PermissionKey,
  Settlement,
  SettlementAdjustment,
  SettlementAttentionItem,
  SettlementAuditAction,
  SettlementAuditEntry,
  SettlementCalculationSnapshot,
  SettlementDispute,
  SettlementFilters,
  SettlementPeriod,
  SettlementSort,
  SettlementStatement,
  SettlementStatus,
  SettlementSummary,
} from "@/types";
import { money } from "@/lib/utils/format";
import {
  acceptsPayment,
  assertTransition,
  attentionItemsFor,
  blockingDataGaps,
  buildSnapshot,
  calculate,
  isEditable,
  requiresAdjustmentToCorrect,
  sortAttentionItems,
  statusAfterPayment,
  type LoadLineInput,
} from "@/lib/settlements";
import {
  NotFoundError,
  PermissionDeniedError,
  type ServiceContext,
} from "../contracts/context";
import type {
  ApproveSettlementInput,
  CreateAdjustmentInput,
  DisputeMessageInput,
  RaiseDisputeInput,
  RecordPaymentInput,
  ResolveDisputeInput,
  SettlementListTotals,
  SettlementsService,
  SettlementView,
  VoidSettlementInput,
} from "../contracts/settlements";
import { settlementStore } from "./settlement-registry";
import { settlementUuid, SYSTEM_ACTOR } from "./settlement-seed";
import { mockStore } from "./store";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The settlement service. This is the boundary.
 *
 * Every rule the module claims is enforced HERE, not in a screen: carrier
 * isolation, payee privacy, permissions, separation of duties, the status
 * machine, and the one that matters most — an approved or paid settlement is
 * never edited. A UI bug that renders a forbidden button still fails at this
 * seam, which is the whole point of having it.
 *
 * What is deliberately NOT here: anything that moves money. No ACH, no banking,
 * no payroll, no tax filing, no accounting push, no payment execution.
 * `recordPayment` writes down that a payment happened somewhere else.
 */

/**
 * Fake network latency, so the screens are built against a service that takes
 * time rather than one that resolves instantly. Dropped under test, where it
 * only buys a slower suite.
 */
const LATENCY_MS = process.env.VITEST ? 0 : 220;
const wait = () =>
  LATENCY_MS === 0 ? Promise.resolve() : new Promise<void>((r) => setTimeout(r, LATENCY_MS));

let rowSeq = 0;
const rowId = (prefix: string) => `${prefix}_${(++rowSeq).toString(36).padStart(4, "0")}`;

const nowIso = () => new Date().toISOString();

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

/** Refusing to edit a settlement that has been signed off is not a failure. */
export class SettlementImmutableError extends Error {
  constructor(readonly settlementId: string, readonly status: SettlementStatus) {
    super(
      `Settlement ${settlementId} is ${status} and cannot be edited. Raise an adjustment instead.`,
    );
    this.name = "SettlementImmutableError";
  }
}

/** Somebody may not approve, pay or correct their own settlement. */
export class SeparationOfDutiesError extends Error {
  constructor(readonly action: string) {
    super(`You cannot ${action} a settlement you are the payee of.`);
    this.name = "SeparationOfDutiesError";
  }
}

export class SettlementNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettlementNotReadyError";
  }
}

/* -------------------------------------------------------------------------- */
/* Access                                                                      */
/* -------------------------------------------------------------------------- */

function requirePermissions(ctx: ServiceContext, ...keys: PermissionKey[]): void {
  const missing = keys.filter((k) => !ctx.permissions.has(k));
  if (missing.length > 0) throw new PermissionDeniedError(missing);
}

/**
 * Which of the two views the caller gets.
 *
 * A payee looking at their own settlement is not a weaker version of an
 * accountant: they see their own money in full and nobody else's at all. It is
 * a different list, not a redacted one.
 */
function privacyFor(ctx: ServiceContext): PayeePrivacy {
  return ctx.scope.financials === "own" ? "payee_self" : "carrier_full";
}

/** True when the caller IS the payee of this settlement. */
function isOwnPayee(ctx: ServiceContext, settlement: Settlement): boolean {
  const { payee } = settlement;
  if (ctx.driverProfileId && payee.driverProfileId === ctx.driverProfileId) return true;
  if (payee.membershipId && payee.membershipId === ctx.membershipId) return true;
  return false;
}

/**
 * The carrier's settlements, narrowed by the caller's privacy.
 *
 * Both narrowings happen here, once. Nothing downstream re-filters, so there is
 * no second code path where one of them could be forgotten.
 */
function visibleSettlements(ctx: ServiceContext): Settlement[] {
  requirePermissions(ctx, "settlements:view");
  const all = settlementStore.carrier(ctx.organizationId).settlements;
  if (privacyFor(ctx) === "payee_self") {
    return all.filter((s) => isOwnPayee(ctx, s));
  }
  return all;
}

/**
 * A settlement outside the caller's carrier or privacy is NOT FOUND, never
 * "forbidden" — a 403 would confirm the record exists, which for another
 * payee's pay statement is itself the leak.
 */
function mustFind(ctx: ServiceContext, settlementId: string): Settlement {
  const settlement = visibleSettlements(ctx).find((s) => s.id === settlementId);
  if (!settlement) throw new NotFoundError("Settlement");
  settlementStore.assertOwned(ctx.organizationId, settlement.carrierOrganizationId);
  return settlement;
}

/** Administering settlements is a carrier-side job, never a payee-side one. */
function assertCarrierAdministrator(ctx: ServiceContext): void {
  if (privacyFor(ctx) !== "carrier_full") {
    throw new PermissionDeniedError(["settlements:create"]);
  }
}

/**
 * Separation of duties: nobody signs off, pays out or corrects their own money,
 * however broad their permissions are. A carrier owner who is also an
 * owner-operator is exactly the case this exists for.
 */
function assertNotOwnPayee(ctx: ServiceContext, settlement: Settlement, action: string): void {
  if (isOwnPayee(ctx, settlement)) throw new SeparationOfDutiesError(action);
}

/** The rule the whole module is built around, in one place. */
function assertEditable(settlement: Settlement): void {
  if (!isEditable(settlement.status)) {
    throw new SettlementImmutableError(settlement.id, settlement.status);
  }
}

/* -------------------------------------------------------------------------- */
/* Capabilities                                                                */
/* -------------------------------------------------------------------------- */

function capabilitiesFor(
  ctx: ServiceContext,
  settlement: Settlement,
): SettlementView["capabilities"] {
  const has = (k: PermissionKey) => ctx.permissions.has(k);
  const carrier = privacyFor(ctx) === "carrier_full";
  const mine = isOwnPayee(ctx, settlement);
  const editable = isEditable(settlement.status);
  const blocked = blockingDataGaps(settlement.loadLines).length > 0;
  const openDispute = settlement.disputes.some(
    (d) => d.status === "open" || d.status === "under_review",
  );
  // Signed off, so the arithmetic is frozen and a statement is meaningful.
  const settled = !editable && settlement.status !== "voided";

  return {
    canRecalculate: carrier && has("settlements:create") && editable,
    canSubmitForReview: carrier && has("settlements:create") && settlement.status === "draft",
    canApprove:
      carrier && !mine && has("settlements:approve") && settlement.status === "needs_review" && !blocked,
    canDispute: has("settlements:dispute") && settled && !openDispute,
    canResolveDispute:
      carrier && !mine && has("settlements:dispute:resolve") && openDispute,
    canMarkReadyForPayment:
      carrier && !mine && has("settlements:pay") && settlement.status === "approved",
    canRecordPayment:
      carrier && !mine && has("settlements:pay") && acceptsPayment(settlement.status),
    canCreateAdjustment:
      carrier && !mine && has("settlements:adjust") && requiresAdjustmentToCorrect(settlement.status),
    canVoid:
      carrier &&
      !mine &&
      has("settlements:void") &&
      settlement.status !== "paid" &&
      settlement.status !== "voided",
    canGenerateStatement: settled && (privacyFor(ctx) === "payee_self" || has("settlements:export")),
    canExport: privacyFor(ctx) === "payee_self" || has("settlements:export"),
  };
}

function toView(ctx: ServiceContext, settlement: Settlement): SettlementView {
  return {
    settlement,
    privacy: privacyFor(ctx),
    resolvableLoadIds: resolvableLoadIds(ctx, settlement),
    capabilities: capabilitiesFor(ctx, settlement),
  };
}

/**
 * Which referenced loads this caller could actually open.
 *
 * The Loads module holds current freight, so a settlement for an archived
 * period legitimately references loads it no longer has — and a driver scoped
 * to their own loads may not reach one even when it is there. Both are normal,
 * and both are the seam's business to answer rather than a screen's to guess.
 */
function resolvableLoadIds(ctx: ServiceContext, settlement: Settlement): string[] {
  if (!ctx.permissions.has("loads:view")) return [];
  let loads;
  try {
    loads = mockStore.org(ctx.organizationId).loads;
  } catch {
    return [];
  }
  const reachable = new Set(
    loads
      .filter(
        (l) =>
          ctx.scope.loads !== "assigned" ||
          (ctx.driverProfileId != null && l.assignment?.driverId === ctx.driverProfileId),
      )
      .map((l) => l.id),
  );
  return settlement.loadLines.map((l) => l.load.loadId).filter((id) => reachable.has(id));
}

/* -------------------------------------------------------------------------- */
/* Summaries, filtering and sorting                                            */
/* -------------------------------------------------------------------------- */

function toSummary(settlement: Settlement): SettlementSummary {
  return {
    id: settlement.id,
    carrierOrganizationId: settlement.carrierOrganizationId,
    number: settlement.number,
    kind: settlement.kind,
    status: settlement.status,
    payee: settlement.payee,
    periodLabel: settlement.period.label,
    periodStartAt: settlement.period.startAt,
    periodEndAt: settlement.period.endAt,
    currency: settlement.currency,
    netPayCents: settlement.totals.netPayCents,
    grossEarningsCents: settlement.totals.grossEarningsCents,
    loadCount: settlement.totals.loadCount,
    amountPaidCents: settlement.amountPaidCents,
    amountOutstandingCents: settlement.amountOutstandingCents,
    paymentDueAt: settlement.paymentDueAt,
    openDisputeCount: settlement.disputes.filter(
      (d) => d.status === "open" || d.status === "under_review",
    ).length,
    blockingGapCount: blockingDataGaps(settlement.loadLines).length,
    updatedAt: settlement.updatedAt,
  };
}

function isOverdue(settlement: Settlement, now: number): boolean {
  return Boolean(
    settlement.paymentDueAt &&
      settlement.amountOutstandingCents > 0 &&
      settlement.status !== "voided" &&
      settlement.status !== "draft" &&
      new Date(settlement.paymentDueAt).getTime() < now,
  );
}

function inView(settlement: Settlement, view: SettlementFilters["view"], now: number): boolean {
  const blocked = blockingDataGaps(settlement.loadLines).length > 0;
  const disputed = settlement.disputes.some(
    (d) => d.status === "open" || d.status === "under_review",
  );
  switch (view) {
    case "needs_attention":
      return blocked || disputed || isOverdue(settlement, now) || settlement.status === "needs_review";
    case "awaiting_approval":
      return settlement.status === "needs_review";
    case "disputed":
      return disputed || settlement.status === "disputed";
    case "unpaid":
      return settlement.amountOutstandingCents > 0 && settlement.status !== "voided";
    case "overdue":
      return isOverdue(settlement, now);
    case "paid":
      return settlement.status === "paid";
    default:
      return true;
  }
}

function matches(settlement: Settlement, f: SettlementFilters, now: number): boolean {
  if (f.view && !inView(settlement, f.view, now)) return false;
  if (f.status?.length && !f.status.includes(settlement.status)) return false;
  if (f.kind?.length && !f.kind.includes(settlement.kind)) return false;
  if (f.payeeKind?.length && !f.payeeKind.includes(settlement.payee.kind)) return false;
  if (f.payeeId && settlement.payee.id !== f.payeeId) return false;
  if (f.periodId && settlement.period.id !== f.periodId) return false;
  if (f.hasBlockingGaps && blockingDataGaps(settlement.loadLines).length === 0) return false;
  if (
    f.hasOpenDispute &&
    !settlement.disputes.some((d) => d.status === "open" || d.status === "under_review")
  ) {
    return false;
  }
  if (f.overdueOnly && !isOverdue(settlement, now)) return false;
  if (f.minNetPayCents != null && settlement.totals.netPayCents < f.minNetPayCents) return false;
  if (f.maxNetPayCents != null && settlement.totals.netPayCents > f.maxNetPayCents) return false;
  if (f.periodFrom && new Date(settlement.period.startAt) < new Date(f.periodFrom)) return false;
  if (f.periodTo && new Date(settlement.period.endAt) > new Date(f.periodTo)) return false;

  if (f.search) {
    const q = f.search.trim().toLowerCase();
    if (!q) return true;
    const loadRefs = settlement.loadLines.map((l) => l.load.referenceSnapshot).join(" ");
    const hay =
      `${settlement.number} ${settlement.payee.displayNameSnapshot} ${settlement.period.label} ${loadRefs}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function compare(a: Settlement, b: Settlement, sort: SettlementSort): number {
  const dir = sort.direction === "asc" ? 1 : -1;
  switch (sort.field) {
    case "number": return a.number.localeCompare(b.number) * dir;
    case "payee":
      return a.payee.displayNameSnapshot.localeCompare(b.payee.displayNameSnapshot) * dir;
    case "status": return a.status.localeCompare(b.status) * dir;
    case "netPay": return (a.totals.netPayCents - b.totals.netPayCents) * dir;
    case "outstanding":
      return (a.amountOutstandingCents - b.amountOutstandingCents) * dir;
    case "period":
      return (
        (new Date(a.period.startAt).getTime() - new Date(b.period.startAt).getTime()) * dir
      );
    case "updatedAt":
    default:
      return (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()) * dir;
  }
}

/* -------------------------------------------------------------------------- */
/* Mutation helpers                                                            */
/* -------------------------------------------------------------------------- */

function appendAudit(
  settlement: Settlement,
  ctx: ServiceContext,
  action: SettlementAuditAction,
  summary: string,
  extra: Partial<SettlementAuditEntry> = {},
): SettlementAuditEntry[] {
  const entry: SettlementAuditEntry = {
    id: rowId("aud"),
    settlementId: settlement.id,
    at: nowIso(),
    actor: ctx.actor,
    action,
    summary,
    ...extra,
  };
  // Append-only. Nothing here updates or removes an existing entry.
  return [...settlement.audit, entry];
}

/** Recomputes the paid/outstanding mirrors from the payment records. */
function withPaymentTotals(settlement: Settlement): Settlement {
  const amountPaidCents = settlement.payments
    .filter((p) => !p.reversedAt)
    .reduce((n, p) => n + p.amountCents, 0);
  return {
    ...settlement,
    amountPaidCents,
    amountOutstandingCents: Math.max(0, settlement.totals.netPayCents - amountPaidCents),
  };
}

function commit(next: Settlement): Settlement {
  const saved = withPaymentTotals({ ...next, updatedAt: nowIso() });
  settlementStore.replace(saved);
  return saved;
}

/**
 * Moves a settlement's status through the machine. Every status change in this
 * file goes through here, so an illegal transition is impossible to write.
 */
function transition(
  settlement: Settlement,
  to: SettlementStatus,
  ctx: ServiceContext,
  action: SettlementAuditAction,
  summary: string,
): Settlement {
  assertTransition(settlement.status, to);
  return {
    ...settlement,
    status: to,
    audit: appendAudit(settlement, ctx, action, summary, {
      fromStatus: settlement.status,
      toStatus: to,
    }),
  };
}

/** Rebuilds the calculation inputs from the stored line snapshots. */
function toLoadLineInputs(settlement: Settlement): LoadLineInput[] {
  return settlement.loadLines.map((line) => ({
    id: line.id,
    load: line.load,
    invoice: line.invoice,
    agreement: line.agreement,
    linehaulCents: line.linehaulCents,
    accessorials: line.accessorials.map((a) => ({
      code: a.code,
      label: a.label,
      billedCents: a.billedCents,
      approved: a.approved,
    })),
    // Gaps another module reported are preserved; the engine re-derives its own.
    missingData: line.missingData.filter(
      (g) => g.kind === "missing_document" || g.kind === "missing_invoice" || g.kind === "missing_payee_profile",
    ),
  }));
}

/** Re-runs the engine and produces the next snapshot revision. */
function recalculated(settlement: Settlement, ctx: ServiceContext): Settlement {
  const result = calculate({
    currency: settlement.currency,
    loadLines: toLoadLineInputs(settlement),
    adjustments: settlement.adjustments,
  });
  const snapshot = buildSnapshot({
    id: rowId("snap"),
    settlementId: settlement.id,
    revision: settlement.snapshot.revision + 1,
    computedAt: nowIso(),
    computedBy: ctx.actor,
    result,
    adjustments: settlement.adjustments,
  });
  return {
    ...settlement,
    loadLines: result.loadLines,
    snapshot,
    totals: result.totals,
    audit: appendAudit(
      settlement,
      ctx,
      "recalculated",
      `Recalculated: net ${money(result.totals.netPayCents)}.`,
      {
        fromNetPayCents: settlement.totals.netPayCents,
        toNetPayCents: result.totals.netPayCents,
      },
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* The service                                                                 */
/* -------------------------------------------------------------------------- */

export const mockSettlementsService: SettlementsService = {
  async list(ctx, filters = {}, sort, page: PageRequest = {}): Promise<Page<SettlementSummary>> {
    await wait();
    const now = Date.now();
    const all = visibleSettlements(ctx)
      .filter((s) => matches(s, filters, now))
      .sort((a, b) => compare(a, b, sort ?? { field: "period", direction: "desc" }))
      .map(toSummary);

    const limit = page.limit ?? 50;
    const start = page.cursor ? Number(page.cursor) : 0;
    const next = start + limit;
    return {
      items: all.slice(start, start + limit),
      totalCount: all.length,
      nextCursor: next < all.length ? String(next) : undefined,
    };
  },

  async listTotals(ctx, filters = {}): Promise<SettlementListTotals | null> {
    await wait();
    // A payee gets no carrier-wide roll-up. The figure would be their own, and
    // a "total across the business" is not theirs to have.
    if (privacyFor(ctx) !== "carrier_full") return null;

    const now = Date.now();
    const rows = visibleSettlements(ctx).filter((s) => matches(s, filters, now));
    return {
      settlementCount: rows.length,
      netPayCents: rows.reduce((n, s) => n + s.totals.netPayCents, 0),
      outstandingCents: rows.reduce((n, s) => n + s.amountOutstandingCents, 0),
      overdueCount: rows.filter((s) => isOverdue(s, now)).length,
      disputedCount: rows.filter((s) =>
        s.disputes.some((d) => d.status === "open" || d.status === "under_review"),
      ).length,
      blockedCount: rows.filter((s) => blockingDataGaps(s.loadLines).length > 0).length,
    };
  },

  async get(ctx, settlementId): Promise<SettlementView> {
    await wait();
    return toView(ctx, mustFind(ctx, settlementId));
  },

  async breakdown(ctx, settlementId): Promise<SettlementCalculationSnapshot> {
    await wait();
    return mustFind(ctx, settlementId).snapshot;
  },

  async audit(ctx, settlementId): Promise<SettlementAuditEntry[]> {
    await wait();
    return [...mustFind(ctx, settlementId).audit].reverse();
  },

  async periods(ctx): Promise<SettlementPeriod[]> {
    await wait();
    requirePermissions(ctx, "settlements:view");
    return [...settlementStore.carrier(ctx.organizationId).periods].sort(
      (a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime(),
    );
  },

  async payees(ctx, kinds?: PayeeKind[]): Promise<PayeeRef[]> {
    await wait();
    const seen = new Map<string, PayeeRef>();
    for (const s of visibleSettlements(ctx)) {
      if (kinds?.length && !kinds.includes(s.payee.kind)) continue;
      if (!seen.has(s.payee.id)) seen.set(s.payee.id, s.payee);
    }
    return [...seen.values()].sort((a, b) =>
      a.displayNameSnapshot.localeCompare(b.displayNameSnapshot),
    );
  },

  async attention(ctx): Promise<SettlementAttentionItem[]> {
    await wait();
    const now = Date.now();
    const items = visibleSettlements(ctx)
      .flatMap((s) => attentionItemsFor(s, now))
      // An item nobody can act on is noise, so it is not shown at all.
      .filter((i) => i.requires.every((k) => ctx.permissions.has(k)));
    return sortAttentionItems(items);
  },

  // --- Building ------------------------------------------------------------

  async recalculate(ctx, settlementId): Promise<SettlementView> {
    await wait();
    requirePermissions(ctx, "settlements:create");
    assertCarrierAdministrator(ctx);
    const settlement = mustFind(ctx, settlementId);
    // The whole reason the snapshot exists: once signed off, it is never
    // recomputed, so a later change to a rate or an agreement cannot rewrite it.
    assertEditable(settlement);
    return toView(ctx, commit(recalculated(settlement, ctx)));
  },

  async submitForReview(ctx, settlementId): Promise<SettlementView> {
    await wait();
    requirePermissions(ctx, "settlements:create");
    assertCarrierAdministrator(ctx);
    const settlement = mustFind(ctx, settlementId);
    assertEditable(settlement);
    return toView(
      ctx,
      commit(
        transition(settlement, "needs_review", ctx, "submitted_for_review", "Sent for review."),
      ),
    );
  },

  // --- Signing off ---------------------------------------------------------

  async approve(ctx, settlementId, input: ApproveSettlementInput = {}): Promise<SettlementView> {
    await wait();
    requirePermissions(ctx, "settlements:approve");
    assertCarrierAdministrator(ctx);
    const settlement = mustFind(ctx, settlementId);
    assertNotOwnPayee(ctx, settlement, "approve");

    const gaps = blockingDataGaps(settlement.loadLines);
    if (gaps.length > 0) {
      throw new SettlementNotReadyError(
        `This settlement is missing ${gaps.length} thing${gaps.length === 1 ? "" : "s"} it needs before it can be approved. ${gaps[0].summary}`,
      );
    }

    const approvedAt = nowIso();
    const moved = transition(
      settlement,
      "approved",
      ctx,
      "approved",
      `Approved at ${money(settlement.totals.netPayCents)}.${input.note ? ` ${input.note}` : ""}`,
    );

    // Freezing is the act that makes the record historical. From here the
    // arithmetic is read, never recomputed.
    const frozen: SettlementCalculationSnapshot = {
      ...moved.snapshot,
      frozen: true,
      frozenAt: approvedAt,
    };

    return toView(
      ctx,
      commit({
        ...moved,
        snapshot: frozen,
        approvedAt,
        approvals: [
          ...moved.approvals,
          {
            id: rowId("apr"),
            approvedAt,
            approvedBy: ctx.actor,
            note: input.note,
            snapshotRevision: frozen.revision,
          },
        ],
        audit: appendAudit(
          moved,
          ctx,
          "snapshot_frozen",
          `Calculation revision ${frozen.revision} frozen. Later changes to rates or agreements cannot alter it.`,
        ),
      }),
    );
  },

  // --- Disputes ------------------------------------------------------------

  async raiseDispute(ctx, settlementId, input: RaiseDisputeInput): Promise<SettlementView> {
    await wait();
    requirePermissions(ctx, "settlements:dispute");
    const settlement = mustFind(ctx, settlementId);

    if (isEditable(settlement.status) || settlement.status === "voided") {
      throw new SettlementNotReadyError(
        "A settlement can only be disputed once it has been signed off.",
      );
    }
    if (settlement.disputes.some((d) => d.status === "open" || d.status === "under_review")) {
      throw new SettlementNotReadyError("This settlement already has an open dispute.");
    }

    const dispute: SettlementDispute = {
      id: rowId("dsp"),
      settlementId: settlement.id,
      status: "open",
      reason: input.reason,
      summary: input.summary,
      relatedLoadId: input.relatedLoadId,
      relatedAdjustmentId: input.relatedAdjustmentId,
      claimedAmountCents: input.claimedAmountCents,
      raisedAt: nowIso(),
      raisedBy: ctx.actor,
      // Remembered so an upheld dispute returns the settlement where it was —
      // a paid settlement goes back to paid, not into review.
      statusBeforeDispute: settlement.status,
      messages: [],
    };

    const moved = transition(settlement, "disputed", ctx, "dispute_raised", input.summary);
    return toView(
      ctx,
      commit({ ...moved, disputes: [...moved.disputes, dispute] }),
    );
  },

  async addDisputeMessage(
    ctx,
    settlementId,
    disputeId,
    input: DisputeMessageInput,
  ): Promise<SettlementView> {
    await wait();
    requirePermissions(ctx, "settlements:dispute");
    const settlement = mustFind(ctx, settlementId);
    const dispute = settlement.disputes.find((d) => d.id === disputeId);
    if (!dispute) throw new NotFoundError("Dispute");
    if (dispute.status === "resolved" || dispute.status === "withdrawn") {
      throw new SettlementNotReadyError("This dispute has already been closed.");
    }

    const updated: SettlementDispute = {
      ...dispute,
      status: "under_review",
      messages: [
        ...dispute.messages,
        { id: rowId("msg"), at: nowIso(), actor: ctx.actor, body: input.body },
      ],
    };

    return toView(
      ctx,
      commit({
        ...settlement,
        disputes: settlement.disputes.map((d) => (d.id === disputeId ? updated : d)),
        audit: appendAudit(settlement, ctx, "dispute_message", input.body, { relatedId: disputeId }),
      }),
    );
  },

  async resolveDispute(
    ctx,
    settlementId,
    disputeId,
    input: ResolveDisputeInput,
  ): Promise<SettlementView> {
    await wait();
    requirePermissions(ctx, "settlements:dispute:resolve");
    assertCarrierAdministrator(ctx);
    const settlement = mustFind(ctx, settlementId);
    assertNotOwnPayee(ctx, settlement, "resolve a dispute on");

    const dispute = settlement.disputes.find((d) => d.id === disputeId);
    if (!dispute) throw new NotFoundError("Dispute");
    if (dispute.status === "resolved" || dispute.status === "withdrawn") {
      throw new SettlementNotReadyError("This dispute has already been closed.");
    }

    const resolvedAt = nowIso();
    let adjustmentSettlementId: string | undefined;
    let updated: Settlement = settlement;

    // A dispute that is upheld changes nothing about the money. One that is
    // accepted raises a CORRECTION — the disputed settlement is still not
    // edited, because that is never how a correction is made.
    if (input.resolution === "adjusted") {
      if (!input.adjustment) {
        throw new SettlementNotReadyError(
          "Accepting a dispute needs the correction that goes with it.",
        );
      }
      const created = createAdjustmentSettlement(ctx, settlement, input.adjustment);
      adjustmentSettlementId = created.id;
      updated = {
        ...updated,
        adjustmentSettlementIds: [...(updated.adjustmentSettlementIds ?? []), created.id],
      };
    }

    const closed: SettlementDispute = {
      ...dispute,
      status: input.resolution === "withdrawn" ? "withdrawn" : "resolved",
      resolution: input.resolution,
      resolutionNote: input.note,
      resolvedAt,
      resolvedBy: ctx.actor,
      adjustmentSettlementId,
    };

    updated = {
      ...updated,
      disputes: updated.disputes.map((d) => (d.id === disputeId ? closed : d)),
      audit: appendAudit(updated, ctx, "dispute_resolved", input.note, { relatedId: disputeId }),
    };

    // Back to wherever it was before the dispute interrupted it.
    const restored = transition(
      updated,
      dispute.statusBeforeDispute,
      ctx,
      "dispute_resolved",
      `Dispute closed as ${input.resolution}. Settlement returns to ${dispute.statusBeforeDispute.replace(/_/g, " ")}.`,
    );

    return toView(ctx, commit(restored));
  },

  // --- Payment (recording only) --------------------------------------------

  async markReadyForPayment(ctx, settlementId): Promise<SettlementView> {
    await wait();
    requirePermissions(ctx, "settlements:pay");
    assertCarrierAdministrator(ctx);
    const settlement = mustFind(ctx, settlementId);
    assertNotOwnPayee(ctx, settlement, "queue for payment");
    return toView(
      ctx,
      commit(
        transition(
          settlement,
          "ready_for_payment",
          ctx,
          "marked_ready_for_payment",
          "Queued for payment. Antcolos does not move the money — this records the intent.",
        ),
      ),
    );
  },

  async recordPayment(ctx, settlementId, input: RecordPaymentInput): Promise<SettlementView> {
    await wait();
    requirePermissions(ctx, "settlements:pay");
    assertCarrierAdministrator(ctx);
    const settlement = mustFind(ctx, settlementId);
    assertNotOwnPayee(ctx, settlement, "record a payment against");

    if (!acceptsPayment(settlement.status)) {
      throw new SettlementNotReadyError(
        "Only a settlement that has been queued for payment can have a payment recorded against it.",
      );
    }
    if (input.amountCents <= 0) {
      throw new SettlementNotReadyError("A recorded payment must be more than nothing.");
    }
    if (input.amountCents > settlement.amountOutstandingCents) {
      throw new SettlementNotReadyError(
        `That is more than the ${money(settlement.amountOutstandingCents)} still outstanding.`,
      );
    }

    const payment = {
      id: rowId("pay"),
      settlementId: settlement.id,
      amountCents: input.amountCents,
      method: input.method,
      referenceNumber: input.referenceNumber,
      paidAt: input.paidAt,
      recordedAt: nowIso(),
      recordedBy: ctx.actor,
      note: input.note,
    };

    const withPayment: Settlement = {
      ...settlement,
      payments: [...settlement.payments, payment],
      audit: appendAudit(
        settlement,
        ctx,
        "payment_recorded",
        `${money(input.amountCents)} recorded as paid by ${input.method}${
          input.referenceNumber ? ` (${input.referenceNumber})` : ""
        }.`,
        { relatedId: payment.id },
      ),
    };

    const paidSoFar = withPayment.payments
      .filter((p) => !p.reversedAt)
      .reduce((n, p) => n + p.amountCents, 0);
    const nextStatus = statusAfterPayment(
      withPayment.totals.netPayCents,
      paidSoFar,
      withPayment.status,
    );

    const moved =
      nextStatus === withPayment.status
        ? withPayment
        : transition(
            withPayment,
            nextStatus,
            ctx,
            "payment_recorded",
            nextStatus === "paid"
              ? "Paid in full."
              : `Part paid: ${money(paidSoFar)} of ${money(withPayment.totals.netPayCents)}.`,
          );

    return toView(
      ctx,
      commit({ ...moved, paidAt: nextStatus === "paid" ? input.paidAt : moved.paidAt }),
    );
  },

  // --- Corrections ---------------------------------------------------------

  async createAdjustment(ctx, settlementId, input: CreateAdjustmentInput): Promise<SettlementView> {
    await wait();
    requirePermissions(ctx, "settlements:adjust");
    assertCarrierAdministrator(ctx);
    const settlement = mustFind(ctx, settlementId);
    assertNotOwnPayee(ctx, settlement, "correct");

    if (!requiresAdjustmentToCorrect(settlement.status)) {
      throw new SettlementNotReadyError(
        "This settlement has not been signed off yet — change it directly rather than raising a correction.",
      );
    }

    const created = createAdjustmentSettlement(ctx, settlement, input);
    commit({
      ...settlement,
      adjustmentSettlementIds: [...(settlement.adjustmentSettlementIds ?? []), created.id],
      audit: appendAudit(
        settlement,
        ctx,
        "adjustment_settlement_created",
        `Correction ${created.number} raised: ${input.reason}`,
        { relatedId: created.id },
      ),
    });

    // The caller lands on the correction, which is the record they now work on.
    return toView(ctx, created);
  },

  async void(ctx, settlementId, input: VoidSettlementInput): Promise<SettlementView> {
    await wait();
    requirePermissions(ctx, "settlements:void");
    assertCarrierAdministrator(ctx);
    const settlement = mustFind(ctx, settlementId);
    assertNotOwnPayee(ctx, settlement, "void");

    if (!input.reason.trim()) {
      throw new SettlementNotReadyError("Voiding a settlement needs a reason on the record.");
    }

    const moved = transition(settlement, "voided", ctx, "voided", input.reason);
    return toView(
      ctx,
      commit({ ...moved, voidedAt: nowIso(), voidReason: input.reason }),
    );
  },

  // --- Statements ----------------------------------------------------------

  async generateStatement(ctx, settlementId): Promise<SettlementStatement> {
    await wait();
    const settlement = mustFind(ctx, settlementId);

    if (privacyFor(ctx) === "carrier_full") requirePermissions(ctx, "settlements:export");
    if (isEditable(settlement.status)) {
      throw new SettlementNotReadyError(
        "A statement can only be produced once the settlement has been signed off and its figures are frozen.",
      );
    }

    const previous = settlement.statements.filter((s) => !s.supersededByStatementId);
    const statement: SettlementStatement = {
      id: rowId("stm"),
      settlementId: settlement.id,
      number: `${settlement.number}-S${settlement.statements.length + 1}`,
      snapshotRevision: settlement.snapshot.revision,
      generatedAt: nowIso(),
      generatedBy: ctx.actor,
    };

    // Regenerating supersedes rather than reprints: two statements with the
    // same number and different figures is how a payee stops trusting either.
    const superseded = settlement.statements.map((s) =>
      previous.some((p) => p.id === s.id)
        ? { ...s, supersededByStatementId: statement.id }
        : s,
    );

    commit({
      ...settlement,
      statements: [...superseded, statement],
      audit: appendAudit(
        settlement,
        ctx,
        "statement_generated",
        `Statement ${statement.number} produced from calculation revision ${statement.snapshotRevision}.`,
        { relatedId: statement.id },
      ),
    });

    return statement;
  },

  async statements(ctx, settlementId): Promise<SettlementStatement[]> {
    await wait();
    return [...mustFind(ctx, settlementId).statements].sort(
      (a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime(),
    );
  },
};

/* -------------------------------------------------------------------------- */
/* Corrections                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Creates the adjustment settlement that corrects another one.
 *
 * This is the ONLY way a signed-off settlement is ever corrected. The original
 * is not touched: the correction is a new record with its own immutable UUID,
 * its own audit trail, and links in both directions, so the history reads as
 * what actually happened rather than as a figure that changed by itself.
 */
function createAdjustmentSettlement(
  ctx: ServiceContext,
  original: Settlement,
  input: CreateAdjustmentInput,
): Settlement {
  const id = settlementUuid();
  const createdAt = nowIso();

  const adjustments: SettlementAdjustment[] = input.lines.map((line) => ({
    id: rowId("adj"),
    kind: line.kind,
    direction: line.direction,
    label: line.label,
    amountCents: line.amountCents,
    loadId: line.loadId,
    note: line.note,
    addedAt: createdAt,
    addedBy: ctx.actor,
  }));

  // A correction carries no load lines: it adjusts, it does not re-price. The
  // original settlement's own lines stay exactly where they are.
  const result = calculate({ currency: original.currency, loadLines: [], adjustments });

  const snapshot = buildSnapshot({
    id: rowId("snap"),
    settlementId: id,
    revision: 1,
    computedAt: createdAt,
    computedBy: ctx.actor,
    result,
    adjustments,
  });

  const correction: Settlement = {
    id,
    carrierOrganizationId: original.carrierOrganizationId,
    number: settlementStore.nextNumber(original.carrierOrganizationId, original.number, "ADJ"),
    kind: "adjustment",
    status: "needs_review",
    payee: original.payee,
    period: original.period,
    currency: original.currency,
    loadLines: [],
    adjustments,
    snapshot,
    totals: result.totals,
    approvals: [],
    disputes: [],
    payments: [],
    statements: [],
    audit: [
      {
        id: rowId("aud"),
        settlementId: id,
        at: createdAt,
        actor: ctx.actor,
        action: "created",
        summary: `Correction to ${original.number}: ${input.reason}`,
        toStatus: "needs_review",
        relatedId: original.id,
      },
      {
        id: rowId("aud"),
        settlementId: id,
        at: createdAt,
        actor: SYSTEM_ACTOR,
        action: "recalculated",
        summary: `Correction totals ${money(result.totals.netPayCents)}.`,
        toNetPayCents: result.totals.netPayCents,
      },
    ],
    version: 1,
    correctsSettlementId: original.id,
    amountPaidCents: 0,
    amountOutstandingCents: Math.max(0, result.totals.netPayCents),
    paymentDueAt: original.paymentDueAt,
    createdAt,
    createdBy: ctx.actor,
    updatedAt: createdAt,
  };

  settlementStore.add(correction);
  return correction;
}
