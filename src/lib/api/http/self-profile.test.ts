import { describe, expect, it } from "vitest";
import { toSelfProfile } from "./self-profile";

/** Copied from ../antcolos/docs/requirements/profile.md §8.2. */
const CONTRACT_SELF = {
  userId: "9f8e7d6c-5b4a-3210-fedc-ba9876543210",
  firstName: "Jordan",
  lastName: "Lee",
  name: "Jordan Lee",
  username: "jordanlee",
  email: "driver@example.com",
  phone: "4155552671",
  headline: "Owner-operator based in Dallas",
  aboutMe: "Ten years OTR. I run a reefer and prefer regional lanes.",
  avatar: { mimeType: "image/jpeg", updatedAt: "2026-09-26T12:00:00.000Z" },
  address: {
    addressLine1: "123 Market St",
    addressLine2: null,
    postalCode: "94105",
    city: "San Francisco",
    state: "CA",
    country: "US",
  },
};

describe("toSelfProfile (profile.md §8.2)", () => {
  it("maps the full contract example", () => {
    expect(toSelfProfile(CONTRACT_SELF)).toEqual({
      userId: "9f8e7d6c-5b4a-3210-fedc-ba9876543210",
      firstName: "Jordan",
      lastName: "Lee",
      name: "Jordan Lee",
      username: "jordanlee",
      email: "driver@example.com",
      phone: "4155552671",
      headline: "Owner-operator based in Dallas",
      aboutMe: "Ten years OTR. I run a reefer and prefer regional lanes.",
      avatar: { mimeType: "image/jpeg", updatedAt: "2026-09-26T12:00:00.000Z" },
      address: {
        addressLine1: "123 Market St",
        addressLine2: undefined,
        postalCode: "94105",
        city: "San Francisco",
        state: "CA",
        country: "US",
      },
    });
  });

  it("treats the nullable fields as absent", () => {
    const profile = toSelfProfile({
      ...CONTRACT_SELF,
      firstName: null,
      lastName: null,
      username: null,
      phone: null,
      headline: null,
      aboutMe: null,
      avatar: null,
      address: null,
    });
    expect(profile.firstName).toBe("");
    expect(profile.lastName).toBe("");
    expect(profile.name).toBe("Jordan Lee");
    for (const key of ["username", "phone", "headline", "aboutMe", "avatar", "address"] as const) {
      expect(profile[key]).toBeUndefined();
    }
  });

  it("tolerates a { data } envelope", () => {
    expect(toSelfProfile({ data: CONTRACT_SELF }).email).toBe("driver@example.com");
  });

  it("drops an avatar without a type", () => {
    expect(toSelfProfile({ ...CONTRACT_SELF, avatar: { updatedAt: "x" } }).avatar).toBeUndefined();
  });
});
