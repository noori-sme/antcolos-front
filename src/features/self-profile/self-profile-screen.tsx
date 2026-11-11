"use client";

import { ImagePlus, Pencil, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { Avatar, AvatarFallback, AvatarImage, initialsOf } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { avatarFileProblem } from "@/lib/profile/self-profile-form";
import { AVATAR_MIME_TYPES, type SelfProfile } from "@/types/self-profile";
import { EditSelfProfileDialog } from "./edit-self-profile-dialog";
import {
  useRemoveSelfAvatar, useSelfAvatarUrl, useSelfProfile, useUploadSelfAvatar,
} from "./hooks";

/**
 * Account → Profile in http mode (plan 11): the person's own record from
 * `/users/me`. The public profile (username page, visibility, workplaces,
 * share card) has no backend yet and stays in mock mode.
 */
export function SelfProfileScreen() {
  // `isLoading`, not `isPending`: a disabled query (no organization yet)
  // would otherwise show the skeleton forever instead of the error below.
  const { data: profile, isLoading, error, refetch } = useSelfProfile();

  if (isLoading) return <LoadingSkeleton rows={3} />;
  if (error || !profile) {
    return (
      <ErrorState
        title="We couldn't load your profile"
        description={error?.message ?? "Try again in a moment."}
        onRetry={() => void refetch()}
      />
    );
  }
  return <SelfProfileView profile={profile} />;
}

function SelfProfileView({ profile }: { profile: SelfProfile }) {
  const [editing, setEditing] = useState(false);
  const address = formatAddress(profile);

  return (
    <div className="space-y-4">
      <Card className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-start">
        <PictureControls profile={profile} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[1.125rem] font-semibold text-fg">{profile.name || profile.email}</h2>
          {profile.headline ? (
            <p className="mt-0.5 text-[0.875rem] text-fg-muted">{profile.headline}</p>
          ) : (
            <p className="mt-0.5 text-[0.875rem] text-fg-subtle">No headline yet</p>
          )}
          {profile.username ? (
            <p className="mt-1 text-[0.8125rem] text-fg-subtle">@{profile.username}</p>
          ) : null}
        </div>
        <Button variant="secondary" size="sm" onClick={() => setEditing(true)} className="self-start">
          <Pencil aria-hidden className="mr-1.5 size-4" />
          Edit profile
        </Button>
      </Card>

      <Card className="px-5 py-4">
        <h3 className="text-[0.9375rem] font-semibold text-fg">About me</h3>
        <p className="mt-1.5 whitespace-pre-line text-[0.875rem] text-fg-muted">
          {profile.aboutMe ?? "Tell the companies you work with a little about yourself."}
        </p>
      </Card>

      <Card className="px-5 py-4">
        <h3 className="text-[0.9375rem] font-semibold text-fg">Contact</h3>
        <dl className="mt-2 grid gap-x-6 gap-y-2 text-[0.875rem] sm:grid-cols-[8rem_1fr]">
          <dt className="text-fg-subtle">Email</dt>
          <dd className="break-all text-fg">{profile.email}</dd>
          <dt className="text-fg-subtle">Phone</dt>
          <dd className="text-fg">{profile.phone ?? "Not added"}</dd>
          <dt className="text-fg-subtle">Address</dt>
          <dd className="text-fg">{address ?? "Not added"}</dd>
        </dl>
      </Card>

      <EditSelfProfileDialog profile={profile} open={editing} onOpenChange={setEditing} />
    </div>
  );
}

function PictureControls({ profile }: { profile: SelfProfile }) {
  const input = useRef<HTMLInputElement>(null);
  const avatarUrl = useSelfAvatarUrl();
  const upload = useUploadSelfAvatar();
  const remove = useRemoveSelfAvatar();
  const [problem, setProblem] = useState<string | null>(null);
  const pending = upload.isPending || remove.isPending;
  const failure = problem ?? upload.error?.message ?? remove.error?.message;

  const pick = (file: File | undefined) => {
    if (!file) return;
    const issue = avatarFileProblem(file);
    setProblem(issue);
    if (!issue) upload.mutate(file);
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <Avatar className="size-20 ring-1 ring-border">
        {avatarUrl ? <AvatarImage src={avatarUrl} alt="Your profile picture" /> : null}
        <AvatarFallback className="text-[1.25rem]">
          {initialsOf(profile.name || profile.email)}
        </AvatarFallback>
      </Avatar>
      <div className="flex gap-1">
        <input
          ref={input}
          type="file"
          accept={AVATAR_MIME_TYPES.join(",")}
          className="sr-only"
          aria-label="Choose a profile picture"
          tabIndex={-1}
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => input.current?.click()}
          disabled={pending}
          aria-busy={upload.isPending || undefined}
        >
          <ImagePlus aria-hidden className="mr-1.5 size-4" />
          {profile.avatar ? "Change" : "Add picture"}
        </Button>
        {profile.avatar ? (
          <ConfirmDialog
            title="Remove your profile picture?"
            description="Your initials show instead, everywhere you appear."
            confirmLabel="Remove"
            destructive
            onConfirm={async () => {
              // Close either way; a failure shows under the picture, where
              // the open dialog would otherwise hide it.
              await remove.mutateAsync().catch(() => undefined);
            }}
            trigger={
              <Button variant="ghost" size="sm" disabled={pending} aria-label="Remove picture">
                <Trash2 aria-hidden className="size-4" />
              </Button>
            }
          />
        ) : null}
      </div>
      {failure ? (
        <p role="alert" className="max-w-[9rem] text-[0.75rem] text-st-danger">{failure}</p>
      ) : (
        <p className="max-w-[9rem] text-[0.75rem] text-fg-subtle">JPEG, PNG or WebP, up to 5 MB.</p>
      )}
    </div>
  );
}

function formatAddress(profile: SelfProfile): string | null {
  const a = profile.address;
  if (!a) return null;
  const line = [a.addressLine1, a.addressLine2].filter(Boolean).join(", ");
  const place = [a.city, [a.state, a.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const text = [line, place, a.country].filter(Boolean).join(" · ");
  return text || null;
}
