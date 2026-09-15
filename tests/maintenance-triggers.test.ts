import test from "node:test";
import assert from "node:assert/strict";
import {
  dueSummary, nextTriggerAfterCompletion, requirementState,
} from "@/lib/maintenance/triggers";
import type { MeterReading } from "@/types";

const NOW = new Date("2026-09-14T12:00:00.000Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

const odo = (miles: number, readAt = days(-1)): MeterReading => ({
  odometerMiles: miles, readAt, source: "manual",
});
const hrs = (hours: number, readAt = days(-1)): MeterReading => ({
  engineHours: hours, readAt, source: "manual",
});

/* -------------------------------------------------------------------------- */
/* Date triggers                                                               */
/* -------------------------------------------------------------------------- */

test("a date trigger runs upcoming, due soon, then overdue", () => {
  const trigger = { kind: "date" as const, dueAt: days(40), warnDays: 30 };
  assert.equal(requirementState({ trigger, now: NOW }), "upcoming");

  assert.equal(
    requirementState({ trigger: { ...trigger, dueAt: days(10) }, now: NOW }),
    "due_soon",
  );
  assert.equal(
    requirementState({ trigger: { ...trigger, dueAt: days(-1) }, now: NOW }),
    "overdue",
  );
});

test("a job due later today is not yet overdue", () => {
  const trigger = { kind: "date" as const, dueAt: days(0.2), warnDays: 30 };
  assert.equal(requirementState({ trigger, now: NOW }), "due_soon");
  assert.equal(dueSummary({ trigger, now: NOW }).label, "Due today");
});

/* -------------------------------------------------------------------------- */
/* Mileage and engine hours                                                    */
/* -------------------------------------------------------------------------- */

test("a mileage trigger compares against the recorded odometer", () => {
  const trigger = { kind: "mileage" as const, dueAtMiles: 120_000, warnMiles: 1_500 };

  assert.equal(requirementState({ trigger, meter: odo(100_000), now: NOW }), "upcoming");
  assert.equal(requirementState({ trigger, meter: odo(119_000), now: NOW }), "due_soon");
  assert.equal(requirementState({ trigger, meter: odo(121_450), now: NOW }), "overdue");

  const over = dueSummary({ trigger, meter: odo(121_450), now: NOW });
  assert.equal(over.remainingMiles, -1_450);
  assert.equal(over.label, "1,450 mi over");
});

test("an engine-hour trigger works the same way on its own meter", () => {
  const trigger = { kind: "engine_hours" as const, dueAtHours: 9_000, warnHours: 150 };
  assert.equal(requirementState({ trigger, meter: hrs(8_000), now: NOW }), "upcoming");
  assert.equal(requirementState({ trigger, meter: hrs(8_900), now: NOW }), "due_soon");
  assert.equal(requirementState({ trigger, meter: hrs(9_140), now: NOW }), "overdue");
});

test("an unanswerable requirement is never answered", () => {
  // No odometer reading exists at all.
  const trigger = { kind: "mileage" as const, dueAtMiles: 300_000, warnMiles: 5_000 };
  const due = dueSummary({ trigger, now: NOW });

  assert.equal(due.unknown, true);
  assert.equal(due.label, "No odometer reading");
  assert.equal(due.remainingMiles, undefined);
  // Neither overdue nor fine — it waits for a person, rather than guessing.
  assert.equal(requirementState({ trigger, now: NOW }), "upcoming");
});

test("a reading older than the staleness window is flagged, not discarded", () => {
  const trigger = { kind: "mileage" as const, dueAtMiles: 120_000, warnMiles: 1_500 };
  const fresh = dueSummary({
    trigger, meter: odo(119_000, days(-2)), meterStaleAfterDays: 21, now: NOW,
  });
  const stale = dueSummary({
    trigger, meter: odo(119_000, days(-46)), meterStaleAfterDays: 21, now: NOW,
  });

  assert.equal(fresh.meterStale, false);
  assert.equal(stale.meterStale, true);
  // The answer is still given — a stale number beats no number for a human.
  assert.equal(stale.remainingMiles, 1_000);
});

/* -------------------------------------------------------------------------- */
/* Defect triggers                                                             */
/* -------------------------------------------------------------------------- */

test("a defect that stops the equipment is overdue immediately", () => {
  const trigger = {
    kind: "defect" as const,
    defectId: "d1",
    reportedSeverity: "out_of_service" as const,
  };
  assert.equal(requirementState({ trigger, now: NOW }), "overdue");
});

test("a critical defect with no agreed deadline still leads the queue", () => {
  assert.equal(
    requirementState({
      trigger: { kind: "defect", defectId: "d1", reportedSeverity: "critical" },
      now: NOW,
    }),
    "overdue",
  );
  // A lesser one waits for a person to set a date rather than inventing one.
  assert.equal(
    requirementState({
      trigger: { kind: "defect", defectId: "d2", reportedSeverity: "minor" },
      now: NOW,
    }),
    "due_soon",
  );
});

/* -------------------------------------------------------------------------- */
/* State precedence                                                            */
/* -------------------------------------------------------------------------- */

test("completed, in-service and deferred each beat the trigger's own verdict", () => {
  const overdue = { kind: "date" as const, dueAt: days(-30), warnDays: 30 };

  assert.equal(requirementState({ trigger: overdue, now: NOW }), "overdue");
  assert.equal(
    requirementState({ trigger: overdue, inService: true, now: NOW }),
    "in_service",
  );
  assert.equal(
    requirementState({ trigger: overdue, deferred: true, deferredUntil: days(10), now: NOW }),
    "deferred",
  );
  assert.equal(
    requirementState({ trigger: overdue, completedAt: days(-1), inService: true, now: NOW }),
    "completed",
  );
});

test("an expired deferral is not silently renewed", () => {
  const overdue = { kind: "date" as const, dueAt: days(-30), warnDays: 30 };
  assert.equal(
    requirementState({ trigger: overdue, deferred: true, deferredUntil: days(-1), now: NOW }),
    "overdue",
    "deferring buys time; it does not close anything",
  );
});

test("a deferral with no end date holds until somebody clears it", () => {
  const overdue = { kind: "date" as const, dueAt: days(-30), warnDays: 30 };
  assert.equal(
    requirementState({ trigger: overdue, deferred: true, now: NOW }),
    "deferred",
  );
});

/* -------------------------------------------------------------------------- */
/* Rolling a recurring requirement forward                                     */
/* -------------------------------------------------------------------------- */

test("an interval advances from when the work was done, not from the old due date", () => {
  // Due at 100,000 but not actually done until 107,000.
  const trigger = {
    kind: "mileage" as const, dueAtMiles: 100_000, intervalMiles: 15_000, warnMiles: 1_500,
  };
  const next = nextTriggerAfterCompletion(trigger, {
    at: NOW, meter: odo(107_000),
  });

  assert.equal(next?.kind, "mileage");
  assert.equal((next as { dueAtMiles: number }).dueAtMiles, 122_000);
  // Not 115_000 — rolling from the old due date shortens every future interval.
});

test("a date interval advances from the completion date", () => {
  const trigger = { kind: "date" as const, dueAt: days(-20), intervalDays: 365, warnDays: 30 };
  const next = nextTriggerAfterCompletion(trigger, { at: NOW });
  assert.equal((next as { dueAt: string }).dueAt, days(365));
});

test("a one-off requirement does not recur", () => {
  assert.equal(
    nextTriggerAfterCompletion({ kind: "date", dueAt: days(-1), warnDays: 30 }, { at: NOW }),
    null,
  );
  assert.equal(
    nextTriggerAfterCompletion(
      { kind: "defect", defectId: "d1", reportedSeverity: "major" },
      { at: NOW },
    ),
    null,
  );
});

test("a recurring mileage job without a reading at completion does not guess", () => {
  const trigger = {
    kind: "mileage" as const, dueAtMiles: 100_000, intervalMiles: 15_000, warnMiles: 1_500,
  };
  // No meter supplied: anchoring the whole future schedule to a guess would be
  // worse than leaving a person to set the next one.
  assert.equal(nextTriggerAfterCompletion(trigger, { at: NOW }), null);
});
