# 17 — Exceptions on the load (F1.5)

```
Status:   implemented (2026-11-17; owner: "do everything in M1 while I'm away")
Branch:   feat/loads-exceptions
Backend contract: ../antcolos/docs/requirements/loads-api-contract.md §14 (exceptions), §12
          (driver view carries `exceptions`), §8 (timeline) — backend plans 33–39
Track:    Integrate (endpoints exist; no new route, nav or permission key)
```

## Progress

```text
Phase 1 — done  types/load-exception.ts; loadExceptions service (http-only) + mappers (4 tests);
                 lib/load-exceptions forms, labels, sorting (3); driver view maps exceptions
Phase 2 — done  load detail: Problems panel (report, take, resolve with cost) behind loads:edit
Phase 3 — done  driver app: "Report a problem" (source mobile_web) and the load's problems
Phase 4 — done  timeline sentences for milestones, documents, broker email, exceptions, accounting
```

## Goal

Spec §12: problems are records **beside** the load's status. A dispatcher sees a load's problems
(open first, most severe first), reports one, takes it (acknowledge) and resolves it with an
optional cost. A driver reports one from the phone and sees what dispatch answered. Reporting
never moves the load.

## Decisions

- The report form is one shared presentational dialog (`components/load-exceptions`); each
  feature passes its own mutation, so features do not import each other.
- Dispatcher actions are gated on `loads:edit` (backend `load.update`); a driver reports through
  the driver view (`load.respond` on their own load) and never sees the cost.
- The organization-wide list (`GET /exceptions`) is in the service for the owner dashboard (F1.6).

## Tests

- `src/lib/api/http/load-exceptions.test.ts`: contract example, unknown values dropped, bodies.
- `src/lib/load-exceptions/forms.test.ts`: schemas mirror the DTO limits; ordering.
- `src/lib/load-records/format.test.ts`: the new timeline sentences.
- `src/lib/api/http/driver-loads.test.ts`: the driver view carries exceptions.
