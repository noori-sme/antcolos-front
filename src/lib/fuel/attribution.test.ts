import { describe, expect, it } from "vitest";
import {
  resolveOperatingContextAt,
  type CarrierRelationshipLike, type OperatingLeaseLike, type OwnershipRecordLike,
} from "@/lib/fleet/operating-context";
import { attributionFrom, carryForwardAttribution, declareAttribution } from "./attribution";

/**
 * Fuel attribution, now that there is one rule.
 *
 * These were tests of a second point-in-time resolver that lived in this
 * module. The properties they asserted are the same; what changed is that they
 * are asserted against the canonical leases and relationships every module
 * reads, rather than against a shape only fuel built. The four interval rules
 * the two implementations disagreed about are pinned in
 * `tests/operating-context.test.ts`.
 */

const NOW = "2026-09-14T12:00:00.000Z";

const lease = (
  carrier: string,
  reservedAt: string,
  endedAt?: string,
): OperatingLeaseLike => ({
  id: `lease_${carrier}_${reservedAt}`,
  organizationId: carrier,
  relationshipId: `rel_${carrier}`,
  status: endedAt ? "ended" : "active",
  reservedAt,
  activatedAt: reservedAt,
  endedAt,
});

const relationship = (
  carrier: string,
  startedAt: string,
  endedAt?: string,
): CarrierRelationshipLike & { organizationName: string } => ({
  id: `rel_${carrier}`,
  organizationId: carrier,
  organizationName: carrier,
  relationshipType: "leased_owner_operator",
  status: endedAt ? "ended" : "approved",
  approvedAt: startedAt,
  startedAt,
  endedAt,
});

/** A person owns it, so the carrier-owned step never applies in these cases. */
const PERSON_OWNED: OwnershipRecordLike[] = [{
  id: "own_person",
  ownerType: "person",
  ownerRef: "dp_owner",
  status: "active",
  startedAt: "2020-01-01T00:00:00.000Z",
}];

function attributionAt(
  at: string,
  rows: {
    leases?: OperatingLeaseLike[];
    relationships?: (CarrierRelationshipLike & { organizationName: string })[];
    ownership?: OwnershipRecordLike[];
  },
) {
  return attributionFrom(
    resolveOperatingContextAt({
      equipmentNoun: "truck",
      instant: at,
      leases: rows.leases ?? [],
      relationships: rows.relationships ?? [],
      ownership: rows.ownership ?? PERSON_OWNED,
    }),
    NOW,
  );
}

describe("carrier attribution", () => {
  it("attributes to the carrier whose lease covered the moment, not the latest one", () => {
    const result = attributionAt("2026-02-14T09:00:00.000Z", {
      leases: [
        lease("org_a", "2026-01-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z"),
        lease("org_b", "2026-04-02T00:00:00.000Z"),
      ],
      relationships: [
        relationship("org_a", "2025-01-01T00:00:00.000Z"),
        relationship("org_b", "2025-01-01T00:00:00.000Z"),
      ],
    });
    expect(result.carrierOrganizationId).toBe("org_a");
    expect(result.basis).toBe("operating_lease");
    expect(result.operatingLeaseId).toBe("lease_org_a_2026-01-01T00:00:00.000Z");
  });

  it("prefers a lease over a bare approved relationship covering the same moment", () => {
    const result = attributionAt("2026-02-14T09:00:00.000Z", {
      leases: [lease("org_operator", "2026-02-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z")],
      relationships: [
        relationship("org_owner", "2025-01-01T00:00:00.000Z"),
        relationship("org_operator", "2025-06-01T00:00:00.000Z"),
      ],
    });
    expect(result.carrierOrganizationId).toBe("org_operator");
    expect(result.basis).toBe("operating_lease");
  });

  it("falls back to a single approved relationship when no lease covers it", () => {
    const result = attributionAt("2026-02-14T09:00:00.000Z", {
      relationships: [relationship("org_only", "2025-01-01T00:00:00.000Z")],
    });
    expect(result.carrierOrganizationId).toBe("org_only");
    expect(result.basis).toBe("carrier_relationship");
  });

  it("refuses to guess when two carriers are approved and neither owns it", () => {
    const result = attributionAt("2026-02-14T09:00:00.000Z", {
      relationships: [
        relationship("org_a", "2025-01-01T00:00:00.000Z"),
        relationship("org_b", "2025-06-01T00:00:00.000Z"),
      ],
    });
    expect(result.basis).toBe("unresolved");
    expect(result.carrierOrganizationId).toBe("");
  });

  it("resolves the same two carriers when one of them is the recorded owner", () => {
    // The step fuel did not have. A carrier's own truck that a second carrier
    // is merely eligible to run is not an unanswerable question.
    const result = attributionAt("2026-02-14T09:00:00.000Z", {
      relationships: [
        { ...relationship("org_owner", "2025-01-01T00:00:00.000Z"), relationshipType: "carrier_owned" },
        relationship("org_other", "2025-06-01T00:00:00.000Z"),
      ],
      ownership: [{
        id: "own_org", ownerType: "organization", ownerRef: "org_owner",
        status: "active", startedAt: "2024-01-01T00:00:00.000Z",
      }],
    });
    expect(result.carrierOrganizationId).toBe("org_owner");
    expect(result.basis).toBe("carrier_relationship");
  });

  it("is unresolved before any authority existed", () => {
    const result = attributionAt("2026-01-01T00:00:00.000Z", {
      leases: [lease("org_a", "2026-05-01T00:00:00.000Z")],
      relationships: [relationship("org_a", "2026-05-01T00:00:00.000Z")],
    });
    expect(result.basis).toBe("unresolved");
  });

  it("is unresolved after every authority has ended", () => {
    const result = attributionAt("2026-06-01T00:00:00.000Z", {
      leases: [lease("org_a", "2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z")],
      relationships: [
        relationship("org_a", "2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z"),
      ],
    });
    expect(result.basis).toBe("unresolved");
  });

  it("does not change a past answer when a new carrier takes the truck on later", () => {
    const past = "2026-02-14T09:00:00.000Z";
    const rows = {
      leases: [lease("org_a", "2026-01-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z")],
      relationships: [relationship("org_a", "2025-01-01T00:00:00.000Z")],
    };
    const before = attributionAt(past, rows);

    // The truck is handed on. The history it already had is untouched, so the
    // same instant still resolves to the same carrier.
    const after = attributionAt(past, {
      leases: [
        ...rows.leases,
        lease("org_b", "2026-04-02T00:00:00.000Z"),
      ],
      relationships: [
        ...rows.relationships,
        relationship("org_b", "2026-04-02T00:00:00.000Z"),
        relationship("org_c", "2026-05-01T00:00:00.000Z"),
      ],
    });
    expect(after.carrierOrganizationId).toBe(before.carrierOrganizationId);
    expect(after.basis).toBe(before.basis);
  });

  it("marks a human answer as a declaration, so an audit can tell them apart", () => {
    const declared = declareAttribution("org_a", "Carrier A", NOW);
    expect(declared.basis).toBe("manual_declaration");
    expect(declared.carrierOrganizationId).toBe("org_a");
  });

  it("carries a snapshot forward unchanged for a correction", () => {
    const original = attributionAt("2026-02-01T00:00:00.000Z", {
      leases: [lease("org_a", "2026-01-01T00:00:00.000Z")],
      relationships: [relationship("org_a", "2026-01-01T00:00:00.000Z")],
    });
    expect(carryForwardAttribution(original)).toEqual(original);
  });
});
