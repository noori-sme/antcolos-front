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
| Contracts & Relationships foundation | `/contracts`, `/contracts/new`, `/contracts/[contractId]`, `/contracts/[contractId]/versions/[versionId]` |
| ELD & Telematics foundation | `/eld`, `/eld/devices/[deviceId]` |
| Hierarchical responsibility, delegation & escalation | `/work`, `/settings/responsibility` |

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
## The ELD & Telematics foundation

`/eld` is the machine layer **underneath** the fleet. It is the answer to a
question nothing else in Antcolos could answer: where is this truck, how fast,
how far, how many hours, is the key on, what is the engine complaining about, and
how much clock has the driver got left.

It creates no Truck, Trailer, Driver, Assignment, Operating Authority, Load,
Maintenance requirement, Fuel record, Compliance requirement or Needs You bucket.
Those all already exist, it reads them, and it writes to none of them.

### Raw is not normalized

Two stores, never one.

| | What it is | Rules |
|---|---|---|
| `EldRawPayload` | exactly what the provider sent | stored **first**, before anything can fail; never parsed except by that provider's adapter; kept even when the delivery is refused |
| `TelemetryEvent` | Antcolos's own normalized record | always points back at the raw row it came from; append-only; a correction is a new row that names the one it supersedes |

Normalization is an opinion about the evidence. Keeping the two apart is what
makes a normalization bug re-runnable rather than a permanent loss, and what lets
a dispute be settled by looking at what actually arrived.

### Ingestion is idempotent, and nothing is silently deleted

Five things go wrong with real telemetry, constantly. Every one is detected,
recorded, and **kept**:

| Condition | Outcome | Why |
|---|---|---|
| the same event twice | `rejected`, with `duplicate` | a retried webhook or a file uploaded again must change nothing |
| unusable or future timestamp | `rejected` | the arrival time is **never** substituted for a bad source time — that would make the row sort correctly and be wrong about when it happened |
| out-of-order arrival | `flagged` | a buffered signal is real, and is not where the truck is now |
| impossible movement | `flagged`, with the measured mph | usually a device reporting for the wrong unit |
| a meter going backwards | `flagged` | usually a device swap |

`accepted` rows feed everything derived. `flagged` rows are readable and are not
trusted enough to move a snapshot or reach another module. `rejected` rows are
kept for the record and excluded from every derivation. There is no fourth
category called "deleted".

The idempotency key anchors on the provider's own event id when it issues one.
When it does not — the seeded nightly export does not — the key is derived, and
it includes the **signal kind**, because one export row produces a position, an
odometer, an hours reading and an HOS summary that share a device and a
timestamp.

### Bindings are time-bound, and a binding change never rewrites history

A device is not a truck. It moves between them, it is swapped when it fails, and
it spends time bound to nothing. So device→Truck and Driver→device are dated,
half-open intervals that **close** rather than rows that are edited, with a
separate immutable audit of every change.

Every event is attributed **at event time** to the truck, driver, carrier, active
operating authority and load that were in force *then* — snapshotted onto the
event at ingestion, never joined on read. Re-binding a device tomorrow does not
reach backwards and relabel last month. Where a leg cannot be resolved it is left
absent and named in `gaps`: "we do not know who was driving" is always available,
and is better than reaching for today's driver.

### Seven connection states, and none of them collapses into another

`connected`, `syncing`, `stale`, `offline`, `disconnected`, `error`,
`unsupported`. Three are **declared** — a link somebody took down is not "stale",
it is off, and a provider that has no HOS feed is not broken. The rest are
derived from when data last actually arrived, against a per-connection
expectation, so a nightly import and a thirty-second webhook each get a
proportionate answer. Every state carries its reason; a state with no reason is
one nobody can act on.

### Confirmed, Provider reported, Inferred, Corrected, Missing

The most important type in the module. `TelemetryDataQuality` is on every value
this layer produces, shown as a chip beside it and never behind a hover.

- **Confirmed** is reserved for a human act. Nothing in the ingestion path can
  reach it, and a test asserts no machine ever produces one.
- **Inferred** carries a rationale and a capped confidence, and reads in the
  warning colour, because an inference is not a fact.
- **Missing** is a first-class answer. A truck nobody has heard from has a
  location with quality `missing` — not a blank, not a zero, not last week's
  position shown as though it were current.

A GPS fix inside a receiver's fence is never presented as a driver saying they
arrived.

### The snapshot is derived, and the history is untouched

There is no row per truck holding "the current position". `EquipmentTelemetrySnapshot`
is computed on read from the accepted events, every field carrying the event it
came from, its provider, its age and whether that age is past the expectation.
Recomputing it costs nothing and loses nothing.

### Typed signals, published — not sent

Fleet, the Trip Workflow, MT Loop, HOS, Maintenance, Fuel/IFTA and Safety &
Compliance all own their own records, and **none of them is imported by this
module**. It produces typed, addressed, idempotent records and stops.

| Signal | Carries | And deliberately does not |
|---|---|---|
| `fleet.location_availability` | position, speed, motion, ignition | set a fleet status |
| `trip.arrival_departure_inferred` | `suggests`, plus a rationale a driver reads | say anybody arrived — the type has nowhere to |
| `mt_loop.eta_updated` | where it is now | carry an ETA; `etaBasis: "not_computed"`, because routing is not built here |
| `hos.availability_reported` | a clock summary, `isFullLog: false` | pretend to be a record of duty status |
| `maintenance.meter_reported` | odometer, engine hours | move a maintenance requirement |
| `maintenance.diagnostic_reported` | the fault code, `interpretation: "none"` | diagnose anything |
| `fuel.jurisdiction_mileage_observed` | the jurisdiction, `filingGrade: false` | be an IFTA return |
| `compliance.telematics_alert` | disconnection, staleness, a critical fault, movement under inactive authority | raise a violation |

Every signal is `pending_integration` and says so in `stateReason`. Only
`accepted` events publish.

### Needs You

Five rules, each a real inconsistency somebody can go and fix, each disappearing
when they fix it: **stale telemetry**, **broken binding**, **disconnected
device**, **conflicting odometers**, **critical diagnostic**. Stable ids, so they
assign, snooze and resolve like any other item. `source` is `system`, never
`eld` — a rule in Antcolos spotted it; the device did not raise it.

The odometer rule names both disagreeing sources and **picks no winner**:
mileage-based service and jurisdiction mileage belong to Maintenance and to
Fuel/IFTA, and a guess made here would quietly become a number somebody files.

### Access

Eight keys, because there are eight genuinely different powers:

| Key | Opens |
|---|---|
| `eld:view` | the module |
| `eld:devices:manage` | registering devices, linking and unlinking providers (carrier only) |
| `eld:bindings:manage` | device→truck and driver→device bindings (carrier only) |
| `eld:ingest` | the mock provider console (carrier only) |
| `eld:location:precise:view` | exact coordinates rather than the city — **sensitive** |
| `eld:diagnostics:view` | engine fault codes |
| `eld:hos:view` | a driver's clock — **sensitive** |
| `eld:raw:view` | the provider's own payloads — **sensitive** |

On top of that, enforced in the service layer and nowhere else:

- **Relationship and authority scope** come from the truck registry, which
  already reconciles ownership, the carrier relationship, dispatch grants and the
  operating-authority lease. A truck another carrier currently holds is not
  yours to read a position from.
- **Driver privacy** — a driver membership sees the truck it is on, and its own
  clock. Another driver's hours of service are unreachable by any path: the
  snapshot, the event list and the published signals are each checked.
- **Sensitive location** — without the key, a position is reduced to the city the
  provider geocoded and marked `precise: false`. The observation survives; the
  precision does not.
- **Cross-organization isolation** — every registry read is keyed by
  organization, and unknown and forbidden are the same answer.
- **Dispatch organizations and individual dispatchers see nothing by default.**
  They see what a carrier deliberately shared, for the trucks it named, in the
  signal classes it chose — position, meters, diagnostics, hours — and never the
  carrier's devices, its provider links, its raw payloads or the driver's name.
  A dispatch workspace cannot re-share what it was given.

### Nothing is connected

Every provider is a **labelled mock**, and `mock` is the literal `true` in the
type so a fixture cannot quietly claim otherwise. There is no ELD, GPS receiver,
vehicle, FMCSA system or compliance service behind any number on these screens,
every screen says so in a banner, and an unsigned delivery is reported as
`unsigned` rather than upgraded to `verified`.

Four mock providers exist, deliberately different, so the boundary is proven
against more than one shape: a hybrid webhook provider with its own event ids; a
metric-units telematics provider with **no HOS feed at all** (which is what makes
`unsupported` reachable); a nightly file export with **no event ids**; and a
position-only trailer tracker.

Explicitly **not** built, and not faked: real provider authentication, live
tracking, full HOS logs, DVIR, IFTA filing, route optimization, geofence
automation, diagnostic prediction and regulatory certification.

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
  features/             home, needs-you, audit (ledger, signals, cases)
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
    audit/              ★ the ONE ledger's vocabulary: actions, sources,
                          correlation, the redaction boundary, module feeds
    risk/               ★ mock rules, pure evaluation, case state machine,
                          separation of duties, extension points
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

### The audit history is projected, not duplicated

Tracking keeps its own append-only history — every link issued, opened, refused
and withdrawn, every visibility change, every update and every availability
decision, with the provenance behind it. That history stays canonical where it
is, and a `ModuleAuditFeed` projects it into the one shared Audit & Risk ledger
alongside everything else that happened that day. The ledger mints no ids of
its own for it, edits nothing, and is gated on the same `tracking:view` that the
tracking screens are, so projecting cannot show anybody a line they could not
already see.

### The ELD & Telematics module decides who may see a position

Not Tracking. This is the rule the whole integration rests on, and it is
enforced once, in `locationScopeFor`, before any source is consulted.

The ELD module owns the question: it holds each carrier's **explicit per-truck
share records**, it knows which signal classes were granted, and it knows
whether a membership may hold coordinates or only a city name. Tracking reads
through `eldTelemetryForTruckSync`, which goes through that module's own
`truckScopes`, `permittedClasses`, `snapshotFor` and `visibleEvents` — the same
helpers its async service uses. There is no second implementation of a sharing
rule, because two implementations of a sharing rule is one implementation and
one bug waiting to be found by a carrier whose position leaked.

What that changes, concretely: **Meridian sees unit A-12 because Baxter
explicitly shared it, and sees nothing for the Crosswind and Ridgeway trucks on
its other two loads.** That is not a gap — it is the correction. A row whose
truck was never shared reads *unavailable* with the reason, which is a
different statement from *offline*: offline says a feed broke and somebody
should chase it, unavailable says this workspace was never entitled to the
position and there is nothing to chase.

**No fallback may bypass it.** A dispatcher's check-call and the Load module's
own `load.location_reported` events are legitimate positions and they stay — as
labelled fallbacks behind the ELD observations, and behind the same gate. A
dispatch workspace with no share gets nothing from any source, because a
carrier that declined to share a truck did not thereby agree to it being
reconstructed from the notes somebody took on the phone. The fixtures include a
check-call the solo dispatcher typed into their own workspace for a Cascade
truck Cascade never shared with them; it stays blocked, and there is a test that
says so.

**Precise location is granted per truck, by the carrier.** Two gates, and both
must pass:

| Gate | Who sets it | What it says |
|---|---|---|
| `eld:location:precise:view` | The viewer's own organization | Whether this person may hold coordinates at all |
| `EldShare.precisePosition` | **The carrier**, per truck | Which trucks that permission reaches |

Holding the permission does not conjure a grant, and being granted precision
does not substitute for the permission — the same shape the module already uses
for diagnostics and hours of service. The seeded Dispatcher template holds the
permission, because a dispatcher covering a truck needs to know how far out it
is; what it reaches is entirely the carrier's call, truck by truck.

Sharing `position` grants precision by default and the carrier withholds it by
passing `precisePosition: false`. Precision can never be granted without
position — there are no coordinates in a meter reading — and revoking the share
takes both back together. In the fixtures, Baxter shares A-12 with Meridian
*including* coordinates, and Northline shares unit 111 with Summit **without**
them: Summit is told the truck is near Joliet and is not given a driver's
whereabouts to the metre.

Crucially it is scoped to the truck and never to the relationship. A grant on
one truck tells a viewer nothing about another, and precision governs *how well*
a shared truck may be seen — never *which* trucks are visible.

**Its absence is stated rather than blank.** A viewer without coordinates for a
truck gets a city and a state. Route progress, miles to delivery and geofence
proximity are all derived from coordinates, so they are not computed, and the
row says exactly that instead of rendering three empty columns that read as
"nothing is happening". No city-centroid estimate is substituted: a distance
from a centroid would read as a measurement and is not one. The availability
engine records the same thing as evidence it *declined to evaluate*, with the
reason.

The reduction lives in the ELD module rather than in Tracking, so every
consumer inherits it: the snapshot returns `precise: false` with the
coordinates absent, and the event stream withholds them too.

**A public tracking link resolves under the carrier's own authority**, since a
link holder has no membership to scope by. That context holds `eld:view` and
nothing else — it cannot hold `eld:location:precise:view` — so a broker link is
structurally incapable of producing a coordinate however the visibility
switches are set.

### Who owns the ETA

Nobody computes one, and Tracking will not be the first to guess:

| Module | Owns |
|---|---|
| **ELD & Telematics** | Raw observations. Its `mt_loop.eta_updated` signal carries a position and `etaBasis: "not_computed"` on purpose. |
| **Trip / Route Intelligence** (not built) | The computed ETA. |
| **Tracking** | Consuming whatever ETA exists, attributing it, and publishing availability decisions from it. |

Until that module lands, an ETA is the Load module's own `load.eta_updated`
event, or the delivery appointment standing in for one — and every row says
which, because a planned-against ETA that turns out to be an appointment is how
a dispatcher gets caught out. Lateness is only claimed against a **reported**
ETA; an appointment compared with itself is not "on time".

### The receiver geofence stays in Tracking

The ELD module infers arrival from a *motion transition* — "the truck stopped
moving near X" — and has no idea whether X is the receiver. It has no facility
context and should not have one. Tracking knows which stop this load is going
to, so the geofence with its dwell and pass-by guard lives here. ELD supplies
the observation; Tracking supplies the judgement about *this load's* receiver.
They are complementary, and neither should be deleted in favour of the other.

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

**Sharing and precise location — switch to Meridian Dispatch → Tracking**
- Three carriers on one board, and only **MD-9042** shows a position: Baxter
  explicitly shared unit A-12. MD-9031 and MD-9038 read *unavailable* — "this
  truck's position is not shared with this workspace".
- MD-9042 carries miles to delivery and route progress, because Baxter's share
  includes precise position. Its ETA reads "No ETA reported — showing the
  delivery appointment", and claims no lateness.
- Now switch to **Summit Dispatch**. Northline shares unit 111 with Summit and
  **withholds** the coordinates, so Summit is told the truck is near Joliet and
  gets no distance, no route progress and no geofence proximity — with the row
  saying so and naming the permission. Unit 131, which Northline never shared,
  is absent entirely. Same relationship, two trucks, three different answers.
- Open MD-9042 → *Show the evidence* to see what the engine used and what it
  set aside, with the reason for each.

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

## Contracts & Relationships

A **Contract records the terms of a relationship. It is not the relationship.**
That single sentence is the whole design, and the module is built so it cannot
quietly stop being true.

Antcolos already decides access in four separate places, and none of them is
here:

| Concept | What it controls | Owner |
|---|---|---|
| `Invitation` | Proposed access to an organization | Access service |
| `Membership` | A user's access inside an organization | Access service |
| `CarrierRelationship` | A driver's business scope with a carrier | Driver relationship service |
| `Truck`/`TrailerCarrierRelationship` | Which carrier may operate an asset | Equipment registries |
| `Truck`/`TrailerOperatingLease` | Which authority it legally runs under | Equipment registries |
| `TruckDispatchAccess` | A dispatch organization's access to a truck | Truck registry |

A contract holds a typed **reference** to those records and never becomes one.
Signing or activating one may **request** a transition —
`RelationshipTransitionRequest`, whose `applied` field is the literal `false`, so
a later milestone has to change the type in a review rather than flip a boolean.
Nothing in `src/lib/api/mock/agreement-registry.ts` imports a function that could
write to a relationship service.

### Seven records, seven jobs

`Contract` holds identity and parties and **no terms**. `ContractVersion` holds
one immutable statement of them. `ContractParty`, `AuthorizedSigner`,
`ContractSignature`, `ContractRequirement` and `ContractRelationshipRef` are each
their own record, because collapsing any two of them loses an answer somebody
needs: which version was in force in March, who was entitled to sign it, what it
asked for, and which relationship it was about.

- **Nine states.** Draft, pending review, awaiting signature, active, expiring,
  expired, terminated, cancelled, superseded. `terminated` (somebody ended it),
  `cancelled` (it never took effect) and `superseded` (a newer version replaced
  it) are deliberately three different things.
- **`expiring` and `expired` are derived** from the effective dates on every
  read, against the agreement's **own** reminder window. A contract cannot sit at
  "active" a month after it ran out because no scheduled job fired.
- **Signed versions are frozen forever.** `frozen` is set on sign, supersede and
  void, and there is no `unfreeze`. An amendment is a new version citing the old
  one, and which term groups changed is **computed from the terms** rather than
  taken from the caller — so an amendment cannot claim it only moved the renewal
  clause while rewriting the pay.
- **Compensation is terms, not arithmetic.** Rules carry their own effective
  window, and `compensationAt(date)` answers from the version that was in force
  **then**. Settlements keep owning the money and the frozen snapshot.
- **Requirements are evaluated, not stored.** A document requirement is checked
  against the one Document Center; Operating Authority against the carrier
  profile. Fix the document and the row clears without anybody ticking it off.
  The only stored answer is a **waiver**, because that is a decision somebody
  made — and a signature can never be waived.

### What the service layer refuses

Every rule is enforced in `agreement-registry.ts`, not in a screen:

- **No party may sign, approve, amend or terminate for another.** Two gates, in
  order: the `contracts:sign` permission, then live signer authority for *that*
  party. A carrier owner holding every permission in the catalog still cannot
  sign the driver's line. Authority is matched on **membership**, so the same
  person cannot sign both sides from two workspaces, and one membership may be an
  authorised signer for at most one party per contract.
- **Cross-organization isolation.** A contract is only ever read through its own
  organization; the counterparty keeps its own record of the same agreement.
- **Financial visibility.** Compensation rules are **omitted from the payload**
  rather than blanked in the UI, and `compensationVisible` says whether the empty
  array means "not for you" or "none agreed".
- **Relationship scope.** The agreement-type catalog decides which relationship
  kinds a contract may reference. A carrier–driver agreement cannot be pointed at
  an Operating Authority lease, because one that could would read, on screen, as
  though signing it authorised a truck.

### Ending a relationship deletes nothing

Giving notice creates a termination record with the closeout checklist the terms
asked for, and raises transition requests so somebody revokes access **where
access lives**. It revokes nothing itself. What survives is listed in code
(`TERMINATION_PRESERVES`) and shown on the screen: the person's account, every
organization, the permanent truck and trailer records and their UUIDs and
ownership history, this contract and every version and signature, documents and
their review history, and every completed load, invoice and settlement.

`tests/contracts/existing-behaviour.test.ts` is the guard: it creates, signs,
amends and terminates agreements and then asserts a byte-for-byte snapshot of
every canonical relationship record is unchanged.

### Mock only, and it says so

Signatures are typed names with `mock: true` and a statement — stored with the
signature — saying no identity was verified, no e-signature service was used,
nothing was reviewed by a lawyer and nothing was sent anywhere. "Pending review"
means somebody on your team is reading it. Templates, negotiation, legal review,
e-signature, insurance verification and payments are declared seams in
`src/lib/contracts/extension-points.ts`; every adapter throws, and the dashboard
lists them all as *Not connected* with what happens instead.

The module builds no second Document Center, no negotiation workflow, no legal
advice, no court workflow and no payment enforcement.

## The Audit & Risk Foundation

There is **one** audit log. Not one per module — one, for the organization.

Every module already kept a history of its own: a settlement's audit trail, an
invoice's versions, the fuel ledger, a compliance requirement's timeline, a
load's event stream. Those stay exactly where they are and remain the canonical
record of their own module. What this adds is the single place an owner, a
safety manager or an auditor can ask *who did what, across everything, and
when* — built by **projecting** those histories, never by copying or replacing
them.

Three concepts, kept apart on purpose:

- An **Audit Event** records WHAT HAPPENED. A fact. Never edited, never deleted.
- A **Risk Signal** says something MIGHT BE A CONCERN. A judgement from a rule,
  pointing at the events that prompted it. It can be wrong.
- A **Risk Case** is the INVESTIGATION: who is on it, what they found, what they
  decided, and how it ended.

Collapsing any two of them destroys the thing that makes an audit trail worth
having, so the types, the services and the screens keep them separate.

### The ledger

- **Append-only, structurally.** Every field of `AuditEvent` is `readonly`,
  stored events are frozen, and `AuditService` has no `update`, `delete` or
  `purge`. A mistake is fixed with `correct()`, which appends a NEW event
  pointing back at the original. Both stay readable forever.
- **Nothing is erased by an ending.** Ending a relationship, deleting a current
  record or changing ownership appends events; it removes none. One intent that
  touched several modules reads back as one act through its correlation id.
- **Full attribution.** Actor snapshot, organization, membership, action, entity
  reference, source, timestamps (when it happened *and* when Antcolos learned of
  it), correlation id and request id, on every event.
- **Five sources, and they are not the channel.** `human`, `system`,
  `integration`, `imported`, `inferred`. An inferred event is labelled as one
  everywhere it appears, because an inference presented as an observation is how
  an audit trail starts lying.
- **Projection is idempotent.** A projected event's id is derived from the
  producing module plus that module's own entry id, so reading a module's
  history a hundred times appends it once.

### Redaction is enforced at the service boundary

`sanitizeChanges` runs inside the audit service on the way in — not in the
caller, not in the screen. Passwords, tokens, secrets, full bank and card
numbers, government identifiers and document contents never enter a payload, in
any form: the values are not hashed, not truncated and not reduced to a last
four. The **fact** that the field changed is kept, which is the part an auditor
needs. Structured values are refused outright rather than serialized, and text
too long to be a summary is dropped rather than cut. Export views list what was
withheld **by field name only**.

### Signals and cases

- **Eight mock rules**, in `src/lib/risk/rules.ts`. Refused permission-sensitive
  actions; cross-organization attempts; ownership, Operating Authority, signer,
  banking and payout changes; duplicates and conflicts; relationship, contract,
  equipment and assignment churn; repeated rejected uploads and corrections; and
  critical ELD/Maintenance/Insurance/Compliance inconsistencies. Every rule
  carries `mock: true` in its type and its own `limitations` text, rendered
  beside every signal it raises.
- **Signals are derived** from the ledger on every read, with stable ids, so a
  dismissal stays dismissed and a signal never duplicates itself. Dismissing one
  records a judgement *beside* the record and changes no event.
- **Cases** group signals, evidence, decisions and an append-only timeline, with
  five severities and seven states. Resolved, accepted risk and dismissed are
  three different endings, counted separately, because they are the three
  different answers an auditor asks about. Reopening a closed case appends; the
  original decision and its rationale survive.
- **Separation of duties is enforced at the seam.** A membership whose own
  actions a case is about cannot investigate, be assigned, decide or close it —
  Owner included. They may add a note, so they can explain themselves. Policy,
  not the person opening the case, decides when independent review is required:
  every high and critical case.
- **Real Needs You items.** High and critical cases that somebody has been made
  responsible for appear in the one shared queue, derived from the case itself.
  They cannot be snoozed or resolved from the queue — the case is where the work
  happens — and they stop existing when the case closes.

### What this is NOT

Antcolos records what happened inside Antcolos. This is **not** a SIEM, not a
legal case-management system, not an automated enforcement engine and not
tamper-proof legal evidence. There is no fraud model, no risk scoring, no
identity verification, no external monitoring and no regulatory certification of
any kind, and no screen implies otherwise. Security monitoring, fraud detection,
identity verification, legal holds, retention policies and external compliance
tools are declared as typed extension points in `src/lib/risk/extensions.ts`,
every one `available: false`, and listed on screen as "not built yet" rather
than shown as an empty count — because a panel reading "0 fraud alerts" means
Antcolos looked and found none, and Antcolos has not looked.

Cross-module facts that no single module can express — equipment out of service
while dispatched, a policy lapsed under a running load — arrive through the
**centralized mock adapters** in `src/lib/api/mock/audit-sources.ts`, labelled
`mockSource: true`, which travels with the data onto the screen.

## Zero-entry data propagation

Antcolos captures or confirms each fact once, stores it in one canonical
location, and distributes derived information across the workspace. The shape of
that is one flow, and every module speaks it:

```
Input → Extraction candidate → Verification → Canonical record
      → Domain event → Authorized projections
```

- **The fact envelope** — `src/types/propagation.ts`. Every important fact keeps
  its canonical entity UUID, organization and relationship scope, source,
  ORIGINAL value beside the corrected one, confidence, verification state, when
  it happened and when we heard, correlation/causation/idempotency ids, and the
  audit line that proves it. `confirmed`, `corrected`, `inferred`, `pending` and
  `failed` stay visibly distinct on every screen: a geofence suggesting a truck is
  empty and a driver saying so are different things to book a load against.
- **The bus** — `src/lib/propagation/bus.ts`. Publishing the same event twice runs
  nothing twice. Every subscriber runs in its own try/catch, so one failing
  projection cannot block the others. A payload version a subscriber has not been
  taught is `needs_review`, never a guess. Four honest states — **Pending,
  Processed, Failed, Needs Review** — each with an attempt count, a reason and
  whether a retry could help.
- **Who listens** — `src/lib/api/mock/projections/`. One subscriber per
  destination. A projection writes only what its own module owns, through that
  module's own entry point, and never touches the canonical record that produced
  the event.

### One equipment meter, not three

A truck's odometer used to be written in three places with different values for
the same truck: the fleet telemetry store said unit NL-104 read 118,442, the
maintenance registry said 118,450, and the fuel ledger kept a third series. So
mileage was typed into three screens and an oil change never came due from a fuel
receipt.

`src/lib/api/mock/meter-ledger.ts` is now the one canonical ledger, **keyed by the
permanent equipment UUID and nothing else**. Readings are append-only; each
carries its own source, scope, timestamps, confidence and verification state as
metadata rather than as a partition. One accepted odometer and one accepted
engine-hours value are DERIVED from the series on every read — a value below what
was already true for an earlier moment is a regression, kept as evidence and
reported as disputed, never used. The derivation is order-independent, which is
what stopped three modules disagreeing.

Because the key is the equipment and not the organization, **meter history is
never reset or split when ownership, the carrier or the Operating Authority
changes.** A truck that leaves one carrier and joins another keeps one odometer,
because it is one truck.

Maintenance keeps no meter store: `meterFor()` projects from the ledger. Fleet
operations keeps location, which is the fact it owns. Fuel contributes the
odometer off the pump receipt and off the end of a jurisdiction leg. Which is why
an oil change due at 122,000 miles now comes due from a fuel purchase with nobody
typing mileage into maintenance a second time.

### A finalized Rate Confirmation, once

`RateConWorkflow` is canonical *during* review — it is where a person checks every
required field and where the authorized carrier signature is applied. Downstream
modules never read it, because "the rate on this load" cannot be a field somebody
is still editing.

At the single moment all four gates are true — every required field reviewed,
Dispatch approved, the carrier signature applied, the signed copy confirmed as
returned to the broker — the workflow is frozen into an **immutable canonical Rate
Confirmation record** (`rate-confirmation-record.ts`), the canonical Load is
finalized through `loads.applyRateConfirmation`, and **one versioned
`load.finalized` event** is published. Every field keeps what the document said
beside what a person confirmed, so a dispute a year later is argued from the
record rather than from memory. An amendment commits version + 1 pointing back at
what it supersedes; both survive.

Retrying is safe at three levels: the commit is keyed on the signed document, the
finalization on the committed record, and the event id is derived from the same
key. Signing twice produces one record, one event and one run of every projection.

The projections, and what each honestly reports:

| Destination | Outcome |
|---|---|
| Driver Load Post and Trip Workflow | **Processed.** The driver-workflow gate now reads the canonical record, so signing in Dispatch is what unlocks the post. |
| Invoice and Settlement preparation | **Processed.** The signed document satisfies the load's requirement, and the agreed linehaul is frozen for the readiness check — which can now actually fail. |
| MT Loop | **Processed.** The cycle carries the confirmation as evidence: confirmed, not merely booked. |
| Reports | **Processed.** Derived from the canonical records on each run; nothing needed pushing. |
| Broker, Shipper, Receiver, Facility, Contact | **Needs review.** The Directory matches against every canonical record and refuses to create or merge a profile without a person confirming it. A rate confirmation that minted a broker is how a carrier ends up with four profiles for one broker. |
| GPS and Broker Tracking session | **Pending, deliberately.** Minting a link discloses a truck's position outside the organization, so a person opens it with their name on it. |
| Accounting / expected revenue | **Pending.** No accounts-receivable store on this branch; the exact figures it will be handed are queued with an idempotency key. |
| Load documents | **Pending.** The Document Center refuses to create a load-subject document here, and a second document system is worse than an honest gap. |

### MT Loop and Needs You

Daily work happens on two surfaces, and the specialist pages stay as drill-down
destinations rather than mandatory stops.

**MT Loop** answers four questions per truck without opening anything: the
**stage** of its empty-to-empty cycle, the **evidence** behind that stage with each
fact's verification state, the one **next recommended action** deep-linked to where
it is done, and every **unresolved blocker** — a list, not just whichever one
stopped the loop, so a truck owing an expired inspection AND a driver shows both.
All of it derived on every read from records other modules own.

**Needs You** aggregates only actionable human exceptions, assigns them to a
Membership, and deep-links to the resolution — trailers for a missing trailer,
rate confirmations for an unconfirmed load, `/directory/review` for companies
waiting to be resolved. An item exists because its condition does and disappears
when the condition goes, while its snooze, assignee and history survive. Failed
and needs-review projections appear here; `pending` ones deliberately do not,
because nobody can action them and a queue of those is a queue people stop
reading.

### Every mock in one place

`src/lib/api/mock/registry.ts` lists all 40 mock stores with one
`resetAllMocks()`, and `tests/mock-registry.test.ts` fails if a store is added
without registering it.

### What this is NOT

Frontend only. There is no database, no message broker, no persistence, no
transport, no delivery guarantee and no external integration. `idempotencyKey`,
`eventId` and the four handoff states describe the contract a backend must
honour; here they are honoured by a `Map` that lives as long as the tab. Real
authorization, persistence, transactional integrity, exactly-once delivery,
ordering and security are the backend's to enforce.
`docs/zero-entry-data-audit.md` lists every one of those responsibilities and
every remaining mock boundary.

## Hierarchical responsibility, delegation & escalation

Who holds every piece of work in a workspace, who answers for it, and what
happens when nobody acts. It sits over MT Loop and Needs You and owns neither:
both of those keep their records, emit a typed `ResponsibilityContext`, and are
never asked who should do anything.

### Zero friction is the constraint, not a goal

A one-truck Carrier signing up answers **one question — how many trucks** — and
even that is skippable, asked inline on a working screen, and never asked at all
when the truck registry already knows. There is no wizard, no hierarchy step and
no policy to choose. Everything else is derived:

| What is derived | From |
|---|---|
| Team queues, supervisors, escalation levels | Fleet band (`src/config/responsibility.ts`) **AND** how many people are actually in the workspace |
| Who is responsible | Permissions, record scope, asset and carrier assignment, availability |
| Who is accountable | The nearest active supervisor, ending at the Owner |
| Targets and escalation state | The records and the clock, recomputed on every read |

The second column of the first row is the half that is easy to get wrong. A tier
*allows* a capability; the people *decide* it. A forty-truck carrier that has not
invited anybody yet gets no team queue, because a queue you cannot hand work to
is worse than no queue — and the milestone forbids assigning work to people who
do not exist.

### Four roles, kept apart

`Responsible` does the work. `Accountable` owns the result and receives the
escalation. `Approver` signs off. `Watchers` see it, own nothing and are never
escalated to. They are separate fields on `ResponsibilityAssignment` because the
difference is what makes delegation and reassignment different actions:
delegating moves who *does* it and pins who *answers*; reassigning lets
accountability re-derive from where the work lands.

### ★ Three views, and nothing leaks between them ★

The hardest thing in this module, and the one it got wrong first. A Carrier
Owner is accountable for everything in their workspace; if that counts as a
claim on their attention, they open the app to their entire organization. The
first cut did exactly that — **119 of Northline's 145 items in the Owner's
personal queue, and a Home badge reading "142 open"**.

So "can I see it", "do I answer for it" and "does it need me today" are three
different questions with three different answers:

| View | Holds | Is it a to-do list? |
|---|---|---|
| **My Needs You** | work that stops unless *this* person acts | **yes — the only one** |
| **Team oversight** | work held by people they answer for, with health, SLA risk and escalation state | no |
| **All organization** | the complete inventory, for deliberate inspection | no |

`src/lib/responsibility/attention.ts` is the whole of it. Work enters a personal
queue for exactly seven reasons, and for nothing else:

```
responsible             you are the one doing it
owner_fallback          nobody qualified, so it fell to you
needs_assignment        nobody in the workspace can do it at all
explicit_accountable    a PERSON named you accountable, by hand
approval_required       you are the approver and it is waiting on you
escalation_reached_you  a recorded escalation actually named you
help_requested          whoever holds it asked you, by hand
```

What deliberately does **not** put work in somebody's queue, however true: you
hold every permission; you may view the organization; you manage the assignee;
it is critical but somebody is on it and inside SLA; you are an escalation
destination the ladder has not reached; you "answer for" the team.

**"Reached" is a recorded fact, not a computed level.** `escalation.ts` works
out which rungs are *due* from the clock — that is pressure, and it shows as
pressure in Team oversight and At risk. It is not delivery: this is a frontend,
nothing is scheduled and no reminder is sent anywhere, so treating a due rung as
though somebody had been told is the same lie the SLA code is careful not to
tell. It is what put eighty-two overdue items back in an Owner's lap. An
escalation reaches a person when a **person** escalates it, or when the assignee
asks for help — both real events, with an actor, kept on the timeline.

The measured result, on the seeded fixtures:

| Workspace | My Needs You | Team oversight | All organization | Home |
|---|---|---|---|---|
| Northline Owner | **119 → 10** | 132 | 142 | **142 → 10** |
| Summit Owner | 5 → 4 | 16 | 20 | 20 → 4 |
| Cascade driver | 2 | 0 | — | 9 → 2 |

### One derivation, every surface

Home used to build its own Needs You list — everything the membership could see,
sliced to four. Two surfaces filtering separately is how they come to disagree,
so now neither decides: `attentionViewsFor` in `mock/responsibility.ts` is the
single derivation, the Needs You page reads it through
`services.responsibility.attention`, `mockHomeService.summary` builds its
`needsYouPreview` and `needsYouOpen` from the same function, and the nav badge
counts the same set. `tests/responsibility/attention.test.ts` asserts they agree
item for item, for every seeded membership.

**Zero is a good answer on Home.** An Owner who has delegated well should see an
empty Needs You block, and it is never padded with team work or org-wide totals.

### Nothing is called unassigned while naming a person

"Unassigned" was doing two jobs and was wrong about both. Work that fell to the
Owner because nobody else qualified has a name, an accountable membership and a
timeline. The derived states are now `owner_fallback` and `needs_assignment`,
and `counts.trulyUnassigned` — work with no responsible membership at all — is
reported precisely because it should always be zero. An invariant nobody
measures is an invariant nobody notices breaking.

### ★ Escalation is not reassignment ★

The rule the module is built around. When a trigger fires, the original assignee
is **still responsible**; what changes is that somebody above them can see it.
`ESCALATION_ACTION_MOVES_WORK` is the machine-readable form of that sentence,
`movesWork()` is the only place anything asks the question, and **no seeded
policy contains a step that moves work**. A Carrier can add one; Antcolos never
does it for them.

`escalate()` in the service is where this would most plausibly be broken by
accident, so it is worth reading: it adds the accountable membership as a
watcher and touches the responsible membership not at all.

Ten triggers ship on by default, and one of them behaves differently from the
rest. `high_severity` is a *standing condition* — true the moment the work opens
and true however well it is being handled — so it gets one rung at minute zero
(the manager can see it) and never climbs, and it does not count as "escalated".
Without that, every high-severity item in a workspace reads as escalated half an
hour after it appears.

### The one thing that moves work by itself

A membership **ending**. Unresolved work routes to the next eligible membership,
or to the Owner, and nothing is deleted: the timeline gains a line naming who
lost it and why, and another naming who has it now.

Deliberately *not* on that list: being on leave, being off shift, and losing a
permission. All three raise escalation triggers instead. The last one matters
most — a manager handing somebody work on Friday and granting the permission on
Monday is normal, and silently routing it back would undo a decision they made
on purpose.

### Where things are

```
src/types/responsibility.ts        the vocabulary
src/config/responsibility.ts       EVERY threshold and default, in one file
src/lib/responsibility/            the pure engine — no mocks, no stores, no React
  candidate.ts                     what a membership looks like to the engine
  fleet-profile.ts                 the one question, and all it decides
  eligibility.ts                   the hard gate, and the score, kept apart
  routing.ts                       the four roles. Accountable is never absent
  policies.ts                      which policy governs which work
  sla.ts                           two clocks, computed. No timers
  escalation.ts                    triggers and rungs
  queues.ts                        the seven views, and the Owner rule
  timeline.ts                      append-only history
src/lib/api/mock/membership-directory.ts   THE roster — one, not four
src/lib/api/mock/responsibility-context.ts where MT Loop and Needs You emit
src/lib/api/mock/responsibility.ts         the service
src/features/responsibility/               the screens
```

`src/config/responsibility.ts` is the whole of "configurable, not scattered
hardcoded checks": nothing in the engine compares a truck count to a literal or
names an SLA in minutes.

The membership directory replaced **three** hand-written rosters that disagreed
with each other — `MOCK_ORG_MEMBERS` in `home.ts`, and `TEAM_ROSTER` plus
`SEEDED_RESPONSIBILITY` in `mt-loop.ts`. Meridian had different people on
different screens, so "who can I hand this to?" had two answers depending on who
asked. Both now derive from the one directory, and a colleague there is a real
`Membership` run through the real `effectivePermissions` — so nobody can be
eligible for work the product would not actually let them do.

### What this is not

Frontend only, and the limits are worth stating rather than discovering:

- **No timers.** SLA state and escalation level are computed from `openedAt`,
  `acknowledgedAt`, `resolvedAt` and the clock on every read. Close the tab and
  nothing is missed, because nothing was scheduled.
- **No delivery.** A reminder rung and an approval request produce a line on a
  record and a row in a queue. No email, push or Telegram message leaves the app.
- **No enforcement.** The permission checks are the same honest mock the rest of
  Antcolos uses: they make the UI behave correctly and prove the shape the real
  API must meet.
- **No persistence.** Everything lives in memory for the life of the tab.

Every screen in the module says so on the screen, not only here.

## For backend integration

`src/lib/api/contracts/` is the seam. Every method takes a `ServiceContext` carrying the organization, membership, permission set, record scope and an actor snapshot — there is no method that accepts a `User`. The mock adapter enforces permissions and organization ownership itself, so a UI bug that renders a forbidden button still fails at the seam.

Two audit records say what the backend still owns and what it must not be asked
to redesign later:

- `docs/zero-entry-data-audit.md` — where data enters, which facts are
  canonical, and the persistence, ordering, delivery and authorization
  guarantees the frontend describes but cannot provide.
- `docs/contract-opportunity-future-compatibility.md` — whether the current
  architecture blocks a later Contract Opportunity Intelligence module. It does
  not, so nothing was built: the record is the canonical data ownership map, the
  source-adapter and capability-resolution principles, and the list of changes
  that were considered and refused.

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

### Responsibility, delegation and escalation

`tests/responsibility/policy-engine.test.ts` and
`tests/responsibility/scenarios.test.ts` add 77 cases. The first runs against the
pure engine and never touches a store, which is what lets it prove the workspace
no fixture can supply — a brand-new one-truck Carrier with nobody in it but its
Owner. The second runs every scenario through the real service, so it fails if
MT Loop or Needs You ever stop emitting responsibility context.

- **A new one-truck Carrier with no setup** — solo tier, no team queue, no
  supervisors, one escalation level, and the work still routed and still owned.
- **Thresholds are configuration** — the engine agrees with `FLEET_BANDS` for
  every band, so editing the config moves the product.
- **Capability needs people** — a forty-truck workspace with one member gets no
  team queue; queues and supervisors switch on as colleagues arrive, with nobody
  asked anything.
- **Never a role name** — a "Senior Operations Director" without the permission
  is refused; an empty carrier list means *not narrowed*, never *narrowed to
  nothing*; a driver membership is refused dispatch work whatever it holds.
- **Stable ordering** — the same state ranks the same way twice, so a board does
  not reshuffle while somebody reads it.
- **Nothing is ownerless** — every assignment in every workspace, for eight
  different memberships, has a responsible AND an accountable membership with a
  reason attached.
- **Carrier delegation** — Baxter's truck routes to the dispatcher who holds
  Baxter, with source `delegation`; a dispatcher holding a different carrier is
  refused `out_of_scope` and **not** `missing_permission`, which is the
  distinction that proves it is scope and not access.
- **Cross-organization isolation** — one workspace never sees another's work,
  and reassigning to a membership in another workspace gives the same answer as
  a membership that does not exist.
- **Owner oversight without overload** — routine delegated work is absent from
  the Owner's personal queue and present in the organization view, and the Owner
  is still accountable for every item kept out of it.
- **Escalation moves nothing** — an escalated item's timeline has no
  `reassigned` line, and escalating by hand leaves the responsible membership
  exactly where it was while adding the accountable one as a watcher.
- **Assign ahead of a permission** — a manager may hand somebody work before
  granting the permission; it raises `missing_permission` rather than being
  silently routed back.
- **Assignee removal** — work moves to the next eligible membership, the source
  becomes `fallback`, and the timeline keeps both the person who lost it and the
  person who has it. Being merely *away* does not move anything.
- **The timeline is append-only** — every earlier entry is byte-identical after
  three more actions, and a name still reads after the person has left.
- **Progressive disclosure** — policies are seeded without anybody choosing,
  editable by an Owner, refused to a dispatcher, and there is no `deletePolicy`
  method at all.

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
- **One ledger** — tracking lines are projected into the shared audit ledger
  keeping the tracking module's own entry ids and action keys, a refused link
  access projects as a denial, and a caller without `tracking:view` gets none
  of it.

### The ELD boundary (`tests/tracking-eld-boundary.test.ts`)

- **Sharing isolation** — a shared truck reports, an unshared one reads
  *unavailable* with the reason and no city, no timestamp and no source; a
  carrier needs no share record for its own trucks; and a membership without
  `eld:view` gets nothing at all.
- **Fallback security** — a check-call, a load-timeline event and a simulated
  position are each written for an unshared truck and each fail to surface,
  while the same sources keep working where the truck IS in scope.
- **Permission gating, per truck** — a carrier that shares a truck *with*
  precision yields coordinates; one that withholds it yields
  `precision: "city_only"` with no coordinate on any signal, no route progress,
  no miles, no geofence alert and a note naming the permission. A grant on one
  truck leaks nothing to another, revoking the share takes the coordinates
  back, precision is never granted without position, a dispatch workspace
  cannot re-share what it was given, and a membership whose permission was
  revoked gets a city even where the carrier granted coordinates.
- **Source precedence and provenance** — ELD wins, every position carries its
  transport and a mock-labelled adapter, an ELD-sourced signal carries the
  event id it came from, and a provider's confidence is never raised.
- **Deduplication** — reading twice does not double the run, and three
  simulated copies of one observation collapse to one.
- **ETA attribution** — a reported ETA is named as such, a standing-in
  appointment is named as such, and no lateness is claimed from an appointment
  compared with itself.
- **Public links** — a broker link resolves under the carrier's authority and
  the serialized view contains no coordinate.

Contracts add 201 of their own, split between the pure domain and the seam:

- **Domain** (`src/lib/contracts/*.test.ts`) — the status machine, version
  immutability and the deep clone that stops an amendment reaching the version it
  came from, signer authority, notice periods, renewal maths, compensation
  validation in whole cents, and the relationship boundary.
- **Seam** (`src/lib/api/mock/agreements.test.ts`) — permissions, cross-
  organization isolation, "no party signs for another" from both sides, financial
  omission, what a point-in-time compensation read answers, the whole lifecycle,
  and that signing raises a request and changes no relationship.
- **Needs You** (`agreement-needs-you.test.ts`) — every item is derived, has a
  stable id, and stops existing when the underlying state is fixed.
- **Existing behaviour** (`tests/contracts/existing-behaviour.test.ts`) — the
  canonical-record snapshot guard described above, plus the permission keys and
  routes that worked before still working.

### Zero-entry data propagation

```
npm test
```

- `tests/propagation-bus.test.ts` — publishing twice runs nothing twice, one
  failing projection cannot stop the others, an unknown payload version is a
  question, a failure retries without republishing the event.
- `tests/meter-ledger.test.ts` — the seeded series climbs with no disputes, the
  accepted value is derived and order-independent, a backwards reading is kept
  and not used, a correction appends, and history is never reset or split when
  the carrier or Operating Authority changes.
- `tests/rate-confirmation-propagation.test.ts` — the whole flow, from an MT Loop
  to a signed confirmation: one immutable record, one event, one Driver Load
  Post, nothing double-run on retry, and a reason on every projection that is
  not `processed`.
- `tests/fuel-propagation.test.ts` — one receipt, one transaction, one event;
  both values kept on a correction; and an oil change moving from a fuel purchase
  with nobody re-entering mileage.
- `tests/mt-loop-needs-you.test.ts` — every card carries a stage, its evidence
  and its blockers; a stopping problem outranks finding work; every Needs You item
  deep-links to where it is fixed; an item disappears because its condition did.
- `tests/mock-registry.test.ts` — reads the mock folder and fails if a store was
  added without being registered.

### Audit & Risk

`tests/audit/` covers the rules that make the ledger worth having rather than
the screens that show it:

- **Append-only** — no update or delete path exists, stored events are frozen, a
  correction appends and leaves the original byte-identical, and an ending never
  erases the history that led to it.
- **Redaction at the boundary** — passwords, tokens, full account numbers and
  document contents never reach the ledger however a caller passes them, the
  safe half of the same change survives, and an export lists withheld fields by
  name only.
- **Projection** — reading a module's history repeatedly appends each entry
  once, the module keeps its own record id and action key, and reading it does
  not change it.
- **Organization scope** — one organization's events and cases are never served
  through another, and another organization's event is `NotFoundError` rather
  than "forbidden", because a 403 would confirm it exists.
- **Permissions** — reading, exporting, viewing risk, assigning, investigating
  and closing are six separate powers, and a refusal is recorded even for a
  membership that may read nothing.
- **Separation of duties** — the subject of a case may open it and add a note,
  and is refused investigation, assignment, decisions and closure on it, Owner
  included.
- **Signals are not events** — signals point at events rather than restating
  them, dismissing one leaves every event untouched, and the dismissal stays
  across re-derivation.
- **Needs You** — assigned high and critical cases land in the one shared queue,
  are gated on `risk:view`, cannot be snoozed or resolved from the queue, and
  stop existing when the case closes.
`tests/eld/` covers the telematics foundation the same way:

- **Ingestion** — idempotency across deliveries and *within* one, duplicates,
  unusable and future timestamps, out-of-order arrivals, impossible jumps, meter
  regressions, unregistered devices, unsupported signals — and that every
  refused row is still on file with its raw payload.
- **Attribution** — events resolve to the truck, driver, carrier, authority and
  load in force at event time, gaps are named rather than guessed, and re-binding
  a device leaves every historical event saying exactly what it said before.
- **Access** — the eight keys, relationship and operating-authority scope,
  driver privacy, sensitive location reduction, cross-organization isolation, and
  a dispatch workspace seeing only what was explicitly shared.
- **Signals** — every handoff is pending, nothing is transmitted, no machine ever
  produces a `confirmed` value, and the four refusals (`etaBasis`, `filingGrade`,
  `isFullLog`, `interpretation`) hold.
- **Snapshot** — derivation mutates nothing, missing is not zero, and flagged and
  rejected rows never move a value.
- **Existing behaviour** — the fleet layer, its own telemetry store, the
  permission catalog, the service registry and the unimplemented HTTP seam are
  all exactly as they were.
