---
name: feature
description: Full Antcolos frontend feature track — requirements check, explore, plan doc, user approval, build phase by phase with tests, verify, review, docs. Use for new screens/routes/domains, nav or permission-catalog changes, auth/session/middleware changes, or anything needing new backend work.
argument-hint: "<feature name or docs/requirements/<feature>.md>"
---

# Feature track

Work through the stages in order. Each stage has an exit condition, so don't start the next one
until it's met. Track one work-state item per stage, plus one per plan phase.

## 1. Intake
- Read `docs/requirements/<feature>.md`. If it's missing or still has open design questions,
  run `/requirements` first.
- Confirm the backend side: does the contract exist, and are the endpoints implemented?
  Grep the backend controllers (`grep -rn "@Controller\|@Get\|@Post" ../antcolos/src/modules/<m>/controllers`)
  and check that the code is on the deployed branch (`git -C ../antcolos log origin/main --oneline -5`).
  OpenAPI is at `<host>/api/docs-json` behind basic auth (`SWAGGER_USER`/`SWAGGER_PASSWORD`
  from the user's environment; never hardcode or ask to paste them). If the endpoints
  aren't implemented, the plan must say "build on mock behind the contract" and list the backend asks.

Exit: requirements agreed, and the backend status of each endpoint is known.

## 2. Explore (just enough)
- Find the closest existing feature and read its route, screen, hooks, contract, and adapter.
  Use `features/workforce` for data hooks and `features/fleet/fleet-roster-screen.tsx` for list UI.
- Use the `Explore` subagent for wide questions ("who else reads `antcolos_org_role`?").
- Check `git log --oneline -15` and the latest `docs/plans/` file for conflicting work.

Exit: you can name every file you'll create or change.

## 3. Plan
- Create `docs/plans/<NN>-<slug>.md` from [plan-template.md](plan-template.md) (NN = highest + 1).
- Usual phases, each independently shippable and testable:
  1. types + contract + adapters (mapper tests)
  2. hooks + query keys
  3. screens and components (all four states, `<Can>` gates)
  4. route, nav, and permission-manifest entries plus a browser spec
  5. docs
  Small features can merge phases.
- Fill in the invariant checklist honestly. A "n/a" needs a reason.
- For heavy UI work, optionally run the `ecc:architect` or `ecc:code-architect` agent on the plan.
- **Stop. Show the user the plan summary (phases, files, backend asks, risks) and wait for
  approval.** Don't write production code before approval.

Exit: the user approved (or approved with changes you applied to the doc).

## 4. Build: one phase at a time
For each phase:
1. Write the failing test first at the tier `.claude/rules/testing.md` requires.
2. Implement the minimum to pass, reusing `components/ui`, `components/data/states`, `<Can>`,
   `orgKey`, and existing mappers.
3. Run the targeted tests, then `/verify fast`.
4. Update the plan's status block (`Phase N — done`).
5. If the user authorized commits, commit the phase (`feat(<feature>): …`).

For visual work, check it in the running app: `npm run dev` and the ECC chrome-devtools MCP
(screenshot desktop at 1280 px and mobile at 360 px) or the `/run` skill. Use the design
skills from the table in `.claude/rules/ui-components.md`: `design:design-system` before you
add a component or pattern, `ecc:make-interfaces-feel-better` for the polish pass, and
`design:ux-copy` for empty/error/CTA text.

If reality contradicts the plan (a contract mismatch, a missing endpoint), stop, update the
plan, and tell the user before you continue.

Exit: all phases done, `/verify fast` green.

## 5. Verify
`/verify full`. Report the results faithfully.

## 6. Review
- Run the `frontend-reviewer` agent on the branch diff.
- If the feature touches the API, also run the `contract-checker` agent.
- For auth, session, or permission changes, also run `ecc:security-reviewer`.
- For new or redesigned screens, run `design:design-critique` on the desktop and 360 px
  screenshots, and run `design:accessibility-review`.
- Fix confirmed findings, then re-run `/verify fast`. Push back on wrong findings and give the reason.

## 7. Docs and hand-off
- Requirements doc → `Status: implemented`. Plan status → `implemented`.
- `docs/architecture/ARCHITECTURE.md` §5 domain table: update the mock/http status.
- New permission key → `docs/roles-and-permissions.md` + `src/lib/permissions/catalog.ts`.
- Backend asks: list them for the user in a form they can paste into a backend ticket.

Finish with a summary: what was built, the tests added, anything deferred, and a suggested PR
title. Next step: `/ship`.
