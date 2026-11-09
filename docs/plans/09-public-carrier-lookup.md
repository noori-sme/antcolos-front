# 09 — Public carrier lookup page

Status:   implemented (product owner, 2026-11-08: "make the carrier lookup page public too")
Phase:    3 / 3
Updated:  2026-11-08
Track:    Feature (new public route)

## Summary

The FMCSA carrier lookup is only reachable inside onboarding's carrier step, which needs a
signed-up, mid-onboarding session. The backend route is already public:
`GET /api/v1/carriers/lookup` is `@Public()`, rate-limited to 20 requests per minute per IP
(`../antcolos/docs/requirements/carrier-lookup.md` §4, §8). This adds a public page anyone can
use without an account.

## Contract

`GET /api/v1/carriers/lookup?mc=` **or** `?dot=` (exactly one):
- `mc` is 1–8 digits with an optional `MC` prefix.
- `dot` is 1–8 digits.

A `200` returns:
- identity: `dotNumber`, `mcNumber`, `legalName`, `dbaName`, `phone`, `email`, `active`
- `address` (street, city, state, zip, country) and `mailingAddress`
- `sources`. `sources.census = "unavailable"` marks a partial profile, with no email or mailing
  address.

Errors:
- `400 invalid_identifier`
- `404 carrier_not_found`
- `429` rate limited
- `500 lookup_not_configured`
- `502 upstream_unavailable`

## Phases

### Phase 1: data
- `src/types/carrier-lookup.ts`: `CarrierLookupResult`, a fuller shape than onboarding's
  `CarrierProfile`, which is left untouched.
- `authApi.lookupCarrierPublic` (`lib/session/auth-api.ts`, pre-tenant like the existing lookup)
  with mapper `toCarrierLookupResult`, unit-tested from the contract's full and partial examples.
- `usePublicCarrierLookup` in `features/carrier-lookup/hooks.ts`. The key goes under
  `orgKey("public")`, like the onboarding lookup.
- Client-side validation mirrors §8.1, so the page never sends what the server refuses with a 400.

### Phase 2: screen and route
- `src/app/(public)/carriers/lookup/page.tsx` renders `features/carrier-lookup/carrier-lookup-screen.tsx`.
- `"/carriers/"` is added to `PUBLIC_PREFIXES`, so signed-in, mid-onboarding and signed-out
  visitors all reach it, with no redirect and no session load.
- **Form:** an MC/DOT toggle, one input and Search. The query sits in the URL (`?mc=`/`?dot=`), so
  results are shareable and Back works.
- **States:**
  - idle: a short explanation
  - loading
  - result card: name, DBA, active/inactive badge, DOT, MC, phone, email, physical and mailing
    address, and a note on the census data being about a day old
  - partial: a note that contact details are temporarily unavailable
  - 404 "No carrier found"
  - 400: the identifier format message
  - 429 "Too many lookups, wait a minute"
  - 5xx "FMCSA is unavailable right now"
- **Calls to action:** a signed-out visitor gets "Is this your company? Create an account". There's
  no claim flow here, because carrier onboarding owns verification.

### Phase 3: verify and ship
- A browser spec in mock mode with `/carriers/lookup` stubbed through `page.route`:
  - result, partial, 404 and 429
  - reachable signed out
  - URL-driven search
- `/verify`, then `frontend-reviewer`, then a PR to `staging` and on to `main`.

## Decisions (defaults, product owner may revise)

- **Path:** `/carriers/lookup`, mirroring the API.
- **Scope:** the lookup only. The richer `GET /carriers/profile` (insurance, authority history,
  inspections) is out of scope; it can be a follow-up.
- **Error handling:** the page shows FMCSA data as returned and invents nothing. Missing fields
  read "Not on file".
- **Rate limit:** no login wall. The backend's 20/min/IP limit is the guard, and the page shows a
  friendly 429.

## Backend asks

None. If `FMCSA_WEB_KEY` is missing on an environment, the page shows the 500 state; it is set
on Railway staging.

## Implementation notes

- **Typed errors.** `authApi.lookupCarrierPublic` reads the HTTP status itself (`validateStatus`),
  because the shared client interceptor turns errors into a message-only `Error`. It throws
  `CarrierLookupError(kind)`. Only `unavailable` (network or 502) is retried.
- **Rules.** Identifier rules, the mapper and the formatting live in `src/lib/carriers/lookup.ts`,
  with unit tests.
- **Checked live.** On 2026-11-08, staging `GET /carriers/lookup?dot=44110` returned 200 with
  live QCMobile and census data.
