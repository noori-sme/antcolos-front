import { describe, expect, it } from "vitest";
import { hasOrganizationPermissions, issuesSessionToken, sessionTokenFrom, sessionTokenScope } from "./session-token";

describe("issuesSessionToken", () => {
  it.each([
    "/auth/login",
    "/auth/signup",
    "/auth/verify-email",
    "/auth/select-role",
    "/auth/carrier-onboarding",
    "/auth/company-details",
    "/auth/verify-carrier",
    "/invitations/accept/abc",
    "https://api.example.com/api/v1/auth/login?x=1",
  ])("lets %s set the session", (url) => {
    expect(issuesSessionToken(url)).toBe(true);
  });

  it.each([
    "/organizations/invitations",
    "/invitations/reject/abc",
    "/auth/resend-verification",
    "/trucks",
    "/users/me/permissions",
    "/shared/abc",
  ])("does not let %s set the session", (url) => {
    expect(issuesSessionToken(url)).toBe(false);
  });
});

describe("sessionTokenFrom", () => {
  it("reads the token from the top level or under data", () => {
    expect(sessionTokenFrom("/auth/login", { accessToken: "a" })).toBe("a");
    expect(sessionTokenFrom("/auth/login", { data: { token: "b" } })).toBe("b");
    expect(sessionTokenFrom("/invitations/accept/x", { data: { access_token: "c" } })).toBe("c");
  });

  it("prefers accessToken over a plain token", () => {
    expect(sessionTokenFrom("/auth/login", { token: "t", accessToken: "a" })).toBe("a");
  });

  it("ignores the invitation token returned when an admin sends an invitation", () => {
    expect(
      sessionTokenFrom("/organizations/invitations", { data: { id: "inv_1", token: "invite-token" } }),
    ).toBeUndefined();
  });

  it("ignores empty and non-string values", () => {
    expect(sessionTokenFrom("/auth/login", { token: "" })).toBeUndefined();
    expect(sessionTokenFrom("/auth/login", { token: 42 })).toBeUndefined();
    expect(sessionTokenFrom("/auth/login", null)).toBeUndefined();
  });
});

describe("sessionTokenScope / hasOrganizationPermissions", () => {
  const jwt = (claims: Record<string, unknown>) =>
    `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

  it("reads the scope claim", () => {
    expect(sessionTokenScope(jwt({ scope: "individual" }))).toBe("individual");
    expect(sessionTokenScope(jwt({ scope: "tenant", organizationId: "o1" }))).toBe("tenant");
  });

  it("is undefined for a missing, malformed or scope-less token", () => {
    expect(sessionTokenScope(undefined)).toBeUndefined();
    expect(sessionTokenScope("not-a-jwt")).toBeUndefined();
    expect(sessionTokenScope("a.%%%.c")).toBeUndefined();
    expect(sessionTokenScope(jwt({ sub: "u1" }))).toBeUndefined();
  });

  it("only tenant (or unreadable) tokens have organization permissions", () => {
    expect(hasOrganizationPermissions(jwt({ scope: "tenant" }))).toBe(true);
    expect(hasOrganizationPermissions("legacy")).toBe(true);
    for (const scope of ["individual", "onboarding", "platform"]) {
      expect(hasOrganizationPermissions(jwt({ scope }))).toBe(false);
    }
  });
});
