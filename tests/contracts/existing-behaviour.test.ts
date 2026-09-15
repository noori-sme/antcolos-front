import { beforeEach, describe, expect, it } from "vitest";
import { contextFor } from "@/test/context";
import {
  agreementContextFrom, amendSync, authorizeSignerSync, contractsForOrganization,
  createSync, getSync, giveTerminationNoticeSync, issueForSignatureSync,
  linkRelationshipSync, resetAgreementRegistry, signSync, waiveRequirementSync,
} from "@/lib/api/mock/agreement-registry";
import {
  fleetSync, resetTruckRegistry, truckAuthorityHistory, truckContextFrom,
  truckDispatchAccessFor, truckHoldingLease, truckRecord,
  truckRelationshipsFor, TRUCK_IDS,
} from "@/lib/api/mock/truck-registry";
import {
  driverProfileSync, driverRelationshipsSync, mockListRelationships,
} from "@/features/driver/mock-driver";
import {
  mockListInvitations, mockListRoles, resetAccessMock,
} from "@/features/access/mock-access";
import {
  MOCK_MEMBERSHIPS, MOCK_ORGANIZATIONS, MOCK_TEMPLATES, MOCK_USER,
} from "@/lib/session/fixtures";
import { PERMISSION_CATALOG } from "@/lib/permissions/catalog";
import { requiredPermissionsForPath } from "@/lib/permissions/route-manifest";
import { effectivePermissions } from "@/lib/permissions/effective";
import type { PermissionKey } from "@/types";

/**
 * The Contracts module changes nothing that already existed.
 *
 * This file is the guard on the one promise the whole design rests on: a
 * Contract records the TERMS of a relationship and never becomes the
 * relationship. So it exercises the contract service hard — creating, signing,
 * amending, terminating, linking — and then asserts that every canonical record
 * it touched is byte-for-byte what it was:
 *
 *   Organizations and the permanent User
 *   Memberships and their effective permissions
 *   Invitations and custom roles
 *   Driver–carrier relationships and the permanent driver profile
 *   Truck carrier relationships, dispatch access and Operating Authority leases
 *   Permanent equipment UUIDs and ownership history
 *
 * It also checks that the routes and permissions that worked before still work.
 */

const ctxFor = (organizationId: string) =>
  agreementContextFrom(contextFor(organizationId));

const owner = () => ctxFor("org_northline");

function contractByReference(organizationId: string, reference: string) {
  const found = contractsForOrganization(organizationId)
    .find((c) => c.reference === reference);
  if (!found) throw new Error(`No fixture contract ${reference} in ${organizationId}`);
  return found;
}

/** A snapshot of every canonical relationship record the module can see. */
async function canonicalSnapshot() {
  const truckCtx = truckContextFrom(contextFor("org_northline"));
  return JSON.stringify({
    user: MOCK_USER,
    organizations: MOCK_ORGANIZATIONS,
    memberships: MOCK_MEMBERSHIPS,
    invitations: await mockListInvitations("org_northline"),
    roles: await mockListRoles("org_northline"),
    driverRelationships: driverRelationshipsSync(),
    driverProfile: driverProfileSync(),
    driverEngagements: await mockListRelationships(),
    truckRelationships: truckRelationshipsFor("org_northline"),
    dispatchAccess: truckDispatchAccessFor("org_summit"),
    fleet: fleetSync(truckCtx),
    trucks: Object.values(TRUCK_IDS).map((id) => ({
      id,
      record: truckRecord(id),
      lease: truckHoldingLease(id),
      authority: truckAuthorityHistory(id),
    })),
  });
}

describe("contracts leave every canonical relationship alone", () => {
  beforeEach(() => {
    resetAgreementRegistry();
    resetTruckRegistry();
    resetAccessMock();
  });

  it("creating, signing, amending and terminating change nothing outside contracts", async () => {
    const before = await canonicalSnapshot();

    // 1. Create an agreement referencing a real driver relationship.
    const created = createSync(owner(), {
      agreementType: "carrier_driver",
      title: "Company driver agreement — behaviour guard (mock)",
      counterparty: {
        role: "driver", legalName: "Dmitri Kovalenko", driverProfileRef: "dp_dmitri",
      },
      terms: {
        summary: "MOCK — written by the existing-behaviour guard.",
        effective: { from: new Date().toISOString() },
        renewal: { kind: "none", reminderDays: 30 },
      },
      relationships: [{
        kind: "driver_carrier_relationship",
        externalId: "deng_dp_dmitri_org_northline",
        label: "Dmitri Kovalenko at Northline Freight",
      }],
    });

    // 2. Waive the blocking requirements and sign both sides, so the agreement
    //    actually activates and raises its transition requests.
    let view = getSync(owner(), created.contract.contractId);
    for (const requirement of view.requirements) {
      if (requirement.kind === "signature") continue;
      if (!requirement.blocking || requirement.status === "met") continue;
      view = waiveRequirementSync(
        owner(), created.contract.contractId, requirement.requirementId,
        "Cleared by the guard.",
      );
    }

    // 3. Sign, amend and terminate — the whole write surface, in one go.
    const carrier = view.parties.find((p) => p.role === "carrier")!;
    const driver = view.parties.find((p) => p.role === "driver")!;
    authorizeSignerSync(owner(), {
      contractId: created.contract.contractId, partyId: carrier.partyId,
      membershipId: "mem_northline_owner", name: "Sam Murtaza", authority: "owner",
    });
    authorizeSignerSync(owner(), {
      contractId: created.contract.contractId, partyId: driver.partyId,
      membershipId: "mem_nl_dmitri", name: "Dmitri Kovalenko", authority: "self",
    });
    const issued = issueForSignatureSync(owner(), created.contract.contractId);
    const versionId = issued.currentVersion.contractVersionId;

    signSync(owner(), {
      contractId: created.contract.contractId, contractVersionId: versionId,
      partyId: carrier.partyId, typedName: "Sam Murtaza",
    });
    const active = signSync({ ...owner(), membershipId: "mem_nl_dmitri" }, {
      contractId: created.contract.contractId, contractVersionId: versionId,
      partyId: driver.partyId, typedName: "Dmitri Kovalenko",
    });
    expect(active.contract.status).toBe("active");
    // It asked for the relationship to be started, and did not start it.
    const asked = active.transitionRequests.filter(
      (r) => r.kind === "start_driver_relationship",
    );
    expect(asked).toHaveLength(1);
    expect(asked[0].applied).toBe(false);

    amendSync(owner(), {
      contractId: created.contract.contractId,
      changeReason: "Guard amendment.",
      terms: { summary: "MOCK — amended by the guard." },
    });

    // Terminating an ACTIVE agreement: the strongest write there is.
    const terminatedContract = contractByReference("org_northline", "COO-0002");
    giveTerminationNoticeSync(owner(), {
      contractId: terminatedContract.contractId,
      ground: "for_convenience",
      reason: "Guard termination.",
    });

    // 4. Nothing outside contracts moved.
    expect(await canonicalSnapshot()).toBe(before);
  });

  it("never rewrites a permanent equipment UUID", async () => {
    const contract = contractByReference("org_northline", "COO-0002");
    const truckBefore = truckRecord(TRUCK_IDS.nl118);

    giveTerminationNoticeSync(owner(), {
      contractId: contract.contractId, ground: "for_cause",
      reason: "Guard: insurance lapsed.",
    });

    const truckAfter = truckRecord(TRUCK_IDS.nl118);
    expect(truckAfter?.truckId).toBe(TRUCK_IDS.nl118);
    expect(truckAfter?.vin).toBe(truckBefore?.vin);
    expect(JSON.stringify(truckAfter)).toBe(JSON.stringify(truckBefore));
  });

  it("never touches an Operating Authority lease", async () => {
    const before = JSON.stringify(
      Object.values(TRUCK_IDS).map((id) => truckHoldingLease(id) ?? null),
    );

    // An owner-operator agreement MAY reference an authority lease, so link one
    // and then terminate — the hardest case for the boundary.
    const contract = contractByReference("org_northline", "COO-0002");
    const lease = Object.values(TRUCK_IDS)
      .map((id) => truckHoldingLease(id))
      .find((l) => l != null);
    if (lease) {
      linkRelationshipSync(owner(), {
        contractId: contract.contractId,
        kind: "truck_operating_lease",
        externalId: lease.id,
        label: `Operating lease on ${lease.truckId}`,
      });
    }
    giveTerminationNoticeSync(owner(), {
      contractId: contract.contractId, ground: "for_convenience",
      reason: "Guard: ending the lease-on.",
    });

    expect(JSON.stringify(
      Object.values(TRUCK_IDS).map((id) => truckHoldingLease(id) ?? null),
    )).toBe(before);
  });

  it("asks for an authority release without performing one", async () => {
    const contract = contractByReference("org_northline", "COO-0002");
    const lease = Object.values(TRUCK_IDS)
      .map((id) => truckHoldingLease(id))
      .find((l) => l != null);
    if (!lease) return;

    linkRelationshipSync(owner(), {
      contractId: contract.contractId,
      kind: "truck_operating_lease",
      externalId: lease.id,
      label: `Operating lease on ${lease.truckId}`,
    });
    const view = giveTerminationNoticeSync(owner(), {
      contractId: contract.contractId, ground: "for_convenience",
      reason: "Guard: release requested.",
    });

    const request = view.transitionRequests.find(
      (r) => r.kind === "release_operating_authority",
    );
    expect(request).toBeDefined();
    expect(request!.applied).toBe(false);
    expect(request!.ownerService).toMatch(/Operating Authority leases/);
    expect(request!.nextStep).toMatch(/termination checklist/);
    // And the lease is exactly where it was.
    expect(truckHoldingLease(lease.truckId)?.status).toBe(lease.status);
  });
});

describe("what already worked still works", () => {
  beforeEach(() => {
    resetAgreementRegistry();
    resetAccessMock();
  });

  it("keeps every permission key that existed before", () => {
    const keys = new Set(PERMISSION_CATALOG.map((p) => p.key));
    for (const key of [
      "loads:view", "loads:assign", "drivers:view", "trucks:view",
      "trucks:relationships:manage", "trailers:relationships:manage",
      "members:view", "members:edit", "members:suspend", "permissions:manage",
      "invitations:view", "invitations:create", "invitations:revoke",
      "documents:view", "documents:approve", "settlements:view",
      "invoices:view", "compliance:view", "insurance:view", "fleet:view",
    ]) {
      expect(keys.has(key as PermissionKey)).toBe(true);
    }
  });

  it("adds contract keys that grant no access anywhere else", () => {
    const contractKeys = PERMISSION_CATALOG
      .filter((p) => p.group === "contracts")
      .map((p) => p.key);
    expect(contractKeys.length).toBeGreaterThanOrEqual(13);
    // Not one of them is an access-changing key from another module.
    for (const key of contractKeys) {
      expect(key.startsWith("contracts:")).toBe(true);
    }
  });

  it("keeps the routes that were guarded before, and guards the new one", () => {
    expect(requiredPermissionsForPath("/loads")).toEqual(["loads:view"]);
    expect(requiredPermissionsForPath("/fleet/trucks")).toEqual(["trucks:view"]);
    expect(requiredPermissionsForPath("/settings/users")).toEqual(["members:view"]);
    expect(requiredPermissionsForPath("/settings/invitations")).toEqual(["invitations:view"]);
    expect(requiredPermissionsForPath("/home")).toEqual([]);

    expect(requiredPermissionsForPath("/contracts")).toEqual(["contracts:view"]);
    expect(requiredPermissionsForPath("/contracts/abc")).toEqual(["contracts:view"]);
    expect(requiredPermissionsForPath("/contracts/new")).toEqual(["contracts:create"]);
  });

  it("still gives an owner everything and a rate-blind dispatcher less", () => {
    const northlineOwner = MOCK_MEMBERSHIPS.find((m) => m.id === "mem_northline_owner")!;
    const northline = MOCK_ORGANIZATIONS.find((o) => o.id === "org_northline")!;
    const ownerPerms = effectivePermissions(northlineOwner, northline, MOCK_TEMPLATES);
    expect(ownerPerms.has("contracts:sign")).toBe(true);
    expect(ownerPerms.has("contracts:financials:view")).toBe(true);

    const dispatcher = MOCK_MEMBERSHIPS.find((m) => m.id === "mem_meridian_dispatcher")!;
    const meridian = MOCK_ORGANIZATIONS.find((o) => o.id === "org_meridian")!;
    const dispatcherPerms = effectivePermissions(dispatcher, meridian, MOCK_TEMPLATES);
    expect(dispatcherPerms.has("contracts:view")).toBe(true);
    // Reads the terms, and never the money or the signature line.
    expect(dispatcherPerms.has("contracts:financials:view")).toBe(false);
    expect(dispatcherPerms.has("contracts:sign")).toBe(false);
    expect(dispatcherPerms.has("contracts:terminate")).toBe(false);
    expect(dispatcherPerms.has("contracts:signers:manage")).toBe(false);
  });

  it("leaves invitations and roles working exactly as before", async () => {
    const invitations = await mockListInvitations("org_northline");
    const roles = await mockListRoles("org_northline");

    // A contract write in between changes neither.
    createSync(owner(), {
      agreementType: "other_business_relationship",
      title: "Guard agreement (mock)",
      counterparty: { role: "other", legalName: "Somebody" },
    });

    expect(JSON.stringify(await mockListInvitations("org_northline")))
      .toBe(JSON.stringify(invitations));
    expect(JSON.stringify(await mockListRoles("org_northline")))
      .toBe(JSON.stringify(roles));
  });
});
