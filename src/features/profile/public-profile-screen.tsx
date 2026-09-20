"use client";

import { UserX } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Logo } from "@/components/brand/logo";
import { Share2 } from "lucide-react";
import { displayHandle } from "@/lib/profile/identity";
import { usePublicProfile } from "./hooks";
import { ProfileBody } from "./profile-body";
import { ShareProfileDialog } from "./share-dialog";

/**
 * A profile, read by whoever followed the link.
 *
 * Reached WITHOUT signing in. There is no shell, no organization switcher and
 * no workspace here — somebody who opened a profile from LinkedIn is not a user
 * of Antcolos, and nothing on this page may imply they are.
 *
 * ★ ONE ANSWER FOR TWO QUESTIONS ★
 * A handle nobody holds and a profile this reader may not see produce the same
 * screen. Telling them apart would turn a list of guessed handles into a
 * directory of who works in freight, and that is a far more valuable thing to
 * scrape than any one profile.
 */
export function PublicProfileScreen({ username }: { username: string }) {
  const { data: view, isPending } = usePublicProfile(username);

  if (isPending) {
    return (
      <div className="w-full max-w-3xl space-y-6">
        <div className="flex gap-4">
          <Skeleton className="size-20 rounded-full" />
          <div className="flex-1 space-y-2 pt-1">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-72" />
          </div>
        </div>
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );
  }

  if (!view) {
    return (
      <Card className="w-full max-w-md px-6 py-10 text-center">
        <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-lg bg-surface-sunken text-fg-subtle">
          <UserX aria-hidden className="size-5" />
        </div>
        <h1 className="text-[1rem] font-semibold text-fg">
          No profile at {displayHandle(username)}
        </h1>
        <p className="mx-auto mt-1.5 max-w-sm text-[0.8125rem] leading-relaxed text-fg-muted">
          Either nobody holds this handle, or the person it belongs to keeps their profile
          private. Check the link, or ask them for it directly.
        </p>
        <Button asChild variant="secondary" size="sm" className="mt-6">
          <Link href="/">Go to Antcolos</Link>
        </Button>
      </Card>
    );
  }

  return (
    <div className="w-full max-w-3xl">
      <div className="mb-7 flex items-center justify-between">
        <Link
          href="/"
          className="rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          <Logo />
        </Link>
        <Button asChild variant="secondary" size="sm">
          <Link href="/sign-up">Create your profile</Link>
        </Button>
      </div>

      <ProfileBody
        view={view}
        asOf={new Date().toISOString()}
        actions={
          view.profile.visibility === "public" || view.isOwner ? (
            <ShareProfileDialog
              profile={view.profile}
              trigger={
                <Button type="button" variant="secondary" size="sm">
                  <Share2 aria-hidden />
                  Share
                </Button>
              }
            />
          ) : null
        }
      />

      <footer className="mt-10 border-t border-border pt-5 text-[0.75rem] leading-relaxed text-fg-subtle">
        Every figure on this page is folded from work recorded on Antcolos — loads dispatched,
        loads delivered, miles run — and none of it is typed in by hand. Verified badges say
        what Antcolos checked; they are not a licence, a permission or a regulatory rating.
      </footer>
    </div>
  );
}
