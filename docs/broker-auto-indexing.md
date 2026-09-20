# Automatic broker profiles from rate confirmations

## What this adds, and the rule it had to argue with

The Directory already turned a rate confirmation into a set of *proposals* a
dispatcher confirms. It refused, emphatically and in three separate files, to
create a party profile on its own:

> A rate confirmation that created a broker profile on its own is precisely how
> a carrier ends up with four profiles for one broker.

That rule was right, and it is still right for almost everything on the
document. This milestone carves out one case where the reasoning behind it does
not apply, and refuses everything else.

## Why brokers, and only brokers

The duplicate problem is a problem of **soft evidence**. Shippers and receivers
are matched on names and addresses — "Blue Ridge Foods" at "1200 Industrial
Blvd" — and those resemble each other across genuinely different companies. Two
documents about one dock routinely look like two docks, so nothing can be
created from them safely.

A broker is different in kind, not in degree. An MC number is issued once, by an
authority, to one company, and `src/lib/directory/matching.ts` already treats it
as **decisive**: a match on it cannot be outvoted by any accumulation of soft
signals, and a mismatch eliminates a candidate outright rather than lowering its
score. A broker block carrying an MC number is not a guess — it is an identity.

So the scope restriction is not a policy setting that could later be relaxed to
shippers. It is the whole safety argument.

## The asymmetry that keeps it safe

The two questions the gate asks use deliberately different standards:

| Question | Standard | Why |
|---|---|---|
| May I **create**? | **Decisive** evidence only — a normalized MC number, or nothing happens | A created duplicate is permanent and has to be merged by hand |
| Should I **abstain**? | **Any** resemblance at all — `possible`, not merely `strong` | Abstaining costs nothing: the block falls through to the review queue, which is the current behaviour |

The failure mode of being wrong is therefore always "a dispatcher confirms it by
hand, as they do today", never "the directory grew a second profile for TQL".

A broker printed with only a name — no MC number — is **not** auto-created. It
goes to the review queue exactly as it does now. That is a deliberate narrowing
of "if one does not already exist for that MC# or Name": creating from a name
alone is the duplicate case.

## What an auto-indexed record is, and is not

It is born with all three of these true at once, and they are different facts:

| Field | Value | Meaning |
|---|---|---|
| `provenance.kind` | `rate_confirmation_auto` | No person was in the loop |
| `verification.state` | `unverified` | Nothing was checked against FMCSA |
| `claim.state` | `unclaimed` | The brokerage has no account here |
| `status` | `provisional` | No person has confirmed it |

**Verification and claiming are not the same question**, and collapsing them
produces a badge that means two things at once and therefore nothing.
`PartyVerification` asks whether anybody checked the **data**. `PartyClaim` asks
whether the **company** has an account on Antcolos and proved the record is
theirs. Every combination is real: an FMCSA-verified profile can be unclaimed,
and a claimed profile can have an address nobody has checked.

It also does **not**:

- link the load — that is carrier-private and still needs a person;
- create a facility, a contact, a standing, a rating or a note;
- claim anything about the brokerage's quality. Antcolos has indexed their
  operational activity; it has not vouched for them.

## Claiming confers no access

`PartyClaim.claimedByOrganizationId` records that a brokerage proved a record is
theirs. It grants them nothing over any carrier's data. Everything
carrier-private — standing, rating, payment experience, notes, load links —
lives on `CarrierPartyRelationship`, partitioned by carrier organization at the
store, and nothing in the read path takes a parameter that would let a claimant
reach it.

## Where an auto-indexed broker shows up

This surprised us, so it is written down: `visibleParties` lists the companies a
carrier has a **relationship** with, and auto-indexing creates no relationship.
So a freshly indexed broker is:

- a **canonical record** immediately, which is what stops the next rate
  confirmation duplicating it, and what makes the review screen propose
  *linking* rather than *creating*;
- **not yet in any carrier's directory**, until that carrier links a load to it
  in Directory → Review — at which point the existing `commitResolution` creates
  the relationship, exactly as it does today.

That is the honest boundary: the shared company record is public-register
shaped, and the carrier's directory is a list of who they actually work with.

## Where the code is

| Concern | File |
|---|---|
| The gate, pure and storeless | `src/lib/directory/auto-broker.ts` |
| Claim and provenance types | `src/types/party.ts` |
| The write | `autoIndexBrokers` in `src/lib/api/mock/party-registry.ts` |
| The hook on every rate con | `directoryProjection` in `src/lib/api/mock/projections/load-finalized.ts` |
| Badge and labels | `src/features/directory/directory-chips.tsx`, `directory-labels.ts` |

## ███ FRONTEND ONLY ███ — what the backend still owes this seam

- **A uniqueness constraint on the normalized MC number.** The gate abstains on
  any resemblance, but two rate confirmations processed concurrently could both
  pass it. A database is the only place that race can actually be closed.
- **Real FMCSA verification.** Nothing here checks an MC number against the
  register; the number came off the broker's own paperwork. Only a check against
  the issuing authority may ever produce `externally_verified`, and no code in
  this module can write that value.
- **The claim flow itself.** `PartyClaim` models the states and the proof
  methods; there is no screen, no code delivery and no `claimParty` command on
  this branch. `claim_pending` and `claimed` are reachable only by a fixture.
- **A notification to the brokerage.** A company that has been indexed has no
  way to find out. That is a product decision with legal shape to it, not a
  refactor.
- **Rate limiting and abuse control.** Anybody who can sign a rate confirmation
  can cause a record to be created. The gate bounds what gets created; it does
  not bound how often.
