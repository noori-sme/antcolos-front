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
npm test           # vitest — the workflow engine and the service seam
npx tsc --noEmit   # typecheck
npx eslint .       # lint
```

## What is built so far

| Milestone | Screens |
|---|---|
| 1. Foundation and shell | Design tokens, theme and density, identity and membership switching, permissions, responsive navigation, shared states |
| 2. Home + Needs You | `/home` (adapts to the membership), `/needs-you`, `/driver/home` |
| Canonical Load slice | `/loads`, `/loads/[loadId]` — read-only |
| Driver decision & trip workflow | `/driver/proposals`, `/driver/proposals/[id]`, `/driver/loads`, `/driver/loads/[loadId]` |

Everything else is a placeholder screen that says so.

## Driver Load Decision & Trip Workflow

One channel-independent service and state machine behind two driver surfaces.
The web dashboard is the only channel built; the Telegram bot, when it is
written, calls the same `ProposalCommand` and `WorkflowCommand` objects through
the same service and inherits the same validation, permissions, carrier policy
and event history. There is no second path in.

**Proposals** — Dispatch asks a driver about a load before booking it. The
driver may approve continued negotiation, reject it (with or without a reason),
pause it for a duration the carrier allows, comment, and counter. Approving is
not consent to be booked unless carrier policy says so, and the record says
which. A pause that runs out returns the proposal to *Awaiting Driver Response*
— never to approved, never to rejected. When one load is finalized, overlapping
proposals for the same driver or equipment become *Unavailable* with every
comment, counteroffer and pause still on them.

**Policy, not screens** — an owner-operator sees the money and may counter on
rate; a company driver sees miles and their own share and may counter on
schedule, route, home time, hours, pickup, delivery, equipment and conditions.
That is decided in `lib/driver-workflow/policy.ts` and enforced in the service:
a company driver who POSTs a rate counteroffer directly is refused, and a driver
never receives a `LoadFinancials` at all — they receive a `DisclosedRate` with
the withheld fields *named*.

**Finalization** — a load is not final until its rate confirmation has been
reviewed and approved by Dispatch, signed with the authorized carrier signature,
and sent back to the broker. Only then is a Driver Load Post created, and with
it the load's own immutable workflow instance. Completing a trip closes that
workflow without deleting its timeline, documents, comments, corrections or
audit history; the next load gets a new one.

**Out of order by design** — a driver who never marked *Arrived at Shipper* and
uploads the BOL straight from the dock is doing their job, not making a mistake.
The upload succeeds, the real sequence is kept, and the missing step becomes a
warning that blocks nothing. There is exactly one genuine refusal in the trip:
closing it without a proof of delivery, for a carrier that bills on one — and
even that can be done with the reason recorded.

**Inference is not a driver action** — a geofence crossing may suggest a
milestone happened. It is recorded as `inferred`, with its source, timestamp and
confidence, and stays that way until a person confirms or corrects it. Nothing
back-fills a timestamp to make a timeline look tidy.

## Try the permission and identity model

The app ships with one permanent user and three memberships. Use the organization switcher at the top of the sidebar:

- **Northline Freight** — you are the Owner. You see everything, including rates and revenue.
- **Meridian Dispatch** — you are a Senior dispatcher with `rates:view` withheld. The rate column, revenue tile, settlements, invoices, reports and the whole settings section are *absent*, not disabled. Trucks show the partner carrier they run under.
- **Cascade Haul** — you are a Company driver scoped to your own loads. `/home` hands off to `/driver/home`, and you see three of the four loads that exist. On a proposal you see the rate per mile, your share and the miles — the linehaul and the total rate are named as withheld — and you may counter on schedule, route, home time and hours, but not on rate.
- **Stonebridge Carriers** — the same person as an **Owner-operator**. Same product, same screens, a different rulebook: the full rate, and rate counteroffers up to five at a time. Comparing these two memberships is the fastest way to see that the difference lives in policy and the service layer, not in the UI.

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
  features/             home, needs-you, loads, driver-workflow
  lib/
    api/
      contracts/        ★ typed service interfaces — the backend seam
      mock/             in-memory adapter, PARTITIONED BY ORGANIZATION
      http/             real adapter, deliberately unimplemented
    driver-workflow/    ★ channel-independent engine: catalog, commands,
                          policy, proposal + trip state machines, errors
    integrations/       ★ typed ports for modules owned by other branches,
                          with labelled, replaceable mock adapters
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

### The integration boundary

Dispatch, the Opportunity inbox, Rate Confirmation, the Unified Document Center,
OCR and the GPS/ELD/telematics feeds are being built on other branches. This
branch creates none of their tables, canonical records, UI or business logic.
What it creates is `src/lib/integrations/ports.ts` — the contract — plus one
folder of labelled mock adapters behind it, and `src/lib/integrations/index.ts`,
which is the single line that changes when the real modules land.

Every record that crosses keeps the other module's own identifier
(`ExternalRef`), where it came from (`Provenance`, with `mock: true` while it is
a placeholder) and an idempotency key, so connecting the canonical module later
is a swap rather than a data migration. Anything this workflow produces for
another module is queued as a `PendingIntegrationEvent` that says plainly that
nothing has been sent, stored, verified or processed. The **Connections** panel
on any trip screen shows exactly that, per module, at runtime.

Where a canonical record already exists in this repository — Load, Driver,
Assignment, Document — the adapter reads and writes THAT record. Uploads and
OCR are honest mocks: picking a file records its name, type and size and throws
the file away; extraction returns typed fixtures and says so on screen.

## Branding

The wordmark and mark are temporary placeholders, not the final Antcolos logo. To rebrand:

1. Colors, type, radius, elevation → `src/styles/globals.css`
2. The mark → `public/brand/antcolos-mark.svg`
3. Name and wordmark treatment → `src/config/brand.ts`

## For backend integration

`src/lib/api/contracts/` is the seam. Every method takes a `ServiceContext` carrying the organization, membership, permission set, record scope and an actor snapshot — there is no method that accepts a `User`. The mock adapter enforces permissions and organization ownership itself, so a UI bug that renders a forbidden button still fails at the seam.
