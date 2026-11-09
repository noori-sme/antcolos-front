import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const logoutDueToPermissionsError = vi.fn();
vi.mock("@/lib/api/client", () => ({
  apiClient: { get: (...args: unknown[]) => get(...args) },
  logoutDueToPermissionsError: () => logoutDueToPermissionsError(),
}));
const clearPermissionCookies = vi.fn();
const setAccountKind = vi.fn();
vi.mock("@/lib/api/auth-cookies", () => ({
  clearPermissionCookies: () => clearPermissionCookies(),
  readCookie: () => undefined,
  setAccountKind: (k: unknown) => setAccountKind(k),
  setPermissionCookies: vi.fn(),
  setSessionToken: vi.fn(),
  setUserRoleFromRoleId: vi.fn(),
}));

import { fetchAndStoreUserPermissions } from "./permissions-sync";

/** An unsigned JWT with the given claims; only the payload is read client-side. */
function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(claims)}.sig`;
}

describe("fetchAndStoreUserPermissions", () => {
  beforeEach(() => {
    get.mockReset();
    logoutDueToPermissionsError.mockReset();
    clearPermissionCookies.mockReset();
    setAccountKind.mockReset();
  });

  it("drops a previous session's permission cookies and keeps the individual driver marked", async () => {
    await fetchAndStoreUserPermissions(undefined, jwt({ scope: "individual", individualRole: "DRIVER" }));
    expect(clearPermissionCookies).toHaveBeenCalled();
    // Sign-in clears the role cookie; without this the driver would not reach the driver portal.
    expect(setAccountKind).toHaveBeenCalledWith({ individualRole: "DRIVER" });
  });

  it("returns a fresh result each time, so one caller can't change another's", async () => {
    const a = await fetchAndStoreUserPermissions(undefined, jwt({ scope: "individual" }));
    const b = await fetchAndStoreUserPermissions(undefined, jwt({ scope: "individual" }));
    expect(a).not.toBe(b);
  });

  // permissions-api-contract.md "Get my permissions": individual, platform and
  // onboarding tokens → 403. An individual account has no membership, so it
  // has no organization permissions — that is not an error.
  it.each(["individual", "onboarding", "platform"])(
    "does not call /users/me/permissions or log out for a %s token",
    async (scope) => {
      const result = await fetchAndStoreUserPermissions(undefined, jwt({ scope, individualRole: "DRIVER" }));
      expect(get).not.toHaveBeenCalled();
      expect(logoutDueToPermissionsError).not.toHaveBeenCalled();
      expect(result).toEqual({ permissions: [] });
    },
  );

  it("still loads permissions for a tenant token", async () => {
    get.mockResolvedValue({ data: { roleId: "ADMIN", roleName: "Admin", permissions: ["truck.read"] } });
    const result = await fetchAndStoreUserPermissions(undefined, jwt({ scope: "tenant", organizationId: "o1" }));
    expect(get).toHaveBeenCalledWith("/users/me/permissions", expect.anything());
    expect(result).toMatchObject({ roleId: "ADMIN", permissions: ["truck.read"] });
  });

  it("still logs out when a tenant token's permissions can't be read", async () => {
    get.mockRejectedValue(new Error("403"));
    const result = await fetchAndStoreUserPermissions(undefined, jwt({ scope: "tenant" }));
    expect(result).toBeNull();
    expect(logoutDueToPermissionsError).toHaveBeenCalled();
  });
});
