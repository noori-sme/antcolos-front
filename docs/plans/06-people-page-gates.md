# 06 — People page gates match the backend (F0.5)

```
Status:   implemented and reviewed (product owner: "continue … with your default recommendation")
Branch:   claude/magical-mccarthy-pgmh3z
Track:    Feature (permission catalog + nav change), approved under the standing default
Backend:  ../antcolos/src/modules/identity/controllers/organization-people.controller.ts
          (`@RequireAction('membership', 'list_drivers' | 'list_dispatchers' | 'list_admins')`),
          ../antcolos/docs/architecture/permission-matrix.md (ADMIN: all three; DISPATCHER: list_drivers)
Milestone: F0.5 in ../antcolos/docs/product/milestones.md
Updated:  2026-11-06
```

## Problem

Drivers gated on `drivers:view` (no backend key maps to it), so a carrier admin was refused in
http mode. Dispatchers and Admins gated on `members:view` (`membership.list`), which is not what
those endpoints check. Plan 03 tried aliasing `membership.list_drivers` → `drivers:view` and
reverted it: it widened the permission pickers.

## Changes

- Three catalog keys in the "members" group, one per list: `members:list_drivers`,
  `members:list_dispatchers`, `members:list_admins` (`types/permission.ts`, `catalog.ts`).
- `BACKEND_ALIASES`: `membership.list_drivers` / `_dispatchers` / `_admins` → those keys. No
  other backend key normalizes onto them, so nothing else becomes held or grantable.
- Nav (and so the route manifest): Drivers, Dispatchers and Admins require their list key.
  Detail pages inherit by prefix.
- Mock seed: the Dispatcher template and the Dispatcher invite preset get `members:list_drivers`
  (the backend default). Owner holds every key already. Every other template loses the people
  pages, as on the backend: Contracts (had `members:view`) loses Dispatchers/Admins; Safety,
  Compliance, Risk, Maintenance, Fuel and Contracts (had `drivers:view`) lose Drivers. Mock demos
  of the people pages need an Owner (there is no Admin template).
- Home "Drivers to check" panel: still shown on `drivers:view`, but links to Drivers only for
  callers with `members:list_drivers`.

## Not changed

- `drivers:view` still gates the mock driver records (home panel, tracking). Those are the
  in-memory driver domain, not the membership lists.
- The fleet assignee picker still asks for each list and shows a per-list notice on refusal
  (plan 02, decision F); it could now hide families the caller lacks. Left for a picker change.
- Unchanged on purpose: `/settings/users` and the dispatch workspace "People" row stay on
  `members:view` (the roster, `membership.list`). The new keys have no prerequisites, as on the
  backend. The carrier-employee and dispatch-org invite presets and seeded mock invitations keep
  `drivers:view` without a list key.
- Known gap: record chips that link to `/people/drivers/<id>` (MT Loop truck dispatch, insurance
  claim profile) are ungated; a viewer without the list key lands on the refusal screen.

## Verification

- `src/lib/permissions/permissions.test.ts`: alias mapping, no cross-implication, page gates,
  Dispatcher template, refused paths (Dispatcher on Dispatchers/Admins; `members:view` /
  `drivers:view` alone), catalog membership for the Owner.
- Live: `tests/browser/people.live.spec.ts` drivers case un-fixme'd; all 12 live specs pass
  (people, auth, fleet).
- vitest and node suites green, build ok, lint 41 / 84 (unchanged).

## Review (frontend-reviewer, 2026-11-06)

- No blocking findings; no picker widening (no other backend key normalizes onto the new keys).
- Should-fix, fixed: Dispatcher invite preset; Home panel dead link; refused-path tests.
- Recorded: ungated record chips (Known gap); template effects listed under Changes.

## Backend asks

None.
