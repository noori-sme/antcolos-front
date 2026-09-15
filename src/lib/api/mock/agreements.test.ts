import { beforeEach, describe, expect, it } from "vitest";
import { contextFor } from "@/test/context";
import {
  OrganizationScopeError, PermissionDeniedError,
} from "../contracts/context";
import {
  ContractVersionFrozenError, RelationshipBoundaryError, SignerAuthorityError,
} from "@/lib/contracts";
import {
  agreementContextFrom, amendSync, authorizeSignerSync, cancelSync,
  capabilitiesOf, compensationAtSync, confirmTerminationStepSync,
  contractsForOrganization, createSync, dashboardSync, getSync, getVersionSync,
  giveTerminationNoticeSync, issueForSignatureSync, linkRelationshipSync,
  listSync, resetAgreementRegistry, revokeSignerSync, sendForReviewSync,
  signSync, updateDraftTermsSync, waiveRequirementSync,
  withdrawTerminationSync,
} from "./agreement-registry";
import { resetTruckRegistry } from "./truck-registry";
import { resetCarrierRegistry } from "./carrier-registry";

/**
 * Contracts at the service seam.
 *
 * Every test here goes through the registry rather than a screen, because the
 * rules worth protecting are the ones a bad caller hits: permissions, signer
 * authority, organization isolation, version immutability, financial visibility,
 * and — the one this module exists for — that a contract never changes a
 * relationship.
 */

const ctxFor = (organizationId: string, overrides?: Parameters<typeof contextFor>[1]) =>
  agreementContextFrom(contextFor(organizationId, overrides));

/** Northline's owner: every permission there is. */
const owner = () => ctxFor("org_northline");

function contractByReference(organizationId: string, reference: string) {
  const found = contractsForOrganization(organizationId)
    .find((c) => c.reference === reference);
  if (!found) throw new Error(`No fixture contract ${reference} in ${organizationId}`);
  return found;
}

beforeEach(() => {
  resetAgreementRegistry();
  resetTruckRegistry();
  resetCarrierRegistry();
});

/* -------------------------------------------------------------------------- */
/* Permissions                                                                 */
/* -------------------------------------------------------------------------- */

describe("permissions are enforced at the seam", () => {
  it("refuses to list contracts without contracts:view", () => {
    expect(() => listSync(ctxFor("org_northline", { permissions: [] })))
      .toThrow(PermissionDeniedError);
  });

  it("refuses to read one without contracts:view", () => {
    const contract = contractByReference("org_northline", "CD-0001");
    expect(() => getSync(
      ctxFor("org_northline", { permissions: [] }), contract.contractId,
    )).toThrow(PermissionDeniedError);
  });

  it("refuses to create without contracts:create", () => {
    expect(() => createSync(ctxFor("org_northline", { without: ["contracts:create"] }), {
      agreementType: "carrier_driver",
      title: "Test",
      counterparty: { role: "driver", legalName: "Someone" },
    })).toThrow(PermissionDeniedError);
  });

  it("refuses to edit a draft without contracts:edit", () => {
    const contract = contractByReference("org_northline", "EL-0005");
    expect(() => updateDraftTermsSync(
      ctxFor("org_northline", { without: ["contracts:edit"] }),
      contract.contractId, { summary: "Changed" },
    )).toThrow(PermissionDeniedError);
  });

  it("refuses to terminate without contracts:terminate", () => {
    const contract = contractByReference("org_northline", "CD-0001");
    expect(() => giveTerminationNoticeSync(
      ctxFor("org_northline", { without: ["contracts:terminate"] }),
      { contractId: contract.contractId, ground: "for_convenience", reason: "x" },
    )).toThrow(PermissionDeniedError);
  });

  it("names the permission that was missing", () => {
    try {
      listSync(ctxFor("org_northline", { permissions: [] }));
      throw new Error("should have refused");
    } catch (error) {
      expect((error as PermissionDeniedError).required).toEqual(["contracts:view"]);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Organization isolation                                                      */
/* -------------------------------------------------------------------------- */

describe("cross-organization isolation", () => {
  it("does not list another organization's contracts", () => {
    const northline = listSync(owner(), { includeClosed: true }).map((r) => r.reference);
    const meridian = listSync(ctxFor("org_meridian"), { includeClosed: true })
      .map((r) => r.reference);

    expect(northline).toContain("CD-0001");
    expect(meridian).not.toContain("CD-0001");
    expect(meridian).toContain("CDO-0001");
  });

  it("refuses to read a contract through the wrong organization", () => {
    const northlineContract = contractByReference("org_northline", "CD-0001");
    expect(() => getSync(ctxFor("org_meridian"), northlineContract.contractId))
      .toThrow(OrganizationScopeError);
  });

  it("refuses to write to one through the wrong organization", () => {
    const northlineContract = contractByReference("org_northline", "EL-0005");
    // Given the permission, so it is isolation and not the permission gate that
    // refuses — the two failures must not be able to hide each other.
    expect(() => updateDraftTermsSync(
      ctxFor("org_meridian", { with: ["contracts:edit"] }),
      northlineContract.contractId, { summary: "Mine now" },
    )).toThrow(OrganizationScopeError);
  });

  it("checks the permission before it looks the contract up", () => {
    // Meridian's dispatcher may read contracts and not edit them, so the
    // permission is what they hit — a caller is never told whether a record they
    // may not touch exists.
    const northlineContract = contractByReference("org_northline", "EL-0005");
    expect(() => updateDraftTermsSync(
      ctxFor("org_meridian"), northlineContract.contractId, { summary: "Mine now" },
    )).toThrow(PermissionDeniedError);
  });

  it("gives each side of the same relationship its own record", () => {
    // Northline and Meridian both have a dispatch agreement with each other's
    // counterparty. They are separate records in separate workspaces, and
    // neither can read the other's.
    const northline = listSync(owner(), { includeClosed: true });
    const meridian = listSync(ctxFor("org_meridian"), { includeClosed: true });
    const shared = northline.filter(
      (n) => meridian.some((m) => m.contractId === n.contractId),
    );
    expect(shared).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Signer authority                                                            */
/* -------------------------------------------------------------------------- */

describe("no party may sign, approve, amend or terminate for another", () => {
  it("refuses the carrier owner signing the driver's line", () => {
    const contract = contractByReference("org_northline", "CD-0004");
    const view = getSync(owner(), contract.contractId);
    const driver = view.parties.find((p) => p.role === "driver")!;

    expect(() => signSync(owner(), {
      contractId: contract.contractId,
      contractVersionId: view.currentVersion.contractVersionId,
      partyId: driver.partyId,
      typedName: "Sam Murtaza",
    })).toThrow(SignerAuthorityError);
  });

  it("says which party the caller may sign for instead", () => {
    const contract = contractByReference("org_northline", "CD-0004");
    const view = getSync(owner(), contract.contractId);
    const driver = view.parties.find((p) => p.role === "driver")!;
    expect(() => signSync(owner(), {
      contractId: contract.contractId,
      contractVersionId: view.currentVersion.contractVersionId,
      partyId: driver.partyId,
      typedName: "Sam",
    })).toThrow(/not for Marisol Ortiz/);
  });

  it("refuses somebody with contracts:sign who is not a signer at all", () => {
    const contract = contractByReference("org_northline", "CD-0004");
    const view = getSync(owner(), contract.contractId);
    const carrier = view.parties.find((p) => p.role === "carrier")!;
    // A different membership in the same organization, holding the permission.
    const other = {
      ...owner(), membershipId: "mem_northline_dispatcher",
    };
    expect(() => signSync(other, {
      contractId: contract.contractId,
      contractVersionId: view.currentVersion.contractVersionId,
      partyId: carrier.partyId,
      typedName: "Somebody Else",
    })).toThrow(/not an authorised signer/);
  });

  it("refuses to authorise a signer for the other side's party", () => {
    const contract = contractByReference("org_northline", "CDO-0003");
    const view = getSync(owner(), contract.contractId);
    const summit = view.parties.find((p) => p.organizationRef === "org_summit")!;

    expect(() => authorizeSignerSync(owner(), {
      contractId: contract.contractId,
      partyId: summit.partyId,
      membershipId: "mem_northline_owner",
      name: "Sam Murtaza",
      authority: "delegated",
    })).toThrow(/cannot name yourself as the signatory for Summit Dispatch Partners LLC/);
  });

  it("refuses to appoint one membership to both sides of a contract", () => {
    const contract = contractByReference("org_northline", "CDO-0003");
    const view = getSync(owner(), contract.contractId);
    const northline = view.parties.find((p) => p.organizationRef === "org_northline")!;

    // mem_summit_owner already signs for Summit on this contract, so it cannot
    // also be made Northline's signatory.
    expect(() => authorizeSignerSync(owner(), {
      contractId: contract.contractId,
      partyId: northline.partyId,
      membershipId: "mem_summit_owner",
      name: "Sam Murtaza",
      authority: "delegated",
    })).toThrow(/cannot sign both sides/);
  });

  it("lets an owner authorise a signer for their own party", () => {
    const contract = contractByReference("org_northline", "EL-0005");
    const view = getSync(owner(), contract.contractId);
    const northline = view.parties.find((p) => p.organizationRef === "org_northline")!;

    const after = authorizeSignerSync(owner(), {
      contractId: contract.contractId,
      partyId: northline.partyId,
      membershipId: "mem_northline_dispatcher",
      name: "Reyna Vega",
      title: "Operations manager",
      authority: "delegated",
    });
    expect(after.signers.filter((s) => s.partyId === northline.partyId)).toHaveLength(2);
  });

  it("refuses to sign once authority is revoked, and keeps past signatures", () => {
    const contract = contractByReference("org_northline", "CD-0004");
    const before = getSync(owner(), contract.contractId);
    const carrierSigner = before.signers.find(
      (s) => s.membershipId === "mem_northline_owner",
    )!;
    const signaturesBefore = before.signatures.length;

    revokeSignerSync(owner(), contract.contractId, carrierSigner.signerId, "Left the company.");

    const after = getSync(owner(), contract.contractId);
    expect(after.signatures).toHaveLength(signaturesBefore);
    expect(after.capabilities.canSign).toBe(false);
    expect(after.capabilities.blockedReasons.join(" ")).toMatch(/not an authorised signer/);
  });

  it("refuses to sign the same version twice for one party", () => {
    const contract = contractByReference("org_northline", "CD-0004");
    const view = getSync(owner(), contract.contractId);
    const carrier = view.parties.find((p) => p.role === "carrier")!;

    expect(() => signSync(owner(), {
      contractId: contract.contractId,
      contractVersionId: view.currentVersion.contractVersionId,
      partyId: carrier.partyId,
      typedName: "Sam Murtaza",
    })).toThrow(/already signed this version/);
  });
});

/* -------------------------------------------------------------------------- */
/* Mock signatures                                                             */
/* -------------------------------------------------------------------------- */

describe("signatures are honest about what they are", () => {
  /** Signs the outstanding driver side of CD-0004 as that driver's membership. */
  function signAsDriver() {
    const contract = contractByReference("org_northline", "CD-0004");
    const view = getSync(owner(), contract.contractId);
    const driver = view.parties.find((p) => p.role === "driver")!;
    const driverCtx = { ...owner(), membershipId: "mem_nl_marisol" };
    return {
      contract,
      view: signSync(driverCtx, {
        contractId: contract.contractId,
        contractVersionId: view.currentVersion.contractVersionId,
        partyId: driver.partyId,
        typedName: "Marisol Ortiz",
      }),
    };
  }

  it("stores mock: true and a statement that disclaims everything", () => {
    const { view } = signAsDriver();
    const signature = view.signatures.at(-1)!;
    expect(signature.mock).toBe(true);
    expect(signature.method).toBe("mock_typed_name");
    expect(signature.statement).toMatch(/^MOCK SIGNATURE/);
    expect(signature.statement).toMatch(/has not verified anybody's identity/);
    expect(signature.statement).toMatch(/has not used an e-signature service/);
  });

  it("keeps the typed name verbatim and snapshots the signer", () => {
    const { view } = signAsDriver();
    const signature = view.signatures.at(-1)!;
    expect(signature.typedName).toBe("Marisol Ortiz");
    expect(signature.signerNameSnapshot).toBe("Marisol Ortiz");
  });

  it("freezes the version once every party has signed", () => {
    const { view } = signAsDriver();
    expect(view.currentVersion.status).toBe("signed");
    expect(view.currentVersion.frozen).toBe(true);
  });

  it("stays awaiting signature when a blocking requirement is still outstanding", () => {
    // A brand-new driver nobody holds paperwork for. A fully-signed agreement
    // that went active anyway would be an active agreement missing the licence
    // of the person it is about.
    const created = createSync(owner(), {
      agreementType: "carrier_driver",
      title: "Company driver agreement — Nils Bergstrom (mock)",
      counterparty: {
        role: "driver", legalName: "Nils Bergstrom", driverProfileRef: "dp_nils_new",
      },
      terms: {
        summary: "MOCK — a new driver with no paperwork on file yet.",
        effective: { from: new Date().toISOString() },
        renewal: { kind: "none", reminderDays: 30 },
      },
    });
    const contractId = created.contract.contractId;
    const carrier = created.parties.find((p) => p.role === "carrier")!;
    const driver = created.parties.find((p) => p.role === "driver")!;

    authorizeSignerSync(owner(), {
      contractId, partyId: carrier.partyId,
      membershipId: "mem_northline_owner", name: "Sam Murtaza", authority: "owner",
    });
    authorizeSignerSync(owner(), {
      contractId, partyId: driver.partyId,
      membershipId: "mem_nl_nils", name: "Nils Bergstrom", authority: "self",
    });

    const issued = issueForSignatureSync(owner(), contractId);
    const versionId = issued.currentVersion.contractVersionId;

    signSync(owner(), {
      contractId, contractVersionId: versionId,
      partyId: carrier.partyId, typedName: "Sam Murtaza",
    });
    const view = signSync({ ...owner(), membershipId: "mem_nl_nils" }, {
      contractId, contractVersionId: versionId,
      partyId: driver.partyId, typedName: "Nils Bergstrom",
    });

    expect(view.currentVersion.status).toBe("signed");
    expect(view.contract.status).toBe("awaiting_signature");
    expect(view.timeline.some((e) => e.summary === "Fully signed, and not yet active.")).toBe(true);
    expect(view.capabilities.blockedReasons.join(" ")).toMatch(/required item/);
  });
});

/* -------------------------------------------------------------------------- */
/* A contract never changes a relationship                                     */
/* -------------------------------------------------------------------------- */

describe("signing requests a relationship transition and applies nothing", () => {
  it("records a request with applied: false and names the owning service", () => {
    const contract = contractByReference("org_northline", "CD-0004");
    let before = getSync(owner(), contract.contractId);

    // Clear the blocking requirements first, so the last signature actually
    // activates the agreement and raises its requests.
    for (const requirement of before.requirements) {
      if (requirement.kind === "signature" || requirement.status === "met") continue;
      if (!requirement.blocking) continue;
      before = waiveRequirementSync(
        owner(), contract.contractId, requirement.requirementId,
        "Cleared for this test.",
      );
    }
    const driver = before.parties.find((p) => p.role === "driver")!;

    const after = signSync({ ...owner(), membershipId: "mem_nl_marisol" }, {
      contractId: contract.contractId,
      contractVersionId: before.currentVersion.contractVersionId,
      partyId: driver.partyId,
      typedName: "Marisol Ortiz",
    });
    expect(after.contract.status).toBe("active");

    // The contract references a pending INVITATION, so activating it asks for a
    // review of that invitation — never an acceptance.
    expect(after.transitionRequests).toHaveLength(1);
    const request = after.transitionRequests[0];
    expect(request.applied).toBe(false);
    expect(request.kind).toBe("review_invitation");
    expect(request.ownerService).toBe("Access service (invitations)");
    expect(request.nextStep).toMatch(/Settings → Invitations/);
    expect(request.nextStep).toMatch(/Nothing about it has changed/);
  });

  it("leaves memberships, invitations and driver relationships untouched", async () => {
    const { MOCK_MEMBERSHIPS } = await import("@/lib/session/fixtures");
    const { driverRelationshipsSync } = await import("@/features/driver/mock-driver");
    const { mockListInvitations } = await import("@/features/access/mock-access");

    const membershipsBefore = JSON.stringify(MOCK_MEMBERSHIPS);
    const relationshipsBefore = JSON.stringify(driverRelationshipsSync());
    const invitationsBefore = JSON.stringify(await mockListInvitations("org_northline"));

    const contract = contractByReference("org_northline", "CD-0004");
    const view = getSync(owner(), contract.contractId);
    const driver = view.parties.find((p) => p.role === "driver")!;
    signSync({ ...owner(), membershipId: "mem_nl_marisol" }, {
      contractId: contract.contractId,
      contractVersionId: view.currentVersion.contractVersionId,
      partyId: driver.partyId,
      typedName: "Marisol Ortiz",
    });

    expect(JSON.stringify(MOCK_MEMBERSHIPS)).toBe(membershipsBefore);
    expect(JSON.stringify(driverRelationshipsSync())).toBe(relationshipsBefore);
    expect(JSON.stringify(await mockListInvitations("org_northline"))).toBe(invitationsBefore);
  });

  it("refuses to reference a relationship the agreement type may not point at", () => {
    const contract = contractByReference("org_northline", "CD-0001");
    expect(() => linkRelationshipSync(owner(), {
      contractId: contract.contractId,
      kind: "truck_operating_lease",
      externalId: "lease_1",
      label: "Some authority lease",
    })).toThrow(RelationshipBoundaryError);
  });

  it("never asks for an Operating Authority lease on activation", () => {
    // The owner-operator agreement references a truck carrier relationship AND
    // could reference an authority lease. Activation asks for the first and
    // never the second — an authority lease is reserved per movement.
    const contract = contractByReference("org_northline", "COO-0002");
    const view = getSync(owner(), contract.contractId);
    const kinds = view.transitionRequests.map((r) => r.kind);
    expect(kinds).not.toContain("release_operating_authority");
  });
});

/* -------------------------------------------------------------------------- */
/* Version immutability                                                        */
/* -------------------------------------------------------------------------- */

describe("signed terms are never overwritten", () => {
  it("refuses to edit a signed version", () => {
    const contract = contractByReference("org_northline", "CD-0001");
    expect(() => updateDraftTermsSync(owner(), contract.contractId, { summary: "Rewritten" }))
      .toThrow(ContractVersionFrozenError);
  });

  it("creates a new version on an amendment and leaves the signed one alone", () => {
    const contract = contractByReference("org_northline", "CD-0001");
    const before = getSync(owner(), contract.contractId);
    const signedVersion = before.currentVersion;
    const signedRules = JSON.stringify(signedVersion.terms.compensation);
    const signedSignatures = before.signatures.filter(
      (s) => s.contractVersionId === signedVersion.contractVersionId,
    ).length;

    const after = amendSync(owner(), {
      contractId: contract.contractId,
      changeReason: "Rate rose to 66 cents from next month.",
      terms: {
        compensation: [{
          id: "cr_new", kind: "rate_per_loaded_mile", label: "Loaded mile rate",
          detail: "66 cents per loaded mile.", rateCents: 66, payeeRole: "driver",
        }],
      },
    });

    const stillSigned = after.versions.find(
      (v) => v.contractVersionId === signedVersion.contractVersionId,
    )!;
    expect(stillSigned.status).toBe("signed");
    expect(stillSigned.frozen).toBe(true);
    expect(JSON.stringify(stillSigned.terms.compensation)).toBe(signedRules);
    expect(after.signatures.filter(
      (s) => s.contractVersionId === signedVersion.contractVersionId,
    )).toHaveLength(signedSignatures);

    // The amendment is a NEW draft version, unsigned.
    expect(after.currentVersion.versionNumber).toBe(signedVersion.versionNumber + 1);
    expect(after.currentVersion.status).toBe("draft");
    expect(after.currentVersion.supersedesVersionId).toBe(signedVersion.contractVersionId);
  });

  it("works out which term groups the amendment changed", () => {
    const contract = contractByReference("org_northline", "CD-0001");
    const after = amendSync(owner(), {
      contractId: contract.contractId,
      changeReason: "Rate change only.",
      terms: {
        compensation: [{
          id: "cr_new", kind: "rate_per_loaded_mile", label: "Loaded mile rate",
          detail: "66 cents.", rateCents: 66, payeeRole: "driver",
        }],
      },
    });
    expect(after.currentVersion.changedTermGroups).toEqual(["compensation"]);
  });

  it("refuses an amendment with no reason", () => {
    const contract = contractByReference("org_northline", "CD-0001");
    expect(() => amendSync(owner(), {
      contractId: contract.contractId, changeReason: "  ", terms: {},
    })).toThrow(/has to say why/);
  });

  it("keeps the superseded version readable, with its own compensation", () => {
    // COO-0002 was amended in the fixtures: version 1 is superseded and kept.
    const contract = contractByReference("org_northline", "COO-0002");
    const view = getSync(owner(), contract.contractId);
    const v1 = view.versions.find((v) => v.versionNumber === 1)!;
    const v2 = view.versions.find((v) => v.versionNumber === 2)!;

    expect(v1.status).toBe("superseded");
    expect(v1.supersededByVersionId).toBe(v2.contractVersionId);
    expect(v1.terms.compensation[0].percentageBasisPoints).toBe(7000);
    expect(v2.terms.compensation[0].percentageBasisPoints).toBe(7200);
    expect(getVersionSync(owner(), contract.contractId, v1.contractVersionId)
      .terms.compensation[0].percentageBasisPoints).toBe(7000);
  });

  it("answers what was agreed on a past date from the version in force then", () => {
    const contract = contractByReference("org_northline", "COO-0002");
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();

    const then = compensationAtSync(owner(), contract.contractId, ninetyDaysAgo);
    const now = compensationAtSync(owner(), contract.contractId, yesterday);

    expect(then.versionNumber).toBe(1);
    expect(then.rules[0].percentageBasisPoints).toBe(7000);
    expect(now.versionNumber).toBe(2);
    expect(now.rules[0].percentageBasisPoints).toBe(7200);
  });
});

/* -------------------------------------------------------------------------- */
/* Financial visibility                                                        */
/* -------------------------------------------------------------------------- */

describe("compensation is omitted, not blanked", () => {
  it("withholds the rules from a caller without contracts:financials:view", () => {
    const contract = contractByReference("org_northline", "CD-0001");
    const blind = ctxFor("org_northline", {
      permissions: ["contracts:view"],
    });
    const view = getSync(blind, contract.contractId);

    expect(view.compensationVisible).toBe(false);
    expect(view.currentVersion.terms.compensation).toEqual([]);
    // And on every other version too, not just the current one.
    for (const version of view.versions) {
      expect(version.terms.compensation).toEqual([]);
    }
  });

  it("gives them to a caller who holds the key", () => {
    const contract = contractByReference("org_northline", "CD-0001");
    const view = getSync(owner(), contract.contractId);
    expect(view.compensationVisible).toBe(true);
    expect(view.currentVersion.terms.compensation.length).toBeGreaterThan(0);
  });

  it("refuses the point-in-time compensation read outright", () => {
    const contract = contractByReference("org_northline", "CD-0001");
    expect(() => compensationAtSync(
      ctxFor("org_northline", { permissions: ["contracts:view"] }),
      contract.contractId, new Date().toISOString(),
    )).toThrow(PermissionDeniedError);
  });

  it("says on every list row whether the figures were included", () => {
    const rows = listSync(ctxFor("org_northline", { permissions: ["contracts:view"] }));
    expect(rows.every((r) => r.compensationVisible === false)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                   */
/* -------------------------------------------------------------------------- */

describe("the contract lifecycle", () => {
  it("creates a draft with the catalog's requirements and no documents", () => {
    const view = createSync(owner(), {
      agreementType: "carrier_owner_operator",
      title: "Owner-operator agreement — test (mock)",
      counterparty: { role: "owner_operator", legalName: "Ada Fenwick", driverProfileRef: "dp_ada" },
    });

    expect(view.contract.status).toBe("draft");
    expect(view.currentVersion.versionNumber).toBe(1);
    expect(view.parties).toHaveLength(2);
    expect(view.parties.find((p) => p.isOwningParty)?.organizationRef).toBe("org_northline");
    // Required documents come from the catalog; a requirement is not a document.
    const documents = view.requirements.filter((r) => r.kind === "document");
    expect(documents.map((r) => r.documentTypeKey)).toContain("cdl");
    expect(documents.map((r) => r.documentTypeKey)).toContain("vehicle_registration");
    expect(documents.every((r) => r.status === "unmet" || r.status === "met")).toBe(true);
  });

  it("refuses to issue a version whose terms are incomplete", () => {
    const view = createSync(owner(), {
      agreementType: "carrier_driver",
      title: "Incomplete (mock)",
      counterparty: { role: "driver", legalName: "Nobody" },
    });
    expect(() => issueForSignatureSync(owner(), view.contract.contractId))
      .toThrow(/summary/);
  });

  it("refuses to issue when a party has no authorised signer", () => {
    const contract = contractByReference("org_northline", "EL-0005");
    // The draft is complete; Baxter has no signer.
    expect(() => issueForSignatureSync(owner(), contract.contractId))
      .toThrow(/Baxter Transit LLC has no authorised signer/);
  });

  it("locks the terms once a version is issued", () => {
    const contract = contractByReference("org_northline", "EL-0005");
    const view = getSync(owner(), contract.contractId);
    const baxter = view.parties.find((p) => p.organizationRef === "org_baxter")!;
    // This record is Northline's, so Northline records who signs for Baxter.
    // It is a different membership, which is what keeps it from being a way to
    // sign both sides.
    authorizeSignerSync(owner(), {
      contractId: contract.contractId,
      partyId: baxter.partyId,
      membershipId: "mem_baxter_owner",
      name: "Sam Murtaza",
      authority: "owner",
    });

    const issued = issueForSignatureSync(owner(), contract.contractId);
    expect(issued.currentVersion.status).toBe("issued");
    expect(issued.currentVersion.frozen).toBe(true);
    expect(issued.contract.status).toBe("awaiting_signature");
    expect(() => updateDraftTermsSync(owner(), contract.contractId, { summary: "Late change" }))
      .toThrow(ContractVersionFrozenError);
  });

  it("moves a draft through review and back", () => {
    const contract = contractByReference("org_northline", "EL-0005");
    const reviewed = sendForReviewSync(owner(), contract.contractId, "Please read.");
    expect(reviewed.contract.status).toBe("pending_review");
    expect(reviewed.timeline[0].detail).toMatch(/Please read\./);
    expect(reviewed.timeline[0].detail).toMatch(/No lawyer has seen it/);
  });

  it("cancels a draft, keeps the record and voids the version", () => {
    const contract = contractByReference("org_northline", "EL-0005");
    const view = cancelSync(owner(), contract.contractId, "Found a closer yard.");
    expect(view.contract.status).toBe("cancelled");
    expect(view.contract.cancelledReason).toBe("Found a closer yard.");
    expect(view.currentVersion.status).toBe("void");
    // Kept, not removed.
    expect(getSync(owner(), contract.contractId).contract.contractId).toBe(contract.contractId);
  });

  it("refuses to cancel an agreement that is already in force", () => {
    const contract = contractByReference("org_northline", "CD-0001");
    expect(() => cancelSync(owner(), contract.contractId, "Changed my mind"))
      .toThrow(/cannot move from active to cancelled/);
  });
});

/* -------------------------------------------------------------------------- */
/* Derived status                                                              */
/* -------------------------------------------------------------------------- */

describe("expiring and expired are derived on read", () => {
  it("marks the agreement inside its own reminder window as expiring", () => {
    const rows = listSync(owner(), { includeClosed: true });
    expect(rows.find((r) => r.reference === "CDO-0003")?.status).toBe("expiring");
  });

  it("marks the one that ran out as expired without anything being stored", () => {
    const rows = listSync(owner(), { includeClosed: true });
    const expired = rows.find((r) => r.reference === "CDO-0007")!;
    expect(expired.status).toBe("expired");
    // The stored status is still `active`: nothing wrote the derivation down.
    expect(contractByReference("org_northline", "CDO-0007").status).toBe("active");
  });

  it("hides closed contracts from the default list and finds them when asked", () => {
    const visible = listSync(owner()).map((r) => r.reference);
    expect(visible).not.toContain("CDO-0007");
    expect(listSync(owner(), { status: ["expired"] }).map((r) => r.reference))
      .toContain("CDO-0007");
  });
});

/* -------------------------------------------------------------------------- */
/* Requirements                                                                */
/* -------------------------------------------------------------------------- */

describe("requirements are evaluated, not stored", () => {
  it("reads Operating Authority from the carrier profile", () => {
    const contract = contractByReference("org_northline", "CD-0001");
    const view = getSync(owner(), contract.contractId);
    const authority = view.requirements.find((r) => r.kind === "operating_authority")!;
    // Northline's fixture authority is active, so the requirement is met without
    // anything being recorded on the contract.
    expect(authority.status).toBe("met");
  });

  it("counts an unmet blocking requirement on the summary", () => {
    const rows = listSync(owner(), { includeClosed: true });
    const draft = rows.find((r) => r.reference === "EL-0005")!;
    expect(draft.blockingRequirementsOpen).toBeGreaterThan(0);
  });

  it("clears a requirement when it is waived, with the reason on the record", () => {
    const contract = contractByReference("org_northline", "EL-0005");
    const before = getSync(owner(), contract.contractId);
    const target = before.requirements.find(
      (r) => r.kind === "document" && r.status !== "met",
    )!;

    const after = waiveRequirementSync(
      owner(), contract.contractId, target.requirementId, "Baxter is sending it next week.",
    );
    const waived = after.requirements.find((r) => r.requirementId === target.requirementId)!;
    expect(waived.status).toBe("waived");
    expect(waived.waivedReason).toBe("Baxter is sending it next week.");
    expect(after.timeline[0].kind).toBe("requirement_waived");
  });

  it("refuses to waive a signature", () => {
    const contract = contractByReference("org_northline", "EL-0005");
    const view = getSync(owner(), contract.contractId);
    const signature = view.requirements.find((r) => r.kind === "signature")!;
    expect(() => waiveRequirementSync(
      owner(), contract.contractId, signature.requirementId, "Just this once",
    )).toThrow(/cannot be waived/);
  });

  it("refuses to waive without the permission", () => {
    const contract = contractByReference("org_northline", "EL-0005");
    const view = getSync(owner(), contract.contractId);
    const target = view.requirements.find((r) => r.kind === "document")!;
    expect(() => waiveRequirementSync(
      ctxFor("org_northline", { without: ["contracts:requirements:waive"] }),
      contract.contractId, target.requirementId, "no",
    )).toThrow(PermissionDeniedError);
  });
});

/* -------------------------------------------------------------------------- */
/* Termination                                                                 */
/* -------------------------------------------------------------------------- */

describe("ending a relationship revokes access without deleting anything", () => {
  it("records a termination and asks the owning services to revoke access", () => {
    const contract = contractByReference("org_northline", "CD-0001");
    const view = giveTerminationNoticeSync(owner(), {
      contractId: contract.contractId,
      ground: "for_convenience",
      reason: "Dmitri is moving on.",
    });

    expect(view.contract.status).toBe("terminated");
    expect(view.termination?.ground).toBe("for_convenience");
    expect(view.termination?.steps.length).toBeGreaterThan(0);

    const requests = view.transitionRequests.filter(
      (r) => r.kind === "end_driver_relationship",
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].applied).toBe(false);
    expect(requests[0].nextStep).toMatch(/keeps their profile, their documents and every completed load/);
  });

  it("leaves the driver relationship and the permanent profile exactly as they were", async () => {
    const { driverRelationshipsSync, driverProfileSync } =
      await import("@/features/driver/mock-driver");
    const before = JSON.stringify({
      relationships: driverRelationshipsSync(), profile: driverProfileSync(),
    });

    const contract = contractByReference("org_northline", "COO-0002");
    giveTerminationNoticeSync(owner(), {
      contractId: contract.contractId, ground: "for_cause",
      reason: "Missed insurance renewal.",
    });

    expect(JSON.stringify({
      relationships: driverRelationshipsSync(), profile: driverProfileSync(),
    })).toBe(before);
  });

  it("never changes a permanent equipment UUID or its ownership history", async () => {
    const { truckRecord, truckAuthorityHistory } = await import("./truck-registry");
    const { TRUCK_IDS } = await import("./truck-registry");

    const before = JSON.stringify({
      truck: truckRecord(TRUCK_IDS.nl118),
      authority: truckAuthorityHistory(TRUCK_IDS.nl118),
    });

    const contract = contractByReference("org_northline", "COO-0002");
    giveTerminationNoticeSync(owner(), {
      contractId: contract.contractId, ground: "for_convenience",
      reason: "Marcus is taking his truck elsewhere.",
    });

    const after = JSON.stringify({
      truck: truckRecord(TRUCK_IDS.nl118),
      authority: truckAuthorityHistory(TRUCK_IDS.nl118),
    });
    expect(after).toBe(before);
    expect(truckRecord(TRUCK_IDS.nl118)?.truckId).toBe(TRUCK_IDS.nl118);
  });

  it("keeps the contract, its versions, its signatures and its timeline", () => {
    const contract = contractByReference("org_northline", "CD-0001");
    const before = getSync(owner(), contract.contractId);

    giveTerminationNoticeSync(owner(), {
      contractId: contract.contractId, ground: "for_convenience", reason: "Moving on.",
    });
    const after = getSync(owner(), contract.contractId);

    expect(after.versions).toHaveLength(before.versions.length);
    expect(after.signatures).toHaveLength(before.signatures.length);
    expect(after.timeline.length).toBeGreaterThan(before.timeline.length);
    expect(after.currentVersion.terms.compensation)
      .toEqual(before.currentVersion.terms.compensation);
  });

  it("refuses a ground the agreement does not allow", () => {
    const contract = contractByReference("org_northline", "CD-0001");
    expect(() => giveTerminationNoticeSync(owner(), {
      contractId: contract.contractId, ground: "mutual", reason: "Both agreed.",
    })).toThrow(/does not allow termination on that ground/);
  });

  it("computes the effective date from the notice period", () => {
    const contract = contractByReference("org_northline", "CD-0001");
    const view = giveTerminationNoticeSync(owner(), {
      contractId: contract.contractId, ground: "for_convenience", reason: "x",
    });
    const noticed = new Date(view.termination!.noticeGivenAt).getTime();
    const effective = new Date(view.termination!.effectiveAt).getTime();
    expect(Math.round((effective - noticed) / 86_400_000)).toBe(30);
  });

  it("completes only when every closeout step is confirmed", () => {
    const contract = contractByReference("org_northline", "CD-0001");
    let view = giveTerminationNoticeSync(owner(), {
      contractId: contract.contractId, ground: "for_convenience", reason: "x",
    });
    const steps = view.termination!.steps.map((s) => s.key);

    for (const [index, step] of steps.entries()) {
      view = confirmTerminationStepSync(owner(), contract.contractId, step, "done");
      const expected = index === steps.length - 1 ? "completed" : "in_closeout";
      expect(view.termination!.status).toBe(expected);
    }
  });

  it("refuses a second termination while one is open, and allows a withdrawal", () => {
    const contract = contractByReference("org_northline", "CD-0001");
    giveTerminationNoticeSync(owner(), {
      contractId: contract.contractId, ground: "for_convenience", reason: "x",
    });
    expect(() => giveTerminationNoticeSync(owner(), {
      contractId: contract.contractId, ground: "for_cause", reason: "y",
    })).toThrow(/already been recorded/);

    const withdrawn = withdrawTerminationSync(
      owner(), contract.contractId, "They changed their mind.",
    );
    expect(withdrawn.contract.status).toBe("active");
    expect(withdrawn.termination).toBeUndefined();
  });

  it("carries an unfinished closeout on the fixture contract", () => {
    // CD-0006 was terminated 60 days ago with two of four steps confirmed.
    const view = getSync(
      owner(), contractByReference("org_northline", "CD-0006").contractId,
    );
    expect(view.termination?.status).toBe("in_closeout");
    expect(view.termination?.steps.filter((s) => !s.confirmedAt).length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Capabilities                                                                */
/* -------------------------------------------------------------------------- */

describe("capabilities match what the seam would do", () => {
  it("offers nothing on a terminal contract and says why", () => {
    const contract = contractByReference("org_baxter", "OBR-0001");
    const capabilities = capabilitiesOf(ctxFor("org_baxter"), contract);
    expect(capabilities.canEditDraft).toBe(false);
    expect(capabilities.canSign).toBe(false);
    expect(capabilities.canAmend).toBe(false);
    expect(capabilities.blockedReasons.join(" ")).toMatch(/cancelled.*read-only/);
  });

  it("offers signing only for the parties the caller is authorised for", () => {
    const contract = contractByReference("org_northline", "CD-0004");
    const view = getSync(owner(), contract.contractId);
    const carrier = view.parties.find((p) => p.role === "carrier")!;
    // The carrier already signed, so nothing is signable for the owner.
    expect(view.capabilities.signableForPartyIds).not.toContain(carrier.partyId);
    expect(view.capabilities.canSign).toBe(false);

    const driverView = getSync({ ...owner(), membershipId: "mem_nl_marisol" }, contract.contractId);
    expect(driverView.capabilities.canSign).toBe(true);
  });

  it("does not offer amending a draft, or editing a signed version", () => {
    const draft = getSync(owner(), contractByReference("org_northline", "EL-0005").contractId);
    expect(draft.capabilities.canEditDraft).toBe(true);
    expect(draft.capabilities.canAmend).toBe(false);

    const signed = getSync(owner(), contractByReference("org_northline", "CD-0001").contractId);
    expect(signed.capabilities.canEditDraft).toBe(false);
    expect(signed.capabilities.canAmend).toBe(true);
  });

  it("withholds compensation capability from a caller without the key", () => {
    const contract = contractByReference("org_northline", "CD-0001");
    const view = getSync(
      ctxFor("org_northline", { permissions: ["contracts:view"] }), contract.contractId,
    );
    expect(view.capabilities.canViewCompensation).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                   */
/* -------------------------------------------------------------------------- */

describe("the dashboard is organization-scoped and derived", () => {
  it("counts only this organization's contracts", () => {
    const northline = dashboardSync(owner());
    const total = Object.values(northline.counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(contractsForOrganization("org_northline").length);
  });

  it("surfaces the expiring, the unsigned, the blocked and the unfinished", () => {
    const dashboard = dashboardSync(owner());
    expect(dashboard.expiringSoon.map((r) => r.reference)).toContain("CDO-0003");
    expect(dashboard.withOpenRequirements.length).toBeGreaterThan(0);
    expect(dashboard.unresolvedTerminations.map((r) => r.reference)).toContain("CD-0006");
  });

  it("shows a driver only the agreements in their own workspace", () => {
    const driver = dashboardSync(ctxFor("org_stonebridge"));
    expect(driver.organizationId).toBe("org_stonebridge");
    const total = Object.values(driver.counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(contractsForOrganization("org_stonebridge").length);
  });

  it("refuses without contracts:view", () => {
    expect(() => dashboardSync(ctxFor("org_northline", { permissions: [] })))
      .toThrow(PermissionDeniedError);
  });
});

/* -------------------------------------------------------------------------- */
/* Audit timeline                                                              */
/* -------------------------------------------------------------------------- */

describe("the audit timeline is append-only", () => {
  it("records every step, newest first, and never removes one", () => {
    const contract = contractByReference("org_northline", "EL-0005");
    const before = getSync(owner(), contract.contractId).timeline.length;

    updateDraftTermsSync(owner(), contract.contractId, { summary: "Edited once." });
    sendForReviewSync(owner(), contract.contractId, "Have a look.");
    const after = getSync(owner(), contract.contractId).timeline;

    expect(after.length).toBe(before + 2);
    expect(after[0].kind).toBe("sent_for_review");
    expect(after[1].kind).toBe("version_edited");
  });

  it("records who acted, in which organization", () => {
    const contract = contractByReference("org_northline", "EL-0005");
    updateDraftTermsSync(owner(), contract.contractId, { summary: "Edited." });
    const event = getSync(owner(), contract.contractId).timeline[0];
    expect(event.organizationId).toBe("org_northline");
    expect(event.actor.membershipId).toBe("mem_northline_owner");
  });
});
