import { ImageResponse } from "next/og";
import { ShareCardImage, SHARE_IMAGE_SIZE } from "@/features/profile/share-card-og";
import { resolveShareCard } from "@/features/profile/server-view";

/**
 * The image a link preview renders for a profile.
 *
 * ★ IT EXISTS ONLY FOR A PUBLIC PROFILE ★
 * A crawler holds a link and nothing else — it is not a signed-in reader, and
 * it will happily put whatever it is given into a group chat. So a profile set
 * to "Antcolos only" or "private" gets the plain fallback card, which says
 * Antcolos and nothing about anybody. The same rule is enforced again in the
 * service; this is not the only place it is checked.
 */

export const alt = "Antcolos profile";
export const size = SHARE_IMAGE_SIZE;
export const contentType = "image/png";

export default async function Image(
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;
  const card = resolveShareCard(username);

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
