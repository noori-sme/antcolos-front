import { beforeEach, describe, expect, it } from "vitest";
import type { ServiceContext } from "../contracts/context";
import {
  NotProfileOwnerError, ProfileAlreadyInitializedError, ProfileInputError,
  AvatarRejectedError,
} from "../contracts/profile";
import { mockProfileService as profiles } from "./profile";
import { resetProfileStore } from "./profile-store";

const SAM = { userId: "usr_sam" };
const ALEX = { userId: "usr_newcomer" };
const STRANGER = { userId: "usr_stranger" };
const SIGNED_OUT = null;

/** Posting work is the one organization-scoped write on this service. */
const meridian = {
  organizationId: "org_meridian",
  organizationName: "Meridian Dispatch",
  workspaceKind: "dispatch_agency",
  membershipId: "mem_meridian_dispatcher",
  permissions: new Set(),
  scope: { loads: "all", financials: "all" },
  actor: {
    userId: "usr_sam",
    membershipId: "mem_meridian_dispatcher",
    displayNameSnapshot: "Sam Murtaza",
    source: "web",
  },
} as unknown as ServiceContext;

beforeEach(() => {
  resetProfileStore();
});

describe("reading a profile by handle", () => {
  it("serves a public profile to a signed-out stranger", async () => {
    const view = await profiles.getByUsername(SIGNED_OUT, "sam_murtaza");
    expect(view?.profile.fullName).toBe("Sam Murtaza");
    expect(view?.isOwner).toBe(false);
  });

  it("accepts a handle in whatever case it was typed", async () => {
    expect(await profiles.getByUsername(SIGNED_OUT, "  SAM_MURTAZA ")).not.toBeNull();
  });

  it("answers the same nothing for a missing handle and a hidden profile", async () => {
    await profiles.setVisibility(SAM, {
      visibility: "private",
      sections: { metrics: true, workplaces: true, achievements: true },
    });
    const hidden = await profiles.getByUsername(STRANGER, "sam_murtaza");
    const missing = await profiles.getByUsername(STRANGER, "nobody_here");
    expect(hidden).toBeNull();
    expect(missing).toBeNull();
  });

  it("still gives the owner their own private profile", async () => {
    await profiles.setVisibility(SAM, {
      visibility: "private",
      sections: { metrics: true, workplaces: true, achievements: true },
    });
    expect(await profiles.getByUsername(SAM, "sam_murtaza")).not.toBeNull();
    expect((await profiles.getOwn(SAM))?.isOwner).toBe(true);
  });

  it("withholds a hidden section from a stranger and names what it withheld", async () => {
    await profiles.setVisibility(SAM, {
      visibility: "public",
      sections: { metrics: false, workplaces: true, achievements: true },
    });
    const view = await profiles.getByUsername(STRANGER, "sam_murtaza");
    expect(view?.metrics).toBeUndefined();
    expect(view?.withheld).toEqual(["metrics"]);
    expect(view?.workplaces?.length).toBeGreaterThan(0);
  });

  it("carries a job that ended, because history is not the employer's to erase", async () => {
    const view = await profiles.getByUsername(SIGNED_OUT, "sam_murtaza");
    const ended = view?.workplaces?.filter((w) => w.endedAt) ?? [];
    expect(ended.map((w) => w.organizationNameSnapshot)).toContain("SME Transport Group LLC");
  });
});

describe("initialization — signup step 2", () => {
  it("completes the record the account was created with", async () => {
    const profile = await profiles.initialize(ALEX, {
      fullName: "Alex Rivera",
      headline: "Dispatcher, dry van",
    });
    expect(profile.username).toBe("alex_rivera");
    expect(profile.completedAt).toBeDefined();
    // The joined date is the ACCOUNT's, not this moment's.
    expect(profile.joinedAt).toBe("2026-09-16T00:00:00.000Z");
  });

  it("creates the record even when the avatar is skipped", async () => {
    const profile = await profiles.initialize(ALEX, { fullName: "Alex Rivera" });
    expect(profile.avatarUrl).toBeUndefined();
    expect(profile.userId).toBe("usr_newcomer");
  });

  it("leaves the step unfinished when somebody skips out of it", async () => {
    const profile = await profiles.initialize(ALEX, {
      fullName: "Alex Rivera",
      completed: false,
    });
    expect(profile.completedAt).toBeUndefined();
    // ...and finishing it later still works.
    const finished = await profiles.initialize(ALEX, { fullName: "Alex Rivera" });
    expect(finished.completedAt).toBeDefined();
  });

  it("refuses to run twice on a finished profile, which is how a handle would change", async () => {
    await expect(profiles.initialize(SAM, { fullName: "Someone Else", username: "someone" }))
      .rejects.toBeInstanceOf(ProfileAlreadyInitializedError);
    expect((await profiles.getOwn(SAM))?.profile.username).toBe("sam_murtaza");
  });

  it("refuses a name it could not store", async () => {
    await expect(profiles.initialize(ALEX, { fullName: "  " }))
      .rejects.toBeInstanceOf(ProfileInputError);
  });

  it("refuses a signed-out caller", async () => {
    await expect(profiles.initialize({}, { fullName: "Nobody" }))
      .rejects.toBeInstanceOf(NotProfileOwnerError);
  });
});

describe("editing", () => {
  it("has no way to change a username", async () => {
    const before = (await profiles.getOwn(SAM))!.profile.username;
    await profiles.update(SAM, { fullName: "Sam A. Murtaza", headline: "Owner-operator" });
    const after = (await profiles.getOwn(SAM))!.profile;
    expect(after.username).toBe(before);
    expect(after.fullName).toBe("Sam A. Murtaza");
    expect(after.headline).toBe("Owner-operator");
  });

  it("treats an emptied field as absent rather than as an empty string", async () => {
    const profile = await profiles.update(SAM, { headline: "   " });
    expect(profile.headline).toBeUndefined();
  });

  it("leaves a field alone when it was not passed", async () => {
    const before = (await profiles.getOwn(SAM))!.profile.bio;
    const after = await profiles.update(SAM, { location: "Joliet, IL" });
    expect(after.bio).toBe(before);
    expect(after.location).toBe("Joliet, IL");
  });

  it("refuses somebody editing a profile that is not theirs", async () => {
    await expect(profiles.update(STRANGER, { fullName: "Hijacked" }))
      .rejects.toBeInstanceOf(Error);
    expect((await profiles.getOwn(SAM))!.profile.fullName).toBe("Sam Murtaza");
  });
});

describe("the avatar", () => {
  const png = { contentType: "image/png", byteLength: 40_000, data: "data:image/png;base64,AAA" };

  it("stores one and puts it on the record", async () => {
    const { avatarUrl } = await profiles.uploadAvatar(SAM, png);
    expect(avatarUrl).toContain("data:image/png");
    expect((await profiles.getOwn(SAM))!.profile.avatarUrl).toBe(avatarUrl);
  });

  it("checks the file again even though the picker already did", async () => {
    await expect(profiles.uploadAvatar(SAM, { ...png, contentType: "image/svg+xml" }))
      .rejects.toBeInstanceOf(AvatarRejectedError);
    await expect(profiles.uploadAvatar(SAM, { ...png, byteLength: 9_000_000 }))
      .rejects.toBeInstanceOf(AvatarRejectedError);
  });

  it("removes one without touching anything else on the record", async () => {
    await profiles.uploadAvatar(SAM, png);
    const profile = await profiles.removeAvatar(SAM);
    expect(profile.avatarUrl).toBeUndefined();
    expect(profile.username).toBe("sam_murtaza");
  });

  it("refuses to set somebody else's avatar", async () => {
    await expect(profiles.uploadAvatar(STRANGER, png)).rejects.toBeInstanceOf(Error);
  });
});

describe("recording work, and the milestones it triggers", () => {
  it("stamps the row with the CALLER'S organization, not the input's", async () => {
    const { contribution } = await profiles.recordContribution(meridian, {
      userId: "usr_sam",
      capacity: "dispatcher",
      kind: "load_dispatched",
      value: 1,
      occurredAt: "2026-09-19T00:00:00.000Z",
    });
    expect(contribution.organizationId).toBe("org_meridian");
    expect(contribution.organizationNameSnapshot).toBe("Meridian Dispatch");
  });

  it("unlocks nothing on a row that crosses no line", async () => {
    const result = await profiles.recordContribution(meridian, {
      userId: "usr_sam",
      capacity: "dispatcher",
      kind: "load_dispatched",
      value: 1,
      occurredAt: "2026-09-19T00:00:00.000Z",
    });
    expect(result.unlocked).toEqual([]);
  });

  it("unlocks the badge on the very row that earned it", async () => {
    // Seeded dispatch work is 494 loads; this is the row that reaches 500.
    const result = await profiles.recordContribution(meridian, {
      userId: "usr_sam",
      capacity: "dispatcher",
      kind: "load_dispatched",
      value: 6,
      occurredAt: "2026-09-19T00:00:00.000Z",
    });
    expect(result.unlocked.map((a) => a.key)).toEqual(["dispatch.loads.500"]);
    expect(result.unlocked[0].earnedAt).toBe("2026-09-19T00:00:00.000Z");
  });

  it("moves the figure the profile shows, because nothing is stored", async () => {
    const before = (await profiles.getOwn(SAM))!.metrics!
      .find((m) => m.capacity === "dispatcher")!;
    await profiles.recordContribution(meridian, {
      userId: "usr_sam",
      capacity: "dispatcher",
      kind: "load_dispatched",
      value: 3,
      occurredAt: "2026-09-19T00:00:00.000Z",
    });
    const after = (await profiles.getOwn(SAM))!.metrics!
      .find((m) => m.capacity === "dispatcher")!;
    expect(after).toMatchObject({
      capacity: "dispatcher",
      loadsDispatched: (before as { loadsDispatched: number }).loadsDispatched + 3,
    });
  });

  it("refuses to post work for somebody with no profile", async () => {
    await expect(profiles.recordContribution(meridian, {
      userId: "usr_nobody",
      capacity: "dispatcher",
      kind: "load_dispatched",
      value: 1,
      occurredAt: "2026-09-19T00:00:00.000Z",
    })).rejects.toBeInstanceOf(Error);
  });
});

describe("share cards", () => {
  const origin = "https://antcolos.com";

  it("builds a profile card for a public profile", async () => {
    const card = await profiles.shareCard({ username: "sam_murtaza", origin });
    expect(card?.url).toBe("https://antcolos.com/profile/sam_murtaza");
    expect(card?.stats.length).toBeGreaterThan(0);
  });

  it("builds an achievement card for a badge the person holds", async () => {
    const card = await profiles.shareCard({
      username: "sam_murtaza", achievementKey: "driver.miles.100k", origin,
    });
    expect(card?.achievement?.title).toBe("100,000 Miles Club");
  });

  it("builds nothing for a badge nobody holds", async () => {
    expect(await profiles.shareCard({
      username: "sam_murtaza", achievementKey: "driver.miles.500k", origin,
    })).toBeNull();
  });

  it("refuses to render a card for a profile that is not public", async () => {
    await profiles.setVisibility(SAM, {
      visibility: "signed-in",
      sections: { metrics: true, workplaces: true, achievements: true },
    });
    // A link preview in a group chat is not a signed-in reader.
    expect(await profiles.shareCard({ username: "sam_murtaza", origin })).toBeNull();
  });

  it("never carries a figure the profile itself withholds", async () => {
    await profiles.setVisibility(SAM, {
      visibility: "public",
      sections: { metrics: false, workplaces: true, achievements: true },
    });
    const card = await profiles.shareCard({ username: "sam_murtaza", origin });
    expect(card?.stats.map((s) => s.label)).toEqual(["On Antcolos"]);
  });
});
