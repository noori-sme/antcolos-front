# NN — <Feature title>

```
Status:   draft | approved | in-progress | implemented
Phase:    <current phase> — <done | in progress | blocked: reason>
Branch:   <branch>
Requirements: docs/requirements/<feature>.md
Backend contract: ../antcolos/docs/requirements/<feature>-api-contract.md
Updated:  <YYYY-MM-DD>
```

## Summary
2–4 sentences: what the user can do afterwards, and which part is real API vs mock.

## Endpoint status
| Endpoint | In contract | On staging | Adapter |
| --- | --- | --- | --- |
| `GET /trucks` | yes | yes | http |

## Files
| File | New/changed | Why |
| --- | --- | --- |

## Phases
### Phase 1 — types, contract, adapters
- [ ] …
- Tests: …
### Phase 2 — hooks and query keys
### Phase 3 — screens and components
### Phase 4 — routes, nav, permission manifest, browser spec
### Phase 5 — docs

## Invariant checklist
- [ ] No `apiClient`/`fetch` outside `src/lib/api/http/**` and `src/lib/session/**`
- [ ] Every query key starts with `orgKey(org)`. Mutations invalidate the narrowest prefix
- [ ] Gates use permission keys (`can`/`<Can>`/`ROUTE_MANIFEST`), never roles
- [ ] Types follow the contract. DTO → canonical mapping in the adapter, with tests
- [ ] Idempotent routes send a stable `Idempotency-Key`
- [ ] Four states for every data view. Tokens only, no raw colors
- [ ] Forms: zod schema mirrors contract validation
- [ ] New routes are in nav or `EXTRA_ROUTES`. New cookies are in `clearAllAuthCookies()`
- [ ] Mobile 360 px checked
- [ ] Tests at the right tier. No new lint errors or failing tests vs baseline

## Backend asks
- …

## Risks / open points
- …
