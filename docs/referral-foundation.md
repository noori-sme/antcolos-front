# Referral foundation

## What this adds, and what it deliberately does not

Any authenticated Antcolos user may introduce a person to any company on
Antcolos, whether or not they work there. Sam refers Alex to Northline Freight.
Northline hears about it. Alex hears about it. **Each of them answers
separately, and neither answer is the other's.**

That is the entire feature. It adds exactly one canonical record:

| Record | Answers |
|---|---|
| `Referral` | who introduced whom, to which company, for what work, and what each side decided |

Everything else it touches, it references.

### A `Referral` is not

| It is not | Because that is |
|---|---|
| an `Invitation` | an offer of a SEAT, with a permission snapshot, issued from inside an organization by somebody holding `invitations:create` |
| a `Membership` | access |
| a `WorkforceEngagement` | a working relationship, with a basis, a capacity and a date |
| a `CarrierRelationship` | a driver's operational relationship with a carrier |
| a job offer or an employment agreement | terms, which live in Contracts |
| a `PermissionKey`, a role or an `AppliedTemplate` | authority |
| approval to read a document | the Document Center's, bounded by the person's own consent |
| proof that the person works there | nothing about a referral establishes it |

The check for whether the module has stayed honest is structural, not cultural.
`ReferralsService` has no method that takes or returns a `PermissionKey`, a
`Membership`, an `InvitationDraft`, an engagement or a document id. There is no
`grant`, no `hire`, no `onboard`, no `createInvitation`. The mock implementation
imports no membership store, no permission template, no driver registry and no
document store.

## The proposed title

`Referral.proposedTitle` is **free text**. "Driver", "Dispatcher", "Safety",
"Accounting", "Maintenance", "Fleet Manager", "the guy who fixes the reefers" —
all equally valid.

It is never matched against a permission template, never mapped to an
`InvitationKind`, never written onto a `Membership`, and nothing in Antcolos
branches on it. It reaches the invitation screen as
`ReferralHandoff.proposedTitleContext`, shown as context beside a form where an
authorized person chooses the real engagement type, position, permissions,
agreements and documents.

A test submits `"Owner"` as the proposed title and proves that no template, no
permission and no seat comes of it.

## Three state axes, never one status

There is no single `status` field, and there is not going to be one.

| Axis | Values | Owned by |
|---|---|---|
| `lifecycle` | `submitted`, `withdrawn`, `closed` | the referrer |
| candidate response | `email_pending`, `email_delivered`, `claimed`, `declined`, `reported_unwanted`, `expired` | the candidate |
| company response | `pending_review`, `accepted`, `rejected` | the company |

The first two candidate values and `expired` are **derived** from delivery
evidence and the clock (`candidateStateOf`); the three that are decisions are
stored, because a decision cannot be re-derived. Every presentation — the
referrer's list, the company's inbox, the Needs You item — is derived from the
three axes. A stored roll-up would have to be recomputed on every transition,
and the first time somebody forgot, "Northline passed" and "Alex declined"
would become the same word on a screen.

### Every ordering case, answered

| When | What happens |
|---|---|
| company accepts before the candidate claims | Allowed; nothing changes for the candidate. The claim link keeps working on its own expiry. The company may start the invitation, and the invitation's own flow is what waits for an account. |
| candidate claims before the company accepts | Allowed. `candidateUserId` is written, the account is permanently theirs, and the company's row moves to "Has an Antcolos account" — the only thing it learns. Its review is untouched. |
| company rejects after the candidate joined | The referral closes. The `User` is untouched: there is no code path in this module that deletes, disables or downgrades an account. |
| referrer withdraws before company review | `lifecycle` becomes `withdrawn`, the claim token closes, the referral leaves the pending queue. An account the candidate already claimed is untouched. |
| the email bounces | The email record moves to `bounced` on provider evidence. The candidate state does **not** change — a bounce is not a "no". The company is told nothing: whether a stranger's mailbox exists is not its business. |
| the token expires | Derived, never swept. The link fails closed. The company's review is unaffected, and its next step (the invitation) sends its own link. |
| the target company becomes inactive | New referrals to it are refused at submission. Existing ones are **not** retroactively closed — the introduction genuinely happened. |
| the company later sends an invitation | `resultingInvitationId` is written after `services.access.create` returned one, and the referral closes. Everything after belongs to the invitation. |
| the candidate declines that invitation | That is the invitation's `declined` status, recorded by the access module. The referral stays closed and is not reopened. Two records, two decisions. |

## Reuse — what this did not rebuild

| Needed | Used |
|---|---|
| permanent identity | `User`, `NEWCOMER_USER`, `accountForEmail` in the access store |
| organizations | `MOCK_ORGANIZATIONS` — the one registry, through `organization-lookup.ts` |
| organization lookup | extended `organization-lookup.ts` rather than adding a second directory |
| invitations | `services.access.create` — the canonical command, unchanged |
| invitation acceptance | untouched; the access module's `AcceptanceRun` still owns it |
| onboarding | untouched; Workforce's `onboardingChecklist` still owns it |
| engagements | `liveEngagementFor` — read only, to CONNECT rather than duplicate |
| permissions | `PermissionKey` + the one catalog; **one** new key |
| audit | the one ledger, via `appendAuditEvent` |
| Needs You | `referral-needs-you.ts`, derived, into the one queue |
| mock reset | registered in `mock/registry.ts` |

One new field was added to a canonical record: `Organization.username`, the
verified Antcolos handle. It is one more way to NAME the organization whose id
is already there — not a second identity. Anything that resolves it stores the
`id` and keeps the handle as provenance.

## The one new permission

`referrals:review` — see the company's referral inbox and record whether this
company is interested.

It had to be new. Nothing existing means "triage an introduction":

* `invitations:create` is strictly **stronger** — it hands out access. Gating
  the inbox on it would mean only people who can grant permissions may read a
  name somebody sent in.
* `workforce:view` is about people the organization already has a relationship
  with. A referred stranger is definitionally not one.
* `members:view` is the roster.

It is **one** key rather than a view/decide pair, because the inbox exists in
order to decide and the submitted contact details are the sensitive part of
both. It grants nothing else: accepting a referral still cannot create a seat,
and the handoff into the invitation flow is gated by `invitations:create`
exactly as it always was.

## Privacy rules, and how each is enforced

**Account existence is never revealed.** Not to the referrer, not to the
company, not in a refusal message. `recipient_opted_out` and
`rate_limited_recipient` return the *same sentence* for this reason. A test
submits two referrals identical but for the address — one with an account, one
without — and asserts that every field either side can see is structurally
identical.

**The company sees three values about the candidate's side** —
`not_yet` / `joined` / `declined`. `expired`, `email_pending` and
`email_delivered` all collapse to `not_yet`; `reported_unwanted` reads as
`declined`, so a report never reaches the side best placed to retaliate for it.

**No profile and no documents.** `CompanyReferralView` carries no user id, no
driver profile id, no membership id and no document reference. A test
serializes the view for a person who has driver profiles at two other carriers
and asserts that no `usr_`, `drv_`, `mem_` or `doc_` appears anywhere in it,
before and after acceptance.

**The referrer sees a privacy-safe status and nothing else.** No internal note,
no reviewer identity, no abuse report.

**A referrer cannot edit anybody's permanent record.** `ReferralCandidateContact`
is evidence of what somebody typed. It is never written to a `User` or a
`DriverProfile`, and both the normalized and the submitted forms are kept — the
company is shown what was typed, because showing it a "corrected" phone number
makes a normalization guess look like a fact.

## Abuse controls

| Control | Where |
|---|---|
| rate limit per referrer (10/hour, 25/day) | `REFERRAL_LIMITS` |
| rate limit per recipient address (3/day, 5/week) | `REFERRAL_LIMITS` |
| rate limit per target organization (25/day) | `REFERRAL_LIMITS` |
| one open referral per (candidate, company) | `openReferralFor` |
| resend cooldown (24h) and hard cap (2) | `referrerView().canResend` |
| recipient opt-out, outliving every referral | `optOut` / `hasOptedOut` |
| abuse report, append-only | `recordAbuseReport` |
| confirmation before sending, showing what is shared | `disclose` |
| audit trail on every decision | the one ledger |

Normalization is deliberately conservative: **normalize to match, never to
assert.** Email is lower-cased and trimmed and nothing else — no plus-tag
stripping, no dot folding, because those are provider-specific policies and
applying them merges addresses a mail server considers distinct. A bare
ten-digit phone number is marked `uncertain`, and an uncertain match is treated
as a *different* person. That costs a visible duplicate rather than an invisible
wrong attachment.

## Email

The frontend **queues a record and sends nothing**. `queueEmail` can only ever
produce `queued`. Everything after that arrives through `recordDelivery`, which
is the webhook's shape and is not called by anything on its own.

| State | Meaning |
|---|---|
| `queued` | we intend to send it |
| `sent` | a provider accepted it |
| `delivered` | a provider told us it landed — **only** from provider evidence |
| `bounced` | the address rejected it |
| `failed` | we could not send it |

The email says six things, and `referralEmailContent` says all of them: who
referred them, which company, the proposed title, the secure link, when it
expires, and — the one people leave out — that **the company has not
necessarily accepted them**. Plus the opt-out and report path.

## What the backend must enforce

This repository builds the UI, the typed contracts, the states and executable
acceptance behaviour. It does not, and cannot, provide any of the following.
Every one of them is a requirement, not a nice-to-have.

1. **The claim token.** Minted from a CSPRNG, stored as a hash, compared in
   constant time, single-use, expiring, resolving to exactly one referral. The
   token in this build is `Math.random()` in a browser tab and is readable by
   anything on the page.
2. **Identity.** `ReferringIdentity` must **not** cross the wire. Derive the
   acting identity from the session the server issued and can verify — never
   from a body field, a query parameter, a header the client sets, or the claim
   token. *The token proves which referral, never who is holding it.* The
   addressee match belongs on the server, against the authenticated principal.
3. **Email.** A transactional provider, its credentials, the send, and the
   delivery webhook authenticated by provider signature. The webhook is the
   **only** thing permitted to write `delivered` or `bounced`; a sender never
   writes its own delivery receipt. No credential, token secret, rate limit or
   webhook may live in browser code.
4. **Rate limits.** `REFERRAL_LIMITS`, enforced server-side per referrer, per
   recipient address and per target organization, *before* the email is queued.
   The frontend counts what one tab has seen; a second browser starts at zero.
5. **The duplicate guard.** A unique partial index on
   `(targetOrganizationId, candidateEmail) WHERE still open` — not a read
   followed by a write, which two concurrent requests pass straight through.
6. **Authorization.** `referrals:review` and the organization boundary, checked
   on the server. A referral belonging to another organization answers as
   **missing**, never as forbidden: a forbidden confirms that a referral for
   this person exists at a competitor.
7. **Durable persistence** for referrals, delivery records, abuse reports and —
   above all — the **opt-out list**, which must outlive every referral that
   caused it and must never be readable through any endpoint. A feature that
   could ask "has this address opted out?" can enumerate people one at a time.
8. **Transactional consistency** where two records move together, and honest
   reporting where they cannot.
9. **A durable audit ledger.** This build's is in memory and dies with the tab.
10. **Retention.** Submitted contact details are evidence of an introduction,
    not permanent profile facts. They need a retention period and a disposal
    path, and they must never be promoted into a `User` or a `DriverProfile`.

## Frontend limitations, stated plainly

* Nothing is persisted beyond the browser tab.
* No email is sent, and no token is secret.
* Every permission check runs on the same side of the wire as its caller, so
  none of it is a security property. It is the *shape* a server must implement.
* Rate limits and the duplicate guard do not survive a second browser.
* There is no transaction anywhere in this module.
* `Organization` has no stored "active" flag, so activity is **derived** from
  whether the workspace has an active member. A real system will have a better
  answer.

## One deliberate exception to "unauthorized failures write nothing"

An unauthorized or cross-organization attempt creates no referral, changes no
state, queues no email and issues no invitation — a test asserts each of those.
It **does** append a line to the audit ledger, which is this codebase's existing
and explicit rule: a ledger that needed permission to record that somebody was
refused would lose exactly the events an auditor came for.
