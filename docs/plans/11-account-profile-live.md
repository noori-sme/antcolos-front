# 11 — Account → Profile on the real API

```
Status:   in-progress (approved 2026-11-11 with the recommendations: hide public-profile
          actions in http mode; real picture in the top bar)
Phase:    1 / 4 — done
Branch:   feat/profile-self-live (to create on approval)
Requirements: ../antcolos/docs/requirements/profile.md (self profile, shipped backend plan 12)
Backend contract: ../antcolos/docs/requirements/profile.md §4–5, users-api-contract.md §5
Updated:  2026-11-11
Track:    Feature (new http-mode screen for a route, `live-routes.ts` change)
```

## Summary

Signed in for real, **Account → Profile** shows and edits the person's own record from the
backend: name, phone, address, headline, about me and profile picture. Today the page is a
demo area (plan 10) because the frontend `ProfileService` models a much bigger *public profile*
(username page, visibility, sections, verifications, workplaces, achievements, share card) that
the backend doesn't have. This plan does **not** pretend it does: in http mode the page becomes a
smaller "self profile" screen backed by the real endpoints, and the public-profile features stay
on mock mode only.

## Endpoint status (backend `main`, checked 2026-11-11)

| Endpoint | In contract | In code | Use |
| --- | --- | --- | --- |
| `GET /users/me` | yes (profile.md FR-READ) | `user-membership.controller.ts:88` | read |
| `PATCH /users/me` | yes (FR-EDIT, users-api §5) | `:102` | name, phone, address, headline, about me |
| `PUT /users/me/avatar` (multipart `file`) | yes (FR-AV-01) | `:122` | set/replace picture |
| `GET /users/me/avatar` | yes (FR-AV-02) | `:148` | picture bytes (needs the bearer token, so fetched as a blob) |
| `DELETE /users/me/avatar` | yes (FR-AV-03) | `:167` | remove picture |

Works for individual and tenant tokens (`@AuthenticatedUserScoped()`), no organization permission.

## Mismatch with the frontend model

| Frontend `ProfileService` | Backend | Plan |
| --- | --- | --- |
| `getOwn`, `update` (fullName, headline, bio, avatarUrl) | `GET`/`PATCH /users/me` (firstName, lastName, headline, aboutMe, phone, address) | new `selfProfile` service, own types |
| `uploadAvatar`, `removeAvatar` | `PUT`/`DELETE /users/me/avatar` | in `selfProfile` |
| `setVisibility`, sections, verifications, links, location | none | mock mode only |
| `getByUsername` (public page `/u/<username>`), `shareCard`, `listWorkplaces`, achievements, `recordContribution`, `initialize` | none | mock mode only |

## Phases

### Phase 1 — `selfProfile` contract, http adapter, mapper tests
- `src/types/self-profile.ts`: `SelfProfile { userId, firstName, lastName, name, username?, email,
  phone?, address?, headline?, aboutMe?, avatar?: { mimeType, updatedAt } }`.
- `src/lib/api/contracts/self-profile.ts` (`get`, `update`, `uploadAvatar`, `removeAvatar`,
  `avatarBlob`). http adapter `src/lib/api/http/self-profile.ts`; a small mock adapter so mock mode
  and tests run.
- Tests: mapper fed with the contract examples (full, nulls), `update` sends only changed fields.

### Phase 2 — hooks
- `features/self-profile/hooks.ts`. Keys follow the rule: `[...orgKey(org), "self-profile"]`.
  The data isn't org-scoped, but switching organization clears the cache anyway, so one fetch
  per organization is the only cost. Methods take `ctx` like every other service.

### Phase 3 — screen
- `features/self-profile/self-profile-screen.tsx`: header with picture, name, headline; "About";
  contact (phone, address). Edit dialog with react-hook-form + zod mirroring FR-EDIT-01
  (headline 1–120 chars, no line breaks; about me 1–2000; empty → clear). Picture: jpeg/png/webp,
  ≤ 5 MiB checked client-side; 413/415 messages shown.
- `account/profile/page.tsx`: http mode → self profile screen; mock mode → today's
  `OwnProfileScreen`.

### Phase 4 — route, browser spec, docs
- Add `/account/profile` to `HTTP_LIVE_ROUTES` (it stops being a demo area).
- `self-profile.live.spec.ts` against the local seeded backend: edit headline, upload and remove
  a picture, desktop + 360 px.
- ARCHITECTURE.md §5 row.

## Decisions needed
1. **Public profile in http mode:** hide the "View public profile" and "Share" actions (they need a
   backend), or keep them as demo? Recommendation: hide.
2. **Top-bar avatar:** show the real picture there too (one extra blob fetch per session)?
   Recommendation: yes, in this plan.

## Backend asks
- None to ship this. Later, for the public profile: username pages, visibility per section,
  workplaces history.

## Risks
- The picture endpoint needs the bearer token, so `<img src>` can't point at it; the adapter
  fetches a blob and makes an object URL (revoked on change).
