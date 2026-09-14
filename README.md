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
npm run typecheck  # tsc --noEmit
npm test           # unit tests (vitest)
npx eslint .       # lint
```

## What is built so far

| Milestone | Screens |
|---|---|
| 1. Foundation and shell | Design tokens, theme and density, identity and membership switching, permissions, responsive navigation, shared states |
| 2. Home + Needs You | `/home` (adapts to the membership), `/needs-you`, `/driver/home` |
| Canonical Load slice | `/loads`, `/loads/[loadId]` — read-only |
| Settlement foundation | `/finance/settlements`, `/finance/settlements/[id]`, and the payee statement |

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
  features/             home, needs-you, loads, settlements
  lib/
    api/
      contracts/        ★ typed service interfaces — the backend seam
      mock/             in-memory adapter, PARTITIONED BY ORGANIZATION
      http/             real adapter, deliberately unimplemented
    permissions/        ★ catalog, can(), templates, effective, scope, routes
    session/            ★ permanent User, Membership[], active membership
    settlements/        pure pay engine: money, agreements, status, breakdown
    query/              org-namespaced query keys
  types/                ★ canonical entities
  config/               nav, statuses, documents, brand
  styles/globals.css    ★ every design token
```

The five starred locations are the architectural spine: one design system, one permission catalog, one session model, one backend seam, one set of canonical types. Nothing outside them hardcodes a color, checks a role, reads identity directly, or calls `fetch`.

## Data

All data is mocked behind the service contracts. Mutations persist for the browser session only. Set `NEXT_PUBLIC_API_MODE=http` to point at the real adapter — it throws by design, so nothing pretends to be connected.

Telegram, ELD, load boards and accounting are **not connected**, and no screen implies otherwise.

## Settlements

A settlement is what one carrier owes one payee for a period of work — a company
driver, an owner-operator, an individual dispatcher, a dispatch organization, or
any other approved payee. Everything a settlement is *about* is built elsewhere,
so the module owns none of it: it takes typed references and, when the money is
worked out, a **snapshot**.

That snapshot is the whole design. A settlement records what was agreed at a
moment in time, so a driver's percentage changing next month cannot rewrite last
month's pay. Loads are priced under the compensation agreement that was in force
**when the work was performed**, never the current one, and the arithmetic is
frozen on approval and read thereafter rather than recomputed.

Three things the module will not do:

- **It never silently edits a settlement that has been signed off.** Corrections
  are new records with their own UUID, linked to the original in both
  directions. Both stay on the books.
- **Nobody approves, pays or corrects a settlement they are the payee of**, no
  matter how broad their permissions.
- **It moves no money.** There is no ACH, banking, payroll, tax filing,
  accounting integration or payment execution anywhere in it. Recording a
  payment writes down that one happened somewhere else.

Payee privacy is a different list, not a redacted one: a membership scoped to its
own financials gets its own settlements in full and nobody else's at all — no
carrier roll-up, no other payees in the filters. Switch to **Cascade Haul** to
see that side.

Needs You items for missing data, disputes and overdue payments are *derived*
from settlement state rather than stored, so they cannot go stale and cannot be
snoozed away without fixing what they are about.

## Branding

The wordmark and mark are temporary placeholders, not the final Antcolos logo. To rebrand:

1. Colors, type, radius, elevation → `src/styles/globals.css`
2. The mark → `public/brand/antcolos-mark.svg`
3. Name and wordmark treatment → `src/config/brand.ts`

## For backend integration

`src/lib/api/contracts/` is the seam. Every method takes a `ServiceContext` carrying the organization, membership, permission set, record scope and an actor snapshot — there is no method that accepts a `User`. The mock adapter enforces permissions and organization ownership itself, so a UI bug that renders a forbidden button still fails at the seam.
