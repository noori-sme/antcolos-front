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
npm test           # every test (both suites below)
npm run test:unit  # vitest, against the service layer
npm run test:node  # node --test over tests/
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
```

There are two suites, split by what they need rather than by taste. The
service-layer tests live beside the code they cover (`src/**/*.test.ts`) and run
on vitest, which resolves the `@/` alias through the app's own tsconfig. The
directory and normalization tests live in `tests/` and run on Node's own test
runner with no extra dependencies; `tests/alias-hook.mjs` teaches that loader the
`@/` alias and extensionless imports, so those tests import the real application
files rather than a copy. `npm test` runs both.

## What is built so far

| Milestone | Screens |
|---|---|
| 1. Foundation and shell | Design tokens, theme and density, identity and membership switching, permissions, responsive navigation, shared states |
| 2. Home + Needs You | `/home` (adapts to the membership), `/needs-you`, `/driver/home` |
| Canonical Load slice | `/loads`, `/loads/[loadId]` — read-only |
| Broker / Shipper / Receiver directory | `/directory`, `/directory/[partyId]`, `/directory/locations/[facilityId]`, `/directory/contacts/[contactId]`, `/directory/review` |
| Unified Document Center | `/documents`, `/documents/[documentId]` |

Everything else is a placeholder screen that says so.

## The directory and entity resolution

A rate confirmation names companies, places and people. Antcolos keeps those as
three different permanent records, each with its own immutable UUID:

- **Party** — the company (broker, shipper, receiver). Roles accumulate on one
  record, so a company that both ships and receives is one profile, not two.
- **Facility** — a place it ships from or receives at. One company, many docks.
- **Contact** — a person. People move between companies, so they are never a
  field on the company.

`src/lib/directory/` holds the part that decides which record a name refers to,
as pure functions with no store access:

- `normalize.ts` — safe normalized identifiers. Every function returns nothing
  rather than a value it is unsure of, because a loose key silently merges two
  companies and the merge surfaces weeks later as a load billed to the wrong
  broker.
- `matching.ts` — candidate scoring. A broker is matched on its **MC number**,
  which is decisive on its own; everything else is soft evidence that
  accumulates, and a *different* MC number eliminates a candidate outright
  rather than merely lowering its score.

`src/lib/api/mock/party-registry.ts` is the service the future rate
confirmation workflow will call:

```
planResolution(ctx, extraction)   // writes NOTHING — safe to call and discard
commitResolution(ctx, plan, confirmation)  // applies only what a dispatcher confirmed
```

The rules it enforces, each covered by a test in `tests/resolution.test.ts`:

- Nothing is ever merged automatically. Every proposal carries
  `requiresDispatcherConfirmation: true`, and where two profiles fit equally
  the resolver refuses to pick one.
- A second load for the same company links to the existing profile — there is
  no path that creates one profile per load.
- A profile created from an uncertain or thin match is born **provisional** and
  says why, rather than quietly joining the directory as settled fact.
- Rate confirmation data is **never** marked externally verified. The strongest
  state a document can produce is `dispatcher_confirmed`; only a check against
  FMCSA could produce `externally_verified`, and nothing in this module can
  write it.
- The rate confirmation is preserved as the source on every record, and a
  **frozen snapshot** of the fields used is written against the load — so
  correcting a profile in September never rewrites what a load ran under in
  March.

Loads are reached through link rows and then read from the loads service. The
directory never stores a load, so a profile shows its load history without
owning it.

Extraction itself (OCR, field-level correction) is **not built**. `/directory/review`
runs on reviewed fixtures in `src/lib/api/mock/rate-con-extractions.ts` and says
so on screen; everything after that point is real.

### Carrier-private data

A company record is shared — an MC number is the same number for everyone. What
one carrier *thinks* is not. Notes, ratings, blocked and preferred standing,
payment experience and private history live in rows keyed by carrier
organization, and every accessor takes that organization from the context
rather than from a parameter a screen could supply.

Switch between **Northline Freight** and **Baxter Transit** on the same broker
profile to see it: Northline has Apex Logistics marked *preferred* with a note
about calling Dana directly; Baxter has the same company *blocked* over an
unpaid detention claim. Neither can see the other's.

## Try the permission and identity model

The app ships with one permanent user and six memberships. Use the organization switcher at the top of the sidebar:

- **Northline Freight** — you are the Owner. You see everything, including rates and revenue.
- **Meridian Dispatch** — you are a Senior dispatcher with `rates:view` withheld. The rate column, revenue tile, settlements, invoices, reports and the whole settings section are *absent*, not disabled. Trucks show the partner carrier they run under.
- **Baxter Transit** — a second carrier, so an operating lease can be read from both ends. It shares exactly two of its documents with Meridian Dispatch, and nothing else.
- **Sam Murtaza Dispatch** — an *individual* dispatch workspace. Not a dispatch organization: it is asked for a photo ID, and never for operating authority or cargo insurance. `/documents` grows an **Upgrade** tab there.
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
  features/             home, needs-you, loads, directory, documents
  lib/
    api/
      contracts/        ★ typed service interfaces — the backend seam
      mock/             in-memory adapter, PARTITIONED BY ORGANIZATION
      http/             real adapter, deliberately unimplemented
    directory/          ★ normalization and entity-resolution matching (pure)
    documents/          ★ type catalog, requirement sets, status derivation
    permissions/        ★ catalog, can(), templates, effective, scope, routes
    session/            ★ permanent User, Membership[], active membership
    query/              org-namespaced query keys
  types/                ★ canonical entities
  config/               nav, statuses, documents, brand
  styles/globals.css    ★ every design token
```

The starred locations are the architectural spine: one design system, one permission catalog, one document model, one session model, one backend seam, one set of canonical types. Nothing outside them hardcodes a color, checks a role, reads identity directly, or calls `fetch`.

## The Document Center

There is **one** document system. A driver's medical card, a carrier's operating
authority, a truck's registration and a trailer's inspection are the same record
type in the same store (`src/lib/api/mock/document-store.ts`), read through one
service (`src/lib/api/contracts/documents.ts`). The truck registry, trailer
registry and driver mock no longer keep documents of their own — they project
that store, and their screens did not change.

- **Identity.** Every document has an immutable UUID per *version*, plus a
  lineage UUID shared by every version of the same document. Replacing a
  document creates a new version and keeps the old one, with its file, its
  review decision and its whole history.
- **Requirements are not documents.** Checklists live in
  `src/lib/documents/requirements.ts` and are joined to the records at read
  time. A requirement with nothing against it is "missing" — a fact about the
  checklist, with no record behind it.
- **Three workspace types, three checklists.** A Carrier Organization, a
  Dispatch Organization and an Individual Dispatch Workspace are asked for
  different things. The matrix is exhaustive: every workspace type has an
  explicit answer for every candidate document type, including "not
  applicable", so a carrier-only requirement cannot leak into a dispatcher's
  list by omission. The workspace kind comes from the active membership, never
  from a caller.
- **Types stay reusable.** One W-9 type serves all three, with a different
  reason in each. A document that applies in several places is *linked*, with
  its own per-context review state, rather than uploaded twice.
- **Isolation.** A Dispatch Organization sees a Carrier's document only through
  an explicit, live share, and never the granter's own review decision. Viewing
  and downloading are separate grants. Revoking a share keeps the grant and a
  snapshot; it deletes nothing.
- **Nothing is deleted.** Ending a relationship closes that organization's
  links, revokes its shares and snapshots what it held. Every record, version
  and event survives.
- **Needs You is real.** Missing, rejected, expiring and expired documents are
  computed from live state on every read — fix the document and the item stops
  existing. What a person *did* to an item (assign, snooze, escalate, resolve)
  is kept separately.

**Uploads are mock-only.** Choosing a file records the name, type and size the
browser reports. Nothing is uploaded, stored, transmitted, read, OCR-processed,
verified or submitted anywhere, and no screen says otherwise.

Load paperwork — rate confirmation, BOL, POD, receipts, detention evidence,
damage documents — is **modelled and not built**: `load` is a subject kind and
the types exist so the workflow can attach to this model later, and the service
refuses to create one today.

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
