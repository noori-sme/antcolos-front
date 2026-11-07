import { describe, expect, it } from "vitest";
import { isAuthPath, isPublicPath } from "./route-access";

describe("isPublicPath", () => {
  it.each([
    "/profile/jane",
    "/profile/jane/opengraph-image",
    "/profile/jane/twitter-image",
    "/profile/jane/a/first-load",
    "/shared/abc123",
    "/track/abc123",
  ])("lets %s through without a session", (path) => {
    expect(isPublicPath(path)).toBe(true);
  });

  it.each(["/home", "/fleet/trucks", "/profiles", "/tracking", "/sign-in", "/"])(
    "does not treat %s as public",
    (path) => {
      expect(isPublicPath(path)).toBe(false);
    },
  );
});

describe("isAuthPath", () => {
  it.each([
    "/sign-in",
    "/sign-up",
    "/verify-email",
    "/forgot-password",
    "/invite/tok",
    "/invitation/tok",
    "/invitations/tok",
    "/referral/tok",
  ])("treats %s as an auth page", (path) => {
    expect(isAuthPath(path)).toBe(true);
  });

  it.each(["/home", "/sign-in-help", "/profile/jane", "/track/abc"])(
    "does not treat %s as an auth page",
    (path) => {
      expect(isAuthPath(path)).toBe(false);
    },
  );
});
