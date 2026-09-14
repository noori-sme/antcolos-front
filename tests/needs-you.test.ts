import test from "node:test";
import assert from "node:assert/strict";
import { mockNeedsYouService } from "@/lib/api/mock/needs-you";
import { mockStore } from "@/lib/api/mock/store";
import {
  recordCompletedService, reportDefect, resetMaintenanceRegistry,
  updateDefectState, returnToService,
} from "@/lib/api/mock/maintenance-registry";
import { resetTruckRegistry, TRUCK_IDS } from "@/lib/api/mock/truck-registry";
import { resetTrailerRegistry } from "@/lib/api/mock/trailer-registry";
import { ctxFor, rejects, serviceContext } from "./helpers.ts";

const truck = (id: string) => ({ kind: "truck" as const, equipmentId: id });

test.beforeEach(() => {
  resetMaintenanceRegistry();
  resetTruckRegistry();
  resetTrailerRegistry();
  mockStore.reset();
});

/* -------------------------------------------------------------------------- */
/* Maintenance raises REAL items into the existing queue                       */
/* -------------------------------------------------------------------------- */

test("maintenance items appear in the one Needs You queue", async () => {
  const ctx = serviceContext("mem_northline_owner");
  const items = await mockNeedsYouService.list(ctx, {});

  const categories = new Set(items.map((i) => i.category));
  assert.ok(categories.has("overdue_service"));
  assert.ok(categories.has("critical_defect"));
  assert.ok(categories.has("unresolved_repair"));
  assert.ok(categories.has("equipment_out_of_service"));

  // And the pre-existing operational items are still there — one queue, not two.
  assert.ok(categories.has("rate_con_verification"));
  // A truck going empty is now the derived missing_availability rule rather
  // than the seeded truck_going_empty card it replaced.
  assert.ok(categories.has("missing_availability"));
});

test("every maintenance item points at a record that actually exists", async () => {
  const ctx = serviceContext("mem_northline_owner");
  const items = (await mockNeedsYouService.list(ctx, {}))
    .filter((i) => i.id.startsWith("mny_"));

  assert.ok(items.length > 0);
  for (const item of items) {
    assert.ok(item.entity.id, "an item always names its record");
    assert.ok(item.entity.href?.startsWith("/maintenance/"), "and links somewhere real");
    assert.equal(item.source, "system");
    assert.deepEqual(item.requires, ["maintenance:view"]);
    assert.equal(item.organizationId, "org_northline");
  }
});

test("an unsafe defect raises a critical item, and resolving it removes the item", async () => {
  const svcCtx = serviceContext("mem_northline_owner");
  const mCtx = ctxFor("mem_northline_owner");

  const defect = await reportDefect({
    equipment: truck(TRUCK_IDS.nl131),
    area: "brakes",
    severity: "out_of_service",
    availabilityImpact: "out_of_service",
    summary: "Brake chamber pushrod well past the adjustment limit",
  }, mCtx);

  const raised = await mockNeedsYouService.list(svcCtx, {});
  const item = raised.find((i) => i.id === `mny_dfc_${defect.id}`);
  assert.ok(item, "the fault produced an item");
  assert.equal(item.severity, "critical");

  // Resolve the underlying fault and release the equipment.
  await updateDefectState(defect.id, "resolved", "Slack adjusters replaced.", mCtx);
  await returnToService(truck(TRUCK_IDS.nl131), "Road tested.", mCtx);

  const after = await mockNeedsYouService.list(svcCtx, {});
  assert.equal(
    after.find((i) => i.id === `mny_dfc_${defect.id}`),
    undefined,
    "the item is gone because the condition is gone, not because it was dismissed",
  );
  assert.equal(
    after.find((i) => i.category === "equipment_out_of_service" && i.entity.id === TRUCK_IDS.nl131),
    undefined,
  );
});

test("completing the work clears the overdue-service item it produced", async () => {
  const svcCtx = serviceContext("mem_northline_owner");
  const mCtx = ctxFor("mem_northline_owner");

  const before = await mockNeedsYouService.list(svcCtx, {});
  assert.ok(before.some((i) => i.id === "mny_svc_req_nl115_dot" || i.category === "overdue_service"));

  await recordCompletedService({ repairOrderId: "ro_nl_1043", downtimeHours: 30 }, mCtx);

  const after = await mockNeedsYouService.list(svcCtx, {});
  assert.equal(
    after.find((i) => i.id === "mny_ro_ro_nl_1043"),
    undefined,
    "the repair order is finished, so it is no longer stuck",
  );
});

/* -------------------------------------------------------------------------- */
/* Workflow on a derived item                                                  */
/* -------------------------------------------------------------------------- */

test("a derived item can be snoozed, and the snooze holds", async () => {
  const ctx = serviceContext("mem_northline_owner");
  const target = (await mockNeedsYouService.list(ctx, {}))
    .find((i) => i.category === "unresolved_repair")!;

  const snoozed = await mockNeedsYouService.snooze(ctx, target.id, {
    hours: 4, reason: "Chasing the shop this afternoon.",
  });
  assert.equal(snoozed.status, "snoozed");

  const reread = await mockNeedsYouService.get(ctx, target.id);
  assert.equal(reread.status, "snoozed");
  assert.equal(reread.snoozeReason, "Chasing the shop this afternoon.");
  assert.ok(reread.history.some((h) => h.action === "snoozed"));
});

test("snooze caps apply to maintenance items too", async () => {
  const ctx = serviceContext("mem_northline_owner");
  const critical = (await mockNeedsYouService.list(ctx, {}))
    .find((i) => i.category === "critical_defect")!;

  // A critical item may be snoozed for at most two hours.
  await assert.rejects(
    () => mockNeedsYouService.snooze(ctx, critical.id, { hours: 24, reason: "Later" }),
    /at most 2 hours/,
  );
});

test("a derived item can be assigned and the assignment survives a re-read", async () => {
  const ctx = serviceContext("mem_northline_owner");
  const target = (await mockNeedsYouService.list(ctx, {}))
    .find((i) => i.category === "overdue_service")!;

  await mockNeedsYouService.assign(ctx, target.id, "mem_nl_shop");
  const reread = await mockNeedsYouService.get(ctx, target.id);
  assert.equal(reread.assigneeMembershipId, "mem_nl_shop");
});

test("resolving an item needs the permission its action declares", async () => {
  const ctx = serviceContext("mem_northline_owner");
  const target = (await mockNeedsYouService.list(ctx, {}))
    .find((i) => i.category === "equipment_out_of_service")!;

  const stripped = {
    ...ctx,
    permissions: new Set([...ctx.permissions].filter((k) => k !== "maintenance:outofservice:manage")),
  };
  await assert.rejects(
    () => mockNeedsYouService.resolve(stripped, target.id, "Done"),
    /Missing permission/,
  );
});

/* -------------------------------------------------------------------------- */
/* Scoping of the queue itself                                                 */
/* -------------------------------------------------------------------------- */

test("a caller without maintenance:view gets no maintenance items", async () => {
  const ctx = serviceContext("mem_northline_owner");
  const stripped = {
    ...ctx,
    permissions: new Set([...ctx.permissions].filter((k) => k !== "maintenance:view")),
  };

  const items = await mockNeedsYouService.list(stripped, {});
  assert.equal(items.filter((i) => i.id.startsWith("mny_")).length, 0);
  // The rest of the queue is untouched.
  assert.ok(items.length > 0);
});

test("a dispatch organization gets no maintenance items from equipment it dispatches", async () => {
  const ctx = serviceContext("mem_meridian_dispatcher");
  const items = await mockNeedsYouService.list(ctx, {});
  assert.equal(items.filter((i) => i.id.startsWith("mny_")).length, 0);
});

test("one organization's maintenance items never reach another", async () => {
  const northline = await mockNeedsYouService.list(serviceContext("mem_northline_owner"), {});
  const baxter = await mockNeedsYouService.list(serviceContext("mem_baxter_owner"), {});

  const nlIds = new Set(northline.map((i) => i.id));
  for (const item of baxter) {
    assert.equal(item.organizationId, "org_baxter");
    assert.ok(!nlIds.has(item.id), "no item is shared across organizations");
  }
});

test("the open count includes maintenance and matches the visible queue", async () => {
  const ctx = serviceContext("mem_northline_owner");
  const count = await mockNeedsYouService.openCount(ctx);
  const open = (await mockNeedsYouService.list(ctx, {}))
    .filter((i) => i.status === "open" || i.status === "escalated");
  assert.equal(count, open.length);
  assert.ok(count > 0);
});

/* -------------------------------------------------------------------------- */
/* Existing Needs You behavior still holds                                     */
/* -------------------------------------------------------------------------- */

test("the queue is still ordered by urgency", async () => {
  const ctx = serviceContext("mem_northline_owner");
  const items = await mockNeedsYouService.list(ctx, {});
  const rank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  for (let i = 1; i < items.length; i++) {
    assert.ok(
      rank[items[i - 1].severity] <= rank[items[i].severity],
      "severity never goes backwards down the list",
    );
  }
});

test("filters still work across the merged queue", async () => {
  const ctx = serviceContext("mem_northline_owner");

  const critical = await mockNeedsYouService.list(ctx, { severity: ["critical"] });
  for (const item of critical) assert.equal(item.severity, "critical");

  const maintenanceOnly = await mockNeedsYouService.list(ctx, {
    category: ["overdue_service", "critical_defect"],
  });
  assert.ok(maintenanceOnly.length > 0);
  for (const item of maintenanceOnly) {
    assert.ok(["overdue_service", "critical_defect"].includes(item.category));
  }

  const byEntity = await mockNeedsYouService.list(ctx, { entityKind: ["trailer"] });
  for (const item of byEntity) assert.equal(item.entity.kind, "trailer");
});

test("a driver still sees only their own items", async () => {
  const ctx = serviceContext("mem_cascade_driver");
  const items = await mockNeedsYouService.list(ctx, {});

  for (const item of items) {
    assert.equal(item.organizationId, "org_cascade");
  }
  // The seeded driver items are still reachable.
  assert.ok(items.length > 0);
});

test("an unknown item id is still not found", async () => {
  const ctx = serviceContext("mem_northline_owner");
  await rejects(() => mockNeedsYouService.get(ctx, "mny_svc_nope"), "NotFoundError");
  await rejects(() => mockNeedsYouService.get(ctx, "ny_nope"), "NotFoundError");
});

test("escalate and reopen still work on a seeded item", async () => {
  const ctx = serviceContext("mem_northline_owner");
  const seeded = (await mockNeedsYouService.list(ctx, {}))
    .find((i) => !i.id.startsWith("mny_"))!;

  const escalated = await mockNeedsYouService.escalate(ctx, seeded.id, { note: "Needs an owner." });
  assert.equal(escalated.status, "escalated");

  const resolved = await mockNeedsYouService.resolve(ctx, seeded.id, "Handled.");
  assert.equal(resolved.status, "resolved");

  const reopened = await mockNeedsYouService.reopen(ctx, seeded.id);
  assert.equal(reopened.status, "open");
  assert.equal(reopened.resolvedAt, undefined);
});
