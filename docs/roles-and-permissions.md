# Roles and permissions

Settings → Roles and permissions. What a role is, what it deliberately is not,
and what a backend has to do for any of it to be true.

## The model, in one paragraph

Antcolos permissions belong to a **Membership** — the per-organization seat.
A **role** (`PermissionTemplate`) is a reusable, organization-scoped way of
*choosing* those permissions. It is not a second source of authorization, and
nothing in the product asks a role what somebody may do. Applying a role writes
an **`AppliedTemplate`** onto the seat: a snapshot of the permissions the role
carried at that moment, plus provenance — which role, under what name, at which
version, applied by whom and when. `effectivePermissions` reads the snapshots,
the person's own grants and their own revocations, and nothing else.

```
effective = (applied snapshots ∪ grants) − revocations,  ∩ available(orgType)
```

`effectivePermissions(membership, organization)` does not take a list of
templates. It cannot read one. That is the point.

## What follows from the snapshot

**Editing a role changes nobody's access.** Not by policy, by construction:
there is no code path from a template's `permissions` to a Membership's
effective set. A role edit bumps the role's `version` and touches no seat.

**People end up on different versions, and that is correct.** A seat carrying
version 2 of a role whose current version is 4 is not drift to be cleaned up —
it is the person keeping exactly the access they were given. The screens say
so in those words, and count it (`behindCount`) so an owner can act on it.

**Moving somebody onto a newer version is its own act.** `applyToMembership`,
one seat at a time, `previewApplication` first. There is deliberately no
"apply to everyone": each seat has its own grants and revocations, so one
click would mean a different change per person, and the only place those
differences are visible is the per-person preview.

**Renaming does not bump the version.** Nobody's access depends on a name, so
a reworded description must not ask an owner to review a change to nobody.

**Re-applying replaces the seat's entry for that role** rather than adding a
second one. Two snapshots of one role would make "which version is this person
on" unanswerable, and their union would keep a permission that version 2
removed working forever.

## What the interface refuses, and why

| Refusal | Rule |
|---|---|
| `escalation` | A saved role may not contain a key its author does not hold. Refused outright, not trimmed — a role silently shorter than what somebody ticked is one they hand out believing it does something it does not. |
| withheld-on-apply | A role may legitimately contain more than the person *applying* it holds (an owner wrote it; a senior dispatcher uses it). The seat receives the intersection and the withheld keys are **named in the preview**. Clamping silently would be the same lie in the other direction. |
| `self_escalation` | Nobody applies a role to their own seat. Clamping would make it a no-op that looked like it worked, and self-application is the shortest path from `permissions:manage` to every permission there is. |
| `cross_organization` | Every lookup is `(organizationId, id)`. A role id from elsewhere answers *not found*, never *forbidden* — the second confirms it exists. |
| `owner_seat` | An owner's access is structural, not composed from roles. Applying one would write a snapshot nothing reads. |
| `reserved` | Owner cannot be edited, archived, recreated or handed out. Seeded roles can be edited and archived but not deleted. |
| `in_use` | A role people hold cannot be deleted. Deleting it would not strip anybody — each seat has its own snapshot — but it would destroy the answer to "where did this access come from". Archiving is offered instead and takes nothing away. |
| last owner | Nothing here can produce an organization with no owner. |

**Dispatch delegation is a separate basis and stays one.** A role in a provider
organization cannot grant access to a carrier's data. Carrier-only keys are not
in a dispatch workspace's catalog at all, and the key that comes closest —
`eld:location:precise:view` — carries the caveat in the catalog itself: holding
it is necessary and not sufficient, because the carrier's per-truck
`TruckDispatchAccess` decides which trucks it reaches.

## The roster, and why it reads two stores

`rosterOf(organizationId)` answers "who is in this organization" from two
places, because two different things are recorded:

| Store | Holds | Written by |
|---|---|---|
| Membership directory | The colleagues who are IN an organization | `updateMemberAccess`, `setMembershipStatus` |
| Session store | The seats THIS TAB has, including any granted at runtime by somebody accepting an invitation | `grantMembership`, `updateMembershipAccess`, `setMembershipStatus` |

Fixture memberships exist in both. **The session copy wins on id**, because a
seat it holds is the live one. Three rules make that safe, and each one is
there because its absence produced a specific lie:

- **The id is claimed before the seat is judged.** A session copy marked `left`
  still owns its id. Testing the status first left the id unclaimed, so the
  directory's fixture copy was listed instead and somebody who had just been
  removed came back reading `active`.
- **Every write is routed by the same ownership test.** `writeSeatAccess` and
  `writeSeatStatus` both ask which store owns the seat. Unioning the read path
  while leaving a write pointed at one store meant ending a colleague's seat
  did nothing and reported success.
- **"Does this person already have a seat here?" is asked of the union.**
  `liveSeatFor` derives from `rosterOf`. Asking the session store alone meant a
  colleague accepting an invitation was handed a *second* live seat — two
  answers to what they may do, and two rows on the roster.

Writes to either store notify one subscription (`subscribeRoster`), so a screen
has one thing to listen to.

★ FOR THE BACKEND ★ None of this survives. A server has ONE membership table.
The invariants that do survive are the ones these rules stand in for: a unique
index on `(userId, organizationId)` where the seat is live, status transitions
that are a single UPDATE on that table, and no second place a roster can be
read from.

## ███ None of this is enforced in a browser ███

`ctx.permissions` is a set the browser assembled from fixtures. Every refusal
above is computed client-side, so a caller who wanted past one would edit the
caller. What the frontend is worth is that each rule is **exact** — it names the
authority it needs, the organization it is scoped to and the clamp it applies —
so the server has a specification rather than "and then check permissions".

### What the backend owes this seam

**Durable roles.** `PermissionTemplate` rows keyed by `(organizationId, id)`,
with a unique index on `(organizationId, lower(name))`. `version` is an integer
that increases **only when the permission set changes**; a rename or a
description edit leaves it alone.

**Immutable applied snapshots.** `AppliedTemplate` rows on the membership,
storing the permission list by value. If `UPDATE permission_template …` can
reach a single membership's effective permissions through a join, the schema is
wrong — that join is the bug this whole design exists to make impossible.
Unique on `(membershipId, templateId)`, so re-applying replaces.

**Authenticated grant authority.** The server derives the acting membership and
its permissions from the session it issued — never from a body field, a header,
or a template id. Then:

- refuse a saved selection containing anything outside the actor's own set;
- clamp an application to that same set and **return what was withheld**;
- refuse `membershipId === actingMembershipId` outright;
- refuse an owner seat and refuse removing the last owner.

Both the save guard and the apply clamp, not one: the first stops a role being
written that its author could not grant, the second stops an existing role being
*used* to hand out more than the applier holds.

**Organization scoping as a query predicate, not a filter.** Every read and
write carries `organizationId` in the `WHERE` clause. A seat in another
organization is unreachable, not merely hidden.

**Auditable assignment.** Every call above — refusals included — appends to the
one audit ledger with the role, its version, the seat, the actor's membership,
and the before/after permission counts. `access.role_changed` for template
writes; `access.permission_granted` / `access.permission_revoked` with
`sourceAction: "access.template_applied"` for assignments.

**What the backend must NOT add:** a second permission catalog, a second
membership, a role-name check anywhere in authorization, or a cascade from a
template edit to anybody's access.

## Where the code is

| Thing | File |
|---|---|
| The one permission catalog | `src/lib/permissions/catalog.ts` |
| Effective permissions | `src/lib/permissions/effective.ts` |
| Grant authority and the clamp | `src/lib/permissions/grantable.ts` |
| Applying, previewing, drift | `src/lib/permissions/applied.ts` |
| Seeded roles | `src/lib/permissions/templates.ts` |
| Service contract | `src/lib/api/contracts/access.ts` |
| Mock implementation | `src/lib/api/mock/access-templates.ts` |
| Template store | `src/lib/api/mock/template-store.ts` |
| Screens | `src/features/access/roles-screen.tsx`, `permission-catalog.tsx`, `apply-template-panel.tsx`, `access-diff.tsx` |
| Tests | `src/lib/api/mock/access-templates.test.ts`, `roster-union.test.ts` |
