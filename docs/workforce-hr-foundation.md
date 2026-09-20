# Workforce & HR foundation

## What this milestone added, and what it deliberately did not

Antcolos already knew almost everything about a person who works for an
organization. It did not have one place that answered the question a carrier is
actually asked:

> On what basis, in what capacity, from what date and in what status does this
> person work with this organization?

Every neighbouring record was asked, and every one of them said no. `User` is
the permanent person and deliberately has no organization, role or permission.
`Membership` is ACCESS — an external auditor holds one and works for nobody, and
a yard hand may work here with none. `DriverProfile` is the permanent
professional person. `CarrierRelationship` is a driver's OPERATIONAL
relationship with a carrier and says nothing about a non-driving employee.
`Contract` is the terms. `ComplianceRequirement` is whether somebody is
qualified. `Settlement` is what they were paid.

So this milestone adds exactly two canonical records and nothing else:

| Record | Answers |
|---|---|
| `WorkforceEngagement` | the working relationship, and only that |
| `QualificationRecord` | which exact document version a carrier received, reviewed and relied on — and its retention obligation |

Everything else is a reference. Neither record has a field that could hold a
permission, a contract term, a file, a licence number or an amount.

## Ownership

| Fact | Canonical owner |
|---|---|
| Account and permanent identity | `User` |
| Access to an organization | `Membership` + permissions |
| Permanent professional driver profile | `DriverProfile` |
| Driver's operational relationship with a carrier | `CarrierRelationship` |
| Legal terms and signed versions | `Contract` / `ContractVersion` |
| Files, versions, lineage, review | Document Center |
| Current permission to view a document | `DocumentShare` |
| Operational qualifications | Safety & Compliance |
| Work accountability and delegation | Responsibility Engine |
| Driver settlements, accounting | Settlements, Accounting |
| **Employment or working relationship** | **`WorkforceEngagement`** |
| **Exact evidence a carrier relied on, and its retention** | **`QualificationRecord`** |
| Historical actions | the one Audit ledger |

## The rules that matter most

**A classification, a position title and a manager are not authorization.**
Nothing in this module grants, widens or narrows a permission. There is no input
on `WorkforceService` that carries a `PermissionKey`, and there never will be.
`requestAccessStep` records that the access system was *asked*; the access
system performs it and writes its own `access.*` line.

**A manager does not become responsible for work.** The Responsibility Engine
routes on the permissions a piece of work requires — `functionForPermissions` —
and has never read a job title. The Needs You items this module raises name
nobody.

**Employment and access are different things.** The seeded world contains Priya
Raman, who works at Northline and has no Antcolos account at all, and Paige
Ellery, who holds a seat and has no engagement. Both cases are asserted in
`workforce.test.ts`.

**Safety & Compliance derives from the canonical driver registry.** It used to
read a second roster held in the driver feature, so a relationship ended through
HR offboarding never froze the driver's compliance requirements and never
produced a `ComplianceSnapshot` — records about somebody who had left stayed
live. A driver the canonical registry knew about but the other roster did not
sat permanently at *"requirements not built"*. The fix was not to keep two
rosters in step: `compliance-sources` now derives from
`carrierDriverRelationshipsUnscoped`, and the feature roster's own ending
command delegates to the driver module's canonical `endCarrierRelationship`.
One ending, reflected wherever it is read.

**Onboarding is derived, never stored.** Every checklist row asks the module
that owns the fact at the moment somebody looks. A stored HR checklist would be
a second opinion about facts five other modules already own — and a second
opinion is a thing that can be wrong while looking authoritative.

**Five statuses, not three.** `completed`, `awaiting_other_domain`, `blocked`,
`waived` and `not_applicable`. A waiver is never rendered as completed: whoever
reads the record a year from now has to be able to tell "Safety cleared it" from
"somebody decided we would go ahead anyway".

## Lifecycle

```
prospective ──▶ onboarding ──▶ active ⇄ suspended
     │               │            │         │
     ├──▶ rejected   ├──▶ rejected└────┬────┘
     └──▶ withdrawn  └──▶ withdrawn    └──▶ ended
```

`ended`, `rejected` and `withdrawn` are terminal. A person who leaves and comes
back gets a NEW engagement; the old one stays in history and is never reopened.
The table lives in `src/lib/workforce/lifecycle.ts` and every transition not in
it is refused.

Activation asserts the lifecycle transition *before* reading the checklist: a
prospective person cannot be started at all, and refusing them with "three steps
are outstanding" would send somebody off to satisfy steps that were never the
reason.

## Isolation, and A6

This module adds **no** organization-isolation rule of its own. It reuses A6's:

- Records are read through the owning organization's id and nothing else.
- **A field naming somebody is attribution, never a grant.** `driverProfileId`
  on a qualification record identifies a person exactly as `FactScope`'s carrier
  field identifies a carrier; neither makes the record readable to them. A
  carrier that can see a driver still cannot read another carrier's record about
  that driver.
- Cross-organization attempts are recorded through the existing
  `recordCrossOrganizationAttempt`, in the one ledger.
- No `DomainEventKind` was added, so `EVENT_SCOPE_MATRIX` is untouched. Nothing
  here needs bus propagation: onboarding status is derived on read, so there is
  nothing to propagate. `workforce-boundaries.test.ts` asserts this.

The one read that crosses an organization is the driver's own view of who
adopted their document. It rests on the existing self-access basis — the
membership's own `driverProfileId` — not on the record naming them, and returns
a projection built field by field.

## Offboarding

`offboardingPlan` computes what would happen and changes nothing.
`offboard` performs **only** the steps the person confirmed after reading it.

Each step is another module's own command:

| Step | Performed by |
|---|---|
| End access | `setMembershipStatus` — the membership directory's |
| End the driver relationship | `endCarrierRelationship` — the driver module's, idempotent |
| End document access | `endRelationshipDocuments` — the document store's |
| Start qualification retention | the qualification file's own command |

Two steps deliberately need a person and are never performed automatically:
re-homing responsibility and unassigning equipment. Picking a new owner for
somebody's work is a decision, and the candidate a naive implementation would
reach for is the manager named on the engagement — which is exactly the rule
this milestone refuses.

A failed step does not roll the engagement back and does not disappear. The
engagement ends, the failure is recorded on it, and Needs You keeps asking until
somebody finishes it. A former worker who still holds something is the most
dangerous thing this module can produce, so it is the loudest.

## Needs You

Five workforce categories and two qualification ones, all derived, all raised
only when a person must act. The fifth, `workforce_leave_return_due`, exists
because Antcolos will not assume somebody came back: an expected return date
passing is not evidence of a return, and marking them available on that basis is
how a load reaches somebody who is still away. What raises **nothing**: an active engagement with
nothing outstanding, a completed checklist row, a retained qualification record
sitting quietly under its obligation. Home stays personal — there is no
organization-wide HR panel on it.

## The gap-closing layer (this milestone)

The records above already existed. This milestone added **no new store, no new
service and no second source of truth for anything** — it closed four gaps in
the record that already owns the answer, and added the screens two existing
commands had never been given.

### 1. A start date now says what kind of fact it is

`WorkforceEngagement.startDate` said *when*. It did not say *who says so*, and
those are different claims with different weight:

| Basis | Means |
|---|---|
| `asserted_by_organization` | the carrier states it. Antcolos saw nothing and holds no evidence |
| `observed_by_antcolos` | somebody authorised activated the engagement here, and the ledger has the line |

**`activate` never touches an existing date and never relabels its basis.** It
fills an *empty* one, and only that one is `observed`. A roster import carries
`asserted_by_organization` and points back at the `ImportedAssertion` the import
module owns — the full provenance chain stays reachable without one byte of it
being copied onto the engagement.

Absent is not `observed`. A record made before this field existed says *"nobody
recorded where this came from"*, because that is the truth about it.

### 2. Functions, which are not permissions

`positionTitle` was one string and display-only. A five-truck carrier has one
person who dispatches, files the safety paperwork and chases invoices, and a
single title could not hold that. `WorkforceEngagement.functions` is a list,
each entry recording who assigned it and when.

The vocabulary is **`ResponsibilityFunction`** — the routing engine's existing
one — rather than a new list of job-shaped words that would mean almost the same
eight things and drift. `MembershipProfile.functions` declares what a *seat* may
be routed work for; this declares what a *person* does for the organization, and
is representable for somebody with no seat at all.

**Assigning a function grants nothing.** `AssignFunctionInput` carries no
`PermissionKey` and there is no path from it to one. What the product does
instead is *notice*: `functionGapsFor` subtracts the membership's effective
permissions from what a function ordinarily needs, and the engagement shows the
mismatch with a link to Access. The direction only ever runs one way — a gap is
never closed here, and a held permission never invents an HR function. Both are
asserted in `workforce-hr-foundation.test.ts`.

### 3. Leave, and the one availability signal

Leave is a fact about an **active** engagement, not a lifecycle state. Somebody
away until the 14th and somebody the organization has stood down must never be
the same row a year later, so `suspended` and a `WorkforceLeaveRecord` stay
apart.

Availability already existed and Workforce did **not** add a second copy of it.
`MembershipProfile.availability` is the routing gate — `AVAILABILITY_TAKES_WORK`
→ `takesWork` → the responsibility engine's candidate filter — and recording
leave calls the membership directory's own `setMembershipAvailability`, exactly
as offboarding calls its `setMembershipStatus`. Workforce holds the HR record;
the directory holds the signal the system acts on.

The reason category is one of eight coarse words with nowhere to type more. No
diagnosis, no condition, no certificate: an operational availability record is
not a medical record, and a free-text box on an HR screen is where one
accidentally becomes the other. `WORKFORCE_LEAVE_NOTICE` says so on the form.

`WorkforceAvailability.availableForWork: true` means **"HR knows of no reason not
to route work to this person"** and nothing else. It never declares a truck
dispatch-ready, a driver qualified or hours available — Dispatch, Maintenance,
Safety and the ELD own those four answers, none of them reads this field, and
`WORKFORCE_AVAILABILITY_LIMITATION` is printed wherever the signal is shown.

**An expected return date passing does not bring anybody back.** Antcolos will
not assume it; a `workforce_leave_return_due` item asks somebody, and the person
stays unavailable until one of them answers.

### 4. Two classifications, and one deliberately not added

`organization_owner` and `external_worker` were added. **`company_driver` was
not**, and that is the point: a company driver is already `EngagementType` in
the driver registry — which decides their paperwork and their pay — plus the
`driver_action` function here. A third copy on this record would be the second
classification system the boundaries forbid, and the three would disagree.

Every classification is a fact the organization supplied.
`WORKFORCE_CLASSIFICATION_NOTICE` is printed above the dropdown, not in a
tooltip: Antcolos applies no IRS, FLSA or state ABC test and offers no opinion
on whether a label is correct.

### Screens

`WorkforceService.create` had existed with no caller. It now has one — a single
form for both connecting a known person and recording somebody who will never
sign in, because they are the same command with different identity fields and
two paths would eventually disagree about the duplicate check. Inviting somebody
remains the access system's, on its own screen; this creates no account, no
membership, no `DriverProfile` and sends nothing.

The directory row gained functions, availability and a **count** of the Needs
You items that engagement already produces — a count of the one derivation, not
a second queue, so a badge can never say 3 while the list shows 1.

### Authorization

**No permission was added.** `workforce:view`, `workforce:manage` and
`workforce:end` already existed and cover all six new commands. Notably
`assignFunction` asks for `workforce:manage` and *not* `members:edit`: asking
for it would be this module quietly agreeing that recording what somebody does
is the same kind of act as changing what they may do.

## Frontend mock limitations

- **No cross-module transaction.** Activation reads Safety, Contracts, the
  Document Center and Access and refuses when they disagree. It cannot change
  them together. Every checklist carries `MOCK_ACTIVATION_LIMITATION` saying so.
- **No uniqueness constraint.** `liveEngagementFor` is an in-memory check, not a
  constraint: two tabs racing would both pass it.
- **No persistence.** Everything lives as long as the tab.
- **No real authorization.** `ServiceContext` is assembled in the browser. The
  checks make the UI behave correctly and prove the shape the real API must
  meet; **they are not a security property and must not be described as one.**
  Every key is enforceable only on the server.
- **No leave overlap constraint.** `recordLeave` refuses a second current leave
  by reading the existing ones; two tabs racing would both pass, exactly as with
  the engagement uniqueness check.
- **Leave notes are unclassified free text.** The form says not to enter
  sensitive detail and the type has no field for it, but nothing stops somebody
  typing one into the operational note. A backend owes this field real handling.
- **Function gaps are advisory only.** `expectedPermissionsFor` is a small
  hand-written map of what a kind of work ordinarily needs. It is not derived
  from route coverage and is not enforced anywhere; an organization is free to
  disagree with it.
- **Availability is written to an in-memory override.**
  `setMembershipAvailability` changes a mock directory for the life of the tab.

## What the backend owes this seam

- Durable persistence for engagements, waivers and unfinished offboarding.
- A transaction around the multi-module offboarding the service performs one
  step at a time, or a durable saga with per-step retry.
- A **unique constraint** preventing more than one live engagement per
  `(organizationId, person)` — where "person" is the user id or driver profile
  id, and "live" excludes the terminal states. Product rules do not require
  uniqueness per classification: somebody cannot be an employee and a contractor
  of the same organization at once, and the constraint should say so by keying
  on the person rather than on the pair.
- Server-side authorization against a session it issued.
- Durable audit, and job queues for anything asynchronous.
- Payroll, tax filing, benefits and background-check providers are **out of
  scope** and are not modelled here.

### Added by this milestone

- **Durable persistence** for function assignments, leave records and start-date
  provenance, all of which currently live only in the tab.
- **A transaction, or a resumable saga**, around recording leave: it writes the
  engagement and then asks the access system to change the seat's availability,
  and a failure between the two leaves an HR record that the routing engine
  disagrees with. The same applies to ending leave.
- **An overlap constraint** on leave per `(engagementId, period)`, so two
  concurrent writers cannot both record somebody away.
- **Immutable audit** for the six new actions, with the actor, organization,
  timestamp, target and — for a start-date correction — the previous value,
  which currently lives only in the engagement's history array.
- **Sensitive-data handling for leave.** The reason category is coarse by
  design, but the operational note is free text and a real system owes it
  access control, retention and a redaction path. Leave reasons should be
  readable by fewer people than the workforce directory is.
- **Retention rules** for leave records after an engagement ends, which this
  build simply keeps forever.
- **Server-side derivation of availability**, so a client cannot be the thing
  that decides somebody is back.
- **A decision about `assertionRef`**: the engagement points at an import run
  and row, and nothing yet guarantees that row still exists.

### Explicitly still not built

Payroll, benefits, tax filing, I-9/E-Verify, legal classification, recruiting or
applicant tracking, performance review, safety adjudication, maintenance
workflows, dispatch or MT Loop changes, and Telegram delivery. None of them is
touched by this milestone, and no file in `src/features/mt-loop`,
`src/features/opportunities`, `src/features/rate-confirmations`,
`src/features/tracking` or `src/features/communications` was changed.
