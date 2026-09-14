# Antcolos Frontend

Production-quality Next.js frontend for Antcolos — the commercial mobility operating system.

## Running it

Requires **Node 22 or newer**.

```bash
npm install
npm run dev
```

Then open http://localhost:3000 — it redirects to `/home`.

Other commands:

```bash
npm run build      # production build
npm test           # every test (both suites below)
npm run test:unit  # vitest, against the service layer
npm run test:node  # node --test over tests/
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
```

There are two suites, split by what they need rather than by taste. The
service-layer tests live beside the code they cover (`src/**/*.test.ts`) and run
on vitest, which resolves the `@/` alias through the app's own tsconfig. The
directory and normalization tests live in `tests/` and run on Node's own test
runner with no extra dependencies; `tests/alias-hook.mjs` teaches that loader the
`@/` alias and extensionless imports, so those tests import the real application
files rather than a copy. `npm test` runs both.

## What is built so far

| Milestone | Screens |
|---|---|
| 1. Foundation and shell | Design tokens, theme and density, identity and membership switching, permissions, responsive navigation, shared states |
| 2. Home + Needs You | `/home` (adapts to the membership), `/needs-you`, `/driver/home` |
| Canonical Load slice | `/loads`, `/loads/[loadId]` — read-only |
| Settlement foundation | `/finance/settlements`, `/finance/settlements/[id]`, and the payee statement |
| Permanent Truck | `/fleet/trucks`, `/fleet/trucks/[truckId]`, `/fleet/trucks/new` |
| Permanent Trailer | `/fleet/trailers`, `/fleet/trailers/[trailerId]`, `/fleet/trailers/new` |
| Maintenance foundation | `/maintenance`, `/maintenance/[kind]/[id]`, `/driver/defects` |
| Permanent Truck | `/fleet/trucks`, registry, onboarding, operating authority |
| Permanent Trailer | `/fleet/trailers`, registry, attachments, readiness |
| Insurance & Claims foundation | `/insurance`, `/insurance/policies`, `/insurance/certificates`, `/insurance/claims` |
| Truck and trailer registries | `/fleet/trucks`, `/fleet/trailers` and their profiles |
| Invoice foundation | `/finance/invoices`, `/finance/invoices/[invoiceId]` |
| Broker / Shipper / Receiver directory | `/directory`, `/directory/[partyId]`, `/directory/locations/[facilityId]`, `/directory/contacts/[contactId]`, `/directory/review` |
| Driver decision & trip workflow | `/driver/proposals`, `/driver/proposals/[id]`, `/driver/loads`, `/driver/loads/[loadId]` |
| Unified Document Center | `/documents`, `/documents/[documentId]` |

Everything else is a placeholder screen that says so.

## Insurance and claims

Four record types, kept separate because they expire, renew, are issued and are
argued over on completely different schedules: a **Policy** (the contract, at
one version), a **Coverage** line inside it (its own limits, deductible and
dates), a **Certificate of Insurance** (evidence held by a third party) and a
**Claim** (an event against cover).

One rule shapes all of it: **coverage is a question about a moment in time,
never about today.**

- A renewal writes a NEW policy version and marks the old one superseded. The
  old policy, its coverage, its certificates and its claims survive intact.
- What a policy covers is a dated list of schedule rows. Taking a truck off
  closes its row; nothing is deleted, so last year's accident still resolves.
- A claim freezes a **coverage attribution** when it is recorded and never
  recomputes it. Renewing the policy, selling the truck, a driver leaving or
  the operating authority moving to another carrier cannot rewrite it.

`src/lib/insurance/coverage.ts` holds those rules, pure and dependency-free.
`tests/coverage-evaluation.test.ts` is where they are pinned down.

### What a dispatch organization sees

Nothing, by default — not even that a policy exists. A carrier shares a policy
or a single claim explicitly, for a written purpose, revocably. A share carries
the coverage summary and the operational facts; premiums, deductibles, private
notes, fault attribution and every claim figure stay with the carrier. Switch
to **Meridian Dispatch** to see it: one shared Baxter policy, one shared claim,
and a Costs panel that says the money was never sent rather than hiding it.

### What is NOT connected

Nothing in this module talks to an insurer, files a claim, moves money, reads a
document or reports anything to a government body. The seams are declared and
typed in `src/lib/insurance/extension-points.ts` — insurer verification, agent
of record, claim submission, premium and deductible payments, document reading,
telematics evidence and government reporting — and every one of them throws.
The Insurance overview lists them and says what Antcolos does instead.
## Invoices

An invoice is the only place Antcolos asserts money to somebody outside the
organization, so the module obeys two rules the rest of the product does not
need:

1. **It is append-only once issued.** Line items and totals may change while an
   invoice is a draft. After that it changes by appending — a payment, a
   dispute, a void — and every step bumps `version` and writes an audit entry.
2. **It never re-reads upstream profiles.** The load, the rate confirmation,
   the billing party and the carrier are referenced by permanent id, and what
   is *copied* onto the invoice is a snapshot taken at invoice time. A broker
   that renames itself next year does not rewrite last year's invoices.

Loads, rate confirmations, PODs, documents, broker/shipper profiles, detention,
layover and the other accessorials are **separate modules**. Invoices receives
them through the typed inbound contracts in
`src/lib/api/contracts/invoices.ts` (`ConfirmedLoadInput`,
`ConfirmedRateConfirmationInput`, `ApprovedAccessorialInput`,
`BillingPartyInput`, `DocumentRequirementInput`, assembled as an
`InvoiceSourcePacket`). Until those modules exist, one file —
`src/lib/api/mock/invoice-sources.ts` — stands in for all of them and produces
those exact packets; when they land, that file is deleted and nothing else
changes.

Statuses: Draft, Needs documents, Ready, Submitted, Disputed, Partially paid,
Paid, Overdue and Void. `needs_documents` / `ready` follow the readiness checks
and `overdue` / `partially_paid` / `paid` follow the due date and the money —
they are derived, not typed in by anybody.

Readiness is a list of named checks rather than a boolean, because a biller who
is blocked needs to know *which* thing to go and fix: delivery recorded, rate
confirmation on file, linehaul matching the agreement, required documents
attached and accepted, every accessorial approved upstream, a billable payer
and a positive total. Failing checks block; warnings do not.

Missing documents, disputes and overdue receivables are raised into the SAME
Needs You queue as everything else, not into a second list only this screen
knows about.

**Deliberately not built yet, and absent rather than stubbed:** settlements,
reporting, real payment processing, real email or portal delivery, factoring
submission and accounting export. `submit` records that a *person* sent the
invoice — Antcolos sends nothing, and `deliveryConfirmed` is always false.
## The directory and entity resolution

A rate confirmation names companies, places and people. Antcolos keeps those as
three different permanent records, each with its own immutable UUID:

- **Party** — the company (broker, shipper, receiver). Roles accumulate on one
  record, so a company that both ships and receives is one profile, not two.
- **Facility** — a place it ships from or receives at. One company, many docks.
- **Contact** — a person. People move between companies, so they are never a
  field on the company.

`src/lib/directory/` holds the part that decides which record a name refers to,
as pure functions with no store access:

- `normalize.ts` — safe normalized identifiers. Every function returns nothing
  rather than a value it is unsure of, because a loose key silently merges two
  companies and the merge surfaces weeks later as a load billed to the wrong
  broker.
- `matching.ts` — candidate scoring. A broker is matched on its **MC number**,
  which is decisive on its own; everything else is soft evidence that
  accumulates, and a *different* MC number eliminates a candidate outright
  rather than merely lowering its score.

`src/lib/api/mock/party-registry.ts` is the service the future rate
confirmation workflow will call:

```
planResolution(ctx, extraction)   // writes NOTHING — safe to call and discard
commitResolution(ctx, plan, confirmation)  // applies only what a dispatcher confirmed
```

The rules it enforces, each covered by a test in `tests/resolution.test.ts`:

- Nothing is ever merged automatically. Every proposal carries
  `requiresDispatcherConfirmation: true`, and where two profiles fit equally
  the resolver refuses to pick one.
- A second load for the same company links to the existing profile — there is
  no path that creates one profile per load.
- A profile created from an uncertain or thin match is born **provisional** and
  says why, rather than quietly joining the directory as settled fact.
- Rate confirmation data is **never** marked externally verified. The strongest
  state a document can produce is `dispatcher_confirmed`; only a check against
  FMCSA could produce `externally_verified`, and nothing in this module can
  write it.
- The rate confirmation is preserved as the source on every record, and a
  **frozen snapshot** of the fields used is written against the load — so
  correcting a profile in September never rewrites what a load ran under in
  March.

Loads are reached through link rows and then read from the loads service. The
directory never stores a load, so a profile shows its load history without
owning it.

Extraction itself (OCR, field-level correction) is **not built**. `/directory/review`
runs on reviewed fixtures in `src/lib/api/mock/rate-con-extractions.ts` and says
so on screen; everything after that point is real.

### Carrier-private data

A company record is shared — an MC number is the same number for everyone. What
one carrier *thinks* is not. Notes, ratings, blocked and preferred standing,
payment experience and private history live in rows keyed by carrier
organization, and every accessor takes that organization from the context
rather than from a parameter a screen could supply.

Switch between **Northline Freight** and **Baxter Transit** on the same broker
profile to see it: Northline has Apex Logistics marked *preferred* with a note
about calling Dana directly; Baxter has the same company *blocked* over an
unpaid detention claim. Neither can see the other's.

## Driver Load Decision & Trip Workflow

One channel-independent service and state machine behind two driver surfaces.
The web dashboard is the only channel built; the Telegram bot, when it is
written, calls the same `ProposalCommand` and `WorkflowCommand` objects through
the same service and inherits the same validation, permissions, carrier policy
and event history. There is no second path in.

**Proposals** — Dispatch asks a driver about a load before booking it. The
driver may approve continued negotiation, reject it (with or without a reason),
pause it for a duration the carrier allows, comment, and counter. Approving is
not consent to be booked unless carrier policy says so, and the record says
which. A pause that runs out returns the proposal to *Awaiting Driver Response*
— never to approved, never to rejected. When one load is finalized, overlapping
proposals for the same driver or equipment become *Unavailable* with every
comment, counteroffer and pause still on them.

**Policy, not screens** — an owner-operator sees the money and may counter on
rate; a company driver sees miles and their own share and may counter on
schedule, route, home time, hours, pickup, delivery, equipment and conditions.
That is decided in `lib/driver-workflow/policy.ts` and enforced in the service:
a company driver who POSTs a rate counteroffer directly is refused, and a driver
never receives a `LoadFinancials` at all — they receive a `DisclosedRate` with
the withheld fields *named*.

**Finalization** — a load is not final until its rate confirmation has been
reviewed and approved by Dispatch, signed with the authorized carrier signature,
and sent back to the broker. Only then is a Driver Load Post created, and with
it the load's own immutable workflow instance. Completing a trip closes that
workflow without deleting its timeline, documents, comments, corrections or
audit history; the next load gets a new one.

**Out of order by design** — a driver who never marked *Arrived at Shipper* and
uploads the BOL straight from the dock is doing their job, not making a mistake.
The upload succeeds, the real sequence is kept, and the missing step becomes a
warning that blocks nothing. There is exactly one genuine refusal in the trip:
closing it without a proof of delivery, for a carrier that bills on one — and
even that can be done with the reason recorded.

**Inference is not a driver action** — a geofence crossing may suggest a
milestone happened. It is recorded as `inferred`, with its source, timestamp and
confidence, and stays that way until a person confirms or corrects it. Nothing
back-fills a timestamp to make a timeline look tidy.

## Try the permission and identity model

The app ships with one permanent user and six memberships. Use the organization switcher at the top of the sidebar:

- **Northline Freight** — you are the Owner. You see everything, including rates and revenue.
- **Meridian Dispatch** — you are a Senior dispatcher with `rates:view` withheld. The rate column, revenue tile, settlements, invoices, reports and the whole settings section are *absent*, not disabled — `/finance/invoices` typed into the address bar gives a proper 403 screen, and the service refuses the call underneath it. Trucks show the partner carrier they run under.
- **Baxter Transit** — a second carrier, so an operating lease can be read from both ends. It shares exactly two of its documents with Meridian Dispatch, and nothing else.
- **Sam Murtaza Dispatch** — an *individual* dispatch workspace. Not a dispatch organization: it is asked for a photo ID, and never for operating authority or cargo insurance. `/documents` grows an **Upgrade** tab there.
- **Cascade Haul** — you are a Company driver scoped to your own loads. `/home` hands off to `/driver/home`, and you see three of the four loads that exist. On a proposal you see the rate per mile, your share and the miles — the linehaul and the total rate are named as withheld — and you may counter on schedule, route, home time and hours, but not on rate.
- **Stonebridge Carriers** — the same person as an **Owner-operator**. Same product, same screens, a different rulebook: the full rate, and rate counteroffers up to five at a time. Comparing these two memberships is the fastest way to see that the difference lives in policy and the service layer, not in the UI.

Your profile, avatar, theme and density never change when you switch. The data cache is cleared on every switch, so one organization's records can never be served to a screen rendered under another.

## Architecture

```
src/
  app/                  App Router routes
    (app)/              product shell + permission route guard
  components/
    ui/                 primitives (button, badge, dialog, sheet, table bits)
    layout/             AppShell, Sidebar, Topbar, OrgSwitcher, AccountMenu
    auth/               Can, PermissionBadge, ActorLabel
    data/               loading / empty / error states
  features/             home, needs-you, loads, settlements
  features/             home, needs-you, loads, fleet, trailers, insurance
  features/             home, needs-you, loads, directory, driver-workflow
  features/             home, needs-you, loads, directory, documents
  lib/
    api/
      contracts/        ★ typed service interfaces — the backend seam
      mock/             in-memory adapter, PARTITIONED BY ORGANIZATION
      http/             real adapter, deliberately unimplemented
    insurance/          ★ coverage rules, requirements, claim states, seams
    directory/          ★ normalization and entity-resolution matching (pure)
    driver-workflow/    ★ channel-independent engine: catalog, commands,
                          policy, proposal + trip state machines, errors
    integrations/       ★ typed ports for modules owned by other branches,
                          with labelled, replaceable mock adapters
    documents/          ★ type catalog, requirement sets, status derivation
    permissions/        ★ catalog, can(), templates, effective, scope, routes
    maintenance/        trigger evaluation, labels, integration extension points
    session/            ★ permanent User, Membership[], active membership
    settlements/        pure pay engine: money, agreements, status, breakdown
    query/              org-namespaced query keys
  types/                ★ canonical entities
  config/               nav, statuses, documents, brand
  styles/globals.css    ★ every design token
```

The starred locations are the architectural spine: one design system, one permission catalog, one document model, one session model, one backend seam, one set of canonical types. Nothing outside them hardcodes a color, checks a role, reads identity directly, or calls `fetch`.

## The Document Center

There is **one** document system. A driver's medical card, a carrier's operating
authority, a truck's registration and a trailer's inspection are the same record
type in the same store (`src/lib/api/mock/document-store.ts`), read through one
service (`src/lib/api/contracts/documents.ts`). The truck registry, trailer
registry and driver mock no longer keep documents of their own — they project
that store, and their screens did not change.

- **Identity.** Every document has an immutable UUID per *version*, plus a
  lineage UUID shared by every version of the same document. Replacing a
  document creates a new version and keeps the old one, with its file, its
  review decision and its whole history.
- **Requirements are not documents.** Checklists live in
  `src/lib/documents/requirements.ts` and are joined to the records at read
  time. A requirement with nothing against it is "missing" — a fact about the
  checklist, with no record behind it.
- **Three workspace types, three checklists.** A Carrier Organization, a
  Dispatch Organization and an Individual Dispatch Workspace are asked for
  different things. The matrix is exhaustive: every workspace type has an
  explicit answer for every candidate document type, including "not
  applicable", so a carrier-only requirement cannot leak into a dispatcher's
  list by omission. The workspace kind comes from the active membership, never
  from a caller.
- **Types stay reusable.** One W-9 type serves all three, with a different
  reason in each. A document that applies in several places is *linked*, with
  its own per-context review state, rather than uploaded twice.
- **Isolation.** A Dispatch Organization sees a Carrier's document only through
  an explicit, live share, and never the granter's own review decision. Viewing
  and downloading are separate grants. Revoking a share keeps the grant and a
  snapshot; it deletes nothing.
- **Nothing is deleted.** Ending a relationship closes that organization's
  links, revokes its shares and snapshots what it held. Every record, version
  and event survives.
- **Needs You is real.** Missing, rejected, expiring and expired documents are
  computed from live state on every read — fix the document and the item stops
  existing. What a person *did* to an item (assign, snooze, escalate, resolve)
  is kept separately.

**Uploads are mock-only.** Choosing a file records the name, type and size the
browser reports. Nothing is uploaded, stored, transmitted, read, OCR-processed,
verified or submitted anywhere, and no screen says otherwise.

Load paperwork — rate confirmation, BOL, POD, receipts, detention evidence,
damage documents — is **modelled and not built**: `load` is a subject kind and
the types exist so the workflow can attach to this model later, and the service
refuses to create one today.

## Data

All data is mocked behind the service contracts. Mutations persist for the browser session only. Set `NEXT_PUBLIC_API_MODE=http` to point at the real adapter — it throws by design, so nothing pretends to be connected.

Telegram, ELD, load boards and accounting are **not connected**, and no screen implies otherwise.
Maintenance names its own extension points — ELD, odometer and engine-hour feeds, repair
shops, parts, tire, warranty and roadside — in `src/lib/maintenance/integrations.ts`.
Every one of them is `null`, the type of each includes `null` so a caller cannot forget to
handle it, and the Integrations tab lists them all as *Not connected*. Every meter reading
in maintenance was typed in by a person, and every screen showing one says who typed it.
Telegram, ELD, load boards, accounting, insurers, claims processing, insurance
payments, document OCR, telematics and government reporting are **not
connected**, and no screen implies otherwise.

### The integration boundary

Dispatch, the Opportunity inbox, Rate Confirmation, the Unified Document Center,
OCR and the GPS/ELD/telematics feeds are being built on other branches. This
branch creates none of their tables, canonical records, UI or business logic.
What it creates is `src/lib/integrations/ports.ts` — the contract — plus one
folder of labelled mock adapters behind it, and `src/lib/integrations/index.ts`,
which is the single line that changes when the real modules land.

Every record that crosses keeps the other module's own identifier
(`ExternalRef`), where it came from (`Provenance`, with `mock: true` while it is
a placeholder) and an idempotency key, so connecting the canonical module later
is a swap rather than a data migration. Anything this workflow produces for
another module is queued as a `PendingIntegrationEvent` that says plainly that
nothing has been sent, stored, verified or processed. The **Connections** panel
on any trip screen shows exactly that, per module, at runtime.

Where a canonical record already exists in this repository — Load, Driver,
Assignment, Document — the adapter reads and writes THAT record. Uploads and
OCR are honest mocks: picking a file records its name, type and size and throws
the file away; extraction returns typed fixtures and says so on screen.

## Settlements

A settlement is what one carrier owes one payee for a period of work — a company
driver, an owner-operator, an individual dispatcher, a dispatch organization, or
any other approved payee. Everything a settlement is *about* is built elsewhere,
so the module owns none of it: it takes typed references and, when the money is
worked out, a **snapshot**.

That snapshot is the whole design. A settlement records what was agreed at a
moment in time, so a driver's percentage changing next month cannot rewrite last
month's pay. Loads are priced under the compensation agreement that was in force
**when the work was performed**, never the current one, and the arithmetic is
frozen on approval and read thereafter rather than recomputed.

Three things the module will not do:

- **It never silently edits a settlement that has been signed off.** Corrections
  are new records with their own UUID, linked to the original in both
  directions. Both stay on the books.
- **Nobody approves, pays or corrects a settlement they are the payee of**, no
  matter how broad their permissions.
- **It moves no money.** There is no ACH, banking, payroll, tax filing,
  accounting integration or payment execution anywhere in it. Recording a
  payment writes down that one happened somewhere else.

Payee privacy is a different list, not a redacted one: a membership scoped to its
own financials gets its own settlements in full and nobody else's at all — no
carrier roll-up, no other payees in the filters. Switch to **Cascade Haul** to
see that side.

Needs You items for missing data, disputes and overdue payments are *derived*
from settlement state rather than stored, so they cannot go stale and cannot be
snoozed away without fixing what they are about.

## Branding

The wordmark and mark are temporary placeholders, not the final Antcolos logo. To rebrand:

1. Colors, type, radius, elevation → `src/styles/globals.css`
2. The mark → `public/brand/antcolos-mark.svg`
3. Name and wordmark treatment → `src/config/brand.ts`

## The Maintenance foundation

Four record kinds, deliberately separate and deliberately linked, all keyed by the
**permanent equipment UUID** rather than by whoever is running the machine:

| Record | Answers |
|---|---|
| `MaintenanceRequirement` | What it is due for, and when |
| `ReportedDefect` | What somebody found wrong with it |
| `RepairOrder` | The work being organised to put it right |
| `ServiceRecord` | What was actually done — **append-only, forever** |

Requirements fall due on a **date, mileage, engine hours or a reported defect**, and run
through `upcoming → due soon → overdue`, plus `in service`, `completed` and `deferred`.
An unanswerable requirement is never answered: a mileage job on equipment nobody has
read the odometer of is shown as *No odometer reading*, not as overdue and not as fine.

**History belongs to the machine.** There is no function anywhere that edits or deletes a
`ServiceRecord`. An ownership transfer or a carrier change ends relationships; it never
re-keys, rewrites or removes a line of what happened. A carrier taking on a truck sees the
work another carrier did on it — the date, the job, the odometer, and their name — with
their cost, vendor, people and notes stripped. Access follows today's relationships; the
snapshots inside each record are what make it still legible afterwards.

**Dispatch organizations see only what is explicitly shared.** Holding dispatch access to a
truck is deliberately *not* access to its maintenance: a carrier shares one piece of
equipment at a time, at one of two scopes, and the shared view has no path to a cost, a
vendor, a note, a defect description or a person's name.

Maintenance raises **real Needs You items** into the existing queue — overdue service,
critical defects, unresolved repairs and equipment out of service. They are derived from
live records on every read, not seeded, so resolving the underlying record removes the
item. There is no second alerts system.

Try it with the organization switcher: **Northline Freight** (carrier, full module),
**Meridian Dispatch** (sees two shared trucks and nothing else), **Summit Dispatch**
(nothing shared — an honest empty state), **Cascade Haul** (a driver who can report a
defect on their own truck and nothing more).

## For backend integration

`src/lib/api/contracts/` is the seam. Every method takes a `ServiceContext` carrying the organization, membership, permission set, record scope and an actor snapshot — there is no method that accepts a `User`. The mock adapter enforces permissions and organization ownership itself, so a UI bug that renders a forbidden button still fails at the seam.

## Tests

```bash
npm test
```

Node's own test runner over the TypeScript sources — no build step, no test
framework dependency. `tests/alias-loader.mjs` resolves the `@/*` alias so the
tests import exactly what the app imports.

They cover the service layer, which is where the rules actually live:

- **Domain** — money in whole cents, per-organization invoice numbering that
  never reuses a number, every readiness check, and the status machine.
- **Permissions** — every method refuses without the key it names, and the
  error says which keys were missing.
- **Carrier data isolation** — one carrier can never list, read, bill or mutate
  another's invoice, and another carrier's invoice is `NotFoundError`, never
  "forbidden", because a 403 would confirm the record exists.
- **Record scope** — a membership scoped to its own records sees only invoices
  for loads it drove.
- **Lifecycle** — create, issue, submit, pay, dispute, resolve, void, and every
  refusal in between.
- **Snapshots** — renaming a broker or editing a load does not rewrite an
  invoice that was already issued.
- **Needs You** — invoice items land in the shared queue, are gated on
  `invoices:view`, and snooze and resolve like any other item.
