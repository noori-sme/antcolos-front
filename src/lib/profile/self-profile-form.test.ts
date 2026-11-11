import { describe, expect, it } from "vitest";
import type { SelfProfile } from "@/types/self-profile";
import {
  avatarFileProblem, selfProfileFormSchema, toFormValues, toPatch,
} from "./self-profile-form";

const profile: SelfProfile = {
  userId: "u1",
  firstName: "Jordan",
  lastName: "Lee",
  name: "Jordan Lee",
  email: "driver@example.com",
  phone: "4155552671",
  headline: "Owner-operator",
};

describe("self profile form (plan 11)", () => {
  it("sends nothing when nothing changed", () => {
    expect(toPatch(profile, toFormValues(profile))).toBeNull();
  });

  it("sends only the changed keys, trimmed", () => {
    expect(
      toPatch(profile, { ...toFormValues(profile), lastName: " Park ", aboutMe: " Ten years OTR " }),
    ).toEqual({ lastName: "Park", aboutMe: "Ten years OTR" });
  });

  it("clears an emptied optional field with null, never an empty string", () => {
    expect(toPatch(profile, { ...toFormValues(profile), phone: "", headline: "  " })).toEqual({
      phone: null,
      headline: null,
    });
  });

  it("rejects what the backend rejects", () => {
    const base = toFormValues(profile);
    const invalid = [
      { ...base, firstName: " " },
      { ...base, headline: "a".repeat(121) },
      { ...base, headline: "two\nlines" },
      { ...base, aboutMe: "a".repeat(2001) },
      { ...base, phone: "12345" },
      { ...base, phone: "+1 (000) 000-0000" },
      { ...base, phone: "415 155 2671" },
    ];
    for (const values of invalid) expect(selfProfileFormSchema.safeParse(values).success).toBe(false);
    for (const phone of ["(415) 555-2671", "4155552671", "+1 415-555-2671", "415.555.2671"]) {
      expect(selfProfileFormSchema.safeParse({ ...base, phone }).success).toBe(true);
    }
    expect(selfProfileFormSchema.safeParse({ ...base, phone: "" }).success).toBe(true);
  });

  it("checks the picture before upload", () => {
    expect(avatarFileProblem({ type: "image/png", size: 1000 })).toBeNull();
    expect(avatarFileProblem({ type: "image/gif", size: 1000 })).toMatch(/JPEG, PNG or WebP/);
    expect(avatarFileProblem({ type: "image/jpeg", size: 5 * 1024 * 1024 + 1 })).toMatch(/5 MB/);
    expect(avatarFileProblem({ type: "image/webp", size: 0 })).toMatch(/empty/);
  });
});
