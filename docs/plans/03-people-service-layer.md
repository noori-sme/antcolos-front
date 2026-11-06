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

- **Drivers page unreachable for a carrier admin (fixed).** The page and its nav item gate on
  `drivers:view`, and no backend key mapped to it: the backend grants `membership.list_drivers`.
  `BACKEND_ALIASES` now maps it (tested). Found in the live browser run.
- Loading reads `isPending`, so a query waiting for the organization shows the skeleton instead
  of an empty list.
- The roster merge (order, dedupe by email, failed list contributes nobody) is a pure, tested
  function in `lib/people/team-roster.ts`.
- `useOrgKeyPrefix`, used only by the replaced inline queries, is removed.

## Verification

Typecheck clean; vitest 2160/2160; node 805/805; build passes; lint 48 errors / 86 warnings
(baseline 51 / 86 before this change). Live browser spec `tests/browser/people.live.spec.ts`:
each family's list and detail, and the invite roster, against a local backend: 4/4.
