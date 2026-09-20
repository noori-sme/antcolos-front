import { describe, expect, it } from "vitest";
import { publishedRecords, publishedRecordsForUser, publishedUsernames } from "./published";
import { buildProfileView } from "./view";

const AS_OF = "2026-09-20T00:00:00.000Z";

describe("the seeded demo profile", () => {
  const records = publishedRecords("sam_murtaza");

  it("exists, and is reachable by handle and by user id", () => {
    expect(records).not.toBeNull();
    expect(publishedRecordsForUser("usr_sam")?.profile.username).toBe("sam_murtaza");
    expect(publishedUsernames()).toContain("sam_murtaza");
  });

  it("keeps a job that ended, because history outlives the membership", () => {
    const ended = records!.associations.filter((a) => a.endedAt);
    expect(ended).toHaveLength(1);
    expect(ended[0].organizationNameSnapshot).toBe("SME Transport Group LLC");
  });

  it("adds up to the badges the demo is supposed to show", () => {
    const view = buildProfileView(records!, null, AS_OF)!;
    const keys = view.achievements!.map((a) => a.key);
    expect(keys).toEqual(expect.arrayContaining([
      "dispatch.loads.100",
      "dispatch.revenue.1m",
      "driver.loads.100",
      "driver.miles.100k",
      "driver.safety.5star",
      "dispatch.top.quarter",
    ]));
  });

  it("has a safety score that could not only ever have been 100", () => {
    const view = buildProfileView(records!, null, AS_OF)!;
    const driver = view.metrics!.find((m) => m.capacity === "driver");
    expect(driver).toMatchObject({ capacity: "driver", safetyScore: 98 });
  });

  it("has not been here a year yet, so the tenure badge is not awarded early", () => {
    const view = buildProfileView(records!, null, AS_OF)!;
    expect(view.achievements!.map((a) => a.key)).not.toContain("tenure.year.1");
    // ...and is awarded the moment it is a year, with nothing else changing.
    const later = buildProfileView(records!, null, "2026-11-05T00:00:00.000Z")!;
    expect(later.achievements!.map((a) => a.key)).toContain("tenure.year.1");
  });

  it("hands out copies, so one reader cannot edit the seed for the next", () => {
    const first = publishedRecords("sam_murtaza")!;
    first.profile.fullName = "Somebody Else";
    expect(publishedRecords("sam_murtaza")!.profile.fullName).toBe("Sam Murtaza");
  });
});

describe("the seeded newcomer profile", () => {
  const records = publishedRecords("alex_rivera")!;

  it("is a real record with nothing in it yet", () => {
    expect(records.associations).toHaveLength(0);
    expect(records.contributions).toHaveLength(0);
    const view = buildProfileView(records, null, AS_OF)!;
    expect(view.achievements).toEqual([]);
    expect(view.metrics).toEqual([]);
    expect(view.tenure.daysOnPlatform).toBe(4);
  });

  it("does not inherit the demo account's conferred award", () => {
    expect(records.conferred).toHaveLength(0);
  });
});

describe("a handle nobody holds", () => {
  it("answers nothing", () => {
    expect(publishedRecords("nobody_here")).toBeNull();
    expect(publishedRecordsForUser("usr_nobody")).toBeNull();
  });
});
