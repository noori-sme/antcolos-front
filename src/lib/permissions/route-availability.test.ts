import { describe, expect, it } from "vitest";
import { ALL_NAV_SECTIONS } from "@/config/nav";
import { HTTP_LIVE_ROUTES } from "@/config/live-routes";
import { isDemoRoute, isRouteAvailable } from "./route-manifest";

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
    "/account/profile",
  ])("reaches %s in http mode", (path) => {
    expect(isRouteAvailable(path, "http", false)).toBe(true);
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
    "/account/referrals",
    "/driver/home",
    // a shared prefix is not a match
    "/homework",
    "/fleet/trucks-archive",
  ])("hides %s in http mode", (path) => {
    expect(isRouteAvailable(path, "http", false)).toBe(false);
  });

  it("only lists routes that exist in the nav, so a typo can't silently hide a page", () => {
    const navHrefs = new Set(ALL_NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href)));
    for (const route of HTTP_LIVE_ROUTES) expect(navHrefs).toContain(route);
  });
});

describe("demo areas (plan 10)", () => {
  it.each(["/needs-you", "/loads", "/loads/l1", "/finance/settlements", "/driver/home"])(
    "reaches %s in http mode with demo areas on, as a demo route",
    (path) => {
      expect(isRouteAvailable(path, "http", true)).toBe(true);
      expect(isDemoRoute(path, "http", true)).toBe(true);
    },
  );

  it.each(["/fleet/trucks", "/fleet/trucks/new", "/people/drivers", "/settings/permissions"])(
    "keeps %s live (not a demo route) with demo areas on",
    (path) => {
      expect(isRouteAvailable(path, "http", true)).toBe(true);
      expect(isDemoRoute(path, "http", true)).toBe(false);
    },
  );

  it("keeps Home a live route: HomeGate picks the demo dashboard itself, after the driver check", () => {
    expect(isDemoRoute("/home", "http", true)).toBe(false);
  });

  it("has no demo routes in mock mode or with demo areas off", () => {
    expect(isDemoRoute("/loads", "mock", true)).toBe(false);
    expect(isDemoRoute("/loads", "http", false)).toBe(false);
    expect(isDemoRoute("/home", "http", false)).toBe(false);
  });
});
