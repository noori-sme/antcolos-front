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
npm test           # unit tests (vitest)
npx tsc --noEmit   # typecheck
npx eslint .       # lint
```

## What is built so far

| Milestone | Screens |
|---|---|
| 1. Foundation and shell | Design tokens, theme and density, identity and membership switching, permissions, responsive navigation, shared states |
| 2. Home + Needs You | `/home` (adapts to the membership), `/needs-you`, `/driver/home` |
| Canonical Load slice | `/loads`, `/loads/[loadId]` — read-only |
| Fuel & IFTA foundation | `/fuel`, `/fuel/transactions`, `/fuel/transactions/[id]`, `/fuel/mileage`, `/fuel/ifta`, `/fuel/ifta/[id]` |

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
  features/             home, needs-you, loads, fleet, trailers, fuel
  lib/
    api/
      contracts/        ★ typed service interfaces — the backend seam
      mock/             in-memory adapter, PARTITIONED BY ORGANIZATION
      http/             real adapter, deliberately unimplemented
    fuel/               ★ fuel and IFTA domain logic — units, jurisdictions,
                          periods, economy, attribution, validation, integrations
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
