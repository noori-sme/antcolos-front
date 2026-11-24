import { apiClient } from "../client";
import type { ExpensesService } from "../contracts/expenses";
import { type Dto, obj, oneOf, queryParams, str, toPage } from "./dto";
import {
  EXPENSE_ROUTING_REASONS, EXPENSE_STATUSES, LEDGER_ENTRY_STATUSES,
  type Expense, type LedgerEntry,
} from "@/types/expense";
import { RECEIPT_KINDS } from "@/types/receipt";

/** ../antcolos/docs/requirements/expenses-api-contract.md (backend plan 51). */

const text = (v: unknown): string | null => str(v) ?? null;

export function toExpense(dto: Dto): Expense {
  return {
    id: str(dto.id) ?? "",
    receiptId: str(dto.receiptId) ?? "",
    kind: oneOf(RECEIPT_KINDS, dto.kind) ?? "UNKNOWN",
    amount: str(dto.amount) ?? "0.00",
    currency: str(dto.currency) ?? "USD",
    incurredAt: str(dto.incurredAt) ?? "",
    truckId: text(dto.truckId),
    loadId: text(dto.loadId),
    driverUserId: str(dto.driverUserId) ?? "",
    status: oneOf(EXPENSE_STATUSES, dto.status) ?? "UNKNOWN",
    routingReason: oneOf(EXPENSE_ROUTING_REASONS, dto.routingReason) ?? null,
    reimbursable: dto.reimbursable === true,
    routeReason: text(dto.routeReason),
    routedByUserId: text(dto.routedByUserId),
    routedAt: text(dto.routedAt),
    voidReason: text(dto.voidReason),
    voidedAt: text(dto.voidedAt),
    createdAt: str(dto.createdAt) ?? "",
  };
}

export function toLedgerEntry(dto: Dto): LedgerEntry {
  const source = obj(dto.source) ?? {};
  return {
    id: str(dto.id) ?? "",
    receiptId: str(dto.receiptId) ?? "",
    source: { id: str(source.id) ?? "", name: str(source.name) ?? "" },
    kind: oneOf(RECEIPT_KINDS, dto.kind) ?? "UNKNOWN",
    amount: str(dto.amount) ?? "0.00",
    currency: str(dto.currency) ?? "USD",
    incurredAt: str(dto.incurredAt) ?? "",
    truckId: text(dto.truckId),
    loadId: text(dto.loadId),
    status: oneOf(LEDGER_ENTRY_STATUSES, dto.status) ?? "UNKNOWN",
    dismissReason: text(dto.dismissReason),
    createdAt: str(dto.createdAt) ?? "",
  };
}

const expense = (id: string) => `/expenses/${encodeURIComponent(id)}`;
const idempotent = (key: string) => ({ headers: { "Idempotency-Key": key } });
const single = (data: unknown): Dto => obj(data) ?? {};

export const httpExpensesService: ExpensesService = {
  async list(_ctx, filters) {
    const res = await apiClient.get("/expenses", {
      params: queryParams({
        status: filters.status,
        truckId: filters.truckId,
        page: filters.page,
        pageSize: filters.pageSize,
      }),
    });
    return toPage(res.data, toExpense);
  },
  async get(_ctx, id) {
    return toExpense(single((await apiClient.get(expense(id))).data));
  },
  async route(_ctx, id, input, idempotencyKey) {
    const body = {
      to: input.to,
      reason: input.reason,
      ...(input.reimbursable !== undefined ? { reimbursable: input.reimbursable } : {}),
    };
    return toExpense(single((await apiClient.post(`${expense(id)}/route`, body, idempotent(idempotencyKey))).data));
  },
  async void(_ctx, id, reason, idempotencyKey) {
    return toExpense(single((await apiClient.post(`${expense(id)}/void`, { reason }, idempotent(idempotencyKey))).data));
  },
  async myLedger(_ctx, filters) {
    const res = await apiClient.get("/users/me/ledger", {
      params: queryParams({ status: filters.status, page: filters.page, pageSize: filters.pageSize }),
    });
    return toPage(res.data, toLedgerEntry);
  },
  async dismissMine(_ctx, id, reason, idempotencyKey) {
    const res = await apiClient.post(
      `/users/me/ledger/${encodeURIComponent(id)}/dismiss`,
      { reason },
      idempotent(idempotencyKey),
    );
    return toLedgerEntry(single(res.data));
  },
};
