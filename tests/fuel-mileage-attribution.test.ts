import test from "node:test";
import assert from "node:assert/strict";
import { mockFuelService } from "@/lib/api/mock/fuel";
import { mileageAttributionReviewStanding } from "@/lib/api/mock/fuel-propagation";
import { resetFuelStore } from "@/lib/api/mock/fuel-store";
import { meterReadings, resetMeterLedger } from "@/lib/api/mock/meter-ledger";
import { mockNeedsYouService } from "@/lib/api/mock/needs-you";
import { resetPropagationBus } from "@/lib/propagation";
import { resetTruckRegistry, TRUCK_IDS } from "@/lib/api/mock/truck-registry";
import { resetTrailerRegistry } from "@/lib/api/mock/trailer-registry";
import { mockStore } from "@/lib/api/mock/store";
import { ALL_PERMISSIONS, serviceContext } from "./helpers.ts";
import type { JurisdictionMileageRecord } from "@/types";

/**
 * ★ THE LEG HAD THE SAME PROBLEM AS THE RECEIPT ★
 *
 * `JurisdictionMileageRecord` carries the same `no_active_operating_authority`
 * flag, derived from the same never-re-derived attribution snapshot, and
 * `syncFuelNeedsYou` reopens its item on the same read. It is a different
 * command, and it was the same permanently unresolvable queue item — so it gets
 * the same finding, through the same owner, on the same terms.
 *
 * One difference, and it matters: a leg has TWO instants. Its attribution is
 * resolved at `travelStartedAt`; its odometer is contributed at
 * `travelEndedAt`. The flag is about the first, so the finding is too.
 */

const DAY = 86_400_000;
const reviewer = () => serviceContext("mem_northline_owner");
const readOnly = () => serviceContext("mem_northline_owner", {
  permissions: new Set([...ALL_PERMISSIONS].filter((k) => k !== "mileage:review")),
});

/** Before anybody was onboarded on unit 131, so nothing covers the travel. */
const beforeAnyAuthority = () => new Date(Date.now() - 300 * DAY).toISOString();

const leg = (over: Record<string, unknown> = {}) => ({
  truckId: TRUCK_IDS.nl131,
  jurisdiction: "IL",
  travelStartedAt: beforeAnyAuthority(),
  travelEndedAt: new Date(Date.now() - 299 * DAY).toISOString(),
  totalMiles: 220,
  taxableMiles: 220,
  odometerEndMiles: 41_200,
  ...over,
});

async function mileageItemFor(id: string) {
  const queue = await mockNeedsYouService.list(reviewer());
  return queue.find((i) => i.category === "invalid_mileage" && i.id.includes(id));
}

test.beforeEach(() => {
  resetTruckRegistry();
  resetTrailerRegistry();
  resetFuelStore();
  resetMeterLedger();
  resetPropagationBus();
  mockStore.reset();
});

test("an unattributable leg keeps its odometer, out of the ledger, and asks", async () => {
  const created = await mockFuelService.recordMileage(reviewer(), leg());

  assert.equal(created.attribution.basis, "unresolved");
  assert.ok(created.flags.includes("no_active_operating_authority"));
  assert.equal(created.odometerEndMiles, 41_200, "the leg keeps the reading");
  assert.equal(
    meterReadings(TRUCK_IDS.nl131).some((r) => r.odometerMiles === 41_200), false,
    "and the ledger does not take one it cannot attribute",
  );
  assert.equal((await mileageItemFor(created.id))?.status, "open");
});

test("a finding needs the permission to review mileage, and a reason", async () => {
  const created = await mockFuelService.recordMileage(reviewer(), leg());

  await assert.rejects(
    () => mockFuelService.acceptMileageAttributionNotEstablishable(
      readOnly(), created.id, "Nothing on file.",
    ),
    (error: Error) => error.name === "PermissionDeniedError",
  );
  await assert.rejects(
    () => mockFuelService.acceptMileageAttributionNotEstablishable(reviewer(), created.id, " "),
    /reason/i,
  );
  assert.equal((await mileageItemFor(created.id))?.status, "open", "and the queue still asks");
});

test("a leg whose carrier IS on record cannot be given up on", async () => {
  const resolvable = await mockFuelService.recordMileage(reviewer(), leg({
    travelStartedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    travelEndedAt: new Date(Date.now() - 3_600_000).toISOString(),
  }));
  assert.equal(resolvable.attribution.carrierOrganizationId, "org_northline");

  await assert.rejects(
    () => mockFuelService.acceptMileageAttributionNotEstablishable(
      reviewer(), resolvable.id, "Cannot tell.",
    ),
    /already on record/i,
  );
});

test("an accepted finding closes the leg's item and keeps it closed", async () => {
  const created = await mockFuelService.recordMileage(reviewer(), leg());
  assert.equal((await mileageItemFor(created.id))?.status, "open");

  const reviewed = await mockFuelService.acceptMileageAttributionNotEstablishable(
    reviewer(), created.id,
    "The truck was not onboarded to anybody for that travel and there is no paperwork for it.",
  );

  assert.equal(reviewed.attributionReview?.outcome, "not_establishable");
  assert.equal(reviewed.attribution.basis, "unresolved", "the snapshot is untouched");
  assert.equal(reviewed.attribution.carrierOrganizationId, "");
  assert.equal(reviewed.odometerEndMiles, 41_200);
  assert.equal(
    meterReadings(TRUCK_IDS.nl131).some((r) => r.odometerMiles === 41_200), false,
    "accepting is not contributing",
  );

  assert.equal((await mileageItemFor(created.id))?.status, "resolved");
  assert.equal((await mileageItemFor(created.id))?.status, "resolved");
  assert.equal((await mileageItemFor(created.id))?.status, "resolved");
});

test("a finding closes the attribution question and nothing else", async () => {
  // A leg that is unattributable AND overlaps another segment. Accepting that
  // nobody can name the carrier must not take the overlap off the queue with
  // it, and must not leave the item still saying the authority is in question.
  await mockFuelService.recordMileage(reviewer(), leg());
  const overlapping = await mockFuelService.recordMileage(reviewer(), leg({
    jurisdiction: "IN",
    travelStartedAt: new Date(Date.now() - 299.8 * DAY).toISOString(),
    travelEndedAt: new Date(Date.now() - 298.5 * DAY).toISOString(),
    odometerEndMiles: 41_400,
  }));
  assert.ok(overlapping.flags.includes("overlaps_existing_segment"));
  assert.ok(overlapping.flags.includes("no_active_operating_authority"));

  const before = await mileageItemFor(overlapping.id);
  assert.equal(before?.status, "open");
  assert.match(before!.reason, /authority/i);

  await mockFuelService.acceptMileageAttributionNotEstablishable(
    reviewer(), overlapping.id, "Nothing on file for that travel.",
  );

  const after = await mileageItemFor(overlapping.id);
  assert.equal(after?.status, "open", "the overlap is still a thing to fix");
  assert.match(after!.reason, /overlaps/i);
  assert.doesNotMatch(
    after!.reason, /authority/i,
    "and it no longer asks a question somebody has answered",
  );
});

test("reviewing a leg twice writes one finding and one audit line", async () => {
  const created = await mockFuelService.recordMileage(reviewer(), leg());
  const first = await mockFuelService.acceptMileageAttributionNotEstablishable(
    reviewer(), created.id, "Nothing on file.",
  );
  const again = await mockFuelService.acceptMileageAttributionNotEstablishable(
    reviewer(), created.id, "Looked again, still nothing.",
  );
  assert.equal(again.attributionReview?.at, first.attributionReview?.at);

  const detail = await mockFuelService.getMileage(reviewer(), created.id);
  const lines = detail.audit.filter((a) => a.kind === "mileage.attribution_reviewed");
  assert.equal(lines.length, 1);
  assert.match(lines[0].summary, /odometer stays out of the Equipment Meter Ledger/i);
});

test("a leg's finding does not survive a change in the records behind it", async () => {
  const created = await mockFuelService.recordMileage(reviewer(), leg());
  const reviewed = await mockFuelService.acceptMileageAttributionNotEstablishable(
    reviewer(), created.id, "Nothing on file for that travel.",
  );
  assert.ok(mileageAttributionReviewStanding(reviewed));

  // The same category about a different record is a different fact, here as
  // much as on a purchase.
  const movedOn: JurisdictionMileageRecord = {
    ...reviewed,
    attributionReview: {
      ...reviewed.attributionReview!,
      refusalCode: "conflicting_relationships",
      refusalRecords: ["rel_somebody"],
    },
  };
  assert.equal(mileageAttributionReviewStanding(movedOn), false);
});
