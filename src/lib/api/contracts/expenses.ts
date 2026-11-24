import type { Paginated } from "@/types/common";
import type { Expense, ExpenseFilters, LedgerEntry, LedgerFilters, RouteExpenseInput } from "@/types/expense";
import type { ServiceContext } from "./context";

/**
 * The company books and the caller's own owner-operator ledger (F2.2, backend
 * plan 51): ../antcolos/docs/requirements/expenses-api-contract.md. http-only.
 * Route, void and dismiss take one Idempotency-Key per intent.
 */
export interface ExpensesService {
  /** GET /expenses: this organization's books, most recent spend first. */
  list(ctx: ServiceContext, filters: ExpenseFilters): Promise<Paginated<Expense>>;
  /** GET /expenses/:id */
  get(ctx: ServiceContext, id: string): Promise<Expense>;
  /** POST /expenses/:id/route: COMPANY, or the truck's owner-operator (derived by the backend). */
  route(ctx: ServiceContext, id: string, input: RouteExpenseInput, idempotencyKey: string): Promise<Expense>;
  /** POST /expenses/:id/void */
  void(ctx: ServiceContext, id: string, reason: string, idempotencyKey: string): Promise<Expense>;
  /** GET /users/me/ledger: the signed-in user's own ledger, across every carrier. */
  myLedger(ctx: ServiceContext, filters: LedgerFilters): Promise<Paginated<LedgerEntry>>;
  /** POST /users/me/ledger/:id/dismiss */
  dismissMine(ctx: ServiceContext, id: string, reason: string, idempotencyKey: string): Promise<LedgerEntry>;
}
