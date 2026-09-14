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
npm test           # vitest — service layer, access rules and derivation
npx tsc --noEmit   # typecheck
npx eslint .       # lint
```

## What is built so far

| Milestone | Screens |
|---|---|
| 1. Foundation and shell | Design tokens, theme and density, identity and membership switching, permissions, responsive navigation, shared states |
| 2. Home + Needs You | `/home` (adapts to the membership), `/needs-you`, `/driver/home` |
| Canonical Load slice | `/loads`, `/loads/[loadId]` — read-only |
| Permanent Truck and Trailer | `/fleet/trucks`, `/fleet/trailers` and their profiles |
| Fleet Management Foundation | `/fleet`, `/fleet/equipment/[assetKind]/[assetId]` |

Everything else is a placeholder screen that says so.

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

## Try the permission and identity model

The app ships with one permanent user and three memberships. Use the organization switcher at the top of the sidebar:

- **Northline Freight** — you are the Owner. You see everything, including rates and revenue.
- **Meridian Dispatch** — you are a Senior dispatcher with `rates:view` withheld. The rate column, revenue tile, settlements, invoices, reports and the whole settings section are *absent*, not disabled. Trucks show the partner carrier they run under.
- **Cascade Haul** — you are a Company driver scoped to your own loads. `/home` hands off to `/driver/home`, and you see three of the four loads that exist.

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
  features/             home, needs-you, loads, fleet, fleet-ops, trailers
  lib/
    api/
      contracts/        ★ typed service interfaces — the backend seam
      mock/             in-memory adapter, PARTITIONED BY ORGANIZATION
      http/             real adapter, deliberately unimplemented
    permissions/        ★ catalog, can(), templates, effective, scope, routes
    session/            ★ permanent User, Membership[], active membership
    query/              org-namespaced query keys
    fleet/              ★ status derivation, readiness, utilization, integrations
  types/                ★ canonical entities
  config/               nav, statuses, documents, brand
  styles/globals.css    ★ every design token
```

The starred locations are the architectural spine: one design system, one permission catalog, one session model, one backend seam, one set of canonical types, one place the operational picture is derived. Nothing outside them hardcodes a color, checks a role, reads identity directly, or calls `fetch`.

## Data

All data is mocked behind the service contracts. Mutations persist for the browser session only. Set `NEXT_PUBLIC_API_MODE=http` to point at the real adapter — it throws by design, so nothing pretends to be connected.

Telegram, ELD, GPS, telematics, fuel cards, tolls, state registration lookups,
load boards and accounting are **not connected**, and no screen implies
otherwise.

`npm test` covers the parts that decide what a person is told and what they are
allowed to see: the reconciliation rules, the access and isolation rules at the
service seam, assignment immutability, the derived Needs You rules, and that
every integration adapter refuses rather than inventing a value.

## Branding

The wordmark and mark are temporary placeholders, not the final Antcolos logo. To rebrand:

1. Colors, type, radius, elevation → `src/styles/globals.css`
2. The mark → `public/brand/antcolos-mark.svg`
3. Name and wordmark treatment → `src/config/brand.ts`

## For backend integration

`src/lib/api/contracts/` is the seam. Every method takes a `ServiceContext` carrying the organization, membership, permission set, record scope and an actor snapshot — there is no method that accepts a `User`. The mock adapter enforces permissions and organization ownership itself, so a UI bug that renders a forbidden button still fails at the seam.
