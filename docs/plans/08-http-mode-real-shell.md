# 08 — http mode without broken screens: real session, unbuilt areas handled

Status:   implemented (approved 2026-11-08: "go with option 2 now, then option 3"; unbuilt areas hidden)
Phase:    4 / 4
Updated:  2026-11-08
Track:    Feature (session/identity change, nav gating, service registry)

## Problem

In production (`NEXT_PUBLIC_API_MODE=http`, briefly live on 2026-11-08), two things went wrong:

1. **Unbuilt domains throw.** `src/lib/api/http/index.ts` maps every domain the backend lacks
   to `notImplemented()`. Home showed "HTTP adapter not implemented: home.summary", and the same
   happened on Needs You, Loads, Documents, Settlements, Invoices and every other mock-only area.
2. **The organization is a fixture.** The session roster (`membership-store.ts`) always comes from
   `fixtures.ts`, so the shell showed "Northline Freight · Owner" for the Acme Haulage admin. The
   hand-off flags this as the biggest frontend gap: member-owned trucks have no owner actions, and
   sign-in picks the driver home by comparing a role name.

Production went back to mock mode the same day as a stopgap (option 2).

## Goal

http mode is safe to run in production:
- every screen either shows real data or says plainly that the area isn't available yet;
- the shell shows the real organization and role.

## Phases

### Phase 1: a live-domain registry
- `src/config/live-domains.ts`: the domains with a real backend in http mode:
  - `auth`, `people`, `access`, `trucks`
  - `profile` later, when integrated
- `NavItem.domain?: LiveDomain | "mock-only"`, so each nav entry names what backs it.
- `isAvailable(item)` in `src/lib/permissions/route-manifest.ts`: in mock mode everything is
  available; in http mode only live domains are.
- Tests: unit tests for `isAvailable` and the manifest in both modes.

### Phase 2: the shell honours it
- **Sidebar and mobile bar:** hide unavailable items in http mode, or show them disabled per the
  decision below.
- **Routes:** `RouteGuard` renders an `EmptyState` on an unavailable route ("This area isn't
  available yet", with a link home) and never calls the service.
- **Home in http mode:** a small real Home (greeting, organization, role, and cards for the
  live areas: Trucks, People, Invitations, Roles) instead of `home.summary`.
- Tests: a browser spec in a `mobile` + `desktop` project with the http registry forced.

### Phase 3: the real session in http mode
- `lib/session/auth-api.ts` gains `myMemberships()` → `GET /users/me/memberships`, with a mapper
  `toSessionRoster(dto, me)` and a test fed from the contract example.
- In http mode the roster comes from that call, not fixtures:
  - the organization takes its `organizationName` and `organizationType`
  - the active membership is the JWT's `organizationId`
- Other memberships are listed in the switcher as "sign in to switch". The backend issues one
  tenant JWT per organization, and there is no switch endpoint (backend ask below).
- Sign-in's driver-home choice reads the session (`isDriverAccount` / membership) instead of
  `roleId === "DRIVER"`, which closes the rule-3 drift.
- Mock mode keeps the fixture roster unchanged, so the mock suite and demos are untouched.
- Tests: mapper unit test; extend `people.live.spec.ts` so the shell shows "Acme Haulage".

### Phase 4: verify, review, ship
- `/verify full`, then `frontend-reviewer`. Update ARCHITECTURE.md §5/§6.
- Then a PR to `staging`, and from there to `main`.
- Flip Vercel `NEXT_PUBLIC_API_MODE` back to `http` and redeploy. Run a live check with a seeded
  carrier admin, a dispatcher and a driver.

## Implementation notes

- Availability is a route list (`src/config/live-routes.ts`) rather than a `domain` tag on each
  nav item. One list covers nav items, child routes and the top bar, and a test checks that every
  entry exists in the nav.
- Live routes in http mode were found by visiting every (app) route against the staging API:
  - `/home` (new live home), `/fleet/trucks`
  - `/people/{drivers,dispatchers,admins}`
  - `/settings/invitations`, `/settings/permissions`

  Hidden as mock-only:
  - `/settings/users` (`access.roster`) and `/account/referrals` (`referrals.myReferrals`)
  - `/account/profile` (the profile backend exists but isn't wired yet)
  - the `/account/*` placeholders, and every load, finance, document and driver-portal route
- The top-bar Needs You inbox is hidden in http mode, and its count query is disabled. It called
  the mock-only `responsibility.attention` on every page.
- Sign-in always goes to `/home`. The Home gate reads the session and sends drivers to their
  portal, so `sign-in-screen.tsx` no longer compares role names.

## Findings (outside this plan)

- **Individual accounts can't sign in** (production too). Sign-in calls `/users/me/permissions`,
  which is tenant-only, so the seeded individual dispatcher and driver get a 403 and are logged
  out. Needs a Fix-track task (ARCHITECTURE.md §6 item 11).

## Decision (taken)

**Unbuilt areas in http mode: hide them, or show them disabled?** Answer: **hide** (2026-11-08).
- **(a) Hide** (recommended). The nav shows only what works, and a deep link gets the "not
  available yet" page.
- **(b) Show disabled, with a "Coming soon" tag.** The roadmap stays visible, but the nav gets
  long with items nobody can use.

## Backend asks

1. **Switch organization:** a way to get a tenant JWT for another membership without signing in
   again (for example `POST /auth/switch-organization { organizationId }`). Until then, the
   switcher shows other organizations as "sign in to switch".

## Risks

- **Shared org IDs.** Mock-only screens become unreachable in http mode. They stay in the code,
  with routes and tests, for mock mode. Nothing is deleted.
- **The roster store is read by many screens.** In http mode the membership id is synthetic
  (`org:<organizationId>`), because the backend doesn't return one. Screens that hold onto
  membership ids only exist in mock domains, which are unreachable in http mode.
