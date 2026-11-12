import { describe, expect, it } from "vitest";
import type { SessionContextValue } from "./provider";
import { buildDemoSession, demoPermissions } from "./demo-session";
import { MOCK_USER } from "./fixtures";

const real = {
  user: { ...MOCK_USER, id: "u_real", displayName: "Ayesha Khan", email: "ayesha@acme.test" },
  memberships: [],
  organizations: [],
  activeMembership: { id: "org:acme", organizationId: "acme" },
  activeOrganization: { id: "acme", displayName: "Acme Haulage" },
  permissions: new Set(["trucks:view"]),
  isDriverMembership: false,
  isDriverAccount: false,
  density: "comfortable",
  setDensity: () => {},
  switchOrganization: () => {},
} as unknown as SessionContextValue;

describe("demo session (plan 10)", () => {
  const demo = buildDemoSession(real);

  it("points the page at the Northline demo data", () => {
    expect(demo.activeMembership?.id).toBe("mem_northline_owner");
    expect(demo.activeOrganization?.id).toBe("org_northline");
    expect(demo.user.id).toBe(MOCK_USER.id);
  });

  it("keeps the real organization name and the real person", () => {
    expect(demo.activeOrganization?.displayName).toBe("Acme Haulage");
    expect(demo.user.displayName).toBe("Ayesha Khan");
    expect(demo.user.email).toBe("ayesha@acme.test");
    expect(demo.switchOrganization).toBe(real.switchOrganization);
  });

  it("uses the Northline owner's permissions, not the real ones", () => {
    expect(demo.permissions).toBe(demoPermissions());
    expect(demo.permissions.has("loads:view")).toBe(true);
    expect(demo.isDriverMembership).toBe(false);
  });

  it("falls back to the demo company's name before the real organization loads", () => {
    const early = buildDemoSession({ ...real, activeOrganization: null });
    expect(early.activeOrganization?.displayName).toBe("Northline Freight");
  });
});
