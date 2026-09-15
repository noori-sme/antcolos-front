import { describe, expect, it } from "vitest";
import type { NeedsYouItem } from "@/types";
import {
  OPEN_STATUSES, activeFilterCount, activeFilterTokens, categoryCounts,
  defaultQuery, sortItems, statusIsDefault, toggleIn, type NeedsYouQuery,
} from "./query";

/**
 * The filter state, tested where it is decided.
 *
 * The toolbar, the panel and the summary all read these functions, so this is
 * the one place that has to agree with itself: what counts as active, what
 * "remove this one" does, and what a sort is allowed to change.
 */

function item(over: Partial<NeedsYouItem> = {}): NeedsYouItem {
  return {
    id: "ny_1",
    organizationId: "org_1",
    category: "compliance_expiring",
    severity: "medium",
    status: "open",
    title: "A thing",
    reason: "Because",
    entity: { kind: "truck", id: "t1", label: "Truck 1" },
    recommendedAction: { kind: "review", label: "Review", requires: [] },
    source: "system",
    requires: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    history: [],
    ...over,
  };
}

describe("the default page state", () => {
  it("is My Needs You + Open, and counts as no filters", () => {
    const q = defaultQuery();
    expect(q.filters.status).toEqual([...OPEN_STATUSES]);
    expect(q.filters.owner).toBe("all");
    expect(q.assignment).toEqual([]);
    expect(q.sort).toBe("urgency");
    expect(activeFilterCount(q)).toBe(0);
    expect(activeFilterTokens(q)).toEqual([]);
  });

  it("treats escalated as open, because escalating does not close anything", () => {
    expect(statusIsDefault(["open", "escalated"])).toBe(true);
    expect(statusIsDefault(["escalated", "open"])).toBe(true);
    expect(statusIsDefault(["open"])).toBe(false);
    expect(statusIsDefault(undefined)).toBe(false);
  });

  it("hands back a fresh object each time, so one page cannot poison the next", () => {
    const a = defaultQuery();
    a.filters.status!.push("resolved");
    expect(defaultQuery().filters.status).toEqual([...OPEN_STATUSES]);
  });
});

describe("the active-filter summary", () => {
  const base = defaultQuery();

  it("names severity, due time, work type and search", () => {
    const q: NeedsYouQuery = {
      ...base,
      filters: {
        ...base.filters,
        severity: ["critical"],
        dueWithinHours: 24,
        category: ["compliance_expiring"],
        search: "reefer",
      },
    };
    expect(activeFilterTokens(q).map((t) => t.label)).toEqual([
      "Critical", "Today", "Compliance expiring", "“reefer”",
    ]);
  });

  it("says nothing about a status selection that is the default", () => {
    expect(activeFilterCount(base)).toBe(0);
    const narrowed: NeedsYouQuery = {
      ...base, filters: { ...base.filters, status: ["resolved"] },
    };
    expect(activeFilterTokens(narrowed).map((t) => t.label)).toEqual(["Resolved"]);
  });

  it("gives every status cleared a token, so it can be put back", () => {
    const none: NeedsYouQuery = { ...base, filters: { ...base.filters, status: [] } };
    const tokens = activeFilterTokens(none);
    expect(tokens.map((t) => t.label)).toEqual(["Any status"]);
    expect(tokens[0].remove.filters.status).toEqual([...OPEN_STATUSES]);
  });

  it("names the responsibility states rather than calling anything unassigned", () => {
    const q: NeedsYouQuery = {
      ...base, assignment: ["owner_fallback", "needs_assignment"],
    };
    expect(activeFilterTokens(q).map((t) => t.label)).toEqual([
      "Owner fallback", "Needs assignment",
    ]);
  });

  it("can clear one token without disturbing the others", () => {
    const q: NeedsYouQuery = {
      ...base,
      filters: { ...base.filters, severity: ["critical", "high"], search: "reefer" },
    };
    const tokens = activeFilterTokens(q);
    const next = tokens.find((t) => t.label === "Critical")!.remove;
    expect(next.filters.severity).toEqual(["high"]);
    expect(next.filters.search).toBe("reefer");
    expect(next.filters.status).toEqual([...OPEN_STATUSES]);
  });

  it("drops the key entirely when the last value in a list goes", () => {
    const q: NeedsYouQuery = {
      ...base, filters: { ...base.filters, severity: ["critical"] },
    };
    expect(activeFilterTokens(q)[0].remove.filters.severity).toBeUndefined();
  });

  it("still offers a way out of a legacy owner=unassigned deep link", () => {
    const q: NeedsYouQuery = {
      ...base, filters: { ...base.filters, owner: "unassigned" },
    };
    const tokens = activeFilterTokens(q);
    expect(tokens.map((t) => t.label)).toEqual(["No assignee"]);
    expect(tokens[0].remove.filters.owner).toBe("all");
  });

  it("does not count the sort, which hides nothing", () => {
    expect(activeFilterCount({ ...base, sort: "newest" })).toBe(0);
  });
});

describe("toggleIn", () => {
  it("adds, removes, and collapses an empty list to undefined", () => {
    expect(toggleIn<string>(undefined, "a")).toEqual(["a"]);
    expect(toggleIn(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleIn(["a", "b"], "a")).toEqual(["b"]);
    expect(toggleIn(["a"], "a")).toBeUndefined();
  });
});

describe("sorting", () => {
  const a = item({ id: "a", dueAt: "2026-01-03T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z" });
  const b = item({ id: "b", dueAt: "2026-01-02T00:00:00.000Z", createdAt: "2026-01-05T00:00:00.000Z" });
  const c = item({ id: "c", createdAt: "2026-01-03T00:00:00.000Z" });

  it("leaves Most urgent exactly as the service ranked it", () => {
    expect(sortItems([a, b, c], "urgency").map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("puts the nearest deadline first, and no deadline last", () => {
    expect(sortItems([a, b, c], "due").map((i) => i.id)).toEqual(["b", "a", "c"]);
  });

  it("sorts newest first", () => {
    expect(sortItems([a, b, c], "newest").map((i) => i.id)).toEqual(["b", "c", "a"]);
  });

  it("never adds or drops an item", () => {
    for (const sort of ["urgency", "due", "newest"] as const) {
      expect(sortItems([a, b, c], sort)).toHaveLength(3);
    }
  });

  it("does not mutate the list it was given", () => {
    const list = [a, b, c];
    sortItems(list, "newest");
    expect(list.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });
});

describe("categoryCounts", () => {
  it("counts each work type once per item", () => {
    const counts = categoryCounts([
      item({ category: "compliance_expiring" }),
      item({ category: "compliance_expiring" }),
      item({ category: "invoice_overdue" }),
    ]);
    expect(counts.get("compliance_expiring")).toBe(2);
    expect(counts.get("invoice_overdue")).toBe(1);
    expect(counts.get("detention")).toBeUndefined();
  });
});
