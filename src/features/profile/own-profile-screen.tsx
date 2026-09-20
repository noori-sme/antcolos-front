"use client";

import { ExternalLink, Pencil, Share2, Sparkles } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FormAlert } from "@/features/auth/form-alert";
import { displayHandle, profilePath } from "@/lib/profile/identity";
import { EditProfileDialog } from "./edit-dialog";
import { useOwnProfile, useSetProfileVisibility } from "./hooks";
import { ProfileBody } from "./profile-body";
import { ShareProfileDialog } from "./share-dialog";
import { VisibilityControls } from "./visibility-controls";

/**
 * Your own permanent profile, from inside the product.
 *
 * It renders through the SAME component as the public page, so what somebody
 * sees here is what they are publishing — with the owner's controls added
 * rather than a separate, friendlier view of the same record.
 *
 * It is not organization-scoped and deliberately sits under /account rather
 * than under a workspace: switching organizations changes nothing on this
 * page, because nothing on it belongs to an organization.
 */
export function OwnProfileScreen() {
  const { data: view, isPending } = useOwnProfile();
  const setVisibility = useSetProfileVisibility();

  if (isPending) {
    return (
      <div className="space-y-6">
        <div className="flex gap-4">
          <Skeleton className="size-20 rounded-full" />
          <div className="flex-1 space-y-2 pt-1">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    );
  }

  if (!view) {
    return (
      <Card className="px-5 py-8 text-center">
        <p className="text-[0.9375rem] font-semibold text-fg">No profile on this account yet</p>
        <p className="mx-auto mt-1.5 max-w-md text-[0.8125rem] leading-relaxed text-fg-muted">
          Every Antcolos account gets a permanent profile when it is created. This one has not
          been set up — finish it and it becomes your record across every company you work with.
        </p>
        <Button asChild variant="primary" size="sm" className="mt-5">
          <Link href="/onboarding/profile">Set up your profile</Link>
        </Button>
      </Card>
    );
  }

  const { profile } = view;
  const publicPath = profilePath(profile.username);

  return (
    <div className="space-y-6">
      {!profile.completedAt ? (
        <FormAlert tone="info" title="Your profile is not finished" role="status">
          You skipped the setup step, so your record exists but is mostly empty. Adding a
          headline and a photo is what makes it worth sharing.
        </FormAlert>
      ) : null}

      <ProfileBody
        view={view}
        asOf={new Date().toISOString()}
        actions={
          <>
            <EditProfileDialog
              profile={profile}
              trigger={
                <Button type="button" variant="secondary" size="sm">
                  <Pencil aria-hidden />
                  Edit
                </Button>
              }
            />
            <ShareProfileDialog
              profile={profile}
              trigger={
                <Button type="button" variant="primary" size="sm">
                  <Share2 aria-hidden />
                  Share
                </Button>
              }
            />
          </>
        }
        aside={
          <div className="space-y-4">
            <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-[0.75rem] font-medium tracking-wide text-fg-subtle uppercase">
                  Your permanent address
                </p>
                <p className="mt-0.5 truncate font-mono text-[0.8125rem] text-fg">
                  {publicPath}
                </p>
                <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                  {displayHandle(profile.username)} was chosen once and never changes, so every
                  link you have ever shared keeps working.
                </p>
              </div>
              <Button asChild variant="secondary" size="sm">
                <Link href={publicPath} target="_blank" rel="noopener">
                  <ExternalLink aria-hidden />
                  View public page
                </Link>
              </Button>
            </Card>

            <VisibilityControls
              visibility={profile.visibility}
              sections={profile.sections}
              disabled={setVisibility.isPending}
              onChange={(next) => setVisibility.mutate(next)}
            />

            <Card className="flex gap-2.5 px-4 py-3 text-[0.75rem] leading-relaxed text-fg-muted">
              <Sparkles aria-hidden className="mt-px size-4 shrink-0 text-fg-subtle" />
              <span>
                Nothing on this page is editable except your name, headline, photo and location.
                The figures are folded from loads recorded on Antcolos, the companies come from
                real memberships, and the milestones are worked out from both — which is what
                makes them worth showing to somebody who does not know you.
              </span>
            </Card>
          </div>
        }
      />
    </div>
  );
}
