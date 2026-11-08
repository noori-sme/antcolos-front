# 04 — Freeze the extension-owned load-search mocks (F0.3)

```
Status:   implemented (product owner: "continue … with your default recommendation")
Branch:   claude/magical-mccarthy-pgmh3z
Track:    Feature (nav change), approved under the standing default-recommendation instruction
Source:   ../antcolos/docs/product/antcolos-spec.md §3, §8 (load search, filters, ranking and broker
          outreach live in the dispatcher browser extension); milestone F0.3
Updated:  2026-11-06
```

## Decision (default)

Hide, don't delete. Since 3 Nov 2026 the spec puts load search, ranking, negotiation and broker
outreach in the dispatcher extension, so Antcolos should not invite people to work there. The
Opportunity inbox and its "Learning and your data" page leave the navigation. Their routes and
mock code stay, because other mock screens still link to or embed them (home attention items,
the Rate Con review back link, the MT Loop truck screen); removing them is a larger cleanup for
when those screens move to real data.

## Changes

- `src/config/nav.ts`: remove "Opportunities" (`/dispatch/opportunities`) and "Learning and your
  data" (`/settings/learning`).
- `src/lib/permissions/route-manifest.ts`: keep `/settings/learning` gated on
  `organization:manage` explicitly (it was derived from the nav entry). `/dispatch/opportunities`
  is already explicit.
- Tests: nav no longer lists either route; both routes keep their gates.

## Not changed

No new work on `features/opportunities`, `lib/api/mock/{ranking,search-session,opportunity-*,
negotiation}`: they are frozen. Deep links still open them in mock mode.
