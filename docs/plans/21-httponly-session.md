# 21 — Session in httpOnly cookies, refresh flow, `middleware.ts` → `proxy.ts` (F6.1)

```
Status:   in progress (2026-11-17; owner: "plan and implement each one of these modules")
Branch:   feat/identity-session-refresh (same name as the backend branch)
Backend:  ../antcolos/docs/plans/45-session-refresh.md; signup-api-contract.md "Session refresh"
Track:    Feature (auth/session/proxy change). Security-sensitive.
```

## Progress

```text
Phase 1 — pending  lib/api/bff.ts helpers (+ tests): cookie names/options, claims-only token, header forwarding
Phase 2 — pending  /api/session/[...path] route handler (session endpoints, refresh, logout) + tests
Phase 3 — pending  proxy.ts (renamed): /api/backend/* rewrite with Authorization from the httpOnly cookie
Phase 4 — pending  client.ts: same-origin base URLs, 401 → refresh once → retry; sign-out revokes
Phase 5 — pending  run against the local backend: sign-in, browse, expired access token refreshes, logout
```

## Why

Today the JWT sits in `antcolos_token`, a cookie page scripts can read: any XSS can steal a
session. The API is on another site (Railway) than the app (Vercel), so an httpOnly cookie set by
the API would be a third-party cookie. The app's own server holds the tokens instead.

## Design

| Piece | What it does |
| --- | --- |
| `antcolos_at` (httpOnly, `SameSite=Lax`, Secure on https, 30 days) | The real access token. |
| `antcolos_rt` (httpOnly, path `/api/session`, 30 days) | The refresh token. Only the session route ever sees it. |
| `antcolos_token` (readable, as before) | Now a **claims-only token**: the JWT with its signature removed. Existing code keeps reading presence and claims (scope, org) from it; the API rejects it as a credential. |
| `/api/session/[...path]` (route handler) | Every session-issuing call (`issuesSessionToken`: `/auth/*` except resend/forgot, `/invitations/accept/*`) goes here. It forwards to the API, and when the JSON carries `accessToken` it sets the cookies above and answers with `accessToken` replaced by the claims-only token and `refreshToken` removed. `POST /api/session/refresh` and `/logout` use the `antcolos_rt` cookie. |
| `proxy.ts` | Renamed from `middleware.ts` (Next 16). `/api/backend/*` is rewritten to the API with `Authorization: Bearer <antcolos_at>` (a client-sent `Authorization` is dropped; cookies are not forwarded). A rewrite streams the body, so Rate Con uploads are not capped by a function body limit. Page routing logic unchanged. |
| `client.ts` | Base URL `/api/backend`; session paths go to `/api/session`. No Authorization header from the browser. On 401: one shared `POST /api/session/refresh`, then the request is retried once; if refresh fails, the request is still retried once (another tab may have refreshed), then the user is signed out. |
| Sign-out | `clearAllAuthCookies()` also calls `POST /api/session/logout` (revokes the session server-side, clears the httpOnly cookies). |
| Client IP | Both hops send `x-antcolos-client-ip` + `x-antcolos-bff-secret` (`BFF_SHARED_SECRET`, server-only) so the API rate-limits per browser, not per Vercel address. |

Server-only env: `API_URL` (falls back to `NEXT_PUBLIC_API_URL`), `BFF_SHARED_SECRET` (optional).

## Backend asks

None beyond plan 45 (merged first). Ops: set `BFF_SHARED_SECRET` on Railway and Vercel, then
shorten `JWT_EXPIRES_IN`.

## Risks

- Everything authenticated now passes through the app's origin; a broken proxy breaks the app.
  Phase 5 exercises it end to end.
- Existing sessions: a signed-in user has only the old readable `antcolos_token` (a real JWT). The
  proxy accepts it once as a fallback when `antcolos_at` is missing, so nobody is signed out by the
  deploy; the next session call moves them to httpOnly cookies.
