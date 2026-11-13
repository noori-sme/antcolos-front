# 13 — Rate Con upload, review and approval on the real API (F1.1)

```
Status:   approved with defaults (2026-11-13; owner: "implement with your recommended solution while I am away")
Phase:    0 / 5 — planned
Branch:   feat/loads-rate-con-approve (same name as the backend branch; backend is stacked
          feat/loads-review-api → feat/loads-rate-con-approve, neither merged yet)
Requirements: docs/requirements/rate-con-intake.md
Backend contract: ../antcolos/docs/requirements/documents-api-contract.md §1–§10
Updated:  2026-11-13
Track:    Feature (new route, new permission key, new http domain)
```

## Summary

`/rate-cons/new` (today a placeholder) uploads a Rate Con; `/rate-cons/[documentId]` shows the
document beside its extracted fields in review order, takes confirm/correct decisions,
completes the review, previews the load and approves it. All real API, http-only like trucks
(no mock: the screens call the backend in both modes). The legacy demo review at
`/dispatch/rate-confirmations/*` stays as it is.

## Endpoint status (backend branches, checked 2026-11-13)

| Endpoint | In contract | On backend main | Adapter |
| --- | --- | --- | --- |
| `POST /documents/rate-confirmations`, `GET /documents/:id`, `/file`, `POST /extractions` | §1–§5 | yes (plan 20) | http |
| `GET /documents/:id/review`, `POST …/review/decisions`, `POST …/review/complete` | §6–§8 | no: `feat/loads-review-api` | http |
| `GET /documents/:id/load-draft`, `POST /documents/:id/approve` | §9–§10 | no: `feat/loads-rate-con-approve` | http |

Merge order: backend plan 21 → plan 26 → this. Until then the review/approve calls 404 on
staging; the screen shows the error state (no fallback to mock).

## Decisions (defaults)

1. **New feature folder** `src/features/rate-con-intake/` and domain `rateConIntake`; the
   legacy `rate-confirmations` demo is untouched (different workflow: outbound signing).
2. **New permission key** `documents:review` ↔ backend `document.review` (catalog entry,
   alias, `migrateKey`), added to the mock Admin and Dispatcher templates so demo users keep
   the `/rate-cons/new` entry from Home.
3. **PDF display**: native viewer in an `<iframe>` with `#page=N`; box overlay only for images
   (no `pdfjs-dist`: adding it changes `package-lock.json`, which needs owner approval).
4. **Client validation mirrors the backend**: a pure `src/lib/rate-con/` module (formats, path
   labels) with tests; the zod schema uses it.
5. **Errors**: the interceptor's `Error(message)` is shown as is; 409 conflicts on decisions
   refetch the review. No typed `ApiError` needed.
6. **Polling**: `refetchInterval` 2.5 s on the document while the latest run is
   `PENDING`/`RUNNING`, then the review query is enabled.
7. **Idempotency**: one `crypto.randomUUID()` per user intent (per upload file, per decision
   batch, per complete/approve click), kept in a ref and reused on retry of the same intent.

## Files

| File | New/changed | Why |
| --- | --- | --- |
| `src/types/rate-con-intake.ts` (+ `src/types/index.ts`) | new | canonical types |
| `src/lib/api/contracts/rate-con-intake.ts` (+ `contracts/index.ts`) | new | service interface |
| `src/lib/api/http/rate-con-intake.ts` + `.test.ts` | new | adapter + mappers (fixtures from the contract) |
| `src/lib/api/http/index.ts`, `src/lib/api/index.ts` | changed | register http-only domain |
| `src/lib/rate-con/fields.ts` + `.test.ts` | new | path labels, correction formats |
| `src/lib/permissions/catalog.ts`, `templates.ts` | changed | `documents:review` |
| `src/lib/permissions/route-manifest.ts` | changed | `/rate-cons/*` gates |
| `src/features/rate-con-intake/hooks.ts` | new | queries + mutations (org-keyed) |
| `src/features/rate-con-intake/upload-screen.tsx` | new | upload |
| `src/features/rate-con-intake/review-screen.tsx`, `document-pane.tsx`, `field-list.tsx`, `field-row.tsx`, `load-preview.tsx` | new | review (split, each < 400 lines) |
| `src/app/(app)/rate-cons/new/page.tsx` | changed | render the upload screen |
| `src/app/(app)/rate-cons/[documentId]/page.tsx` | new | render the review screen |
| `tests/browser/rate-con-intake.spec.ts` | new | route gate + upload screen at 360 px |
| `docs/architecture/ARCHITECTURE.md` §5, `docs/roles-and-permissions.md` | changed | domain status, key |

## Phases

### Phase 1 — types, contract, adapter, pure rules
- Types, contract, http adapter (`toRateConDocument`, `toDocumentReview`, `toLoadDraftView`,
  `toApprovalResult`), `src/lib/rate-con/fields.ts`.
- Tests: mapper tests on contract §2/§6/§9/§10 examples; field label + correction format tests.
### Phase 2 — hooks and query keys
- `rateConKeys` under `orgKey`; `useRateConDocument` (polling), `useDocumentReview`,
  `useLoadDraft`, `useDocumentFileUrl`; mutations upload / retry / decide / complete / approve,
  each invalidating `[...orgKey, "rate-con", id]`.
### Phase 3 — screens
- Upload; review (document pane, fields, load preview) with loading / empty / error / success,
  `<Can>` gates, 360 px layout.
### Phase 4 — routes, permissions, browser spec
- Pages, manifest, catalog key + alias + templates, `tests/browser/rate-con-intake.spec.ts`.
### Phase 5 — docs
- ARCHITECTURE §5, roles-and-permissions, requirements → implemented, this plan.

## Invariant checklist
- [x] No `apiClient` outside `src/lib/api/http/**`
- [x] Query keys under `orgKey(org)`; mutations invalidate the document's prefix
- [x] Gates on `documents:review`, `loads:create`, `loads:edit`; no role checks
- [x] Types follow contract §1–§10; mapping in the adapter with tests
- [x] Stable `Idempotency-Key` per intent
- [x] Four states per view; tokens only
- [x] Correction validation mirrors the backend formats
- [x] Routes in `EXTRA_ROUTES`; no new cookies
- [x] Mobile 360 px in the browser spec
- [x] Tests at unit (mappers, rules) and browser (gate) tier

## Backend asks
- Optional: page images for PDF highlight boxes (`GET /documents/:id/pages/:n`), or approval for
  `pdfjs-dist` here.

## Risks / open points
- The review/approve routes exist only on unmerged backend branches; merge them first.
- No live end-to-end run against a backend in this session unless the backend runs locally.
