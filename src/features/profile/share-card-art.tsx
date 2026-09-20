import { cn } from "@/lib/utils";
import { TIER_LABEL, type ShareCard } from "@/types";
import { ProfileAvatar } from "./profile-header";

/**
 * The share card, drawn in HTML.
 *
 * This is the PREVIEW — what the dialog shows before somebody posts. The image
 * a crawler fetches is drawn separately, by the Open Graph route, because an
 * image route cannot run React components or Tailwind. The two are kept in
 * step by both rendering the SAME `ShareCard` object, built once by
 * `src/lib/profile/share.ts`: they can differ in craft, never in content.
 *
 * Deliberately not themed. A share card ends up on somebody else's timeline,
 * where our light and dark tokens mean nothing, so it is drawn in fixed
 * colours that match the image route exactly.
 */
export function ShareCardArt({ card, className }: { card: ShareCard; className?: string }) {
  return (
    <div
      className={cn(
        "relative flex aspect-[1200/630] w-full flex-col justify-between overflow-hidden rounded-lg p-5",
        "bg-[#1b2027] text-white",
        className,
      )}
    >
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,#f0a33c_0%,#4f8ef7_100%)]"
      />

      <div className="flex items-start gap-3">
        <ProfileAvatar
          src={card.avatarUrl}
          fullName={card.fullName}
          className="size-12 border-white/15 bg-white/10 text-[0.875rem] text-white"
        />
        <div className="min-w-0">
          <p className="truncate text-[0.9375rem] leading-5 font-semibold">{card.fullName}</p>
          <p className="truncate font-mono text-[0.75rem] text-white/55">@{card.username}</p>
        </div>
        <span className="ml-auto shrink-0 text-[0.6875rem] font-semibold tracking-[0.14em] text-white/45 uppercase">
          Antcolos
        </span>
      </div>

      {card.achievement ? (
        <div className="min-w-0">
          <p className="text-[0.625rem] font-semibold tracking-[0.16em] text-[#f0a33c] uppercase">
            {TIER_LABEL[card.achievement.tier]} achievement
          </p>
          <p className="mt-1 text-[1.125rem] leading-6 font-semibold">{card.achievement.title}</p>
          <p className="mt-0.5 line-clamp-2 text-[0.75rem] leading-relaxed text-white/60">
            {card.achievement.description}
          </p>
        </div>
      ) : card.headline ? (
        <p className="line-clamp-2 text-[0.875rem] leading-relaxed text-white/70">{card.headline}</p>
      ) : null}

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {card.stats.map((stat) => (
          <div key={stat.label} className="min-w-0">
            <p className="tnum text-[1rem] leading-5 font-semibold">{stat.value}</p>
            <p className="truncate text-[0.625rem] tracking-wide text-white/50 uppercase">
              {stat.label}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
