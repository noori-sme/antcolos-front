import { describe, expect, it } from "vitest";
import { toAvailabilityPredictionPage, toTruckAvailabilityPage } from "./trucks";

/** Copied from ../antcolos/docs/requirements/fleet-api-contract.md "Truck availability". */
const CONTRACT_ROW = {
  truckId: "a0b1c2d3-…",
  unitNumber: "104",
  equipmentType: "DRY_VAN",
  operationalStatus: "LOADED_IN_TRANSIT",
  bucket: "WITHIN_5H",
  estimatedEmptyAt: "2026-11-17T22:00:00.000Z",
  emptyCity: "Dallas",
  emptyState: "TX",
  activeLoadId: "c1d2e3f4-…",
};

const META = { page: 1, pageSize: 50, totalItems: 1, totalPages: 1 };

describe("toTruckAvailabilityPage", () => {
  it("maps the contract row", () => {
    const page = toTruckAvailabilityPage({ data: [CONTRACT_ROW], meta: META });
    expect(page.meta).toEqual(META);
    expect(page.data).toEqual([
      {
        truckId: "a0b1c2d3-…",
        unitNumber: "104",
        equipmentType: "DRY_VAN",
        operationalStatus: "LOADED_IN_TRANSIT",
        bucket: "WITHIN_5H",
        estimatedEmptyAt: "2026-11-17T22:00:00.000Z",
        emptyCity: "Dallas",
        emptyState: "TX",
        activeLoadId: "c1d2e3f4-…",
      },
    ]);
  });

  it("keeps nulls for an empty truck", () => {
    const [row] = toTruckAvailabilityPage({
      data: [
        {
          ...CONTRACT_ROW,
          operationalStatus: "AVAILABLE",
          bucket: "AVAILABLE_NOW",
          estimatedEmptyAt: null,
          emptyCity: null,
          emptyState: null,
          activeLoadId: null,
        },
      ],
      meta: META,
    }).data;
    expect(row.bucket).toBe("AVAILABLE_NOW");
    expect(row.estimatedEmptyAt).toBeNull();
    expect(row.emptyCity).toBeNull();
    expect(row.activeLoadId).toBeNull();
  });

  it("reads a bucket it does not know as UNKNOWN, and drops rows without a truck id", () => {
    const page = toTruckAvailabilityPage({
      data: [{ ...CONTRACT_ROW, bucket: "NEXT_WEEK" }, { ...CONTRACT_ROW, truckId: undefined }],
      meta: META,
    });
    expect(page.data).toHaveLength(1);
    expect(page.data[0].bucket).toBe("UNKNOWN");
  });
});

describe("toAvailabilityPredictionPage", () => {
  it("maps a delivered and an open prediction", () => {
    const page = toAvailabilityPredictionPage({
      data: [
        {
          loadId: "l1",
          predictedEmptyAt: "2026-11-17T22:00:00.000Z",
          recordedAt: "2026-11-17T15:00:00.000Z",
          actualEmptyAt: "2026-11-17T22:42:00.000Z",
          errorMinutes: 42,
        },
        {
          loadId: "l2",
          predictedEmptyAt: "2026-11-18T18:00:00.000Z",
          recordedAt: "2026-11-18T09:00:00.000Z",
          actualEmptyAt: null,
          errorMinutes: null,
        },
      ],
      meta: { ...META, totalItems: 2 },
    });
    expect(page.data[0]).toEqual({
      loadId: "l1",
      predictedEmptyAt: "2026-11-17T22:00:00.000Z",
      recordedAt: "2026-11-17T15:00:00.000Z",
      actualEmptyAt: "2026-11-17T22:42:00.000Z",
      errorMinutes: 42,
    });
    expect(page.data[1].actualEmptyAt).toBeNull();
    expect(page.data[1].errorMinutes).toBeNull();
  });
});
