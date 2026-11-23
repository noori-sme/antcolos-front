import { describe, expect, it } from "vitest";
import {
  CATEGORY_LABELS, categoryLabel, dueSummary, intervalSummary, maxDeferDate, scheduleChanges, taskDueSummary,
} from "./due";
import type { MaintenanceSchedule, ScheduleDue } from "@/types/maintenance-live";

const due = (extras: Partial<ScheduleDue> = {}): ScheduleDue => ({
  status: "OK", nextDueAt: null, daysLeft: null, nextDueOdometerMiles: null, milesLeft: null,
  nextDueEngineHours: null, engineHoursLeft: null, ...extras,
});
const dateFmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

describe("dueSummary", () => {
  it("says how far each used interval is, and the date", () => {
    expect(dueSummary(due({ milesLeft: 660, nextDueOdometerMiles: 183000 }))).toBe("660 mi left");
    expect(dueSummary(due({ daysLeft: 68, nextDueAt: "2027-01-28T00:00:00.000Z" }))).toBe(
      `68 days left · ${dateFmt("2027-01-28T00:00:00.000Z")}`,
    );
    expect(dueSummary(due({ engineHoursLeft: 40.5, nextDueEngineHours: 1500 }))).toBe("40.5 engine h left");
  });

  it("says overdue by how much", () => {
    expect(dueSummary(due({ milesLeft: -500, nextDueOdometerMiles: 183000 }))).toBe("500 mi overdue");
    expect(dueSummary(due({ daysLeft: -3, nextDueAt: "2026-11-18T00:00:00.000Z" }))).toBe(
      `3 days overdue · ${dateFmt("2026-11-18T00:00:00.000Z")}`,
    );
    expect(dueSummary(due({ daysLeft: 1, nextDueAt: "2026-11-23T00:00:00.000Z" }))).toBe(
      `1 day left · ${dateFmt("2026-11-23T00:00:00.000Z")}`,
    );
  });

  it("says what is missing when a meter has no reading", () => {
    expect(dueSummary(due({ status: "UNKNOWN", nextDueOdometerMiles: 183000 }))).toBe("Due at 183,000 mi · no reading yet");
  });
});

describe("taskDueSummary", () => {
  it("names what the task is due at", () => {
    expect(taskDueSummary({ dueOdometerMiles: 183000, dueEngineHours: null, dueAt: null })).toBe("At 183,000 mi");
    expect(taskDueSummary({ dueOdometerMiles: null, dueEngineHours: 1500, dueAt: "2027-01-28T00:00:00.000Z" })).toBe(
      `At 1,500 engine h · by ${dateFmt("2027-01-28T00:00:00.000Z")}`,
    );
    expect(taskDueSummary({ dueOdometerMiles: null, dueEngineHours: null, dueAt: null })).toBe("Due now");
  });
});

it("describes the intervals of a schedule", () => {
  expect(intervalSummary({ everyDays: 180, everyMiles: 15000, everyEngineHours: null })).toBe("Every 15,000 mi or 180 days");
  expect(intervalSummary({ everyDays: null, everyMiles: null, everyEngineHours: 500 })).toBe("Every 500 engine h");
});

it("labels categories, keeping an unknown one readable", () => {
  expect(categoryLabel("OIL_CHANGE")).toBe(CATEGORY_LABELS.OIL_CHANGE);
  expect(categoryLabel("WIPERS")).toBe("Wipers");
});

it("defers at most 90 days out", () => {
  const now = new Date("2026-11-22T12:00:00.000Z");
  expect(maxDeferDate(now).toISOString()).toBe("2027-02-20T12:00:00.000Z");
});

describe("scheduleChanges", () => {
  const schedule = {
    title: "Oil change", category: "OIL_CHANGE", everyDays: null, everyMiles: 15000, everyEngineHours: null,
    warnDays: null, warnMiles: null, warnEngineHours: null, lastServiceOdometerMiles: 168000, lastServiceEngineHours: null,
  } as unknown as MaintenanceSchedule;

  it("sends only what changed, and null to clear an interval", () => {
    expect(scheduleChanges(schedule, { ...schedule, everyMiles: 10000, everyDays: 180 } as never)).toEqual({
      everyMiles: 10000,
      everyDays: 180,
    });
    expect(scheduleChanges(schedule, { ...schedule, everyMiles: null, everyDays: 30 } as never)).toEqual({
      everyMiles: null,
      everyDays: 30,
    });
    expect(scheduleChanges(schedule, { ...schedule } as never)).toEqual({});
  });
});
