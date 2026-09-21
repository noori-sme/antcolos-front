# Factoring Check — what is built, and what a backend still owes

> ███ **ANTCOLOS IS NOT CONNECTED TO A FACTORING COMPANY.** ███
>
> There is no confirmed production API access from OTR, RTS, Triumph, Apex or
> anybody else. Nothing in this slice contacts a factor. Every result it can
> produce came from an authorized export a carrier imported, a provider
> response a person recorded with evidence, or the labelled development
> adapter — and every result says which.

## The one idea

A factoring result is **not a fact about a broker**. "TQL is approved" is not a
sentence that can be true. What can be true is:

> Northline Freight's factor, OTR, on account NL-4471, said on Tuesday at 14:02
> that it would fund up to $12,000 against MC-1142908, and that answer is good
> until Friday.

Every clause of that is a field on `BrokerFactorabilityCheck`, and none of them
is scaffolding:

| Take away | And this breaks |
|---|---|
| the carrier | competitors who use different factors merge into one answer |
| the account | two factors' contradictory answers merge into one |
| the time | last month's approval reads as today's |
| the source | a dispatcher's phone call is indistinguishable from an API response nobody made |
| the amount | an approval for $2,000 is read as an approval for $20,000 |

So the partition key is `carrierOrganizationId`, exactly as it is on
`CarrierPartyRelationship` — the same pattern the directory already uses to keep
one carrier's standing, rating and payment experience out of another's view.
Apex Logistics is approved for Northline and refused by Baxter's factor, and
both are true at once.

## Decision states

Ten, and four of them are load-bearing precisely because they are **not**
refusals:

```
approved_live  approved_imported  approved_manual  conditional  rejected
pending        unknown            stale            not_connected
               provider_unavailable
```

`unknown`, `stale`, `not_connected` and `provider_unavailable` all mean
"Antcolos does not have a current answer". Collapsing any of them into
`rejected` would put a refusal in a broker's file that no factor ever made, and
a carrier would stop calling a broker who was never turned down. Collapsing them
into an approval is the opposite failure and worse. `isFactoringUnanswered()`
and `isFactoringApproved()` are exported so nothing anywhere re-derives this by
matching on a string prefix.

The three approvals stay apart because "the API said yes", "your factor's
spreadsheet said yes last Tuesday" and "Marta rang them and wrote it down" are
three different levels of evidence, and a booking screen has to be able to say
which one it is holding.

## Expiry is resolved at read time

There is no scheduler on a frontend. An approval that lapsed at 03:00 has to
read as stale at 03:01 — so the **stored** decision never changes, and
`factoringStatusSync` derives the current one from `expiresAt` and the clock on
every read. `FactoringStatusView.recordedDecision` keeps what the factor
actually said, so a stale row can still say what was approved and when.

There is no window in which a screen shows a lapsed approval, because there is
nothing that has to have run.

## Where it lives in the workflow

**Factoring is not an MT Loop stage, lane, page or ceremony.** It is an
eligibility check inside Search and Opportunity evaluation, exactly like
deadhead or hours of service, and `tests/factoring-search-workflow.test.ts`
asserts that no stage or lane is named after it.

- Every discovered load with an identified broker MC is evaluated against the
  factoring connection belonging to **the carrier the truck runs under** — never
  the workspace reading the screen. A dispatch agency covering two carriers sees
  two different answers about one broker on one screen, and both are right.
- With an **automatic** connection the check runs in the background
  (`useAutomaticFactoringChecks`) and there is **no button** — the status is
  simply on the row.
- Without one there is exactly **one** contextual button, "Check with
  factoring", which opens the carrier's own configured fallback (credit-check
  email, the factor's portal, the credit desk's phone) prefilled with the
  carrier and its MC, the factoring account, the broker and its MC, the load
  amount, the opportunity id, the dispatcher and the previous answer.
- Search and the Opportunity list read the **same canonical record**. Recording
  a fallback answer updates both and creates no second decision.

## Connection modes

| Mode | Automatic? | Live API? | What it is |
|---|---|---|---|
| `mock_adapter` | yes | **no** | Deterministic development adapter, labelled everywhere it renders |
| `import` | no | no | An authorized debtor/credit export the carrier downloaded itself |
| `email` | no | no | A structured credit-check email; a person records the reply |
| `manual` | no | no | A person checked the portal or rang the desk |
| `api` | yes | yes | **Reserved.** No factor has authorized Antcolos, so it always reports `provider_unavailable` |

`FACTORING_MODE_IS_AUTOMATIC` and `FACTORING_MODE_IS_LIVE_API` are two separate
maps on purpose: the mock adapter answers by itself and is emphatically **not**
live, and that distinction is what the booking confirmation states out loud.

## Permissions

Four new keys in the one catalog — not a second permission system:

- `factoring:view` — see the answer, its age and its conditions
- `factoring:check` — run a check, or record what the factor said
- `factoring:manage` — connect the account, import the list, set the policy
  (**carrier organizations only**)
- `factoring:override` — book past a block, with a reason

Why none of them is an existing key: `customers:view` is held by every
dispatcher and reaches the directory, and a factor's credit limit is a carrier's
banking relationship rather than a directory field. `invoices:view` is about
invoices this carrier has already raised, which a factoring check precedes by
days. `integrations:manage` connects outside *tools*; the person who wires up
Telegram is not thereby the person who changes who gets paid.

Every key is narrowed again by the **carrier boundary**: holding
`factoring:view` in a dispatch organization reaches only the carriers that
granted it dispatch authority (read from the same `TruckDispatchAccess` grants
that decide whether it may book a load), and administering an account is never
delegated — a carrier that hands over its trucks has delegated dispatch, not its
banking.

## Import

Preview → commit, the same shape `ImportService` already uses, and for the same
reason: the rows a person has to look at are exactly the ones a single "Import"
button would hide.

- **Match on the MC number.** A row with no MC never attaches to a broker,
  however confident the name looks.
- **Never mint a broker.** An MC the carrier's directory does not know stays
  unmatched and goes to review.
- **Idempotent.** The batch's identity is a hash of its rows, so the same file
  staged twice resumes the same batch and a committed row produces nothing on a
  second run — which is what makes a half-finished commit resumable.
- **Supersede, never delete.** A newer file's answer stands the older one down
  and points back at it, so a carrier can see that Tuesday's list said approved,
  Thursday's said rejected, and which one a Wednesday booking was made on.
- **Expired results become stale, not rejected.**

Unrecognised status words become `unreadable` and go to a person. They do **not**
fall through to `rejected`, which would turn every unfamiliar export dialect
into a wall of refusals no factor ever issued.

## Nothing is ever invented

`creditLimitCents` and `availableAmountCents` are written only when a provider,
an import row or a person supplied them. An empty column produces **absent**,
never zero — a rendered "$0 limit" is a statement about a broker that nobody
made. The same holds for `reason` and `conditions`: they are the factor's own
words, and Antcolos never composes one.

## Booking

`canBook` carries a `FactoringBookingGate`, evaluated against the carrier on the
loop. The confirmation screen shows the decision, the source, the freshness and
— when nothing was re-asked — a sentence saying so, because a confirmation that
implied a live recheck when a person read a spreadsheet on Tuesday is the exact
dishonesty this module exists to avoid.

`requireApprovalToBook` is **off by default**, and that is deliberate: Antcolos
cannot yet perform the check on its own, so a carrier that has never opened the
settings screen must not find its freight un-bookable. Turning it on is one
switch. An override needs `factoring:override`, the carrier's policy permitting
it, and a typed reason — and it writes exactly one audit event, in the one
ledger, which nothing can edit or remove.

## No credentials, anywhere

There is no field on any record in this module that can hold a provider
password, token, cookie, portal session or API key. `accountReference` is the
client number printed on the carrier's own statements — an identifier, not an
authenticator. `FACTORING_FORBIDDEN_FIELDS` lists the names that may never
appear, and `src/lib/api/mock/factoring.test.ts` walks every serialized
connection, check, batch, policy and prefill against it, so a future field
called `portalPassword` cannot be added quietly.

**Permanently excluded**, not unimplemented: portal scraping, headless-browser
automation, CAPTCHA handling, and storing a carrier's factoring login.

## What the backend still owes

1. **Provider authorization on the server.** No method on `FactoringService`
   takes a credential and none may be added: a browser must never hold a
   carrier's factoring token or portal password.
2. **Encryption at rest** for credit limits, rejection reasons and account
   references. They are a carrier's banking relationship, not metadata.
3. **Durable, append-only storage** keeping the supersession rule: a newer
   answer replaces an older one and neither is edited.
4. **Server-side enforcement** of every permission and of the carrier boundary.
   The checks in the mock are user experience; they are not security.
5. **Audit retention** for override events — the only record of a person
   deciding to take a risk the organization's own policy refused.
6. **Provider-specific rate limiting.** A credit check costs the carrier money
   with most factors, and a search screen that checked on every render would
   spend it. `useAutomaticFactoringChecks` is deliberately stingy for the same
   reason, but a client-side guard is not a rate limit.
7. **A real authorized integration** before anything renders `approved_live`.

## Files

| Concern | File |
|---|---|
| Types, labels, forbidden-field list | `src/types/factoring.ts` |
| Service contract, and what a backend owes | `src/lib/api/contracts/factoring.ts` |
| Store, carrier gate, read-time expiry | `src/lib/api/mock/factoring-registry.ts` |
| Provider adapters (mock + reserved API) | `src/lib/api/mock/factoring-adapters.ts` |
| Import: preview, commit, supersession | `src/lib/api/mock/factoring-import.ts` |
| Service, audit projection, booking gate | `src/lib/api/mock/factoring.ts` |
| Pure filter and policy helpers | `src/lib/factoring/index.ts` |
| Chip, filter, fallback panel, booking panel, settings | `src/features/factoring/` |
| Service tests (15 claims) | `src/lib/api/mock/factoring.test.ts` |
| Workflow tests (10 claims) | `tests/factoring-search-workflow.test.ts` |
| Browser tests | `tests/browser/factoring-check.spec.ts` |
