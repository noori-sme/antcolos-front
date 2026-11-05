# 02 — Fleet trucks: write actions on the real API (F0.1)

```
Status:   in progress (product owner: "keep going with F0.1"; defaults below, for review in the PR)
Phase:    4 — add truck (phases 1–3 done)
Branch:   claude/magical-mccarthy-pgmh3z
Track:    Integrate (all endpoints exist in the backend)
Backend contract: ../antcolos/docs/requirements/fleet-api-contract.md §1, §1b, §4–§12
                  ../antcolos/docs/requirements/users-api-contract.md §2–§4 (assignee picker)
Milestone: F0.1 in ../antcolos/docs/product/milestones.md
Updated:  2026-11-05
```

## Summary

Today the fleet screens read trucks from the real API (list, detail) but cannot change
anything: the truck profile has no actions, and "Add truck" is a prototype wizard that writes to
the in-memory `truck-registry` mock even in http mode. This plan wires every truck write the
backend has, through the `trucks` service, org-namespaced hooks, and small feature components.

## Endpoint → contract method → hook

| Endpoint | `TrucksService` method | Hook | UI |
| --- | --- | --- | --- |
| `GET /trucks/lookup?vin=` | `lookupByVin` | `useTruckLookup` | Add truck: VIN step |
| `POST /trucks` (idempotent) | `create` | `useCreateTruck` | Add truck: create or attach |
| `PATCH /trucks/:id` | `update` | `useUpdateTruck` | Profile: edit sheet |
| `DELETE /trucks/:id` | `archive` | `useArchiveTruck` | Profile: archive (confirm) |
| `POST /trucks/:id/{available,unavailable,maintenance}` (idempotent) | `setStatus` | `useSetTruckStatus` | Profile: status menu |
| `POST /trucks/:id/operating-carriers/:operatingId/end` (idempotent) | `endOperating` | `useEndOperating` | Profile: remove from our fleet (confirm) |
| `POST /trucks/:id/ownership/:ownershipId/replace` (idempotent) | `replaceOwnership` | `useReplaceOwnership` | Profile: hand off ownership to a member |
| `POST /trucks/:id/assignments` (idempotent) | `assign` | `useAssignTruck` | Profile: assign driver / dispatcher |
| `POST /trucks/:id/assignments/:assignmentId/replace` (idempotent) | `replaceAssignment` | `useReplaceAssignment` | Profile: replace |
| `POST /trucks/:id/assignments/:assignmentId/remove` (idempotent) | `removeAssignment` | `useRemoveAssignment` | Profile: remove (confirm) |
| `GET /organizations/{drivers,dispatchers,admins}` | `OrgPeopleService.list` (new, http-only) | `useAssignablePeople` | Assignee picker |

Not wired: `POST …/ownership/:ownershipId/end` (the contract says it always returns 409
`OWNERSHIP_REPLACEMENT_REQUIRED`), and the three history lists (read-only, not part of F0.1).

## Decisions (defaults)

| # | Decision | Why |
| --- | --- | --- |
| A | **Replace the prototype "Add truck" wizard with a contract-shaped form** (`truck-create-screen.tsx`): VIN → lookup → attach (known VIN: unit number, home terminal, notes) or create (contract fields). The old wizard and its route usage go; `lib/api/mock/truck-registry.ts` stays for the other mock screens that use it. | The wizard's model (initial status, specs, evidence files, owner names, ownership claims) has no backend counterpart: the contract refuses `operationalStatus` on create, stores owners as ids, and has no claim route. Mapping it would silently drop half of what the user typed. |
| B | **New owner on create is always this organization.** Owner-operator ownership is set later with "hand off ownership" to a member. | Keeps the create form short; the contract defaults `legalOwner` to the JWT org. |
| C | **Ownership hand-off UI targets a member of this organization only.** Handing off to another carrier needs its organization id, and there is no organization search API: recorded under Backend asks. | Never ask a user to paste a UUID. |
| D | **One `Idempotency-Key` per user intent**: created when the dialog/action starts, reused if the user retries the same submit, replaced after success. | data-layer rule. |
| E | **Gating**: `trucks:create` (create/attach), `trucks:edit` (edit, status, assign, leave fleet, hand off), `trucks:delete` (archive), mapped from backend `truck.*`. Identity edits and archive/hand-off are shown only when this org is the current legal owner (`legalOwner.ownerOrganizationId === org`); the server still decides. | Never show an action enabled that the API will refuse for permission reasons. |
| F | **Assignee picker**: drivers from `/organizations/drivers`; dispatchers from `/organizations/dispatchers` plus `/organizations/admins` (the contract allows ADMIN as dispatcher). A 403 from those lists shows "You can't see the member list" instead of the picker. | There is no frontend mapping for `membership.list_*` permissions to gate on in advance (see Findings). |

## Phases

1. **Data layer** — types (`TruckLookup`, `TruckAssignmentRow`, `TruckOwnershipRow`,
   `TruckOperatingRow`, inputs), `TrucksService` methods, http adapter with `toTruckLookup`,
   `toTruckAssignmentRow`, `toTruckOwnershipRow`, `toTruckOperatingRow` + tests from the contract
   examples; `OrgPeopleService` (list) http adapter + mapper test. → verify: vitest on the adapter
   tests, typecheck.
2. **Hooks** — `features/fleet/hooks.ts` mutations with idempotency keys and narrow invalidation
   (`fleetKeys.detail` + `fleetKeys.all`), `useTruckLookup`, `useAssignablePeople`. → verify:
   typecheck, lint.
3. **Truck profile actions** — `truck-actions.tsx` (status, edit, leave fleet, archive, hand off),
   `truck-assignments-panel.tsx` (assign / replace / remove), `truck-edit-sheet.tsx`; the profile
   screen only composes them. → verify: lint, typecheck, browser against the local backend.
4. **Add truck** — `truck-create-screen.tsx` + route switch; remove the orphaned wizard. → verify:
   browser against the local backend, existing browser specs still pass in mock mode.
5. **Verify and review** — `/verify`, `frontend-reviewer`, browser run of every action.

## Findings (contract / frontend)

- Frontend permission catalog has no mapping for `membership.list_drivers`,
  `membership.list_dispatchers`, `membership.list_admins` (decision F).

## Backend asks

- An organization search (by handle, MC or DOT) so ownership can be handed off to another carrier
  without typing an id (decision C).

## Frontend impact on the backend

None: every call follows the existing contract.
