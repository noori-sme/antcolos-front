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
npm test           # service-layer and domain tests (node --test)
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
| Invoice foundation | `/finance/invoices`, `/finance/invoices/[invoiceId]` |

Everything else is a placeholder screen that says so.

## Invoices

An invoice is the only place Antcolos asserts money to somebody outside the
organization, so the module obeys two rules the rest of the product does not
need:

1. **It is append-only once issued.** Line items and totals may change while an
   invoice is a draft. After that it changes by appending — a payment, a
   dispute, a void — and every step bumps `version` and writes an audit entry.
2. **It never re-reads upstream profiles.** The load, the rate confirmation,
   the billing party and the carrier are referenced by permanent id, and what
   is *copied* onto the invoice is a snapshot taken at invoice time. A broker
   that renames itself next year does not rewrite last year's invoices.

Loads, rate confirmations, PODs, documents, broker/shipper profiles, detention,
layover and the other accessorials are **separate modules**. Invoices receives
them through the typed inbound contracts in
`src/lib/api/contracts/invoices.ts` (`ConfirmedLoadInput`,
`ConfirmedRateConfirmationInput`, `ApprovedAccessorialInput`,
`BillingPartyInput`, `DocumentRequirementInput`, assembled as an
`InvoiceSourcePacket`). Until those modules exist, one file —
`src/lib/api/mock/invoice-sources.ts` — stands in for all of them and produces
those exact packets; when they land, that file is deleted and nothing else
changes.

Statuses: Draft, Needs documents, Ready, Submitted, Disputed, Partially paid,
Paid, Overdue and Void. `needs_documents` / `ready` follow the readiness checks
and `overdue` / `partially_paid` / `paid` follow the due date and the money —
they are derived, not typed in by anybody.

Readiness is a list of named checks rather than a boolean, because a biller who
is blocked needs to know *which* thing to go and fix: delivery recorded, rate
confirmation on file, linehaul matching the agreement, required documents
attached and accepted, every accessorial approved upstream, a billable payer
and a positive total. Failing checks block; warnings do not.

Missing documents, disputes and overdue receivables are raised into the SAME
Needs You queue as everything else, not into a second list only this screen
knows about.

**Deliberately not built yet, and absent rather than stubbed:** settlements,
reporting, real payment processing, real email or portal delivery, factoring
submission and accounting export. `submit` records that a *person* sent the
invoice — Antcolos sends nothing, and `deliveryConfirmed` is always false.

## Try the permission and identity model

The app ships with one permanent user and three memberships. Use the organization switcher at the top of the sidebar:

- **Northline Freight** — you are the Owner. You see everything, including rates and revenue.
- **Meridian Dispatch** — you are a Senior dispatcher with `rates:view` withheld. The rate column, revenue tile, settlements, invoices, reports and the whole settings section are *absent*, not disabled — `/finance/invoices` typed into the address bar gives a proper 403 screen, and the service refuses the call underneath it. Trucks show the partner carrier they run under.
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

## Tests

```bash
npm test
```

Node's own test runner over the TypeScript sources — no build step, no test
framework dependency. `tests/alias-loader.mjs` resolves the `@/*` alias so the
tests import exactly what the app imports.

They cover the service layer, which is where the rules actually live:

- **Domain** — money in whole cents, per-organization invoice numbering that
  never reuses a number, every readiness check, and the status machine.
- **Permissions** — every method refuses without the key it names, and the
  error says which keys were missing.
- **Carrier data isolation** — one carrier can never list, read, bill or mutate
  another's invoice, and another carrier's invoice is `NotFoundError`, never
  "forbidden", because a 403 would confirm the record exists.
- **Record scope** — a membership scoped to its own records sees only invoices
  for loads it drove.
- **Lifecycle** — create, issue, submit, pay, dispute, resolve, void, and every
  refusal in between.
- **Snapshots** — renaming a broker or editing a load does not rewrite an
  invoice that was already issued.
- **Needs You** — invoice items land in the shared queue, are gated on
  `invoices:view`, and snooze and resolve like any other item.
