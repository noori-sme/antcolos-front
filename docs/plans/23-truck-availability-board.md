# 23 — Truck availability board (F2.5)

```
Status:   implemented (2026-11-21; owner: "plan all of them, verify the plan and go ahead")
Phase:    5 — done (plan reviewed by frontend-reviewer 2026-11-21; findings applied)
Branch:   feat/fleet-availability-board
Requirements: this plan (milestones.md F2.5; spec §18 M2 "truck availability view")
Backend contract: ../antcolos/docs/requirements/fleet-api-contract.md → "Truck availability" (plan 47, #84)
Track:    Feature (new route and nav entry)
Updated:  2026-11-21
```

## Summary

A dispatcher or owner opens **Fleet & people → Availability** and sees every truck of the fleet
grouped by when it comes empty: available now, within 5 hours, later today, later, unknown,
maintenance, unavailable. Each row shows the unit, equipment, operating status, the estimated
empty time (relative and local clock time) and the city where it empties, with a link to the
active load. A row opens the truck's stored predictions against the actual empty time, so the
owner can see how good the estimates are. Real API only (the trucks service is http-only).

## Endpoint status

| Endpoint | In contract | On backend main | Adapter |
| --- | --- | --- | --- |
| `GET /api/v1/fleet/availability?bucket=&page=&pageSize=` (`truck.read`) | yes | yes (#84) | http |
| `GET /api/v1/fleet/availability/:truckId/history?page=&pageSize=` (`truck.read`, 404 off-fleet) | yes | yes (#84) | http |

`pageSize` max 100 (backend `MAX_PAGE_SIZE`). The list is sorted soonest empty first by the API.

## Files

| File | New/changed | Why |
| --- | --- | --- |
| `src/types/fleet-truck.ts` | changed | `AVAILABILITY_BUCKETS` const array, `AvailabilityBucket`, `TruckAvailability`, `AvailabilityPrediction` |
| `src/lib/api/contracts/trucks.ts` | changed | `listAvailability`, `availabilityHistory` on `TrucksService` |
| `src/lib/api/http/trucks.ts` (+ test) | changed | calls + DTO mappers using `oneOf` / `toPage` / `queryParams` from `http/dto.ts`; `oneOf` returns `undefined`, so an unknown bucket falls back to `UNKNOWN` explicitly; fixtures copied from the contract example |
| `src/lib/fleet/availability.ts` (+ test) | new | bucket order and labels, "empties in 3 h 20 min" / "overdue" text, prediction error text ("42 min late") |
| `src/lib/query/keys.ts` | changed | new `availabilityKeys` under `[...orgKey(org), "trucks", "availability", …]`, so a truck mutation that invalidates `fleetKeys.all` also refreshes the board |
| `src/features/fleet/hooks.ts` | changed | `useTruckAvailability`, `useAvailabilityHistory` |
| `src/features/fleet/availability-board-screen.tsx` | new | bucket filter chips with counts from the loaded page, grouped list, four states |
| `src/features/fleet/availability-history-dialog.tsx` | new | predictions vs actuals for one truck, paginated |
| `src/app/(app)/fleet/availability/page.tsx` | new | thin route |
| `src/config/nav.ts` | changed | "Availability" under Fleet & people, `requires: ["trucks:view"]` |
| `src/config/live-routes.ts` | changed | `/fleet/availability` in `HTTP_LIVE_ROUTES`, otherwise http mode shows "not available yet" (covered by `route-availability.test.ts`) |
| `src/lib/permissions/permissions.test.ts` | changed | `requiredPermissionsForPath("/fleet/availability")` → `["trucks:view"]` (the refusal check, pure) |
| `tests/browser/fleet-availability.live.spec.ts` | new | live spec (see Phase 4 note): real sign-in and board; the on-trip scenarios stub only the availability endpoints |
| `docs/architecture/ARCHITECTURE.md` §5 | changed | availability: http |

## Phases

### Phase 1 — types, contract, adapter
- [ ] Types per the contract; `listAvailability(ctx, { bucket?, page, pageSize })` →
      `Paginated<TruckAvailability>`; `availabilityHistory(ctx, truckId, { page, pageSize })` →
      `Paginated<AvailabilityPrediction>`. 404 on history surfaces as the existing not-found error.
- Tests: mapper tests (full row, empty truck with nulls, unknown bucket value → `UNKNOWN`,
  history with and without `actualEmptyAt`). → verify: `npx vitest run src/lib/api/http/trucks.test.ts`

### Phase 2 — domain helpers, hooks, keys
- [ ] `lib/fleet/availability.ts`: `BUCKET_ORDER`, `bucketLabel`, `emptyInText(estimatedEmptyAt, now)`
      ("now", "in 45 min", "in 3 h 20 min", "overdue by 1 h"), `predictionErrorText(minutes)`
      ("on time" within 5 min, "42 min late", "1 h 10 min early", "not delivered yet").
- [ ] Keys under `orgKey(org)`; hooks use `useServiceContext()`; history query enabled only while
      the dialog is open. `refetchInterval: 5 min`, `refetchIntervalInBackground: false`: ETAs move
      with drivers' trip steps, which other people make, so the board would otherwise go stale
      while it sits open on a dispatcher's screen.
- Tests: helper unit tests incl. boundaries (exactly 5 h, past time, null). → verify:
  `npx vitest run src/lib/fleet/availability.test.ts`

### Phase 3 — screens
- [ ] Board: header with "Updated hh:mm" and a refresh button; bucket chips (All + each bucket,
      chip shows count of rows on the page); rows grouped by bucket in `BUCKET_ORDER`; row = unit
      (link to truck profile), equipment label, operating status badge (`TruckOperationalBadge` in `components/common/status-badge.tsx`, which takes the API's uppercase status; not `TruckStatusChip`, which is the old mock status),
      empties text + local time, empty city/state, "Load" link when `activeLoadId` (gated on
      `loads:view`), "History" button. `UNKNOWN` rows say why in plain words ("On a trip; no
      delivery time we can see").
- [ ] Pagination like the roster (`useState(page)`, `keepPreviousData`, pageSize 50). Bucket filter →
      `bucket` query param, kept in the URL (`?bucket=`, `useSearchParams`, screen wrapped in
      `Suspense`) so the view can be shared.
- [ ] History dialog: table predicted / recorded / actual / error; empty state "No predictions
      stored yet — the hourly job records one when a load's planned empty time changes".
- [ ] Loading / empty / error states from `components/data/states`; tokens only; 360 px: rows
      become stacked cards.
- Tests: component logic stays in lib; the screen is covered by the browser spec.

### Phase 4 — route, nav, browser spec
- [ ] `app/(app)/fleet/availability/page.tsx`; nav entry (route manifest derives from nav).
- [ ] `live-routes.ts` entry; permissions test for the route's key.
- [x] Browser spec, **live** instead of mock (found while building): in mock mode
      `(app)/route-guard.tsx` sends a browser without an `antcolos_token` cookie to `/sign-in`
      (pre-existing on `main`; the CI browser job is `continue-on-error`), and with a cookie the
      permission sync calls the real API. So `fleet-availability.live.spec.ts` signs in to the
      local stack, checks the real board, filter-in-URL and reload, and stubs only the
      availability endpoints for trucks on a trip, the history dialog and the error state.
      The refusal for a seat without `trucks:view` is the pure permissions test above.
- [ ] Manual run against the local backend (#84 code): seed a truck on a load with a delivery
      window, check the bucket and ETA; screenshots desktop 1280 and mobile 360.
- → verify: `npm run test:browser -- fleet-availability`, `npm run build`

### Phase 5 — docs
- [ ] ARCHITECTURE §5, this plan's status, milestones F2.5 (backend repo) after merge.

## Invariant checklist
- [x] No `apiClient`/`fetch` outside `src/lib/api/http/**` — calls live in `http/trucks.ts`
- [x] Every query key starts with `orgKey(org)`; no mutations (read-only screen)
- [x] Gates use permission keys: nav/route `trucks:view`, load link `loads:view`
- [x] Types follow the contract; DTO → canonical mapping in the adapter, with tests
- [x] Idempotent routes: n/a, read-only
- [x] Four states for every data view; tokens only
- [x] Forms: n/a (no form; the bucket filter is a fixed enum)
- [x] New route is in nav and `HTTP_LIVE_ROUTES`; no new cookies
- [ ] Mobile 360 px checked (phase 4)
- [x] Tests at the right tier: vitest for mappers/helpers, Playwright for the screen

## Backend asks
- None. (Counts per bucket across all pages would need a summary endpoint; the chips count the
  loaded page only and say so. A fleet larger than 100 trucks is not expected before M6.)

## Risks / open points
- Chip counts are per page, not fleet-wide (see above). Labelled "on this page" when more pages exist.
- `estimatedEmptyAt` is shown in the viewer's local time; the delivery stop's timezone is not in
  the response. The text says "your time".

## Verification (2026-11-21)

- vitest: new `trucks-availability.test.ts` (4), `availability.test.ts` (7), permissions route key (1).
- Live spec against the local backend on `main` (#84) and this app in http mode:
  `fleet-availability.live.spec.ts` 9 passed, 1 skipped (mobile-only check on desktop).
- Real data: two trucks (available, maintenance) render in their groups; `?bucket=MAINTENANCE`
  filters the request and survives a reload; history dialog shows its empty state.
- Screenshots desktop 1280 and Pixel 7: no horizontal scroll; rows stack on the phone.
- Found, not fixed (out of scope): mock-mode browser specs that open `(app)` routes land on
  `/sign-in` locally and in CI (route guard, above). Worth its own Fix.

