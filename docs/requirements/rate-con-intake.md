# Rate Con intake: upload, review, approve (F1.1)

```
Status:   implemented (2026-11-13, plan 13; agreed owner: "plan them … implement with your recommended solution while I am away")
Backend:  ../antcolos/docs/requirements/documents-api-contract.md §1–§10 (plans 20, 21, 26)
          ../antcolos/docs/requirements/documents.md (rules)
Milestone: F1.1 (../antcolos/docs/product/milestones.md)
```

## Goal

A dispatcher uploads a broker's Rate Confirmation, watches it being read, reviews the extracted
fields beside the document (riskiest first), confirms or corrects them, completes the review,
sees the load that will be written, and approves it into a load. Nothing is typed twice: the
load comes from the reviewed fields.

## Screens

### 1. Upload — `/rate-cons/new`

- File picker (PDF, JPEG, PNG, WEBP; size limit from the contract's 413), optional "replaces an
  earlier version" is out of scope for F1.1.
- Submit uploads (`POST /documents/rate-confirmations`, one Idempotency-Key per chosen file)
  and opens the review screen for the new document.
- States: idle, uploading (button disabled), error (message from the API: wrong type, too
  large, unreadable).

### 2. Review — `/rate-cons/[documentId]`

Two panes on desktop (document left, work right); stacked on mobile (360 px), document first,
collapsible.

**Document pane.** Signed URL (`GET /documents/:id/file`, refreshed when it expires).
- Images: the image, with the active field's box drawn over it (box fractions × rendered size).
- PDFs: the browser's PDF viewer, jumping to the active field's page (`#page=N`). No box
  overlay for PDFs in F1.1 (no PDF renderer in the bundle; see Backend asks / Risks).
- 503 `STORAGE_NOT_CONFIGURED`: a notice instead of the document; the review still works.

**Status header.** Document status, file name, extraction run state. While the run is
`PENDING`/`RUNNING`, poll the document every 2.5 s and show "Reading the Rate Con…".
`FAILED` → error with "Try again" (`POST …/extractions`), gated by `documents:review`.

**Fields** (`GET /documents/:id/review`), in the server's order; never re-sorted.
- Grouped visually by tier (High / Medium / Low) with counts from `summary`.
- Each row: label for the path (e.g. "Pickup 1 · City"), current value, predicted value when
  corrected, confidence, status chip (Unreviewed / Confirmed / Corrected), "Needs confirmation"
  for `requiresConfirmation` fields still `UNREVIEWED`.
- Hover or focus on a row makes it active (highlight in the document pane).
- Actions per row: Confirm, Correct (inline editor with the contract's formats: money
  `2500.00`, date picker `YYYY-MM-DD`, time `HH:mm`, currency 3 letters, broker MC digits; empty
  = "not on the document"). "Confirm all remaining high-risk fields" sends one batch.
- After the document is `REVIEWED`, rows stay editable (the API allows it) until `ACCEPTED`.
- 409 `FIELD_REVIEW_CONFLICT` / `FIELD_NOT_CURRENT` → message "Someone changed this; reloaded"
  and refetch.

**Complete review.** Button enabled when `summary.canComplete`; otherwise shows how many
high-risk fields are left.

**Load preview** (`GET /documents/:id/load-draft`), shown once the document is `REVIEWED`:
create vs update (with the matched load), broker, equipment, rate, stops with local dates and
windows, warnings, missing values with "Fix in review" (focuses the first listed path's row),
`problems`. **Approve** (`POST …/approve`) enabled when `canApprove` and the caller holds
`loads:create` (and `loads:edit` for an update); otherwise disabled with the reason. Success:
toast and a link to the load (`/loads/[id]`).

`ACCEPTED`: read-only fields, "Approved into load …" banner with the link.

## Permissions

| UI key | Backend | Where |
| --- | --- | --- |
| `documents:review` (new) | `document.review` | both routes, every review action |
| `loads:create` | `load.create` | Approve |
| `loads:edit` | `load.update` | Approve when the draft updates a matched load |

## API mapping

| UI | Endpoint |
| --- | --- |
| Upload | `POST /documents/rate-confirmations` (multipart, idempotent, 202) |
| Status / poll | `GET /documents/:id` |
| Document | `GET /documents/:id/file` |
| Retry | `POST /documents/:id/extractions` (idempotent, 202) |
| Fields | `GET /documents/:id/review` |
| Confirm / correct | `POST /documents/:id/review/decisions` (idempotent) |
| Complete | `POST /documents/:id/review/complete` (idempotent) |
| Load preview | `GET /documents/:id/load-draft` |
| Approve | `POST /documents/:id/approve` (idempotent) |

## Acceptance

1. A dispatcher with `documents:review` uploads a PDF and lands on its review screen, which
   polls until the run finishes, then lists fields high-risk first.
2. Hovering a field jumps the PDF to its page; on an image the field's box is outlined.
3. Correcting a field rejects a value the API would reject (same formats) before sending.
4. "Confirm all remaining high-risk fields" then "Complete review" moves the document to
   Reviewed, and the load preview appears.
5. Approve is disabled with the reason while values are missing, or without `loads:create`.
6. Approve creates the load and links to it; the screen turns read-only.
7. Without `documents:review` both routes show the 403 screen. Works at 360 px.

## Out of scope

Supersede (new version) upload, a Rate Con list page, the legacy demo review at
`/dispatch/rate-confirmations/*` (unchanged), PDF box overlay (follow-up).

## Backend asks

- Optional, for the PDF overlay: page images (`GET /documents/:id/pages/:n.png`), since the
  backend already rasterizes PDFs for OCR; or approval to add `pdfjs-dist` to the frontend.
