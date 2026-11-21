import { describe, expect, it } from "vitest";
import type { TruckAvailability } from "@/types/fleet-availability";
import { BUCKET_ORDER, emptyIn, emptyPlace, groupByBucket } from "./availability";

const row = (extras: Partial<TruckAvailability>): TruckAvailability => ({
  truckId: "t", unitNumber: "1", equipmentType: "DRY_VAN", operationalStatus: "AVAILABLE",
  bucket: "AVAILABLE_NOW", estimatedEmptyAt: null, emptyCity: null, emptyState: null,
  activeLoadId: null, ...extras,
});

describe("availability board", () => {
  it("groups by bucket in board order and keeps the API order inside a group", () => {
    const groups = groupByBucket([
      row({ truckId: "a", bucket: "WITHIN_5H" }),
      row({ truckId: "b", bucket: "AVAILABLE_NOW" }),
      row({ truckId: "c", bucket: "WITHIN_5H" }),
    ]);
    expect([...groups.keys()]).toEqual(BUCKET_ORDER);
    expect(groups.get("WITHIN_5H")!.map((r) => r.truckId)).toEqual(["a", "c"]);
    expect(groups.get("MAINTENANCE")).toEqual([]);
  });

  it("says where the truck will be empty", () => {
    expect(emptyPlace({ emptyCity: "Dallas", emptyState: "TX" })).toBe("Dallas, TX");
    expect(emptyPlace({ emptyCity: "Dallas", emptyState: null })).toBe("Dallas");
    expect(emptyPlace({ emptyCity: null, emptyState: null })).toBeNull();
  });

  it("says when, relative to now", () => {
    const now = new Date("2026-11-21T12:00:00Z");
    expect(emptyIn(null, now)).toBeNull();
    expect(emptyIn("2026-11-21T12:45:00Z", now)).toBe("in 45 min");
    expect(emptyIn("2026-11-21T15:20:00Z", now)).toBe("in 3 h 20 min");
    expect(emptyIn("2026-11-21T14:00:00Z", now)).toBe("in 2 h");
    expect(emptyIn("2026-11-23T12:00:00Z", now)).toBe("in 2 d");
    expect(emptyIn("2026-11-21T11:00:00Z", now)).toBe("overdue");
    expect(emptyIn("not a date", now)).toBeNull();
  });
});
