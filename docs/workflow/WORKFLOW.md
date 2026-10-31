# Antcolos frontend workflow

One lifecycle for every task: **Requirements → Plan → Build → Test → Review → Ship**.
Size the task first (tracks in `CLAUDE.md`). Small tracks skip stages, but none skips testing
except XS.

## Lifecycle at a glance

| Stage | Project skill / agent | Helpful installed extras (ECC etc.) | Output |
| --- | --- | --- | --- |
| 1. Requirements | `/requirements` | `ecc:plan-prd`, `ecc:prp-prd` (problem-first PRD), `/jira` (if configured), `design:ux-copy` | `docs/requirements/<feature>.md` |
| 2. Plan | `/feature` stages 1–3 | `ecc:planner` / `ecc:code-architect` agents, `ecc:plan-canvas` (annotate the plan in a browser) | `docs/plans/NN-<slug>.md`, user approval |
| 3. Build | `/feature` stage 4, `/integrate`, `/fix` | `ecc:react-test` (RTL TDD), `ecc:frontend-patterns`, `ecc:nextjs-turbopack`, `ecc:react-build` (build errors). Design: `design:design-system` (new components/patterns), `ecc:make-interfaces-feel-better` (polish), `ecc:frontend-a11y`, `design:ux-copy` | code + tests, phase commits |
| 4. Test | `/verify fast\|full` | `ecc:e2e-runner` agent, `ecc:browser-qa`, chrome-devtools MCP (screenshots, console, network), `/run` | verify report vs baseline |
| 5. Review | `frontend-reviewer`, `contract-checker` agents | `ecc:react-review`, `ecc:security-reviewer` (auth/session), built-in `/code-review`, `/simplify`. Design: `design:design-critique` (screenshots desktop + 360 px), `design:accessibility-review` | no blocking findings |
| 6. Ship | `/ship pr\|staging\|production` | `ecc:prp-pr`, `claude-mem:babysit` (watch CI and reviews), `engineering:deploy-checklist` | PR → staging → main, smoke-test report |

Design skills: the "which one, when" table lives in `.claude/rules/ui-components.md` and
loads automatically whenever UI files are touched. The rule there is that the existing tokens
and `components/ui` always win over any skill's suggestion.

## Typical flows

**New screen for an endpoint the backend already has**
`/requirements fleet-trucks` → `/integrate trucks` → `/verify full` → `/ship pr`

**New domain that needs backend work** (e.g. loads)
1. Backend session in `../antcolos`: `/feature` there produces `docs/requirements/<x>-api-contract.md`.
2. Here: `/requirements <x>` (reads that contract) → `/feature` (builds on mock behind the
   contract while the backend is in progress) → `/integrate <x>` once the backend is on staging.

**Bug**
`/fix "<what happened>"`. It decides frontend vs backend from the network response first.

**Legacy cleanup** (direct `apiClient` screens, ARCHITECTURE.md §6)
`/integrate features/fleet/fleet-roster-screen.tsx`, one domain per PR, with no visual changes.

## Cross-repo rules

- The backend is read-only from this repo (a hook enforces it). Contract changes happen in a
  backend session, then come back here.
- A backend ask template (paste it into a ticket):
  `Endpoint · why the UI needs it · request/response sketch · permission · idempotent? · blocking?`
- Ports for the local full stack: backend :3000, frontend :3001 (`npm run dev -- -p 3001`),
  browser tests :3100.

## Session hygiene

- One task per session. Run `/clear` between tasks, and the plan doc's status block is the hand-off.
- Track multi-step work with claude-mem work state (one list per plan).
- Use subagents (`Explore`, `contract-checker`) for wide reads so the main context stays small.
- Never commit or push unless asked. Conventional Commits, scoped by feature.

## Baseline

Measured on `staging` @ `00f216a` (2026-11-01). The rule is **no new failures**. When you fix
some, lower these numbers.

| Check | Result |
| --- | --- |
| `npm run typecheck` | ✅ clean |
| `npm run lint` | ❌ 65 errors, 87 warnings (44 `no-explicit-any`, 16 `react-hooks/set-state-in-effect`, 3 `no-unescaped-entities`, 1 `rules-of-hooks`, 1 `immutability`) |
| `npx vitest run` | ❌ 28 failed / 2056 tests (8 files), about 6.5 min |
| `npm run test:node` | ❌ 5 failed / 805 tests |
| `npm run build` | ✅ passes (119 routes) |
| `npx playwright test` | not measured yet |

Baseline failures (failing count per file). The counts were the same across two runs, so these aren't flaky:
- vitest: `src/lib/api/mock/referrals.test.ts` (8), `src/lib/api/mock/access-policy.test.ts` (5),
  `src/lib/api/mock/access-interruption.test.ts` (1), `tests/responsibility/scenarios.test.ts` (10),
  `tests/responsibility/attention.test.ts` (1), `tests/responsibility/home-attention.test.ts` (1),
  `tests/fleet/fleet-service.test.ts` (1), `tests/eld/attribution.test.ts` (1)
- node: "the fallback is prefilled with carrier, broker, MC, amount and opportunity" ·
  "the posting keeps saying what the board said, for ever" · "a recorded reading says who typed
  it and is never called a feed" · "signing a rate confirmation commits ONE immutable record
  and finalizes the load once" · "the update policy › holds an update as a draft until a
  dispatcher approves it"

CI (`.github/workflows/ci.yml`) blocks on typecheck and build. Lint and tests run as
report-only until this baseline is cleared, and then those `continue-on-error` lines get deleted.

## Deploy

> **TODO, confirm with the owner.** Platform for the frontend (Vercel or Railway), project
> names, and production URL. `/ship` asks before deploying while this says TODO.

Env var matrix (all are build-time, because they're `NEXT_PUBLIC_*`):

| Var | local | staging | production |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_API_MODE` | `mock` or `http` | `http` | `http` |
| `NEXT_PUBLIC_API_URL` | staging or `http://localhost:3000/api/v1` | `https://antcolos-staging.up.railway.app/api/v1` | TODO |
| `NEXT_PUBLIC_SITE_ORIGIN` | `http://localhost:3000` | TODO | TODO |

Branches: `staging` → staging deploy, `main` → production deploy.
