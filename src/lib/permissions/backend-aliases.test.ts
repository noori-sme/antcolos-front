import { describe, expect, it } from "vitest";
import { normalizePermissionKey } from "./catalog";

describe("backend permission aliases", () => {
  it("maps membership.list_drivers to drivers:view (the Drivers page gate)", () => {
    expect(normalizePermissionKey("membership.list_drivers")).toBe("drivers:view");
  });

  it("keeps membership.list as members:view", () => {
    expect(normalizePermissionKey("membership.list")).toBe("members:view");
  });
});
