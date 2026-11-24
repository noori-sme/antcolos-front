"use client";

import { ChevronRight } from "lucide-react";
import { ExpenseStatusBadge } from "@/components/common/status-badge";
import { formatMoney, KIND_LABEL } from "@/lib/receipts/receipt-rules";
import { routingReasonText } from "@/lib/expenses/expense-rules";
import type { Expense } from "@/types/expense";

export const day = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

/** One expense of the company books; opens its detail. */
export function ExpenseRow({ expense, onOpen }: { expense: Expense; onOpen: (id: string) => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(expense.id)}
        className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3.5 text-left shadow-e1 transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.875rem] font-medium text-fg">
            {KIND_LABEL[expense.kind]} · {day(expense.incurredAt)}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <ExpenseStatusBadge status={expense.status} />
            <span className="truncate text-[0.8125rem] text-fg-muted">{routingReasonText(expense.routingReason)}</span>
          </div>
        </div>
        <span className="shrink-0 text-[0.875rem] font-medium tabular-nums text-fg">
          {formatMoney(expense.amount, expense.currency)}
        </span>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-fg-subtle" />
      </button>
    </li>
  );
}
