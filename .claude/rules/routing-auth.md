---
paths:
  - "src/app/**"
  - "src/middleware.ts"
  - "src/proxy.ts"
  - "src/lib/session/**"
  - "src/lib/permissions/**"
  - "src/config/nav.ts"
  - "src/features/auth/**"
  - "src/features/access/**"
description: Routes, route groups, session, onboarding gating, permissions
---

- Route groups: `(app)` is the signed-in product shell, guarded by `ROUTE_MANIFEST`. `(auth)` holds
  sign-in, sign-up, onboarding, and invitation/referral acceptance. `(public)` holds no-auth
  share and track pages. A new page goes in exactly one group.
- `page.tsx` is thin: it unwraps `params` (a **Promise** in Next 16, so `await` it or use
  `use()`) and renders one screen from `src/features`. There's no data fetching or layout logic in it.
- Every new `(app)` route needs an entry in `src/config/nav.ts` (with `requires`) or in
  `EXTRA_ROUTES` in `src/lib/permissions/route-manifest.ts`. If you leave a child route out,
  it inherits its parent's requirements by longest prefix. Decide that on purpose.
- `src/middleware.ts` does optimistic cookie checks only (token present, `nextStep`
  onboarding redirects). It's not an authorization layer. In Next 16 the convention is
  `proxy.ts` (`middleware` is deprecated). Migrating it is its own Feature-track task
  (`npx @next/codemod@canary middleware-to-proxy .`). Don't rename it as a side effect.
- Auth cookies (`antcolos_token`, `antcolos_next_step`, role/org cookies) are written only
  by the interceptor in `src/lib/api/client.ts` and cleared only by `clearAllAuthCookies()`.
  If you add a cookie, add it to `clearAllAuthCookies()` too.
- Permissions: the backend's `/users/me/permissions` list is synced by
  `src/lib/session/permissions-sync.ts`. Keys are normalized by `src/lib/permissions/catalog.ts`
  (backend dot-notation `truck.read` ↔ UI `trucks:view`). A new backend key gets a catalog
  entry and a mapping. Don't add string fallbacks at call sites.
- A caller cannot grant, assign, or invite permissions they don't hold. Pickers filter by
  `grantable.ts`, and the backend enforces the same rule.
- Changes in this area are Feature track (auth, session, onboarding, permission catalog)
  and need a `browser` spec for the flow they touch.
