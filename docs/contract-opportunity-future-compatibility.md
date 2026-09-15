# ADR — Contract Opportunity Intelligence: future-compatibility audit

**Status:** Accepted.
**Decision:** **No production code change.** The existing architecture already
carries every extension point a later Contract Opportunity Intelligence module
needs. What is missing is written down here rather than built.

**Audited against:** `main` at the Hierarchical Responsibility, Delegation and
Escalation milestone (`README.md` §"Hierarchical responsibility, delegation &
escalation", `src/lib/api/contracts/responsibility.ts`).

---

## 0. What this document is, and what it is not

It is an audit. It asks one question — *would building Contract Opportunity
Intelligence later force a backend redesign?* — and answers it. It is not a
specification for that module, not a milestone plan, and not a promise that the
module will be built.

**Nothing in this milestone was coded.** No opportunity record, no eligibility
engine, no crawler, no adapter, no store, no route, no navigation entry, no
permission, no Needs You category and no event kind was added. Section 11 lists
every change that was considered and says why each was refused.

**The additional backend work this audit creates for the MVP is zero.**
Everything below is either a description of what the repository already does or
a note about what a future module would add *at the time it is built*.

### A naming collision to settle before anybody writes code

`Opportunity` is already taken. In this repository it means **one load offered
to the market** — `src/types/opportunity.ts`, `src/features/opportunities/`,
`src/app/(app)/dispatch/opportunities`, and the `"opportunity"` member of
`IntegrationModule` in `src/types/integration.ts`. That module's vocabulary is
`Listing`, `OpportunityMatch`, `Draft` and `SearchSession`.

A contract solicitation is a different thing on a different time scale. It must
not be called `Opportunity`. Use **`Solicitation`** (or `ContractSolicitation`)
for the record and **`SolicitationRequirement`** for the extracted line item.
The sample types in the brief that say `ContractOpportunity` and
`OpportunityRequirement` should be renamed on the way in; every other part of
their shape is fine.

---

## 1. Future module boundary

The module is a **reader and a requester**, never an owner of operational fact.

```
 external source ──▶ SourceAdapter ──▶ immutable Source + Revision
                                            │
                                            ▼
                                   extracted Requirements
                                    (evidence, confidence)
                                            │
                     capability resolution  ▼      human review
  canonical modules ────────────────────▶ Evaluation ◀──────────
  (read, never copied)                      │
                                            ▼
                                gaps ──▶ Needs You items
                                            │ (routed by Responsibility)
                                            ▼
                                     Outcome record
```

Four rules the boundary has to keep, all of which the repository already
enforces elsewhere:

1. **It owns the solicitation, its revisions, its extracted requirements, the
   evaluations and the outcomes. Nothing else.**
2. **It never writes a carrier fact.** An expired COI is fixed in Insurance, a
   missing inspection in Maintenance, a missing document in the Document
   Center. The module can only *ask*, exactly as `agreements` can only ask
   (`src/lib/api/contracts/index.ts`: *"It holds no method that creates, alters
   or ends anybody's access … and this one can only ask."*).
3. **It keeps no second copy of carrier data.** See §4.
4. **It raises no task system of its own.** See §7.

---

## 2. Canonical data ownership map

Every fact the future module must read already has exactly one owner. None of
them needs to move, and none of them should be duplicated into a solicitation
record.

| Fact | Canonical owner | Types | Read through today |
|---|---|---|---|
| Operating authority | Carrier profile | `OperatingAuthority`, `authorityAllowsDispatch` in `src/types/carrier.ts` | `src/lib/api/mock/carrier-registry.ts` (`carrierProfile`, `carrierView`); projected per-asset as `FleetAuthorityLock` in `src/types/fleet-operations.ts` |
| MC / DOT and carrier identity | Carrier profile | `CarrierProfile.mcNumber`, `.dotNumber`, `.legalName` in `src/types/carrier.ts` | same registry; `CarrierView` is the relationship-scoped projection |
| Insurance coverage and expiration | Insurance | `InsurancePolicy` (`policyChainId`, `versionNumber`, `effectiveFrom`, `expiresAt`, `supersededByPolicyId`) in `src/types/insurance.ts` | `src/lib/api/mock/insurance-registry.ts` — **no service contract yet**, see §3 |
| Safety and compliance state | Safety & Compliance | `ComplianceRequirement`, `ComplianceRequirementKey`, `ComplianceStatus` in `src/types/compliance.ts` | `ComplianceService` in `src/lib/api/contracts/compliance.ts` |
| Equipment type and capacity | Fleet (over the truck and trailer registries) | `FleetEquipmentRow.truckEquipmentType` / `.trailerType`, `src/types/fleet-operations.ts`; `src/types/truck.ts`, `src/types/trailer.ts` | `FleetService` in `src/lib/api/contracts/fleet.ts` |
| Driver qualifications | Driver profile + Compliance | `DriverProfile.cdlExpiresAt`, `.medicalCardExpiresAt` in `src/types/driver-profile.ts`; `driver.*` keys in `ComplianceRequirementKey` | `FleetService`, `ComplianceService` |
| Driver / truck availability | Tracking and MT Loop | `AvailabilityEvidence`, `AvailabilityEvidenceKind` in `src/types/tracking.ts`; `src/types/mt-loop.ts` | `src/lib/api/mock/mt-loop.ts`, `tracking-board.ts` — **no service contract yet**, see §3 |
| Maintenance readiness | Maintenance | `src/types/maintenance.ts`; summarised as `FleetReadinessSummary` in `src/types/fleet-operations.ts` | `FleetService.equipment()`; registry at `src/lib/api/mock/maintenance-registry.ts` — **no service contract yet** |
| Required documents | Document Center | `DocumentTypeKey`, `DocumentSubjectKind`, `lineageId` / `version` / `supersededByDocumentId` in `src/types/document-center.ts` | `DocumentsService` in `src/lib/api/contracts/documents.ts` |
| Performance history | Reports | `ReportId` — `carrier_lane_performance`, `carrier_broker_performance`, `carrier_truck_performance`, `carrier_equipment_utilization` in `src/types/report.ts` | `ReportsService` in `src/lib/api/contracts/reports.ts` |
| Contract history | Contracts & Relationships | `ContractStatus`, `ContractView`, `ContractRequirement` in `src/types/contract.ts` | `AgreementsService` in `src/lib/api/contracts/agreements.ts` |
| Audit and risk evidence | The one audit ledger; Risk | `AuditEvent`, `AuditEntityRef` in `src/types/audit.ts`; `RiskEvidenceRef`, `RiskCase` in `src/types/risk.ts` | `AuditService`, `RiskService` |

**Consequence for the backend:** a solicitation row stores solicitation facts.
It stores *references* to the rows above and a frozen evaluation (§8) — never a
copy of an MC number, a policy expiry or an inspection date. A copied expiry
date is a date that goes stale silently, and the whole point of this
architecture is that it cannot.

---

## 3. Source-adapter principle

Ingestion is an adapter behind a port. The repository already states the rule in
`src/types/integration.ts`:

> The three things that make that swap cheap are all here: `ExternalRef` — the
> other module's own identifier, kept verbatim. `Provenance` — which system said
> this, when, and how sure it was. `IdempotencyKey` — so a retry across the
> boundary cannot double-write.

So a SAM.gov poller, a forwarded-email reader, an uploaded PDF and a private
procurement connector are four adapters producing one shape. Each carries
`Provenance { module, adapter, mock, observedAt, receivedAt, confidence,
externalId }` and an `IdempotencyKey`, and `IntegrationStatus` lets a screen say
honestly which of them is connected. Adding a fifth source later touches one
adapter and nothing else.

**The source document goes through the Document Center. There is no second one.**
`src/types/document-center.ts` already gives every document an immutable
`lineageId` shared across versions, a `version`, and `supersedesDocumentId` /
`supersededByDocumentId`. *A re-issued solicitation is a new version on the same
lineage* — the revision model the brief asks for already exists and is already
tested. A solicitation PDF lands today as `typeKey: "other"` with a subject of
`kind: "organization"`; if a later milestone wants a first-class type it adds one
`DocumentTypeKey` member, which is what the existing `future?: boolean` types on
`DocumentTypeMeta` were put there to demonstrate.

### The one boundary gap worth Taqi's attention

`AntcolosServices` (`src/lib/api/contracts/index.ts`) has eighteen members. Three
of the facts in §2 are **not** among them: **Insurance**, **Maintenance** and
**MT Loop / availability**, plus the Carrier profile itself. Today 43 files under
`src/features/` and `src/app/` import `@/lib/api/mock/*` directly — including
`src/features/insurance/hooks.ts` and
`src/features/maintenance/maintenance-dashboard.tsx`.

That is a pre-existing condition, not something this audit created, and it does
**not** block the future module: on the frontend a future resolver lives in the
mock layer and can read those registries the same way `compliance-sources.ts`
already does. But it matters to the backend, because it means **three canonical
read surfaces have no agreed interface yet.**

We did **not** add `InsuranceService`, `MaintenanceService` or `CarrierService`
in this audit. Adding them now would be exactly the thing the brief forbids: more
backend contract for Taqi to implement before anything needs it. They should be
added **in the milestone that first needs them through a boundary**, and the
Contract Opportunity module is one candidate for that milestone — not a reason
to do it today.

---

## 4. Capability-resolution principle

**Do not build a `CarrierCapability` table.** Resolve, do not copy.

The repository already has this pattern three times over, which is the strongest
evidence that a future resolver is a fill-in rather than a redesign:

- **`CarrierView`** (`src/types/carrier.ts`) — *"A projection, like FleetTruck:
  derived from the relationship the viewer holds, never stored, and never the
  record itself."*
- **`compliance-sources.ts`** (`src/lib/api/mock/compliance-sources.ts`) —
  *"Compliance owns no people, no equipment, no organizations and no documents.
  This file is the adapter that reads the systems that DO own them … Evidence is
  a POINTER."* A capability resolver is the same adapter with a different
  question.
- **`FleetEquipmentRow`** (`src/types/fleet-operations.ts`) — authority,
  telemetry and readiness composed per asset, derived on read.

### The resolver, when it is eventually written

Responsibility: answer *"what can this carrier prove, as of this instant?"* by
reading the owners in §2 and returning pointers plus values, never copies.

Inputs: `organizationId`; an `asOf: IsoDateTime`; the capability keys requested;
and a **`ServiceContext`** — not the `ServiceAccessContext` in the brief's sample.
`ServiceContext` (`src/lib/api/contracts/context.ts`) already carries
`organizationId`, `workspaceKind`, `membershipId`, a `ReadonlySet<PermissionKey>`,
an `ActorRef` and the record `scope`. Introducing a second context type would
fork authorization, which is the one thing this codebase has been careful not to
do — *"there is no method that takes a User."*

Output: a snapshot whose entries each carry a value, the owning module, the
record id it came from, the observation time, and an expiry where the fact has
one. `ComplianceSnapshot` / `ComplianceSnapshotEntry` (`src/types/compliance.ts`)
is the precedent for freezing such a thing: *"Frozen copies. Never re-read from
the live requirement."* It is taken for a reason, by an actor, at a time.

**The distinction that keeps this honest:** a snapshot is *frozen only when a
decision is recorded against it* (§8). At every other moment the resolver
derives live. A frozen snapshot is evidence of what was believed; it is never
the source of truth about what is true now.

---

## 5. Structured requirements and evidence principle

### Reuse, do not invent

`CanonicalFact<T>` in `src/types/propagation.ts` already carries almost the whole
list the brief asks for:

| Needed | Already there |
|---|---|
| original extracted value | `CanonicalFact.originalValue` — *"Absent means nothing was changed — NOT that the original is unknown."* |
| corrected value | `CanonicalFact.value`, with `verification: "corrected"` |
| extraction confidence | `CanonicalFact.confidence` (0–1); also `Provenance.confidence` |
| reviewer | `CanonicalFact.actor` (`ActorRef`) |
| review state | `FactVerification` — `extracted` / `inferred` / `pending` / `confirmed` / `corrected` / `rejected` / `failed`, plus `FACT_VERIFICATION_NEEDS_PERSON` |
| observation time | `occurredAt` vs `receivedAt`, kept apart deliberately |
| source mechanism | `FactSourceKind` — including `document_extraction` and `document_upload` |
| provenance | `Provenance` (`src/types/integration.ts`) |
| correction lineage | `correctsFactId` — *"Corrections point back at what they correct. History is never rewritten."* |
| org / carrier / authority scope | `FactScope` |

The brief's `reviewStatus: "unreviewed" | "confirmed" | "corrected" |
"needs_review"` is a strict subset of `FactVerification`. **Use
`FactVerification`.** A second review vocabulary is how one word comes to mean
two things, which `ResponsibilitySeverity` was explicitly defined to avoid
(*"Severity shares Needs You's vocabulary so one word never means two things"*).

### The two things `CanonicalFact` does not carry

Stated precisely, with the failure each would cause — and with why neither is
being added today.

**(a) A locator inside the source document.** `CanonicalFact` knows *which*
document a value came from (`Provenance.externalId`, `ExternalRef`), not *where
on the page*. Without a locator, a reviewer checking a machine-extracted
insurance minimum against a 60-page solicitation has to find the clause by hand,
and a disputed reading a year later cannot be pointed at.

The shape already exists: `DocumentRegion { page, xPct, yPct, wPct, hPct }` in
`src/types/rate-confirmation.ts`, used by `ExtractedField.region` so the review
screen can highlight the exact block. A future module should **widen that type
out of `rate-confirmation.ts`**, not invent a parallel one — and should widen it
at the moment there is a second consumer, because a locator for tabular
solicitation data also needs a row and column, and guessing that shape now would
get it wrong. **Not added today: it would be a type with no constructor, no
service and no screen.**

**(b) An expiry on the fact itself.** `CanonicalFact.occurredAt` says when a fact
was true; nothing says when it stops being true. Without it, a capability
snapshot can assert "insured" from a COI that expired last month.

This one is **not actually missing** — it is held by the owners, which is where it
belongs: `ComplianceEvidenceRef.expiresAt` (`src/types/compliance.ts`),
`InsurancePolicy.expiresAt` (`src/types/insurance.ts`), and the document expiry
that `DocumentsService.setExpiry` maintains. A resolver reads expiry from the
owner. Putting a second expiry on the fact envelope would create two answers to
one question. **Not added, and should not be.**

### Requirements as data, not code

`CarrierRule` (`src/types/carrier.ts`) is the pattern to copy: a machine-readable
`kind` plus value **and** a sentence a person can read, because *"neither is
derivable from the other well enough to drop one."* A `SolicitationRequirement`
should carry the same pair, plus `importance` and the evidence above.

---

## 6. Eligibility versus readiness

These are two different questions and the repository already keeps them apart.

- **Eligibility** — *may this carrier bid at all?* Authority, MC age, insurance
  minimums, safety rating. Failing one rules the bid out.
- **Readiness** — *can this carrier actually perform?* Equipment, capacity,
  drivers, maintenance, lane coverage. Failing one is a gap with a remediation.

`MatchCheck` in `src/types/opportunity.ts` is the working precedent, and its
three design decisions all transfer:

```ts
outcome: "pass" | "warn" | "fail" | "unknown"
blocking: boolean          // fails the load outright, vs. warns about it
detail: string             // what was actually compared, in the operator's words
```

> *"`unknown` is a real outcome: a broker with no credit score recorded has not
> failed the credit check, and treating those the same would quietly hide good
> loads."*

That sentence is the single most important thing to carry into contract
eligibility. **"We have not recorded it" is not "we do not qualify."** The same
rule is already built into `OperatingAuthorityStatus`, whose `not_recorded` is
*"Not a claim that it is fine"*, and into `ComplianceEvidenceState`, which
separates `missing` from `rejected`.

`blocking` maps to the brief's `importance: "mandatory"`; non-blocking maps to
`"preferred"`; and `informational` requirements should produce `unknown`-tolerant
checks rather than scores.

**No score, no probability, no ranking model.** `MatchScore` and
`RankingFactorKey` exist for load matching and are deliberately not being reused
here — a contract bid is a slower, human decision, and a number would be
believed before it was earned.

---

## 7. Needs You and Responsibility integration

**A future remediation action enters the existing systems unchanged. No second
task system is needed, and none may be built.**

How it works today, and how a solicitation gap would use it:

1. The module derives a `NeedsYouItem` with `derived: true`
   (`src/types/needs-you.ts`). A derived item *"cannot be assigned, snoozed,
   escalated or resolved, because there is nothing to write to"* — it stops
   appearing when the underlying gap is fixed. A missing COI raised by a
   solicitation evaluation is exactly that: fix the policy and the item is gone,
   with nobody ticking anything off.
2. The item joins the queue the same way Compliance, Insurance, Maintenance,
   Settlements, Contracts and Risk join it — one derivation function added to
   `allItems()` in `src/lib/api/mock/needs-you.ts`. That is the convention; a
   contributor registry was considered and refused (§11).
3. Each item carries `requires: PermissionKey[]` and a
   `NeedsYouRecommendedAction` whose `href` goes *"straight to where the thing is
   FIXED, not to the dashboard it was noticed on."* For a solicitation gap that
   href is the Insurance policy, the Compliance requirement or the Document
   Center slot — **never a solicitation screen**, because the solicitation is not
   where the gap gets fixed.
4. Routing is not the module's business. It emits a `ResponsibilityContext`
   (`src/types/responsibility.ts`) — `functionKey`, `severity`, `scope`,
   `requires`, `dueAt` — and the engine decides who. *"A module says what the work
   IS and what it takes; the routing engine decides who."*

The four guarantees the brief asks about, confirmed against
`src/lib/api/contracts/responsibility.ts`:

- **Team-owned remediation will not overload the Owner's My Needs You.**
  `AttentionViews` separates `myNeedsYou` from `teamOversight` and
  `allOrganization`, and both Home and the Needs You page read that one
  derivation — *"Home and the Needs You page must agree about what needs
  somebody, and the only way to guarantee that is for neither of them to
  decide."* Work held by a dispatcher appears in the Owner's oversight, not their
  to-do list.
- **Owner-only decisions can reach the Owner.** `requestApproval` /
  `decideApproval` for an approval the work cannot finish without
  (`ResponsibilityContext.approvalRequired`), and `requestHelp` for the
  assignee's own escalation. Submitting a bid is an owner decision; the machinery
  is already there.
- **Delegation and escalation remain available.** `delegate` (moves who does it,
  leaves who answers), `reassign`, `changeAccountable`, `escalate` (*"manager
  VISIBILITY and not reassignment"*), plus `EscalationPolicy` and `SlaTarget`.
- **Complete work stays visible through intentional oversight.**
  `allOrganization`, gated by `maySeeTeam`, with `teamOversightApplies`
  distinguishing *"you may not see"* from *"there is nobody."*

**Additive cost when the module lands:** members added to `NeedsYouCategory`,
`NeedsYouEntityKind`, `NeedsYouActionKind` and their exhaustive `Record<>` label
maps. These unions are closed and `Record`-checked, so the compiler names every
site that needs updating. That is an afternoon of additive typing, not a
redesign. `ResponsibilityWorkKind` needs **no** new member: remediation enters as
`needs_you`, which is the point.

---

## 8. Outcome-feedback requirements

**Outcomes belong to the future module, as a bounded aggregate. Not to the audit
ledger, and not to Contracts.**

The reasoning, against the two alternatives actually available:

- **The audit ledger cannot hold them.** `AuditValue` is
  `string | number | boolean | null` and `AuditChangeSummary` carries scalars
  only — *"Audit payloads hold scalars only"*, enforced at the boundary by
  `src/lib/audit/redaction.ts`, which drops objects and arrays with
  `redactionReason: "unsupported_type"`. A frozen capability snapshot and a
  submitted bid are structured documents. The ledger should record *that* an
  outcome was entered, by whom, against which solicitation — and the aggregate
  should hold what it was.
- **Contracts & Relationships should not hold them either.** A *won* bid becomes
  a `Contract` (`src/types/contract.ts`), and that is the right hand-off. But
  *lost*, *withdrawn* and *disqualified* never produce a contract, and those are
  precisely the rows a later Decision Intelligence engine needs. A module that
  only records its wins teaches nothing.

So: a bounded `SolicitationOutcome` aggregate, immutable once written,
preserving exactly the brief's list — solicitation version; the frozen capability
snapshot used; the evaluation; the actions taken; the submitted terms; the
outcome; the reason for loss or disqualification; and a reference (never a copy)
to the resulting contract, so later performance is read from Contracts, Loads and
Reports rather than restated.

It projects into the ledger the way every other module already does
(`AuditProjection` in `src/types/audit.ts`: *"Module histories are PROJECTED into
it through typed adapters … There is no second audit log per module, and there
never will be."*). Adding `"solicitation"` to `AuditModule` and an
`AuditEntityKind` member is the whole integration.

**No learning engine, no score, no probability model, now or in that
milestone.** The aggregate's job is to make one possible later by keeping honest
rows.

---

## 9. Backend ownership and guarantees

The frontend is honest about being a frontend; this section says what is
therefore Taqi's. `docs/zero-entry-data-audit.md` §"Remaining backend
responsibilities" already lists most of it, and none of it changes here.

What the frontend already **shapes**, in `src/types/propagation.ts` and
`src/lib/propagation/bus.ts`:

| Guarantee | Where the contract is stated |
|---|---|
| organization scope | `DomainEvent.scope: FactScope` — org, carrier, dispatch org, operating authority, kept as four fields on purpose |
| actor | `DomainEvent.actor: ActorRef` (a snapshot, readable after the person leaves) |
| aggregate identity | `DomainEvent.subjectId` / `subjectKind` |
| event version | `DomainEvent.version` — *"on the envelope rather than in the kind because a subscriber that only understands v1 must be able to say so out loud"* |
| correlation and causation | `correlationId`, `causationId` |
| idempotency | `idempotencyKey`, and `domainEventId(kind, key)` in `src/lib/propagation/bus.ts` — republishing returns `duplicate: true` and re-runs nothing |
| provenance | `DomainEvent.provenance: Provenance` |
| unknown version handling | a subscriber declares `versions`; anything else is `needs_review`, not a guess |
| failure isolation | one throwing subscriber becomes a `failed` `ProjectionRecord`; the next still runs |

What the frontend **does not and cannot** provide — stated plainly so nobody
mistakes the shape for the guarantee:

- **A transactional outbox.** The bus is a `Map` that lives as long as the tab.
  The backend must write the canonical row and the event in one transaction and
  publish from the outbox.
- **Durable retries and a dead-letter path.** `ProjectionRecord.retryable` and
  `attempts` describe the contract; *"nothing in the frontend retries on a
  timer."*
- **Persistent deduplication.** `idempotencyKey` needs a **unique constraint** in
  the database. An in-memory map is not deduplication.
- **Ordering, and exactly-once delivery.** Neither exists here.
- **Server-side authorization.** The mock enforces permissions at the seam, which
  *"proves the shape the real API must meet"* — it is not enforcement.
  Cross-organization reads must be refused server-side, and a record belonging to
  another organization must come back as not-found, never forbidden, so a 403
  cannot confirm it exists (`tests/invoice-service.test.ts` already asserts this).
- **Durable jobs.** Response deadlines, revision polling and extraction retries
  need a scheduler. `ResponsibilityService` has *"No timers. SLA state and
  escalation level are COMPUTED from the records and the clock on every read."*
  That works for display; it does not fire a reminder.
- **Storage of source documents.** Through the Document Center, with its lineage
  and version rules, and the same review states — not a second file store.
- **Human review of uncertain extraction.** `FACT_VERIFICATION_NEEDS_PERSON` lists
  the four states that still need a person. An extraction below threshold is
  `pending`, reaches a person through Needs You, and is `confirmed` or
  `corrected` with both values kept.

### Events, when the module lands

`DomainEventKind` in `src/types/propagation.ts` is a closed union of three kinds
today, with an exhaustive `DOMAIN_EVENT_LABEL`. A future module adds its kinds
there — `solicitation.discovered`, `solicitation.requirements_reviewed`,
`solicitation.eligibility_evaluated`, `remediation.approved`,
`solicitation.submitted`, `solicitation.outcome_recorded` — and a versioned
payload contract each in `src/lib/propagation/events.ts`, alongside
`LOAD_FINALIZED_VERSION`.

**We did not add them now**, and the repository does not require pre-registration
for a future module to exist: `DomainEventBus.subscribe()` takes any
`ProjectionSubscriber`, and `publish<P>` is generic over the payload. Adding six
unpublishable kinds and six labels today would put six dead entries in a union
the UI reads from, with nothing constructing them — the definition of a
speculative abstraction.

The payload rule, which matters more than the names: *"A payload is what the
SUBJECT'S OWNER guarantees, not what any particular consumer wants … a consumer
that needs a field the owner does not hold has to go and read that other module
rather than have it copied in here."* A `solicitation.eligibility_evaluated`
payload carries the evaluation and references — not the carrier's insurance
detail.

---

## 10. Explicitly deferred scope

Not built, not designed, not stubbed. Listed so nobody later mistakes silence
for an oversight.

- Opportunity discovery, crawling, search, SAM.gov polling, load-board or
  procurement-portal connectors.
- Email ingestion for solicitations.
- Any extraction pipeline, OCR model or LLM call.
- An eligibility rules engine, a scoring model, a win-probability model or any
  AI recommendation.
- Application and bid submission workflow, and any external transmission.
- Solicitation screens, routes, navigation entries, dashboards and mock records.
- New permission keys and permission groups.
- A `SolicitationService` on `AntcolosServices`.
- A `CarrierCapability` store, table or snapshot type.
- `InsuranceService`, `MaintenanceService`, `CarrierService` — see §3.
- A generic document locator type widened out of `rate-confirmation.ts` — see §5.
- Any new `DomainEventKind`, `NeedsYouCategory`, `AuditModule` or
  `AuditEntityKind` member.

---

## 11. Candidate changes considered, and why each was refused

The bar the brief set: a specific missing boundary that would otherwise force a
backend redesign or duplication; small and generic; not already present; not an
unused product feature; no new store, route, screen, navigation entry,
permission group or workflow; and provable with a focused test or a compile-time
contract. **Nothing cleared it.**

| Candidate | Why not |
|---|---|
| Generic `DomainEvidence` with a document locator and expiry | Locator: the shape exists as `DocumentRegion`; widening it now with one consumer would fix the wrong shape (tabular data needs row/column). Expiry: already owned by Insurance, Compliance and the Document Center — a second one would be a second answer. |
| Six `DomainEventKind` members and their payload contracts | The bus does not require pre-registration. Adding them produces dead union members and dead `DOMAIN_EVENT_LABEL` entries with nothing constructing them. |
| `CarrierCapabilityResolver` / `CarrierCapabilitySnapshot` types | Forbidden by the brief, and the pattern already exists three times (`CarrierView`, `ComplianceSnapshot`, `compliance-sources.ts`). Reserved types with no service are the parallel database this audit exists to prevent. |
| `SolicitationService` on `AntcolosServices` | Forbidden by the brief; a complete unused interface for Taqi to implement. |
| `InsuranceService` / `MaintenanceService` / `CarrierService` | Real gap (§3), but adding three contracts today *increases* MVP backend work before anything needs them — exactly what the brief says not to do. Documented instead; belongs to whichever milestone first needs them through a boundary. |
| A Needs You contributor registry, so modules self-register derived items | Speculative abstraction with no current consumer. `allItems()` in `src/lib/api/mock/needs-you.ts` takes one line per module and the ordering comments there exist for a reason a registry would have to re-learn. |
| A `"solicitation"` entry in `ComplianceExtensionPoint` / `RiskExtensionPoint` | These describe extensions *to those modules*. A solicitation is not a compliance record or a risk case, and the entry would prevent no rewrite. |
| Renaming the existing `Opportunity` module to free the name | Large, risky, and touches `src/features/opportunities/`, routes and the `IntegrationModule` union — a refactor with no current beneficiary. Settled by naming the future module `Solicitation` instead (§0). |

---

## 12. Verdict

The architecture is future-compatible. A Contract Opportunity Intelligence
module built on this base is a new bounded module that **reads** through existing
seams, **raises** work through the one Needs You queue, **routes** it through the
one responsibility engine, **stores** its documents in the one Document Center,
**publishes** through the one versioned event envelope and **projects** into the
one audit ledger.

The three things most likely to be got wrong later are not missing types. They
are decisions, and they are recorded here: **do not name it `Opportunity`**, **do
not copy carrier data into it**, and **do not let `unknown` become `fail`.**

**Additional MVP backend workload created by this audit: zero.**
