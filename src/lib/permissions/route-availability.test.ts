import { describe, expect, it } from "vitest";
import { ALL_NAV_SECTIONS } from "@/config/nav";
import { HTTP_LIVE_ROUTES } from "@/config/live-routes";
import { isRouteAvailable } from "./route-manifest";

describe("isRouteAvailable (plan 08)", () => {
  it("reaches every route in mock mode", () => {
    for (const path of ["/home", "/loads", "/needs-you", "/finance/settlements", "/settings/users"]) {
      expect(isRouteAvailable(path, "mock")).toBe(true);
    }
  });

  it.each([
    "/home",
    "/fleet/trucks",
    "/fleet/trucks/new",
    "/fleet/trucks/3f2a1c4e",
    "/people/drivers",
    "/people/drivers/u1",
    "/people/dispatchers",
    "/people/admins/u2",
    "/settings/invitations",
    "/settings/invitations/new",
    "/settings/permissions",
  ])("reaches %s in http mode", (path) => {
    expect(isRouteAvailable(path, "http")).toBe(true);
  });

  it.each([
    "/needs-you",
    "/work",
    "/loads",
    "/loads/l1",
    "/dispatch",
    "/fleet",
    "/fleet/trailers",
    "/documents",
    "/finance/settlements",
    "/settings/users",
    "/account/profile",
    "/driver/home",
    // a shared prefix is not a match
    "/homework",
    "/fleet/trucks-archive",
  ])("hides %s in http mode", (path) => {
    expect(isRouteAvailable(path, "http")).toBe(false);
  });

  it("only lists routes that exist in the nav, so a typo can't silently hide a page", () => {
    const navHrefs = new Set(ALL_NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href)));
    for (const route of HTTP_LIVE_ROUTES) expect(navHrefs).toContain(route);
  });
});
