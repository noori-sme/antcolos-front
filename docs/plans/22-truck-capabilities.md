# 22 — Truck capability fields on the truck profile (M2.8 frontend)

```
Status:   implemented (2026-11-17)
Branch:   feat/fleet-truck-capabilities (same name as the backend branch)
Backend:  ../antcolos/docs/plans/46-truck-capabilities.md; fleet-api-contract.md (capability fields)
Track:    Integrate (new fields on existing endpoints and screens)
```

## What

- `FleetTruck` / `UpdateTruckInput` gain `trailerWidthIn`, `trailerHeightIn`, `hasLiftgate`,
  `hasPalletJack`, `strapCount`, `reeferMinTempF`, `reeferMaxTempF`; the http mapper keeps a `null`
  flag (not recorded) apart from `false`.
- `lib/fleet/capabilities.ts`: labels (unknown never reads as "No"), bounds like the API,
  `capabilityRows(truck)` for the profile (reefer range only on a REEFER truck).
- Truck profile "Equipment & Trailer" shows the rows; the edit dialog has a Capabilities section
  for the legal owner (Yes / No / Not recorded selects; reefer range only on a REEFER truck, low ≤
  high checked in the form). `buildTruckPatch` sends only changed fields, numbers as numbers.

## Verification

- vitest 142 files / 2365 tests (new: capabilities 4, patch 1, mapper 1); build ok; typecheck ok.
- Against backend #83 (Playwright): reefer truck shows "−10 °F to 70 °F" and an unrecorded
  liftgate as not available; inverted range caught in the form; PATCH sent only the 5 changed
  fields → 200; profile then shows them.
