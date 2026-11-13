# Contributing to the Antcolos frontend

The same rules apply to people, Claude Code and Cursor sessions. `CLAUDE.md` covers how work is
sized and planned. This file covers branches and pull requests.

## Branches

**Format: `<type>/<scope>-<slug>`.** All lowercase, words joined by `-`, at most 60 characters.

| Part | Meaning | Examples |
| --- | --- | --- |
| `type` | The Conventional Commit type of the main change: `feat`, `fix`, `docs`, `chore`, `refactor`, `perf`, `test`, `build`, `ci`, `style`, `revert` | `feat` |
| `scope` | The feature or area, the same word you'd put in the commit scope: `loads`, `fleet`, `auth`, `session`, `people`, `access`, `carriers`, `nav`… | `loads` |
| `slug` | A few words on what the branch does | `ratecon-review` |

```text
feat/loads-ratecon-review
fix/auth-individual-sign-in
docs/architecture-integration-status
chore/branch-naming
```

- **One branch per task.** Start it from the latest **`main`**.
- **Full-stack work** uses the **same branch name as the backend branch**, for example
  `feat/loads-review-api` in both repos. See `../antcolos/docs/ai/fullstack.md`.
- **A merged branch is finished.** Follow-up work gets a new branch, not more commits on the old one.
- **Never** `claude/<random-words>`, `cursor/<…>-<hash>`, `ccr-…` or `sandbox/…`. Cloud agents
  are given names like these automatically. A session given one creates a correctly named
  branch and works there (see `CLAUDE.md` → Branches).
- `main` is the only long-lived branch. It is connected to Vercel: **merging to `main` deploys
  production.** `staging` is legacy, from before this repo was split from the old one; don't
  branch from it or open PRs to it (owner, 2026-11-13).

CI enforces the format: the `Branch name` job fails a PR from any other name.

## Pull requests

- **PRs:** `<type>/<scope>-<slug>` → `main`. The title is a Conventional Commit line, the
  same as the main commit (`feat(loads): Rate Con review screen (F1.1)`). Merging deploys
  production, so say how to roll back.
- **Body:** fill in `.github/pull_request_template.md`. Keep the headings and write "n/a" with a
  reason rather than deleting a section.
- **Backend dependency:** the frontend never ships a call to an endpoint that isn't deployed on
  the target environment. Link the backend PR, which merges first.
- **Before review:** `/verify` passes, plus `frontend-reviewer` for Change, Fix, Integrate and
  Feature work. For a live check on production, run the matching `*.live.spec.ts` against the
  deployed URL after the release.
