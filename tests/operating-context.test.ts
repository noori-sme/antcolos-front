import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveOperatingContextAt,
  type CarrierRelationshipLike, type OperatingLeaseLike, type OwnershipRecordLike,
} from "@/lib/fleet/operating-context";
import { attributionFrom } from "@/lib/fuel/attribution";

/**
 * ★ THE FOUR INSTANTS TWO RULES USED TO DISAGREE ABOUT ★
 *
 * Fuel resolved the operating carrier for a moment, and so did A6's
 * operating-context rule, over the same canonical leases and relationships.
 * They differed in four ways. Each one is pinned here at the exact instant the
 * two answers diverged, with the reason the settled answer is the settled one.
 *
 * Not one of the four is reachable through the seeded fixtures — no lease is
 * reserve-only, none has ended, every approved relationship carries
 * `approvedAt` — which is precisely why they need writing down. The one
 * divergence the fixtures DO reach, rule 4, is covered here and again over the
 * real registry in `tests/factscope-isolation.test.ts`.
 */

const NOW = "2026-09-14T12:00:00.000Z";

const OWNED_BY_A_PERSON: OwnershipRecordLike[] = [{
  id: "own_person", ownerType: "person", ownerRef: "dp_owner",
  status: "active", startedAt: "2020-01-01T00:00:00.000Z",
}];

const rel = (
  carrier: string,
  over: Partial<CarrierRelationshipLike> = {},
): CarrierRelationshipLike & { organizationName: string } => ({
  id: `rel_${carrier}`,
  organizationId: carrier,
  organizationName: carrier,
  relationshipType: "leased_owner_operator",
  status: "approved",
  approvedAt: "2025-01-01T00:00:00.000Z",
  startedAt: "2025-01-01T00:00:00.000Z",
  ...over,
});

function at(
  instant: string,
  rows: {
    leases?: OperatingLeaseLike[];
    relationships?: (CarrierRelationshipLike & { organizationName: string })[];
    ownership?: OwnershipRecordLike[];
  },
) {
  return resolveOperatingContextAt({
    equipmentNoun: "truck",
    instant,
    leases: rows.leases ?? [],
    relationships: rows.relationships ?? [],
    ownership: rows.ownership ?? OWNED_BY_A_PERSON,
  });
}

/* -------------------------------------------------------------------------- */
/* 1. A lease window opens when exclusivity is TAKEN                           */
/* -------------------------------------------------------------------------- */

test("a reserved lease covers the moment between reservation and activation", () => {
  // A6 opened the window at `activatedAt`, so this instant fell through to the
  // relationship below and answered org_other. The registry's own
  // `holdingLease` counts a reservation as holding the truck, because that is
  // the moment nobody else can activate — so nobody else can be operating it.
  const leases: OperatingLeaseLike[] = [{
    id: "lease_1", organizationId: "org_holder", relationshipId: "rel_org_holder",
    status: "active",
    reservedAt: "2026-03-01T08:00:00.000Z",
    activatedAt: "2026-03-01T14:00:00.000Z",
  }];
  const relationships = [rel("org_holder"), rel("org_other")];

  const duringReservation = at("2026-03-01T10:00:00.000Z", { leases, relationships });
  assert.ok(duringReservation.resolved);
  assert.equal(duringReservation.basis, "operating_lease");
  assert.equal(duringReservation.operatingCarrierOrganizationId, "org_holder");
  assert.equal(duringReservation.lease?.id, "lease_1");

  // And a moment before the reservation is not the holder's: two approved
  // carriers, neither owning it, is genuinely unanswerable.
  const before = at("2026-03-01T07:00:00.000Z", { leases, relationships });
  assert.equal(before.resolved, false);
});

test("a lease window does not open at the moment the ROW was written", () => {
  // Fuel fell back to `createdAt`, which is when somebody saved a record — it
  // can precede the reservation, and a lease cannot give authority over a time
  // when no exclusivity existed.
  const leases: OperatingLeaseLike[] = [{
    id: "lease_2", organizationId: "org_holder", relationshipId: "rel_org_holder",
    status: "active",
    reservedAt: "2026-03-10T00:00:00.000Z",
  }];
  const early = at("2026-03-05T00:00:00.000Z", {
    leases,
    relationships: [rel("org_holder"), rel("org_other")],
  });
  assert.equal(early.resolved, false, "a lease booked in advance covers nothing yet");
});

/* -------------------------------------------------------------------------- */
/* 2. A window is half-open                                                    */
/* -------------------------------------------------------------------------- */

test("the instant a lease ends belongs to the next one, and to only one of them", () => {
  // Fuel's end bound was inclusive, so this instant was covered by BOTH leases
  // — two carriers operating one truck at one moment, which cannot be true.
  const handover = "2026-04-01T00:00:00.000Z";
  const leases: OperatingLeaseLike[] = [
    {
      id: "lease_out", organizationId: "org_a", relationshipId: "rel_org_a",
      status: "ended", reservedAt: "2026-01-01T00:00:00.000Z", endedAt: handover,
    },
    {
      id: "lease_in", organizationId: "org_b", relationshipId: "rel_org_b",
      status: "active", reservedAt: handover,
    },
  ];
  const relationships = [rel("org_a"), rel("org_b")];

  const atHandover = at(handover, { leases, relationships });
  assert.ok(atHandover.resolved, "exactly one lease covers the instant");
  assert.equal(atHandover.operatingCarrierOrganizationId, "org_b");
  assert.equal(atHandover.lease?.id, "lease_in");

  // A millisecond earlier is still the outgoing carrier's.
  const justBefore = at("2026-03-31T23:59:59.999Z", { leases, relationships });
  assert.ok(justBefore.resolved);
  assert.equal(justBefore.lease?.id, "lease_out");
});

/* -------------------------------------------------------------------------- */
/* 3. A relationship proves a period only from `approvedAt`                    */
/* -------------------------------------------------------------------------- */

test("a relationship that was asked for and never approved proves nothing", () => {
  // Fuel used `approvedAt ?? startedAt`, and filtered on today's status. A
  // relationship that went from pending straight to ended has no `approvedAt`
  // at all, so the fallback made the time it was merely REQUESTED look like
  // time it was approved for.
  const neverApproved = rel("org_asked", {
    status: "ended",
    approvedAt: undefined,
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-02-01T00:00:00.000Z",
  });
  const result = at("2026-01-15T00:00:00.000Z", { relationships: [neverApproved] });
  assert.equal(result.resolved, false);
  assert.ok(!result.resolved && result.code === "no_relationship");

  // The same relationship, approved partway through, covers only from then.
  const approvedLate = rel("org_asked", {
    approvedAt: "2026-01-20T00:00:00.000Z",
    startedAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(at("2026-01-15T00:00:00.000Z", { relationships: [approvedLate] }).resolved, false);
  assert.equal(at("2026-01-25T00:00:00.000Z", { relationships: [approvedLate] }).resolved, true);
});

/* -------------------------------------------------------------------------- */
/* 4. The owner's own relationship decides the multi-carrier case              */
/* -------------------------------------------------------------------------- */

test("a carrier's own truck is not unanswerable because somebody else is eligible", () => {
  // The one divergence the seeded fixtures reach: NL-104 and NL-107 before its
  // lease. Fuel answered `unresolved` for every truck with two approved
  // carriers, so a fuel purchase on a carrier's OWN truck went to a person to
  // sort out because a second carrier was onboarded on it.
  const rows = {
    relationships: [
      rel("org_owner", { relationshipType: "carrier_owned" as const }),
      rel("org_eligible", { approvedAt: "2026-06-01T00:00:00.000Z", startedAt: "2026-06-01T00:00:00.000Z" }),
    ],
    ownership: [{
      id: "own_org", ownerType: "organization" as const, ownerRef: "org_owner",
      status: "active" as const, startedAt: "2024-01-01T00:00:00.000Z",
    }],
  };

  const context = at("2026-07-01T00:00:00.000Z", rows);
  assert.ok(context.resolved);
  assert.equal(context.basis, "carrier_owned");
  assert.equal(context.operatingCarrierOrganizationId, "org_owner");

  // Fuel now says the same thing, in its own vocabulary.
  const attribution = attributionFrom(context, NOW);
  assert.equal(attribution.carrierOrganizationId, "org_owner");
  assert.equal(attribution.basis, "carrier_relationship");
});

/* -------------------------------------------------------------------------- */
/* One rule, two outcomes                                                      */
/* -------------------------------------------------------------------------- */

test("a refusal is still `unresolved` for fuel, never a thrown-away record", () => {
  // The whole point of keeping two outcomes. A meter reading with no carrier
  // cannot be published; a fuel purchase that happened is recorded, flagged,
  // and put in front of a person.
  const refused = at("2026-02-14T09:00:00.000Z", {
    relationships: [rel("org_a"), rel("org_b")],
  });
  assert.equal(refused.resolved, false);

  const attribution = attributionFrom(refused, NOW);
  assert.equal(attribution.basis, "unresolved");
  assert.equal(attribution.carrierOrganizationId, "");
  assert.equal(attribution.carrierNameSnapshot, "Not established");
});
