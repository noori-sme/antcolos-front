---
name: ship
description: Antcolos frontend release track — preflight (verify full, env vars, backend compatibility), PR to main (merging deploys production on Vercel), post-deploy smoke test, rollback plan. Use when the user says ship, release, deploy, open a PR, or promote to production.
argument-hint: "[pr|production]"
---

# Ship

Branch flow: `<type>/<scope>-<slug>` → PR into **`main`**. `main` is connected to Vercel, so
**merging the PR deploys production**. There is no staging step: `staging` is a legacy branch
from before the repo split (owner, 2026-11-13); never branch from it or open PRs to it. Every
push, PR, and merge is outward-facing, so confirm each one with the user before doing it.

## 1. Preflight (always)
- `/verify full` passes with no regressions vs baseline.
- `git status` is clean, the branch is up to date with `origin/main`, and the commits follow Conventional Commits.
- **Env vars**: grep for new `process.env.` reads in the diff. Each new one must be listed in
  `.env.example` and set in the Vercel project before the merge. A `NEXT_PUBLIC_*` value is
  baked in at build time, so changing it needs a rebuild, not a restart.
- **Backend compatibility**: every endpoint the diff calls must be deployed on the production
  API before this merges. Check `git -C ../antcolos log origin/main --oneline` for the backend
  plan/PR, or hit the endpoint. A frontend that ships before its backend is a production incident:
  link the backend PR and merge it first.
- `NEXT_PUBLIC_API_MODE`: production must be `http` for every domain that's wired. Mock-only
  domains must be hidden or clearly labelled. They must not look live.

## 2. PR (`/ship pr`)
- Use the ECC `/prp-pr` or `/pr` skill, or the GitHub tools, with **base `main`** and
  `.github/pull_request_template.md`. Fill in the checklist honestly.
- The title is the Conventional Commit summary. The body links the plan/requirements doc, the
  backend PR it depends on, and how to roll back.
- After CI runs, read the result. Don't call it ready while checks fail.

## 3. Production (`/ship production`)
- Merge only with explicit user approval, after the backend it needs is deployed.
- After the Vercel deploy: smoke-test production — sign in, the touched flows, a 360 px viewport,
  and a console free of errors (chrome-devtools MCP: `navigate_page`, `take_screenshot`,
  `list_console_messages`, `list_network_requests`) — then watch errors for 15–30 minutes.
- Report what you checked, with screenshots.

## Rollback
The hosting platform's "redeploy previous" is the fast path (a Vercel instant rollback or a Railway
redeploy of the previous deployment). Then `git revert` the merge on `main` so git matches
what's live. Rolling the frontend back never needs a backend rollback, but rolling the
backend back may break a frontend that depends on new endpoints, so check before you do it.

## Deployment target
See `docs/workflow/WORKFLOW.md` §Deploy for the platform, project names, and env var matrix.
If that section is still marked TODO, ask the user before deploying anything.
