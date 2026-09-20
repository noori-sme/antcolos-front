import { describe, expect, it } from "vitest";
import type { ProfileContribution, UserProfile, WorkplaceAssociation } from "@/types";
import { buildProfileView, meteredCapacitiesOf, type ProfileRecords } from "./view";

const AS_OF = "2026-09-20T00:00:00.000Z";

const profile: UserProfile = {
  userId: "usr_sam",
  username: "sam_murtaza",
  fullName: "Sam Murtaza",
  headline: "Dispatcher",
  links: [],
  visibility: "public",
  sections: { metrics: true, workplaces: true, achievements: true },
  verifications: [],
  joinedAt: "2024-09-20T00:00:00.000Z",
  updatedAt: AS_OF,
};

const association = (
  id: string,
  capacity: WorkplaceAssociation["capacity"],
  startedAt: string,
  endedAt?: string,
): WorkplaceAssociation => ({
  id,
  userId: "usr_sam",
  organizationId: `org_${id}`,
  organizationNameSnapshot: `Org ${id}`,
  organizationType: "CARRIER",
  capacity,
  startedAt,
  endedAt,
  verified: true,
});

const contribution = (
  capacity: ProfileContribution["capacity"],
  kind: ProfileContribution["kind"],
  value: number,
): ProfileContribution => ({
  id: `pc_${capacity}_${kind}_${value}`,
  userId: "usr_sam",
  organizationId: "org_a",
  organizationNameSnapshot: "Org a",
  capacity,
  kind,
  value,
  occurredAt: "2026-03-01T00:00:00.000Z",
});

function records(overrides: Partial<ProfileRecords> = {}): ProfileRecords {
  return {
    profile,
    associations: [association("a", "dispatcher", "2025-01-01T00:00:00.000Z")],
    contributions: [contribution("dispatcher", "load_dispatched", 140)],
    conferred: [],
    ...overrides,
  };
}

describe("assembling the view", () => {
  it("orders workplace history newest first", () => {
    const view = buildProfileView(records({
      associations: [
        association("old", "driver", "2023-01-01T00:00:00.000Z", "2024-06-01T00:00:00.000Z"),
        association("new", "dispatcher", "2026-02-01T00:00:00.000Z"),
      ],
    }), null, AS_OF);
    expect(view?.workplaces?.map((w) => w.id)).toEqual(["new", "old"]);
  });

  it("builds a grid for each capacity that was actually worked in", () => {
    const view = buildProfileView(records({
      associations: [
        association("a", "dispatcher", "2025-01-01T00:00:00.000Z"),
        association("b", "driver", "2024-01-01T00:00:00.000Z"),
        association("c", "safety", "2023-01-01T00:00:00.000Z"),
      ],
    }), null, AS_OF);
    // Safety has no scoreboard, so it produces no grid and no empty one.
    expect(view?.metrics?.map((m) => m.capacity)).toEqual(["dispatcher", "driver"]);
  });

  it("counts work posted before an association was opened", () => {
    expect(meteredCapacitiesOf(records({
      associations: [],
      contributions: [contribution("driver", "miles_driven", 900)],
    }))).toEqual(["driver"]);
  });

  it("derives achievements from the same ledger the metrics came from", () => {
    const view = buildProfileView(records(), null, AS_OF);
    expect(view?.achievements?.map((a) => a.key)).toContain("dispatch.loads.100");
  });
});

describe("what a reader is not given", () => {
  it("omits a hidden section rather than sending an empty one", () => {
    const guarded = {
      ...profile,
      sections: { metrics: false, workplaces: true, achievements: true },
    };
    const view = buildProfileView(records({ profile: guarded }), null, AS_OF);
    expect(view?.metrics).toBeUndefined();
    expect(view?.withheld).toEqual(["metrics"]);
    // The section that was left on still arrives.
    expect(view?.workplaces).toHaveLength(1);
  });

  it("gives the owner their own hidden sections back", () => {
    const guarded = {
      ...profile,
      sections: { metrics: false, workplaces: false, achievements: false },
    };
    const view = buildProfileView(records({ profile: guarded }), { userId: "usr_sam" }, AS_OF);
    expect(view?.isOwner).toBe(true);
    expect(view?.metrics).toBeDefined();
    expect(view?.withheld).toEqual([]);
  });

  it("answers nothing at all for a private profile", () => {
    const hidden = { ...profile, visibility: "private" as const };
    expect(buildProfileView(records({ profile: hidden }), null, AS_OF)).toBeNull();
    expect(buildProfileView(records({ profile: hidden }), { userId: "usr_other" }, AS_OF)).toBeNull();
    expect(buildProfileView(records({ profile: hidden }), { userId: "usr_sam" }, AS_OF)).not.toBeNull();
  });

  it("still reports tenure for a profile with every section hidden", () => {
    const guarded = {
      ...profile,
      sections: { metrics: false, workplaces: false, achievements: false },
    };
    const view = buildProfileView(records({ profile: guarded }), null, AS_OF);
    expect(view?.tenure.daysOnPlatform).toBe(730);
  });
});
