import { avatarInitials } from "@/lib/profile/avatar";
import { TIER_LABEL, type ShareCard } from "@/types";

/**
 * The share card, drawn for an Open Graph image route.
 *
 * ★ EVERY TEXT NODE IS ONE EXPRESSION ★
 * Satori counts JSX children, not rendered text: `<div>@{handle}</div>` is two
 * children, and it refuses any element with more than one child that has not
 * declared `display: flex`. Interpolating into a single template literal is
 * what keeps these text nodes single children — it is not a style preference.
 *
 * ★ WHY THIS IS NOT THE PREVIEW COMPONENT ★
 * `share-card-art.tsx` renders the same card in the browser with Tailwind. An
 * image route cannot use either: `next/og` lays out a small, strict subset of
 * CSS through Satori, with no stylesheet, no class names, and a hard rule that
 * any element with more than one child declares `display: flex`. So the card is
 * drawn twice, in two renderers — but from ONE `ShareCard` object, built by
 * `src/lib/profile/share.ts`. The two can differ in craft. They cannot differ
 * in what they claim.
 *
 * Fixed colours, deliberately. This image ends up on somebody else's timeline,
 * where our light and dark tokens mean nothing.
 */

const INK = "#1b2027";
const PAPER = "#ffffff";
const MUTED = "rgba(255,255,255,0.58)";
const FAINT = "rgba(255,255,255,0.42)";
const AMBER = "#f0a33c";

export const SHARE_IMAGE_SIZE = { width: 1200, height: 630 };

export function ShareCardImage({ card }: { card: ShareCard }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        backgroundColor: INK,
        color: PAPER,
        padding: 64,
        fontFamily: "sans-serif",
      }}
    >
      {/* The brand rule across the top. */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: 1200,
          height: 10,
          display: "flex",
          backgroundImage: `linear-gradient(90deg, ${AMBER} 0%, #4f8ef7 100%)`,
        }}
      />

      <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
        <div
          style={{
            width: 104,
            height: 104,
            borderRadius: 52,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(255,255,255,0.10)",
            border: "2px solid rgba(255,255,255,0.16)",
            overflow: "hidden",
            fontSize: 38,
            fontWeight: 700,
            color: MUTED,
          }}
        >
          {card.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={card.avatarUrl} alt="" width={104} height={104} style={{ objectFit: "cover" }} />
          ) : (
            avatarInitials(card.fullName)
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginLeft: 28 }}>
          <div style={{ fontSize: 46, fontWeight: 700, letterSpacing: -1 }}>{card.fullName}</div>
          <div style={{ fontSize: 26, color: FAINT, marginTop: 6 }}>{`@${card.username}`}</div>
        </div>

        <div
          style={{
            marginLeft: "auto",
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: 6,
            color: FAINT,
          }}
        >
          ANTCOLOS
        </div>
      </div>

      {card.achievement ? (
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 940 }}>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 4, color: AMBER }}>
            {`${TIER_LABEL[card.achievement.tier].toUpperCase()} ACHIEVEMENT`}
          </div>
          <div style={{ fontSize: 60, fontWeight: 700, letterSpacing: -1.5, marginTop: 12 }}>
            {card.achievement.title}
          </div>
          <div style={{ fontSize: 26, color: MUTED, marginTop: 10 }}>
            {card.achievement.description}
          </div>
        </div>
      ) : card.headline ? (
        <div style={{ display: "flex", fontSize: 30, color: MUTED, maxWidth: 940, lineHeight: 1.4 }}>
          {card.headline}
        </div>
      ) : (
        <div style={{ display: "flex" }} />
      )}

      <div style={{ display: "flex", alignItems: "flex-end", width: "100%" }}>
        {card.stats.map((stat, index) => (
          <div
            key={stat.label}
            style={{
              display: "flex",
              flexDirection: "column",
              marginRight: index === card.stats.length - 1 ? 0 : 56,
            }}
          >
            <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: -1 }}>{stat.value}</div>
            <div style={{ fontSize: 20, letterSpacing: 2, color: FAINT, marginTop: 4 }}>
              {stat.label.toUpperCase()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
