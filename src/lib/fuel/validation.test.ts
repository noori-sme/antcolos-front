import { describe, expect, it } from "vitest";
import { fuelTx, mileage } from "@/test/fuel-factories";
import { validateMileage, validateTransaction } from "./validation";

describe("fuel purchase checks", () => {
  it("flags a purchase with no receipt", () => {
    const flags = validateTransaction({
      transaction: fuelTx({ receiptDocumentId: undefined }),
      truckHistory: [],
    });
    expect(flags).toContain("missing_receipt");
  });

  it("does not flag a purchase that has one", () => {
    const flags = validateTransaction({
      transaction: fuelTx({ receiptDocumentId: "doc_1" }),
      truckHistory: [],
    });
    expect(flags).toEqual([]);
  });

  it("flags an odometer that went backwards against the same truck's history", () => {
    const flags = validateTransaction({
      transaction: fuelTx({ receiptDocumentId: "d", purchasedAt: "2026-05-20T00:00:00.000Z", odometerMiles: 90_000 }),
      truckHistory: [fuelTx({ purchasedAt: "2026-05-14T00:00:00.000Z", odometerMiles: 100_000 })],
    });
    expect(flags).toContain("odometer_regression");
  });

  it("does not flag an odometer that simply went up", () => {
    const flags = validateTransaction({
      transaction: fuelTx({ receiptDocumentId: "d", purchasedAt: "2026-05-20T00:00:00.000Z", odometerMiles: 101_000 }),
      truckHistory: [fuelTx({ purchasedAt: "2026-05-14T00:00:00.000Z", odometerMiles: 100_000 })],
    });
    expect(flags).not.toContain("odometer_regression");
  });

  it("flags gallons no tank could hold, and a rounding-artefact fill", () => {
    expect(
      validateTransaction({ transaction: fuelTx({ receiptDocumentId: "d", gallonsThousandths: 400_000 }), truckHistory: [] }),
    ).toContain("implausible_gallons");
    expect(
      validateTransaction({ transaction: fuelTx({ receiptDocumentId: "d", gallonsThousandths: 400 }), truckHistory: [] }),
    ).toContain("implausible_gallons");
  });

  it("flags a price far outside the fleet's own band, and leaves a normal one alone", () => {
    const far = validateTransaction({
      transaction: fuelTx({ receiptDocumentId: "d", cost: { currency: "USD", pricePerGallonMills: 7_200, totalCostCents: 1 } }),
      truckHistory: [],
      referencePriceMills: 3_900,
    });
    expect(far).toContain("price_out_of_band");

    const near = validateTransaction({
      transaction: fuelTx({ receiptDocumentId: "d", cost: { currency: "USD", pricePerGallonMills: 4_200, totalCostCents: 1 } }),
      truckHistory: [],
      referencePriceMills: 3_900,
    });
    expect(near).not.toContain("price_out_of_band");
  });

  it("skips the price check entirely when the caller could not be shown a price", () => {
    const flags = validateTransaction({
      transaction: fuelTx({ receiptDocumentId: "d", cost: undefined }),
      truckHistory: [],
      referencePriceMills: 3_900,
    });
    expect(flags).not.toContain("price_out_of_band");
  });

  it("flags fuel bought where the truck recorded no miles", () => {
    const flags = validateTransaction({
      transaction: fuelTx({ receiptDocumentId: "d" }),
      truckHistory: [],
      jurisdictionsTravelled: ["IN", "OH"],
    });
    expect(flags).toContain("jurisdiction_outside_travel");
  });

  it("flags a purchase nothing could attribute", () => {
    const flags = validateTransaction({
      transaction: fuelTx({
        receiptDocumentId: "d",
        attribution: { carrierOrganizationId: "", carrierNameSnapshot: "", basis: "unresolved", resolvedAt: "x" },
      }),
      truckHistory: [],
    });
    expect(flags).toContain("no_active_operating_authority");
  });
});

describe("mileage checks", () => {
  it("flags more taxable miles than total, which cannot be true", () => {
    const flags = validateMileage({
      record: mileage({ totalMiles: 100, taxableMiles: 138 }),
      truckRecords: [],
    });
    expect(flags).toContain("taxable_exceeds_total");
  });

  it("flags negative miles", () => {
    expect(validateMileage({ record: mileage({ totalMiles: -5 }), truckRecords: [] })).toContain("negative_miles");
  });

  it("flags an odometer span that does not match the miles, with a few miles of slack", () => {
    expect(
      validateMileage({
        record: mileage({ totalMiles: 300, odometerStartMiles: 100_000, odometerEndMiles: 100_302 }),
        truckRecords: [],
      }),
    ).not.toContain("odometer_gap");
    expect(
      validateMileage({
        record: mileage({ totalMiles: 300, odometerStartMiles: 100_000, odometerEndMiles: 100_412 }),
        truckRecords: [],
      }),
    ).toContain("odometer_gap");
  });

  it("flags an unknown jurisdiction and a segment longer than any jurisdiction", () => {
    expect(validateMileage({ record: mileage({ jurisdiction: "ZZ" }), truckRecords: [] })).toContain("unknown_jurisdiction");
    expect(validateMileage({ record: mileage({ totalMiles: 2_000, taxableMiles: 2_000 }), truckRecords: [] })).toContain("segment_too_long");
  });

  it("flags two segments for one truck that overlap in time", () => {
    const first = mileage({
      id: "a", travelStartedAt: "2026-05-14T08:00:00.000Z", travelEndedAt: "2026-05-14T14:00:00.000Z",
    });
    const second = mileage({
      id: "b", travelStartedAt: "2026-05-14T12:00:00.000Z", travelEndedAt: "2026-05-14T18:00:00.000Z",
    });
    expect(validateMileage({ record: second, truckRecords: [first, second] })).toContain("overlaps_existing_segment");
  });

  it("does not treat a superseded segment as an overlap", () => {
    const superseded = mileage({
      id: "a",
      travelStartedAt: "2026-05-14T08:00:00.000Z",
      travelEndedAt: "2026-05-14T14:00:00.000Z",
      state: "corrected",
      revision: { number: 1, originalId: "a", isCurrent: false },
    });
    const current = mileage({
      id: "b", travelStartedAt: "2026-05-14T12:00:00.000Z", travelEndedAt: "2026-05-14T18:00:00.000Z",
    });
    expect(validateMileage({ record: current, truckRecords: [superseded, current] })).not.toContain(
      "overlaps_existing_segment",
    );
  });

  it("flags travel that runs across a quarter boundary rather than splitting it", () => {
    const flags = validateMileage({
      record: mileage({
        travelStartedAt: "2026-06-30T20:00:00.000Z",
        travelEndedAt: "2026-07-01T04:00:00.000Z",
      }),
      truckRecords: [],
    });
    expect(flags).toContain("crosses_period_boundary");
  });
});
