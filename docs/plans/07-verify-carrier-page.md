# 07 — Carrier verification link page

Status:   implemented (product owner: "add the verify-carrier page too", 2026-11-08)
Phase:    done
Updated:  2026-11-08
Track:    Feature (new public route under `(auth)`, onboarding middleware change)

## Summary

The backend emails the carrier's FMCSA-registered address a link
`{APP_PUBLIC_URL}/verify-carrier?token=<raw token>`
(`../antcolos/docs/requirements/carrier-onboarding.md` §3). The frontend had no page at that
path and never called `POST /auth/verify-carrier`, so a carrier owner could not finish signup
from the email. This adds the page.

## Contract

`POST /api/v1/auth/verify-carrier` `{ "token" }`: public, no JWT, not idempotent (a second
click loses the race on `verifiedAt`).
- `201`: tenant auth payload (`user.scope = "tenant"`, `role = "ADMIN"`,
  `organizationType = "CARRIER"`) plus `accessToken`.
- `400`: token unknown, used or expired; or `identifier_mismatch`.
- `403`: account not active.
- `404 carrier_not_found`.
- `409`: carrier already registered, or onboarding already finished.
- `422`: carrier not operating, or name missing.
- `5xx`: upstream lookup.

The token stays unused on every error.

## Changes

| File | Change |
| --- | --- |
| `src/lib/session/auth-api.ts` | `authApi.verifyCarrier(token)` → `postAuth("/auth/verify-carrier")` |
| `src/features/auth/hooks.ts` | `useVerifyCarrier` |
| `src/features/auth/verify-carrier-screen.tsx` | new: states for no token, verifying, verified, and failed |
| `src/app/(auth)/verify-carrier/page.tsx` | new thin route |
| `src/lib/session/route-access.ts` | `/verify-carrier` is an auth path (reachable signed out, e.g. on another device) |
| `src/middleware.ts` | mid-onboarding sessions may open `/verify-carrier` (it was redirected to `/onboarding`, losing the token) |

The session token, `nextStep` cookie and account-kind cookies are handled by the existing
interceptor: `/auth/*` responses may set the session, and a mutation with no `nextStep` clears it.

## Decisions

- **Verify on open.** The page posts the token once on load (guarded against a double effect),
  the same as `/verify-email`. The backend leaves the token unused on failure, so retrying is safe.
- **Success** shows a confirmation and a "Go to your workspace" button. The button syncs
  permissions and goes to `/home`, the same way `enterWorkspace` finishes onboarding.
- **Failure** shows the backend message and points to onboarding, where a new link can be sent.
  The page doesn't re-implement the send.

## Tests

- `route-access.test.ts`: `/verify-carrier` is an auth path.
- `session-token.test.ts`: `/auth/verify-carrier` may set the session.
- `tests/browser/verify-carrier.spec.ts` (mock mode, API stubbed with `page.route`):
  - no token
  - success, with the right request body
  - a backend error shown

## Backend asks

None.
