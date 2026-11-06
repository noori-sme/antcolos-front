import { describe, expect, it } from "vitest";
import type { CarrierProfile } from "@/types/auth";
import { toAuthResult, toCarrierProfile } from "./auth-api";

// From ../antcolos/docs/requirements/carrier-onboarding.md (carrier-onboarding response).
const ONBOARDING = {
  user: {
    id: "3f2a1c4e-7b8d-4a21-9c0e-1f2a3b4c5d6e",
    email: "taylor@example.com",
    name: "Taylor Morgan",
    username: "taylormorgan",
    scope: "onboarding" as const,
    emailVerified: true,
    pendingOrganizationType: "CARRIER" as const,
    nextStep: "verify-carrier" as const,
    carrierVerification: {
      email: "sa***@greyhound.com",
      expiresAt: "2026-09-27T12:00:00.000Z",
      expired: false,
    },
  },
  accessToken: "<onboarding jwt>",
};

describe("toAuthResult", () => {
  it("reads the onboarding step from an onboarding user", () => {
    const result = toAuthResult(ONBOARDING);
    expect(result.accessToken).toBe("<onboarding jwt>");
    expect(result.nextStep).toBe("verify-carrier");
    expect(result.user).toEqual(ONBOARDING.user);
  });

  it("has no next step for a tenant or individual user", () => {
    const tenant = toAuthResult({
      user: {
        id: "u1", email: "a@b.co", name: "A", username: "a", scope: "tenant",
        organizationId: "o1", organizationType: "CARRIER", role: "ADMIN",
      },
      accessToken: "t",
    });
    expect(tenant.nextStep).toBeNull();
    const individual = toAuthResult({
      user: { id: "u2", email: "d@b.co", name: "D", username: null, scope: "individual", individualRole: "DRIVER" },
      accessToken: "t",
    });
    expect(individual.nextStep).toBeNull();
  });
});

describe("toCarrierProfile", () => {
  it("keeps the fields onboarding shows (carrier-lookup.md example)", () => {
    const profile = toCarrierProfile({
      dotNumber: "44110",
      mcNumber: "MC1515",
      legalName: "GREYHOUND LINES INC",
      dbaName: "BOLT BUS",
      phone: "2147776005",
      email: null,
      active: true,
      address: { street: "350 N SAINT PAUL ST", city: "DALLAS", state: "TX", zip: "75201", country: "US" } as unknown as CarrierProfile["address"],
      mailingAddress: { street: null, city: null, state: null, zip: null },
      sources: { identity: "qcmobile" },
    });
    expect(profile).toEqual({
      dotNumber: "44110",
      mcNumber: "MC1515",
      legalName: "GREYHOUND LINES INC",
      dbaName: "BOLT BUS",
      email: null,
      active: true,
      address: { city: "DALLAS", state: "TX", country: "US" },
    });
  });
});
