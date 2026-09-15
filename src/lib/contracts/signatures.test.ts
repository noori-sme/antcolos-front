import { describe, expect, it } from "vitest";
import type { AuthorizedSigner, ContractParty, ContractSignature } from "@/types";
import {
  acceptsSignatures, assertMaySignFor, hasSigned, isFullySigned, isSignerLive,
  partiesOutstanding, signablePartyIds, signatureStatement, signaturesOutstanding,
  signerFor,
} from "./signatures";

const NOW = "2026-09-15T12:00:00.000Z";

const parties: ContractParty[] = [
  {
    partyId: "pty_carrier", contractId: "ct_1", role: "carrier",
    legalNameSnapshot: "Northline Freight LLC", organizationRef: "org_northline",
    isOwningParty: true, addedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    partyId: "pty_driver", contractId: "ct_1", role: "driver",
    legalNameSnapshot: "Dana Whitfield", driverProfileRef: "drv_1",
    isOwningParty: false, addedAt: "2026-01-01T00:00:00.000Z",
  },
];

function signer(overrides: Partial<AuthorizedSigner> = {}): AuthorizedSigner {
  return {
    signerId: "sgn_carrier", contractId: "ct_1", partyId: "pty_carrier",
    membershipId: "mem_northline_owner", nameSnapshot: "Sam Murtaza",
    titleSnapshot: "Owner", authority: "owner",
    grantedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const driverSigner = signer({
  signerId: "sgn_driver", partyId: "pty_driver",
  membershipId: "mem_driver", nameSnapshot: "Dana Whitfield", authority: "self",
});

function signature(partyId: string): ContractSignature {
  return {
    signatureId: `sig_${partyId}`, contractId: "ct_1", contractVersionId: "cv_1",
    partyId, signerId: `sgn_${partyId}`, typedName: "X",
    signerNameSnapshot: "X", method: "mock_typed_name",
    statement: "MOCK SIGNATURE", signedAt: NOW, mock: true,
  };
}

describe("no party may sign for another", () => {
  const signers = [signer(), driverSigner];

  it("lets a signer sign for their own party", () => {
    expect(signerFor(signers, {
      membershipId: "mem_northline_owner", partyId: "pty_carrier", now: NOW,
    })?.signerId).toBe("sgn_carrier");
  });

  it("refuses the carrier owner signing the driver's side", () => {
    // The carrier owner holds every permission there is. It changes nothing:
    // authority comes from being a signer OF A PARTY.
    expect(() => assertMaySignFor(signers, parties, {
      membershipId: "mem_northline_owner", partyId: "pty_driver", now: NOW,
    })).toThrow(/may sign for Northline Freight LLC, not for Dana Whitfield/);
  });

  it("refuses the driver signing the carrier's side", () => {
    expect(() => assertMaySignFor(signers, parties, {
      membershipId: "mem_driver", partyId: "pty_carrier", now: NOW,
    })).toThrow(/not for Northline Freight LLC/);
  });

  it("refuses somebody who is not a signer at all, and says who can authorise them", () => {
    expect(() => assertMaySignFor(signers, parties, {
      membershipId: "mem_someone_else", partyId: "pty_carrier", now: NOW,
    })).toThrow(/not an authorised signer[\s\S]*an owner has to authorise you first/);
  });

  it("refuses a party that is not on the contract", () => {
    expect(() => assertMaySignFor(signers, parties, {
      membershipId: "mem_northline_owner", partyId: "pty_ghost", now: NOW,
    })).toThrow(/not on this contract/);
  });

  it("matches on membership, never on user or organization", () => {
    // The same person holding two memberships must not be able to sign the
    // other side from their other workspace.
    const bothSides = [signer(), signer({
      signerId: "sgn_driver_same_user", partyId: "pty_driver",
      membershipId: "mem_stonebridge_driver", authority: "self",
    })];
    expect(signablePartyIds(bothSides, "mem_northline_owner", NOW)).toEqual(["pty_carrier"]);
    expect(signablePartyIds(bothSides, "mem_stonebridge_driver", NOW)).toEqual(["pty_driver"]);
  });
});

describe("revoked authority", () => {
  it("stops the signer signing anything further", () => {
    const revoked = signer({ revokedAt: "2026-09-01T00:00:00.000Z" });
    expect(isSignerLive(revoked, NOW)).toBe(false);
    expect(signablePartyIds([revoked], "mem_northline_owner", NOW)).toEqual([]);
    expect(() => assertMaySignFor([revoked], parties, {
      membershipId: "mem_northline_owner", partyId: "pty_carrier", now: NOW,
    })).toThrow(/not an authorised signer/);
  });

  it("is still live when the revocation is in the future", () => {
    expect(isSignerLive(signer({ revokedAt: "2026-12-01T00:00:00.000Z" }), NOW)).toBe(true);
  });

  it("does not disturb signatures already given", () => {
    // Revoking authority is forward-looking. What was signed stays signed.
    const signatures = [signature("pty_carrier")];
    expect(hasSigned(signatures, { contractVersionId: "cv_1", partyId: "pty_carrier" })).toBe(true);
  });
});

describe("counting signatures", () => {
  it("reports every party outstanding on an unsigned version", () => {
    expect(signaturesOutstanding(parties, [], "cv_1")).toBe(2);
    expect(isFullySigned(parties, [], "cv_1")).toBe(false);
  });

  it("counts down as parties sign", () => {
    const one = [signature("pty_carrier")];
    expect(signaturesOutstanding(parties, one, "cv_1")).toBe(1);
    expect(partiesOutstanding(parties, one, "cv_1").map((p) => p.partyId)).toEqual(["pty_driver"]);
  });

  it("is fully signed only when everybody has signed THAT version", () => {
    const both = [signature("pty_carrier"), signature("pty_driver")];
    expect(isFullySigned(parties, both, "cv_1")).toBe(true);
    // A later version starts from nothing: an amendment needs signing again.
    expect(isFullySigned(parties, both, "cv_2")).toBe(false);
  });

  it("is never fully signed with no parties on it", () => {
    expect(isFullySigned([], [], "cv_1")).toBe(false);
  });
});

describe("what a signature claims", () => {
  it("says it is a mock with no legal effect, in the statement itself", () => {
    const statement = signatureStatement({
      partyName: "Northline Freight LLC", signerName: "Sam Murtaza",
      versionNumber: 2, contractTitle: "Company driver agreement",
    });
    expect(statement).toMatch(/^MOCK SIGNATURE — no legal effect\./);
    expect(statement).toMatch(/has not verified anybody's identity/);
    expect(statement).toMatch(/has not used an e-signature service/);
    expect(statement).toMatch(/has not had this reviewed by a lawyer/);
    expect(statement).toMatch(/has not sent it anywhere/);
    expect(statement).toMatch(/version 2 of "Company driver agreement"/);
  });
});

describe("which versions accept signatures", () => {
  it("accepts only an issued version", () => {
    expect(acceptsSignatures({ status: "issued" })).toBe(true);
    expect(acceptsSignatures({ status: "draft" })).toBe(false);
    expect(acceptsSignatures({ status: "signed" })).toBe(false);
    expect(acceptsSignatures({ status: "void" })).toBe(false);
    expect(acceptsSignatures({ status: "superseded" })).toBe(false);
  });
});
