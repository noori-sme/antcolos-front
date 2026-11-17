# 20 — Driver credentials on the driver profile (F2.4)

```
Status:   implemented (2026-11-17; owner: "plan and implement each one of these modules")
Branch:   feat/identity-driver-credentials (same name as the backend branch)
Backend contract: ../antcolos/docs/requirements/driver-credentials-api-contract.md (backend plan 40, M2.7)
Track:    Feature (new permission keys, new section on the driver profile)
Numbering: 17–19 left free for the M1 work running in another session.
```

## Progress

```text
Phase 1 — done  types, contract, http adapter + mapper tests (3), query keys, permission keys
Phase 2 — done  lib/driver-credentials (labels, next statuses, expiry) + tests (5); hooks
Phase 3 — done  credentials panel on /people/drivers/[driverId]; add / edit / status / history
```

## Goal

On a driver's profile (`/people/drivers/[driverId]`) the carrier sees the driver's credentials
(CDL, TWIC, Hazmat, Medical Card, …) with status, expiry and history, and an admin records a new
one, edits its dates, and changes its status. A credential expiring within 30 days is flagged.

## Design

- **Service** `driverCredentials` (http-only, like `orgPeople`: the people screens always call the
  real API): `list`, `create`, `update`, `changeStatus`, `history`. Mappers in
  `lib/api/http/driver-credentials.ts`, fed with the contract's example in tests.
- **Permission keys** (catalog group `compliance`), mapped one-to-one:
  `credential.read` → `credentials:view`, `credential.read_own` → `credentials:view_own`,
  `credential.create` → `credentials:create`, `credential.update` → `credentials:edit`.
  Templates mirror the backend: Dispatcher `credentials:view`, Driver `credentials:view_own`.
- **Panel** `features/driver/driver-credentials-panel.tsx` (+ dialogs file), shown when
  `credentials:view`. "Add credential" behind `credentials:create`; edit and status change behind
  `credentials:edit`. The status menu offers only the transitions the backend state machine allows
  (`lib/driver-credentials/status.ts`); SUSPENDED and REVOKED ask for a reason.
- Idempotency keys on create and status change (`useIdempotencyKey`).

## Backend asks

None. The driver's own view (`GET /credentials/mine`) is wired in the service for the driver web
app; no screen uses it in this slice.

## Invariant checklist

- [x] Components never call the network: panel → `features/driver/hooks.ts` → `services.driverCredentials`.
- [x] Query keys org-namespaced (`queryKeys.credentials*`).
- [x] No role-name checks: `<Can>` on `credentials:*`.
- [x] Contract is the authority: fields and errors from the contract doc only.
- [x] Tokens only: status tones from existing `st-*` tokens.
- [x] No secrets in the client.

## Verification (2026-11-17)

- vitest: 140 files, 2356 tests pass; `npm run build` passes; new files lint clean (the 3 problems
  left in `carrier-driver-detail.tsx` were there before).
- Run together against the backend branch (seeded carrier admin, driver member): empty state →
  add Medical card expiring in 20 days (201, "Expires within 30 days" shown) → add CDL Class A
  (201) → same again (409, "This driver already has a credential of this type and label" shown in
  the dialog) → suspend CDL (button disabled until a reason is typed; 201) → history shows
  "Recorded" and "ACTIVE → SUSPENDED — <reason>". 360 px: no horizontal scroll, actions wrap.
