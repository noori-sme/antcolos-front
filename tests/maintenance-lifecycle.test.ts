import test from "node:test";
import assert from "node:assert/strict";
import {
  addRepairOrderLine, createRequirement, deferRequirement, getRepairOrder,
  listDefectsSync, listRequirementsSync, listServiceHistorySync, openRepairOrder,
  placeOutOfService, raiseRequirementFromDefect, recordCompletedService,
  recordMeterReading, reportDefect, resetMaintenanceRegistry, returnToService,
  updateDefectState, updateRepairOrderStatus, isOutOfService, meterFor,
} from "@/lib/api/mock/maintenance-registry";
import { TRUCK_IDS } from "@/lib/api/mock/truck-registry";
import { TRAILER_IDS } from "@/lib/api/mock/trailer-registry";
import { ctxFor, rejects } from "./helpers.ts";

const truck = (id: string) => ({ kind: "truck" as const, equipmentId: id });
const trailer = (id: string) => ({ kind: "trailer" as const, equipmentId: id });

test.beforeEach(() => resetMaintenanceRegistry());

/* -------------------------------------------------------------------------- */
/* Defects park equipment, and cannot be argued away                           */
/* -------------------------------------------------------------------------- */

test("a defect reported as unsafe parks the equipment in the same call", async () => {
  const ctx = ctxFor("mem_northline_owner");
  const ref = truck(TRUCK_IDS.nl131);
  assert.equal(isOutOfService(ref), false);

  const defect = await reportDefect({
    equipment: ref,
    area: "steering_suspension",
    severity: "out_of_service",
    availabilityImpact: "out_of_service",
    summary: "Steering play well beyond spec",
  }, ctx);

  assert.equal(isOutOfService(ref), true, "parked immediately, not after triage");
  assert.ok(defect.history.some((h) => h.action === "placed_out_of_service"));
});

test("an unsafe defect must also be marked unusable", async () => {
  const ctx = ctxFor("mem_northline_owner");
  await rejects(
    () => reportDefect({
      equipment: truck(TRUCK_IDS.nl131),
      area: "brakes",
      severity: "out_of_service",
      availabilityImpact: "reduced",
      summary: "Contradictory report",
    }, ctx),
    "MaintenanceRuleError",
  );
});

test("equipment cannot be returned to service while an unsafe defect is open", async () => {
  const ctx = ctxFor("mem_northline_owner");
  // nl115 is parked by an open out-of-service defect in the fixtures.
  const error = await rejects(
    () => returnToService(truck(TRUCK_IDS.nl115), "Looks fine to me", ctx),
    "MaintenanceRuleError",
  );
  assert.match(error.message, /should not be driven/);
  assert.equal(isOutOfService(truck(TRUCK_IDS.nl115)), true);
});

test("an unsafe defect cannot be dismissed, only resolved with what was done", async () => {
  const ctx = ctxFor("mem_northline_owner");
  await rejects(
    () => updateDefectState("dfc_nl115_brakes", "dismissed", "Not a real problem", ctx),
    "MaintenanceRuleError",
  );
});

test("closing a defect needs a note either way", async () => {
  const ctx = ctxFor("mem_northline_owner");
  await rejects(
    () => updateDefectState("dfc_nl104_mirror", "resolved", "  ", ctx),
    "MaintenanceRuleError",
  );
  await rejects(
    () => updateDefectState("dfc_nl104_mirror", "dismissed", undefined, ctx),
    "MaintenanceRuleError",
  );
});

test("returning to service works once the blocking defect is resolved", async () => {
  const ctx = ctxFor("mem_northline_owner");
  await updateDefectState("dfc_nl115_brakes", "resolved", "Chambers replaced.", ctx);
  const hold = await returnToService(truck(TRUCK_IDS.nl115), "Road tested, holds pressure.", ctx);

  assert.ok(hold.releasedAt);
  assert.equal(hold.releaseNote, "Road tested, holds pressure.");
  assert.equal(isOutOfService(truck(TRUCK_IDS.nl115)), false);
});

test("only the organization that parked equipment may release it", async () => {
  const baxter = ctxFor("mem_baxter_owner");
  // Northline parked nl115, and Baxter has no relationship with it at all.
  await rejects(() => returnToService(truck(TRUCK_IDS.nl115), "Fine", baxter), "MaintenanceNotFoundError");
});

test("a defect's history is appended to, never rewritten", async () => {
  const ctx = ctxFor("mem_northline_owner");
  const before = listDefectsSync(ctx).find((d) => d.id === "dfc_nl104_mirror")!;
  const originalLength = before.history.length;
  const [first] = before.history;

  const after = await updateDefectState("dfc_nl104_mirror", "acknowledged", "Ordering glass.", ctx);

  assert.equal(after.history.length, originalLength + 1);
  assert.deepEqual(after.history[0], first, "the first entry is untouched");
  assert.equal(after.history.at(-1)?.previousValue, "reported");
  assert.equal(after.history.at(-1)?.newValue, "acknowledged");
});

/* -------------------------------------------------------------------------- */
/* Deferral is a recorded decision, not a snooze                               */
/* -------------------------------------------------------------------------- */

test("a deferral needs a reason", async () => {
  const ctx = ctxFor("mem_northline_owner");
  await rejects(
    () => deferRequirement("req_nl111_tires", { reason: "   " }, ctx),
    "MaintenanceRuleError",
  );
});

test("a safety-critical requirement can only be deferred to a date", async () => {
  const ctx = ctxFor("mem_northline_owner");
  await rejects(
    () => deferRequirement("req_nl118_dot", { reason: "Waiting on the inspector" }, ctx),
    "MaintenanceRuleError",
  );

  const view = await deferRequirement(
    "req_nl118_dot",
    { reason: "Inspector booked for the 22nd.", until: new Date(Date.now() + 8 * 86_400_000).toISOString() },
    ctx,
  );
  assert.equal(view.state, "deferred");
});

test("a requirement raised by an unsafe defect can never be deferred", async () => {
  const ctx = ctxFor("mem_northline_owner");
  const view = await raiseRequirementFromDefect(
    "dfc_oos602_floor",
    { category: "body" },
    ctx,
  );

  const error = await rejects(
    () => deferRequirement(view.requirement.id, { reason: "Busy season", until: new Date(Date.now() + 86_400_000).toISOString() }, ctx),
    "MaintenanceRuleError",
  );
  assert.match(error.message, /should not be driven/);
});

/* -------------------------------------------------------------------------- */
/* Requirement, defect and repair order stay linked but separate               */
/* -------------------------------------------------------------------------- */

test("opening a repair order moves its requirement and defect, not merges them", async () => {
  const ctx = ctxFor("mem_northline_owner");

  const order = await openRepairOrder({
    equipment: truck(TRUCK_IDS.nl107),
    title: "Diagnose ABS lamp and do the brake inspection",
    requirementIds: ["req_nl107_brakes"],
    defectIds: ["dfc_nl107_abs"],
    vendorId: "ven_nl_halsted",
  }, ctx);

  assert.equal(order.status, "open");
  assert.deepEqual(order.requirementIds, ["req_nl107_brakes"]);
  assert.deepEqual(order.defectIds, ["dfc_nl107_abs"]);

  const requirement = listRequirementsSync(ctx).find((v) => v.requirement.id === "req_nl107_brakes")!;
  assert.equal(requirement.state, "in_service", "the requirement reads as in service");
  assert.equal(requirement.requirement.activeRepairOrderId, order.id);

  const defect = listDefectsSync(ctx).find((d) => d.id === "dfc_nl107_abs")!;
  assert.equal(defect.state, "in_repair");
  assert.equal(defect.repairOrderId, order.id);

  // Still four separate records, each openable on its own.
  assert.notEqual(order.id, requirement.requirement.id);
  assert.notEqual(order.id, defect.id);
});

test("a repair order cannot link to records on other equipment", async () => {
  const ctx = ctxFor("mem_northline_owner");
  const order = await openRepairOrder({
    equipment: truck(TRUCK_IDS.nl107),
    title: "Unrelated work",
    // A requirement belonging to a different truck entirely.
    requirementIds: ["req_nl118_dot"],
    defectIds: ["dfc_nl104_mirror"],
  }, ctx);

  assert.deepEqual(order.requirementIds, [], "silently ignored, never attached");
  assert.deepEqual(order.defectIds, []);
});

test("cancelling a repair order releases what it was holding", async () => {
  const ctx = ctxFor("mem_northline_owner");
  const order = await openRepairOrder({
    equipment: truck(TRUCK_IDS.nl107),
    title: "Brake inspection",
    requirementIds: ["req_nl107_brakes"],
    defectIds: ["dfc_nl107_abs"],
  }, ctx);

  await updateRepairOrderStatus(order.id, "cancelled", "Shop could not take it.", ctx);

  const requirement = listRequirementsSync(ctx).find((v) => v.requirement.id === "req_nl107_brakes")!;
  assert.notEqual(requirement.state, "in_service", "nothing was done, so nothing reads as in service");
  assert.equal(requirement.requirement.activeRepairOrderId, undefined);

  const defect = listDefectsSync(ctx).find((d) => d.id === "dfc_nl107_abs")!;
  assert.equal(defect.state, "acknowledged", "back to open work, not closed");
});

test("cancelling a repair order needs a reason", async () => {
  const ctx = ctxFor("mem_northline_owner");
  await rejects(
    () => updateRepairOrderStatus("ro_nl_1038", "cancelled", "  ", ctx),
    "MaintenanceRuleError",
  );
});

/* -------------------------------------------------------------------------- */
/* Service history is immutable                                                */
/* -------------------------------------------------------------------------- */

test("completing a repair order writes a permanent record and closes what it answered", async () => {
  const ctx = ctxFor("mem_northline_owner");
  const before = listServiceHistorySync(truck(TRUCK_IDS.nl115), ctx).length;

  const record = await recordCompletedService({
    repairOrderId: "ro_nl_1043",
    summary: "Both front service chambers replaced. Annual inspection passed.",
    downtimeHours: 31,
    meter: { odometerMiles: 612_100, engineHours: 18_248 },
  }, ctx);

  const after = listServiceHistorySync(truck(TRUCK_IDS.nl115), ctx);
  assert.equal(after.length, before + 1);

  // Everything a later reader needs is snapshotted into the record itself.
  assert.equal(record.performedForOrganizationId, "org_northline");
  assert.equal(record.performedForOrganizationName, "Northline Freight");
  assert.equal(record.repairOrderNumber, "RO-1043");
  assert.equal(record.vendor?.name, "Halsted Truck Center");
  assert.equal(record.requirementTitle, "Annual DOT inspection");
  assert.ok(record.cost?.actual);

  // The defect it answered is resolved.
  const defect = listDefectsSync(ctx).find((d) => d.id === "dfc_nl115_brakes")!;
  assert.equal(defect.state, "resolved");

  // And the recurring requirement rolled forward rather than closing.
  const requirement = listRequirementsSync(ctx).find((v) => v.requirement.id === "req_nl115_dot")!;
  assert.equal(requirement.state, "upcoming");
  assert.equal(requirement.requirement.activeRepairOrderId, undefined);
});

test("a completed repair order cannot be reopened, changed or completed twice", async () => {
  const ctx = ctxFor("mem_northline_owner");
  await recordCompletedService({ repairOrderId: "ro_nl_1043", downtimeHours: 31 }, ctx);

  await rejects(
    () => recordCompletedService({ repairOrderId: "ro_nl_1043" }, ctx),
    "MaintenanceRuleError",
  );
  await rejects(
    () => updateRepairOrderStatus("ro_nl_1043", "in_progress", undefined, ctx),
    "MaintenanceRuleError",
  );
  await rejects(
    () => addRepairOrderLine("ro_nl_1043", { kind: "part", description: "Extra", totalCents: 100 }, ctx),
    "MaintenanceRuleError",
  );
});

test("a repair order cannot be marked completed without recording the service", async () => {
  const ctx = ctxFor("mem_northline_owner");
  const error = await rejects(
    () => updateRepairOrderStatus("ro_nl_1038", "completed", undefined, ctx),
    "MaintenanceRuleError",
  );
  assert.match(error.message, /permanent record/);
});

test("service cannot be recorded as happening in the future", async () => {
  const ctx = ctxFor("mem_northline_owner");
  await rejects(
    () => recordCompletedService({
      repairOrderId: "ro_nl_1038",
      performedAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    }, ctx),
    "MaintenanceRuleError",
  );
});

test("existing service records are never mutated by later work", async () => {
  const ctx = ctxFor("mem_northline_owner");
  const snapshot = JSON.stringify(
    listServiceHistorySync(truck(TRUCK_IDS.nl104), ctx).map((h) => h.record),
  );

  // Do a whole round of unrelated work on the same truck.
  const defect = await reportDefect({
    equipment: truck(TRUCK_IDS.nl104),
    area: "engine", severity: "major", availabilityImpact: "reduced",
    summary: "Coolant weep at the water pump",
  }, ctx);
  const order = await openRepairOrder({
    equipment: truck(TRUCK_IDS.nl104), title: "Water pump", defectIds: [defect.id],
  }, ctx);
  await recordCompletedService({ repairOrderId: order.id, downtimeHours: 6 }, ctx);

  const afterRecords = listServiceHistorySync(truck(TRUCK_IDS.nl104), ctx).map((h) => h.record);
  // The new record is appended; the old ones are byte-for-byte what they were.
  const preserved = afterRecords.filter((r) => snapshot.includes(`"${r.id}"`));
  assert.equal(JSON.stringify(preserved), snapshot);
});

/* -------------------------------------------------------------------------- */
/* Meters                                                                      */
/* -------------------------------------------------------------------------- */

test("a meter reading cannot go backwards", async () => {
  const ctx = ctxFor("mem_northline_owner");
  await rejects(
    () => recordMeterReading(truck(TRUCK_IDS.nl104), { odometerMiles: 100 }, ctx),
    "MaintenanceRuleError",
  );
});

test("a recorded reading says who typed it and is never called a feed", async () => {
  const ctx = ctxFor("mem_northline_owner");
  const meter = await recordMeterReading(
    truck(TRUCK_IDS.nl104), { odometerMiles: 119_000, note: "Read off the dash." }, ctx,
  );
  assert.equal(meter.latest?.source, "manual");
  assert.equal(meter.latest?.recordedBy?.displayNameSnapshot, "Sam Murtaza");
});

test("a driver's reading is recorded as a driver report", async () => {
  const ctx = ctxFor("mem_cascade_driver");
  // A driver is not an operator, so they cannot keep the schedule.
  await rejects(
    () => recordMeterReading(truck(TRUCK_IDS.cs47), { odometerMiles: 144_000 }, ctx),
    "MaintenancePermissionError",
  );

  // But a reading taken with a defect report is attributed correctly.
  const defect = await reportDefect({
    equipment: truck(TRUCK_IDS.cs47),
    area: "engine", severity: "minor", availabilityImpact: "none",
    summary: "Slight exhaust smell in the cab",
    meterAtReport: { odometerMiles: 144_010 },
  }, ctx);

  assert.equal(defect.meterAtReport?.source, "driver_report");
  assert.equal(meterFor(truck(TRUCK_IDS.cs47))?.latest?.odometerMiles, 144_010);
});

test("adding a cost line requires the cost permission", async () => {
  const ctx = ctxFor("mem_northline_owner");
  const stripped = { ...ctx, permissions: new Set([...ctx.permissions].filter((k) => k !== "maintenance:costs:view")) };
  await rejects(
    () => addRepairOrderLine("ro_nl_1041", { kind: "part", description: "Cross-member", totalCents: 50_000 }, stripped),
    "MaintenancePermissionError",
  );
});

test("cost lines roll up into the repair order total", async () => {
  const ctx = ctxFor("mem_northline_owner");
  await addRepairOrderLine("ro_nl_1041", { kind: "part", description: "Cross-member set", totalCents: 214_000 }, ctx);
  await addRepairOrderLine("ro_nl_1041", { kind: "labor", description: "Cut and weld", quantity: 9, unitCostCents: 15_000, totalCents: 135_000 }, ctx);

  const order = await getRepairOrder("ro_nl_1041", ctx);
  assert.equal(order.cost.actual?.amount, 349_000);
  assert.equal(order.cost.parts?.amount, 214_000);
  assert.equal(order.cost.labor?.amount, 135_000);
  // The estimate is kept alongside, not overwritten.
  assert.equal(order.cost.estimate?.amount, 380_000);
});

/* -------------------------------------------------------------------------- */
/* Creating requirements                                                       */
/* -------------------------------------------------------------------------- */

test("a requirement can only be created on equipment the caller operates", async () => {
  const ctx = ctxFor("mem_northline_owner");
  await rejects(
    () => createRequirement({
      equipment: truck(TRUCK_IDS.mdA18),
      title: "Not their truck",
      category: "preventive",
      criticality: "routine",
      trigger: { kind: "date", dueAt: new Date().toISOString(), warnDays: 30 },
    }, ctx),
    "MaintenanceNotFoundError",
  );
});

test("a requirement raised from a defect points back at it, once", async () => {
  const ctx = ctxFor("mem_northline_owner");
  const view = await raiseRequirementFromDefect(
    "dfc_nl107_abs", { category: "electrical", dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString() }, ctx,
  );

  assert.equal(view.requirement.trigger.kind, "defect");
  assert.equal(view.requirement.criticality, "safety_critical", "a critical fault raises a critical job");
  assert.equal(view.defect?.id, "dfc_nl107_abs");

  await rejects(
    () => raiseRequirementFromDefect("dfc_nl107_abs", { category: "electrical" }, ctx),
    "MaintenanceRuleError",
  );
});

test("placing equipment out of service by hand needs a reason", async () => {
  const ctx = ctxFor("mem_northline_owner");
  await rejects(
    () => placeOutOfService(trailer(TRAILER_IDS.dv220), { reason: "  " }, ctx),
    "MaintenanceRuleError",
  );

  const hold = await placeOutOfService(
    trailer(TRAILER_IDS.dv220), { reason: "Pulled for a pre-season inspection." }, ctx,
  );
  assert.equal(hold.organizationId, "org_northline");
  assert.equal(isOutOfService(trailer(TRAILER_IDS.dv220)), true);
});
