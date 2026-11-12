# Antcolos frontend architecture

Status: living document. Update §5 when a domain moves from mock to http, and §6 when debt is
paid or found. Last reviewed: 2026-11-08.

## 1. System context

```
 Browser ──► Next.js 16 app (this repo) ──HTTPS + Bearer JWT──► NestJS 11 API (../antcolos)
             App Router, client-side data                       /api/v1, Prisma/Postgres, BullMQ/Redis
             TanStack Query cache (per org)                     Swagger: /api/docs (basic auth)
```

- Environments: **staging** API `https://antcolos-staging.up.railway.app/api/v1` (Railway),
  and **production** (see `docs/workflow/WORKFLOW.md` §Deploy).
- The backend is multi-tenant. The tenant comes from the JWT's `organizationId` (or the
  `x-organization-id` header). The backend enforces permissions, org isolation, state
  machines, and idempotency. The frontend mirrors those rules for UX only.
- Backend docs this repo consumes: `../antcolos/docs/requirements/*-api-contract.md`
  (client-facing contracts), `../antcolos/docs/architecture/permission-matrix.md`, and
  `../antcolos/docs/architecture/state-machines.md`.

## 2. Layers

| Layer | Path | Owns | May import |
| --- | --- | --- | --- |
| Routes | `src/app/(app\|auth\|public)/**` | URL → screen, metadata, `params` | features, components |
| Features | `src/features/<x>/` | screens, feature components, `hooks.ts`, labels | components, lib, types, config |
| Shared UI | `src/components/{ui,layout,data,auth,common}` | primitives, shell, states, `<Can>` | lib (utils/session/permissions), types |
| Backend seam | `src/lib/api/{contracts,http,mock}` | service interfaces + two adapters + `apiClient` | lib domain, types |
| Domain logic | `src/lib/<domain>/` | pure rules: status, money, eligibility | types |
| Infrastructure | `src/lib/{query,session,permissions}` | cache keys, session/membership, `can()` | types, config |
| Types/config | `src/types`, `src/config` | canonical entities, nav, statuses, brand | none |
| Tokens | `src/styles/globals.css` | every color, radius, elevation, density | none |

## 3. Data flow (target pattern; every new integration follows it)

```
Screen (features/x/x-screen.tsx)
  └─ useTrucks(filters)                      features/x/hooks.ts
       ├─ ctx = useServiceContext()          org, membership, permissions, actor
       ├─ queryKey = [...orgKey(org), "trucks", "list", filters]
       └─ services.fleet.listTrucks(ctx, filters)     @/lib/api (registry)
            ├─ API_MODE=mock → mock/fleet.ts   in-memory, org-partitioned, checks permissions
            └─ API_MODE=http → http/fleet.ts   apiClient.get("/trucks") → toTruck(dto)
                                                └─ client.ts interceptors: Bearer, errors, cookies
```

Why: one place per domain knows the wire format. Screens get canonical types and survive
contract changes. The mock keeps `next dev` and the browser suite working without a backend,
and cache entries can't cross organizations.

## 4. Session, auth, permissions

- **Sign-in/onboarding**: `(auth)` screens call `/auth/*`. The response interceptor in
  `src/lib/api/client.ts` stores `antcolos_token` and `antcolos_next_step` (plus role/org cookies)
  via js-cookie for 7 days. `src/middleware.ts` redirects on cookie presence and `nextStep`
  (optimistic only).
- **Session**: `SessionProvider` (`src/lib/session/provider.tsx`) loads the user and
  memberships. `permissions-sync.ts` pulls `/users/me/permissions` and logs out on an
  invalid response. `useActiveMembership()`, `usePermissions()`, and `useServiceContext()`
  are the only ways UI reads identity.
- **Authorization in UI**: `can()` (`src/lib/permissions/can.ts`) normalizes backend
  dot-keys (`truck.read`) and UI colon-keys (`trucks:view`). `<Can>` hides UI. `(app)/route-guard`
  plus `ROUTE_MANIFEST` (derived from `src/config/nav.ts` + `EXTRA_ROUTES`) gate routes.
- **401** → clear cookies → `/sign-in`. There's no refresh token yet.

## 5. Domain integration status

| Domain | Backend module / contract | Frontend today | Pattern |
| --- | --- | --- | --- |
| Auth, signup, onboarding, carrier verification | identity, integrations(fmcsa) / `signup-api-contract`, `carrier-onboarding` | **http** | `lib/session/auth-api.ts` (pre-tenant, no ctx) + `features/auth/hooks.ts` |
| Invitations, acceptance, invitation requests | identity / `membership-api-contract` | **http** | service seam (`orgInvitations`), plan 01. The acceptance screen is legacy on purpose |
| Roles, permission catalog, me/permissions | identity / `permissions-api-contract` | **http** | service seam (`orgRoles`), plan 01; me/permissions in `lib/session` |
| Public carrier lookup page (`/carriers/lookup`) | integrations(fmcsa) / `carrier-lookup.md` | **http** in both modes (public, no session) | `authApi.lookupCarrierPublic` + `lib/carriers/lookup.ts`, plan 09 |
| Session roster (organization name, active membership) | identity / `membership-api-contract` (`GET /users/me/memberships`) | **http** in http mode, fixtures in mock mode | `lib/session/http-roster.ts`, plan 08 |
| People: admins, dispatchers, drivers | identity / `users-api-contract` | **http** (list, detail) | service seam (`orgPeople`), F0.2 |
| Settings → People (member roster, remove a member) | identity / `membership-api-contract` §2 | **http** in http mode; mock mode keeps the fixture screen | service seam (`orgMembers`), plan 12. Per-member permission overrides and "leave" not wired yet |
| Fleet trucks | fleet / `fleet-api-contract` (v2 draft) | **http** (list, detail, every write: create/attach, edit, status, assign, ownership hand-off, leave, archive) | service seam (`trucks`, `orgPeople`), plan 02 |
| Own profile (`/account/profile`: name, phone, headline, about me, picture) | identity / `profile.md` | **http** in http mode; mock mode keeps the public-profile screen | service seam (`selfProfile`), shared reads in `lib/api/use-self-profile.ts` (also the top-bar avatar), plan 11 |
| Public profile (username page, visibility, workplaces, share card) | **not built in backend yet** | mock | contracts seam (`profile`) |
| OCR (rate cons, documents) | documents-ai / `ocr.md` | mock | contracts seam |
| Loads, dispatch, tracking, finance, fuel, ELD, compliance, insurance, maintenance, audit, contracts, directory, workforce, reports, factoring, referrals, needs-you | **not built in backend yet** | mock | contracts seam |

In http mode the routes in `src/config/live-routes.ts` run on the real API (plan 08). Every other
route is a **demo area** (plan 10): it stays in the nav and runs on the mock adapters inside a demo
session (`lib/session/demo-session.ts`: the Northline owner's membership, organization id and
permissions, with the real organization name), under a "Demo data" banner. Demo areas are on by
default; `NEXT_PUBLIC_DEMO_AREAS=off` brings back plan 08 (hidden from the nav, "not available
yet"). Add a route to `live-routes.ts` in the same change that moves its screens to an http
adapter, and it stops being a demo area.

"Legacy" means it works against the real API but breaks invariant 1/2 (see §6). Migrate it with
`/integrate <domain>` when you next touch the screen. Don't do big-bang rewrites.

## 6. Known drift and tech debt (ordered by risk)

1. **Screens call `apiClient` directly**: only `access/acceptance-screen` is left. Fleet trucks,
   people, invitations, requests, roles and the permission catalog go through services
   (`trucks`, `orgPeople`, `orgInvitations`, `orgRoles`); sign-in, sign-up and onboarding go
   through `lib/session/auth-api.ts` + `features/auth/hooks.ts` (plan 05, F0.4). **Deliberate:** `access/acceptance-screen` stays on `apiClient`,
   because its preview/accept/reject routes are public and have no `ctx` (plan 01, decided 2026-11-02).
2. **Inline query keys not under `orgKey`** remain in mock domains (`["broker-draft", …]`,
   `["opportunities", org, …]`, `mt-loop`), where the org id is present but not the prefix. The
   cache is cleared on org switch, so this is latent.
3. ~~Role-cookie checks in UI~~: done. `LockedSection` reads `session.isDriverAccount`; the session
   provider is the one place that interprets the account type.
4. **Token in a JS-readable cookie** (js-cookie). Any XSS can read it. Longer term, move it to an
   httpOnly cookie set by a Next route handler/BFF (a Feature track, which needs backend agreement).
   No refresh flow: a 401 is a hard logout.
5. **`client.ts` interceptor does too much**: token capture from any response shape, onboarding
   cookies, role cookies, permission validation, and redirects via `window.location`. Split it when
   auth is next touched.
6. **`src/middleware.ts` is deprecated in Next 16**, and the convention is now `proxy.ts`
   (`npx @next/codemod@canary middleware-to-proxy .`). Do this as its own small Feature-track PR.
7. **Oversized screens**: `mt-loop/truck-dispatch-screen` (1,583 lines), `trailers/trailer-profile-screen`
   (1,539), `access/invite-flow` (1,405), `access/acceptance-screen` (1,233), and more over 800.
8. **Test tooling**: three runners. `vitest.config.mts` is dead (`vitest.config.ts` wins), and
   new `tests/<dir>` folders must be registered in `vitest.config.ts`.
9. **Lint baseline not green** (tests are). See WORKFLOW.md §Baseline.
10. **Hydration mismatch in the sidebar** (`components/layout/nav-link.tsx`): the server renders
    `/dispatch`, the client `/dispatch/loops`, because nav visibility comes from client-only
    session state. Seen in the full-stack run on 2026-11-02; not yet traced. React error #418 is
    logged on every (app) page in a production build.
11. **Individual accounts can't sign in** (found 2026-11-08, on production too). Sign-in always calls
    `/users/me/permissions`, which is tenant-only, so an individual dispatcher or driver gets a 403
    and is logged out. A Fix-track task.
12. **One organization per session** (plan 08). In http mode the roster holds only the JWT's
    organization. Switching needs a backend endpoint that issues a token for another membership
    (backend ask).

## 7. Decisions

- **Keep the contracts seam** and implement http adapters per domain, rather than generating
  a client from OpenAPI. The contract docs are richer than the OpenAPI (rules, errors), and
  the mock adapter is load-bearing for development and browser tests. Revisit generated
  DTO types (`openapi-typescript`) once more than ~5 domains are on http.
- **Client-side data fetching** stays the model while auth is cookie + bearer. Server
  Components fetching tenant data is deferred until token handling moves server-side.
- **Backend first**: the frontend never ships a call to an endpoint that isn't deployed on the
  target environment. Gaps are written up as backend asks.
