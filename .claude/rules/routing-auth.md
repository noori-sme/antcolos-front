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
- `src/proxy.ts` (Next 16's name for middleware) does optimistic cookie checks only (token
  present, `nextStep` onboarding redirects); it's not an authorization layer. It also rewrites
  `/api/backend/*` to the API with `Authorization` from the httpOnly `antcolos_at` cookie (plan 21).
- The usable tokens are httpOnly (`antcolos_at`, `antcolos_rt`), written only by
  `src/app/api/session/[...path]/route.ts`. `antcolos_token` is a readable, claims-only copy
  (no signature): read claims from it, never send it. Other auth cookies (`antcolos_next_step`,
  role/org) are written only by the interceptor in `src/lib/api/client.ts` and cleared only by
  `clearAllAuthCookies()`, which also calls `/api/session/auth/logout`. If you add a cookie, add
  it to `clearAllAuthCookies()` too. Never call the API's origin from the browser.
- Permissions: the backend's `/users/me/permissions` list is synced by
  `src/lib/session/permissions-sync.ts`. Keys are normalized by `src/lib/permissions/catalog.ts`
  (backend dot-notation `truck.read` ↔ UI `trucks:view`). A new backend key gets a catalog
  entry and a mapping. Don't add string fallbacks at call sites.
- A caller cannot grant, assign, or invite permissions they don't hold. Pickers filter by
  `grantable.ts`, and the backend enforces the same rule.
- Changes in this area are Feature track (auth, session, onboarding, permission catalog)
  and need a `browser` spec for the flow they touch.
