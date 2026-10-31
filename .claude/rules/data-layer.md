---
paths:
  - "src/lib/api/**"
  - "src/lib/query/**"
  - "src/features/**/hooks.ts"
  - "src/features/**/use-*.ts"
  - "src/types/**"
description: Backend integration, service contracts, React Query conventions
---

## Calling the NestJS backend

- Source of truth, in order: `../antcolos/docs/requirements/<feature>-api-contract.md`, then
  the live OpenAPI (`<API_URL>/api/docs-json`), then the backend controller/DTO
  (`../antcolos/src/modules/**/controllers|dto`). When they disagree, the contract doc wins
  and the disagreement is reported to the user.
- Base URL is `NEXT_PUBLIC_API_URL` (includes `/api/v1`). Use `apiClient` (JSON) or
  `fileApiClient` (multipart) from `src/lib/api/client.ts`. Import them only inside
  `src/lib/api/http/**` and `src/lib/session/**`.
- Auth: `Authorization: Bearer` comes from the interceptor. Don't set it by hand. The tenant
  is carried by the JWT. Send `x-organization-id` only when the contract asks for it.
  **Never** send `organizationId` in a body.
- Routes the contract marks **Idempotent** need an `Idempotency-Key` header. Generate one
  key per user intent (`crypto.randomUUID()` when the mutation starts) and reuse it on retry.
  A key that changes on every retry defeats the purpose.
- Lists come back as `{ data, meta: { page, pageSize, totalItems, totalPages } }`
  (`pageSize` max 100). Model this once as a shared `Paginated<T>` type and don't redeclare it per screen.
- Errors: the interceptor rejects with `Error(message)` (first NestJS validation message,
  friendly 5xx text). Show `error.message` via `<ErrorState>` or a toast. Don't parse
  `error.response` in a screen. If a screen needs field errors or a status code, extend the
  adapter to throw a typed `ApiError`. Don't reach into axios from the UI.
- 401/403 on `/auth/me` and failed `/users/me/permissions` log the user out globally. Don't
  catch and swallow those.

## Contracts and adapters

- Add or change a method in `contracts/<domain>.ts` first, then implement it in **both**
  `http/<domain>.ts` and `mock/<domain>.ts` (or leave the mock as `notImplemented` with a
  reason if the domain is http-only). Register the domain in `http/index.ts` and
  `src/lib/api/index.ts`.
- Every method takes `ctx: ServiceContext` first. The one exception, `ProfileService` reads,
  is documented in `contracts/profile.ts`, so don't add another.
- The http adapter maps DTO → canonical type in a named `toX(dto)` function with a unit test.
  Enum values are mapped explicitly (`AVAILABLE` → `"available"`), never cast.
- The mock adapter keeps its org partitioning and permission checks. A mock that ignores
  `ctx.organizationId` is a bug.

## React Query

- Every query key starts with `orgKey(organizationId)`. Define them in a feature-local key
  factory (`export const fleetKeys = { list: (org, f) => [...orgKey(org), "trucks", "list", f] }`)
  at the top of `features/<x>/hooks.ts`, which is the `features/workforce/hooks.ts` pattern, or in
  `queryKeys` (`src/lib/query/keys.ts`) when several features share them. Inline array keys
  (`["trucks", …]`) are not allowed in new code.
- A hook is `useX()` in `features/<x>/hooks.ts`. It reads `ctx = useServiceContext()`,
  sets `enabled: Boolean(ctx)`, and returns the query object unchanged (copy the shape of
  `useWorkforceList`).
- Mutations invalidate the narrowest key prefix that covers what changed (for example
  `[...orgKey(org), "trucks"]`). Use `setQueryData` for optimistic updates only when the
  contract returns the full entity.
- Paginated lists use `placeholderData: keepPreviousData`. Debounce search input at around 300 ms
  in the screen, not in the hook.
- Defaults (staleTime 30 s, retry 1, no refetch on focus) live in `src/lib/query/client.ts`.
  Override per query only with a reason.
