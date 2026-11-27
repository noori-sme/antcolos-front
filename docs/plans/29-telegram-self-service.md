# 29 — Telegram self-service and member role change

```
Status:   approved (owner, 2026-11-27: "plan and implement … continue with your recommendation");
          revised after frontend-reviewer (3 blocking, should-fix and nits answered below)
Phase:    1 — not started
Branch:   feat/telegram-self-service (same name as the backend, plan 52)
Backend contract: ../antcolos/docs/requirements/telegram-api-contract.md §1, §5–§6;
                  ../antcolos/docs/requirements/membership-api-contract.md §2 (membershipId)
Track:    Feature (three routes go live, a new permission key, a members action)
Updated:  2026-11-27
```

## Summary

The M1 Telegram check on staging needed someone calling the API for every link code, could not
undo a link, and could not fix a member invited with a custom role. This plan adds the screens.

## Screens

All Telegram code lives in `src/features/telegram/` (hooks, card, link-code panel, integrations
screen); pages under `src/app` stay thin and render one screen each.

1. **Telegram screen** (`TelegramAccountScreen`): the person's own link.
   - Status and **Disconnect** are always shown: `GET/DELETE /telegram/account` need no
     permission. Disconnect is a ConfirmDialog that says it "disconnects Telegram for all your
     companies" (backend plan 52: the link is per person).
   - **Connect** needs `loads:respond` (the code endpoint needs `load.respond`). Without it the
     button is shown disabled with the reason: "Needs the 'Answer an assigned load' permission".
   - Connect shows the deep link (opens the bot), the `/start <code>` fallback and a countdown
     from the server's `expiresAt`; after expiry, "Get a new code". While a code is shown, the
     account status refetches every 5 s and on window focus, so the card turns to "Connected"
     without a reload once the person taps Start.
   - Routes:
     - **Account → Notifications** (`/account/notifications`, placeholder today) for office users;
     - **Driver → Notifications** (`/driver/notifications`, placeholder today, already in the
       driver nav) for drivers. It joins `DRIVER_OPEN_ROUTES`, so the driver lock leaves it open.
2. **Settings → Integrations → Telegram** (`/settings/integrations`, placeholder today; nav gate
   `integrations:view` kept). A list of this organization's trucks with their group status
   (title, linked when and by whom; "Removed user" when `linkedBy` is null). Cards, not a table,
   so it fits 360 px.
   - Needs `trucks:view`; without it, an `EmptyState` says truck groups need the "View trucks"
     permission (no request is made, so no 403 screen).
   - **Link group** and **Unlink** need `trucks:edit`, which only carriers have. A dispatch agency
     sees the list read-only (usually empty): truck groups are linked by the carrier that
     operates the truck. Link shows the `TRUCK_CHAT` code and the instruction with the same
     countdown; Unlink is a ConfirmDialog naming the truck and the group title.
   - A group whose truck the organization no longer operates shows "Truck no longer operated"
     (`unitNumber: null`) and can still be unlinked.
3. **Members → Change role** (`/settings/users`): a dialog listing the organization's roles
   (built-in and custom), only those the caller can grant in full (`ungrantablePermissions`
   empty, as the invite flow does); Owner is never offered. Not offered on the caller's own row
   (matched by user id from the session, not by role name). Saves with
   `PUT /organizations/members/:membershipId/permissions { roleId }` (no `organizationId` in the
   body). Gated on a new UI key **`members:role:change`** ↔ backend
   `membership.manage_permissions`. Not `members:edit`: that is `membership.update` (edit member
   profile) on the backend, a different key, and reusing it would show the button to people the
   API refuses.

States per surface: `LoadingSkeleton` while loading; `ErrorState` with `refetch`; `EmptyState`
for no trucks; buttons disabled while their mutation is pending; server errors shown near the
action.

## Data

- `src/lib/api/contracts/telegram.ts` + `http/telegram.ts`: `account`, `unlinkAccount`,
  `createLinkCode(purpose, truckId?)` (no Idempotency-Key: the contract does not mark it
  idempotent; each press gets a new code), `truckChats(page)` (paginated `{ data, meta }`
  through `toPage`), `unlinkTruckChat(truckId)`. http-only, registered in both registries like
  `usage`; mock mode has no Telegram (mock mode cannot reach these screens' API anyway).
- `orgMembers.changeRole(ctx, membershipId, roleId)` and `OrgMember.membershipId` in the http
  mapper, the mock adapter and the mock data.
- Keys under `orgKey`: `telegramKeys.account(org)` (per person on the backend, still org-keyed
  so a switch never shows a stale card), `telegramKeys.truckChats(org, page)`.
  - Disconnect and a successful link invalidate `telegramKeys.account`.
  - Unlink truck group invalidates `telegramKeys.truckChats` only.
  - Change role invalidates the members prefix and the people lists (drivers, dispatchers,
    admins), since a role change moves someone between them.
- Catalog: `members:role:change` in the `PermissionKey` union, `PERMISSION_CATALOG` (group
  members, sensitive, prerequisite `members:view`) and `BACKEND_ALIASES`
  (`"membership.manage_permissions": "members:role:change"`).

## Phases

```text
Phase 1 — telegram service + mapper tests fed with the contract's example responses;
          orgMembers.changeRole + membershipId (http + mock); catalog key + mapping test
          → verify: vitest, typecheck
Phase 2 — Telegram screen on /account/notifications and /driver/notifications; Integrations
          screen; HTTP_LIVE_ROUTES += both account/settings routes and /driver/notifications;
          DRIVER_OPEN_ROUTES += /driver/notifications
          → verify: route-manifest tests (gates: integrations:view, none for notifications);
            live spec against staging: connect shows a deep link and a countdown, disconnect,
            link-group code, unlink, all at desktop and 360 px
Phase 3 — Change role dialog on Members
          → verify: unit test of the grantable role filter; live spec: the dialog lists only
            grantable roles and excludes the caller; one real change on staging (the test
            driver: Driver → Driver), checked through GET /organizations/members
Phase 4 — docs (ARCHITECTURE §5 rows, roles-and-permissions: members:role:change, the
          HTTP_LIVE_ROUTES comments), verify full, frontend-reviewer
```

Mock-mode browser specs cannot cover these screens: they call http-only services, which sign the
mock session out (seen in #42). The gates are covered by route-manifest unit tests and the live
spec.

## Out of scope

Bot leaving a group on unlink; an admin unlinking someone else's personal Telegram; a mock
adapter for Telegram.
