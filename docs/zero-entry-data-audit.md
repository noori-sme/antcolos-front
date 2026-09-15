# Zero-Entry Data Propagation — Phase 1 Audit

Branch: `claude/antcolos-data-audit-hulw2d`, taken from `main` at `75414e9`.

This is an audit of the **frontend** only. Nothing here is a backend, a database,
an event bus, a queue or an integration. Where this document says "event",
"projection" or "idempotent", it means a typed in-memory contract the backend can
later implement without the UI changing — not a guarantee this build provides.

Baseline on `main` before any change: `tsc --noEmit` clean, `eslint` 0 errors
(3 pre-existing warnings), 514/514 tests pass, `next build` succeeds.

---

## 1. Where data enters the frontend

| Entry point | Module | Typed seam? | Notes |
|---|---|---|---|
| Rate confirmation email → OCR-shaped extraction → field verify/correct → sign | `mock/rate-confirmation.ts` | **No service contract.** Called directly from `features/rate-confirmations/*` | The only place the carrier signature is applied |
| Opportunity search → match → negotiate → book | `mock/search-session.ts`, `opportunity-matching.ts`, `negotiation.ts`, `booking.ts` | **No service contract.** Called directly from `features/opportunities/*` | `bookNegotiation` is where a canonical `Load` is born |
| Fuel purchase / mileage record / correction | `contracts/fuel.ts` → `mock/fuel.ts` | Yes | `recordTransaction`, `correctTransaction`, `recordMileage`, `correctMileage` |
| Document upload / review / expiry | `contracts/documents.ts` → `mock/documents.ts` + `document-store.ts` | Yes | Upload is an honest mock: name/type/size only |
| Telemetry reading (location, odometer, engine hours) | `contracts/fleet.ts` → `mock/fleet-operations.ts` + `fleet-telemetry.ts` | Yes | `recordTelemetry`, append-only |
| Maintenance meter reading, defect report, service completion | `mock/maintenance-registry.ts` | **No service contract.** Called directly from `features/maintenance/*` | `recordMeterReading` enforces a monotonic odometer |
| ELD device ingest (raw → normalized → signals) | `contracts/eld.ts` → `mock/eld.ts` + `eld-registry.ts` | Yes | Publishes signals; writes to no other module's records |
| Driver proposal response, trip milestones, trip documents | `contracts/driver-workflow.ts` → `mock/driver-workflow.ts` | Yes | Behind `lib/integrations/ports.ts` for everything it does not own |
| Tracking session open / recipients / updates | `mock/tracking-registry.ts` | **No service contract.** Called from `features/tracking/*` | Broker links, public tracking |
| MT Loop claim / assign / pause / block / close / publish availability | `mock/mt-loop.ts` | **No service contract.** Called from `features/mt-loop/*`, `features/home/*` | Reconciled on every read |
| Invoice create / line items / issue / submit / payment / dispute | `contracts/invoices.ts` → `mock/invoices.ts` | Yes | |
| Settlement review / approve / adjust / pay | `contracts/settlements.ts` → `mock/settlements.ts` | Yes | |
| Compliance resolution, insurance policy/claim, agreements, risk cases, access | mixed | partly | `compliance`, `agreements`, `risk`, `audit` have contracts; `insurance-registry`, `carrier-registry`, `party-registry`, `driver-registry`, `truck-registry`, `trailer-registry` do not |

**Finding E1.** Eleven of the twenty-eight mock stores are reached by feature
components through direct module imports rather than through
`AntcolosServices`. `AntcolosServices` has no `mtLoop`, `rateConfirmation`,
`tracking`, `maintenance`, `insurance`, `booking` or `opportunities` member, so
those modules have no backend seam at all: swapping in an HTTP adapter would
still leave the UI importing `@/lib/api/mock/*`. 31 such imports exist in
`src/features`.

---

## 2. Canonical entities and their identifiers

| Fact | Canonical record | Identifier | Owner today |
|---|---|---|---|
| A load | `Load` | `Load.id`, opaque | `mock/store.ts` `OrgData.loads` |
| A load's history | `LoadEvent[]` | `LoadEvent.id` | `mock/store.ts` `OrgData.events` |
| A truck / trailer | `FleetTruck`, `FleetTrailer` | permanent asset id | `truck-registry.ts`, `trailer-registry.ts` |
| A driver | `DriverProfile` | `driverProfileId` | `driver-registry.ts` |
| A document (per version) | `Document` | version UUID + lineage UUID | `document-store.ts` |
| One truck's empty-to-empty cycle | `MtLoop` | `loopId`, RFC-4122 v4, never reused | `mt-loop.ts` |
| A fuel purchase | `FuelTransaction` | `id` per revision + `revision.originalId` | `fuel-store.ts` |
| A maintenance requirement | `MaintenanceRequirement` | `id` | `maintenance-registry.ts` |
| An audit event | `AuditEvent` | `id`, deterministic for projections | `audit-ledger.ts` |
| A needs-you item | `NeedsYouItem` | derived: `ny_d_{org}-{ruleKey}` | `needs-you-derive.ts` + `store.ts` |
| A rate confirmation workflow | `RateConWorkflow` | `rateConId` | `rate-confirmation.ts` |
| A tracking session | `TrackingSession` | `sessionId` | `tracking-registry.ts` |
| An invoice | `Invoice` | `invoiceUuid()` | `invoice-registry.ts` |
| A settlement | `Settlement` | `id` | `settlement-registry.ts` |

This part is genuinely good. Identifiers are opaque, permanent, and versioned
where versioning matters (documents per version + lineage, fuel per revision +
original).

---

## 3. Duplicated or conflicting facts

### D1 — Truck odometer and engine hours: three stores, conflicting values

The same physical fact is written in three places, with no relationship between
them:

| Store | Shape | Truck `NL-104` odometer |
|---|---|---|
| `mock/fleet-telemetry.ts` | `FleetTelemetryReading.odometerMiles` | **118,442** |
| `mock/maintenance-registry.ts` | `EquipmentMeter.latest: MeterReading` | **118,450** |
| `mock/fuel-store.ts` | `FuelTransaction.odometerMiles`, `MileageRecord` | a third, per-purchase series |

A fourth producer exists and deliberately writes nowhere:
`lib/eld/signals.ts` emits an `odometer` signal and its own comment says "it
does not move an odometer on a maintenance requirement".

Consequences visible in the product today:

- Recording a fuel purchase with an odometer reading does **not** advance any
  maintenance requirement. An Oil Change due at 122,000 mi stays "In 3,550 mi"
  no matter how much fuel is bought.
- Recording a telemetry reading in Fleet Ops does **not** advance maintenance
  either, and vice versa.
- The user is asked for mileage on three different screens: Fleet Ops
  "record reading", Maintenance "record reading", and the fuel purchase dialog.

This is the single clearest violation of the zero-entry principle in the
codebase, and it is a **canonical-ownership conflict** — three existing modules
each claim the same fact. Per instruction, this is escalated rather than decided.

### D2 — "The rate confirmation for this load": four representations

| Representation | Where | Used by |
|---|---|---|
| `RateConWorkflow` — the real review/correct/sign/return workflow | `mock/rate-confirmation.ts` | Dispatch screens, `needs-you-derive.ts` |
| `RateConfirmationState` — `reviewedByDispatch` / `carrierSignature` / `sentToBroker` | `lib/integrations/mock/fixtures.ts` `RATE_CONFIRMATIONS`, a **hardcoded table keyed by load reference** | `driver-workflow-finalize.ts` — the finalization gate |
| `ConfirmedRateConfirmationInput` with a **synthesized** id `rcon_${load.id}` | `mock/invoice-sources.ts` | invoice readiness, linehaul comparison |
| `Load.documentRequirements[kind=rate_confirmation].satisfiedByDocumentId` | `Load` | load detail, missing-document rules |

Consequence: **signing a rate confirmation in Dispatch does not unlock the
Driver Load Post.** `finalizeLoad` reads the fixture table, not the workflow.
Conversely `RATE_CONFIRMATIONS` reports `CS-3318` as reviewed/signed/sent even
though no `RateConWorkflow` for it was ever confirmed by a person. Likewise the
invoice's "linehaul matches the rate confirmation" check compares against
`load.financials.linehaulCents` — which `rate-confirmation.ts` has already
overwritten — so the check can never fail.

This is also a canonical-ownership conflict and is escalated.

### D3 — Direct cross-module writes into the canonical `Load`

`LoadsService` is **read-only by design** (`contracts/loads.ts`: "Mutations …
are deliberately absent until the backend defines their rules"). So two modules
reach around it and mutate the record in place:

- `mock/rate-confirmation.ts` `applyToLoad()` — writes `customerReference`,
  both stops' `facilityName` and `address.line1`, `financials.linehaulCents`,
  `totalRateCents`, `ratePerMileCents`, `documentRequirements[].satisfiedByDocumentId`,
  `status`, `updatedAt`.
- `mock/booking.ts` `bookNegotiation()` / `recordDriverConsent()` — pushes a new
  `Load` and `LoadEvent[]` onto `org.loads` / `org.events` directly, and writes
  `load.status` on consent.

Neither appends through a typed command, neither carries an idempotency key
scoped to the intent, and neither emits an event any other module can consume.
`types/event.ts` states that `Load.status` is "a DERIVED convenience … The
timeline is the record" — but both writers set `status` directly, and
`rate-confirmation.ts` sets it without appending a `LoadEvent` at all.

### D4 — `distribute()` is a narrative, not a projection

`rate-confirmation.ts` `distribute()` returns nine `DistributionOutcome` rows.
One (`load_record`) is `written`. The other eight are `queued` with prose like
"Waiting for the accounting module" and `waitingForMilestone: 12`.

Every one of those eight destinations now exists on `main`:

| `distribute()` says | Actually exists on main |
|---|---|
| "Waiting for the accounting module" | `contracts/invoices.ts`, `contracts/settlements.ts` |
| "Waiting for dispatch and pickup" (driver notification, trip) | `contracts/driver-workflow.ts`, `driver-workflow-finalize.ts` |
| "belongs to the profile module" (broker/shipper/receiver) | `mock/party-registry.ts`, `mock/directory.ts`, `lib/directory/matching.ts` |
| detention / layover rules "waiting for in transit" | `mock/tracking-registry.ts`, `types/tracking.ts` |

So the screen tells a dispatcher that eight modules received nothing, when four
of them are merged and could receive a typed projection today. The states are
also not the ones the milestone asks for: there is no `failed` and no
`needs_review`, and no retry contract — `DistributionOutcome` has no
idempotency key, no attempt count and no error.

### D5 — Handoff vocabulary is missing two states

`types/integration.ts` `HandoffState` is `pending_integration | delivered |
rejected`. The milestone requires **Pending, Processed, Failed, Needs Review**
with retry-ready contracts. `PendingIntegrationEvent` has an `idempotencyKey`
but no attempt count, no `failedReason` distinct from `stateReason`, and no
"retry" affordance on the port.

### D6 — Twenty-eight uncoordinated mock stores

28 modules hold their own module-level `let state` / `Map`, exposed through 38
separate `reset*()` functions. There is no registry, so:

- a test that needs a clean world must know and import all 38;
- nothing can reset "everything" for a demo;
- adding a store is invisible to every existing test.

`AGENTS.md`-level instruction "centralize mocks and make every adapter
replaceable" is not met, though the *adapters* are individually replaceable.

### D7 — `NeedsYouEntityKind` carries merge scars

`types/needs-you.ts` `NeedsYouEntityKind` repeats `"load" | "truck" | "driver" |
"document" | "customer" | "settlement" | "invoice"` six times — the union was
concatenated by six branch merges rather than merged. TypeScript dedupes it, so
it is cosmetic, but it hides what the real set is.

---

## 4. What is already correct, and must not be rebuilt

- **The audit ledger.** `mock/audit-ledger.ts` is append-only, frozen on write,
  organization-partitioned, and `append()` is **idempotent by deterministic id**
  (`lib/audit/ingest.ts` `projectionId(module, entryId)`). Modules expose typed
  feeds and the ledger projects them; no module keeps a second log. This is
  exactly the mechanism the milestone needs, already built.
- **Correlation.** `lib/audit/correlation.ts` has `newCorrelationId()`,
  `newRequestId()`, and `withCorrelation()` so one intent's events join across
  modules. Unused by the rate-con and booking paths.
- **Provenance.** `types/integration.ts` `Provenance` already carries module,
  adapter, `mock: boolean`, `observedAt`, `receivedAt`, optional `confidence`
  and the source's own `externalId`. `ExternalRef` keeps the other module's id
  verbatim. `IdempotencyKey` exists.
- **Needs You is derived, not authored.** `needs-you-derive.ts` reconciles on
  every read against live records with a stable per-condition key; fixing the
  condition removes the item, and snooze/assignee/history survive regeneration.
  Sixteen rule families already feed it (MT Loop, trucks, documents, loads,
  fuel, compliance, maintenance, insurance, invoices, settlements, drivers,
  negotiations, drafts, reviews, rate-cons, ELD).
- **MT Loop is reconciled, not stored by hand.** One open loop per truck
  globally; one responsible workspace decided by the records; responsibility is
  a dated `MtLoopAssignment`, never an overwritten field; `cycleKey`
  deduplicates one truck going empty into one board entry.
- **Fuel corrections preserve both values.** A correction writes a *new*
  `FuelTransaction` revision and marks the original `corrected` /
  `isCurrent: false` with `supersedesId` / `supersededById`; the original keeps
  its own audit and stays readable. Same for mileage. A correction inside a
  filed IFTA quarter becomes an amendment.
- **Maintenance derivation is pure.** `lib/maintenance/triggers.ts` derives
  state from `(trigger, latest meter, now)` with no store and no clock of its
  own, and refuses to answer an unanswerable question (mileage rule with no
  odometer → `upcoming` + `unknown: true`, never overdue and never fine).
  Oil-change status would already follow mileage **if it were reading the same
  odometer everyone else writes** — see D1.
- **Organization scoping.** Every store accessor requires an `organizationId`
  and throws `OrganizationScopeError` across the boundary.
- **The integration boundary** (`lib/integrations/ports.ts`) is a real contract
  with labelled mock adapters and a runtime `status()` a screen can render.

---

## 5. Which screens consume which fact

| Fact | Canonical owner | Consumed by |
|---|---|---|
| Load (stops, rate, requirements) | `store.ts` `OrgData.loads` | Loads list/detail, Driver load post + trip, Invoices, Settlements, Tracking, Reports, Needs You, MT Loop card, Dispatch workspace, Audit |
| Rate confirmation state | **contested (D2)** | Dispatch rate-con review, Driver finalization gate, Invoice readiness, Needs You, Load detail |
| Truck odometer / engine hours | **contested (D1)** | Maintenance dashboard + requirement detail, Fleet Ops asset screen, Fuel MPG/IFTA, Needs You |
| Fuel transaction | `fuel-store.ts` | Fuel dashboard, transactions, mileage, IFTA, Reports, Needs You, Audit |
| Truck availability / empty-to-empty stage | `truck-registry.ts` → `mt-loop.ts` | MT Loop board on Home, Dispatch trucks, Tracking availability, Needs You |
| Document (per version) | `document-store.ts` | Document center, driver/truck/trailer/org checklists, Compliance, Invoices, Loads, Needs You |
| Audit event | `audit-ledger.ts` | Audit dashboard/events/cases/signals, per-record history panels |

---

## 6. Safest refactor sequence

Ordered so every step is independently shippable and no step needs the next one
to be correct.

1. **Vocabulary, additive only.** Extend `HandoffState` with `processed`,
   `failed`, `needs_review`; add attempt/error/retry fields to
   `PendingIntegrationEvent`; add a `CanonicalFact` provenance envelope
   (entity UUID, org + relationship scope, source, original value, corrected
   value, confidence, verification state, `occurredAt`/`receivedAt`,
   correlation/causation/idempotency ids, audit ref). No behaviour change.
2. **One domain-event bus contract + in-memory mock.** Typed, versioned events;
   subscriber failures isolated; per-subscriber handoff state; idempotent by
   `(eventId, subscriber)`. No producers yet.
3. **A typed write seam for `Load`.** Add the mutation commands
   `contracts/loads.ts` currently withholds, backed by the existing store, so
   `rate-confirmation.ts` and `booking.ts` stop writing the record directly.
   Behaviour preserved exactly; the two callers move onto the seam.
4. **Central mock registry.** One module that registers all 28 stores and
   exposes one `resetAllMocks()`; existing `reset*` functions stay exported.
5. **`LoadFinalized`.** Emit one versioned event from the single moment the
   carrier signature is applied, under one correlation id and one idempotency
   key. Replace `distribute()`'s prose rows with real projections onto the four
   merged destinations + honest labelled adapters for the rest.
6. **Resolve D2 (pending decision).** Point `integrations.loadSource
   .getRateConfirmation` and `invoice-sources.rateConfirmationInput` at whichever
   module is chosen as canonical.
7. **Resolve D1 (pending decision).** One canonical equipment-meter fact;
   maintenance, fuel and fleet-ops become contributors and readers.
8. **`FuelTransactionConfirmed`.** Emit from record/correct/verify; project to
   fuel cost, load/truck expense, MPG, IFTA, accounting, reports, audit, needs
   you — and to the meter, once step 7 lands.
9. **MT Loop stage + evidence + next action**, and **Needs You deep links**,
   read off the projections rather than re-deriving.
10. **Service registry**: expose the direct-import modules through
    `AntcolosServices` so they have a backend seam.

Steps 6 and 7 are blocked on the two ownership decisions above.
