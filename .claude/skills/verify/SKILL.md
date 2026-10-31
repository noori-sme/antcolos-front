---
name: verify
description: Antcolos frontend verification gate. `fast` checks changed files (eslint, typecheck, related vitest); `full` mirrors CI (lint, typecheck, all vitest, node tests, build, browser specs for touched flows) and compares against the known staging baseline. Run before claiming any task done.
argument-hint: "[fast|full]"
---

# Verify

Use `fast` while iterating and `full` before you declare a Feature, Integrate, or shared-code Fix done.
Keep output small: pipe long runs through `tail -n 40`, and on a failure re-run only the
failing file to read the full error.

## Changed files

```bash
base=$(git merge-base HEAD origin/staging 2>/dev/null || git merge-base HEAD staging)
{ git diff --name-only "$base"...HEAD; git diff --name-only; git ls-files --others --exclude-standard; } \
  | sort -u | grep -E '\.(ts|tsx|mts)$' | xargs -r ls 2>/dev/null
```

## fast

```bash
npx eslint <changed files>
npm run typecheck
npx vitest related --run <changed src/**/*.ts(x) files>
```
Run any browser spec you added or whose flow you changed: `npx playwright test <spec> --project=desktop`.

## full (what CI runs)

```bash
npm run lint 2>&1 | tail -n 3          # compare the error count with the baseline
npm run typecheck
npx vitest run 2>&1 | tail -n 15       # ~6–7 min, so run it in the background
npm run test:node 2>&1 | tail -n 8
npm run build 2>&1 | tail -n 25
npx playwright test <specs for touched flows>   # the whole suite only for auth/session/nav changes
```

### Baseline
`staging` isn't green today. The numbers are in `docs/workflow/WORKFLOW.md` §Baseline. The rule
is **no new failures**: if lint errors or failing tests exceed the baseline, find out which
ones are yours by comparing names, not just counts. Re-run on `git stash` when you're unsure. When a
change legitimately fixes baseline failures, update the numbers in WORKFLOW.md.

If the dev server can't start or Playwright has no browser (set `CHROMIUM_PATH` or run
`npx playwright install chromium`), say which tiers were skipped. Never report them as passing.

## Report
One line per step: passed / failed / skipped (why), plus the delta vs baseline. For failures,
include the test name and the key error lines. Don't claim done while anything you introduced fails.
