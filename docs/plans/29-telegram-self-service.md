# 29 — Telegram self-service and member role change

```
Status:   approved (owner, 2026-11-27: "plan and implement … continue with your recommendation")
Phase:    1 — not started
Branch:   feat/telegram-self-service (same name as the backend, plan 52)
Backend contract: ../antcolos/docs/requirements/telegram-api-contract.md §1, §5–§6;
                  ../antcolos/docs/requirements/membership-api-contract.md §2 (membershipId)
Track:    Feature (two placeholder routes go live, a new permission key, a members action)
Updated:  2026-11-27
```

## Summary

The M1 Telegram check on staging needed someone calling the API for every link code, could not
undo a link, and could not fix a member invited with a custom role. This plan adds the screens.

## Screens

1. **Telegram card** (shared component in `src/components/telegram/`):
   - not linked: "Connect Telegram" → asks the API for an `ACCOUNT` code and shows the deep link
     (opens the bot), the `/start <code>` fallback and when it expires;
   - linked: "Connected as @username since …" and "Disconnect" (ConfirmDialog);
   - gated on `loads:respond` (the code endpoint needs `load.respond`); without it the card says
     Telegram is for people who work loads.
   Used on:
   - **Account → Notifications** (`/account/notifications`, placeholder today) for office users;
   - **My loads** (`/driver/loads`) for drivers, who cannot reach the Account pages in http mode.
2. **Settings → Integrations → Telegram** (`/settings/integrations`, placeholder today): each
   truck this organization operates with its group status (title, linked when and by whom).
   "Link group" (`trucks:edit`) shows the `TRUCK_CHAT` code and the instruction; "Unlink"
   (`trucks:edit`, ConfirmDialog). The list needs `trucks:view`. The page keeps its nav gate
   (`integrations:view`).
3. **Members → Change role** (`/settings/users` members list): a dialog with the organization's
   roles (built-in and custom) that the caller can grant (`grantable.ts`), then
   `PUT /organizations/members/:membershipId/permissions { roleId }`. New UI key
   `members:role:change` ↔ backend `membership.manage_permissions`. Not offered on yourself.

## Data

- `src/lib/api/contracts/telegram.ts` + `http/telegram.ts` (mappers tested): `account`,
  `unlinkAccount`, `createLinkCode(purpose, truckId?)`, `truckChats`, `unlinkTruckChat`.
  http-only, registered in both registries like `usage`.
- `orgMembers.changeRole(ctx, membershipId, roleId)`; `OrgMember.membershipId` (mapper).
- Keys under `orgKey`: `telegramKeys.account`, `telegramKeys.truckChats`; mutations invalidate
  those and the members list.

## Phases

```text
Phase 1 — telegram service + mapper tests; orgMembers.changeRole + membershipId; catalog key
          → verify: vitest (mappers, catalog mapping), typecheck
Phase 2 — Telegram card on /account/notifications and /driver/loads; Integrations screen
          → verify: live spec against staging (connect shows a deep link; disconnect;
            link-group code; unlink), 360 px
Phase 3 — Change role dialog on Members
          → verify: live spec on a throwaway invite? No: read-only check that the dialog lists
            grantable roles; the change itself verified once on staging with the test driver
Phase 4 — docs (ARCHITECTURE §5 rows, roles-and-permissions), verify full, frontend-reviewer
```

## Out of scope

Bot leaving a group on unlink; an admin unlinking someone else's personal Telegram.
