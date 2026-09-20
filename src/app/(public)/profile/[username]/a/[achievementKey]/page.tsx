import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { site } from "@/config/brand";
import { AchievementScreen } from "@/features/profile/achievement-screen";
import { resolveShareCard } from "@/features/profile/server-view";
import { achievementPath, usernameFromSegment } from "@/lib/profile/identity";
import { shareText } from "@/lib/profile/share";

/**
 * One achievement, on its own page: `/profile/sam_murtaza/a/dispatch.loads.100`.
 *
 * It has a page rather than an anchor because a badge posted to LinkedIn needs
 * its own Open Graph image, and an anchor cannot carry one.
 */
export async function generateMetadata(
  { params }: { params: Promise<{ username: string; achievementKey: string }> },
): Promise<Metadata> {
  const { username, achievementKey } = await params;
  const card = resolveShareCard(username, decodeURIComponent(achievementKey));

  if (!card?.achievement) {
    return { title: "Achievement", robots: { index: false, follow: false } };
  }

  const canonical = achievementPath(card.username, achievementKey);
  return {
    metadataBase: new URL(site.origin),
    title: `${card.fullName}: ${card.achievement.title}`,
    description: shareText(card),
    alternates: { canonical },
    openGraph: {
      type: "article",
      url: canonical,
      title: `${card.fullName}: ${card.achievement.title}`,
      description: shareText(card),
    },
    twitter: { card: "summary_large_image" },
  };
}

export default async function Page(
  { params }: { params: Promise<{ username: string; achievementKey: string }> },
) {
  const { username: segment, achievementKey } = await params;
  const canonical = usernameFromSegment(segment);
  const key = decodeURIComponent(achievementKey);

  if (canonical && canonical !== segment) redirect(achievementPath(canonical, key));

  return <AchievementScreen username={canonical ?? segment} achievementKey={key} />;
}
