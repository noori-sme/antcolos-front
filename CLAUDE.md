@AGENTS.md

# Antcolos frontend

Next.js 16 (App Router) + React 19 + TanStack Query 5 + Zustand + Tailwind 4 + Radix + zod/react-hook-form.
Multi-tenant TMS ("Fleet & Dispatch OS") UI. The NestJS backend lives at `../antcolos`
(its own `CLAUDE.md`, contracts in `../antcolos/docs/requirements/*-api-contract.md`,
live OpenAPI at `<API_URL>/api/docs`).

Most of the product still runs on in-memory mocks behind `src/lib/api/contracts/`. Auth,
onboarding, access/invitations, roles, people, and fleet trucks already talk to the real API.
Moving domain after domain from mock to HTTP is the main ongoing work.

## Commands

```bash
npm run dev                         # http://localhost:3000; NEXT_PUBLIC_API_MODE=mock|http
npm run lint && npm run typecheck
npx vitest run <path-or-pattern>    # service/domain tests (vitest.config.ts includes)
npm run test:node                   # node --test over tests/*.test.ts
npm run test:browser -- <spec>      # Playwright, boots `next dev` on :3100
npm run build                       # production build: run it before you call work done
```

## Rules

Always loaded: `.claude/rules/architecture.md`. Path-scoped (they load when you touch
matching files): `data-layer`, `ui-components`, `routing-auth`, `testing`. Treat them as the
source of truth. `.agents/rules/*` holds older rules for other tools, and the
`ui-components` rule supersedes them.

Hook (`.claude/hooks/guard-edits.sh`): blocks edits to `.env*` (except `.env.example`), to
`package-lock.json`, and to the backend repo `../antcolos`. If it blocks you, follow its
message. Don't work around it.

**If something doesn't load** (some cloud modes skip hooks, skills, agents, or path-scoped
rules): run `bash .claude/hooks/bootstrap.sh` yourself, treat the hook rules above as rules,
read the matching `.claude/rules/<area>.md` before editing that area, and for a missing skill
or agent read `.claude/skills/<name>/SKILL.md` or `.claude/agents/<name>.md` and follow it.

**Cloud sessions:** dependencies refresh via `bootstrap.sh` (SessionStart hook, or run it).
Commit and push the task's own branch at the end of every phase (never `staging` or `main`):
an idle VM can be reclaimed with unpushed work.

**Full-stack tasks** (backend and frontend together, in a session started above both repos):
follow `../antcolos/docs/ai/fullstack.md`. There both repos are editable; the
"backend is read-only" rule below applies to frontend-only sessions.

The six rules you must never break:
1. **Components never call the network.** No `apiClient`/`fetch` in `src/app` or `src/features`
   screens. Every call goes through a service in `src/lib/api/` (contract → http adapter) and
   a feature hook. (Legacy screens break this today; see `docs/architecture/ARCHITECTURE.md` §6.)
2. **Every query key is org-namespaced** via `queryKeys`/`orgKey` in `src/lib/query/keys.ts`.
3. **Nothing checks a role name.** Gate UI with `can()` / `<Can>` / `ROUTE_MANIFEST` on
   permission keys. The UI gate is UX only, because the backend enforces the permission.
4. **The backend contract is the authority.** Request/response types follow
   `../antcolos/docs/requirements/<feature>-api-contract.md`. Never invent a field or an endpoint.
   If the contract is missing or wrong, stop and raise it.
5. **No hardcoded colors.** Use the design tokens in `src/styles/globals.css` and the
   primitives in `src/components/ui`. Loading, empty, and error states come from
   `src/components/data/states.tsx`.
6. **Secrets never reach the client.** Only `NEXT_PUBLIC_*` values are read in browser code,
   and tokens live in cookies managed by `src/lib/api/client.ts` and nowhere else.

## Docs map (read the section you need, not the whole file)

- `docs/architecture/ARCHITECTURE.md`: layers, data flow, the integration pattern, known drift.
- `docs/workflow/WORKFLOW.md`: the full lifecycle (requirements → deploy) and which skill runs each stage.
- `docs/requirements/<feature>.md`: frontend requirements (screens, states, permissions).
- `docs/plans/NN-<slug>.md`: implementation plans, numbered. The latest one has the highest NN.
- `docs/*.md` (root): domain design records (roles-and-permissions, factoring-check, …).
- `README.md`: long per-domain feature notes. Search it, don't read it whole.

## Workflow: size the task first, then follow its track

| Track | When | What to do |
| --- | --- | --- |
| **XS** | Copy, style tweak, config value, comment, no behavior change | Edit → lint/typecheck the file → done. No plan. |
| **Fix** | Observed behavior differs from requirements/contract | `/fix` |
| **Change** | Behavior change inside one feature, no new endpoint, route, or permission | Bullet plan in chat → test first → implement → `/verify` → `frontend-reviewer` agent |
| **Integrate** | Wire an existing backend endpoint group to the UI (mock → http, or a new call) | `/integrate <contract doc or endpoint group>` |
| **Feature** | New screen/route, new domain, new permission key, nav change, auth/session/middleware change, or anything that needs backend work first | `/requirements` → `/feature` (plan doc + approval before code) |
| **Ship** | Open a PR, promote staging → main, deploy | `/ship` |

When you're unsure between two tracks, take the larger one. Every track except XS includes the test step.

## Working habits

- Find the closest existing feature and copy its shape before you invent a new one
  (data via `features/workforce/hooks.ts` + `lib/api/contracts/workforce.ts`. UI via
  `features/fleet/fleet-roster-screen.tsx` for list + filters + pagination).
- Use the `Explore` subagent for wide searches. Read only the files and doc sections you need.
  The backend is read-only from this repo: read it to learn the contract, never edit it from here.
- If the UI needs something the backend doesn't have, write it down as a backend ask in the plan
  (`## Backend asks`) and tell the user. Don't mock around it silently.
- Run targeted tests while you iterate. Run the full suite only in `/verify full`.
- Commits follow Conventional Commits scoped by feature (`feat(fleet): …`, `fix(auth): …`).
  Locally, commit or push only when asked (cloud sessions: see above). Branch flow: feature
  branch → `staging` → `main`.
- The plan doc is the hand-off between sessions. Keep its status block current so a fresh
  session can resume after `/clear`.
