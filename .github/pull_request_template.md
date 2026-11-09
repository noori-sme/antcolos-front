<!--
Title: a Conventional Commit line, e.g. feat(loads): Rate Con review screen (F1.1)
Branch: <type>/<scope>-<slug>, e.g. feat/loads-ratecon-review (CONTRIBUTING.md → Branches)
Base: staging. A release PR (staging → main) only needs: What and why, Backend dependency, Verification, Rollback.
Keep every heading. Write "n/a" and a reason rather than deleting a section.
-->

## What and why

<!-- One to three sentences: the problem and what this PR does about it. -->

- Milestone task: <!-- F1.1, M1.3 … or n/a -->
- Plan: <!-- docs/plans/NN-… -->
- Requirements / contract: <!-- docs/requirements/… · ../antcolos/docs/requirements/<feature>-api-contract.md -->
- Track: <!-- XS / Fix / Change / Integrate / Feature / Release -->

## Changes

<!-- The main changes, grouped by feature. Name new routes, services, query keys, permission keys, env vars. -->

## Backend dependency

- [ ] None
- [ ] Uses endpoints already deployed on the target environment: <!-- list -->
- [ ] Needs backend PR: <!-- link, same branch name. Merge and deploy that first -->

## Checklist

- [ ] No `apiClient`/`fetch` in screens. Data goes through `services` + feature hooks
- [ ] Query keys start with `orgKey()`. Mutations invalidate the right prefix
- [ ] UI gated by permission keys (`<Can>`/`can()`), never role names
- [ ] Loading / empty / error / success states. Design tokens only
- [ ] New routes registered in `nav.ts` or `EXTRA_ROUTES` (and `src/config/live-routes.ts` if it works in http mode)
- [ ] New env vars added to `.env.example` and set in hosting (staging + prod)
- [ ] Checked at 360 px

## Verification

<!-- Paste the /verify report: one line per step, with the delta vs baseline. -->

- typecheck:
- lint (errors vs baseline):
- vitest (failures vs baseline):
- node tests:
- build:
- browser specs run:
- `frontend-reviewer`: <!-- findings and what was done about them -->

## Screenshots

<!-- Desktop + mobile for any visible change. -->

## Deploy notes and rollback

<!-- What happens on merge (staging → Vercel preview, main → production), any Vercel/Railway setting to change first, and how to undo it: revert the merge, or promote the previous Vercel deployment. "None" is a valid answer. -->
