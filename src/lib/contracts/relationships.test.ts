import { describe, expect, it } from "vitest";
import type { ContractRelationshipRef } from "@/types";
import {
  assertRelationshipAllowed, assertTransitionApplies, buildTransitionRequest,
  RelationshipBoundaryError, TERMINATION_PRESERVES, transitionsAvailableFor,
  transitionsOnActivation, transitionsOnTermination,
} from "./relationships";

const NOW = "2026-09-15T12:00:00.000Z";

function ref(
  kind: ContractRelationshipRef["kind"],
  overrides: Partial<ContractRelationshipRef> = {},
): ContractRelationshipRef {
  return {
    id: `crr_${kind}`, contractId: "ct_1", kind, externalId: `ext_${kind}`,
    labelSnapshot: kind, linkedAt: NOW, ...overrides,
  };
}

describe("which relationships an agreement may reference", () => {
  it("lets a company-driver agreement reference the driver relationship and access", () => {
    for (const kind of ["invitation", "membership", "driver_carrier_relationship"] as const) {
      expect(() => assertRelationshipAllowed("carrier_driver", kind)).not.toThrow();
    }
  });

  it("refuses a company-driver agreement an Operating Authority lease", () => {
    // A company driver brings no authority. An agreement that could point at a
    // lease would read, on screen, as though signing it authorised a truck.
    expect(() => assertRelationshipAllowed("carrier_driver", "truck_operating_lease"))
      .toThrow(RelationshipBoundaryError);
    expect(() => assertRelationshipAllowed("carrier_driver", "truck_carrier_relationship"))
      .toThrow(/cannot reference/);
  });

  it("lets an owner-operator agreement reference equipment and authority", () => {
    // The one driver-side type that genuinely brings both.
    for (const kind of ["truck_carrier_relationship", "truck_operating_lease"] as const) {
      expect(() => assertRelationshipAllowed("carrier_owner_operator", kind)).not.toThrow();
    }
  });

  it("refuses a dispatch agreement any equipment or authority reference", () => {
    for (const kind of ["truck_carrier_relationship", "truck_operating_lease", "trailer_operating_lease"] as const) {
      expect(() => assertRelationshipAllowed("carrier_dispatch_organization", kind)).toThrow();
    }
    expect(() => assertRelationshipAllowed("carrier_dispatch_organization", "truck_dispatch_access"))
      .not.toThrow();
  });

  it("assumes nothing for an 'other' agreement beyond access", () => {
    expect(() => assertRelationshipAllowed("other_business_relationship", "membership")).not.toThrow();
    expect(() => assertRelationshipAllowed("other_business_relationship", "truck_dispatch_access")).toThrow();
  });
});

describe("which transitions can be asked for", () => {
  it("offers only transitions that make sense for the relationship kind", () => {
    expect(transitionsAvailableFor("truck_operating_lease")).toEqual(["release_operating_authority"]);
    expect(transitionsAvailableFor("membership")).toEqual(["activate_membership", "revoke_membership"]);
  });

  it("refuses a nonsense pairing", () => {
    expect(() => assertTransitionApplies("truck_operating_lease", "activate_membership"))
      .toThrow(/not something a truck operating lease can be asked for/);
  });
});

describe("a transition request changes nothing", () => {
  const request = () => buildTransitionRequest({
    contractId: "ct_1",
    contractVersionId: "cv_1",
    agreementType: "carrier_driver",
    kind: "start_driver_relationship",
    target: { kind: "driver_carrier_relationship", externalId: "rel_1", labelSnapshot: "Dana at Northline" },
    reason: "Fully signed.",
    requestedByMembershipId: "mem_1",
    requestedByName: "Sam",
    now: NOW,
  });

  it("is recorded as not applied", () => {
    expect(request().applied).toBe(false);
  });

  it("names the service that actually has to do it", () => {
    expect(request().ownerService).toBe("Driver relationship service");
  });

  it("tells a person where the real change is made", () => {
    expect(request().nextStep).toMatch(/Open the driver's record/);
    expect(request().nextStep).toMatch(/unchanged until you do/);
  });

  it("refuses to be built for a relationship the agreement may not reference", () => {
    expect(() => buildTransitionRequest({
      contractId: "ct_1", agreementType: "carrier_driver",
      kind: "release_operating_authority",
      target: { kind: "truck_operating_lease", labelSnapshot: "Lease" },
      reason: "x", requestedByMembershipId: "mem_1", requestedByName: "Sam", now: NOW,
    })).toThrow(RelationshipBoundaryError);
  });

  it("gives every request its own id", () => {
    expect(request().id).not.toBe(request().id);
  });
});

describe("what activation and termination ask for", () => {
  it("never asks for an Operating Authority lease on activation", () => {
    // An authority lease is reserved per movement by the truck registry. A
    // contract asking for one would be a contract asking to put a truck on the road.
    const asked = transitionsOnActivation([
      ref("truck_operating_lease"), ref("driver_carrier_relationship"),
    ]);
    expect(asked.map((a) => a.kind)).toEqual(["start_driver_relationship"]);
  });

  it("asks for a release on termination, because ending is the safe direction", () => {
    const asked = transitionsOnTermination([ref("truck_operating_lease")]);
    expect(asked.map((a) => a.kind)).toEqual(["release_operating_authority"]);
  });

  it("ignores references somebody detached", () => {
    expect(transitionsOnActivation([
      ref("membership", { detachedAt: NOW }),
    ])).toEqual([]);
  });

  it("asks for access to be revoked on termination, never for records to be deleted", () => {
    const kinds = transitionsOnTermination([
      ref("membership"), ref("driver_carrier_relationship"),
      ref("truck_carrier_relationship"), ref("truck_dispatch_access"),
    ]).map((a) => a.kind);
    expect(kinds).toEqual([
      "revoke_membership", "end_driver_relationship",
      "end_asset_relationship", "end_dispatch_access",
    ]);
    expect(kinds.join(" ")).not.toMatch(/delete/);
  });
});

describe("what a termination preserves", () => {
  it("is data, so the promise cannot be edited out of one screen", () => {
    const text = TERMINATION_PRESERVES.join(" ");
    expect(text).toMatch(/Antcolos account/);
    expect(text).toMatch(/permanent truck and trailer records, their UUIDs/);
    expect(text).toMatch(/Completed loads, invoices, settlements/);
    expect(text).toMatch(/every version of it, every signature/);
  });
});
