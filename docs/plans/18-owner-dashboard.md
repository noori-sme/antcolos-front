# 18 — Owner dashboard, first cut (F1.6)

```
Status:   implemented (2026-11-17; owner: "do everything in M1 while I'm away")
Branch:   feat/home-owner-dashboard (stacked on feat/loads-exceptions, F1.5)
Backend contract: fleet-api-contract §2 (GET /trucks), loads-api-contract §2 (GET /loads?status=),
          §14 (GET /exceptions), §16 (INVOICE_READY, backend plan 39)
Track:    Change (live home gains a section; no route, nav or permission key)
```

## Goal

Milestone F1.6: on the live home, the owner sees at a glance trucks at work, loads that wait on
someone, documents still missing, and open problems. Each tile links to where it is acted on.

## What it shows

| Tile | Source | Gate |
| --- | --- | --- |
| Trucks on a load ("3 of 7", available / maintenance in the hint) | `GET /trucks` (first 100), counted in `lib/home/owner-overview.ts` | `trucks:view` |
| Need a driver | `GET /loads?status=RC_RECEIVED&pageSize=1` → `totalItems` | `loads:view` |
| POD missing | `status=DELIVERED` | `loads:view` |
| Blocked from invoicing (POD in, gate unmet) | `status=POD_RECEIVED`: the system moves a load on as soon as the D1.4 gate is met, so one waiting here lacks an accepted Rate Con | `loads:view` |
| Ready to invoice | `status=INVOICE_READY` | `loads:view` |
| Open problems | `GET /exceptions` → `totalItems` | `loads:view` |

The section is hidden for a membership that may see none of it. Counts reuse the shared
`fleetKeys` / `loadRecordKeys` / `loadExceptionKeys`, so a load or truck change refreshes them.

## Later (not M1)

A count endpoint per status instead of one list call per tile; revenue and money tiles (M5);
tiles that open the loads list pre-filtered (the list's filter is local state today).

## Tests

`src/lib/home/owner-overview.test.ts`: truck counting (archived excluded) and the tile value.

## Review (frontend-reviewer, 2026-11-17)

No blocking findings. Fixed: the truck tile says "first 100 counted" when the fleet is larger;
one column under 420 px; the POD_RECEIVED tile is labelled "Blocked from invoicing" (backend plan
39 moves a load on by itself once the gate is met, so one waiting here lacks an accepted Rate
Con). Accepted for the first cut: a failed tile shows "—" with "Couldn't load this number" and no
retry (a reload retries); counts follow the member's load scope (a seat limited to assigned
loads sees its own numbers); "Open problems" has no list page yet; no browser spec, because the
live home renders only in http mode, which CI does not start.
