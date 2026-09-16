# Driver Document Wallet & Controlled Sharing

What this milestone builds, what it deliberately does not, and what a backend
owes the seam before any of it may be called secure.

## The ownership model

One document, three separable facts:

| Fact | Where it lives | Who owns it |
| --- | --- | --- |
| The document | `DocumentRecord` (`documentId` = version, `lineageId` = the document across versions) | The driver: `owner.kind = "person"`, `organizationId` absent |
| "This carrier may see it" | `DocumentShare`, basis `driver_share` | The driver, revocable |
| "This carrier thinks it is acceptable" | `DocumentLink.review` on **that carrier's** link | That carrier only |
| "These exact versions went to this recipient, for this reason, until this date" | `DocumentSharePackage` | The driver |

A share never copies a record, never changes its owner, and never writes to the
driver's own link. Ending a carrier relationship ends that carrier's link and
its grants; the driver's record and their own link are untouched.

## Lifecycles

**Native (carrier on Antcolos)**
`issued → opened → (revoked | expired)`. On creation the package also mints one
`DocumentShare` per lineage to the recipient organization. The carrier reads it
through its own organization context; its review is written to its own link.

**External (not on Antcolos)**
`delivery_pending → delivered (mock) → opened → (revoked | expired)`, with
`failed` reachable when the mock delivery is rejected. Access is by opaque
token to `/shared/[token]`, which shows only the pinned versions in that package.
No organization, membership or relationship is created for an email address.

## What is real in this build

Selection, version pinning, scoping to the selected documents, expiry,
revocation, refusal reasons, access counting, per-carrier review, the audit
projection and the watermark on the presented copy are all enforced in the
browser runtime and covered by tests.

## What is NOT real, and must not be claimed

- No durable or encrypted document storage. "Upload" records a file name, type
  and size; the file itself is discarded.
- No real email. Delivery is a recorded intent, labelled "mock delivery".
- No authenticated external recipients, and no token hashing. `mintToken` uses
  `Math.random`; it is not a security primitive.
- No malware scanning, no OCR, no source verification of any kind. A
  driver-uploaded MVR is a self-provided document, never an ordered background
  check.
- No durable expiry jobs, no durable access logs, no rate limiting, no
  legal e-signature, and no backend-enforced uniqueness or authorization.
- Nothing survives a page load.

## Backend requirements

1. **Encrypted object storage** for the files themselves, with per-object keys
   and no public URLs.
2. **Short-lived, single-purpose access tokens**, stored only as hashes, scoped
   to one package, and revocable server-side.
3. **Authenticated and authorized APIs** for every read: the native path must
   resolve the recipient organization from the session, never from a parameter.
4. **Email delivery with bounce and complaint handling**, feeding the package's
   delivery state; webhook callbacks verified by signature and idempotent by
   delivery id.
5. **Server-side expiration and revocation enforcement**, not client-derived
   state.
6. **Malware scanning** before any file is served to a recipient.
7. **Durable audit** of issue, delivery, open, refusal, review and revocation,
   written where the existing ledger lives rather than beside it.
8. **Retention and deletion** rules: how long a revoked package's history is
   kept, and what a deletion request removes.
9. **Download controls and rate limiting** on the external view, including
   per-token request budgets.
10. **Watermark rendering** applied server-side to image previews, PDF previews
    and any downloaded copy — the values come from `watermarkFor`, and the
    canonical original is never modified.

## Watermark

`src/lib/documents/watermark.ts` computes four values: the brand line
`Powered by Antcolos`, the intended recipient, the share date and a short
derived reference (`SH-XXXXXX`). The reference is a hash of the package id, not
a substring of it, and no token or internal identifier appears in the mark.

In this build the mark is rendered by `SharedDocumentCard` on the presented
copy. No file exists to stamp, and the card says so rather than implying a
watermarked PDF was produced.
