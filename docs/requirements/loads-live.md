# Loads list, load detail and timeline on the real API (F1.2)

Status: implemented (2026-11-16). Plan: [14-loads-live](../plans/14-loads-live.md).
Backend: `../antcolos/docs/requirements/loads-api-contract.md` §2–§8 (plan 22 list/get/cancel,
plan 29 trip transitions and corrections, plan 30 timeline).

## Goal

A dispatcher sees the organization's real loads, opens one, moves it along the trip, cancels it
before pickup, and reads what happened to it. In http mode `/loads` and `/loads/<id>` stop being
demo pages. Mock mode keeps today's richer mock screens unchanged.

## Screens

**Loads (`/loads`)**: search (broker, MC, load number), status filter (every backend status),
sort (newest first, or by first pickup date), paginated 25 a page. Each row: load number, broker,
first pickup → last delivery (city, state), pickup date, equipment, rate, status badge. Table at
desktop, stacked cards under `md`. States: loading skeleton, empty ("No loads yet" with the
"New load from a Rate Con" action when the caller has `documents:review`), filtered empty,
error with retry.

**Load (`/loads/<id>`)**: header (load number, broker, status badge, "in this status since"),
facts (broker, MC, contact, equipment, weight, commodity, miles, rate, references, special
instructions), stops in order (type, facility, address, date, window shown in the stop's own
timezone), actions, timeline. A 404 reads "This load doesn't exist or isn't in this organization".

**Actions** come from the load's `allowedTransitions` only; the screen never decides a step:
- one primary button per next step ("Start trip to pickup", "Arrived at pickup", "Loaded",
  "Waiting for broker release", "In transit", "Arrived at delivery", "Delivered"), gated on
  `loads:edit` (backend `load.update`);
- "Cancel load" when `CANCELLED` is allowed: dialog with reason (required), who cancelled
  (broker, shipper, carrier, other) and an optional TONU amount;
- "Correct status" for `loads:correct_status` (backend `load.correct_status`, new key): pick an
  earlier trip state and give a reason;
- each action uses one Idempotency-Key per intent; a 409 shows the API message and refreshes the
  load (someone else moved it first).

**Timeline**: newest last, from `GET /loads/:id/timeline`: what happened (readable sentence per
event type, unknown types shown by name), who, when, from → to and reason when present; "Show
more" pages 50 at a time.

## Permissions

| UI | Key | Backend |
| --- | --- | --- |
| see `/loads`, `/loads/<id>`, timeline | `loads:view` | `load.read` |
| step, cancel | `loads:edit` | `load.update` |
| correct status | `loads:correct_status` (new) | `load.correct_status` |

## Out of scope

Driver and truck on the load (M1.7/M1.6, F1.3), documents on the load, exceptions, creating a
load by hand (loads come from a Rate Con), editing load fields.

## Backend asks

None blocking. Depends on noori-sme/antcolos#58 (M1.5) and #59 (timeline) being deployed first.
