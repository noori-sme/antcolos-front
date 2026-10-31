---
name: ship
description: Antcolos frontend release track — preflight (verify full, env vars, backend compatibility), PR to staging, staging smoke test, promote staging → main, post-deploy check, rollback plan. Use when the user says ship, release, deploy, open a PR, or promote to production.
argument-hint: "[pr|staging|production]"
---

# Ship

Branch flow: `feature/*` or `fix/*` → PR into **`staging`** (deploys the staging site against
the staging API) → PR `staging` → **`main`** (production). Every push, PR, and deploy is
outward-facing, so confirm each one with the user before doing it.

## 1. Preflight (always)
- `/verify full` passes with no regressions vs baseline.
- `git status` is clean, the branch is rebased on `origin/staging`, and the commits follow Conventional Commits.
- **Env vars**: grep for new `process.env.` reads in the diff. Each new one must be listed in
  `.env.example` and set in the hosting environment for staging and production. A `NEXT_PUBLIC_*`
  value is baked in at build time, so changing it needs a rebuild, not a restart.
- **Backend compatibility**: every endpoint the diff calls must be deployed on the target
  environment's API. Check `git -C ../antcolos log origin/main --oneline` for the backend
  plan/PR, or hit the endpoint on staging. A frontend that ships before its backend is a
  production incident.
- `NEXT_PUBLIC_API_MODE`: production must be `http` for every domain that's wired. Mock-only
  domains must be hidden or clearly labelled. They must not look live.

## 2. PR (`/ship pr`)
- Use the ECC `/prp-pr` or `/pr` skill, or `gh pr create --base staging`, with
  `.github/pull_request_template.md`. Fill in the checklist honestly.
- The title is the Conventional Commit summary. The body links the plan/requirements doc and lists backend asks.
- After CI runs, read the result (`gh pr checks`). Don't call it ready while checks fail.
  Use `claude-mem:babysit` to watch reviews and CI if the user wants.

## 3. Staging (`/ship staging`)
- After the merge to `staging`, wait for the staging deploy and smoke-test it: sign in, the touched
  flows, a 360 px viewport, and a console free of errors (chrome-devtools MCP:
  `navigate_page`, `take_screenshot`, `list_console_messages`, `list_network_requests`).
- Report what you checked, with screenshots.

## 4. Production (`/ship production`)
- Only with explicit user approval, after staging has been verified.
- Open `staging → main` (`gh pr create --base main --head staging`). The body is the list of
  PRs since the last release (`git log origin/main..origin/staging --oneline`).
- After the deploy: smoke-test production the same way, then watch errors for 15–30 minutes.

## Rollback
The hosting platform's "redeploy previous" is the fast path (a Vercel instant rollback or a Railway
redeploy of the previous deployment). Then `git revert` the merge on `main` so git matches
what's live. Rolling the frontend back never needs a backend rollback, but rolling the
backend back may break a frontend that depends on new endpoints, so check before you do it.

## Deployment target
See `docs/workflow/WORKFLOW.md` §Deploy for the platform, project names, and env var matrix.
If that section is still marked TODO, ask the user before deploying anything.
