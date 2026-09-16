import { beforeEach, describe, expect, it } from "vitest";
import { MOCK_MEMBERSHIPS } from "@/lib/session/fixtures";
import { driverHomeMode } from "./home-mode";
import { driverIdentityErrors, driverIdentityIsComplete, emptyDriverIdentity } from "./identity";
import {
  mockCreateRelationship,
  mockGetDriverProfile,
  mockListDocuments,
  mockListRelationships,
  resetDriverMock,
} from "./mock-driver";
import { completeDriverSelfOnboarding, driverNeedsIdentity } from "./self-onboarding";

/**
 * A driver signing up for themselves — and the line that must not be crossed.
 *
 * The point of this flow is that a driver no longer has to wait for a carrier
 * to hand them a link. The point of this file is that signing up STILL does not
 * make anybody their carrier: it creates one permanent profile, and nothing
 * that looks like employment, membership, assignment or access to a carrier's
 * data. That claim cannot be proven by clicking through screens, so it is
 * proven here, where the profile and the relationship layer can be read
 * directly.
 */

const FUTURE = (() => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 2);
  return d.toISOString().slice(0, 10);
})();

const identity = () => ({
  legalName: "Yusuf Demir",
  cdlNumber: "k4471182993",
  cdlState: "TX",
  cdlExpiresAt: FUTURE,
});

const selfOnboard = (over: Partial<Parameters<typeof completeDriverSelfOnboarding>[0]> = {}) =>
  completeDriverSelfOnboarding({
    workEmail: "Yusuf.Demir@Example.com ",
    emailVerified: true,
    identity: identity(),
    ...over,
  });

describe("a driver signing up without an invitation", () => {
  beforeEach(() => {
    // Nobody yet: no profile, no carrier, no paperwork.
    resetDriverMock({ withProfile: false });
  });

  it("creates the permanent profile from the verified work address", async () => {
    const result = await selfOnboard();

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.resumed).toBe(false);
    expect(result.profile.legalName).toBe("Yusuf Demir");
    // Canonical form, so the same person cannot arrive twice under two spellings.
    expect(result.profile.email).toBe("yusuf.demir@example.com");
    expect(result.profile.cdlNumber).toBe("K4471182993");

    expect(await mockGetDriverProfile()).not.toBeNull();
  });

  it("creates no carrier relationship, no carrier, and no membership", async () => {
    // A membership is how somebody belongs to an organization, and a driver
    // membership is one linked to a driver profile. Signing up may add neither.
    const before = MOCK_MEMBERSHIPS.map(
      (m) => `${m.id}:${m.organizationId}:${m.driverProfileId ?? ""}`,
    );

    const result = await selfOnboard();
    if (result.status !== "ok") throw new Error("expected onboarding to succeed");

    expect(await mockListRelationships()).toEqual([]);
    expect(MOCK_MEMBERSHIPS.map((m) => `${m.id}:${m.organizationId}:${m.driverProfileId ?? ""}`))
      .toEqual(before);
    // And nothing on the profile itself names an employer.
    expect(Object.keys(result.profile)).not.toContain("carrierId");
    expect(Object.keys(result.profile)).not.toContain("organizationId");
  });

  it("shows the driver no carrier's data, because there is no carrier", async () => {
    const result = await selfOnboard();
    if (result.status !== "ok") throw new Error("expected onboarding to succeed");

    const relationships = await mockListRelationships();
    expect(relationships).toEqual([]);
    // No carrier checklist, so no carrier's documents.
    expect(await mockListDocuments()).toEqual([]);
    expect(driverHomeMode(result.profile, relationships)).toBe("unattached");
  });

  it("refuses to create anything from an address that was never verified", async () => {
    const result = await selfOnboard({ emailVerified: false });

    expect(result.status).toBe("email-unverified");
    expect(await mockGetDriverProfile()).toBeNull();
  });

  it("refuses an address that is not an address", async () => {
    const result = await selfOnboard({ workEmail: "yusuf.demir@" });

    expect(result.status).toBe("email-invalid");
    expect(await mockGetDriverProfile()).toBeNull();
  });

  it("will not create a profile until the licence questions are answered", async () => {
    const result = await selfOnboard({ identity: emptyDriverIdentity() });

    expect(result.status).toBe("identity-incomplete");
    expect(await mockGetDriverProfile()).toBeNull();
  });

  it("creates one profile however many times it is run", async () => {
    const first = await selfOnboard();
    const second = await selfOnboard({ workEmail: "someone.else@example.com" });

    if (first.status !== "ok" || second.status !== "ok") throw new Error("expected both to succeed");
    expect(second.profile.id).toBe(first.profile.id);
    expect(second.resumed).toBe(true);
    // The second run is a resume, so it cannot quietly rewrite the identity.
    expect(second.profile.email).toBe(first.profile.email);
  });

  it("hands a later carrier invitation the SAME profile", async () => {
    const result = await selfOnboard();
    if (result.status !== "ok") throw new Error("expected onboarding to succeed");
    const profileId = result.profile.id;

    // What accepting a carrier's invitation does, at the layer it does it.
    const relationship = await mockCreateRelationship(profileId, {
      carrierId: "org_northline",
      carrierName: "Northline Freight",
      engagementType: "company_driver",
      roleName: "Driver",
      permissions: [],
      sharedDocumentKeys: ["cdl_front"],
    });

    expect(relationship.driverProfileId).toBe(profileId);
    const after = await mockGetDriverProfile();
    expect(after?.id).toBe(profileId);
    // Still one profile, still the licence they gave once.
    expect(after?.cdlNumber).toBe("K4471182993");
    expect(await driverNeedsIdentity()).toBe(false);
  });
});

describe("a driver who already has a profile", () => {
  beforeEach(() => {
    resetDriverMock();
  });

  it("is resumed rather than asked for a licence again", async () => {
    const before = await mockGetDriverProfile();
    expect(before).not.toBeNull();

    expect(await driverNeedsIdentity()).toBe(false);
    const result = await selfOnboard({ identity: emptyDriverIdentity() });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.resumed).toBe(true);
    expect(result.profile.id).toBe(before!.id);
    expect(result.profile.cdlNumber).toBe(before!.cdlNumber);
  });

  it("keeps the carriers they already had, and gains none", async () => {
    const before = await mockListRelationships();
    await selfOnboard();
    const after = await mockListRelationships();

    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
  });
});

describe("which home a driver gets", () => {
  const profile = { id: "dp_1" } as Parameters<typeof driverHomeMode>[0];

  it("is the unattached one when no carrier relationship is live", () => {
    expect(driverHomeMode(profile, [])).toBe("unattached");
    expect(
      driverHomeMode(profile, [{ status: "ended" } as never]),
    ).toBe("unattached");
  });

  it("is the carrier one as soon as a relationship exists", () => {
    expect(driverHomeMode(profile, [{ status: "onboarding" } as never])).toBe("carrier");
    expect(driverHomeMode(profile, [{ status: "active" } as never])).toBe("carrier");
  });

  it("leaves everybody without a driver profile exactly where they were", () => {
    expect(driverHomeMode(null, [])).toBe("carrier");
  });
});

describe("the licence questions", () => {
  it("are all required", () => {
    const errors = driverIdentityErrors(emptyDriverIdentity());
    expect(Object.values(errors).every((e) => typeof e === "string")).toBe(true);
    expect(driverIdentityIsComplete(emptyDriverIdentity())).toBe(false);
  });

  it("pass once they are answered", () => {
    expect(driverIdentityIsComplete(identity())).toBe(true);
  });
});
