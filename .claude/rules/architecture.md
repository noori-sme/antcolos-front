---
description: Core architectural rules for the Antcolos frontend (always loaded)
---

Layers, top to bottom. A layer may import only from the layers below it.

```
src/app/**            routes: thin. page.tsx renders one feature screen, nothing else
src/features/<x>/     screens, feature components, hooks.ts (TanStack Query), labels
src/components/       shared UI: ui/ primitives, layout/, data/ states, auth/ <Can>
src/lib/api/          the backend seam: contracts/ (interfaces), http/ (real), mock/ (in-memory)
src/lib/<domain>/     pure domain logic (no React, no network): status, rules, calculations
src/lib/query|session|permissions   cross-cutting infrastructure
src/types/            canonical entity types shared by contracts, mocks, and UI
src/config/           nav, statuses, brand: data, not logic
```

- `src/features/<a>` must not import from `src/features/<b>` internals. Shared code moves
  down into `src/components/` or `src/lib/`. Re-exporting a sibling's hook is a smell.
- A screen reads data **only** through hooks in its own `features/<x>/hooks.ts`. The hook
  calls `services.<domain>.<method>(ctx, …)` from `@/lib/api` with `ctx` from
  `useServiceContext()`. Screens never import `apiClient`, `axios`, or `fetch`.
- Service contracts in `src/lib/api/contracts/<domain>.ts` are the seam. Both adapters
  implement the same interface, and `NEXT_PUBLIC_API_MODE` picks one. A domain the backend
  hasn't built stays on mock. A domain it has built gets an http adapter, never a second
  ad-hoc client.
- Backend DTO shapes are mapped to canonical `src/types` inside the http adapter
  (`src/lib/api/http/<domain>.ts`). UI code never sees raw response envelopes.
- Domain rules (status derivation, money, eligibility) live in `src/lib/<domain>/` as pure
  functions with tests. If logic is copied into two screens, it belongs in lib.
- Authorization in the UI is `can(permissions, key)`. Never compare `role`, `roleName`, or
  `orgType` strings to decide what to show. Route gating goes through
  `src/lib/permissions/route-manifest.ts` (derived from `src/config/nav.ts`).
- Default to Server Components for static shells, and add `"use client"` only where hooks or
  browser APIs are needed. The session and data layer are client-side (cookies + React Query).
  Don't fetch tenant data in Server Components until the auth model moves server-side.
- Next.js 16 differs from your training data. Before you use a framework API (routing,
  `proxy`/middleware, caching, `params` as a Promise, config), read the matching page under
  `node_modules/next/dist/docs/`.
- Big screens: anything over ~400 lines gets split into components and hooks in the same
  feature folder. Don't grow a 1,500-line screen further.
