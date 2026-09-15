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
| Fuel & IFTA foundation | `/fuel`, `/fuel/transactions`, `/fuel/transactions/[id]`, `/fuel/mileage`, `/fuel/ifta`, `/fuel/ifta/[id]` |
| Truck and trailer registries | `/fleet/trucks`, `/fleet/trailers` and their profiles |
| Reports | `/reports`, `/reports/[reportId]` — read-only analysis of other modules' records |
| Safety & Compliance foundation | `/compliance`, `/compliance/[requirementId]` |
| Permanent Truck and Trailer | `/fleet/trucks`, `/fleet/trailers` and their profiles |
| Fleet Management Foundation | `/fleet`, `/fleet/equipment/[assetKind]/[assetId]` |
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
| GPS-driven availability, MT Loop entry & broker tracking | `/dispatch/tracking`, `/dispatch/tracking/[loadId]`, `/track/[token]` (public) |

Everything else is a placeholder screen that says so.

## Fuel & IFTA

The foundation a real fuel and tax product can be built on, and deliberately
not the product itself.

Three rules shape it, and they are enforced in the service layer rather than
the screens:

- **A fuel purchase is not a mileage record.** `FuelTransaction` says a truck
  bought fuel somewhere; `JurisdictionMileageRecord` says it drove so many
  miles inside a jurisdiction. They are separate entities with separate
  lifecycles, and they meet for the first time on the IFTA quarter.
- **Attribution is historical.** Mileage and fuel belong to the carrier whose
  operating authority was live at the moment of travel or purchase, snapshotted
  then and never recomputed. A later ownership, lease, driver or carrier change
  cannot rewrite a filed quarter. Where the authority history cannot settle it —
  two carriers approved on one truck, neither holding it — the record is kept
  and flagged rather than attributed to whoever happens to hold it today.
- **Records are immutable.** A correction writes a new revision and supersedes
  the original; the original stays readable forever, and only current revisions
  count toward any figure.

What Antcolos does **not** do: file an IFTA return, calculate tax owed, or move
money. The calculation stops at net taxable gallons, because turning that into
money needs each jurisdiction's quarterly rate and no rate source is connected.
No fuel card, ELD, GPS, telematics, receipt-reading, toll, accounting or IFTA
provider is connected either — `src/lib/fuel/integrations.ts` declares each as
a typed extension point whose status has exactly one possible value,
`not_connected`.

Dispatch organizations see only what a carrier has explicitly shared, per
truck, and never tax filing unless that carrier authorizes it separately —
holding `ifta:view` is necessary and not sufficient.

Everything is built on the existing systems rather than beside them: permanent
Truck UUIDs and their operating-authority leases, Driver profiles, Loads,
`Document` records for receipts, Memberships, Permissions and the Needs You
queue, whose fuel items are derived from the ledger and resolve when the
problem does.
## Reports

Reporting **analyses** records; it never creates them. There is no write method
on its service contract, and no load, invoice, settlement, document, carrier,
driver, truck, trailer, broker, shipper or receiver record is written anywhere
in `src/lib/reports` or `src/features/reports`.

Three audiences, resolved in the service from the organization type and the
permissions held — never from a role name:

| Audience | Who | Reports |
|---|---|---|
| Carrier organization | `reports:view` + `revenue:view` in a carrier | Revenue, profit and margin, RPM, deadhead, truck performance, expenses, invoice status, accounts receivable, settlements, broker performance, lane performance, equipment utilization |
| Dispatch organization | `reports:view` + `revenue:view` in a dispatch agency | Commission revenue, performance by carrier, performance by dispatcher, booked loads, average RPM, booking success, empty trucks, time to find a load, broker response rates |
| Individual dispatcher | `reports:view` without `revenue:view` | Their own income, loads, carriers, performance and activity — and nothing organization-wide |

Every report carries a date-range and organization filter, summary metrics with
a like-for-like comparison against the previous period, a written definition and
formula for every number, and a drill-down from any metric or row to the source
records in the module that owns them. Four views — table, bar, line and summary
text — share one calculation: switching view changes nothing but the drawing,
and a report is only offered a chart its data can honestly carry (a line only
where rows are ordered in time). The chosen view is remembered per report, in
the browser.

### Where the numbers come from

Reporting reads other modules through typed adapters in
`src/lib/reports/sources/`. `SOURCE_AVAILABILITY` in `sources/types.ts` is the
honesty contract — it is the one place that decides whether a source is live,
mock or unavailable, and every screen renders what it says:

- **Live**: Loads (through its service contract), Rate Confirmation and
  Documents (from each load's own requirements), Trucks (the permanent registry).
- **Mock adapter**, clearly marked on every screen it reaches: Invoices,
  Settlements, MT Loop, Search Sessions, Opportunities, carrier sharing
  agreements, load attribution, dispatcher earnings — and Expenses, which no
  module owns at all. No money is invented where a confirmed figure exists: a
  mock invoice bills the load's own rate, and mock driver pay is the load's own
  driver share.
- **Unavailable**: a workspace the Loads module cannot serve says so, rather
  than showing an empty report as if nothing had happened.

### What the service enforces

`src/lib/api/mock/reports.ts`, not the screens: `reports:view` to open the
module and each report's own keys to run it; the audience, so an individual
membership is refused an organization-wide report instead of quietly given a
smaller one; the workspace, because records arrive through the Loads module and
the truck registry with their own scoping already applied; and carrier sharing —
a dispatch workspace analyses only carriers that have shared their records, says
how many records it excluded, and will not let a drill-down reach one.

Known gap in the fixtures, not in the module: `Summit Dispatch` is seeded with
no loads, so the dispatch-organization reports are only viewable in their empty
state in the running app. The calculations behind them are covered by tests
against Meridian's records.
### Safety & Compliance

The one idea the module is built around: **a requirement and a document are not
the same record.** The obligation to hold a current annual inspection on unit 104
exists whether or not anybody has ever uploaded a file. A document can *satisfy*
it — and the requirement then points at that document, in the system that owns it
— but the requirement keeps its own id, status, due date, responsible person and
append-only history, and survives the document being replaced, rejected or removed.

What it reuses rather than recreates:

| It needs | It reads |
|---|---|
| Organizations and operating authority | the session's organization record |
| Drivers | the driver relationships in `features/driver/` |
| Trucks and trailers | the permanent registries in `lib/api/mock/` |
| Documents | the Document Center (organization paperwork is linked with `entityKind: "organization"`) |
| Alerts | the existing Needs You queue — compliance produces real items in it, not a second system |
| People and permissions | Membership, the permission catalog and record scope |

Which requirements exist depends on entity type, organization type, relationship,
operating authority and equipment type — an intrastate carrier is never asked for
the interstate filings, a company driver is never asked for owner-operator
paperwork, a dry van is never asked for a refrigeration service record, and a
25,999 lb box truck sits one pound below the fuel-tax threshold. Requirements that
do not reach a subject become `not_applicable` records that say why, hidden by
default rather than silently absent.

Ending a driver, truck, trailer, carrier or dispatch relationship **stops access
and deletes nothing**: the records freeze, an immutable snapshot is taken, and the
frozen records never re-enter a live queue.

Inspections, violations, accidents, claims, hours-of-service, CSA/SMS monitoring
and full audit preparation are **not built**. They are declared as typed extension
points (`lib/compliance/extensions.ts`) and rendered as "not built yet" — a screen
reading "0 violations" would mean Antcolos had looked and found none, and it has
not looked.

Nothing is connected to FMCSA, the Drug & Alcohol Clearinghouse, any state agency,
any insurance provider, any ELD or any monitoring service. Every date was recorded
in Antcolos or carried on a document somebody uploaded, and the screens say so.
## The Fleet Management Foundation

`/fleet` is the shared operational layer over the permanent records. It is not a
sixth registry — it owns no trucks, no trailers, no drivers and no assignments.
Every row it shows is assembled on read from records that already exist:

| Question | Answered by |
|---|---|
| What state is it in physically? | the Truck / Trailer record |
| Who is running it right now? | the operating-authority lease |
| Who is on it, since when? | the truck driver assignment |
| What is hooked to it, since when? | the trailer attachment |
| Is the paperwork in hand? | the document records |
| What is it working on? | the load records |
| Where is it? | a dated telemetry reading (see below) |

Because of that there is **no new status field**. `FleetOperationalStatus` —
available, assigned, expected available, in transit, maintenance, out of service
— is reconciled on every read and always carries its derivation: which records
were consulted, in what order, and which one settled it. The asset screen renders
that trail, so a status somebody disagrees with points at the record to go and fix
rather than at a second screen that disagrees.

Two things are kept deliberately apart:

- **Status** says what the equipment is doing.
- **Authority** says whether *you* may use it. A truck held under another
  carrier's lease reads `assigned` and `availableToOrganization: false` — and it
  never names the holder, because that the equipment is busy is not confidential
  and who has it is.

Ownership and operating authority stay where they were. Changing a driver or a
trailer touches neither, and changing ownership leaves the UUID, the profile, the
documents, the compliance record and every historical assignment exactly as they
were.

### Assignments are time-bound, and the history is the registry's

The fleet layer stores no assignments. A Driver–Truck row *is* a
`TruckDriverAssignment`; a Trailer–Truck row *is* a `TrailerAttachment`. Both are
already dated, and neither is ever deleted — reassigning stamps `endedAt` on the
open row and opens a new one. Every row the fleet layer returns carries the
`sourceId` of the permanent record it came from, so there is nothing to reconcile
and no second copy to drift.

### What is genuinely new

One store: **telemetry readings** — location, odometer, engine hours. Nothing
else in Antcolos knows where equipment physically is. Readings are append-only,
partitioned by the organization that recorded them, dated twice (when it was true
and when Antcolos was told), and stamped with their source.

### Nothing is connected

There is **no ELD, GPS, telematics, fuel-card, toll or state-registration
integration**, and no screen implies otherwise. `src/lib/fleet/integrations.ts`
declares all six as typed extension points; every one reports `not_connected` and
every adapter method throws rather than returning a plausible fixture. Seeded
readings are labelled *Seeded sample data* and hand-entered ones *Entered by
hand*, on the same line as the value.

IFTA is reported as **not tracked** everywhere and raises no Needs You item.
Antcolos holds no fuel purchases, no jurisdiction mileage and no filing history.

Utilization counts only dated operating-lease intervals, and says so — work
recorded without a lease is not counted, so the figure is a floor, not an
estimate. When the window reaches back past the records, or the equipment is down
with nothing recording since when, the summary reports itself as not fully
derived instead of quietly reporting arithmetic on missing data.

### Needs You

Four rules run against the operational picture and feed the existing queue —
stale location, invalid assignment, unavailable equipment, operational blocker.
They register with stable ids, so they can be assigned, snoozed and resolved like
any other item and do not resurrect on a reload. None of them is raised about
equipment another carrier holds, since the item would itself disclose the lock.

### Permissions

Two keys, and deliberately only two: `fleet:view` opens the layer and
`fleet:telemetry:record` allows a reading. Assigning drivers and attaching
trailers keep the keys of the modules that own those records — a second
permission for one action is how two answers start disagreeing. `fleet:view` is
not a back door: a membership still needs `trucks:view` to be shown trucks and
`trailers:view` to be shown trailers.
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
- **Meridian Dispatch** — you are a Senior dispatcher with `rates:view` and `revenue:view` withheld. The rate column, revenue tile, settlements, invoices and the whole settings section are *absent*, not disabled. Reports are present but personal: your own income, loads, carriers, performance and activity, with organization-wide reports refused at the service. Trucks show the partner carrier they run under.
- **Cascade Haul** — you are a Company driver scoped to your own loads. `/home` hands off to `/driver/home`, and you see three of the four loads that exist.
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
  features/             home, needs-you, loads, fleet, trailers, fuel
  features/             home, needs-you, loads, reports
  features/             home, needs-you, loads, compliance
  features/             home, needs-you, loads, fleet, fleet-ops, trailers
  features/             home, needs-you, loads, settlements
  features/             home, needs-you, loads, fleet, trailers, insurance
  features/             home, needs-you, loads, directory, driver-workflow
  features/             home, needs-you, loads, directory, documents
  lib/
    api/
      contracts/        ★ typed service interfaces — the backend seam
      mock/             in-memory adapter, PARTITIONED BY ORGANIZATION
      http/             real adapter, deliberately unimplemented
    fuel/               ★ fuel and IFTA domain logic — units, jurisdictions,
                          periods, economy, attribution, validation, integrations
    reports/            catalog, metric definitions, source adapters, calculations
    compliance/         ★ requirement catalog, applicability rules, status machine
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
    fleet/              ★ status derivation, readiness, utilization, integrations
  types/                ★ canonical entities
  config/               nav, statuses, documents, brand
  styles/globals.css    ★ every design token
tests/                  service-layer and domain tests (vitest, node)
```

The starred locations are the architectural spine: one design system, one permission catalog, one compliance catalog, one session model, one backend seam, one set of canonical types. Nothing outside them hardcodes a color, checks a role, reads identity directly, or calls `fetch`.
The starred locations are the architectural spine: one design system, one permission catalog, one session model, one backend seam, one set of canonical types, one place the operational picture is derived. Nothing outside them hardcodes a color, checks a role, reads identity directly, or calls `fetch`.
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

Telegram, ELD, load boards, accounting, FMCSA, the Drug & Alcohol Clearinghouse, state agencies, insurance providers and safety-monitoring services are **not connected**, and no screen implies otherwise.
Telegram, ELD, GPS, telematics, fuel cards, tolls, state registration lookups,
load boards and accounting are **not connected**, and no screen implies
otherwise.

`npm test` covers the parts that decide what a person is told and what they are
allowed to see: the reconciliation rules, the access and isolation rules at the
service seam, assignment immutability, the derived Needs You rules, and that
every integration adapter refuses rather than inventing a value.
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

## GPS-driven availability, MT Loop entry and broker tracking

Three connected things: deciding whether a truck is actually free, putting that
decision on the MT Loop board exactly once, and letting a broker watch one load
without letting them watch anything else.

### GPS alone never confirms an empty truck

That is the rule the whole module is built to keep, and it is enforced in one
pure function — `decideAvailability` in `src/lib/tracking/availability.ts` —
which fetches nothing, writes nothing and remembers nothing. It reads a bag of
facts the service gathered from the modules that own them and returns a typed
decision.

Seven kinds of evidence go in:

| Evidence | Where it comes from |
|---|---|
| GPS location and movement | The ELD & Telematics boundary, normalized into `LocationSignal` |
| Delivery appointment and ETA | The Load module's stops and its `load.eta_updated` events |
| Receiver geofence entry and exit | Derived from positions against the delivery facility's circle |
| Driver Workflow events | The Driver Trip Workflow's own append-only milestones |
| Unloading status | The same workflow's `unloading_started` / `delivered_and_unloaded` |
| POD status | The Unified Document Center |
| Driver or dispatcher confirmation | A person, recorded here |

Five states come out:

| State | What it means |
|---|---|
| **Expected available** | Still on a load. The appointment, the ETA and the distance say roughly when it comes free. |
| **Likely available** | The evidence points at an empty truck. Nobody has confirmed it. |
| **Empty confirmed** | A person confirmed it. **No amount of machine evidence reaches this state.** |
| **Availability uncertain** | The signals are missing, too old, or they disagree. Said out loud rather than guessed. |
| **Unavailable** | Loaded, in the shop, or stood down by the carrier. |

Before delivery the engine derives Expected Available from the ETA (or the
appointment) plus an unloading allowance, and reports the destination
proximity. After a **confirmed** unloading — a driver recording it in their own
workflow, or a dispatcher confirming it here — it moves to Empty Confirmed.
A POD on file, a geofence exit and a "delivered" status together still only
reach Likely Available.

Anything a machine concluded stays `inferred`, carrying its source, its
timestamp, its confidence and the evidence it stood on. Inferred confidence is
capped below certainty (`MAX_INFERRED_CONFIDENCE`), enforced where evidence is
made rather than only where it is read. `AvailabilityAttribution` is a closed
union and `driver` is only reachable from a command a driver actually issued —
there is nowhere in the types to record a driver action nobody took.

Every decision comes back with the evidence it **disregarded** as well as the
evidence it used, with the reason. "Inside the receiver's geofence but doing
62 mph — that is a truck passing, not a truck arriving" is the line that
settles the argument three weeks later.

### False geofence inference

A single ping inside a facility's radius is not an arrival. `evaluateGeofence`
requires all three of: inside the circle, not moving (`GEOFENCE_MAX_SETTLED_MPH`),
and dwelled long enough (`GEOFENCE_MIN_DWELL_MINUTES`). A crossing that fails
any of them is rejected with a stated reason and kept as disregarded evidence.

### One truck going empty, one MT Loop entry

There is **no second MT Loop record system**. `publishAvailabilityDecision`
lives in the existing MT Loop service (`src/lib/api/mock/mt-loop.ts`) and is the
only door a decision comes through. Deduplication rests on the decision's
`cycleKey`, derived purely from the truck and the load it is finishing:

1. A truck has at most one **open** loop. A decision about a truck that already
   has one updates that loop; it never opens a second.
2. A cycle key this workspace has already run a loop for — **including a closed
   one** — never opens another.
3. A decision that changes nothing writes nothing, so the loop's history records
   movement rather than heartbeat.

Only Expected Available, Likely Available and Empty Confirmed are publishable.
`availability_uncertain` produces no entry at all: putting a truck on the empty
board when Antcolos cannot tell whether it is empty is the exact fabrication
this milestone exists to avoid. It stays visible on the tracking board, with its
reason.

### Dispatch tracking

`/dispatch/tracking` is organization-scoped and shows, per load: current
location and route progress, last update time and signal source, ETA and
delivery proximity, live / stale / offline / interrupted / unavailable state,
confirmed versus inferred milestones, delay, route-deviation, geofence and
availability alerts, and the carrier, driver, truck, trailer, load and operating
authority in force at the time.

One dispatch workspace carries several carriers at once with no logout and no
workspace switch — the carriers are chips, because they are a filter over one
board rather than four boards behind a login. The convenience stops at the
entitlement: every row's truck is fetched through the truck registry's own
scope, so a load whose equipment this workspace is not entitled to renders with
no position and a stated reason rather than somebody else's truck.

Freshness is four distinct answers, not one. An established feed that goes quiet
for several times its own cadence reads **interrupted** — it was working and it
stopped — rather than merely stale. Thresholds live in
`src/lib/tracking/freshness.ts` so a screen, a test and an alert cannot disagree.

### Broker tracking

One **Load-scoped tracking session**, providing MacroPoint-style visibility
without copying MacroPoint or claiming an integration with it or anyone else.
Per recipient it mints a revocable, expiring link, and per audience —
broker, shipper, receiver — it carries its own visibility switches.

A link closes by itself: on its own timeout, after delivery plus a configured
grace, on cancellation, and when the carrier relationship behind it ends. That
last one is asked of the truck registry every time a link is resolved, so ending
a relationship anywhere closes every link that depended on it with nothing to
reconcile and nothing to remember. A revoked link is never un-revoked — a new
one is a new token with its own audit line.

What a link holder can see is a separate, smaller type (`PublicTrackingView`),
assembled by redaction. It is not the dispatcher's row with fields hidden,
because a shape that *could* carry a rate eventually will. Rates, driver names
and contact details, hours of service, internal notes, any other load, any other
carrier's data, position history and permanent tracking are **absent from the
type** — there is no switch to turn them on. `NEVER_DISCLOSED` lists them so a
test can assert it and a dispatcher can read it.

Updates follow a configurable policy: `draft_for_approval` holds every update
until a dispatcher approves it, `automatic_mock_handoff` queues it with nobody
in the loop. There is no `delivered` state, because nothing is delivered —
no email, SMS, portal or broker integration is connected to this build, and
every update row says so.

### Integration boundary

Normalized location signals are consumed through the existing ELD & Telematics
boundary. This module starts **no second store of positions**: the one mock
adapter (`src/lib/api/mock/tracking-signals.ts`) reads the fleet layer's own
org-partitioned telemetry readings and the Load module's own
`load.location_reported` events, and holds a labelled fixture inbox of its own
the way any adapter holds an inbound queue.

Adapters are typed and registered for every planned transport — ELD, mobile GPS,
Telegram location sharing, partner API, email and SMS. All of them report
`not_connected`, `unconnectedAdapter` rejects with an honest error rather than
inventing a position, and the tracking board prints the whole list with what
each would populate.

Positions are deduplicated on identity (`signalIdentity`) before anything is
derived from them, so a webhook that fires twice cannot halve the apparent
cadence or inflate a dwell.

**Nothing here is live.** No ELD, GPS tracker, telematics provider, phone,
Telegram bot, email gateway, SMS gateway, geofencing service or broker portal is
connected. Coordinates are approximate city centroids so distance and geofence
logic has something to run on; they are labelled inferred with a mock
provenance and are never presented as observed positions. Every screen says so
on the screen.

### Trying it

Sign in as any membership (the org switcher is top-left), then:

**Availability and the MT Loop**
1. Open **Northline Freight → Tracking**. Five rows, two live.
2. Open **NL-24817**. It reads *Expected available*, *Inferred 70%*. Expand
   *Show the evidence* — six pieces, one of them set aside with its reason.
3. Press **It is empty**. It becomes *Empty confirmed*, *Confirmed by a person*.
4. Go to **Home**. Unit 104's MT Loop row now carries the same decision.
5. Reload Home several times. The board does not grow a second row for unit 104
   — repeated readings of one cycle are one cycle.

**Mock signals** (on any load with a truck, in *Mock adapter controls*)
- *Pass the receiver at 62 mph* → a geofence alert appears saying the reading was
  **not believed**, and availability does not move to empty.
- *Report a position from six hours ago* → the row goes stale and availability
  goes *uncertain*, naming the trust window.
- *Send the last position again* → the position history does not grow; the
  duplicate is collapsed and the decision says so.
- *Silence the feed* → the row goes **offline**; bring it back and it is live again.

**Interrupted and offline, without touching anything**
- Switch to **Meridian Dispatch → Tracking**. Three carriers on one board.
  MD-9042 is *interrupted* (a feed that was reporting every 15 minutes and
  stopped); MD-9038 is *offline* (one position, nine hours old). Both refuse to
  publish an MT Loop entry, because Antcolos cannot tell.

**Broker tracking**
1. On **NL-24817 → Customer tracking**, press *Open tracking on this load*.
2. Add a **Broker**, "Apex Logistics", and press *Issue a link*.
3. Copy the link and open it in another tab. It shows the reference, the stops,
   the truck's city, the ETA, the expiry and the disclosure — and no rate, no
   driver, nothing about another load.
4. Add a **Shipper** and a **Receiver** and open their links: the shipper gets
   the pickup and not the delivery, the receiver the reverse.
5. Back on the dispatcher screen, press **Revoke**. Reload the customer's tab:
   it now says the link was withdrawn. *Issue a new link* mints a different
   token; the old one stays dead.
6. Draft an update and approve it; it appears on the link. Draft one and leave
   it: it does not.
7. Everything above is in **Tracking history** at the bottom, including the
   refused access.

Tracking sessions are mirrored into `localStorage` so a link works when it is
opened in another tab — the rest of the mock layer is in-memory and per page
load, and a token minted in one would not exist in the next. It stores sessions,
their audit and the token index, and nothing else.

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

### Tracking, availability and MT Loop deduplication

`tests/tracking-availability.test.ts`, `tests/tracking-dispatch.test.ts`,
`tests/tracking-broker-link.test.ts` and
`tests/tracking-integration-boundary.test.ts` add 70-odd cases over this
milestone specifically:

- **GPS never confirms** — a truck parked at the receiver, a POD plus a geofence
  exit plus a delivered status, and an *inferred* workflow milestone all fail to
  reach Empty Confirmed; a person's word and a driver's own workflow milestone
  both reach it immediately.
- **Stale signals** — a position older than the trust window stops being
  decided on, and is kept as disregarded evidence with its reason.
- **Missing GPS** — a running load with no position at all is uncertain and
  says which.
- **False geofence inference** — inside the circle at 62 mph, and inside it for
  four minutes, are both rejected with stated reasons and do not move
  availability.
- **Duplicate events** — three copies of one observation are one observation,
  whether they share a source record id or just a place and an instant, and the
  decision reports that they were collapsed.
- **MT Loop deduplication** — publishing repeatedly does not grow the board, an
  unchanged conclusion writes no history line, an uncertain decision is not
  published at all, and a truck another workspace covers is refused.
- **Expired and revoked links** — refused with the right reason, and a reissue
  mints a new token while the old one stays dead.
- **Unauthorized access** — an unknown token, a link after delivery, after
  cancellation, and after the carrier relationship is ended for real through the
  truck registry.
- **Multi-carrier isolation** — one workspace never sees another's loads, a
  driver membership and a membership without `tracking:view` get nothing, and a
  caller who may see loads but not trucks gets the row with no position and a
  stated reason.
- **What a link can never carry** — the public view is serialized and asserted
  against rates, driver identity, hours of service, internal notes, equipment
  identity and every other load in the organization.
