---
paths:
  - "src/**/*.test.ts"
  - "tests/**"
  - "src/lib/**/*.ts"
  - "src/features/**/hooks.ts"
  - "vitest.config.ts"
  - "playwright.config.ts"
description: Testing tiers and requirements
---

Three tiers. Pick the lowest one that proves the claim.

| Tier | Runner | Where | Proves |
| --- | --- | --- | --- |
| Unit/service | vitest (node env) | `src/**/*.test.ts` beside the code, or `tests/<domain>/**` (must be listed in `vitest.config.ts` `include`) | pure domain logic, DTO→type mappers, mock-service permission and org isolation |
| Node | `node --test` | `tests/*.test.ts` (root level only) | directory/normalization suites that are already there. Don't add new ones here |
| Browser | Playwright | `tests/browser/*.spec.ts` | what a person sees: auth flows, gating, responsive layout, critical journeys |

- `vitest.config.ts` is the live config (`.ts` wins over `.mts`). A new `tests/<dir>/`
  must be added to its `include`, or its tests silently never run.
- Every new http adapter mapper (`toX(dto)`) gets a unit test fed with a fixture copied from
  the contract doc's example response.
- Every new or changed pure function in `src/lib/<domain>/` gets a test in the same change.
- Mock-service methods that enforce permissions or org scope need a test for the refused
  path (wrong org, missing permission), not only the happy path.
- Browser specs are required for: sign-in/sign-up/onboarding/invitation changes, a new
  `(app)` route's permission gate, and any layout claim on mobile. Use roles and labels
  (`getByRole`, `getByLabel`). Don't select on CSS classes.
- Browser specs run against `next dev` on :3100 in mock mode. A spec that needs the real
  backend must say so in its name (`*.live.spec.ts`) and is excluded from CI.
- Don't hard-code dates that will pass into the past. Build them relative to `Date.now()` or use
  `vi.useFakeTimers()`.
- Known baseline: `staging` has pre-existing vitest failures and lint errors (see
  `docs/workflow/WORKFLOW.md` §Baseline). Your change must not add new ones. Don't
  "fix" unrelated failures in the same change.
