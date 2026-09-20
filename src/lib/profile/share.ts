import type { Achievement, ProfileView, ShareCard, ShareTarget } from "@/types";
import { absoluteAchievementUrl, absoluteProfileUrl } from "./identity";
import { formatCompactUsd, formatCount, formatUsd } from "./metrics";
import { formatDuration } from "./tenure";

/**
 * Turning a profile into something that survives being pasted somewhere else.
 *
 * A share card is built ONCE, here, and then rendered three ways: as the image
 * the Open Graph route draws, as the preview inside the share dialog, and as
 * the `<meta>` description a crawler reads. Building it in one place is what
 * stops the preview a person approves from differing from the card their
 * network actually sees.
 *
 * Nothing in this file reads the clock, the session or `window`. The origin is
 * passed in, because the dialog runs in a browser and the image route runs on a
 * server, and only one of them has a `location`.
 */

/** At most four figures. A card with six numbers is a card nobody reads. */
export const SHARE_STAT_LIMIT = 4;

function statsFor(view: ProfileView): Array<{ label: string; value: string }> {
  const stats: Array<{ label: string; value: string }> = [];

  for (const metrics of view.metrics ?? []) {
    if (metrics.capacity === "dispatcher") {
      if (metrics.loadsDispatched > 0) {
        stats.push({ label: "Loads dispatched", value: formatCount(metrics.loadsDispatched) });
      }
      if (metrics.grossRevenueBookedCents > 0) {
        stats.push({ label: "Freight booked", value: formatCompactUsd(metrics.grossRevenueBookedCents) });
      }
      if (metrics.averageLoadRateCents > 0) {
        stats.push({ label: "Average rate", value: formatUsd(metrics.averageLoadRateCents) });
      }
    }
    if (metrics.capacity === "driver") {
      if (metrics.loadsDelivered > 0) {
        stats.push({ label: "Loads delivered", value: formatCount(metrics.loadsDelivered) });
      }
      if (metrics.milesDriven > 0) {
        stats.push({ label: "Miles driven", value: formatCount(metrics.milesDriven) });
      }
      if (metrics.onTimePercentage !== null) {
        stats.push({ label: "On time", value: `${metrics.onTimePercentage}%` });
      }
      if (metrics.safetyScore !== null) {
        stats.push({ label: "Safety score", value: `${metrics.safetyScore}` });
      }
    }
  }

  // Time on the platform is the one figure everybody has, so it goes last and
  // only when there is room — a card is not padded out with it.
  if (stats.length < SHARE_STAT_LIMIT) {
    stats.push({ label: "On Antcolos", value: formatDuration(view.tenure.daysOnPlatform) });
  }

  return stats.slice(0, SHARE_STAT_LIMIT);
}

export function profileShareCard(view: ProfileView, origin: string): ShareCard {
  return {
    kind: "profile",
    username: view.profile.username,
    fullName: view.profile.fullName,
    headline: view.profile.headline,
    avatarUrl: view.profile.avatarUrl,
    stats: statsFor(view),
    url: absoluteProfileUrl(origin, view.profile.username),
  };
}

export function achievementShareCard(
  view: ProfileView,
  achievement: Achievement,
  origin: string,
): ShareCard {
  return {
    kind: "achievement",
    username: view.profile.username,
    fullName: view.profile.fullName,
    headline: view.profile.headline,
    avatarUrl: view.profile.avatarUrl,
    stats: statsFor(view),
    achievement: {
      title: achievement.period
        ? `${achievement.definition.title} · ${achievement.period}`
        : achievement.definition.title,
      description: achievement.definition.description,
      tier: achievement.definition.tier,
    },
    url: absoluteAchievementUrl(origin, view.profile.username, achievement.key),
  };
}

/* -------------------------------------------------------------------------- */
/* What gets written alongside the link                                        */
/* -------------------------------------------------------------------------- */

/** The sentence that goes in the post. Deliberately plain and first-person. */
export function shareText(card: ShareCard): string {
  if (card.kind === "achievement" && card.achievement) {
    return `${card.achievement.title} — my verified Antcolos record.`;
  }
  return card.headline
    ? `${card.fullName} — ${card.headline}. My verified Antcolos record.`
    : `${card.fullName} — my verified Antcolos record.`;
}

export function shareSubject(card: ShareCard): string {
  return card.kind === "achievement" && card.achievement
    ? `${card.fullName}: ${card.achievement.title}`
    : `${card.fullName} on Antcolos`;
}

/**
 * The URL that opens a given network's composer.
 *
 * `link` returns the profile URL itself, because "copy link" is a share target
 * like any other and the dialog should not need a special case for it.
 *
 * LinkedIn is given the URL ALONE, on purpose: its share endpoint ignores any
 * text passed with it and renders the Open Graph card instead, so passing text
 * would only make the dialog lie about what will be posted.
 */
export function shareUrl(target: ShareTarget, card: ShareCard): string {
  const url = encodeURIComponent(card.url);
  const text = encodeURIComponent(shareText(card));
  switch (target) {
    case "link":
      return card.url;
    case "linkedin":
      return `https://www.linkedin.com/sharing/share-offsite/?url=${url}`;
    case "x":
      return `https://x.com/intent/post?url=${url}&text=${text}`;
    case "whatsapp":
      return `https://wa.me/?text=${encodeURIComponent(`${shareText(card)} ${card.url}`)}`;
    case "telegram":
      return `https://t.me/share/url?url=${url}&text=${text}`;
    case "email":
      return `mailto:?subject=${encodeURIComponent(shareSubject(card))}&body=${encodeURIComponent(`${shareText(card)}\n\n${card.url}`)}`;
  }
}

/** Which targets open a window, and which are handled in the page. */
export const EXTERNAL_SHARE_TARGETS: readonly ShareTarget[] = [
  "linkedin", "x", "whatsapp", "telegram", "email",
] as const;
