# 01 — Access: invitations and roles through the service layer

```
Status:   in-progress (approved 2026-11-02: full-stack session; acceptance screen stays as drift)
Phase:    3 — done (hooks + screens); next: 4 browser spec
Branch:   claude/clever-franklin-kgcmdd
Requirements: none yet (refactor of existing screens; behavior unchanged)
Backend contract: ../antcolos/docs/requirements/invitations-api-contract.md (added on antcolos branch claude/clever-franklin-kgcmdd)
                  ../antcolos/docs/requirements/permissions-api-contract.md §1–2 (roles, catalog: exists)
Updated:  2026-11-02
```

## Summary
The access screens (invitations, invitation requests, roles, the invite flow and the
permission picker) call `apiClient` directly with hand-written response shapes. This plan
moves them behind an `orgInvitations` and an `orgRoles` service with mapped types,
mapper tests and `orgKey` hooks, like fleet trucks in PR #4. What the user sees does not change.
Everything here already talks to the real API, so there is no mock-to-http switch.

## Endpoint status
| Endpoint | In contract | On staging | Adapter |
| --- | --- | --- | --- |
| `GET /organizations/invitations` | **no** (draft below) | yes | planned http |
| `POST /organizations/invitations` | partly (permissions §4) | yes | planned http |
| `POST /organizations/invitations/:id/resend` | **no** | yes | planned http |
| `POST /organizations/invitations/:id/revoke` | **no** | yes | planned http |
| `GET /organizations/invitation-requests` | **no** | yes | planned http |
| `POST /organizations/invitation-requests/:id/approve` | partly (permissions §4) | yes | planned http |
| `POST /organizations/invitation-requests/:id/reject` | **no** | yes | planned http |
| `GET/POST /invitations/accept/:token`, `POST /invitations/reject/:token` | **no** | yes | open point 1 |
| `GET /organizations/roles` (+ POST, PATCH, DELETE) | yes (permissions §2) | yes | planned http |
| `GET /permissions/catalog` | yes (permissions §1) | yes | planned http |

## Files
| File | New/changed | Why |
| --- | --- | --- |
| `src/types/org-access.ts` | new | `OrgInvitation`, `OrgInvitationStatus`, `OrgRole`, `PermissionCatalog` |
| `src/lib/api/contracts/org-access.ts` | new | `OrgInvitationsService`, `OrgRolesService` |
| `src/lib/api/http/org-access.ts` (+ `.test.ts`) | new | mappers + calls; fixtures from the contract examples |
| `src/lib/api/index.ts`, `http/index.ts`, `contracts/index.ts` | changed | register both (http-only, like trucks) |
| `src/features/access/hooks.ts` | new | `accessKeys` under `orgKey`, queries + mutations |
| `invitations-screen.tsx`, `invitation-requests.tsx`, `roles-screen.tsx`, `invite-flow.tsx` (roles + create), `api-permission-picker.tsx` | changed | read through hooks; no visual change |

## Phases
### Phase 1 — types, contract, adapters ✅
- [x] Mapper tests first, from the contract's example JSON (full object, nullable fields, unknown status)
- [x] `OrgInvitationsService`: list, create, resend, revoke, listRequests, approveRequest, rejectRequest
- [x] `OrgRolesService`: list, create, update, remove, catalog
- [x] `Paginated<T>` moved to `src/types/common.ts`; DTO helpers shared in `src/lib/api/http/dto.ts`
### Phase 2 — hooks and query keys ✅
- [x] `accessKeys` under `orgKey`; mutations invalidate `[org, "access", "invitations"]` / `"roles"`
- [x] Fixes the existing gap: role create/update/delete never invalidated the roles query the invite flow reads
### Phase 3 — screens ✅
- [x] Replace inline `apiClient` + local DTO interfaces; keep output identical
- [x] `invitation-requests`, `invitations-screen`, `roles-screen`, `invite-flow` (roles + invite), `api-permission-picker`
- Left on `apiClient`: `acceptance-screen` (decided drift) and the invite flow's people roster (people domain)
### Phase 4 — browser spec
- [ ] Invitation list → revoke/resend; roles list → create/delete (the browser rule requires one for invitation changes)
### Phase 5 — docs
- [ ] `docs/architecture/ARCHITECTURE.md` §6: remove these screens from the drift list

## Invariant checklist
- [ ] No `apiClient`/`fetch` outside `src/lib/api/http/**` and `src/lib/session/**` (for these screens)
- [ ] Every query key starts with `orgKey(org)`. Mutations invalidate the narrowest prefix
- [ ] Gates use permission keys, never roles
- [ ] Types follow the contract. DTO → canonical mapping in the adapter, with tests
- [ ] Four states for every data view. Tokens only
- [ ] Tests at the right tier. No new lint errors or failing tests vs baseline

## Backend asks
1. **Add `docs/requirements/invitations-api-contract.md`.** No contract covers the invitation
   lifecycle (list, resend, revoke, requests, public preview/accept/reject). A draft written
   from the current controller, DTOs and service (`invitation.controller.ts`,
   `dto/invitation.dto.ts`, `services/invitation.service.ts`) is in the appendix: it documents
   existing behavior only. Please review it and commit it in `noori-sme/antcolos`.
2. **`GET /organizations/roles` needs `role.manage`** (`organization-role.controller.ts`), but
   `permissions-api-contract.md` §2 doesn't say so. The invite flow lists roles for anyone who
   can invite, so a member holding only `invitation.request_member` gets a 403 there. Either
   document it and expose a read-only role list for inviters, or relax the guard to `role.read`.
3. **Accept returns no session token.** `POST /invitations/accept/:token` returns
   `{ invitation, user, membership }`. The acceptance screen looks for an `accessToken` and
   falls back to an existing cookie, so an invitee who wasn't signed in must sign in afterwards.
   Confirm that's intended (then the contract says so), or return a session.

## Findings while integrating
- **Approval requests never showed Approve / Reject.** `invitation-requests.tsx` and the
  requests badge in `invitations-screen.tsx` treat a request as pending only when `status`
  is `"PENDING"`, but requests come back as `PENDING_ADMIN_APPROVAL` (contract §5). Fixed in
  phase 3 by comparing the mapped `awaiting_approval`.
- **Resend was offered on expired invitations**, which the backend refuses (409, contract §3).
  Now shown for pending invitations only.
- **The invitations list shows the first page only** (20 newest; the screen filters and counts
  client-side). Unchanged here; paging it is a follow-up.
- **"Copy link" after sending an invite uses the invitation id as the link token**
  (`invite-flow.tsx`): the API never returns the token (contract §Invitation), so that link
  cannot work. Not changed here (a UX decision); flagged to the user.

## Risks / open points
1. **Decided: leave `acceptance-screen.tsx` on `apiClient` as known drift.** **Public token routes and the `ctx` rule.** The data-layer rule says every service method
   takes `ctx` first, with profile reads as the only exception, and "don't add another". The
   preview/accept/reject routes are public and have no organization, and an invitee who isn't
   signed in may have no `ctx`. Options: (a) a second documented exception for the
   invitation-link methods, (b) leave `acceptance-screen.tsx` on `apiClient` and list it as
   known drift. Needs a decision before that screen moves.
2. `roles-screen.tsx` mixes the real roles API with mock `services.access` (archive,
   duplicate of archived roles, apply). Only the real calls move; the mock parts stay as they are.
3. The people lists the invite flow reads (`/organizations/drivers|dispatchers|admins`) belong
   to the people domain and stay out of this plan.

---

## Appendix — draft `invitations-api-contract.md` (backend ask 1)

### Invitations API contract

Frontend contract for organization invitations: invite or request a member, list, resend, revoke, approve or reject member requests, and the invitee's public preview / accept / reject by token.

**Documents the implemented API** (controllers `src/modules/identity/controllers/invitation.controller.ts`, DTOs `src/modules/identity/dto/invitation.dto.ts`, service `src/modules/identity/services/invitation.service.ts`). Nothing here is new behavior. Permission rules for create and approve are also in [`permissions-api-contract.md`](permissions-api-contract.md) §4 and [`permissions.md`](permissions.md); this document does not change them.

Send `Authorization: Bearer <token>` on tenant routes. Tenant routes require `x-organization-id` (or JWT `organizationId`) matching a membership for the caller. Dates are ISO-8601. Nest `POST` handlers return **201**. Paginated lists use `{ "data": [...], "meta": { "page", "pageSize", "totalItems", "totalPages" } }` with default `page=1`, `pageSize=20` (max 100), newest first (`createdAt desc`).

Do **not** send `organizationId` in any body. None of these routes takes an `Idempotency-Key`.

---

#### Flow

| Method | Path | Auth | Purpose |
| ------ | ---- | ---- | ------- |
| `GET` | `/api/v1/organizations/invitations` | tenant JWT + `invitation.list` | List this org's invitations |
| `POST` | `/api/v1/organizations/invitations` | tenant JWT + `invitation.invite_member` **or** `invitation.request_member` | Invite (sends now) or request (awaits approval) |
| `POST` | `/api/v1/organizations/invitations/:id/resend` | tenant JWT + `invitation.invite_member` | Email a fresh link, extend expiry |
| `POST` | `/api/v1/organizations/invitations/:id/revoke` | tenant JWT + `invitation.revoke` | Cancel a pending invitation |
| `GET` | `/api/v1/organizations/invitation-requests` | tenant JWT + `invitation.list` | List member requests awaiting approval |
| `POST` | `/api/v1/organizations/invitation-requests/:id/approve` | tenant JWT + `invitation.approve_request` | Approve, optionally change role / permissions, and send |
| `POST` | `/api/v1/organizations/invitation-requests/:id/reject` | tenant JWT + `invitation.reject_request` | Decline without sending |
| `GET` | `/api/v1/invitations/accept/:token` | **public**, token throttle | Preview for the invitee |
| `POST` | `/api/v1/invitations/accept/:token` | **public**, token throttle | Accept (joins; creates the account if needed) |
| `POST` | `/api/v1/invitations/reject/:token` | **public**, token throttle | Decline |

`POST /organizations/invitations` has no `@RequireAction`: the service decides from the caller's effective permissions whether it is a direct invite (`invitation.invite_member`) or a request (`invitation.request_member`). Neither → **403** `Insufficient permission to invite or request members`.

---

#### Enums

```text
InvitationStatus: PENDING | ACCEPTED | EXPIRED | REVOKED | DECLINED | PENDING_ADMIN_APPROVAL | REJECTED_BY_ADMIN
```

- `PENDING`: sent, can be accepted, resent, or revoked.
- `PENDING_ADMIN_APPROVAL`: a member request; appears in `/invitation-requests`; no email sent yet.
- `REJECTED_BY_ADMIN`: request declined by an approver. `DECLINED`: declined by the invitee.

`roleId` everywhere is a system role slug (`ADMIN`, `DISPATCHER`, `DRIVER`, …) or a custom role UUID from `GET /organizations/roles`.

---

#### Shared response shapes

##### Invitation

Returned by create, resend, revoke, approve, reject (both kinds), and inside accept.

```json
{
  "id": "3f2a1c4e-7b8d-4a21-9c0e-1f2a3b4c5d6e",
  "email": "driver@example.com",
  "firstName": "Jordan",
  "lastName": "Lee",
  "roleId": "DRIVER",
  "status": "PENDING",
  "organizationId": "7a1b2c3d-4e5f-6789-a0b1-c2d3e4f56789",
  "invitedByUserId": "9f8e7d6c-5b4a-3210-fedc-ba9876543210",
  "invitedUserId": null,
  "expiresAt": "2026-09-03T12:00:00.000Z",
  "createdAt": "2026-08-27T12:00:00.000Z",
  "updatedAt": "2026-08-27T12:00:00.000Z",
  "acceptedAt": null,
  "acceptedUserId": null
}
```

The invitation **token is never returned**. It exists only in the emailed link.

##### Invitation list item

The invitation object plus:

```json
{ "permissions": ["load.read", "load.update"] }
```

`permissions` is the effective set the invitee receives on accept: role template plus stored grants, minus revokes, wildcards expanded.

---

#### 1. List invitations

`GET /api/v1/organizations/invitations`

| Param | Type | Default | Notes |
| ----- | ---- | ------- | ----- |
| `page` | int ≥ 1 | 1 | |
| `pageSize` | int 1–100 | 20 | |
| `status` | `InvitationStatus` | unset | Omit for all |
| `roleId` | string | unset | Slug or custom role UUID |

Response: paginated list of **Invitation list item**.

#### 2. Invite or request a member

`POST /api/v1/organizations/invitations`

By email:

```json
{
  "email": "driver@example.com",
  "firstName": "Jordan",
  "lastName": "Lee",
  "roleId": "DRIVER",
  "permissions": ["load.read", "load.create"]
}
```

By existing user: `{ "userId": "<uuid>", "roleId": "DRIVER" }`. `userId` together with `email`, `firstName` or `lastName` → **400**.

- `permissions` is the full desired set. Omit it to apply the role template only.
- Direct invite: status `PENDING`, email sent after commit. The inviter must hold every permission the invitee will receive → otherwise **403**.
- Request (`invitation.request_member` only): status `PENDING_ADMIN_APPROVAL`, no email, DISPATCHER or DRIVER role only.
- Response: **Invitation**.

Errors: **409** `A pending invitation already exists for this email`; **409** `User is already a member of this organization`; **404** `User not found or cannot be invited` (by `userId`); **403** as above.

#### 3. Resend

`POST /api/v1/organizations/invitations/:id/resend` (no body)

Emails a fresh link for a `PENDING` invitation and extends `expiresAt`. The new token is stored only after the email is sent, so a failed send leaves the previous link valid. Response: **Invitation**.

Errors: **404** `Invitation not found`; **409** `Only pending invitations can be resent`.

#### 4. Revoke

`POST /api/v1/organizations/invitations/:id/revoke` (no body)

`PENDING` → `REVOKED`. Response: **Invitation**. Errors: **404** `Invitation not found`; **409** `Only pending invitations can be revoked`.

#### 5. List requests

`GET /api/v1/organizations/invitation-requests?page=&pageSize=`

Paginated **Invitation list item** rows with status `PENDING_ADMIN_APPROVAL`.

#### 6. Approve request

`POST /api/v1/organizations/invitation-requests/:id/approve`

Optional body `{ "roleId": "DISPATCHER", "permissions": ["load.read"] }`. See [`permissions-api-contract.md`](permissions-api-contract.md) §4 for the override rules. The approver must hold every permission of the resulting set. Status becomes `PENDING` and the email is sent after commit. Response: **Invitation**.

Errors: **404** `Invitation not found`; **409** `Only invitations awaiting admin approval can be approved`; **403** missing permissions.

#### 7. Reject request

`POST /api/v1/organizations/invitation-requests/:id/reject` (no body)

`PENDING_ADMIN_APPROVAL` → `REJECTED_BY_ADMIN`. No email. Response: **Invitation**. Errors: **404**; **409** `Only invitations awaiting admin approval can be rejected`.

---

#### 8. Preview (public)

`GET /api/v1/invitations/accept/:token`

```json
{
  "organizationName": "Acme Haulage",
  "email": "driver@example.com",
  "firstName": "Jordan",
  "lastName": "Lee",
  "roleId": "DRIVER",
  "expiresAt": "2026-09-03T12:00:00.000Z",
  "existingUser": false
}
```

`existingUser` decides the accept form: `true` → no username or password; `false` → username and password required.

Errors: **400** `Invitation is invalid, expired, revoked, or already accepted` (also for an unknown token).

#### 9. Accept (public)

`POST /api/v1/invitations/accept/:token`

New account:

```json
{
  "username": "jordan.lee",
  "password": "Welcome@123",
  "confirmPassword": "Welcome@123",
  "phone": "4155552671"
}
```

Existing account: `{}` (their profile, phone included, is not changed). `phone` is a US number and optional.

```json
{
  "invitation": { "...": "Invitation, status ACCEPTED" },
  "user": {
    "id": "9f8e7d6c-5b4a-3210-fedc-ba9876543210",
    "email": "driver@example.com",
    "emailVerified": true,
    "phone": null
  },
  "membership": {
    "id": "5c4b3a29-1807-4f6e-9d5c-4b3a29180716",
    "organizationId": "7a1b2c3d-4e5f-6789-a0b1-c2d3e4f56789",
    "roleId": "DRIVER",
    "status": "ACTIVE",
    "joinedAt": "2026-08-27T12:00:00.000Z"
  }
}
```

**No access token is returned.** A caller who was not already signed in must sign in afterwards.

Errors: **400** `Invitation is invalid, expired, revoked, or already accepted`; **400** `Username is required when creating a new account`; **400** `Password and matching confirmation are required`; **409** `Username is already taken`; **409** `Already a member of this organization`; **409** `Platform users cannot join an organization`.

#### 10. Reject (public)

`POST /api/v1/invitations/reject/:token` (no body)

`PENDING` → `DECLINED`. No account is created. The invitation cannot be accepted afterwards. Response: **Invitation**. Errors: **400** `Invitation is invalid, expired, revoked, or already accepted`.
