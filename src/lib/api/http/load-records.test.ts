import { describe, expect, it } from "vitest";
import {
  toCancelBody, toDriverAnswer, toLoadListParams, toLoadRecord, toLoadRecordPage, toLoadTimelinePage,
} from "./load-records";

/** From ../antcolos/docs/requirements/loads-api-contract.md "Load (response)" (plan 29). */
const CONTRACT_LOAD = {
  id: "6f1c2b9e-1d3a-4c55-9a51-0d1f3c2b7e10",
  status: "EN_ROUTE_PICKUP",
  statusChangedAt: "2026-11-15T14:05:00.000Z",
  allowedTransitions: ["ARRIVED_PICKUP", "CANCELLED"],
  requiresBrokerRelease: false,
  source: "RATE_CONFIRMATION",
  sourceBoard: null,
  externalPostingId: null,
  carrierOrganizationId: null,
  brokerId: "a1b2c3d4-0000-4000-8000-000000000001",
  brokerName: "Northstar Freight Brokerage LLC",
  brokerMcNumber: "812345",
  brokerContactName: null,
  brokerPhone: "312-555-0142",
  brokerEmail: "dispatch@northstar-freight.example",
  brokerLoadNumber: "OCR-133703",
  firstPickupDate: "2026-11-25",
  equipmentType: "DRY_VAN",
  weightLbs: 42000,
  commodity: "Paper rolls",
  totalMiles: null,
  rateTotal: "2750.00",
  referenceNumbers: ["PO 55210"],
  specialInstructions: "Call 1 hour before arrival.",
  notes: null,
  stops: [
    {
      sequence: 1,
      type: "PICKUP",
      facilityId: "f1",
      facilityName: "Joliet Distribution Center",
      addressLine1: "100 Industrial Drive",
      city: "Joliet",
      state: "IL",
      postalCode: "60431",
      timezone: "America/Chicago",
      scheduledDate: "2026-11-25",
      windowStart: "2026-11-25T14:00:00.000Z",
      windowEnd: "2026-11-25T16:00:00.000Z",
      appointmentConfirmed: false,
      contactName: null,
      contactPhone: null,
      notes: null,
    },
    {
      sequence: 2,
      type: "DELIVERY",
      facilityId: null,
      facilityName: null,
      addressLine1: null,
      city: "Newark",
      state: "NJ",
      postalCode: null,
      timezone: "America/New_York",
      scheduledDate: null,
      windowStart: null,
      windowEnd: null,
      appointmentConfirmed: false,
      contactName: null,
      contactPhone: null,
      notes: null,
    },
  ],
  cancelledAt: null,
  cancelReason: null,
  cancelledByParty: null,
  tonuAmount: null,
  createdByUserId: "b2a7",
  updatedByUserId: "b2a7",
  createdAt: "2026-11-15T13:37:57.000Z",
  updatedAt: "2026-11-15T14:05:00.000Z",
};

describe("load-records mappers", () => {
  it("maps a load from the contract example", () => {
    const load = toLoadRecord(CONTRACT_LOAD);
    expect(load).toMatchObject({
      id: CONTRACT_LOAD.id,
      status: "en_route_pickup",
      allowedTransitions: ["arrived_pickup", "cancelled"],
      source: "rate_confirmation",
      brokerLoadNumber: "OCR-133703",
      firstPickupDate: "2026-11-25",
      equipmentType: "DRY_VAN",
      weightLbs: 42000,
      rateTotal: "2750.00",
      referenceNumbers: ["PO 55210"],
      cancelledByParty: null,
    });
    expect(load.stops.map((s) => [s.sequence, s.type, s.city])).toEqual([
      [1, "pickup", "Joliet"],
      [2, "delivery", "Newark"],
    ]);
    expect(load.stops[0]).toMatchObject({
      timezone: "America/Chicago",
      windowStart: "2026-11-25T14:00:00.000Z",
    });
  });

  it("maps a cancelled load's party and TONU", () => {
    const load = toLoadRecord({
      ...CONTRACT_LOAD,
      status: "CANCELLED",
      allowedTransitions: [],
      cancelledAt: "2026-11-15T15:00:00.000Z",
      cancelReason: "Shipper closed",
      cancelledByParty: "SHIPPER",
      tonuAmount: "150.00",
    });
    expect(load).toMatchObject({
      status: "cancelled",
      cancelledByParty: "shipper",
      tonuAmount: "150.00",
      cancelReason: "Shipper closed",
    });
  });

  it("refuses a status it does not know rather than guess", () => {
    expect(() => toLoadRecord({ ...CONTRACT_LOAD, status: "TELEPORTED" })).toThrow(
      /Unexpected load status/,
    );
  });

  it("drops an unknown allowed transition instead of offering it", () => {
    const load = toLoadRecord({
      ...CONTRACT_LOAD,
      allowedTransitions: ["ARRIVED_PICKUP", "SOMETHING_NEW"],
    });
    expect(load.allowedTransitions).toEqual(["arrived_pickup"]);
  });

  it("maps a list page with its meta", () => {
    const page = toLoadRecordPage({
      data: [CONTRACT_LOAD],
      meta: { page: 2, pageSize: 25, totalItems: 26, totalPages: 2 },
    });
    expect(page).toMatchObject({ page: 2, pageSize: 25, totalItems: 26, totalPages: 2 });
    expect(page.items).toHaveLength(1);
  });

  it("maps the timeline example (contract §8)", () => {
    const page = toLoadTimelinePage({
      data: [
        {
          id: "0b7f",
          type: "load.status_changed",
          occurredAt: "2026-11-15T14:05:00.000Z",
          source: "api",
          actor: { id: "b2a7", name: "Dana Dispatcher" },
          details: { from: "EN_ROUTE_PICKUP", to: "ARRIVED_PICKUP" },
        },
        {
          id: "0b80",
          type: "load.cancelled",
          occurredAt: "2026-11-15T15:00:00.000Z",
          source: "api",
          actor: null,
          details: {
            from: "ARRIVED_PICKUP",
            to: "CANCELLED",
            reason: "Shipper closed",
            party: "SHIPPER",
            tonuAmount: "150.00",
          },
        },
        {
          id: "0b81",
          type: "load.updated",
          occurredAt: "2026-11-15T15:01:00.000Z",
          source: "api",
          actor: { id: "gone", name: null },
          details: { changedFields: ["notes", "weightLbs"] },
        },
      ],
      meta: { page: 1, pageSize: 50, totalItems: 3, totalPages: 1 },
    });
    expect(page.items[0]).toMatchObject({
      type: "load.status_changed",
      actor: { id: "b2a7", name: "Dana Dispatcher" },
      from: "en_route_pickup",
      to: "arrived_pickup",
      reason: null,
    });
    expect(page.items[1]).toMatchObject({
      actor: null,
      to: "cancelled",
      party: "shipper",
      tonuAmount: "150.00",
      reason: "Shipper closed",
    });
    expect(page.items[2]).toMatchObject({
      actor: { id: "gone", name: null },
      changedFields: ["notes", "weightLbs"],
      from: null,
    });
    expect(page).toMatchObject({ page: 1, totalPages: 1, totalItems: 3 });
  });

  it("builds list params and the cancel body in the API's casing", () => {
    expect(
      toLoadListParams({
        page: 1,
        pageSize: 25,
        status: "in_transit",
        search: " OCR-1 ",
        sortBy: "firstPickupDate",
        sortDir: "asc",
      }),
    ).toEqual({
      page: 1,
      pageSize: 25,
      status: "IN_TRANSIT",
      q: "OCR-1",
      sortBy: "firstPickupDate",
      sortOrder: "asc",
    });
    expect(toCancelBody({ reason: " Broker ", party: "broker", tonuAmount: "150" })).toEqual({
      reason: "Broker",
      party: "BROKER",
      tonuAmount: "150",
    });
    expect(toCancelBody({ reason: "x" })).toEqual({ reason: "x" });
  });

  it("maps the truck and driver on a load (plans 31, 32)", () => {
    const load = toLoadRecord({
      ...CONTRACT_LOAD,
      status: "DRIVER_ACCEPTED",
      truckId: "truck-1",
      driverUserId: "driver-1",
      driverAssignedAt: "2026-11-16T08:00:00.000Z",
      driverAcceptedAt: "2026-11-16T09:00:00.000Z",
    });
    expect(load).toMatchObject({
      status: "driver_accepted",
      truckId: "truck-1",
      driverUserId: "driver-1",
      driverAcceptedAt: "2026-11-16T09:00:00.000Z",
    });
    expect(toLoadRecord(CONTRACT_LOAD)).toMatchObject({ truckId: null, driverUserId: null });
  });

  it("maps a driver's answer, which carries no rate (contract §10)", () => {
    expect(
      toDriverAnswer({
        id: "load-1",
        status: "DRIVER_ACCEPTED",
        driverUserId: "driver-1",
        driverAcceptedAt: "2026-11-16T09:00:00.000Z",
      }),
    ).toEqual({
      id: "load-1",
      status: "driver_accepted",
      driverUserId: "driver-1",
      driverAcceptedAt: "2026-11-16T09:00:00.000Z",
    });
  });

  it("keeps the truck and driver ids of a timeline event", () => {
    const page = toLoadTimelinePage({
      data: [
        { id: "e", type: "load.truck_assigned", occurredAt: "2026-11-16T08:00:00.000Z", source: "api", actor: null, details: { truckId: "truck-1" } },
        { id: "f", type: "load.driver_rejected", occurredAt: "2026-11-16T08:05:00.000Z", source: "api", actor: null, details: { driverUserId: "driver-1", reason: "Truck in the shop", from: "DRIVER_ASSIGNED", to: "BOOKED" } },
      ],
      meta: { page: 1, pageSize: 50, totalItems: 2, totalPages: 1 },
    });
    expect(page.items[0]).toMatchObject({ truckId: "truck-1" });
    expect(page.items[1]).toMatchObject({ driverUserId: "driver-1", reason: "Truck in the shop", to: "booked" });
  });
});
