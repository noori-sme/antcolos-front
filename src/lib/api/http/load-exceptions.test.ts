import { describe, expect, it } from "vitest";
import { toLoadException, toLoadExceptions, toReportBody, toResolveBody } from "./load-exceptions";

/** From ../antcolos/docs/requirements/loads-api-contract.md §14 (plan 36). */
const CONTRACT_EXCEPTION = {
  id: "f3c1a2b4-0000-4000-8000-000000000001",
  loadId: "6f1c2b9e-1d3a-4c55-9a51-0d1f3c2b7e10",
  brokerLoadNumber: "NS-55821",
  stopSequence: 1,
  type: "PICKUP_DELAY",
  severity: "MEDIUM",
  status: "OPEN",
  notes: "Shipper not ready until 4 pm.",
  occurredAt: "2026-11-25T14:30:00.000Z",
  openedAt: "2026-11-25T14:35:00.000Z",
  openedByUserId: "b2a7",
  source: "mobile_web",
  ownerUserId: null,
  acknowledgedAt: null,
  resolution: null,
  resolvedAt: null,
  resolvedByUserId: null,
  financialImpact: null,
};

describe("load-exceptions mappers", () => {
  it("maps the contract example", () => {
    expect(toLoadException(CONTRACT_EXCEPTION)).toEqual({
      id: CONTRACT_EXCEPTION.id,
      loadId: CONTRACT_EXCEPTION.loadId,
      brokerLoadNumber: "NS-55821",
      stopSequence: 1,
      type: "pickup_delay",
      severity: "medium",
      status: "open",
      notes: "Shipper not ready until 4 pm.",
      occurredAt: "2026-11-25T14:30:00.000Z",
      openedAt: "2026-11-25T14:35:00.000Z",
      openedByUserId: "b2a7",
      source: "mobile_web",
      ownerUserId: null,
      acknowledgedAt: null,
      resolution: null,
      resolvedAt: null,
      financialImpact: null,
    });
  });

  it("maps a resolved one with its cost", () => {
    expect(
      toLoadException({
        ...CONTRACT_EXCEPTION,
        status: "RESOLVED",
        resolution: "Broker approved detention.",
        resolvedAt: "2026-11-25T18:00:00.000Z",
        financialImpact: "150.00",
      }),
    ).toMatchObject({ status: "resolved", resolution: "Broker approved detention.", financialImpact: "150.00" });
  });

  it("keeps a problem with values it does not know yet, visibly", () => {
    expect(
      toLoadException({ ...CONTRACT_EXCEPTION, type: "ALIENS", severity: "EXTREME", status: "ESCALATED" }),
    ).toMatchObject({ type: "other", severity: "high", status: "open" });
    expect(toLoadException({ ...CONTRACT_EXCEPTION, id: undefined })).toBeNull();
    expect(toLoadExceptions([CONTRACT_EXCEPTION, "junk"])).toHaveLength(1);
  });

  it("builds the report and resolve bodies", () => {
    expect(
      toReportBody({ type: "truck_breakdown", severity: "high", notes: "  Flat tire  ", stopSequence: 2, source: "mobile_web" }),
    ).toEqual({ type: "TRUCK_BREAKDOWN", severity: "HIGH", notes: "Flat tire", stopSequence: 2, source: "mobile_web" });
    expect(toReportBody({ type: "other", severity: "low", notes: "x", source: "web" })).toEqual({
      type: "OTHER", severity: "LOW", notes: "x", source: "web",
    });
    expect(toResolveBody({ resolution: " Done ", financialImpact: " 150.00 " })).toEqual({
      resolution: "Done", financialImpact: "150.00",
    });
    expect(toResolveBody({ resolution: "Done", financialImpact: "" })).toEqual({ resolution: "Done" });
  });
});
