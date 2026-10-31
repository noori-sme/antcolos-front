---
name: integrate
description: Wire an existing NestJS backend endpoint group into the Antcolos frontend the right way — contract → typed http adapter + mapper tests → org-namespaced hooks → screen. Use when moving a domain from mock to the real API, adding a call to an endpoint that already exists, or refactoring a legacy screen that calls apiClient directly.
argument-hint: "<backend contract doc, endpoint group (e.g. 'trucks'), or legacy screen path>"
---

# Integrate track

This is the most common task in this repo. Scope: endpoints that **already exist** in the
backend. If the UI needs an endpoint that doesn't exist, stop and switch to `/feature`
(it needs a backend ask).

## 1. Read the contract
- `../antcolos/docs/requirements/<feature>-api-contract.md`: methods, paths, permissions,
  idempotent flags, request/response examples, errors, pagination and sort params.
- Confirm against the code: `../antcolos/src/modules/<module>/controllers/*.ts` and `dto/*.ts`.
  Note every mismatch. Contract and code disagreeing is a finding for the user, so don't guess.
- Optional: the `contract-checker` agent produces this table for you.

Write a short mapping table in chat: `endpoint → contract method → canonical type → hook`.

## 2. Contract and types
- Canonical types in `src/types/<domain>.ts`. Reuse what exists and extend it carefully.
  Shared `Paginated<T>` and `PageQuery` types come from `src/types/common.ts`. Add them there once if they're missing.
- Service interface in `src/lib/api/contracts/<domain>.ts` (every method takes `ctx` first).
  Export it from `contracts/index.ts` and add it to `AntcolosServices`.

## 3. HTTP adapter + mapper tests (test first)
- Create `src/lib/api/http/<domain>.ts`:
  - `type XDto` mirrors the contract response exactly (keep it local to the adapter).
  - `toX(dto: XDto): X` maps DTO → canonical type, with enums mapped explicitly.
  - Methods call `apiClient` with relative paths (`/trucks`) and the contract's query params.
    Idempotent routes take an `idempotencyKey` argument and send `Idempotency-Key`.
- Write `src/lib/api/http/<domain>.test.ts` **before** the mapper, using fixtures copied from the
  contract's example JSON. Cover: full object, nullable fields null, unknown enum value.
- Register it in `src/lib/api/http/index.ts`, replacing the `notImplemented` stubs for that domain.
- Mock adapter: keep it working (it powers `next dev` in mock mode and the browser suite).
  If the contract changed shape, update the mock to match.

## 4. Hooks
- In `src/features/<x>/hooks.ts`: a key factory built on `orgKey()`, plus `useXList(filters)`,
  `useX(id)`, and `useXMutation()`. Follow the `features/workforce/hooks.ts` shape.
- Invalidate the narrowest prefix on success. List queries use `placeholderData: keepPreviousData`.

## 5. Screen
- Replace inline `apiClient`/`useQuery` and the locally declared DTO interfaces in the screen
  with the hooks and canonical types. Keep the visual output identical unless the
  requirements say otherwise. This is a refactor of the data path, not a redesign.
- Make sure all four states are present and the `<Can>` gates match the contract's permissions.

## 6. Run it against the real backend
- Staging: `NEXT_PUBLIC_API_MODE=http npm run dev` (the default `NEXT_PUBLIC_API_URL` points
  at Railway staging).
- Local full stack: in `../antcolos` run `npm run docker:up && npm run start:dev` (port 3000).
  Then run `NEXT_PUBLIC_API_MODE=http NEXT_PUBLIC_API_URL=http://localhost:3000/api/v1 npm run dev -- -p 3001`
  here (the backend expects the web app on :3001; add it to the backend's `CORS_ORIGINS` if
  the browser blocks it).
- Exercise each action once in the browser (ECC chrome-devtools MCP, or the `/run` skill).
  Check the network panel: correct path, params, headers, and no request without a tenant token.

## 7. Verify and review
`/verify fast`, then the `frontend-reviewer` agent. Report the endpoints wired, the mismatches
found, and anything left on mock.
