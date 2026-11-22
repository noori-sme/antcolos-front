# 24 — Maintenance on the real API (F2.3)

```
Status:   approved (owner, 2026-11-21: "plan all of them one by one, verify the plan and go ahead")
Phase:    1 — not started
Branch:   feat/fleet-maintenance (same name as the backend branch, noori-sme/antcolos#87)
Requirements: ../antcolos/docs/requirements/maintenance.md (M2.5)
Backend contract: ../antcolos/docs/requirements/maintenance-api-contract.md (plan 48)
Track:    Feature (new route, nav entry, permission keys)
Updated:  2026-11-21
```

## Summary

Owners and dispatchers manage service intervals on the **truck profile** (schedules by date,
miles or engine hours; latest odometer and engine hours; record a reading; acknowledge, defer,
complete the open task). **Fleet & people → Service due** lists the fleet's open maintenance
tasks. A driver sees **their truck's maintenance** at the top of My loads: what is due, record the
odometer, acknowledge. All real API (`maintenance` service, http-only). The existing mock
`/maintenance` area (defects, repair orders, trailers) is untouched and stays mock.

## Endpoint status

| Endpoint | In contract | On backend | Adapter |
| --- | --- | --- | --- |
| `GET /trucks/:truckId/maintenance` (`maintenance.read`) | yes | #87 | http |
| `POST /trucks/:truckId/maintenance/schedules` (`manage`, idempotent) | yes | #87 | http |
| `PATCH /maintenance/schedules/:id` (`manage`) | yes | #87 | http |
| `POST /maintenance/schedules/:id/archive` (`manage`, idempotent) | yes | #87 | http |
| `POST /trucks/:truckId/meter-readings` (`record_reading`, idempotent) | yes | #87 | http |
| `GET /maintenance/tasks` (`read`) | yes | #87 | http |
| `POST /maintenance/tasks/:id/acknowledge\|defer\|complete` (`manage`, idempotent) | yes | #87 | http |
| `GET /maintenance/my-truck` (`read_own`) | yes | #87 | http |
| `POST /maintenance/my-truck/meter-readings` (`update_own`, idempotent) | yes | #87 | http |
| `POST /maintenance/my-truck/tasks/:id/acknowledge` (`update_own`, idempotent) | yes | #87 | http |

`GET /trucks/:truckId/meter-readings` and `GET /maintenance/tasks/:id` are not needed by these
screens and are left out (no adapter method for an unused route).

## Permission keys (catalog)

| Backend | UI key | New? |
| --- | --- | --- |
| `maintenance.read` | `maintenance:view` | exists |
| `maintenance.manage` | `maintenance:manage` | exists |
| `maintenance.record_reading` | `maintenance:readings:record` | new, prerequisite `maintenance:view` |
| `maintenance.read_own` | `maintenance:own:view` | new |
| `maintenance.update_own` | `maintenance:own:update` | new, prerequisite `maintenance:own:view` |

## Files

| File | New/changed | Why |
| --- | --- | --- |
| `src/types/maintenance-live.ts` | new | types per the contract (`MaintenanceSchedule`, `MaintenanceTask`, `MeterReading`, `TruckMaintenance`, `MyTruckMaintenance`, inputs). A new file: `types/fleet-operations.ts` already has mock maintenance types with other shapes |
| `src/lib/api/contracts/maintenance.ts` | new | `MaintenanceService` |
| `src/lib/api/http/maintenance.ts` (+ test) | new | calls + mappers (fixtures from the contract) |
| `src/lib/api/index.ts` | changed | register `maintenance: httpMaintenanceService` (http-only, like trucks) |
| `src/lib/maintenance/due.ts` (+ test) | new | due-status labels/tone, "660 mi left · Jan 28" summary, task status labels, `scheduleInput` builder (only changed fields on edit), defer window (≤ 90 days) |
| `src/lib/query/keys.ts` | changed | `maintenanceKeys` under `[...orgKey, "trucks", "maintenance", …]`; my-truck under `[...orgKey, "maintenance", "mine"]` |
| `src/features/fleet/maintenance-hooks.ts` | new | queries + mutations with stable idempotency keys per intent; invalidate the truck's maintenance + the task list |
| `src/features/fleet/truck-maintenance-panel.tsx` | new | panel on the truck profile |
| `src/features/fleet/maintenance-dialogs.tsx` | new | schedule form (zod mirrors the contract), record reading, defer, complete |
| `src/features/fleet/service-due-screen.tsx` | new | fleet task list, status filter in `?status=` |
| `src/app/(app)/fleet/maintenance/page.tsx` | new | thin route |
| `src/features/driver-workflow/my-truck-maintenance-card.tsx` | new | driver card; shown on My loads when the caller holds `maintenance:own:view` |
| `src/features/driver-workflow/live-trips-screen.tsx` | changed | render the card above the trips |
| `src/features/fleet/truck-profile-screen.tsx` | changed | render the panel (gated `maintenance:view`) |
| `src/lib/permissions/catalog.ts` | changed | 3 keys + 5 backend mappings |
| `src/config/nav.ts`, `src/config/live-routes.ts` | changed | "Service due" `/fleet/maintenance`, `requires: ["maintenance:view"]`; live route |
| `tests/browser/fleet-maintenance.live.spec.ts` | new | live spec (mock-mode `(app)` specs can't run: plan 23 note) |
| `docs/architecture/ARCHITECTURE.md` §5, `docs/roles-and-permissions.md` | changed | domain row; new keys |

## Phases

### Phase 1 — types, contract, adapter, catalog
- [ ] Types, `MaintenanceService` (one method per used route), http adapter with mappers.
      Unknown enum values stay honest: an unknown `due.status` maps to `UNKNOWN`; an unknown
      category or task status keeps its raw string and renders through a label fallback.
- [ ] Catalog keys and backend mappings; `permissions.test.ts` cases for the mapping and
      `requiredPermissionsForPath("/fleet/maintenance")`.
- Tests: mapper tests with contract fixtures (schedule with due, task, my-truck, reading).
  → verify: `npx vitest run src/lib/api/http/maintenance.test.ts src/lib/permissions`

### Phase 2 — domain helpers, keys, hooks
- [ ] `lib/maintenance/due.ts` helpers + tests (boundaries: negative left = overdue text,
      null meters, defer max date).
- [ ] Hooks: `useTruckMaintenance(truckId)`, `useMaintenanceTasks(filters)`, `useMyTruckMaintenance()`
      (404 `NO_CURRENT_TRUCK` → `null`, not an error), mutations for each write. Each mutation
      takes an `idempotencyKey` created when the dialog opens (one per intent, reused on retry).
  → verify: `npx vitest run src/lib/maintenance`

### Phase 3 — screens
- [ ] Truck panel: latest odometer / engine hours with "Record reading" (`<Can maintenance:readings:record>`);
      schedules with due badge + summary; open task chip and actions (`<Can maintenance:manage>`):
      acknowledge, defer (reason + date ≤ 90 days), complete (date, meters, note); add / edit /
      archive schedule (`ConfirmDialog` for archive). Empty state: "No service intervals yet".
- [ ] Service due screen: tasks with unit (link to truck), title, status, due summary, opened;
      filter chips Open (default: OPEN, ACKNOWLEDGED, DEFERRED) / Completed / All; pagination.
- [ ] Driver card: their truck's open tasks with Acknowledge; "Record odometer" form; hidden
      when the caller drives no truck (404) or lacks `maintenance:own:view`.
- [ ] All four states; tokens only; 360 px.

### Phase 4 — route, nav, browser spec, live run
- [ ] Route + nav + live route.
- [ ] Live spec against the local backend on `feat/fleet-maintenance`: admin adds a schedule on a
      truck, records a reading that makes it due, the task shows on the profile and in Service due,
      defers then completes it; the driver (seeded driver assigned to the truck) sees the card,
      records a reading, acknowledges. Desktop + Pixel 7 screenshots.
  → verify: `LIVE_WEB_URL=… npx playwright test tests/browser/fleet-maintenance.live.spec.ts`, `npm run build`

### Phase 5 — docs
- [ ] ARCHITECTURE §5, roles-and-permissions, this plan's status.

## Invariant checklist
- [x] No `apiClient`/`fetch` outside `src/lib/api/http/**`
- [x] Every query key under `orgKey(org)`; mutations invalidate the truck's maintenance and the task list prefix
- [x] Gates on permission keys only (`<Can>`, nav `requires`); the backend enforces the same
- [x] Types follow the contract; DTO → canonical in the adapter, with tests
- [x] Idempotent routes send one `Idempotency-Key` per intent, reused on retry
- [x] Four states per view; tokens only
- [x] Forms: zod mirrors contract bounds (title 1–120, intervals, warn < interval, defer ≤ 90 days, note ≤ 1,000)
- [x] New route in nav and `HTTP_LIVE_ROUTES`; no new cookies
- [ ] 360 px checked (phase 4)
- [x] Tests: vitest for mappers/helpers/permissions; live Playwright for the screens

## Backend asks
- None. (Receipt upload on completion uses an existing document id only; picking a receipt file
  from here waits for M2.1 receipts.)

## Risks / open points
- The mock `/maintenance` area and the live "Service due" both appear in mock mode's nav. Mock
  mode is a demo; in http mode only "Service due" shows.
- Completing with a receipt: the UI offers a note, not a document picker, until receipts exist.
