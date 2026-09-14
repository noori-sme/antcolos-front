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
npm run lint       # eslint
npm test           # the service and domain test suite
```

`npm test` runs on Node's own test runner against the TypeScript sources — no
build step and no test framework. `scripts/ts-path-hooks.mjs` teaches Node the
`@/*` alias so the tests import the app exactly as the app does. It covers the
domain and service layers (`.ts`), never components.

## What is built so far

| Milestone | Screens |
|---|---|
| 1. Foundation and shell | Design tokens, theme and density, identity and membership switching, permissions, responsive navigation, shared states |
| 2. Home + Needs You | `/home` (adapts to the membership), `/needs-you`, `/driver/home` |
| Canonical Load slice | `/loads`, `/loads/[loadId]` — read-only |
| Permanent Truck | `/fleet/trucks`, registry, onboarding, operating authority |
| Permanent Trailer | `/fleet/trailers`, registry, attachments, readiness |
| Insurance & Claims foundation | `/insurance`, `/insurance/policies`, `/insurance/certificates`, `/insurance/claims` |

Everything else is a placeholder screen that says so.

## Insurance and claims

Four record types, kept separate because they expire, renew, are issued and are
argued over on completely different schedules: a **Policy** (the contract, at
one version), a **Coverage** line inside it (its own limits, deductible and
dates), a **Certificate of Insurance** (evidence held by a third party) and a
**Claim** (an event against cover).

One rule shapes all of it: **coverage is a question about a moment in time,
never about today.**

- A renewal writes a NEW policy version and marks the old one superseded. The
  old policy, its coverage, its certificates and its claims survive intact.
- What a policy covers is a dated list of schedule rows. Taking a truck off
  closes its row; nothing is deleted, so last year's accident still resolves.
- A claim freezes a **coverage attribution** when it is recorded and never
  recomputes it. Renewing the policy, selling the truck, a driver leaving or
  the operating authority moving to another carrier cannot rewrite it.

`src/lib/insurance/coverage.ts` holds those rules, pure and dependency-free.
`tests/coverage-evaluation.test.ts` is where they are pinned down.

### What a dispatch organization sees

Nothing, by default — not even that a policy exists. A carrier shares a policy
or a single claim explicitly, for a written purpose, revocably. A share carries
the coverage summary and the operational facts; premiums, deductibles, private
notes, fault attribution and every claim figure stay with the carrier. Switch
to **Meridian Dispatch** to see it: one shared Baxter policy, one shared claim,
and a Costs panel that says the money was never sent rather than hiding it.

### What is NOT connected

Nothing in this module talks to an insurer, files a claim, moves money, reads a
document or reports anything to a government body. The seams are declared and
typed in `src/lib/insurance/extension-points.ts` — insurer verification, agent
of record, claim submission, premium and deductible payments, document reading,
telematics evidence and government reporting — and every one of them throws.
The Insurance overview lists them and says what Antcolos does instead.

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
  features/             home, needs-you, loads, fleet, trailers, insurance
  lib/
    api/
      contracts/        ★ typed service interfaces — the backend seam
      mock/             in-memory adapter, PARTITIONED BY ORGANIZATION
      http/             real adapter, deliberately unimplemented
    insurance/          ★ coverage rules, requirements, claim states, seams
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

Telegram, ELD, load boards, accounting, insurers, claims processing, insurance
payments, document OCR, telematics and government reporting are **not
connected**, and no screen implies otherwise.

## Branding

The wordmark and mark are temporary placeholders, not the final Antcolos logo. To rebrand:

1. Colors, type, radius, elevation → `src/styles/globals.css`
2. The mark → `public/brand/antcolos-mark.svg`
3. Name and wordmark treatment → `src/config/brand.ts`

## For backend integration

`src/lib/api/contracts/` is the seam. Every method takes a `ServiceContext` carrying the organization, membership, permission set, record scope and an actor snapshot — there is no method that accepts a `User`. The mock adapter enforces permissions and organization ownership itself, so a UI bug that renders a forbidden button still fails at the seam.
