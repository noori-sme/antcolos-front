# Broker identity, authority and claiming

## The model

A broker profile on Antcolos is a **permanent canonical record** that may remain
unclaimed for years. A rate confirmation does not create one. It *discovers a
candidate*, and the candidate becomes a profile only when the FMCSA authority
service confirms who the MC number belongs to.

```
Rate confirmation  ──▶  BrokerObservation        (always, with provenance)
                              │
                              ▼
                        FMCSA authority service
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
   confirmed             not_found             unavailable
        │                     │                     │
   canonical profile     observation           observation
   from the REGISTER     stays conflicted      stays pending
```

## Three axes, never one badge

| Axis | Values | Answered by |
|---|---|---|
| **Identity** | `verified` · `pending` · `conflicted` | FMCSA, and nothing else |
| **Ownership** | `claimed` · `claim_pending` · `unclaimed` | Proof of control |
| **Authority** | `active` · `inactive` · `revoked` · `unknown` | FMCSA, and it changes over time |

Every combination is real. **"FMCSA verified, unclaimed, authority active" is
the ordinary state of a good broker who has never heard of Antcolos** — it is
permanent, correct, and not a review item. "Claimed, identity pending" is
somebody who signed up before we could resolve their MC. "Verified, claimed,
authority revoked" is a broker to stop hauling for today.

**An unclaimed profile is never labelled unverified.** That was the specific
error this revision corrects.

## Layers of fact, kept apart

| Layer | Written by | Editable by |
|---|---|---|
| `broker.official` | The FMCSA authority service, on lookup | **Nobody.** Not a dispatcher, not the broker, not a rate confirmation |
| `BrokerObservation.reported` | A rate confirmation, append-only | **Nobody.** There is no update and no delete in the module |
| `broker.selfReported` | The organization that claimed the profile | That organization only |
| `CarrierPartyRelationship` | Each carrier, about its own experience | That carrier only |

`BrokerSelfReportedInput` has no `legalName`, `mcNumber`, `dotNumber` or
`address` field. A broker cannot overwrite an official value because **no input
reaches one**, not because a guard clause refuses.

## The lifecycle, step by step

1. **Extract.** The broker's reported name, MC number and contact details come
   off the rate confirmation.
2. **Preserve.** They become a `BrokerObservation` with full provenance — the
   document, the load, who recorded it and for which organization. This happens
   whatever comes next, and the row is never rewritten.
3. **Resolve.** The normalized MC number goes to the authority service.
4. **Confirmed** → create or reuse **one** permanent canonical profile,
   populated from the *register's* fields; `identity.state = verified`;
   `claim.state = unclaimed` until somebody proves control.
5. **Unavailable, not found, or conflicting** → **no second canonical broker**.
   The observation is retained in `pending_authority` or `conflicted` and must
   be resolved before it attaches to anything.
6. **Always the same profile.** Every later rate confirmation, load, payment
   record and communication for that MC number resolves to the same canonical
   record. The MC number is the key precisely so this is structural.
7. **Joining later** attaches an organization to the *existing* profile.
   `claimBrokerProfile` has no code path that creates one.
8. **Claiming erases nothing** — not an observation, not a carrier's private
   records, not the provenance. It writes exactly one field and an event.

## Claiming confers no access

A claimed profile lets the brokerage edit `broker.selfReported`. It cannot read
or change any carrier's loads, rates, notes, standing, payment experience or
factoring history — those live on `CarrierPartyRelationship`, partitioned by
carrier organization at the store, and no read path takes a parameter that would
let a claimant reach them.

## Where an observed broker shows up

`visibleParties` lists the companies a carrier has a **relationship** with, and
discovery creates none. So a newly confirmed broker is:

- a **canonical record immediately**, which is what makes every future
  confirmation for that MC resolve to it rather than duplicate it;
- **in no carrier's directory** until that carrier links a load to it in
  Directory → Review, which creates the relationship exactly as it does today.

## What this build actually does

**The FMCSA authority service is not connected.** `notConnectedAuthority`
answers `unavailable` to everything, and there is no code path that can answer
otherwise. So on this branch **every rate confirmation holds its observation
pending and creates no profile at all** — which is the correct behaviour under
rule 5, not a gap to be worked around. The confirmed and conflicted paths are
driven in tests through `setAuthorityService`.

The seeded Ridgeline profile shows the end state the pipeline produces; it is a
fixture, and its comment says so.

## Tests that hold the boundaries

`src/lib/api/mock/broker-authority.test.ts`:

| Requirement | Test |
|---|---|
| Many rate cons, one profile | three confirmations across two carriers → one profile, three observations |
| Same MC, different names | one profile, conflict recorded on the observation, register's name kept |
| One name, different MCs | two profiles, neither merged |
| Unavailable FMCSA | nothing created; observation holds the document's values with provenance |
| Broker joins later | claims the existing record; party count unchanged |
| Claiming preserves history | observations byte-for-byte identical after claim + edit |
| Official fields unwritable | edit lands in `selfReported`; `official` untouched |
| Carrier-private factoring | never on the shared record; each carrier sees its own |

## ███ FRONTEND ONLY ███ — what the backend still owes this seam

- **The FMCSA authority data service itself.** Everything here is a typed port.
- **A uniqueness constraint on the normalized MC number**, so two confirmations
  processed concurrently cannot both create a profile. A database is the only
  place that race closes.
- **Re-checking authority status on a schedule.** A revoked authority is only
  as fresh as the last lookup, and nothing here re-asks.
- **The claim flow.** `claimBrokerProfile` models the outcome; there is no
  screen, no code delivery and no identity-proofing behind it.
- **Telling a brokerage it has been indexed**, which is a product and legal
  decision rather than a refactor.
- **Rate limiting.** Anybody who can sign a rate confirmation can cause an
  observation. The gate bounds what is created; it does not bound how often.
