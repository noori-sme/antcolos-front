"use client";

import { useState } from "react";
import { ExpenseStatusBadge } from "@/components/common/status-badge";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { Button } from "@/components/ui/button";
import { Sheet, SheetCloseButton, SheetContent } from "@/components/ui/sheet";
import { canRouteExpense, canVoidExpense, routingReasonText } from "@/lib/expenses/expense-rules";
import { formatMoney, KIND_LABEL } from "@/lib/receipts/receipt-rules";
import type { Expense } from "@/types/expense";
import { day } from "./expense-row";
import {
  useExpense, useExpenseIntentKeys, useExpenseViewer, useRouteExpense, useVoidExpense,
} from "./hooks";
import { ReasonDialog } from "./reason-dialog";

/** One expense: what it is, why it is where it is, and the decisions left on it. */
export function ExpenseDetailSheet({ expenseId, onClose }: { expenseId: string | null; onClose: () => void }) {
  const query = useExpense(expenseId);
  const expense = query.data;
  return (
    <Sheet open={Boolean(expenseId)} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent title="Expense" description="Where this expense sits in the books and why.">
        <header className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[1rem] font-semibold text-fg">
              {expense ? `${KIND_LABEL[expense.kind]} expense` : "Expense"}
            </h2>
            {expense ? (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <ExpenseStatusBadge status={expense.status} />
                <span className="text-[0.8125rem] text-fg-muted">{formatMoney(expense.amount, expense.currency)}</span>
              </div>
            ) : null}
          </div>
          <SheetCloseButton />
        </header>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {query.isPending ? <LoadingSkeleton rows={3} /> : null}
          {query.isError ? <ErrorState description={query.error.message} onRetry={() => void query.refetch()} /> : null}
          {expense ? <Body expense={expense} /> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Body({ expense }: { expense: Expense }) {
  const viewer = useExpenseViewer();
  const keys = useExpenseIntentKeys();
  const route = useRouteExpense();
  const voidExpense = useVoidExpense();
  const [dialog, setDialog] = useState<"company" | "owner" | "void" | null>(null);
  const [reimbursable, setReimbursable] = useState(false);

  const done = () => {
    keys.clear();
    setDialog(null);
  };
  const doRoute = (to: "COMPANY" | "OWNER", reason: string) =>
    route.mutate(
      {
        id: expense.id,
        input: { to, reason, ...(to === "COMPANY" ? { reimbursable } : {}) },
        idempotencyKey: keys.keyFor(`route:${expense.id}:${to}:${reason}:${reimbursable}`),
      },
      { onSuccess: done },
    );
  const doVoid = (reason: string) =>
    voidExpense.mutate(
      { id: expense.id, reason, idempotencyKey: keys.keyFor(`void:${expense.id}:${reason}`) },
      { onSuccess: done },
    );

  const rows: [string, string][] = [
    ["Spent on", day(expense.incurredAt)],
    ["Amount", formatMoney(expense.amount, expense.currency)],
    ["Why it's here", routingReasonText(expense.routingReason)],
    ["Owed back to the driver", expense.reimbursable ? "Yes" : "No"],
    ...(expense.routeReason ? ([["Routing note", expense.routeReason]] as [string, string][]) : []),
    ...(expense.voidReason ? ([["Void reason", expense.voidReason]] as [string, string][]) : []),
  ];

  return (
    <>
      {expense.status === "UNASSIGNED" ? (
        <p className="rounded-lg border border-border bg-st-warning-bg px-4 py-3 text-[0.875rem] text-fg">
          The system couldn&apos;t tell whose cost this is. Put it in the company books, or send it to the
          owner-operator the truck&apos;s ownership names for that date.
        </p>
      ) : null}
      {expense.status === "MOVED_TO_LEDGER" ? (
        <p className="text-[0.875rem] text-fg-muted">
          This went to the truck owner&apos;s private ledger. It is not part of the company books.
        </p>
      ) : null}

      <dl className="divide-y divide-border rounded-lg border border-border">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-3 px-3 py-2 text-[0.875rem]">
            <dt className="text-fg-muted">{label}</dt>
            <dd className="text-right text-fg">{value}</dd>
          </div>
        ))}
      </dl>

      {canRouteExpense(expense, viewer) ? (
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
          <Button variant="ghost" onClick={() => setDialog("owner")}>Send to the owner-operator</Button>
          <Button variant="primary" onClick={() => setDialog("company")}>Put in company books</Button>
        </div>
      ) : null}
      {canVoidExpense(expense, viewer) ? (
        <div className="flex justify-end border-t border-border pt-4">
          <Button variant="ghost" onClick={() => setDialog("void")}>Void expense</Button>
        </div>
      ) : null}

      <ReasonDialog
        open={dialog === "company"}
        onOpenChange={(open) => setDialog(open ? "company" : null)}
        title="Put in the company books"
        description="It becomes this company's cost."
        confirmLabel="Put in books"
        pending={route.isPending}
        error={dialog === "company" ? route.error : null}
        onConfirm={(reason) => doRoute("COMPANY", reason)}
      >
        <label className="flex items-center gap-2 text-[0.875rem] text-fg">
          <input type="checkbox" checked={reimbursable} onChange={(e) => setReimbursable(e.target.checked)} />
          The driver paid it personally and is owed it back
        </label>
      </ReasonDialog>
      <ReasonDialog
        open={dialog === "owner"}
        onOpenChange={(open) => setDialog(open ? "owner" : null)}
        title="Send to the owner-operator"
        description="It leaves the company books for the private ledger of the truck's owner on that date. You won't see it again."
        confirmLabel="Send"
        pending={route.isPending}
        error={dialog === "owner" ? route.error : null}
        onConfirm={(reason) => doRoute("OWNER", reason)}
      />
      <ReasonDialog
        open={dialog === "void"}
        onOpenChange={(open) => setDialog(open ? "void" : null)}
        title="Void this expense"
        description="It leaves the books. It stays on the record, marked voided."
        confirmLabel="Void expense"
        danger
        pending={voidExpense.isPending}
        error={dialog === "void" ? voidExpense.error : null}
        onConfirm={doVoid}
      />
    </>
  );
}
