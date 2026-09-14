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
npm test           # vitest, against the service layer and the domain logic
npx eslint .       # lint
```

## What is built so far

| Milestone | Screens |
|---|---|
| 1. Foundation and shell | Design tokens, theme and density, identity and membership switching, permissions, responsive navigation, shared states |
| 2. Home + Needs You | `/home` (adapts to the membership), `/needs-you`, `/driver/home` |
| Canonical Load slice | `/loads`, `/loads/[loadId]` — read-only |
| Safety & Compliance foundation | `/compliance`, `/compliance/[requirementId]` |

Everything else is a placeholder screen that says so.

### Safety & Compliance

The one idea the module is built around: **a requirement and a document are not
the same record.** The obligation to hold a current annual inspection on unit 104
exists whether or not anybody has ever uploaded a file. A document can *satisfy*
it — and the requirement then points at that document, in the system that owns it
— but the requirement keeps its own id, status, due date, responsible person and
append-only history, and survives the document being replaced, rejected or removed.

What it reuses rather than recreates:

| It needs | It reads |
|---|---|
| Organizations and operating authority | the session's organization record |
| Drivers | the driver relationships in `features/driver/` |
| Trucks and trailers | the permanent registries in `lib/api/mock/` |
| Documents | the Document Center (organization paperwork is linked with `entityKind: "organization"`) |
| Alerts | the existing Needs You queue — compliance produces real items in it, not a second system |
| People and permissions | Membership, the permission catalog and record scope |

Which requirements exist depends on entity type, organization type, relationship,
operating authority and equipment type — an intrastate carrier is never asked for
the interstate filings, a company driver is never asked for owner-operator
paperwork, a dry van is never asked for a refrigeration service record, and a
25,999 lb box truck sits one pound below the fuel-tax threshold. Requirements that
do not reach a subject become `not_applicable` records that say why, hidden by
default rather than silently absent.

Ending a driver, truck, trailer, carrier or dispatch relationship **stops access
and deletes nothing**: the records freeze, an immutable snapshot is taken, and the
frozen records never re-enter a live queue.

Inspections, violations, accidents, claims, hours-of-service, CSA/SMS monitoring
and full audit preparation are **not built**. They are declared as typed extension
points (`lib/compliance/extensions.ts`) and rendered as "not built yet" — a screen
reading "0 violations" would mean Antcolos had looked and found none, and it has
not looked.

Nothing is connected to FMCSA, the Drug & Alcohol Clearinghouse, any state agency,
any insurance provider, any ELD or any monitoring service. Every date was recorded
in Antcolos or carried on a document somebody uploaded, and the screens say so.

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
  features/             home, needs-you, loads, compliance
  lib/
    api/
      contracts/        ★ typed service interfaces — the backend seam
      mock/             in-memory adapter, PARTITIONED BY ORGANIZATION
      http/             real adapter, deliberately unimplemented
    compliance/         ★ requirement catalog, applicability rules, status machine
    permissions/        ★ catalog, can(), templates, effective, scope, routes
    session/            ★ permanent User, Membership[], active membership
    query/              org-namespaced query keys
  types/                ★ canonical entities
  config/               nav, statuses, documents, brand
  styles/globals.css    ★ every design token
tests/                  service-layer and domain tests (vitest, node)
```

The starred locations are the architectural spine: one design system, one permission catalog, one compliance catalog, one session model, one backend seam, one set of canonical types. Nothing outside them hardcodes a color, checks a role, reads identity directly, or calls `fetch`.

## Data

All data is mocked behind the service contracts. Mutations persist for the browser session only. Set `NEXT_PUBLIC_API_MODE=http` to point at the real adapter — it throws by design, so nothing pretends to be connected.

Telegram, ELD, load boards, accounting, FMCSA, the Drug & Alcohol Clearinghouse, state agencies, insurance providers and safety-monitoring services are **not connected**, and no screen implies otherwise.

## Branding

The wordmark and mark are temporary placeholders, not the final Antcolos logo. To rebrand:

1. Colors, type, radius, elevation → `src/styles/globals.css`
2. The mark → `public/brand/antcolos-mark.svg`
3. Name and wordmark treatment → `src/config/brand.ts`

## For backend integration

`src/lib/api/contracts/` is the seam. Every method takes a `ServiceContext` carrying the organization, membership, permission set, record scope and an actor snapshot — there is no method that accepts a `User`. The mock adapter enforces permissions and organization ownership itself, so a UI bug that renders a forbidden button still fails at the seam.
