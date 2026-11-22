# 25 — Carrier authority, hand-off to another carrier, leave an organization

```
Status:   implemented (2026-11-22); (owner, 2026-11-21: "plan all of them one by one, verify the plan and go ahead")
Phase:    5 — done (plan reviewed by frontend-reviewer 2026-11-22; findings below applied)
Branch:   feat/identity-carrier-authority-ui
Backend:  ../antcolos plans 41 (#78) and 42 (#79), both merged to main
Contracts: ../antcolos/docs/requirements/carrier-authority-api-contract.md;
           membership-api-contract.md §2 "leave" and §6 "Carrier directory search"
Track:    Feature (new permission keys, new live route)
Updated:  2026-11-22
```

## Summary

Three small slices on backend routes that are merged but have no UI:

1. **FMCSA authority on Home.** A carrier's admins and dispatchers see their stored authority:
   status, MC/DOT, authority age, last checked, and the history of checks. Admins can
   re-check FMCSA now.
2. **Hand off a truck to another carrier.** The ownership hand-off dialog offers "A member" (today)
   or "Another carrier", found by name, MC or DOT through the carrier directory search.
3. **My organizations.** The account page lists every organization the person belongs to, with
   **Leave**. Leaving the organization you are working in signs you out of it.

## Endpoint status

| Endpoint | Contract | Backend main | Adapter |
| --- | --- | --- | --- |
| `GET /carrier-authority` (`carrier_authority.read`) | yes | #78 | http (new) |
| `GET /carrier-authority/history` (`carrier_authority.read`) | yes | #78 | http (new) |
| `POST /carrier-authority/refresh` (`carrier_authority.refresh`) | yes | #78 | http (new) |
| `GET /organizations/carriers/search?q=` (`truck.update`, ≥ 2 chars) | yes | #79 | http (new) |
| `POST /trucks/:id/ownership/:ownershipId/replace` with `ownerType: ORGANIZATION` | yes | yes | existing `trucks.replaceOwnership` |
| `GET /users/me/memberships` | yes | yes | existing `authApi.myMemberships` → new service method |
| `POST /users/me/memberships/:organizationId/leave` | yes | #79 | http (new) |

## Permission keys

| Backend | UI key | New? |
| --- | --- | --- |
| `carrier_authority.read` | `carrier:authority:view` | new (CARRIER orgs) |
| `carrier_authority.refresh` | `carrier:authority:refresh` | new, prerequisite view |

Templates (mock mode) mirror the backend: Admin both; Dispatcher view. Search needs `trucks:edit`
(the dialog already requires it). Leave needs no key (it is your own membership).

## Files

| File | New/changed | Why |
| --- | --- | --- |
| `src/types/carrier-authority.ts` | new | record, status, authorities |
| `src/lib/api/contracts/carrier-authority.ts` + `http/carrier-authority.ts` (+ test) | new | current, history, refresh |
| `src/lib/api/contracts/org-directory.ts` + `http/org-directory.ts` (+ test) | new | `searchCarriers(q, page)` |
| `src/lib/api/contracts/self-memberships.ts` + `http/self-memberships.ts` (+ test) | new | `list()`, `leave(organizationId)` |
| `src/lib/api/index.ts`, `http/index.ts`, `contracts/index.ts` | changed | register the three (http-only, like trucks) |
| `src/lib/carrier-authority/format.ts` (+ test) | new | status labels, age text ("6 years 7 months"), authority list text |
| `src/config/statuses.ts`, `components/common/status-badge.tsx` | changed | `CarrierAuthorityBadge` |
| `src/lib/query/keys.ts` | changed | `carrierAuthorityKeys`, `orgDirectoryKeys`, `selfMembershipKeys` under `orgKey` |
| `src/features/home/carrier-authority-card.tsx` + `hooks.ts` | new / changed | card on the live Home, history dialog, refresh |
| `src/features/fleet/truck-ownership-dialog.tsx` + `carrier-picker.tsx` + `hooks.ts` | changed / new / changed | "A member" / "Another carrier"; debounced search (300 ms, ≥ 2 chars) |
| `src/features/account/my-organizations-screen.tsx` + `hooks.ts` | new | list + Leave (`ConfirmDialog`) |
| `src/app/(app)/account/organizations/page.tsx` | changed | render the screen in http mode, the placeholder in mock mode |
| `src/config/live-routes.ts` | changed | `/account/organizations` |
| `src/lib/permissions/catalog.ts`, `templates.ts`, `types/permission.ts` | changed | keys, mappings |
| `tests/browser/authority-directory-leave.live.spec.ts` | new | live spec |

## Phases

### Phase 1 — types, contracts, adapters, keys
- [ ] Three http-only services and mappers (fixtures from the contracts); the refresh errors
      (409 not a carrier / no DOT, 404/502/503 FMCSA) surface the API message.
- [ ] Catalog keys + mappings + templates; `permissions.test.ts` cases.
- → verify: `npx vitest run src/lib/api/http/{carrier-authority,org-directory,self-memberships}.test.ts src/lib/permissions`

### Phase 2 — authority card
- [ ] Card on the live Home, inside `<Can carrier:authority:view>`: status badge, MC / DOT,
      "Authority for 6 years 7 months" (or "age unknown"), "Checked Nov 16"; "Never checked" empty
      state with Check now (if refresh). "Check now" (`<Can carrier:authority:refresh>`) shows
      "Changed since the last check" or "No change". "History" opens a paginated dialog.
- [ ] Format helpers + tests.

### Phase 3 — hand-off to another carrier
- [ ] Segmented choice "A member" / "Another carrier". Carrier picker: input (≥ 2 chars,
      300 ms debounce), results list (name, MC, DOT) as radio options, empty and error states.
      Hand-off sends `{ ownerType: "ORGANIZATION", ownerOrganizationId, ownershipType }`.
      Idempotency key per `{ ownershipId, input }` (existing `useIdempotencyKey`).

### Phase 4 — my organizations
- [ ] List from `selfMemberships.list()`: name, type, role, joined; "Current" on the one the
      session is scoped to. Leave → `ConfirmDialog` ("You keep your Antcolos account."). 409 last
      admin → its message. Leaving the current organization: sign out of it (clear the session,
      go to `/sign-in` with a toast), because its token stops working on the next request.
- [ ] Mock mode keeps the placeholder (the fixtures have no leave).

### Phase 5 — route, live spec, docs
- [ ] `/account/organizations` live route; live spec: authority card + refresh error (the seed
      carrier has a test DOT, so FMCSA may refuse: assert the message is shown); carrier search
      finds a second seeded carrier and the hand-off succeeds; a seeded member leaves a second
      organization.
- [ ] ARCHITECTURE §5, roles-and-permissions, plan status.

## Invariant checklist
- [x] No `apiClient` outside `src/lib/api/http/**` (the memberships list moves into a service)
- [x] Keys under `orgKey`; leave invalidates the memberships list and the session roster
- [x] Gates on keys: `carrier:authority:*`, `trucks:edit`; none on leave (self)
- [x] Types follow the contracts; mappers tested
- [x] Idempotency: none of these routes is marked idempotent in the contracts (refresh and leave
      are safe to repeat: refresh appends a check, a repeated leave is a 404)
- [x] Four states per view; tokens only
- [x] New route in `HTTP_LIVE_ROUTES`; no new cookies
- [ ] 360 px (phase 5)

## Backend asks
- None.

## Risks
- FMCSA in local and staging runs may not answer for the seed DOT; the live spec asserts the
  error path when it does not.

## Review findings applied (frontend-reviewer, 2026-11-22)

- Leaving the **current** organization: no invalidation (the roster and permissions would refetch
  with a dead token and trigger the forced logout); sign out first through a shared
  `useSignOut()` extracted from `account-menu.tsx`. Leaving another organization invalidates only
  the memberships list (the session roster holds only the current org).
- `selfMemberships.list()` and the session's `authApi.myMemberships` stay separate paths over the
  same endpoint; the list key `[...orgKey(org), "account", "memberships"]` sits under `orgKey`
  because the cache is cleared on organization switch anyway.
- Role shown through the exported `ROLE_TITLES`, "Member" for a custom role id; never the raw id.
- Leave: a repeated 404 refetches quietly; 409 shows its message; no `unwrap` of the empty body.
- Hand-off: the selection is a discriminated value (member or carrier); the intent key covers
  `ownerOrganizationId`; `OWNER_ORGANIZATION_NOT_CARRIER` / `NOT_FOUND` and 403 `NOT_LEGAL_OWNER`
  come through as the API's message; search `pageSize` 20, `type` mapped explicitly; stale
  docstring updated.
- Catalog aliases next to the others; `orgTypes: ["CARRIER"]`; refused-path test for refresh on
  the Dispatcher template; `/account/organizations` page branches on `API_MODE`.

## Verification (2026-11-22)

- vitest: mappers 4, format 3, permission mapping + refused refresh on Dispatcher; all green.
- Live spec `authority-directory-leave.live.spec.ts` with `NEXT_PUBLIC_DEMO_AREAS=off` (the live
  Home only renders then, like the F1.6 owner dashboard): desktop 4 passed; mobile 1 passed
  (leave), 3 desktop-only skipped. Dev-only data, idempotent:
  - `Bluefin Freight` (CARRIER, MC778899) for the carrier search;
  - the seeded dispatcher as a DISPATCHER of `Pacific Dispatch LLC`, to leave.
- Screens checked: authority card empty ("Never checked") and populated (Authorized, 7 years 7
  months, MC/DOT, authorities); re-check on the seed carrier shows the API's 400 reason.

