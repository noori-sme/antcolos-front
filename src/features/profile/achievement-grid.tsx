"use client";

import { Share2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatMonth } from "@/lib/profile/tenure";
import { cn } from "@/lib/utils";
import { TIER_LABEL, type Achievement, type UserProfile } from "@/types";
import { AchievementIcon, TIER_CLASS } from "./icons";
import { ShareProfileDialog } from "./share-dialog";

/**
 * The badge wall.
 *
 * Each badge says when it was earned, and a threshold badge says the figure
 * that earned it — because "100th load dispatched, 4 March" is a fact somebody
 * can point at, and a gold circle on its own is decoration.
 *
 * A conferred award is marked as such. It is the only kind on the page that
 * Antcolos decided rather than derived, and pretending otherwise would make
 * every other badge slightly less believable.
 */
export function AchievementGrid({
  achievements,
  profile,
  shareable,
}: {
  achievements: Achievement[];
  profile: UserProfile;
  /** Only the owner gets a share button on each badge. */
  shareable: boolean;
}) {
  if (achievements.length === 0) {
    return (
      <Card className="px-5 py-5">
        <p className="text-[0.8125rem] text-fg-muted">
          No milestones yet. Badges are worked out from recorded loads, miles and time on
          Antcolos — nobody hands them out and nobody can add one by hand.
        </p>
      </Card>
    );
  }

  return (
    <ul className="grid gap-2.5 sm:grid-cols-2">
      {achievements.map((achievement) => {
        const conferred = achievement.definition.origin === "conferred";
        return (
          <li key={achievement.key}>
            <Card className="flex h-full gap-3 px-4 py-3.5">
              <span
                aria-hidden
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-lg",
                  TIER_CLASS[achievement.definition.tier],
                )}
              >
                <AchievementIcon name={achievement.definition.icon} className="size-5" />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[0.875rem] leading-5 font-semibold text-fg">
                    {achievement.definition.title}
                    {achievement.period ? (
                      <span className="text-fg-muted"> · {achievement.period}</span>
                    ) : null}
                  </p>
                  {shareable ? (
                    <ShareProfileDialog
                      profile={profile}
                      achievementKey={achievement.key}
                      trigger={
                        <button
                          type="button"
                          aria-label={`Share ${achievement.definition.title}`}
                          className={cn(
                            "-m-1 shrink-0 rounded-md p-1 text-fg-subtle transition-colors",
                            "hover:bg-surface-hover hover:text-fg",
                            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                          )}
                        >
                          <Share2 aria-hidden className="size-4" />
                        </button>
                      }
                    />
                  ) : null}
                </div>

                <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
                  {achievement.definition.description}
                </p>

                <p className="tnum mt-1.5 flex flex-wrap items-center gap-x-2 text-[0.75rem] text-fg-subtle">
                  <span>{TIER_LABEL[achievement.definition.tier]}</span>
                  <span aria-hidden>·</span>
                  <span>{formatMonth(achievement.earnedAt)}</span>
                  {achievement.organizationNameSnapshot ? (
                    <>
                      <span aria-hidden>·</span>
                      <span>{achievement.organizationNameSnapshot}</span>
                    </>
                  ) : null}
                  {conferred ? (
                    <>
                      <span aria-hidden>·</span>
                      <span title="Decided by Antcolos against everybody else's quarter, not computed from this profile alone">
                        Awarded by Antcolos
                      </span>
                    </>
                  ) : null}
                </p>
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
