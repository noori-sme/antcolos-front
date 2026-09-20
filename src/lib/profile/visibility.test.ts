import { describe, expect, it } from "vitest";
import type { ProfileVisibility, UserProfile } from "@/types";
import {
  canReadProfile, isOwner, isShareable, visibleSections, withheldSections,
} from "./visibility";

function profile(
  visibility: ProfileVisibility,
  sections = { metrics: true, workplaces: true, achievements: true },
): UserProfile {
  return {
    userId: "usr_sam",
    username: "sam_murtaza",
    fullName: "Sam Murtaza",
    links: [],
    visibility,
    sections,
    verifications: [],
    joinedAt: "2025-11-04T16:20:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

const owner = { userId: "usr_sam" };
const stranger = { userId: "usr_other" };
const signedOut = null;

describe("who may open a profile at all", () => {
  it("lets anybody read a public one", () => {
    expect(canReadProfile(profile("public"), signedOut)).toBe(true);
    expect(canReadProfile(profile("public"), stranger)).toBe(true);
  });

  it("requires a session for a signed-in-only one", () => {
    expect(canReadProfile(profile("signed-in"), signedOut)).toBe(false);
    expect(canReadProfile(profile("signed-in"), stranger)).toBe(true);
  });

  it("gives a private profile to nobody but its owner", () => {
    expect(canReadProfile(profile("private"), signedOut)).toBe(false);
    expect(canReadProfile(profile("private"), stranger)).toBe(false);
    expect(canReadProfile(profile("private"), owner)).toBe(true);
  });

  it("does not treat an empty viewer as a signed-in one", () => {
    expect(isOwner(profile("public"), {})).toBe(false);
    expect(canReadProfile(profile("signed-in"), {})).toBe(false);
  });
});

describe("which sections a reader gets", () => {
  const guarded = profile("public", { metrics: false, workplaces: true, achievements: false });

  it("hides what the person chose to hide", () => {
    expect(visibleSections(guarded, stranger)).toEqual({
      metrics: false, workplaces: true, achievements: false,
    });
    expect(withheldSections(guarded, stranger).sort()).toEqual(["achievements", "metrics"]);
  });

  it("shows the owner their own everything", () => {
    expect(visibleSections(guarded, owner)).toEqual({
      metrics: true, workplaces: true, achievements: true,
    });
    expect(withheldSections(guarded, owner)).toEqual([]);
  });

  it("hands back a copy, so a caller cannot edit somebody's settings", () => {
    const sections = visibleSections(guarded, stranger);
    sections.metrics = true;
    expect(guarded.sections.metrics).toBe(false);
  });
});

describe("what may become a share card", () => {
  it("is only ever a public profile", () => {
    expect(isShareable(profile("public"))).toBe(true);
    // A link preview in a group chat is not a signed-in reader.
    expect(isShareable(profile("signed-in"))).toBe(false);
    expect(isShareable(profile("private"))).toBe(false);
  });
});
