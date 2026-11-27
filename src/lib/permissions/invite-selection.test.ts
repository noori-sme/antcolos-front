import { describe, expect, it } from "vitest";
import { assignableRoles, canSendBuiltInTemplate, selectionChanged } from "./invite-selection";

describe("selectionChanged", () => {
  const ticked = new Set(["load.read", "document.read", "document.create", "settlement.read"]);

  it("is false when nothing was touched, even if the preset listed a key that was dropped", () => {
    // The Driver preset lists 5 keys; a non-owner's screen drops one it cannot grant and ticks 4.
    // Comparing against the 4 it ticked, not the 5 it listed, is what keeps the built-in role.
    expect(selectionChanged(ticked, new Set(ticked))).toBe(false);
  });

  it("is true when a key is added", () => {
    expect(selectionChanged(ticked, new Set([...ticked, "load.update"]))).toBe(true);
  });

  it("is true when a key is removed", () => {
    const fewer = new Set(ticked);
    fewer.delete("settlement.read");
    expect(selectionChanged(ticked, fewer)).toBe(true);
  });

  it("is true when one key is swapped for another (same size)", () => {
    const swapped = new Set(ticked);
    swapped.delete("settlement.read");
    swapped.add("load.update");
    expect(selectionChanged(ticked, swapped)).toBe(true);
  });
});

describe("canSendBuiltInTemplate", () => {
  // The backend's built-in Driver template (system-role-templates.ts), as the roles list returns it.
  const driverTemplate = ["load.respond", "document.create", "document.read", "receipt.create"];

  it("lets an owner send the template: they hold everything", () => {
    expect(canSendBuiltInTemplate({ isOwner: true, template: driverTemplate, granter: new Set() })).toBe(true);
  });

  it("lets a non-owner who holds the whole template send it", () => {
    const granter = new Set([...driverTemplate, "truck.read"]);
    expect(canSendBuiltInTemplate({ isOwner: false, template: driverTemplate, granter })).toBe(true);
  });

  it("refuses a non-owner missing part of the template (the backend would answer 403)", () => {
    const granter = new Set(["load.respond", "document.create", "document.read"]);
    expect(canSendBuiltInTemplate({ isOwner: false, template: driverTemplate, granter })).toBe(false);
  });

  it("refuses a non-owner when the template is unknown, so the caller keeps its list", () => {
    expect(canSendBuiltInTemplate({ isOwner: false, template: undefined, granter: new Set(driverTemplate) })).toBe(false);
  });
});

describe("assignableRoles", () => {
  const roles = [
    { id: "DRIVER", name: "Driver", permissions: ["load.respond", "document.create", "document.read"] },
    { id: "ADMIN", name: "Admin", permissions: ["truck.update", "membership.manage_permissions"] },
    { id: "custom-1", name: "Driver (Custom)", permissions: ["load.read", "document.read"] },
  ];

  it("offers an owner every role", () => {
    expect(assignableRoles(roles, new Set(), true).map((r) => r.id)).toEqual(["DRIVER", "ADMIN", "custom-1"]);
  });

  it("never offers a non-owner a wildcard role, and accepts an alias key they hold", () => {
    const more = [
      { id: "SUPER", name: "Everything", permissions: ["*"] },
      // An older backend spelling of "see loads" (load.view → load.read → loads:view).
      { id: "viewer", name: "Viewer", permissions: ["load.view"] },
    ];
    expect(assignableRoles(more, new Set(["loads:view"]), false).map((r) => r.id)).toEqual(["viewer"]);
  });

  it("offers a non-owner only roles whose permissions they hold in full", () => {
    // Held as UI keys, as the session stores them.
    const granter = new Set(["loads:respond", "documents:upload", "documents:view", "loads:view"]);
    expect(assignableRoles(roles, granter, false).map((r) => r.id)).toEqual(["DRIVER", "custom-1"]);
  });
});
