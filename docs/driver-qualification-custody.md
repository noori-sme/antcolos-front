# Driver document custody, qualification files and retention

> **Scope and status.** Nothing in this document is legal advice, and Antcolos
> does not claim compliance with any regulation. Antcolos has **not verified**
> which regulation or retention schedule governs any record category here; that
> verification is outstanding and is listed under *Decisions requiring
> compliance counsel* below. What this document describes is a data-ownership
> boundary and the behaviour built on it, not a compliance product.

## The problem

A carrier that relies on a document when deciding whether to engage a driver
has a business reason to record what it actually relied on. Antcolos already
answered three questions about a driver's licence, and answered them well — and
could not answer the fourth.

| Question | Owner | |
|---|---|---|
| Whose document is it, and what versions exist? | `DocumentRecord` + `lineageId` | ✅ |
| May this carrier **currently view** it? | `DocumentShare` | ✅ |
| What does this carrier **think** of it? | that carrier's `DocumentLink` | ✅ |
| **Which exact version did it receive and rely on, and must it still keep it?** | — | ❌ |

Each existing candidate was tried and each fails for a specific, checkable
reason:

- **`DocumentLink` cannot pin a version.** `replaceDocument` carries live links
  forward onto the new version with the review reset. Correct for access, fatal
  for evidence: a carrier that reviewed v2 would silently read as holding v3.
- **`DocumentShare` is revocable by the driver.** A record the subject can make
  disappear is not a record.
- **`DocumentSharePackage` does pin a version**, but it is the *driver's* record
  of what they handed over, it expires, and it carries no carrier review,
  provenance, purpose or retention.
- **`ComplianceSnapshot`** is per-requirement and taken only at relationship end,
  so it cannot capture what was relied on at the moment of the decision.
- **`DocumentSnapshot`** is deliberately thin: no carrier, no review, no
  retention.

## The model: one stored version, separate custody

**No physical duplication occurs.** Adopting a document creates **zero** new
`DocumentRecord`s, zero new lineages and zero new files. `qualification.test.ts`
asserts the document count before and after. Two carriers relying on the same
version hold two custody records pointing at **one** document — with independent
reviewers, independent retention and no visibility of each other.

Four facts stay separate, and the module exists to keep them apart:

```
A. driver-owned source document + lineage   → the one document store
B. may this carrier VIEW it right now?      → DocumentShare (revocable)
C. this carrier's REVIEW of it              → its own DocumentLink
D. which version it RECEIVED AND RELIED ON  → QualificationRecord  ← new
```

D is not derivable from the others. B is revocable by the driver; C is carried
forward when the driver replaces a file; A is the driver's to change. Only D is
frozen, and only D survives revocation — exactly the asymmetry a carrier's
record-keeping obligation assumes.

### How version pinning works

`QualificationEvidenceRef` stores `{ documentId, lineageId, documentVersion }`
plus a snapshot of the label, file name, status and expiry at adoption. The
`documentId` is a **version**, not a lineage. Nothing moves it: not a
replacement, not a refreshed share, not a relationship ending. Moving to a newer
version is always a second, explicit adoption, and both records stay visible
with the older one marked `superseded_retained`.

The carrier's review is **copied** onto the record at adoption
(`QualificationReviewSnapshot`) rather than referenced live, because the live
link moves on to the next version. It is a copy of a decision, not a second
review system — the review itself remains the Document Center's.

`integrityBasis` is `"not_available_in_mock"` and says so on screen. A frontend
cannot read a file, so it cannot hash one.

### Carrier-originated evidence

An employment application, an ordered MVR, a road test the carrier's examiner
signed: these are `DocumentRecord`s in the **one** Document Center, owned by the
organization, linked in its own context, and never placed in the driver's
editable wallet. `origin` is `carrier_originated`.

## The four explicit steps

Sharing → opening → reviewing → adopting. **None implies the next.**

1. The driver shares a selected, pinned version.
2. An authorized reviewer opens it. *Opening adopts nothing.*
3. The carrier records its own review on its own link. *Reviewing creates no
   engagement, membership or relationship.*
4. The carrier **explicitly adopts** that exact version. Refused outright if no
   review exists (`ReviewRequiredError`) — adopting evidence nobody looked at is
   the one claim a qualification file must never be able to make.

Adoption is idempotent by exact version: a double click, a retry or a second
reviewer produces one record and one history entry.

## Source and verification are never collapsed

Two separate fields, and the service refuses to blur them:

- `source`: `driver_self_provided` | `carrier_generated` |
  `received_from_licensing_authority` | `received_from_testing_provider` |
  `received_from_background_check_provider`
- `verification`: `not_verified` | `carrier_reviewed` | `source_verified`

A driver-uploaded MVR stays `driver_self_provided` after a carrier review, and
the review sets `carrier_reviewed` — **not** `source_verified`. Claiming an
authority source without naming it is refused
(`UnsupportedVerificationClaimError`) rather than silently downgraded, because a
silent downgrade is how a file ends up saying something nobody chose. No
integration in this build performs an official MVR pull, Clearinghouse query,
background check or medical-source verification, and nothing claims one.

## Retention: nothing is asserted, and it fails closed

**This build asserts no retention basis, no period and no date for any record
category.**

Which rule governs a driving licence, a medical certificate, a motor vehicle
record or a drug and alcohol test result depends on the applicable regulation,
the exact record category and the jurisdiction. **Antcolos has not verified any
of those mappings against official regulatory text.** So it states none of them.
Where a basis or a date would go, the product says:

> Retention policy not configured. Antcolos has not verified which regulation
> and retention schedule apply to this record category, so it states neither a
> basis nor an end date. A backend compliance policy supplies both.

An earlier revision of this milestone cited a regulation and assigned each
category a retention basis. Both were written from memory and neither was
checked against a primary source. Deleting the citation while leaving *"kept for
a period from the date it was received"* on screen would have been the same
claim with the footnote removed — so the assignments were removed too.

`QualificationRetentionBasis` survives as a **vocabulary** so a backend has
names to use. Nothing in this build assigns one: every row in
`RETENTION_POLICIES` carries `mappingVerified: false` and no `basis`, and every
record's `retention.basis` is absent.

What the module still records are **observed facts**, which need no regulatory
claim: when a record was received, when the working relationship ended, and when
one adoption superseded another. `relationshipEndedAt` is such a fact — it is
not the start of a period this build claims to know.

The consequences are deliberate and they fail closed:

- With no verified mapping and no backend policy, `retainUntil` is never set.
- So nothing ever reaches `eligible_for_disposal`.
- So **disposal is always refused**. A record whose obligation nobody can
  compute is a record still under obligation.

## Categories this foundation will not hold

Some qualification records carry access rules of their own — who may see a drug
and alcohol testing record, or a driving record obtained for an investigation,
is governed by rules separate from ordinary document access. **Antcolos has not
verified any of those rules**, and this milestone does not build the purpose-
and category-specific access model they would need.

So these categories **fail closed**:

| Category | Why |
|---|---|
| `drug_alcohol_test_result` | testing records carry their own confidentiality and disclosure rules |
| `clearinghouse_query` | part of a testing programme; same unverified rules |
| `background_check` | governed by rules outside transport regulation as well as within it |
| `motor_vehicle_record` | a driving record obtained for an investigation may carry access restrictions separate from ordinary document access |
| `annual_mvr_review` | built on a driving record; inherits the same restrictions |

They cannot be adopted, they are not returned by any read, they are not shown to
the driver, and they raise nothing in Needs You.

**This is deliberately not a permission.** An active Owner receives every
permission automatically, and *"nobody may read this yet"* is not something an
Owner should be able to hold. The check is on the **record category**, on every
path, whoever is asking — `isRestrictedQualificationCategory`, enforced in
`readable()` before any permission is considered.

One write path deliberately still reaches restricted records: moving one into
retention when a relationship ends. That discloses nothing, and without it a
restricted record would read as *active evidence* forever after the driver had
gone.

Lifting a category out of this set needs the access rule designed **and** the
regulatory mapping verified first.

### Disposal

**Disposal is refused unconditionally in this build**, for two independent
reasons that must *both* be answered by the backend:

1. **No verified mapping and no policy** — nothing can establish that an
   obligation has ended.
2. **No enforced legal holds** — `QualificationRetention.legalHold` is typed,
   is read by `isUnderRetention`, and is `false` on every record because
   nothing in this build can set it. A backend that shipped retention dates
   *without* hold enforcement would turn a correct refusal into the disposal of
   evidence a claim or an investigation required to be kept.

**(2) is a mandatory gate, not a nice-to-have.** It is the one most easily
missed, because the field already exists and looks implemented.

The write path is not kept as dead code behind the refusal: when the backend
answers both questions, disposal is written against what it actually supplies.

`qualification:dispose` is a narrow permission, separate from
`qualification:view` because discharging an obligation is a different act from
reading the file, and both are **carrier-only** via the permission catalog's
existing `orgTypes`. There is **no** mandatory two-person rule: a solo Carrier
Owner is one person, and a rule requiring a second pair of hands would leave
them permanently unable to discharge an obligation that has ended. A
configurable two-person disposal policy for larger organizations is a possible
later addition and is not part of this foundation.

What always holds: an obligation that stands refuses disposal, whoever asks. And
disposal appends — the record, its pinned evidence reference and its whole
history survive; only the retention state changes, with who decided, when and
why. The disposal evidence is deliberately non-sensitive and is never a copy of
what was disposed of.

## What a carrier actually retains — and what it does not

This is the boundary most likely to be over-read, so it is stated exactly.

**An adoption record is a record of WHICH version was relied on. It is not the
version.** Everything it holds is metadata: `documentId`, `lineageId`,
`documentVersion`, the type, the label, the file **name**, the status at
adoption, the expiry, and the carrier's own frozen review. Antcolos stores no
file anywhere in this build — `DocumentFileRef` is a name, a type and a size,
and there is no URL because there is nothing to point at. `integrityBasis` is
`"not_available_in_mock"` and carries that gap in the *data*, so no screen can
render it as though the file were held.

**Antcolos does not provide durable evidence custody.** A carrier retaining only
this record could prove *which* version it reviewed and when; it could not
produce the document. That requires the backend.

### Measured behaviour, per event

| After… | Ordinary Document Center read | Adoption record | What is actually retained |
|---|---|---|---|
| Driver revokes the share | **refused** | readable behind `qualification:view` | metadata + frozen review |
| Relationship / engagement ends | **refused** | readable behind `qualification:view` | metadata + frozen review |
| Driver replaces the document | v1 readable while access lasts, marked `superseded` | still pinned to **v1** | metadata for v1, unchanged |

### A correction this verification produced

Revoking a share used to revoke the `DocumentShare` **only**. A recipient that
had reviewed a shared document also holds its own `DocumentLink`, and the
Document Center serves a document to an organization holding *either* — so the
carrier went on reading the document through its review link after the driver
pressed "withdraw". The driver's most consequential control changed nothing they
could see.

`revokeSharePackage` now ends both. The link is **ended, not deleted**
(`endLink` keeps the row, the review and the history), which is exactly what
`endRelationshipDocuments` already did when a relationship ended — the two paths
now agree, and they did not before. The guard checks both access paths: a
still-live share *or* a still-usable package addressed to that organization
keeps access, because a driver who shares the same licence twice produces two
packages and only one grant.

The result is the rule the milestone asked for: **unadopted access ends
outright**, and adopted custody survives — reachable only through the
qualification file behind `qualification:view`, not through ordinary document
access that every dispatcher holds.

## Revocation, relationship ending and offboarding

Five different things, kept apart:

| Action | Effect |
|---|---|
| Driver revokes a share | future share-based access stops; adopted records are kept |
| `CarrierRelationship` ends | the relationship is preserved as ended; profile, documents and history untouched |
| `WorkforceEngagement` ends | retention starts on the carrier's records; nothing deleted |
| Membership suspended/ended | access stops; employment history untouched |
| Retention obligation | outlives all of the above |

The driver is told this in their own words on `/driver/shares`: *"withdrawing the
share stops future access; it does not erase a record the carrier is obliged to
keep."*

## Isolation, and A6

This module adds **no** isolation rule of its own. Reads go through
`record.organizationId` and nothing else. In particular a record is never
readable because it **names** the reader: `driverProfileId` identifies a person
the way `FactScope`'s carrier field identifies a carrier, and A6 settled that
such a field is attribution, never a grant.

Carrier A cannot read Carrier B's adoption, review, retention reason or DQ
evidence — an id from another organization answers exactly as an invented one,
and the attempt is recorded in the one ledger.

**What the driver may see** (product decision): that a carrier adopted a
specific version, the general purpose, the adoption date and the retention
status. **Not** the carrier's review, its reviewer, its notes, any risk
assessment or any other organization-private content. `DriverVisibleAdoption` is
built field by field rather than by redacting the record, so a field added next
year is private by default instead of leaking on the day it lands.

## What the frontend mock demonstrates

Version pinning · independent per-carrier custody and review · adoption state ·
retention basis and state transitions · organization isolation within the mock ·
refusals (no review, no obligation ended, wrong permission, unsupported source
claim) · idempotency · Audit and Needs You behaviour.

## What requires the backend

**Durable evidence custody**, which this build does not provide and does not
claim: the stored object itself, kept so that it survives the driver replacing
or deleting their copy · durable encrypted object storage · content hashing and
byte-level integrity taken over that object ·
immutable version storage with reference counting so a driver removing a
document from their active wallet does not destroy an object a carrier must
retain · retention locks and legal holds · record-specific, jurisdiction-aware
retention schedules · server-side authorization · durable audit · deletion and
disposal jobs · secure access to retained records after a relationship ends ·
official MVR, Clearinghouse, testing-provider and medical-source integrations ·
and a compliance review of the applicable federal and state rules.

## This is not a compliant DQ-file system

Nothing here is legal advice, and Antcolos does not claim FMCSA compliance. What
this milestone delivers is the *boundary*: one stored version, separate driver
ownership and carrier-specific custody, and a retention model a backend can
enforce a real policy through.
