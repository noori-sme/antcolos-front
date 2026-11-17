import { describe, expect, it } from "vitest";
import { toDriverLoad, toDriverLoadPage, toLoadDocument, toMilestoneBody } from "./driver-loads";

/** From ../antcolos/docs/requirements/loads-api-contract.md §12 and §13 (plans 33, 34). */
const CONTRACT_VIEW = {
  id: "6f1c2b9e-1d3a-4c55-9a51-0d1f3c2b7e10",
  status: "EN_ROUTE_PICKUP",
  statusChangedAt: "2026-11-25T13:00:00.000Z",
  brokerLoadNumber: "NS-55821",
  referenceNumbers: ["PO 55210"],
  equipmentType: "DRY_VAN",
  weightLbs: 42000,
  commodity: "Paper rolls",
  specialInstructions: "Call 1 hour before arrival.",
  requiresBrokerRelease: false,
  truckId: "ebb0c704-5d49-45d4-85dc-3cba4888acd0",
  driverAssignedAt: "2026-11-24T08:00:00.000Z",
  driverAcceptedAt: "2026-11-24T09:00:00.000Z",
  stops: [
    {
      sequence: 2, type: "DELIVERY", facilityId: null, facilityName: null, addressLine1: null,
      city: "Newark", state: "NJ", postalCode: null, timezone: "America/New_York",
      scheduledDate: null, windowStart: null, windowEnd: null, appointmentConfirmed: false,
      contactName: null, contactPhone: null, notes: null,
      actualArrivalAt: null, actualCompletedAt: null, actualDepartureAt: null,
    },
    {
      sequence: 1, type: "PICKUP", facilityId: "f1", facilityName: "Joliet DC", addressLine1: "100 Industrial Dr",
      city: "Joliet", state: "IL", postalCode: "60431", timezone: "America/Chicago",
      scheduledDate: "2026-11-25", windowStart: "2026-11-25T14:00:00.000Z", windowEnd: null,
      appointmentConfirmed: true, contactName: "Dock", contactPhone: "+13125550199", notes: "Gate 2",
      actualArrivalAt: "2026-11-25T14:20:00.000Z", actualCompletedAt: null, actualDepartureAt: null,
    },
  ],
  documents: [
    { id: "d1", type: "BOL", status: "RECEIVED", stopSequence: 1, version: 1, superseded: false, source: "mobile_web", uploadedByUserId: "u1", receivedAt: "2026-11-25T15:00:00.000Z" },
    { id: "d2", type: "INVOICE", status: "RECEIVED", stopSequence: null, version: 1, superseded: false, source: "web", uploadedByUserId: "u1", receivedAt: "2026-11-25T15:00:00.000Z" },
  ],
  exceptions: [
    { id: "x1", loadId: "6f1c2b9e-1d3a-4c55-9a51-0d1f3c2b7e10", brokerLoadNumber: "NS-55821", stopSequence: 1, type: "PICKUP_DELAY", severity: "MEDIUM", status: "OPEN", notes: "Shipper not ready.", occurredAt: "2026-11-25T14:30:00.000Z", openedAt: "2026-11-25T14:35:00.000Z", openedByUserId: "u1", source: "mobile_web", ownerUserId: null, acknowledgedAt: null, resolution: null, resolvedAt: null },
  ],
  nextMilestones: [{ milestone: "LOADED", stopSequence: 1 }, { milestone: "TELEPORT" }],
};

describe("driver-loads mappers", () => {
  it("maps the driver view from the contract example", () => {
    const load = toDriverLoad(CONTRACT_VIEW);
    expect(load).toMatchObject({
      id: CONTRACT_VIEW.id,
      status: "en_route_pickup",
      brokerLoadNumber: "NS-55821",
      weightLbs: 42000,
      requiresBrokerRelease: false,
    });
    expect(load.stops.map((s) => [s.sequence, s.type])).toEqual([[1, "pickup"], [2, "delivery"]]);
    expect(load.stops[0]).toMatchObject({ actualArrivalAt: "2026-11-25T14:20:00.000Z", contactPhone: "+13125550199" });
    expect(load).not.toHaveProperty("rateTotal");
    expect(load.exceptions).toMatchObject([{ id: "x1", type: "pickup_delay", status: "open", financialImpact: null }]);
  });

  it("keeps known documents and milestones, drops what it does not know", () => {
    const load = toDriverLoad(CONTRACT_VIEW);
    expect(load.documents).toEqual([
      { id: "d1", type: "bol", status: "received", stopSequence: 1, version: 1, superseded: false, source: "mobile_web", uploadedByUserId: "u1", receivedAt: "2026-11-25T15:00:00.000Z" },
    ]);
    expect(load.nextMilestones).toEqual([{ milestone: "loaded", stopSequence: 1 }]);
  });

  it("refuses an unknown load status", () => {
    expect(() => toDriverLoad({ ...CONTRACT_VIEW, status: "LOST" })).toThrow(/Unexpected load status/);
  });

  it("maps a page and a single document", () => {
    const page = toDriverLoadPage({ data: [CONTRACT_VIEW], meta: { page: 1, pageSize: 50, totalItems: 1, totalPages: 1 } });
    expect(page).toMatchObject({ page: 1, totalItems: 1 });
    expect(toLoadDocument({ id: "p", type: "POD", status: "RECEIVED", version: 2, superseded: false })).toMatchObject({ type: "pod", version: 2 });
  });

  it("builds the milestone body in the API's casing, from the phone", () => {
    expect(toMilestoneBody({ milestone: "arrived", stopSequence: 1 })).toEqual({ milestone: "ARRIVED", stopSequence: 1, source: "mobile_web" });
    expect(toMilestoneBody({ milestone: "start_trip" })).toEqual({ milestone: "START_TRIP", source: "mobile_web" });
  });
});
