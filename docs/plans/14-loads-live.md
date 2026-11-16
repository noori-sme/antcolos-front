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
Phase 2 — done  hooks: loadRecordKeys (orgKey), list/get/timeline, one action mutation; lib/load-records/status.ts + 4 tests; LOAD_RECORD_STATUS + badge
Phase 3 — done  screens: live list (table/cards, search, status, sort, pages), live detail
                 (facts, stops in their own timezone, actions from allowedTransitions, cancel and
                 correct dialogs with rhf + zod), timeline (Show more); lib/load-records/format.ts
                 + 5 tests
Phase 4 — done  /loads gate (http → live, mock → mock screens), "/loads" in HTTP_LIVE_ROUTES
                 (route-availability tests moved to /dispatch as the mock-only example),
                 loads:correct_status + load.correct_status alias (+ tests), Rate Con "Approved"
                 banner links to the load; loads-live.live.spec.ts 2/2 against a local stack
                 (backend feat/loads-timeline-api, Postgres 16, Redis, seeded)
Phase 5 — done  docs: ARCHITECTURE §5, roles-and-permissions, requirements
Review          frontend-reviewer: fixed the Idempotency-Key being cleared after a failure
                 (retry is now the same intent; cancel/correct keys include the values),
                 Rate Con approval invalidates load-records (keys moved to lib/query/keys.ts),
                 no invented stop timezone, no broker-release correction target when not
                 required, dialog schemas in lib/load-records/forms.ts + 4 tests, timeline
                 empty state. contract-checker: no wire mismatch.
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

- [x] No network call in screens: hooks call `services.loadRecords`.
- [x] Every query key under `orgKey`.
- [x] Gates are permission keys (`loads:view`, `loads:edit`, `loads:correct_status`), no roles.
- [x] Contract fidelity: fields and routes exactly as the backend contract; nothing invented.
- [x] Tokens only; states from `components/data/states`.
- [x] Idempotency-Key per intent on step, cancel and correct.
- [x] 360 px: no sideways scroll.
