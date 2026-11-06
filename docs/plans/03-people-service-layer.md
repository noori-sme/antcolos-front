# 03 — People screens through the service layer (F0.2)

```
Status:   implemented (product owner: "keep going with F0.2")
Branch:   claude/magical-mccarthy-pgmh3z
Track:    Integrate (read-only endpoints that already exist)
Backend contract: ../antcolos/docs/requirements/users-api-contract.md §1–§4
Milestone: F0.2 in ../antcolos/docs/product/milestones.md
Updated:  2026-11-06
```

## Summary

The Drivers, Dispatchers and Admins screens (list and detail) and the invite flow's
existing-member roster called `apiClient` directly with locally declared DTOs. They now read
through `OrgPeopleService` (`list`, `get`), canonical `OrgPerson` / `OrgPersonDetail` types,
shared `queryKeys.people*`, and per-feature hooks (`useDrivers`, `useAdmin`, …). Rendering is
unchanged; only the data path moved. Edit and remove are not used by these screens today and
were not added.

## Endpoint → method → hook

| Endpoint | Method | Hook |
| --- | --- | --- |
| `GET /organizations/{drivers,dispatchers,admins}` | `orgPeople.list` | `useDrivers` / `useDispatchers` / `useAdmins`; `useTeamRoster` (invite flow); `useAssignablePeople` (fleet) |
| `GET /organizations/{family}/:userId` | `orgPeople.get` | `useDriver` / `useDispatcher` / `useAdmin` |

## Changes beyond the data path

- Loading reads `isPending`, so a query waiting for the organization shows the skeleton instead
  of an empty list.
- The roster merge (order, dedupe by email, failed list contributes nobody) is a pure, tested
  function in `lib/people/team-roster.ts`.
- `useOrgKeyPrefix`, used only by the replaced inline queries, is removed.

## Findings (not fixed here)

- **The Drivers page refuses a carrier admin in http mode (pre-existing).** `/people/drivers`
  and its nav item gate on `drivers:view`, and no backend permission maps to it (the backend
  grants `membership.list_drivers`). Found in the live run. A global alias
  (`membership.list_drivers` → `drivers:view`) was tried and reverted after review: the
  permission pickers treat keys that normalize alike as the same, so it would mark other
  `drivers:view` keys as held or grantable. The right fix is a permission-catalog / nav change
  (Feature track): gate Drivers, Dispatchers and Admins on keys that match what the backend
  enforces (`membership.list_drivers`, `…_dispatchers`, `…_admins`). Today Dispatchers and Admins
  gate on `members:view` (`membership.list`), which does not match either.

## Verification

Typecheck clean; vitest 2158/2158; node 805/805; build passes; lint 48 errors / 86 warnings
(baseline 51 / 86 before this change). Live browser spec `tests/browser/people.live.spec.ts`
against a local backend: dispatchers and admins list + detail, and the invite roster, pass; the
drivers case is `fixme` for the gate finding above (its list and detail reads were confirmed
while the alias was in place).

## Review (frontend-reviewer, 2026-11-06)

No blocking findings. Applied: the permission alias reverted (Findings); a driver detail with no id
shows not-found instead of an endless skeleton; the invite roster does not retry a forbidden list;
the no-context fallback keys sit under `orgKey("none")`. Accepted as is: shared people hooks live in
`lib/api/use-org-people.ts` (beside `useServiceContext`), wrapped by each feature's `hooks.ts`.
