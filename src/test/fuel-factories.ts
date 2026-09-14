import type {
  ActorRef, CarrierAttribution, FuelTransaction, JurisdictionMileageRecord,
} from "@/types";

/**
 * Minimal, explicit fixtures for the pure domain tests.
 *
 * Deliberately not the seeded ledger: a test that asserts "corrected rows do
 * not count" should say which rows are corrected, in three lines, rather than
 * depend on what a generator happened to produce.
 */

export const TEST_ACTOR: ActorRef = {
  userId: "usr_test",
  membershipId: "mem_test",
  displayNameSnapshot: "Test",
  source: "web",
};

export const TEST_ATTRIBUTION: CarrierAttribution = {
  carrierOrganizationId: "org_a",
  carrierNameSnapshot: "Carrier A",
  basis: "operating_lease",
  resolvedAt: "2026-01-01T00:00:00.000Z",
};

let n = 0;
const id = (prefix: string) => `${prefix}_test_${(n += 1)}`;

export function fuelTx(overrides: Partial<FuelTransaction> = {}): FuelTransaction {
  const own = overrides.id ?? id("fuel");
  return {
    id: own,
    organizationId: "org_a",
    truckId: "truck_1",
    truckUnitSnapshot: "101",
    driverProfileId: "dp_1",
    driverNameSnapshot: "Driver One",
    attribution: TEST_ATTRIBUTION,
    purchasedAt: "2026-05-14T12:00:00.000Z",
    location: {
      jurisdiction: "IL",
      address: { city: "Effingham", state: "IL", country: "US" },
      merchantName: "Flying J Effingham",
    },
    odometerMiles: 100_000,
    fuelType: "diesel",
    gallonsThousandths: 100_000,
    cost: { currency: "USD", pricePerGallonMills: 3_899, totalCostCents: 38_990 },
    qualifiesForIfta: true,
    source: "manual",
    state: "verified",
    flags: [],
    revision: { number: 1, originalId: own, isCurrent: true },
    createdAt: "2026-05-14T12:00:00.000Z",
    createdBy: TEST_ACTOR,
    ...overrides,
    // Keep the chain self-consistent even when a caller overrides `id`.
    ...(overrides.revision ? { revision: overrides.revision } : {}),
  };
}

export function mileage(
  overrides: Partial<JurisdictionMileageRecord> = {},
): JurisdictionMileageRecord {
  const own = overrides.id ?? id("mil");
  return {
    id: own,
    organizationId: "org_a",
    truckId: "truck_1",
    truckUnitSnapshot: "101",
    driverProfileId: "dp_1",
    attribution: TEST_ATTRIBUTION,
    jurisdiction: "IL",
    travelStartedAt: "2026-05-14T08:00:00.000Z",
    travelEndedAt: "2026-05-14T12:00:00.000Z",
    totalMiles: 300,
    taxableMiles: 300,
    source: "manual",
    state: "verified",
    flags: [],
    revision: { number: 1, originalId: own, isCurrent: true },
    createdAt: "2026-05-14T12:00:00.000Z",
    createdBy: TEST_ACTOR,
    ...overrides,
  };
}
