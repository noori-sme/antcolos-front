import { describe, expect, it } from "vitest";
import type { Achievement, ProfileView } from "@/types";
import {
  EXTERNAL_SHARE_TARGETS, SHARE_STAT_LIMIT, achievementShareCard, profileShareCard,
  shareText, shareUrl,
} from "./share";

const ORIGIN = "https://antcolos.com";

function view(overrides: Partial<ProfileView> = {}): ProfileView {
  return {
    profile: {
      userId: "usr_sam",
      username: "sam_murtaza",
      fullName: "Sam Murtaza",
      headline: "Dispatcher & owner-operator",
      links: [],
      visibility: "public",
      sections: { metrics: true, workplaces: true, achievements: true },
      verifications: [],
      joinedAt: "2025-11-04T16:20:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
    tenure: {
      joinedAt: "2025-11-04T16:20:00.000Z",
      daysOnPlatform: 320,
      activeDays: 280,
      currentWorkplaces: 1,
      organizationsWorkedWith: 2,
    },
    isOwner: false,
    withheld: [],
    ...overrides,
  };
}

const dispatcher = {
  capacity: "dispatcher" as const,
  loadsDispatched: 412,
  grossRevenueBookedCents: 98_400_000,
  averageLoadRateCents: 238_834,
  topLanes: [],
};

describe("the profile share card", () => {
  it("carries the figures a network would actually care about", () => {
    const card = profileShareCard(view({ metrics: [dispatcher] }), ORIGIN);
    expect(card.stats.map((s) => s.label)).toEqual([
      "Loads dispatched", "Freight booked", "Average rate", "On Antcolos",
    ]);
    expect(card.stats[0].value).toBe("412");
    expect(card.stats[1].value).toBe("$984K");
  });

  it("never renders more than four figures", () => {
    const busy = view({
      metrics: [dispatcher, {
        capacity: "driver",
        loadsDelivered: 300, milesDriven: 210_000, safetyScore: 98,
        onTimePercentage: 97, cleanInspections: 5, topLanes: [],
      }],
    });
    expect(profileShareCard(busy, ORIGIN).stats).toHaveLength(SHARE_STAT_LIMIT);
  });

  it("leaves a figure off rather than showing a zero", () => {
    const quiet = view({
      metrics: [{ ...dispatcher, loadsDispatched: 0, grossRevenueBookedCents: 0, averageLoadRateCents: 0 }],
    });
    const card = profileShareCard(quiet, ORIGIN);
    expect(card.stats).toEqual([{ label: "On Antcolos", value: "10 mo" }]);
  });

  it("shows nothing from a section the reader was not given", () => {
    const withheld = view({ metrics: undefined, withheld: ["metrics"] });
    expect(profileShareCard(withheld, ORIGIN).stats.map((s) => s.label)).toEqual(["On Antcolos"]);
  });

  it("points back at the canonical profile URL", () => {
    expect(profileShareCard(view(), ORIGIN).url).toBe("https://antcolos.com/profile/sam_murtaza");
  });
});

describe("the achievement share card", () => {
  const achievement: Achievement = {
    key: "dispatch.top.quarter",
    definition: {
      key: "dispatch.top.quarter", title: "Top Dispatcher",
      description: "Ranked first for loads dispatched in a quarter.",
      tier: "platinum", origin: "conferred", capacity: "dispatcher", icon: "Crown",
    },
    earnedAt: "2026-09-19T00:00:00.000Z",
    period: "Q3 2026",
  };

  it("folds the period into the title, because the award is about one", () => {
    const card = achievementShareCard(view({ metrics: [dispatcher] }), achievement, ORIGIN);
    expect(card.achievement?.title).toBe("Top Dispatcher · Q3 2026");
    expect(card.url).toBe("https://antcolos.com/profile/sam_murtaza/a/dispatch.top.quarter");
  });

  it("leaves a badge without a period alone", () => {
    const card = achievementShareCard(
      view(),
      { ...achievement, key: "dispatch.loads.100", period: undefined },
      ORIGIN,
    );
    expect(card.achievement?.title).toBe("Top Dispatcher");
  });
});

describe("the links each network is handed", () => {
  const card = profileShareCard(view({ metrics: [dispatcher] }), ORIGIN);

  it("copies the profile URL itself for the copy-link target", () => {
    expect(shareUrl("link", card)).toBe(card.url);
  });

  it("gives LinkedIn the URL alone, because it ignores anything else", () => {
    const url = shareUrl("linkedin", card);
    expect(url).toContain(encodeURIComponent(card.url));
    expect(url).not.toContain("text=");
  });

  it("encodes the text everywhere it is actually used", () => {
    for (const target of ["x", "whatsapp", "telegram", "email"] as const) {
      const url = shareUrl(target, card);
      expect(url).not.toContain(" ");
      expect(url).toContain(encodeURIComponent("Sam Murtaza"));
    }
  });

  it("covers every external target", () => {
    for (const target of EXTERNAL_SHARE_TARGETS) {
      expect(shareUrl(target, card).startsWith("http") || shareUrl(target, card).startsWith("mailto:"))
        .toBe(true);
    }
  });

  it("writes a sentence, not a template with a hole in it", () => {
    expect(shareText(card)).toBe(
      "Sam Murtaza — Dispatcher & owner-operator. My verified Antcolos record.",
    );
    const noHeadline = profileShareCard(
      view({ profile: { ...view().profile, headline: undefined } }),
      ORIGIN,
    );
    expect(shareText(noHeadline)).toBe("Sam Murtaza — my verified Antcolos record.");
  });
});
