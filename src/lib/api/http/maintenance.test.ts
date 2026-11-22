import { describe, expect, it } from "vitest";
import { taskQuery, toMyTruck, toSchedule, toTask, toTruckMaintenance } from "./maintenance";

/** Copied from ../antcolos/docs/requirements/maintenance-api-contract.md §Objects. */
const CONTRACT_SCHEDULE = {
  id: "5e6f7a8b-…",
  truckId: "a0b1c2d3-…",
  title: "Oil change",
  category: "OIL_CHANGE",
  everyDays: 180,
  everyMiles: 15000,
  everyEngineHours: null,
  warnDays: 14,
  warnMiles: 1000,
  warnEngineHours: null,
  lastServiceAt: "2026-08-01T00:00:00.000Z",
  lastServiceOdometerMiles: 168000,
  lastServiceEngineHours: null,
  cycle: 2,
  archivedAt: null,
  due: {
    status: "DUE_SOON",
    nextDueAt: "2027-01-28T00:00:00.000Z",
    daysLeft: 68,
    nextDueOdometerMiles: 183000,
    milesLeft: 660,
    nextDueEngineHours: null,
    engineHoursLeft: null,
  },
  openTask: { id: "9a8b7c6d-…", status: "OPEN" },
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-11-21T14:00:03.000Z",
};

const CONTRACT_TASK = {
  id: "9a8b7c6d-…",
  scheduleId: "5e6f7a8b-…",
  truckId: "a0b1c2d3-…",
  unitNumber: "104",
  title: "Oil change",
  category: "OIL_CHANGE",
  cycle: 2,
  status: "DEFERRED",
  dueAt: "2027-01-28T00:00:00.000Z",
  dueOdometerMiles: 183000,
  dueEngineHours: null,
  openedAt: "2026-11-21T15:00:00.000Z",
  acknowledgedAt: "2026-11-21T16:10:00.000Z",
  deferredUntil: "2026-12-05T00:00:00.000Z",
  deferReason: "Booked at the dealer for Dec 5",
  completedAt: null,
  completedOdometerMiles: null,
  completedEngineHours: null,
  completionNote: null,
  documentId: null,
  updatedAt: "2026-11-21T16:12:00.000Z",
};

describe("maintenance mappers", () => {
  it("maps the contract schedule, due and open task", () => {
    const schedule = toSchedule(CONTRACT_SCHEDULE);
    expect(schedule).toMatchObject({
      title: "Oil change",
      category: "OIL_CHANGE",
      everyMiles: 15000,
      everyEngineHours: null,
      cycle: 2,
      openTask: { id: "9a8b7c6d-…", status: "OPEN" },
    });
    expect(schedule.due).toEqual(CONTRACT_SCHEDULE.due);
  });

  it("keeps an unknown due status honest as UNKNOWN and an unknown category raw", () => {
    const schedule = toSchedule({ ...CONTRACT_SCHEDULE, category: "WIPERS", due: { status: "SOON-ISH" }, openTask: null });
    expect(schedule.due.status).toBe("UNKNOWN");
    expect(schedule.category).toBe("WIPERS");
    expect(schedule.openTask).toBeNull();
  });

  it("maps the contract task", () => {
    expect(toTask(CONTRACT_TASK)).toMatchObject({
      unitNumber: "104",
      status: "DEFERRED",
      deferredUntil: "2026-12-05T00:00:00.000Z",
      deferReason: "Booked at the dealer for Dec 5",
      dueOdometerMiles: 183000,
      completedAt: null,
    });
  });

  it("maps a truck's maintenance and my truck", () => {
    const body = {
      truckId: "a0b1c2d3-…",
      latestReading: { odometerMiles: 182340, odometerReadAt: "2026-11-21T14:00:00.000Z", engineHours: null, engineHoursReadAt: null },
      schedules: [CONTRACT_SCHEDULE],
    };
    expect(toTruckMaintenance(body)).toMatchObject({
      truckId: "a0b1c2d3-…",
      latestReading: { odometerMiles: 182340, engineHours: null },
      schedules: [{ id: "5e6f7a8b-…" }],
    });
    expect(toMyTruck({ ...body, unitNumber: "104", openTasks: [CONTRACT_TASK] })).toMatchObject({
      unitNumber: "104",
      openTasks: [{ id: "9a8b7c6d-…" }],
    });
  });

  it("repeats the status parameter instead of status[]", () => {
    expect(taskQuery({ status: ["OPEN", "ACKNOWLEDGED"], page: 1, pageSize: 50 }).toString()).toBe(
      "page=1&pageSize=50&status=OPEN&status=ACKNOWLEDGED",
    );
  });
});
