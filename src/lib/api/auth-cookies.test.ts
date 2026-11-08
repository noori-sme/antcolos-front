import { beforeEach, describe, expect, it, vi } from "vitest";

const set = vi.fn();
const remove = vi.fn();
vi.mock("js-cookie", () => ({ default: { set, remove, get: vi.fn() } }));

const {
  AUTH_COOKIE, clearAllAuthCookies, clearPermissionCookies, setAccountKind, setSessionToken,
} = await import("./auth-cookies");

beforeEach(() => {
  set.mockReset();
  remove.mockReset();
});

const removed = () => remove.mock.calls.map(([name]) => name as string);

describe("clearAllAuthCookies", () => {
  it("clears every session cookie at path /", () => {
    clearAllAuthCookies();
    const expected = Object.values(AUTH_COOKIE).filter((n) => n !== AUTH_COOKIE.invitationToken);
    expect(new Set(removed())).toEqual(new Set(expected));
    for (const [, opts] of remove.mock.calls) expect(opts).toEqual({ path: "/" });
  });

  it("keeps a pending invitation, so signing out mid-acceptance does not lose it", () => {
    clearAllAuthCookies();
    expect(removed()).not.toContain(AUTH_COOKIE.invitationToken);
  });

  it("clears the carrier data the old account menu forgot", () => {
    clearAllAuthCookies();
    expect(removed()).toContain(AUTH_COOKIE.carrierData);
  });
});

describe("writes", () => {
  it("sets the token for 7 days at path / with SameSite=Lax", () => {
    setSessionToken("t");
    expect(set).toHaveBeenCalledWith(
      "antcolos_token",
      "t",
      expect.objectContaining({ path: "/", expires: 7, sameSite: "lax" }),
    );
  });

  it("an individual account drops the org cookies, and vice versa", () => {
    setAccountKind({ individualRole: "DRIVER" });
    expect(set).toHaveBeenCalledWith("antcolos_user_role", "DRIVER", expect.anything());
    expect(removed()).toEqual(["antcolos_org_type", "antcolos_org_role"]);

    remove.mockReset();
    setAccountKind({ orgType: "CARRIER", orgRole: "OWNER" });
    expect(removed()).toEqual(["antcolos_user_role"]);
  });

  it("an org account without a role clears the previous account's role", () => {
    setAccountKind({ orgType: "CARRIER" });
    expect(removed()).toContain("antcolos_org_role");
  });

  it("clearPermissionCookies leaves the token alone", () => {
    clearPermissionCookies();
    expect(removed()).not.toContain("antcolos_token");
  });
});
