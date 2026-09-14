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
npm run typecheck  # typecheck the app and the tests
npm test           # service-layer test suite
npx eslint .       # lint
```

`npm test` runs on Node's own TypeScript support plus a ~30-line resolver hook
in `tests/` — there is no test framework dependency to install.

## What is built so far

| Milestone | Screens |
|---|---|
| 1. Foundation and shell | Design tokens, theme and density, identity and membership switching, permissions, responsive navigation, shared states |
| 2. Home + Needs You | `/home` (adapts to the membership), `/needs-you`, `/driver/home` |
| Canonical Load slice | `/loads`, `/loads/[loadId]` — read-only |
| Permanent Truck | `/fleet/trucks`, `/fleet/trucks/[truckId]`, `/fleet/trucks/new` |
| Permanent Trailer | `/fleet/trailers`, `/fleet/trailers/[trailerId]`, `/fleet/trailers/new` |
| Maintenance foundation | `/maintenance`, `/maintenance/[kind]/[id]`, `/driver/defects` |

Everything else is a placeholder screen that says so.

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
  features/             home, needs-you, loads
  lib/
    api/
      contracts/        ★ typed service interfaces — the backend seam
      mock/             in-memory adapter, PARTITIONED BY ORGANIZATION
      http/             real adapter, deliberately unimplemented
    permissions/        ★ catalog, can(), templates, effective, scope, routes
    maintenance/        trigger evaluation, labels, integration extension points
    session/            ★ permanent User, Membership[], active membership
    query/              org-namespaced query keys
  types/                ★ canonical entities
  config/               nav, statuses, documents, brand
  styles/globals.css    ★ every design token
```

The five starred locations are the architectural spine: one design system, one permission catalog, one session model, one backend seam, one set of canonical types. Nothing outside them hardcodes a color, checks a role, reads identity directly, or calls `fetch`.

## Data

All data is mocked behind the service contracts. Mutations persist for the browser session only. Set `NEXT_PUBLIC_API_MODE=http` to point at the real adapter — it throws by design, so nothing pretends to be connected.

Telegram, ELD, load boards and accounting are **not connected**, and no screen implies otherwise.
Maintenance names its own extension points — ELD, odometer and engine-hour feeds, repair
shops, parts, tire, warranty and roadside — in `src/lib/maintenance/integrations.ts`.
Every one of them is `null`, the type of each includes `null` so a caller cannot forget to
handle it, and the Integrations tab lists them all as *Not connected*. Every meter reading
in maintenance was typed in by a person, and every screen showing one says who typed it.

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
