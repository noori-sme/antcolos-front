# 12 — Settings → People (organization members) on the real API

```
Status:   implemented (approved 2026-11-11; per-member permission overrides are a follow-up)
Phase:    4 / 4 — done
Branch:   feat/access-members-live (to create on approval)
Requirements: ../antcolos/docs/requirements/membership.md
Backend contract: ../antcolos/docs/requirements/membership-api-contract.md §2
Updated:  2026-11-11
Track:    Integrate, plus a screen refactor (the screen calls services from effects today)
```

## Summary

Signed in for real, **Settings → People** (`/settings/users`) lists the organization's real
members (every role, custom roles included), lets an admin remove one, and links to their
permissions. It's a demo area today (plan 10). The Drivers / Dispatchers / Admins pages already
use the family APIs; this is the mixed roster.

## Endpoint status (backend `main`, checked 2026-11-11)

| Endpoint | Permission | In code | Frontend method |
| --- | --- | --- | --- |
| `GET /organizations/members?page&pageSize` | `membership.list` | `organization-membership.controller.ts:43` | `access.roster` |
| `DELETE /organizations/members/:userId` | `membership.remove` | `:108` | `access.endSeat` |
| `GET /organizations/members/:membershipId/permissions` | `membership.manage_permissions` | `:61` | (new) member permissions |
| `PUT /organizations/members/:membershipId/permissions` | `membership.manage_permissions` | `:83` | (new) set overrides |
| leave an organization yourself | — | **none** | `access.leaveOrganization` |

## Mismatch with the frontend model

- `RosterEntry` carries a full `Membership` (applied templates, grants, revocations, scope) and the
  person's effective permissions. The backend row is `{ userId, name, email, roleId, roleName,
  hasPermissionOverrides, joinedAt }`. The http roster maps to a slimmer `MemberRow` type; the
  screen's template-diff and relationship columns stay mock-only.
- `endSeat(reason)`: the backend takes no reason. The reason field is dropped in http mode.
  Errors: 404 → "already removed"; 409 → "can't remove the last admin" (maps to `last_owner`).
- `leaveOrganization`: no backend endpoint. Hidden in http mode (backend ask).
- `access.templates` (permission templates): the backend's equivalent is roles (`orgRoles`, already
  live on `/settings/permissions`). The screen links there instead in http mode.
- `people-screen.tsx` calls `services.access.*` inside `useEffect` (rule 1 drift). Move to hooks
  in `features/access/hooks.ts` with `orgKey` keys as part of this change.

## Phases
1. `MemberRow` type, `orgMembers` contract (`list`, `remove`, `permissions`, `setPermissions`),
   http adapter + mapper tests from the contract example, mock adapter over the fixture roster.
2. Hooks: `useMembers(page)`, `useRemoveMember()` (invalidates the members prefix and the people
   family lists).
3. Screen: http mode uses the member list (paginated, four states, `<Can>` on
   `members:suspend`, which the backend's `membership.remove` now maps to in
   `catalog.ts` BACKEND_ALIASES; the mock People screen already gates removal on it);
   remove goes through `<ConfirmDialog>`. Your own row has no remove button (no leave
   endpoint). Mock mode keeps today's screen.
4. `/settings/users` → `HTTP_LIVE_ROUTES`; `members.live.spec.ts` against the seeded backend
   (list, remove a seeded member, last-admin refusal), desktop + 360 px; ARCHITECTURE.md §5.

## Decisions needed
1. Per-member permission overrides (`GET`/`PUT …/permissions`): in this plan, or a follow-up?
   Recommendation: follow-up (it needs the permission picker wired to the backend catalog).

## Backend asks
1. `POST /users/me/memberships/:organizationId/leave` (or similar): a member leaving an
   organization themselves.
2. Optional: a `reason` on `DELETE /organizations/members/:userId`, kept on the ended membership,
   if the product wants it (the mock asks for one today).

## Referrals (checked, not planned)
The backend has no referral endpoints or model (`grep -ri referral src` finds nothing). Account →
Referrals and Fleet & people → Referrals stay demo areas. Next step: `/requirements` for referrals,
then a backend Feature (model, invite-a-driver link, inbox, `referrals.review` permission).

## Verification (2026-11-11)
- vitest 2247/2247, node 805/805, typecheck clean. Lint: see the PR (baseline 59 errors).
- `npm run build` (http mode) passes.
- `members.live.spec.ts` 6/6 (desktop + mobile) against a local seeded backend run with
  `THROTTLE_ENABLED=false`: list, own row has no remove, remove a member, "already removed
  elsewhere" (404) shows the reason, no sideways scroll at 360 px.
- `frontend-reviewer`: fixed a failed remove leaving the confirm dialog open with the reason
  hidden behind it (the dialog now closes and the alert shows), and a list stranded past its last
  page after removing the only row on it. Relabelled `members:suspend` to "Remove members" in the
  catalog, since it now gates removal.

## Follow-ups
- Per-member permission overrides (`GET`/`PUT /organizations/members/:membershipId/permissions`).
- Backend asks above (leave an organization; optional removal reason).
