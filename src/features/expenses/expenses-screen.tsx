"use client";

import { ReceiptText } from "lucide-react";
import { useState } from "react";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EXPENSE_STATUS } from "@/config/statuses";
import { useCan } from "@/lib/session/hooks";
import { cn } from "@/lib/utils";
import type { ExpenseStatus } from "@/types/expense";
import { ExpenseDetailSheet } from "./expense-detail-sheet";
import { ExpenseRow } from "./expense-row";
import { useExpenses } from "./hooks";

const PAGE_SIZE = 25;
const TABS: { value: ExpenseStatus | undefined; label: string }[] = [
  { value: "UNASSIGNED", label: EXPENSE_STATUS.UNASSIGNED.label },
  { value: "POSTED", label: EXPENSE_STATUS.POSTED.label },
  { value: "VOIDED", label: EXPENSE_STATUS.VOIDED.label },
  { value: "MOVED_TO_LEDGER", label: EXPENSE_STATUS.MOVED_TO_LEDGER.label },
  { value: undefined, label: "All" },
];

/**
 * The company books (F2.2): every confirmed receipt that is this company's
 * cost, and the queue of ones the system couldn't place. Owner-operators'
 * private ledgers are never shown here.
 */
export function ExpensesScreen() {
  const canRoute = useCan("expenses:route");
  const [status, setStatus] = useState<ExpenseStatus | undefined>(canRoute ? "UNASSIGNED" : "POSTED");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const query = useExpenses({ status, page, pageSize: PAGE_SIZE });
  const expenses = query.data?.data ?? [];
  const meta = query.data?.meta;

  return (
    <div className="space-y-section">
      <PageHeader
        title="Expenses"
        description="The company's costs from confirmed receipts. Expenses of owner-operators' own trucks stay in their private ledgers."
      />
      <div role="group" aria-label="Status" className="flex flex-wrap gap-1">
        {TABS.map((tab) => (
          <button
            key={tab.label}
            type="button"
            aria-pressed={status === tab.value}
            onClick={() => {
              setStatus(tab.value);
              setPage(1);
            }}
            className={cn(
              "h-control-sm rounded-md px-3 text-[0.8125rem] transition-colors",
              status === tab.value ? "bg-surface-sunken font-medium text-fg" : "text-fg-muted hover:bg-surface-hover",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {query.isPending ? <LoadingSkeleton rows={5} /> : null}
      {query.isError ? <ErrorState description={query.error.message} onRetry={() => void query.refetch()} /> : null}
      {query.isSuccess && expenses.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title={status === "UNASSIGNED" ? "Nothing waiting to be routed" : "No expenses here"}
          description={
            status === "UNASSIGNED"
              ? "Expenses the system can't place by the truck's ownership show up here."
              : "Expenses appear here once receipts are confirmed."
          }
        />
      ) : null}
      {expenses.length > 0 ? (
        <ul className={cn("space-y-2", query.isPlaceholderData && "opacity-60")}>
          {expenses.map((e) => <ExpenseRow key={e.id} expense={e} onOpen={setOpenId} />)}
        </ul>
      ) : null}
      {meta && meta.totalPages > 1 ? (
        <nav aria-label="Pages" className="flex items-center justify-between gap-3 text-[0.8125rem] text-fg-muted">
          <span>Page {meta.page} of {meta.totalPages} · {meta.totalItems} expenses</span>
          <div className="flex gap-2">
            <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button size="sm" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </nav>
      ) : null}

      <ExpenseDetailSheet expenseId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
