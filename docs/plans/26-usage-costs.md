# 26 — Usage & costs (M6.3 frontend)

```
Status:   approved (owner, 2026-11-21: "plan all of them one by one, verify the plan and go ahead")
Phase:    1 — not started
Branch:   feat/platform-cost-dashboard (same name as noori-sme/antcolos#89)
Backend contract: ../antcolos/docs/requirements/usage-api-contract.md (plan 49)
Track:    Feature (new route, nav entry, permission key)
Updated:  2026-11-22
```

## Summary

Settings → **Usage & costs**: an organization admin sees, for the last 7, 30 or 90 days, their AI
calls and cost, stored files and estimated storage cost, email and Telegram messages, an
estimated total, a daily AI chart, the unit prices used and what is not metered yet.
`GET /api/v1/organizations/usage` (`usage.read`) only; the platform route has no frontend yet.

## Files

| File | Why |
| --- | --- |
| `src/types/usage.ts` | report types per the contract |
| `src/lib/api/contracts/usage.ts`, `http/usage.ts` (+ test) | `usage.organization(ctx, { from, to })`, mapper from the contract example; http-only |
| `src/lib/usage/format.ts` (+ test) | USD (4 dp under $1, 2 above), bytes ("1.2 GB"), range presets (UTC) |
| `src/lib/query/keys.ts` | `usageKeys.organization(org, range)` |
| `src/features/usage/hooks.ts`, `usage-screen.tsx` | screen: range chips in `?range=`, tiles, daily bars (tokens only, table fallback for screen readers), rates and not-metered note; four states |
| `src/app/(app)/settings/usage/page.tsx` | thin route |
| `src/config/nav.ts`, `live-routes.ts`, `src/lib/permissions/catalog.ts`, `types/permission.ts` | `usage:view` ↔ `usage.read`; Settings → Organization section |
| `tests/browser/usage.live.spec.ts` | live spec |

## Phases
1. Types, contract, adapter, key + catalog (mapper + permission tests).
2. Format helpers, keys, hook.
3. Screen + route + nav + live route; live spec against #89; docs.

## Invariant checklist
- [x] Calls only in `http/usage.ts`; key under `orgKey`; gate `usage:view`
- [x] Types follow the contract; mapper tested with the contract example
- [x] Read-only: no idempotency
- [x] Four states; tokens only (bars use `bg-primary`)
- [x] Route in nav and `HTTP_LIVE_ROUTES`
- [ ] 360 px (phase 3)

## Backend asks
- None. (A platform UI needs platform sign-in in this app: a separate feature.)
