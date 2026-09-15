import { describe, expect, it } from "vitest";
import { carryForwardAttribution, declareAttribution, resolveAttribution, type AuthorityWindow } from "./attribution";

const NOW = "2026-09-14T12:00:00.000Z";

const lease = (
  carrier: string,
  startedAt: string,
  endedAt?: string,
): AuthorityWindow => ({
  carrierOrganizationId: carrier,
  carrierNameSnapshot: carrier,
  kind: "operating_lease",
  startedAt,
  endedAt,
  operatingLeaseId: `lease_${carrier}_${startedAt}`,
});

const relationship = (
  carrier: string,
  startedAt: string,
  endedAt?: string,
): AuthorityWindow => ({
  carrierOrganizationId: carrier,
  carrierNameSnapshot: carrier,
  kind: "carrier_relationship",
  startedAt,
  endedAt,
  relationshipId: `rel_${carrier}`,
});

describe("carrier attribution", () => {
  it("attributes to the carrier whose lease covered the moment, not the latest one", () => {
    const windows = [
      lease("org_a", "2026-01-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z"),
      lease("org_b", "2026-04-02T00:00:00.000Z"),
    ];
    const result = resolveAttribution(windows, "2026-02-14T09:00:00.000Z", NOW);
    expect(result.carrierOrganizationId).toBe("org_a");
    expect(result.basis).toBe("operating_lease");
    expect(result.operatingLeaseId).toBe("lease_org_a_2026-01-01T00:00:00.000Z");
  });

  it("prefers a lease over a bare approved relationship covering the same moment", () => {
    const windows = [
      relationship("org_owner", "2025-01-01T00:00:00.000Z"),
      lease("org_operator", "2026-02-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z"),
    ];
    const result = resolveAttribution(windows, "2026-02-14T09:00:00.000Z", NOW);
    expect(result.carrierOrganizationId).toBe("org_operator");
    expect(result.basis).toBe("operating_lease");
  });

  it("falls back to a single approved relationship when no lease covers it", () => {
    const windows = [relationship("org_only", "2025-01-01T00:00:00.000Z")];
    const result = resolveAttribution(windows, "2026-02-14T09:00:00.000Z", NOW);
    expect(result.carrierOrganizationId).toBe("org_only");
    expect(result.basis).toBe("carrier_relationship");
  });

  it("refuses to guess when two carriers are approved on the same truck at once", () => {
    const windows = [
      relationship("org_a", "2025-01-01T00:00:00.000Z"),
      relationship("org_b", "2025-06-01T00:00:00.000Z"),
    ];
    const result = resolveAttribution(windows, "2026-02-14T09:00:00.000Z", NOW);
    expect(result.basis).toBe("unresolved");
    expect(result.carrierOrganizationId).toBe("");
  });

  it("is unresolved before any authority existed", () => {
    const windows = [lease("org_a", "2026-05-01T00:00:00.000Z")];
    expect(resolveAttribution(windows, "2026-01-01T00:00:00.000Z", NOW).basis).toBe("unresolved");
  });

  it("is unresolved after every authority has ended", () => {
    const windows = [lease("org_a", "2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z")];
    expect(resolveAttribution(windows, "2026-06-01T00:00:00.000Z", NOW).basis).toBe("unresolved");
  });

  it("does not change a past answer when a new carrier takes the truck on later", () => {
    const past = "2026-02-14T09:00:00.000Z";
    const before = resolveAttribution(
      [lease("org_a", "2026-01-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z")],
      past,
      NOW,
    );
    // The truck is sold and leased to somebody else. The history it already had
    // is untouched, so the same instant still resolves to the same carrier.
    const after = resolveAttribution(
      [
        lease("org_a", "2026-01-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z"),
        lease("org_b", "2026-04-02T00:00:00.000Z"),
        relationship("org_c", "2026-05-01T00:00:00.000Z"),
      ],
      past,
      NOW,
    );
    expect(after.carrierOrganizationId).toBe(before.carrierOrganizationId);
    expect(after.basis).toBe(before.basis);
  });

  it("marks a human answer as a declaration, so an audit can tell them apart", () => {
    const declared = declareAttribution("org_a", "Carrier A", NOW);
    expect(declared.basis).toBe("manual_declaration");
    expect(declared.carrierOrganizationId).toBe("org_a");
  });

  it("carries a snapshot forward unchanged for a correction", () => {
    const original = resolveAttribution([lease("org_a", "2026-01-01T00:00:00.000Z")], "2026-02-01T00:00:00.000Z", NOW);
    expect(carryForwardAttribution(original)).toEqual(original);
  });
});
