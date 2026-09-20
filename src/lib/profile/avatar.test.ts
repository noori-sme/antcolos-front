import { describe, expect, it } from "vitest";
import {
  AVATAR_ACCEPTED_TYPES, AVATAR_ACCEPT_ATTRIBUTE, AVATAR_MAX_BYTES,
  avatarInitials, formatBytes, validateAvatar,
} from "./avatar";

describe("what may be uploaded", () => {
  it("accepts the three raster formats", () => {
    for (const type of AVATAR_ACCEPTED_TYPES) {
      expect(validateAvatar({ type, size: 120_000 })).toBeNull();
    }
  });

  it("refuses SVG, which would be an executable document on our own origin", () => {
    expect(validateAvatar({ type: "image/svg+xml", size: 2_000 }))
      .toBe("Use a PNG, JPEG or WebP image.");
    expect(AVATAR_ACCEPT_ATTRIBUTE).not.toContain("svg");
  });

  it("refuses an empty file before it refuses its type", () => {
    expect(validateAvatar({ type: "image/png", size: 0 })).toBe("That file is empty.");
  });

  it("names both the size and the limit when a file is too big", () => {
    const message = validateAvatar({ type: "image/png", size: AVATAR_MAX_BYTES + 1 });
    expect(message).toContain("4.0 MB");
  });

  it("allows a file exactly at the limit", () => {
    expect(validateAvatar({ type: "image/png", size: AVATAR_MAX_BYTES })).toBeNull();
  });
});

describe("the fallback initials", () => {
  it("takes the first letter of the first two words", () => {
    expect(avatarInitials("Sam Murtaza")).toBe("SM");
    expect(avatarInitials("  maria  del  carmen  ruiz ")).toBe("MD");
    expect(avatarInitials("Cher")).toBe("C");
  });

  it("does not split a character in half", () => {
    expect(avatarInitials("Łukasz Żółć")).toBe("ŁŻ");
    expect(avatarInitials("日本 太郎")).toBe("日太");
  });

  it("has something to render for a name that is not there yet", () => {
    expect(avatarInitials("")).toBe("?");
    expect(avatarInitials("   ")).toBe("?");
  });
});

describe("byte sizes as people read them", () => {
  it("scales the unit", () => {
    expect(formatBytes(900)).toBe("900 bytes");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3_500_000)).toBe("3.3 MB");
  });
});
