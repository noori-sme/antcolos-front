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

Four workforce categories and two qualification ones, all derived, all raised
only when a person must act. What raises **nothing**: an active engagement with
nothing outstanding, a completed checklist row, a retained qualification record
sitting quietly under its obligation. Home stays personal — there is no
organization-wide HR panel on it.

## Frontend mock limitations

- **No cross-module transaction.** Activation reads Safety, Contracts, the
  Document Center and Access and refuses when they disagree. It cannot change
  them together. Every checklist carries `MOCK_ACTIVATION_LIMITATION` saying so.
- **No uniqueness constraint.** `liveEngagementFor` is an in-memory check, not a
  constraint: two tabs racing would both pass it.
- **No persistence.** Everything lives as long as the tab.
- **No real authorization.** `ServiceContext` is assembled in the browser. The
  checks make the UI behave correctly and prove the shape the real API must
  meet; they are not a security property.

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
