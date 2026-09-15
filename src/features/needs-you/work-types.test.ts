import { describe, expect, it } from "vitest";
import { CATEGORY_LABEL, type NeedsYouCategory } from "@/types";
import {
  CATEGORY_MODULE, MODULE_LABEL, NEEDS_YOU_MODULE_ORDER, groupWorkTypes,
} from "./work-types";

/**
 * The work-type grouping.
 *
 * The grouping is the only reason seventy-eight filters are navigable, so the
 * thing worth protecting is that every category has a home and that the panel
 * never offers a filter which cannot match anything.
 */

const ALL = Object.keys(CATEGORY_LABEL) as NeedsYouCategory[];

describe("the module map", () => {
  it("places every work type, with no orphans", () => {
    for (const category of ALL) {
      expect(CATEGORY_MODULE[category], category).toBeDefined();
    }
    expect(Object.keys(CATEGORY_MODULE).sort()).toEqual([...ALL].sort());
  });

  it("uses only modules that are in the order, and names all of them", () => {
    for (const category of ALL) {
      expect(NEEDS_YOU_MODULE_ORDER).toContain(CATEGORY_MODULE[category]);
    }
    for (const key of NEEDS_YOU_MODULE_ORDER) {
      expect(MODULE_LABEL[key]).toBeTruthy();
    }
  });

  it("has at least one work type in every module it offers", () => {
    const used = new Set(ALL.map((c) => CATEGORY_MODULE[c]));
    for (const key of NEEDS_YOU_MODULE_ORDER) {
      expect(used.has(key), key).toBe(true);
    }
  });
});

describe("groupWorkTypes", () => {
  const counts = new Map<NeedsYouCategory, number>([
    ["compliance_expiring", 3],
    ["compliance_expired", 1],
    ["invoice_overdue", 2],
  ]);

  it("offers only what the current view actually contains", () => {
    const groups = groupWorkTypes({ counts, selected: [] });
    expect(groups.map((g) => g.module)).toEqual(["compliance", "accounting"]);
    expect(groups[0].categories).toEqual(["compliance_expired", "compliance_expiring"]);
    expect(groups[0].count).toBe(4);
  });

  it("keeps a selected work type offered even when nothing on screen has it", () => {
    const groups = groupWorkTypes({ counts, selected: ["detention"] });
    const tracking = groups.find((g) => g.module === "tracking");
    expect(tracking?.categories).toEqual(["detention"]);
    expect(tracking?.count).toBe(0);
  });

  it("searches on the work type's own label", () => {
    const groups = groupWorkTypes({ counts, selected: [], query: "invoice" });
    expect(groups.map((g) => g.module)).toEqual(["accounting"]);
    expect(groups[0].categories).toEqual(["invoice_overdue"]);
  });

  it("searches on the module name too, so “compliance” finds its group", () => {
    const groups = groupWorkTypes({ counts, selected: [], query: "safety" });
    expect(groups.map((g) => g.module)).toEqual(["compliance"]);
    expect(groups[0].categories).toHaveLength(2);
  });

  it("returns nothing rather than everything when a search matches nothing", () => {
    expect(groupWorkTypes({ counts, selected: [], query: "zzzz" })).toEqual([]);
  });

  it("keeps the nav's order, not the alphabet's", () => {
    const every = new Map(ALL.map((c) => [c, 1] as const));
    const groups = groupWorkTypes({ counts: every, selected: [] });
    expect(groups.map((g) => g.module)).toEqual([...NEEDS_YOU_MODULE_ORDER]);
  });
});
