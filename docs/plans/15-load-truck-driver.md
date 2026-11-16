# 15 — Book a truck and assign a driver from the load (F1.3)

```
Status:   in progress (2026-11-16; owner: "Do the pending front-end tasks")
Branch:   feat/loads-assign-driver-truck (stacked on feat/loads-list-detail, front #26)
Backend contract: ../antcolos/docs/requirements/loads-api-contract.md §9 (truck, plan 31),
          §10 (driver, plan 32); fleet-api-contract.md (operational status)
Track:    Feature (new UI on the load, permission key, truck statuses)
```

## Progress

```text
Phase 1 — done  truck trip statuses: types, labels + tones, shared badge, fleet roster/profile, status
          menu only from manual states (lib/fleet/truck-status.ts + tests)
Phase 2 — load record: truckId, driver fields; loadRecords book/unbook truck, assign/unassign
          driver, accept/reject (mapper tests); timeline sentences for truck/driver events
Phase 3 — "Truck & driver" panel on the load: book / take off, assign / take off, record the
          driver's answer; hooks; dialogs (rhf + zod); gates
Phase 4 — permission key loads:respond (alias load.respond); docs; live spec
```

## Design

- **Truck statuses.** `TRUCK_OPERATIONAL_STATUSES` gains the six trip values; a shared
  `TRUCK_OPERATIONAL_STATUS` config (label + tone) and `TruckOperationalBadge` replace the
  per-screen fallbacks that showed an unknown status as "Unavailable". The status menu offers
  only the manual moves the backend allows (`AVAILABLE / UNAVAILABLE / MAINTENANCE`, and out of
  `DELIVERED`); a truck on a load shows no status menu and says it moves with its load.
- **Panel.** Truck: unit number, equipment, status (`services.trucks.get`). Driver: name, phone
  (`services.orgPeople.get('drivers', id)`), assigned / accepted times. Actions only while the
  load has not started its trip (`BOOKED … DRIVER_ACCEPTED`): book a truck (pick from this org's
  `AVAILABLE` trucks), take it off; assign a driver (pick from active drivers), take them off;
  record the driver's answer (accept / turn down with a reason). Gates: book/assign/take off on
  `loads:edit`; recording an answer on `loads:edit` + `loads:respond`.
- **Data seam.** New `loadRecords` methods; hooks in `features/loads/hooks.ts` (keys under
  `loadRecordKeys`); the truck and driver pickers read through hooks in the same file calling
  `services.trucks` / `services.orgPeople` (no cross-feature imports).

## Backend dependency

noori-sme/antcolos#60 (M1.6) and #61 (M1.7) merged and deployed first.
