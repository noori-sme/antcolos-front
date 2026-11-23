# 27 — Session in httpOnly cookies, refresh flow, `middleware.ts` → `proxy.ts` (F6.1)

```
Status:   implemented (2026-11-17; owner: "plan and implement each one of these modules")
Branch:   feat/identity-session-refresh (same name as the backend branch)
Backend:  ../antcolos/docs/plans/45-session-refresh.md; signup-api-contract.md "Session refresh"
Track:    Feature (auth/session/proxy change). Security-sensitive.
```

## Progress

```text
Phase 1 — done  lib/api/bff.ts helpers + 5 tests
Phase 2 — done  /api/session/[...path] route handler + 7 tests
Phase 3 — done  proxy.ts (renamed): /api/backend/* rewrite with Authorization from the httpOnly cookie
Phase 4 — done  client.ts: same-origin base URLs, 401 → shared refresh → retry; sign-out revokes
Phase 5 — done  run against the local backend (results below)
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
  proxy keeps accepting it while `antcolos_at` is missing, until it expires (`JWT_EXPIRES_IN`), so
  nobody is signed out by the deploy; their next sign-in moves them to httpOnly cookies. Remove the
  fallback (`accessTokenFrom` in `lib/api/bff.ts`) once that time has passed.
- **Deployment requirement:** the client IP sent to the API is the first `X-Forwarded-For` entry.
  Vercel overwrites that header, so it is trustworthy there. On any host that passes a
  client-supplied `X-Forwarded-For` through, leave `BFF_SHARED_SECRET` unset (per-IP limits then
  fall back to the proxy's address) until the IP is read from that host's own header.

## Verification (2026-11-17)

Local stack: backend branch `feat/identity-session-refresh` with `JWT_EXPIRES_IN=20s` and
`BFF_SHARED_SECRET`, this app in http mode on :3001, Playwright.

- Sign-in: `antcolos_at` httpOnly path `/`; `antcolos_rt` httpOnly path `/api/session`;
  `antcolos_token` readable and claims-only (no signature). Page scripts see no usable token. No
  browser request goes to the API's origin.
- After 25 s (access token expired): `/users/me/permissions` 401 and `/auth/me` 401 → one
  `POST /api/session/auth/refresh` 200 → requests retried; the user stays on the page.
- The readable `antcolos_token` sent straight to the API → 401.
- Logout: the three session cookies cleared; the session family revoked in the database.
- Upload: a 1.5 MB PDF through `/api/backend/documents/rate-confirmations` → 202 with the exact
  byte size; without the cookie → 401.
- Rate limiting: 11 wrong-password logins from one browser IP → 10×401 then 429; from 11 IPs → no
  429 (the API keys on `x-antcolos-client-ip` with the shared secret).
- Found and fixed while running it: the 401 handler signed out on `/auth/me` before trying a
  refresh; the session route forwarded the browser's `Content-Length` with a rebuilt body, so the
  API dropped the connection.
- vitest 140 files / 2360 tests pass; build passes (`ƒ Proxy`, `/api/session/[...path]`); new files
  lint clean (`client.ts` keeps its one pre-existing error).
- Browser specs (mock mode): `carrier-lookup` passes after its stub follows the new path.
  `landing-auth-boundary` (4 tests: sign-in/sign-up against the mock password) and
  `driver-self-onboarding` fail the same way on `origin/main` (checked on the same machine): not
  caused by this change.

## Security review (2026-11-17) and fixes

| Finding | Fix |
| --- | --- |
| BLOCKING: login CSRF — a cross-site form could POST to `/api/session/auth/login` and plant the attacker's session (Lax cookies are stored on top-level navigation responses). | Non-GET session calls must come from this origin (`Origin`, else `Sec-Fetch-Site`) and be JSON; same origin check on non-GET `/api/backend/*` in `proxy.ts`. Verified live: cross-site form login → 403, cross-site API write with a valid cookie → 403. |
| Proxy buffers bodies to 10 MB (`experimental.proxyClientMaxBodySize`); API takes 20 MB Rate Cons. | Raised to 25 MB in `next.config.ts`. Verified: a 15 MB upload → 202 with the exact byte size. |
| Any failed refresh (429, 5xx, network) signed the user out and revoked the session. | Session route: only the API's 401 → 401; anything else → 503. Client: `unavailable` keeps the session. |
| Two tabs refreshing together could sign each other out. | Refresh serialized across tabs with Web Locks; after an `expired` answer the retry waits 750 ms; one sign-out path. Verified: two tabs past expiry → one refresh (200), both stay signed in, no reuse event. |
| Wording: the legacy fallback is not "once". | Fixed in code comment, test name and Risks above. |
| Tests for the proxy and the refresh decision. | `backendTarget`, `isAllowedOrigin`, `isJsonOrEmpty` (bff.test.ts), CSRF and 503 cases (route.test.ts), `refreshOutcome` (refresh-outcome.test.ts). |

Checked clean by the review: no open proxy (host fixed; `//host` stays on the API), headers
replaced not merged (browser `cookie`/`authorization`/`x-antcolos-*` dropped), no token in
page-readable responses or logs, cookie flags/paths, no refresh loop.
