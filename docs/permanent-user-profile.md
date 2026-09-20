# The permanent user profile

## What this milestone added, and what it deliberately did not

Antcolos knew a great deal about a person *inside one organization*. It knew
nothing about them across all of them. A dispatcher who spent two years at one
agency, moved to another and then bought a truck had three unrelated existences
and no way to show anybody what they had actually done.

Every neighbouring record was asked, and every one of them said no. `User` is
the permanent account and deliberately holds no history, no figures and no
public face. `Membership` is ACCESS to one organization and dies with it.
`WorkforceEngagement` is the working relationship with one employer and belongs
to that employer. `DriverProfile` is the professional driver and says nothing
about a dispatcher. Not one of them survives leaving.

So this milestone adds four records, and nothing else:

| Record | Answers |
|---|---|
| `UserProfile` | who this person is, permanently and outside any organization |
| `WorkplaceAssociation` | where they have worked, in what capacity, between what dates |
| `ProfileContribution` | one measured unit of work, attributed to them |
| `Achievement` | a milestone — derived from the ledger, or conferred by the platform |

Everything a profile displays is one of those four, or is folded from them on
read.

## Ownership

| Fact | Canonical owner |
|---|---|
| Account, email, preferences | `User` |
| Access to an organization | `Membership` + permissions |
| The working relationship with an employer | `WorkforceEngagement` |
| Professional driver record | `DriverProfile` |
| Loads, miles, revenue as operational records | Loads, Settlements, Fuel, Tracking |
| **The person's permanent public identity** | **`UserProfile`** |
| **Where they have worked, across employers** | **`WorkplaceAssociation`** |
| **The measured work behind every figure** | **`ProfileContribution`** |
| **Milestones** | **derived — see below** |

## The onboarding order, and why it is what it is

```
1. Sign up            email → code → username → password        /sign-up
2. Permanent profile  avatar (skippable), full name, headline   /onboarding/profile
3. Role               carrier / driver / dispatch, or join one  /onboarding
```

The profile step sits **before** role selection, and the order is the product
making a claim. The record created at step 2 outlives every answer given at
step 3: the same profile follows somebody who starts as a company driver, buys
a truck, and ends up running a dispatch team. Asking for it after the role
would make it look like part of being a dispatcher, and it is not.

**Skipping does not skip the record.** "Skip for now" completes the same call
with `completed: false`. The permanent profile is created either way, tied to
the username chosen at signup; what is missing is a prompt to come back, not a
gap in the data model. Somebody who signed up at 2am to accept a load gets to
go and do that.

**An invitation is not lost.** It rides through signup in `?next=` and the
profile step hands off to the invitation instead of to role selection. Only a
same-site path is accepted — `?next=https://elsewhere` is ignored, because a
signup flow is exactly where an open redirect gets used.

## The rules that matter most

**A profile is read by a viewer, not by a membership.** Every other service in
Antcolos takes a `ServiceContext`: an organization, a membership, a permission
set. `ProfileService` reads take a `ProfileViewer` — an optional user id, and
nothing else. That is not a convenience. A profile's readers include a
signed-out stranger following a link and a link-preview crawler in a group
chat, neither of which is a membership in anything; and forcing a context would
create the first code path in the product where an employer's permissions were
in scope while somebody's private profile was assembled. There is no permission
anywhere that unlocks a section its owner hid, because there is nowhere to put
one.

**No figure is stored.** Every number on a profile is folded from
`ProfileContribution` rows on every read. There is no counter to increment and
no total to migrate, so a figure can always be traced to the rows that produced
it, and a correction is a reversing row rather than an edit to a sum. The
ledger is append-only: there is no `updateContribution` and no
`deleteContribution`, on the service or in the store.

**The organization on a row comes from the caller's context.** A module posting
work cannot claim it was done somewhere it was not — the same rule `ActorRef`
follows.

**Company names are snapshots.** `organizationNameSnapshot` is taken when an
association opens and is never recomputed, for the same reason fuel attribution
is snapshotted: a carrier that rebrands, is sold or closes must not silently
rewrite where somebody worked in 2026.

**History is never deleted.** An association ends; it is not removed. Somebody
who leaves and returns gets a second association and the first one stays. An
employer cannot erase the fact that somebody worked there.

**Badges are derived, and the one kind that cannot be is marked.** Threshold and
quality badges are computed from the person's own rows by a pure rule table, on
every read, and dated to the contribution that crossed the line — "100th load
dispatched, 4 March", not "as of whenever you opened this page". There is no
nightly job to fall behind and no badge table to drift.

"Top Dispatcher Q3 2026" is different in kind. It is a statement about everybody
*else's* quarter, and a profile read has exactly one person's rows. Deriving it
would mean either shipping every dispatcher's figures to every client or
inventing a ranking from one person's data. So comparative awards are
**conferred**: written by the platform, carrying the period they were decided
for, merged in by the caller, and labelled "Awarded by Antcolos" wherever they
appear. `achievements.test.ts` asserts that no rule can produce one.

**A withheld section is stated, not omitted.** A hidden section is absent from
the view and named in `withheld`, and the page says the person keeps it to
themselves. An empty grid and a hidden one look identical, and "this dispatcher
has booked nothing" is a very different claim from "this dispatcher does not
publish their figures".

**A missing handle and a hidden profile answer identically.** Both are `null`,
and both render the same page. Telling them apart would turn a list of guessed
handles into a directory of who works in freight, which is a far more valuable
thing to scrape than any one profile.

**A share card exists only for a public profile.** A crawler holds a link and
nothing else; it is not a signed-in reader, and it will put whatever it is
given into a group chat. `signed-in` and `private` profiles render the plain
Antcolos fallback card and are marked `noindex`.

**The username is immutable, structurally.** `UpdateProfileInput` has no field
for one — not a disabled input, not a "contact support" link. Every share card,
mention and profile link ever published points at it.

## The safety score

It is written down where it is shown, because a derived number somebody cannot
reconstruct is a number they cannot dispute:

```
100  − 8 × (recorded safety events)  + 2 × (clean inspections),  clamped to 0…100
```

It is `null`, not 100, for somebody with no driving history — a driver who has
never turned a wheel has not earned a perfect safety record. **It is Antcolos's
own summary of what carriers recorded here. It is not a CSA or SMS BASIC score
and has no regulatory meaning.**

## Addresses

| URL | What it is |
|---|---|
| `/profile/[username]` | the public profile. `@sam` and `SAM` redirect to the canonical path |
| `/profile/[username]/a/[achievementKey]` | one achievement, with its own Open Graph image |
| `/account/profile` | the owner's view: the same page, plus editing and visibility |
| `/onboarding/profile` | signup step 2 |

The public page is read **as a stranger even when the owner opens it**, so
"View public page" shows what is actually published rather than a friendlier
version of it.

## The HTTP mapping Taqi implements

| Method | Endpoint | Scope |
|---|---|---|
| `initialize` | `POST /v1/profile` | viewer (owner) |
| `getOwn` | `GET /v1/profile/me` | viewer (owner) |
| `getByUsername` | `GET /v1/profiles/{username}` | viewer, may be anonymous |
| `update` | `PATCH /v1/profile` | viewer (owner) |
| `setVisibility` | `PUT /v1/profile/visibility` | viewer (owner) |
| `uploadAvatar` | `POST /v1/profile/avatar` (multipart) | viewer (owner) |
| `removeAvatar` | `DELETE /v1/profile/avatar` | viewer (owner) |
| `listWorkplaces` | `GET /v1/profiles/{username}/workplaces` | viewer, may be anonymous |
| `recordContribution` | `POST /v1/profiles/{userId}/contributions` | **organization** |
| `shareCard` | `GET /v1/profiles/{username}/share-card` | nobody — public only |

## ███ FRONTEND ONLY ███ — what the backend still owes this seam

- **Username uniqueness and immutability.** `initialize` must be idempotent per
  account and must read the handle from the authenticated account, never from
  its own request body. `InitializeProfileInput.username` is a mock seam and a
  real adapter ignores it.
- **Avatar storage and re-validation.** A content type and a byte length
  reported by a browser are claims, not evidence. Bytes must be sniffed,
  scanned, re-encoded and served from a separate origin. SVG is refused
  outright: an SVG avatar is an executable document served from Antcolos's own
  origin.
- **Rate limiting on public reads,** and an identical answer for a handle
  nobody holds and a profile the caller may not read.
- **A uniqueness constraint on `ProfileContribution.sourceRef`,** so a retried
  job cannot post the same load twice and inflate somebody's record.
- **Wiring the operational modules into `recordContribution`.** The ledger is
  seeded in the mock. The seam is typed and exposed as `useRecordContribution`;
  connecting each module's completion path to it is a separate change with its
  own blast radius.
- **The ranking behind a conferred award.** It needs every dispatcher's
  quarter, which no client may hold.
- **One source for the share card.** In the mock, a server-rendered card is
  drawn from the seeded snapshot in `src/lib/profile/published.ts`, because an
  image route has no browser tab and therefore no mock store; an edit made in a
  tab does not reach it. A real implementation renders the card from the same
  row the page reads, and `src/features/profile/server-view.ts` is exactly the
  seam that read goes through.

## Where the code is

| Concern | File |
|---|---|
| Types | `src/types/profile.ts` |
| Handles, paths, canonical URLs | `src/lib/profile/identity.ts` |
| Account lifetime and active time | `src/lib/profile/tenure.ts` |
| Folding the ledger into figures | `src/lib/profile/metrics.ts` |
| The badge catalogue and rules | `src/lib/profile/achievements.ts` |
| Who may read what | `src/lib/profile/visibility.ts` |
| Assembling a view | `src/lib/profile/view.ts` |
| Share cards and social links | `src/lib/profile/share.ts` |
| Avatar and field rules | `src/lib/profile/avatar.ts`, `fields.ts` |
| Seeded records, readable on both sides of the network | `src/lib/profile/published.ts` |
| The seam | `src/lib/api/contracts/profile.ts` |
| The mock adapter | `src/lib/api/mock/profile.ts`, `profile-store.ts` |
| Screens | `src/features/profile/` |
