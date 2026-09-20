import { ImageResponse } from "next/og";
import { ShareCardImage, SHARE_IMAGE_SIZE } from "@/features/profile/share-card-og";
import { resolveShareCard } from "@/features/profile/server-view";

/**
 * The image a link preview renders for one achievement.
 *
 * Like the profile card, it exists only for a public profile, and it is built
 * from the same `ShareCard` object the dialog previewed — so what somebody
 * approved before posting is what their network sees.
 */

export const alt = "Antcolos achievement";
export const size = SHARE_IMAGE_SIZE;
export const contentType = "image/png";

export default async function Image(
  { params }: { params: Promise<{ username: string; achievementKey: string }> },
) {
  const { username, achievementKey } = await params;
  const card = resolveShareCard(username, decodeURIComponent(achievementKey));

  if (!card) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#1b2027",
            color: "rgba(255,255,255,0.55)",
            fontSize: 44,
            letterSpacing: 10,
            fontFamily: "sans-serif",
          }}
        >
          ANTCOLOS
        </div>
      ),
      size,
    );
  }

  return new ImageResponse(<ShareCardImage card={card} />, size);
}
