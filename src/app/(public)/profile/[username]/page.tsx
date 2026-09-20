import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { site } from "@/config/brand";
import { PublicProfileScreen } from "@/features/profile/public-profile-screen";
import { resolveProfileSegment } from "@/features/profile/server-view";
import { profilePath, usernameFromSegment } from "@/lib/profile/identity";
import { shareText } from "@/lib/profile/share";
import { profileShareCard } from "@/lib/profile/share";

/**
 * The shareable profile page: `/profile/sam_murtaza`.
 *
 * `@sam_murtaza` works too. People write a handle with the `@` and paste it
 * into an address bar, so the segment is normalized and then REDIRECTED to the
 * canonical path — one address per person, whatever was typed, so every link
 * ever shared points at the same page and the crawler cache is not split in
 * two.
 *
 * The page itself is public: no session, no shell, no organization. See
 * `src/app/(public)/layout.tsx`.
 */
export async function generateMetadata(
  { params }: { params: Promise<{ username: string }> },
): Promise<Metadata> {
  const { username: segment } = await params;
  const resolved = resolveProfileSegment(segment);

  if (!resolved) {
    return {
      title: "Profile not found",
      // A handle nobody holds is not a page worth indexing, and indexing it
      // would let a crawler enumerate which handles exist.
      robots: { index: false, follow: false },
    };
  }

  const { view } = resolved;
  const isPublic = view.profile.visibility === "public";
  const card = isPublic ? profileShareCard(view, site.origin) : null;
  const canonical = profilePath(view.profile.username);

  return {
    metadataBase: new URL(site.origin),
    title: `${view.profile.fullName} (@${view.profile.username})`,
    description: card ? shareText(card) : `${view.profile.fullName} on Antcolos.`,
    alternates: { canonical },
    // A profile that is not public must not be indexed, and its Open Graph
    // tags must not describe somebody who chose not to be described.
    robots: isPublic ? undefined : { index: false, follow: false },
    openGraph: isPublic
      ? {
        type: "profile",
        url: canonical,
        title: `${view.profile.fullName} (@${view.profile.username})`,
        description: card ? shareText(card) : undefined,
      }
      : undefined,
    twitter: isPublic ? { card: "summary_large_image" } : undefined,
  };
}

export default async function Page({ params }: { params: Promise<{ username: string }> }) {
  const { username: segment } = await params;
  const canonical = usernameFromSegment(segment);

  // `@sam` and `SAM` both mean `sam`, and all three settle on one URL.
  if (canonical && canonical !== segment) redirect(profilePath(canonical));

  return <PublicProfileScreen username={canonical ?? segment} />;
}
