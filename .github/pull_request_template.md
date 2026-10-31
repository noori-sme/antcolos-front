## What and why
<!-- 1–3 sentences. Link the plan / requirements doc. -->

Plan: `docs/plans/NN-…` · Requirements: `docs/requirements/…`
Track: XS / Fix / Change / Integrate / Feature

## Backend dependency
- [ ] None
- [ ] Uses endpoints already deployed on the target environment: <list>
- [ ] Needs backend PR: <link> (merge and deploy that first)

## Checklist
- [ ] No `apiClient`/`fetch` in screens. Data goes through `services` + feature hooks
- [ ] Query keys start with `orgKey()`. Mutations invalidate the right prefix
- [ ] UI gated by permission keys (`<Can>`/`can()`), never role names
- [ ] Loading / empty / error / success states. Design tokens only
- [ ] New routes registered in `nav.ts` or `EXTRA_ROUTES`
- [ ] New env vars added to `.env.example` and set in hosting (staging + prod)
- [ ] Checked at 360 px

## Verification
<!-- Paste the /verify report: one line per step, with the delta vs baseline. -->
- typecheck:
- lint (errors vs baseline):
- vitest (failures vs baseline):
- build:
- browser specs run:

## Screenshots
<!-- Desktop + mobile for any visible change. -->
