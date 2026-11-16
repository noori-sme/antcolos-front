# 14 — Loads list, load detail and timeline on the real API (F1.2)

```
Status:   implemented (2026-11-16; owner: "plan … and implement with your default recommendation")
Branch:   feat/loads-list-detail
Requirements: docs/requirements/loads-live.md
Backend contract: ../antcolos/docs/requirements/loads-api-contract.md §2–§8
          (noori-sme/antcolos#58 plan 29, #59 plan 30: merge and deploy those first)
Track:    Feature (new http domain, routes go live, new permission key)
```

## Progress

```text
Phase 1 — done  types (src/types/load-record.ts), contract + http adapter + 7 mapper tests (contract fixtures)
Phase 2 — hooks: loadRecordKeys (orgKey), list/get/timeline, step/cancel/correct mutations
Phase 3 — screens: live list, live detail (facts, stops, actions, dialogs), timeline
Phase 4 — /loads gate (http → live, mock → today's screens), HTTP_LIVE_ROUTES, permission key
          loads:status:correct + alias, status config, browser spec (.live)
Phase 5 — docs: ARCHITECTURE §5, roles-and-permissions, requirements
```

## Design

- **Seam.** A new http-only service `loadRecords` (like `rateConIntake`): its own contract and
  canonical types, because the mock `loads` contract models much more (drivers, exceptions,
  documents, views) than the backend has. The mock `loads` service and screens stay for mock
  mode; `/loads` chooses by `API_MODE`, as Home does.
- **Mapping.** Statuses map explicitly (`EN_ROUTE_PICKUP` → `en_route_pickup`); an unknown value
  throws. Money stays a decimal string; dates stay ISO strings; windows are shown in the stop's
  timezone with `Intl.DateTimeFormat`.
- **Cache.** `loadRecordKeys` under `orgKey`. A mutation sets the returned detail and
  invalidates the list and the load's timeline.
- **Actions** render only from `allowedTransitions`; labels live in
  `src/lib/load-records/status.ts` (pure, tested): label, tone, action label, and the trip order
  used to offer correction targets.

## Files

New: `src/types/load-record.ts`, `src/lib/api/contracts/load-records.ts`,
`src/lib/api/http/load-records.ts` (+ test), `src/lib/load-records/status.ts` (+ test),
`src/features/loads/live-*.tsx`, `tests/browser/loads-live.live.spec.ts`.
Changed: `src/lib/api/index.ts`, `src/features/loads/hooks.ts`, `src/app/(app)/loads/**/page.tsx`,
`src/config/live-routes.ts`, `src/config/statuses.ts`, `src/components/common/status-badge.tsx`,
`src/lib/permissions/catalog.ts`, docs.

## Invariant checklist

- [ ] No network call in screens: hooks call `services.loadRecords`.
- [ ] Every query key under `orgKey`.
- [ ] Gates are permission keys (`loads:view`, `loads:edit`, `loads:status:correct`), no roles.
- [ ] Contract fidelity: fields and routes exactly as the backend contract; nothing invented.
- [ ] Tokens only; states from `components/data/states`.
- [ ] Idempotency-Key per intent on step, cancel and correct.
- [ ] 360 px: no sideways scroll.
