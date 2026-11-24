# Plan 28 — Company expenses and the owner-operator ledger (F2.2)

Backend: plan 51 (`../antcolos/docs/plans/51-expense-routing.md`), branch
`feat/finance-expense-routing`. Contract: `../antcolos/docs/requirements/expenses-api-contract.md`.
Milestone F2.2 (company expense views + owner-operator ledger).

Status: **IN PROGRESS** (2026-11-24). Approved with plan 51 ("accept all", product owner
2026-11-24). Track: Feature (new routes, permission keys, nav). Branch:
`feat/finance-expense-routing` (same name as the backend).

## Goal

1. Accountants and admins see the **company books** (`/finance/expenses`): what each confirmed
   receipt cost, with the **unassigned** queue first. They route an unassigned expense to the
   company books or to the truck's owner-operator, and void a wrong one, always with a reason.
2. An owner-operator sees **their own ledger** (`/driver/ledger`): expenses of the trucks they
   own, from every carrier, private to them. They can dismiss an entry that isn't theirs.

## Decisions

| Question | Decision |
| --- | --- |
| Data | New `expenses` domain, **http-only** (like receipts): `contracts/expenses.ts`, `http/expenses.ts`, no mock. |
| Money | Decimal strings end to end; `formatMoney` from `lib/receipts`. |
| Permissions | `expense.read` → existing `expenses:view`; new `expense.route` → `expenses:route`, `expense.update` → `expenses:void`. Accountant template mirrors the backend. The user-owned ledger needs no key (`/users/me/ledger`). An organization-owned ledger (`/ledger`, `ledger.read`) has no screen yet: noted below. |
| Routing | The route dialog offers "Company books" or "The truck's owner-operator"; the owner is never chosen by hand (the backend derives it, 409 `NO_OWNER_TO_ROUTE_TO` otherwise). |
| Routes | `/finance/expenses` (Business nav, `expenses:view`); `/driver/ledger` (driver app, no key; in `DRIVER_OPEN_ROUTES`). Both in `HTTP_LIVE_ROUTES`. |
| Idempotency | One key per intent (`createIntentKeys`). |

## Phases

```text
Phase 1 — types, contract, http adapter (+ mapper test), registry, permission keys
          → verify: vitest, typecheck
Phase 2 — hooks, labels (+ test), company expenses screen with route/void, my ledger screen with dismiss,
          routes, nav, live routes
          → verify: lint, typecheck, build
Phase 3 — live browser spec against the local backend; frontend-reviewer; PR after the backend is on staging
```

## Not in this plan

An organization-owned ledger screen (`/ledger`; the API exists), ledger totals and estimated net
(M2.3), export.
