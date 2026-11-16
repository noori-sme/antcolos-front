# 16 — Driver web app on the real API (F1.4)

```
Status:   in progress (2026-11-16; owner: "do everything in M1 while I'm away")
Branch:   feat/driver-web-app
Backend contract: ../antcolos/docs/requirements/loads-api-contract.md §10 (accept/reject),
          §11 (milestones), §12 (driver's loads), §13 (BOL/POD) — plans 32–34
Track:    Feature (new live screens, nav permission change)
```

## Progress

```text
Phase 1 — todo  types + driverLoads service (http adapter + mapper tests) + lib/driver-loads labels
Phase 2 — todo  hooks + live screens: My loads, one load (milestones, accept/reject, BOL/POD)
Phase 3 — todo  route switch, nav gate loads:respond, Driver template, live routes; live spec; docs
```

## Goal

Spec §13.1: on a phone, the driver completes the whole load without Telegram: sees the active
load and its stops, accepts or turns it down, records every milestone through Delivered, uploads
the BOL and POD, and reads the instructions. (Reporting an exception comes with M1.10 / F1.5.)

## Design

- **Screens** (`features/driver-loads/`, mobile first, 360 px):
  - *My loads* (`/driver/loads`): the active load first as a large card (status, next stop, the
    next action), then the others; empty state.
  - *A load* (`/driver/loads/:id`): header (load number, status); the **next action** as one
    large button from `nextMilestones` ("Start trip", "Arrived at pickup 1 · Joliet, IL",
    "Loaded", "Waiting for broker release", "Cleared to depart", "Departed", "Delivered"),
    confirmed in a dialog; accept / turn down when the load waits for an answer; the stops with
    planned window and actual times, address, contact (tap to call), notes; instructions,
    references, equipment, weight, commodity; documents: list + "Upload BOL" / "Upload POD"
    (camera or file) when the load is at that point.
- **Data:** a new http-only service `driverLoads` (contract `lib/api/contracts/driver-loads.ts`):
  `list`, `get`, `recordMilestone`, `uploadDocument`, `accept`, `reject`. One Idempotency-Key
  per intent (`createIntentKeys`), cleared on success. Query keys `driverLoadKeys` under
  `orgKey`. A milestone, answer or upload invalidates the driver's loads.
- **Mode:** http mode shows the live screens; mock mode keeps the mock driver workflow
  (`features/driver-workflow`), as `/loads` does (plan 14). `/driver/loads` joins
  `HTTP_LIVE_ROUTES`.
- **Permission:** a real driver holds `load.respond` (`loads:respond`), not `load.read`. "My
  loads" is gated on `loads:respond`; the Driver template gains it (mirrors the backend DRIVER
  template). No role-name checks.
- **Load records:** the dispatcher's load detail stops show the actual times too (plan 33 adds
  them to every load response).

## Backend asks

None: plans 32–34 provide every endpoint. Reporting an exception waits for M1.10.
