"use client";

import { ArrowRight, Share2, Trophy } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Logo } from "@/components/brand/logo";
import { displayHandle, profilePath } from "@/lib/profile/identity";
import { formatMonth } from "@/lib/profile/tenure";
import { cn } from "@/lib/utils";
import { TIER_LABEL } from "@/types";
import { usePublicProfile } from "./hooks";
import { AchievementIcon, TIER_CLASS } from "./icons";
import { ProfileAvatar } from "./profile-header";
import { ShareProfileDialog } from "./share-dialog";

/**
 * Where a shared achievement lands.
 *
 * Its own page, rather than an anchor on the profile, for one reason: a link
 * posted to LinkedIn needs its own Open Graph image, and an anchor cannot have
 * one. It shows the badge, who holds it, and a way through to the rest of the
 * record — which is what somebody who clicked a badge actually wanted.
 */
export function AchievementScreen({
  username,
  achievementKey,
}: {
  username: string;
  achievementKey: string;
}) {
  const { data: view, isPending } = usePublicProfile(username);

  if (isPending) {
    return (
      <div className="w-full max-w-xl space-y-4">
        <Skeleton className="h-11 w-40" />
        <Skeleton className="h-56 w-full rounded-lg" />
      </div>
    );
  }

  const achievement = view?.achievements?.find((a) => a.key === achievementKey);

  if (!view || !achievement) {
    return (
      <Card className="w-full max-w-md px-6 py-10 text-center">
        <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-lg bg-surface-sunken text-fg-subtle">
          <Trophy aria-hidden className="size-5" />
        </div>
        <h1 className="text-[1rem] font-semibold text-fg">This achievement is not here</h1>
        <p className="mx-auto mt-1.5 max-w-sm text-[0.8125rem] leading-relaxed text-fg-muted">
          Either the badge is not on this profile, or the profile is not public. Badges are
          derived from recorded work, so one can come and go as records are corrected.
        </p>
        <Button asChild variant="secondary" size="sm" className="mt-6">
          <Link href={profilePath(username)}>Open the profile</Link>
        </Button>
      </Card>
    );
  }

  return (
    <div className="w-full max-w-xl">
      <div className="mb-7 flex items-center justify-between">
        <Link
          href="/"
          className="rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          <Logo />
        </Link>
        {view.profile.visibility === "public" ? (
          <ShareProfileDialog
            profile={view.profile}
            achievementKey={achievement.key}
            trigger={
              <Button type="button" variant="secondary" size="sm">
                <Share2 aria-hidden />
                Share
              </Button>
            }
          />
        ) : null}
      </div>

      <Card className="px-5 py-6 text-center sm:px-8 sm:py-8">
        <span
          aria-hidden
          className={cn(
            "mx-auto flex size-16 items-center justify-center rounded-2xl",
            TIER_CLASS[achievement.definition.tier],
          )}
        >
          <AchievementIcon name={achievement.definition.icon} className="size-8" />
        </span>

        <p className="mt-4 text-[0.6875rem] font-semibold tracking-[0.14em] text-fg-subtle uppercase">
          {TIER_LABEL[achievement.definition.tier]} achievement
          {achievement.definition.origin === "conferred" ? " · awarded by Antcolos" : ""}
        </p>
        <h1 className="mt-1.5 text-[1.375rem] leading-8 font-semibold tracking-[-0.015em] text-fg">
          {achievement.definition.title}
          {achievement.period ? <span className="text-fg-muted"> · {achievement.period}</span> : null}
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-[0.875rem] leading-relaxed text-fg-muted">
          {achievement.definition.description}
        </p>
        <p className="tnum mt-3 text-[0.75rem] text-fg-subtle">
          Earned {formatMonth(achievement.earnedAt)}
          {achievement.organizationNameSnapshot ? ` · ${achievement.organizationNameSnapshot}` : ""}
        </p>

        <div className="mt-6 flex items-center justify-center gap-3 border-t border-border pt-5">
          <ProfileAvatar
            src={view.profile.avatarUrl}
            fullName={view.profile.fullName}
            className="size-10 text-[0.75rem]"
          />
          <div className="min-w-0 text-left">
            <p className="truncate text-[0.875rem] font-semibold text-fg">{view.profile.fullName}</p>
            <p className="truncate font-mono text-[0.75rem] text-fg-subtle">
              {displayHandle(view.profile.username)}
            </p>
          </div>
        </div>

        <Button asChild variant="secondary" size="sm" className="mt-5">
          <Link href={profilePath(view.profile.username)}>
            See the whole record
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      </Card>
    </div>
  );
}
