import { describe, expect, it } from "vitest";
import {
  BUCKET_ORDER, bucketLabel, emptyInText, groupByBucket, predictionErrorText,
} from "./availability";
import type { TruckAvailability } from "@/types/fleet-truck";

const NOW = new Date("2026-11-21T12:00:00.000Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

describe("emptyInText", () => {
  it("says nothing useful is known when there is no time", () => {
    expect(emptyInText(null, NOW)).toBeNull();
  });
  it("counts down in minutes, then hours and minutes", () => {
    expect(emptyInText(at(0), NOW)).toBe("Now");
    expect(emptyInText(at(45), NOW)).toBe("In 45 min");
    expect(emptyInText(at(60), NOW)).toBe("In 1 h");
    expect(emptyInText(at(200), NOW)).toBe("In 3 h 20 min");
    expect(emptyInText(at(300), NOW)).toBe("In 5 h");
  });
  it("says overdue when the time has passed", () => {
    expect(emptyInText(at(-70), NOW)).toBe("Overdue by 1 h 10 min");
  });
  it("rounds sub-minute differences instead of showing seconds", () => {
    expect(emptyInText(new Date(NOW.getTime() + 20_000).toISOString(), NOW)).toBe("Now");
  });
});

describe("predictionErrorText", () => {
  it("covers delivered, late, early and on time", () => {
    expect(predictionErrorText(null)).toBe("Not delivered yet");
    expect(predictionErrorText(42)).toBe("42 min late");
    expect(predictionErrorText(-70)).toBe("1 h 10 min early");
    expect(predictionErrorText(5)).toBe("On time");
    expect(predictionErrorText(-5)).toBe("On time");
    expect(predictionErrorText(6)).toBe("6 min late");
  });
});

describe("buckets", () => {
  it("labels every bucket", () => {
    for (const bucket of BUCKET_ORDER) expect(bucketLabel(bucket)).toMatch(/\w/);
  });

  it("groups rows in board order, keeps the API's order inside a group, skips empty groups", () => {
    const row = (truckId: string, bucket: TruckAvailability["bucket"]): TruckAvailability => ({
      truckId, bucket, estimatedEmptyAt: null, emptyCity: null, emptyState: null, activeLoadId: null,
    });
    const groups = groupByBucket([
      row("t3", "LATER"), row("t1", "AVAILABLE_NOW"), row("t4", "LATER"), row("t2", "WITHIN_5H"),
    ]);
    expect(groups.map((g) => g.bucket)).toEqual(["AVAILABLE_NOW", "WITHIN_5H", "LATER"]);
    expect(groups[2].rows.map((r) => r.truckId)).toEqual(["t3", "t4"]);
  });
});
