# Antcolos frontend architecture

Status: living document. Update §5 when a domain moves from mock to http, and §6 when debt is
paid or found. Last reviewed: 2026-11-01.

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
| Auth, signup, onboarding, carrier verification | identity, integrations(fmcsa) / `signup-api-contract`, `carrier-onboarding` | **http** | legacy: direct `apiClient` in `features/auth/*` |
| Invitations, acceptance, invitation requests | identity / `membership-api-contract` | **http** | legacy, in `features/access/*` |
| Roles, permission catalog, me/permissions | identity / `permissions-api-contract` | **http** | legacy, in `features/access/roles-screen`, `lib/session` |
| People: admins, dispatchers, drivers | identity / `users-api-contract` | **http** | legacy, in `features/{admins,dispatchers,driver}` |
| Fleet trucks | fleet / `fleet-api-contract` (v2 draft) | **http** (list, detail) | legacy: `fleet-roster-screen`, `truck-profile-screen` |
| Profile | identity / `profile.md` | mock | contracts seam |
| OCR (rate cons, documents) | documents-ai / `ocr.md` | mock | contracts seam |
| Loads, dispatch, tracking, finance, fuel, ELD, compliance, insurance, maintenance, audit, contracts, directory, workforce, reports, factoring, referrals, needs-you | **not built in backend yet** | mock | contracts seam |

"Legacy" means it works against the real API but breaks invariant 1/2 (see §6). Migrate it with
`/integrate <domain>` when you next touch the screen. Don't do big-bang rewrites.

## 6. Known drift and tech debt (ordered by risk)

1. **Screens call `apiClient` directly** (26 files across `features/{auth,access,admins,
   dispatchers,driver,fleet}`). DTO interfaces are redeclared per screen (`TruckItem`,
   `TruckDetail` live in both fleet screens), and the `httpServices` registry is all
   `notImplemented`, so mock/http switching doesn't apply to these domains. Fix: `/integrate`.
2. **Inline, non-org-namespaced query keys** (`["trucks", …]`, `["broker-draft", …]`). The cache
   is cleared on org switch, so this is latent, not live, but it breaks the structural guarantee.
3. **Role-cookie checks in UI**: `components/layout/locked-section.tsx` reads
   `antcolos_user_role === "DRIVER"`. That's a role-name check, so move it to a permission or workspace kind.
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
9. **Baseline not green**: lint errors and failing tests on `staging`. See WORKFLOW.md §Baseline.

## 7. Decisions

- **Keep the contracts seam** and implement http adapters per domain, rather than generating
  a client from OpenAPI. The contract docs are richer than the OpenAPI (rules, errors), and
  the mock adapter is load-bearing for development and browser tests. Revisit generated
  DTO types (`openapi-typescript`) once more than ~5 domains are on http.
- **Client-side data fetching** stays the model while auth is cookie + bearer. Server
  Components fetching tenant data is deferred until token handling moves server-side.
- **Backend first**: the frontend never ships a call to an endpoint that isn't deployed on the
  target environment. Gaps are written up as backend asks.
