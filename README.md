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
npm run test       # unit and service-layer tests (vitest)
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
```

## What is built so far

| Milestone | Screens |
|---|---|
| 1. Foundation and shell | Design tokens, theme and density, identity and membership switching, permissions, responsive navigation, shared states |
| 2. Home + Needs You | `/home` (adapts to the membership), `/needs-you`, `/driver/home` |
| Canonical Load slice | `/loads`, `/loads/[loadId]` — read-only |
| Truck and trailer registries | `/fleet/trucks`, `/fleet/trailers` and their profiles |
| Reports | `/reports`, `/reports/[reportId]` — read-only analysis of other modules' records |

Everything else is a placeholder screen that says so.

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

## Try the permission and identity model

The app ships with one permanent user and three memberships. Use the organization switcher at the top of the sidebar:

- **Northline Freight** — you are the Owner. You see everything, including rates and revenue.
- **Meridian Dispatch** — you are a Senior dispatcher with `rates:view` and `revenue:view` withheld. The rate column, revenue tile, settlements, invoices and the whole settings section are *absent*, not disabled. Reports are present but personal: your own income, loads, carriers, performance and activity, with organization-wide reports refused at the service. Trucks show the partner carrier they run under.
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
  features/             home, needs-you, loads, reports
  lib/
    api/
      contracts/        ★ typed service interfaces — the backend seam
      mock/             in-memory adapter, PARTITIONED BY ORGANIZATION
      http/             real adapter, deliberately unimplemented
    reports/            catalog, metric definitions, source adapters, calculations
    permissions/        ★ catalog, can(), templates, effective, scope, routes
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

## Branding

The wordmark and mark are temporary placeholders, not the final Antcolos logo. To rebrand:

1. Colors, type, radius, elevation → `src/styles/globals.css`
2. The mark → `public/brand/antcolos-mark.svg`
3. Name and wordmark treatment → `src/config/brand.ts`

## For backend integration

`src/lib/api/contracts/` is the seam. Every method takes a `ServiceContext` carrying the organization, membership, permission set, record scope and an actor snapshot — there is no method that accepts a `User`. The mock adapter enforces permissions and organization ownership itself, so a UI bug that renders a forbidden button still fails at the seam.
