import { describe, expect, it } from "vitest";
import {
  absoluteAchievementUrl, absoluteProfileUrl, achievementPath, displayHandle,
  profilePath, usernameFromSegment,
} from "./identity";

describe("reading a username out of a URL segment", () => {
  it("accepts the three forms people actually paste", () => {
    expect(usernameFromSegment("sam_murtaza")).toBe("sam_murtaza");
    expect(usernameFromSegment("@sam_murtaza")).toBe("sam_murtaza");
    expect(usernameFromSegment("%40sam_murtaza")).toBe("sam_murtaza");
  });

  it("folds case, because phone keyboards capitalize", () => {
    expect(usernameFromSegment("Sam_Murtaza")).toBe("sam_murtaza");
    expect(usernameFromSegment("@SAM_MURTAZA")).toBe("sam_murtaza");
  });

  it("refuses anything that could not be a username, rather than guessing", () => {
    expect(usernameFromSegment("")).toBeNull();
    expect(usernameFromSegment("   ")).toBeNull();
    expect(usernameFromSegment("ab")).toBeNull();
    expect(usernameFromSegment("9lives")).toBeNull();
    expect(usernameFromSegment("trailing_")).toBeNull();
    expect(usernameFromSegment("has space")).toBeNull();
    expect(usernameFromSegment("has.dot")).toBeNull();
    expect(usernameFromSegment("a".repeat(21))).toBeNull();
  });

  it("refuses a segment that cannot be decoded instead of throwing", () => {
    expect(usernameFromSegment("%E0%A4%A")).toBeNull();
  });

  it("does not let a path traversal through", () => {
    expect(usernameFromSegment("..%2Fadmin")).toBeNull();
    expect(usernameFromSegment("../../etc")).toBeNull();
  });
});

describe("the canonical addresses", () => {
  it("builds the one profile path", () => {
    expect(profilePath("sam_murtaza")).toBe("/profile/sam_murtaza");
    expect(displayHandle("sam_murtaza")).toBe("@sam_murtaza");
  });

  it("encodes the achievement key, which is not a username", () => {
    expect(achievementPath("sam_murtaza", "dispatch.loads.100"))
      .toBe("/profile/sam_murtaza/a/dispatch.loads.100");
  });

  it("never doubles the slash when the origin carries one", () => {
    expect(absoluteProfileUrl("https://antcolos.com/", "sam_murtaza"))
      .toBe("https://antcolos.com/profile/sam_murtaza");
    expect(absoluteAchievementUrl("https://antcolos.com//", "sam_murtaza", "tenure.year.1"))
      .toBe("https://antcolos.com/profile/sam_murtaza/a/tenure.year.1");
  });
});
