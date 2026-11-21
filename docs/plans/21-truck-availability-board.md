# 21 — Truck availability board (F2.5)

```
Status:   implemented (2026-11-21; owner: "go ahead")
Branch:   feat/fleet-truck-availability (same name as backend #84)
Backend contract: ../antcolos/docs/requirements/fleet-api-contract.md §Truck availability
          (backend plan 47, M2.10, merged #84)
Track:    Integrate (endpoint exists; a child route of /fleet/trucks, no nav or permission change)
```

## Goal

Spec §18: the owner and dispatcher see, per truck, when and where it will be empty — available
now, in 2–5 hours, later today, later, unknown, maintenance, unavailable — soonest first, with a
link to the truck and its current load.

## What was built

- `fleetAvailability` service (http-only, like trucks): `GET /fleet/availability`, mapper
  `toTruckAvailability` (unknown bucket → `UNKNOWN`, never dropped).
- `/fleet/trucks/availability`: the board, grouped by bucket in the contract's order; first 100
  trucks (says so when there are more); refreshes every 5 minutes. Gated like the trucks list
  (`trucks:view`, inherited from `/fleet/trucks`); linked from the trucks page header.
- `lib/fleet/availability.ts`: labels, grouping, "empty in 3 h 20 min", place.

## Not in this cut

The per-truck prediction history (`GET /fleet/availability/:truckId/history`) — useful on the
truck profile once there is enough history to show accuracy. A bucket filter (the board already
groups by bucket).

## Tests

`src/lib/api/http/fleet-availability.test.ts` (contract example, unknown values),
`src/lib/fleet/availability.test.ts` (grouping, place, relative time),
`tests/existing-behaviour.test.ts` (route gate). Not rendered against a live API: staging
Postgres was down (2026-11-19 →).
