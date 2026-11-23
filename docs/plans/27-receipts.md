# Plan 27 — Receipts (F2.1)

Backend: plan 50 (`../antcolos/docs/plans/50-receipts.md`), merged as noori-sme/antcolos#92.
Contract: `../antcolos/docs/requirements/receipts-api-contract.md`. Milestone F2.1.

Status: **IN PROGRESS** (2026-11-23). Approved with plan 50 ("start implementing other
phases", product owner 2026-11-23). Track: Feature (new routes, new permission keys, nav).
Branch: `feat/finance-receipts` (same name as the backend).

## Goal

1. A driver photographs a fuel, repair or toll receipt from their phone and sees it in "My
   receipts". A fuel receipt is read and usually confirmed by the system; anything waiting
   for them shows what to check, and they confirm it in one step (with corrections).
2. A reviewer (accountant, admin) works the queue of receipts waiting for review: confirm
   with corrections, or reject with a reason. A dispatcher sees the fleet's receipts.

## Decisions

| Question | Decision |
| --- | --- |
| Data | New `receipts` domain, **http-only** (like maintenance and driver loads): `contracts/receipts.ts`, `http/receipts.ts`, no mock. The existing mock `fuel` (IFTA) area is untouched. |
| Money | Amounts stay the contract's decimal strings end to end (display and input); never parsed to floats for arithmetic. The form validates them with the contract's patterns. |
| Permissions | New UI keys mapped from the backend: `receipt.create` → `receipts:create`, `receipt.read` → `receipts:view`, `receipt.read_own` → `receipts:own:view`, `receipt.confirm_own` → `receipts:own:confirm`, `receipt.review` → `receipts:review`. Role templates mirror the backend defaults. |
| Routes | `/driver/receipts` (driver app, `receipts:create`): capture + own list + confirm. `/finance/receipts` (Business nav, `receipts:view`): list with status/kind filters, detail sheet, confirm/reject for `receipts:review`. |
| Idempotency | One key per intent (`createIntentKeys`), reused on retry, rotated after success. |
| Failures | The detail shows the backend's `failures` as plain sentences (label map in `src/lib/receipts/receipt-rules.ts`). |
| Polling | A receipt in `EXTRACTING` refetches every 3 s until it leaves that state (stops after 2 min). |

## Phases

```text
Phase 1 — types + contract + http adapter (+ mapper test), registry, permission catalog/mapping/templates
          → verify: vitest src/lib/api/http/receipts.test.ts, src/lib/permissions, typecheck
Phase 2 — hooks + labels (+ test for pure helpers)
          → verify: vitest, typecheck
Phase 3 — driver screen (capture, list, confirm) + review screen (filters, detail, confirm, reject)
          + routes + nav
          → verify: lint, typecheck, build
Phase 4 — live browser spec against the local backend; frontend-reviewer; PR to main once the
          backend is on staging
          → verify: LIVE spec, npm run build
```

## Backend asks

None blocking. Noted: auto-confirmed fuel receipts have no vendor/place until the hub scores
those fields (plan 50 open question).
