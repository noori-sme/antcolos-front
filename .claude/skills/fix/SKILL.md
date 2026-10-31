---
name: fix
description: Antcolos frontend bug-fix track — restate expected vs actual, reproduce with a failing test (or a recorded browser repro), find the root cause (frontend vs backend), minimal fix, check siblings, verify, review. Use for any defect report or broken behavior.
argument-hint: "<bug description, failing test, screenshot, or issue>"
---

# Fix track

## 1. Understand
- Restate the bug as **expected** (cite `docs/requirements/…` or the backend contract)
  vs **actual**. If "expected" isn't written down anywhere, ask the user.
- Classify which layer fails. Check the network response first, since it splits the space in half:
  - wrong request (path, params, headers, body) → frontend adapter or hook
  - right request, wrong or failed response → **backend bug**. Write it up with the request,
    the response, and the contract line it violates, then stop and hand it to the user. Don't
    patch around a backend bug in the UI unless the user asks.
  - right response, wrong screen → mapper, hook, cache key, or component
- If the fix needs a new route, permission key, or contract change, switch to `/feature`.

## 2. Reproduce
- Pick the lowest tier that reproduces it: mapper or pure-function unit test → mock-service test →
  Playwright spec (rendering, gating, navigation, responsive).
- Confirm it fails **for the reported reason**. A test that fails for some other reason doesn't count.
- When a test is impractical (third-party widget, timing), record a browser repro (steps +
  screenshot via chrome-devtools MCP) and say why there's no test.

## 3. Root cause
One or two sentences on the cause, not the symptom. Common causes here: query key not org-namespaced
(stale cross-org data), invalidating the wrong prefix, stale cookie (`antcolos_next_step` and
role cookies), checking a role instead of `can()`, a dot vs colon permission key, `params` not
awaited (Next 16), or hydration mismatch from reading cookies or `window` during render.

## 4. Fix
- Make the smallest change that fixes the cause. No drive-by refactors. List them for the user instead.
- Run the new test (it should pass now) and the touched feature's tests.

## 5. Siblings
Grep for the same pattern elsewhere (e.g. other inline `queryKey: ["…"]`, other
`window.location.href`, other screens that parse `error.response`). Report every hit. Fix them only
if they're clearly the same bug or the user agrees.

## 6. Verify and review
`/verify fast`. Use `/verify full` if the fix touches `src/lib/api`, `src/lib/session`,
`src/lib/permissions`, `src/middleware.ts`, or `src/components/ui`. Run the `frontend-reviewer`
agent if auth, permissions, caching, or the API client changed.

## 7. Report
Root cause, layer, fix, regression test, sibling hits, and the suggested commit
(`fix(<feature>): …`). Commit only if asked.
