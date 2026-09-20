import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ActorRef, AuthorityStatus, FmcsaOfficialIdentity, RateConfirmationExtraction,
} from "@/types";
import { isIdentityVerified, isUnclaimed, isVerifiedUnclaimedBroker } from "@/types";
import {
  resetAuthorityService, setAuthorityService, type AuthorityLookupResult,
  type FmcsaAuthorityPort,
} from "@/lib/directory/authority";
import {
  allObservations, allParties, BrokerClaimError, claimBrokerProfile,
  getPartyProfile, observationsFor, observeBrokersFromRateCon,
  resetPartyRegistry, updateBrokerSelfReported, updatePaymentExperience,
} from "./party-registry";
import type { PartyContext } from "./party-registry";
import { canonicalForMc } from "@/lib/directory/broker-resolution";

const canonicalIdFor = (mc: string) => canonicalForMc(mc, allParties())?.partyId;

const NL = "org_northline";
const BX = "org_baxter";

const ACTOR: ActorRef = {
  userId: "usr_sam", membershipId: "mem_northline_owner",
  displayNameSnapshot: "Sam Murtaza", source: "web",
};

const ctxFor = (organizationId: string): PartyContext => ({
  organizationId,
  permissions: new Set([
    "customers:view", "customers:edit", "customers:resolve", "customers:private:manage",
  ]),
  actor: { ...ACTOR },
} as unknown as PartyContext);

/** The register's answer for Cornerstone. Nothing in the directory knows it. */
const CORNERSTONE: FmcsaOfficialIdentity = {
  legalName: "Cornerstone Freight Group LLC",
  mcNumber: "774411",
  dotNumber: "3310022",
  address: { line1: "55 Dock St", city: "Erie", state: "PA", postalCode: "16501", country: "US" },
  entityType: "Broker",
  operatingStatus: "Authorized for property",
  fetchedAt: "2026-09-20T00:00:00.000Z",
};

/** A stub authority. Tests drive the paths the real service will produce. */
function stubAuthority(
  answers: Record<string, AuthorityLookupResult>,
  fallback: AuthorityLookupResult = { status: "unavailable", detail: "stub: no answer" },
): FmcsaAuthorityPort {
  return {
    connected: true,
    async resolveMc(mc) {
      return answers[mc] ?? fallback;
    },
  };
}

const confirmed = (
  official: FmcsaOfficialIdentity,
  authorityStatus: AuthorityStatus = "active",
): AuthorityLookupResult => ({
  status: "confirmed", official, authorityStatus, authorityStatusText: "Authorized for property",
});

let sequence = 0;
function rateCon(
  reported: { name: string; mcNumber?: string; dotNumber?: string; address?: FmcsaOfficialIdentity["address"] },
): RateConfirmationExtraction {
  sequence += 1;
  return {
    documentId: `doc_rc_${sequence}`,
    loadId: `load_${sequence}`,
    customerReference: `REF-${sequence}`,
    blocks: [{ role: "broker", party: { ...reported }, contacts: [] }],
    reviewedBy: { ...ACTOR },
    reviewedAt: "2026-09-20T00:00:00.000Z",
  };
}

beforeEach(() => {
  resetPartyRegistry();
  sequence = 0;
});
afterEach(() => {
  resetAuthorityService();
});

/* ========================================================================== */

describe("1. many rate cons, one permanent profile", () => {
  it("reuses the same canonical profile for every confirmation with that MC", async () => {
    setAuthorityService(stubAuthority({ "774411": confirmed(CORNERSTONE) }));

    const first = await observeBrokersFromRateCon(NL, rateCon({
      name: "Cornerstone Freight Group LLC", mcNumber: "MC-774411",
    }));
    expect(first.created).toHaveLength(1);
    const partyId = first.created[0].partyId;

    // Two more confirmations, one of them from a DIFFERENT carrier.
    const second = await observeBrokersFromRateCon(NL, rateCon({
      name: "Cornerstone Freight Group LLC", mcNumber: "774411",
    }));
    const third = await observeBrokersFromRateCon(BX, rateCon({
      name: "Cornerstone Freight Group LLC", mcNumber: "mc 774411",
    }));

    expect(second.created).toHaveLength(0);
    expect(third.created).toHaveLength(0);
    expect(second.attached[0].partyId).toBe(partyId);
    expect(third.attached[0].partyId).toBe(partyId);

    // One profile, three observations, all pointing at it.
    expect(allParties().filter((p) => p.broker?.official?.mcNumber === "774411")).toHaveLength(1);
    expect(allObservations().filter((o) => o.partyId === partyId)).toHaveLength(3);
  });
});

describe("2. same MC, different names → observations and conflicts, not duplicates", () => {
  it("keeps one profile and records the disagreement on the observation", async () => {
    setAuthorityService(stubAuthority({ "774411": confirmed(CORNERSTONE) }));

    await observeBrokersFromRateCon(NL, rateCon({
      name: "Cornerstone Freight Group LLC", mcNumber: "774411",
    }));
    const second = await observeBrokersFromRateCon(NL, rateCon({
      name: "Keystone Logistics Partners", mcNumber: "774411",
    }));

    expect(second.created).toHaveLength(0);
    expect(allParties().filter((p) => p.broker?.official?.mcNumber === "774411")).toHaveLength(1);

    const observation = second.attached[0];
    expect(observation.state).toBe("conflicted");
    expect(observation.conflicts?.map((c) => c.field)).toContain("legalName");
    expect(observation.conflicts?.[0].reported).toBe("Keystone Logistics Partners");
    expect(observation.conflicts?.[0].official).toBe("Cornerstone Freight Group LLC");

    // And the profile still carries the REGISTER's name, not the document's.
    const party = allParties().find((p) => p.partyId === observation.partyId)!;
    expect(party.legalName).toBe("Cornerstone Freight Group LLC");
  });

  it("does not call punctuation a conflict", async () => {
    setAuthorityService(stubAuthority({ "774411": confirmed(CORNERSTONE) }));
    await observeBrokersFromRateCon(NL, rateCon({ name: "Cornerstone Freight Group LLC", mcNumber: "774411" }));
    const second = await observeBrokersFromRateCon(NL, rateCon({
      name: "Cornerstone Freight Group, L.L.C.", mcNumber: "774411",
    }));
    expect(second.attached[0].state).toBe("resolved");
  });
});

describe("3. one name, different MC numbers → never merged automatically", () => {
  it("keeps two separate profiles and merges nothing", async () => {
    const other: FmcsaOfficialIdentity = {
      ...CORNERSTONE, mcNumber: "998877", dotNumber: "4410099",
      legalName: "Cornerstone Freight Group LLC",
    };
    setAuthorityService(stubAuthority({
      "774411": confirmed(CORNERSTONE),
      "998877": confirmed(other),
    }));

    await observeBrokersFromRateCon(NL, rateCon({ name: "Cornerstone Freight Group LLC", mcNumber: "774411" }));
    const second = await observeBrokersFromRateCon(NL, rateCon({
      name: "Cornerstone Freight Group LLC", mcNumber: "998877",
    }));

    expect(second.created).toHaveLength(1);
    const byName = allParties().filter((p) => p.legalName === "Cornerstone Freight Group LLC");
    expect(byName).toHaveLength(2);
    // Two distinct identities, neither merged into the other.
    expect(new Set(byName.map((p) => p.broker?.official?.mcNumber))).toEqual(new Set(["774411", "998877"]));
    expect(byName.every((p) => p.mergedIntoPartyId === undefined)).toBe(true);
  });
});

describe("4. an unavailable authority creates nothing authoritative", () => {
  it("holds the observation and writes no profile — the default on this build", async () => {
    // No stub: the not-connected port is what this branch actually runs.
    const before = allParties().length;
    const report = await observeBrokersFromRateCon(NL, rateCon({
      name: "Cornerstone Freight Group LLC", mcNumber: "MC-774411",
    }));

    expect(report.created).toHaveLength(0);
    expect(allParties()).toHaveLength(before);

    const held = report.held[0];
    expect(held.state).toBe("pending_authority");
    expect(held.partyId).toBeUndefined();
    // The document's values survive in full, with provenance.
    expect(held.reported.name).toBe("Cornerstone Freight Group LLC");
    expect(held.reported.mcNumber).toBe("MC-774411");
    expect(held.normalizedMcNumber).toBe("774411");
    expect(held.provenance.documentId).toBe("doc_rc_1");
  });

  it("treats 'no such entity' as a conflict for a person, not as a profile", async () => {
    setAuthorityService(stubAuthority({}, { status: "not_found", detail: "No entity for that MC." }));
    const report = await observeBrokersFromRateCon(NL, rateCon({
      name: "Ghost Freight Co", mcNumber: "MC-330099",
    }));
    expect(report.created).toHaveLength(0);
    expect(report.held[0].state).toBe("conflicted");
  });

  it("never verifies an identity from document text, whatever the document says", async () => {
    const report = await observeBrokersFromRateCon(NL, rateCon({
      name: "Cornerstone Freight Group LLC", mcNumber: "774411",
      dotNumber: "3310022",
      address: { line1: "55 Dock St", city: "Erie", state: "PA", postalCode: "16501", country: "US" },
    }));
    expect(report.created).toHaveLength(0);
    expect(allParties().some((p) => p.broker?.identity.state === "verified"
      && p.broker.official?.mcNumber === "774411")).toBe(false);
  });
});

describe("5. a broker joining later claims the existing profile", () => {
  it("attaches to the record indexed years earlier instead of creating another", async () => {
    setAuthorityService(stubAuthority({ "774411": confirmed(CORNERSTONE) }));
    const [party] = (await observeBrokersFromRateCon(NL, rateCon({
      name: "Cornerstone Freight Group LLC", mcNumber: "774411",
    }))).created;

    expect(isVerifiedUnclaimedBroker(party)).toBe(true);

    const before = allParties().length;
    const claimed = claimBrokerProfile({
      partyId: party.partyId,
      organizationId: "org_cornerstone",
      method: "fmcsa_email",
      actor: ACTOR,
    });

    expect(allParties()).toHaveLength(before);
    expect(claimed.partyId).toBe(party.partyId);
    expect(claimed.claim.state).toBe("claimed");
    expect(claimed.claim.claimedByOrganizationId).toBe("org_cornerstone");
    // The identity did not change because somebody signed up.
    expect(isIdentityVerified(claimed)).toBe(true);
    expect(claimed.broker?.official).toEqual(CORNERSTONE);
  });

  it("refuses a second organization taking over a claimed profile", async () => {
    setAuthorityService(stubAuthority({ "774411": confirmed(CORNERSTONE) }));
    const [party] = (await observeBrokersFromRateCon(NL, rateCon({
      name: "Cornerstone Freight Group LLC", mcNumber: "774411",
    }))).created;

    claimBrokerProfile({ partyId: party.partyId, organizationId: "org_a", method: "domain_email", actor: ACTOR });
    expect(() => claimBrokerProfile({
      partyId: party.partyId, organizationId: "org_b", method: "domain_email", actor: ACTOR,
    })).toThrow(BrokerClaimError);
  });
});

describe("6. claiming does not alter historical observations", () => {
  it("leaves every rate con observation exactly as it was", async () => {
    setAuthorityService(stubAuthority({ "774411": confirmed(CORNERSTONE) }));
    await observeBrokersFromRateCon(NL, rateCon({ name: "Cornerstone Freight Group LLC", mcNumber: "774411" }));
    await observeBrokersFromRateCon(NL, rateCon({ name: "Keystone Logistics Partners", mcNumber: "774411" }));

    const before = JSON.parse(JSON.stringify(allObservations()));
    const party = allParties().find((p) => p.broker?.official?.mcNumber === "774411")!;

    claimBrokerProfile({ partyId: party.partyId, organizationId: "org_cornerstone", method: "fmcsa_email", actor: ACTOR });
    updateBrokerSelfReported(party.partyId, "org_cornerstone", {
      displayName: "Cornerstone", description: "We are wonderful.", phone: "+1 (814) 555-0000",
    }, ACTOR);

    // Byte for byte. The embarrassing one — the document that named them
    // Keystone — is still there, still conflicted.
    expect(allObservations()).toEqual(before);
    expect(allObservations().some((o) => o.state === "conflicted")).toBe(true);
  });
});

describe("7. official fields cannot be overwritten by broker edits", () => {
  it("writes only into selfReported and leaves the register's fields alone", async () => {
    setAuthorityService(stubAuthority({ "774411": confirmed(CORNERSTONE) }));
    const [party] = (await observeBrokersFromRateCon(NL, rateCon({
      name: "Cornerstone Freight Group LLC", mcNumber: "774411",
    }))).created;
    claimBrokerProfile({ partyId: party.partyId, organizationId: "org_cornerstone", method: "fmcsa_email", actor: ACTOR });

    const edited = updateBrokerSelfReported(party.partyId, "org_cornerstone", {
      displayName: "Cornerstone Logistics",
      website: "https://cornerstone.example.com",
      phone: "+1 (814) 555-0000",
      description: "Reefer specialists.",
    }, ACTOR);

    expect(edited.broker?.selfReported?.displayName).toBe("Cornerstone Logistics");
    // Untouched, all of it.
    expect(edited.broker?.official).toEqual(CORNERSTONE);
    expect(edited.legalName).toBe("Cornerstone Freight Group LLC");
    expect(edited.identifiers.mcNumber).toBe("774411");
    expect(edited.broker?.identity.state).toBe("verified");
    expect(edited.broker?.identity.source).toBe("FMCSA");
  });

  it("refuses an edit from an organization that did not claim it", async () => {
    setAuthorityService(stubAuthority({ "774411": confirmed(CORNERSTONE) }));
    const [party] = (await observeBrokersFromRateCon(NL, rateCon({
      name: "Cornerstone Freight Group LLC", mcNumber: "774411",
    }))).created;

    expect(() => updateBrokerSelfReported(party.partyId, NL, { displayName: "Mine now" }, ACTOR))
      .toThrow(BrokerClaimError);

    claimBrokerProfile({ partyId: party.partyId, organizationId: "org_cornerstone", method: "fmcsa_email", actor: ACTOR });
    expect(() => updateBrokerSelfReported(party.partyId, BX, { displayName: "Mine now" }, ACTOR))
      .toThrow(BrokerClaimError);
  });
});

describe("8. carrier-specific experience stays private to that carrier", () => {
  it("keeps factoring and payment experience off the shared broker record", async () => {
    // Apex is seeded with a relationship to BOTH carriers, which is what makes
    // it the honest fixture here: two carriers with opposite opinions of one
    // shared company.
    const apex = allParties().find((p) => p.legalName === "Apex Logistics LLC")!;
    const northline = ctxFor(NL);

    await updatePaymentExperience(northline, apex.partyId, {
      factored: true, averageDaysToPay: 74, disputeCount: 3,
    });

    // The shared record learned nothing. There is no field on it that could
    // hold this, which is the point.
    const shared = allParties().find((p) => p.partyId === apex.partyId)!;
    expect(JSON.stringify(shared)).not.toContain("factor");
    expect(JSON.stringify(shared)).not.toContain("74");

    // Northline sees its own figures.
    const own = await getPartyProfile(northline, apex.partyId);
    expect(own.relationship.paymentExperience?.factored).toBe(true);
    expect(own.relationship.paymentExperience?.averageDaysToPay).toBe(74);

    // Baxter, reading the same shared company, sees its own and never
    // Northline's — including the opposite standing.
    const theirs = await getPartyProfile(ctxFor(BX), apex.partyId);
    expect(theirs.party.partyId).toBe(apex.partyId);
    expect(theirs.relationship.paymentExperience?.factored).toBeUndefined();
    // Baxter keeps its OWN figure. The assertion that matters is that it is
    // not Northline's — one carrier's experience of a broker never becomes a
    // fact about the broker.
    expect(theirs.relationship.paymentExperience?.averageDaysToPay).not.toBe(74);
    expect(theirs.relationship.standing).toBe("blocked");
    expect(own.relationship.standing).toBe("preferred");
  });

  it("serves a carrier only the observations it recorded", async () => {
    setAuthorityService(stubAuthority({ "774411": confirmed(CORNERSTONE) }));
    await observeBrokersFromRateCon(NL, rateCon({ name: "Cornerstone Freight Group LLC", mcNumber: "774411" }));
    await observeBrokersFromRateCon(BX, rateCon({ name: "Cornerstone Freight Group LLC", mcNumber: "774411" }));

    expect(observationsFor(NL)).toHaveLength(1);
    expect(observationsFor(BX)).toHaveLength(1);
    expect(observationsFor(NL)[0].provenance.recordedByOrganizationId).toBe(NL);
  });

  it("does not put a freshly discovered broker into anybody's directory", async () => {
    // Discovery writes the shared company record and nothing carrier-private,
    // so the profile is canonical immediately and enters a carrier's directory
    // only when that carrier links a load to it through Directory → Review.
    setAuthorityService(stubAuthority({ "774411": confirmed(CORNERSTONE) }));
    const [party] = (await observeBrokersFromRateCon(NL, rateCon({
      name: "Cornerstone Freight Group LLC", mcNumber: "774411",
    }))).created;

    await expect(getPartyProfile(ctxFor(NL), party.partyId)).rejects.toThrow();
    // ...and it is still a real canonical record that the next confirmation
    // resolves to, which is the whole point of creating it.
    expect(canonicalIdFor("774411")).toBe(party.partyId);
  });
});

/* ========================================================================== */

describe("the axes stay apart", () => {
  it("an FMCSA-verified profile is not called unverified because nobody claimed it", async () => {
    setAuthorityService(stubAuthority({ "774411": confirmed(CORNERSTONE) }));
    const [party] = (await observeBrokersFromRateCon(NL, rateCon({
      name: "Cornerstone Freight Group LLC", mcNumber: "774411",
    }))).created;

    expect(isIdentityVerified(party)).toBe(true);
    expect(isUnclaimed(party)).toBe(true);
    // Permanent and active, not a review item waiting to be tidied up.
    expect(party.status).toBe("active");
    expect(party.reviewReason).toBeUndefined();
  });

  it("carries authority status separately, so a revoked broker is still identified", async () => {
    setAuthorityService(stubAuthority({ "774411": confirmed(CORNERSTONE, "revoked") }));
    const [party] = (await observeBrokersFromRateCon(NL, rateCon({
      name: "Cornerstone Freight Group LLC", mcNumber: "774411",
    }))).created;

    expect(party.broker?.identity.state).toBe("verified");
    expect(party.broker?.authority.status).toBe("revoked");
  });
});
