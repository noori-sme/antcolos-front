"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { services } from "@/lib/api";
import { useServiceContext } from "@/lib/api/use-service-context";
import { orgKey } from "@/lib/query/keys";
import { createIntentKeys } from "@/lib/rate-con/intent-key";
import type { ExpenseViewer } from "@/lib/expenses/expense-rules";
import { useCan } from "@/lib/session/hooks";
import type { ExpenseFilters, LedgerFilters, RouteExpenseInput } from "@/types/expense";

/** The company books and the caller's own ledger (F2.2, backend plan 51). http-only. */

export const expenseKeys = {
  all: (org: string) => [...orgKey(org), "expenses"] as const,
  list: (org: string, filters: ExpenseFilters) => [...orgKey(org), "expenses", "list", filters] as const,
  detail: (org: string, id: string) => [...orgKey(org), "expenses", "detail", id] as const,
  /** The ledger is the user's own, but it is cached under the active organization like every key. */
  ledger: (org: string, filters: LedgerFilters) => [...orgKey(org), "expenses", "my-ledger", filters] as const,
};

export function useExpenses(filters: ExpenseFilters) {
  const ctx = useServiceContext();
  const allowed = useCan("expenses:view");
  return useQuery({
    queryKey: ctx ? expenseKeys.list(ctx.organizationId, filters) : [...orgKey("none"), "expenses", "no-context"],
    queryFn: () => services.expenses.list(ctx!, filters),
    enabled: Boolean(ctx) && allowed,
    placeholderData: keepPreviousData,
  });
}

export function useExpense(id: string | null) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx && id ? expenseKeys.detail(ctx.organizationId, id) : [...orgKey("none"), "expenses", "no-context", id],
    queryFn: () => services.expenses.get(ctx!, id!),
    enabled: Boolean(ctx) && Boolean(id),
    retry: false,
  });
}

export function useMyLedger(filters: LedgerFilters) {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx ? expenseKeys.ledger(ctx.organizationId, filters) : [...orgKey("none"), "expenses", "no-context"],
    queryFn: () => services.expenses.myLedger(ctx!, filters),
    enabled: Boolean(ctx),
    placeholderData: keepPreviousData,
  });
}

export function useExpenseViewer(): ExpenseViewer {
  return { canRoute: useCan("expenses:route"), canVoid: useCan("expenses:void") };
}

/** One Idempotency-Key per intent, kept across re-renders and retries. */
export function useExpenseIntentKeys() {
  const [keys] = useState(() => createIntentKeys());
  return keys;
}

function useExpenseMutation<TVars, TResult>(
  run: (ctx: NonNullable<ReturnType<typeof useServiceContext>>, vars: TVars) => Promise<TResult>,
) {
  const ctx = useServiceContext();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: TVars) => {
      if (!ctx) throw new Error("No organization selected");
      return run(ctx, vars);
    },
    onSettled: () => {
      if (ctx) void queryClient.invalidateQueries({ queryKey: expenseKeys.all(ctx.organizationId) });
    },
  });
}

export function useRouteExpense() {
  return useExpenseMutation((ctx, vars: { id: string; input: RouteExpenseInput; idempotencyKey: string }) =>
    services.expenses.route(ctx, vars.id, vars.input, vars.idempotencyKey),
  );
}

export function useVoidExpense() {
  return useExpenseMutation((ctx, vars: { id: string; reason: string; idempotencyKey: string }) =>
    services.expenses.void(ctx, vars.id, vars.reason, vars.idempotencyKey),
  );
}

export function useDismissLedgerEntry() {
  return useExpenseMutation((ctx, vars: { id: string; reason: string; idempotencyKey: string }) =>
    services.expenses.dismissMine(ctx, vars.id, vars.reason, vars.idempotencyKey),
  );
}
