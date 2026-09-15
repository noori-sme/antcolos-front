import test from "node:test";
import assert from "node:assert/strict";
import {
  equipmentAccess, listDefectsSync, listRepairOrdersSync, listRequirementsSync,
  listServiceHistorySync, listSharedWithMeSync, maintenanceSummarySync,
  maintenanceRole, reportDefect, resetMaintenanceRegistry, returnToService,
  shareMaintenance,
} from "@/lib/api/mock/maintenance-registry";
import { TRUCK_IDS } from "@/lib/api/mock/truck-registry";
import { TRAILER_IDS } from "@/lib/api/mock/trailer-registry";
import { ctxFor, rejects, withOnly, without } from "./helpers.ts";

const truck = (id: string) => ({ kind: "truck" as const, equipmentId: id });
const trailer = (id: string) => ({ kind: "trailer" as const, equipmentId: id });

test.beforeEach(() => resetMaintenanceRegistry());

/* -------------------------------------------------------------------------- */
/* Permission enforcement lives at the seam, not in the screens                */
/* -------------------------------------------------------------------------- */

test("every read returns nothing without maintenance:view", () => {
  const blind = without(ctxFor("mem_northline_owner"), "maintenance:view");
  assert.equal(listRequirementsSync(blind).length, 0);
  assert.equal(listDefectsSync(blind).length, 0);
  assert.equal(listRepairOrdersSync(blind).length, 0);
  assert.equal(listServiceHistorySync(truck(TRUCK_IDS.nl104), blind).length, 0);
  assert.equal(listSharedWithMeSync(blind).length, 0);
});

test("reporting a defect requires the reporting permission", async () => {
  const ctx = without(ctxFor("mem_northline_owner"), "maintenance:defects:report");
  await rejects(
    () => reportDefect({
      equipment: truck(TRUCK_IDS.nl104),
      area: "brakes", severity: "minor", availabilityImpact: "none",
      summary: "Test",
    }, ctx),
    "MaintenancePermissionError",
  );
});

test("returning equipment to service requires the out-of-service permission", async () => {
  const ctx = without(ctxFor("mem_northline_owner"), "maintenance:outofservice:manage");
  await rejects(
    () => returnToService(truck(TRUCK_IDS.nl115), "Fixed", ctx),
    "MaintenancePermissionError",
  );
});

/* -------------------------------------------------------------------------- */
/* Cross-organization isolation                                               */
/* -------------------------------------------------------------------------- */

test("a carrier sees only its own requirements, defects and repair orders", () => {
  const northline = ctxFor("mem_northline_owner");
  const baxter = ctxFor("mem_baxter_owner");

  for (const view of listRequirementsSync(northline)) {
    assert.equal(view.requirement.organizationId, "org_northline");
  }
  for (const view of listRequirementsSync(baxter)) {
    assert.equal(view.requirement.organizationId, "org_baxter");
  }
  for (const defect of listDefectsSync(northline)) {
    assert.equal(defect.organizationId, "org_northline");
  }
  for (const order of listRepairOrdersSync(baxter)) {
    assert.equal(order.organizationId, "org_baxter");
  }
});

test("two carriers approved on one truck keep separate schedules on it", () => {
  // Baxter and Northline are both approved to run nl104.
  const northline = ctxFor("mem_northline_owner");
  const baxter = ctxFor("mem_baxter_owner");

  assert.equal(equipmentAccess(truck(TRUCK_IDS.nl104), northline)?.kind, "operator");
  assert.equal(equipmentAccess(truck(TRUCK_IDS.nl104), baxter)?.kind, "operator");

  const nlOnNl104 = listRequirementsSync(northline, { equipment: truck(TRUCK_IDS.nl104) });
  const bxOnNl104 = listRequirementsSync(baxter, { equipment: truck(TRUCK_IDS.nl104) });

  assert.ok(nlOnNl104.length > 0, "Northline keeps a schedule on nl104");
  assert.equal(bxOnNl104.length, 0, "Baxter sees none of Northline's schedule for it");
});

test("a carrier cannot reach another carrier's equipment at all", () => {
  const cascade = ctxFor("mem_cascade_driver");
  // A Northline truck Cascade has no relationship with whatsoever.
  assert.equal(equipmentAccess(truck(TRUCK_IDS.nl115), cascade), null);
});

/* -------------------------------------------------------------------------- */
/* Service history survives ownership and operating changes                    */
/* -------------------------------------------------------------------------- */

test("equipment history includes work done for another organization", () => {
  const northline = ctxFor("mem_northline_owner");
  const history = listServiceHistorySync(truck(TRUCK_IDS.nl104), northline);

  const foreign = history.find((h) => !h.ownRecord);
  assert.ok(foreign, "Baxter's work on nl104 is part of the truck's history");
  assert.equal(foreign.record.performedForOrganizationName, "Baxter Transit LLC");
  // The event survives; the other carrier's commercial detail does not.
  assert.equal(foreign.redacted, true);
  assert.equal(foreign.record.cost, undefined);
  assert.equal(foreign.record.vendor, undefined);
  assert.equal(foreign.record.notes, undefined);
  assert.equal(foreign.record.responsibleName, undefined);
  // What a new operator legitimately needs is still there.
  assert.equal(foreign.record.title, "Roadside tire replacement, drive axle");
  assert.ok(foreign.record.meter?.odometerMiles);
});

test("each carrier sees its own records in full and the other's redacted", () => {
  const baxter = ctxFor("mem_baxter_owner");
  const own = listServiceHistorySync(truck(TRUCK_IDS.nl104), baxter)
    .find((h) => h.record.id === "svc_nl104_baxter_tire");

  assert.ok(own);
  assert.equal(own.ownRecord, true);
  assert.equal(own.redacted, false);
  assert.ok(own.record.cost?.actual, "the carrier that paid the bill can see it");
  assert.equal(own.record.vendor?.name, "Keystone Tire & Service");

  // And the reverse: Northline's own records on the same truck are full to it.
  const northline = ctxFor("mem_northline_owner");
  const nlOwn = listServiceHistorySync(truck(TRUCK_IDS.nl104), northline)
    .find((h) => h.record.id === "svc_nl104_dot");
  assert.ok(nlOwn);
  assert.equal(nlOwn.redacted, false);
  assert.ok(nlOwn.record.cost?.actual);
});

test("cost is withheld from a caller without the cost permission", () => {
  const ctx = without(ctxFor("mem_northline_owner"), "maintenance:costs:view");
  const history = listServiceHistorySync(truck(TRUCK_IDS.nl104), ctx);
  for (const entry of history) {
    assert.equal(entry.record.cost, undefined, "no record leaks money");
  }

  const orders = listRepairOrdersSync(ctx);
  for (const order of orders) {
    assert.deepEqual(order.cost, {}, "repair orders show the work, not the bill");
    for (const line of order.lines) assert.equal(line.unitCostCents, undefined);
  }

  const summary = maintenanceSummarySync(ctx);
  assert.equal(summary.costLast30Days, undefined, "absent, never zero");
  assert.equal(summary.downtimeHoursLast30Days, undefined);
});

test("cost is present for a caller who holds the permission", () => {
  const summary = maintenanceSummarySync(ctxFor("mem_northline_owner"));
  assert.ok(summary.costLast30Days, "an owner sees the money");
  assert.equal(summary.costLast30Days.currency, "USD");
});

/* -------------------------------------------------------------------------- */
/* Dispatch organizations see only what is explicitly shared                   */
/* -------------------------------------------------------------------------- */

test("dispatch access to a truck is not access to its maintenance", () => {
  const meridian = ctxFor("mem_meridian_dispatcher");

  // Meridian dispatches Crosswind's C-31, but Crosswind shared no maintenance.
  assert.equal(equipmentAccess(truck(TRUCK_IDS.crosswind), meridian), null);
  // And Ridgeway's B-04, likewise.
  assert.equal(equipmentAccess(truck(TRUCK_IDS.mdB04), meridian), null);

  // Where Baxter DID share, access exists — and only as a share.
  assert.equal(equipmentAccess(truck(TRUCK_IDS.mdA12), meridian)?.kind, "shared_dispatch");
});

test("a shared dispatch view carries no cost, vendor, notes or defect detail", () => {
  const meridian = ctxFor("mem_meridian_dispatcher");
  const shared = listSharedWithMeSync(meridian);

  assert.equal(shared.length, 2, "only the two trucks Baxter shared");
  for (const view of shared) {
    const serialized = JSON.stringify(view);
    assert.ok(!serialized.includes("Lehigh Diesel"), "no vendor names");
    assert.ok(!serialized.includes("Keystone"), "no vendor names");
    assert.ok(!serialized.includes("amount"), "no money of any kind");
    // Defects are a count, never a description.
    assert.equal(typeof view.openDefectCount, "number");
    assert.ok(!serialized.includes("fifth wheel"), "no defect detail");
  }
});

test("the narrow share scope withholds the schedule as well", () => {
  const meridian = ctxFor("mem_meridian_dispatcher");
  const shared = listSharedWithMeSync(meridian);

  const wide = shared.find((v) => v.scope === "availability_and_schedule");
  const narrow = shared.find((v) => v.scope === "availability_only");

  assert.ok(wide?.openRequirements, "the wider scope includes what is due");
  assert.equal(narrow?.openRequirements, undefined, "the narrow one does not");
});

test("a dispatch organization sees no requirements, defects or repair orders", () => {
  const meridian = ctxFor("mem_meridian_dispatcher");
  assert.equal(listRequirementsSync(meridian).length, 0);
  assert.equal(listDefectsSync(meridian).length, 0);
  assert.equal(listRepairOrdersSync(meridian).length, 0);
  assert.equal(listServiceHistorySync(truck(TRUCK_IDS.mdA12), meridian).length, 0);
});

test("a dispatch organization with nothing shared sees nothing", () => {
  // Summit holds no dispatch access and nobody has shared with it.
  const summit = ctxFor("mem_summit_owner");
  assert.equal(listSharedWithMeSync(summit).length, 0);
  assert.equal(listRequirementsSync(summit).length, 0);
});

test("a dispatch organization cannot report a defect on shared equipment", async () => {
  const meridian = ctxFor("mem_meridian_dispatcher");
  const ctx = { ...meridian, permissions: new Set([...meridian.permissions, "maintenance:defects:report" as const]) };
  await rejects(
    () => reportDefect({
      equipment: truck(TRUCK_IDS.mdA12),
      area: "brakes", severity: "minor", availabilityImpact: "none",
      summary: "Not their equipment",
    }, ctx),
    "MaintenanceNotFoundError",
  );
});

test("sharing requires the share permission and a reason", async () => {
  const baxter = ctxFor("mem_baxter_owner");
  await rejects(
    () => shareMaintenance({
      equipment: truck(TRUCK_IDS.mdA12),
      sharedWithOrganizationId: "org_meridian",
      scope: "availability_only",
      reason: "   ",
    }, baxter),
    "MaintenanceRuleError",
  );

  await rejects(
    () => shareMaintenance({
      equipment: truck(TRUCK_IDS.mdA12),
      sharedWithOrganizationId: "org_meridian",
      scope: "availability_only",
      reason: "Because",
    }, without(baxter, "maintenance:share:manage")),
    "MaintenancePermissionError",
  );
});

/* -------------------------------------------------------------------------- */
/* Driver responsibility scope                                                 */
/* -------------------------------------------------------------------------- */

test("a driver reaches only the equipment they are assigned to", () => {
  const driver = ctxFor("mem_cascade_driver");
  const access = equipmentAccess(truck(TRUCK_IDS.cs47), driver);
  assert.equal(access?.kind, "assigned_driver", "their own truck, as a driver");

  // Not the operator view, even though Cascade is the operating carrier.
  assert.notEqual(access?.kind, "operator");
});

test("a driver sees the faults on their truck but not the carrier's schedule", () => {
  const driver = ctxFor("mem_cascade_driver");

  const defects = listDefectsSync(driver);
  assert.ok(defects.length > 0, "faults on the truck they are on");
  for (const defect of defects) {
    assert.equal(defect.equipment.equipmentId, TRUCK_IDS.cs47);
  }

  // Requirements and repair orders are the operator's, and a driver is not one.
  assert.equal(listRequirementsSync(driver).length, 0);
  assert.equal(listRepairOrdersSync(driver).length, 0);
});

test("a driver's service history omits cost", () => {
  const driver = ctxFor("mem_cascade_driver");
  const history = listServiceHistorySync(truck(TRUCK_IDS.cs47), driver);
  assert.ok(history.length > 0, "a driver can see the truck has been serviced");
  for (const entry of history) assert.equal(entry.record.cost, undefined);
});

test("a driver can report a defect on their own truck", async () => {
  const driver = ctxFor("mem_cascade_driver");
  const defect = await reportDefect({
    equipment: truck(TRUCK_IDS.cs47),
    area: "tires_wheels",
    severity: "major",
    availabilityImpact: "reduced",
    summary: "Steer tire down to the wear bars",
  }, driver);

  assert.equal(defect.reportedByDriverProfileId, "drv_cascade_0192");
  assert.equal(defect.state, "reported");
  assert.equal(defect.organizationId, "org_cascade");
});

test("a driver cannot report a defect on equipment they are not on", async () => {
  const driver = ctxFor("mem_cascade_driver");
  await rejects(
    () => reportDefect({
      equipment: trailer(TRAILER_IDS.dv220),
      area: "body_doors", severity: "minor", availabilityImpact: "none",
      summary: "Not their trailer",
    }, driver),
    "MaintenanceNotFoundError",
  );
});

/* -------------------------------------------------------------------------- */
/* A forbidden record and a missing record are the same answer                 */
/* -------------------------------------------------------------------------- */

test("equipment the caller cannot see is reported as not found, not forbidden", async () => {
  const cascade = ctxFor("mem_cascade_driver");
  const error = await rejects(
    () => reportDefect({
      equipment: truck(TRUCK_IDS.nl115),
      area: "brakes", severity: "minor", availabilityImpact: "none",
      summary: "Probing another carrier's fleet",
    }, withOnly(cascade, "maintenance:view", "maintenance:defects:report")),
    "MaintenanceNotFoundError",
  );
  assert.ok(!error.message.includes("permission"));
});

/* -------------------------------------------------------------------------- */
/* What a caller is, to maintenance                                            */
/* -------------------------------------------------------------------------- */

test("a caller's maintenance role comes from relationships, not from records", () => {
  assert.equal(maintenanceRole(ctxFor("mem_northline_owner")), "operator");
  assert.equal(maintenanceRole(ctxFor("mem_baxter_owner")), "operator");
  assert.equal(maintenanceRole(ctxFor("mem_cascade_driver")), "assigned_driver");
  // Dispatches equipment, operates none.
  assert.equal(maintenanceRole(ctxFor("mem_meridian_dispatcher")), "dispatch_viewer");
  // Operates nothing and has nothing shared with it — still a dispatch viewer,
  // so it never gets a carrier dashboard full of zeros.
  assert.equal(maintenanceRole(ctxFor("mem_summit_owner")), "dispatch_viewer");
});
