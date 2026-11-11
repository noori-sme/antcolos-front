# 10 — Demo areas: bring back the unbuilt areas with labelled demo data

```
Status:   implemented (approved 2026-11-11; demo areas on in production too)
Phase:    3 / 3 — done
Branch:   feat/shell-demo-areas
Requirements: this plan (no separate requirements doc: no new screens, only a mode switch)
Backend contract: none (no new calls; live areas keep their existing contracts)
Updated:  2026-11-11
Track:    Feature (nav gating, session/permissions, service registry)
```

## Summary

Plan 08 hid every area without a backend when `NEXT_PUBLIC_API_MODE=http`, so a real sign-in
sees only Home, Trucks, People, Invitations and Roles. With a new flag
`NEXT_PUBLIC_DEMO_AREAS`, those hidden areas come back in the menu and run on the existing
in-memory mocks, using the Northline demo company's data and permissions. Every demo page shows
a "Demo data" banner. The live areas, the shell (top bar, organization name, role) and sign-in
stay on the real API. With the flag off, the app behaves exactly as it does today.

## How it works

Every screen reads its organization and permissions from `SessionContext`
(`useActiveMembership`, `usePermissions`, `useServiceContext`). So a demo page doesn't need any
changes. It's wrapped in a **nested** `SessionContext.Provider`, the "demo session":

- active membership = the Northline owner fixture (`mem_northline_owner`), so mock services
  find their seeded data under `org_northline`;
- active organization = the Northline fixture, but with `displayName` set to the real
  organization's name, so pages greet the real company;
- permissions = `effectivePermissions(owner, northline)`: what the Northline owner sees in mock
  mode;
- everything else (user, memberships for the switcher, density, sign-out) comes from the real
  outer session.

The top bar and sidebar sit outside the demo session, so they keep showing the real organization.

## Endpoint status

No new endpoints. Live areas are unchanged:

| Area | Service | Adapter in http + demo |
| --- | --- | --- |
| Trucks, People, Invitations, Roles | `trucks`, `orgPeople`, `orgInvitations`, `orgRoles` | http (as today) |
| Everything else | all other services, integration ports | mock (in-memory, resets on refresh) |

## Files

| File | New/changed | Why |
| --- | --- | --- |
| `src/lib/api/mode.ts` | changed | `DEMO_AREAS` flag: `http` mode and `NEXT_PUBLIC_DEMO_AREAS` |
| `src/lib/api/index.ts` | changed | http + demo → mock adapters for non-live services (the registry `mockServices` already uses http for the four live ones) |
| `src/lib/integrations/index.ts` | changed | http + demo → mock integration ports |
| `src/lib/permissions/route-manifest.ts` | changed | `isDemoRoute(path)`. `isRouteAvailable` is true for demo routes |
| `src/lib/session/demo-session.tsx` | new | `DemoSessionProvider`, `useDemoPermissions()` |
| `src/components/data/demo-banner.tsx` | new | "Demo data" banner (tokens only) |
| `src/app/(app)/route-guard.tsx` | changed | demo route → check demo permissions, wrap in demo session + banner |
| `src/components/layout/use-visible-nav.ts` | changed | a demo item is gated on demo permissions, a live item on real ones |
| `src/components/layout/topbar.tsx` | changed | Needs You inbox comes back, inside the demo session |
| `src/features/home/home-gate.tsx` | changed | http + demo: full demo dashboard (real drivers still go to their portal) |
| `.env.example` | changed | document `NEXT_PUBLIC_DEMO_AREAS` |
| tests (see phases) | new/changed | |
| `docs/architecture/ARCHITECTURE.md` §5 | changed | note the demo mode |

## Phases

### Phase 1 — flag, registry, route availability
- [ ] `DEMO_AREAS` in `mode.ts`. Services and integration ports pick mock for non-live domains
  when it's on.
- [ ] `isDemoRoute(path, mode, demo)`: http, demo on, and not in `HTTP_LIVE_ROUTES`.
  `isRouteAvailable` returns true for demo routes.
- Tests: extend `route-availability.test.ts` for the three modes (mock, http, http + demo).

### Phase 2 — demo session, banner, guard, nav, top bar, Home
- [ ] `DemoSessionProvider` and `useDemoPermissions()`, built from the fixture roster.
- [ ] `DemoBanner`: "Demo data. These pages show sample data from a demo company. Changes
  aren't saved and reset when you refresh."
- [ ] RouteGuard, `useVisibleNav`, top-bar Needs You and HomeGate use them.
- Tests: unit test for the demo session value (org id, real display name, owner permissions);
  nav test: a demo item shows without a real permission, a live item still needs one.

### Phase 3 — browser spec, verify, docs
- [ ] Browser spec (http + demo, desktop and mobile): signed-in shell shows the real
  organization, Loads appears in the menu, opens with the banner and demo rows; Trucks has no
  banner.
- [ ] `/verify full`, `frontend-reviewer`. ARCHITECTURE.md §5, `.env.example`.

## Invariant checklist
- [x] No `apiClient`/`fetch` outside `src/lib/api/http/**` and `src/lib/session/**`: none added.
- [x] Query keys stay `orgKey(org)`: demo pages key on `org_northline`, live pages on the real
  org id, so the two caches never mix.
- [x] Gates use permission keys, never roles. Demo pages use the demo session's keys.
- [x] Types follow the contract: n/a, no new calls.
- [x] Idempotency: n/a, no new writes to the API.
- [ ] Four states: unchanged screens. The banner uses tokens only.
- [x] Forms: n/a.
- [x] No new routes or cookies.
- [ ] Mobile 360 px checked (banner).
- [ ] Tests at the right tier.

## Decision (taken)

**Demo areas on in production?** Yes (2026-11-11): Vercel deploys `main` to production, and the
owner wants the full product visible there. So the flag is **on by default** in http mode, and
`NEXT_PUBLIC_DEMO_AREAS=off` turns it off (build-time: needs a redeploy). Home is a live route;
`HomeGate` picks the demo dashboard itself after the real driver check, so real drivers still go
to their portal.

## Verification (2026-11-11)
- vitest 2258/2258, node 805/805, typecheck clean, lint 41 errors (baseline 59, none new).
- `npm run build` in http mode passes.
- `demo-areas.live.spec.ts` 6/6 (desktop + mobile) against a local backend seeded with
  `prisma db seed` (`carrier@antcolos.dev`).
- `http-shell.live.spec.ts` (plan 08) now needs a build with `NEXT_PUBLIC_DEMO_AREAS=off`.

## Backend asks
- None new. (Still open from plan 08: switch organization.)

## Risks / open points
- **Demo pages that read a live service** (for example a fleet page that lists trucks) get the
  real organization's trucks, because the live adapters scope by the JWT, not by the context.
  This already happens in mock mode today. The banner covers it, and these areas move to live
  one at a time.
- **Writes on demo pages** change only the in-memory mock and reset on refresh. The banner says so.
- **Real drivers** keep going to the driver portal from Home. Driver portal pages are demo pages
  and show the Northline demo driver only when the Northline owner could see them in mock mode.
- Mock mode and http mode with the flag off are unchanged; the existing suites cover them.
