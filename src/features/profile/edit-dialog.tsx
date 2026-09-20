"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormAlert } from "@/features/auth/form-alert";
import { validateFullName } from "@/features/auth/rules";
import {
  BIO_MAX_LENGTH, HEADLINE_MAX_LENGTH, remaining, validateBio, validateHeadline,
  validateLocation,
} from "@/lib/profile/fields";
import type { UserProfile } from "@/types";
import { AvatarPicker, type PickedAvatar } from "./avatar-picker";
import { useRemoveAvatar, useUpdateProfile, useUploadAvatar } from "./hooks";

/**
 * Editing the four things a person wrote about themselves, plus the avatar.
 *
 * ★ THE USERNAME IS NOT IN HERE ★
 * Not as a disabled field, not as a "contact support" link. It was chosen once
 * and every share card, mention and profile link ever published points at it.
 * A greyed-out box would invite the question; its absence answers it.
 *
 * Nothing else on the profile is editable either. The figures come from
 * recorded work, the companies come from real memberships and the badges are
 * derived — none of them is a person's to type.
 */
export function EditProfileDialog({
  profile,
  trigger,
}: {
  profile: UserProfile;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const update = useUpdateProfile();
  const uploadAvatar = useUploadAvatar();
  const removeAvatar = useRemoveAvatar();

  const [fullName, setFullName] = useState(profile.fullName);
  const [headline, setHeadline] = useState(profile.headline ?? "");
  const [bio, setBio] = useState(profile.bio ?? "");
  const [location, setLocation] = useState(profile.location ?? "");
  const [avatar, setAvatar] = useState<PickedAvatar | null>(null);
  const [avatarCleared, setAvatarCleared] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const pending = update.isPending || uploadAvatar.isPending || removeAvatar.isPending;
  const nameError = validateFullName(fullName);
  const headlineError = validateHeadline(headline);
  const bioError = validateBio(bio);
  const locationError = validateLocation(location);
  const blocked = Boolean(nameError || headlineError || bioError || locationError);

  /** Re-seeded from the record each time it opens, so Cancel really cancels. */
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setFullName(profile.fullName);
      setHeadline(profile.headline ?? "");
      setBio(profile.bio ?? "");
      setLocation(profile.location ?? "");
      setAvatar(null);
      setAvatarCleared(false);
      setFailure(null);
    }
  }

  async function save() {
    if (blocked) return;
    setFailure(null);
    try {
      if (avatar) await uploadAvatar.mutateAsync(avatar);
      else if (avatarCleared && profile.avatarUrl) await removeAvatar.mutateAsync();
      await update.mutateAsync({ fullName, headline, bio, location });
      setOpen(false);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "That did not save. Try again.");
    }
  }

  const shownAvatar = avatar?.data ?? (avatarCleared ? undefined : profile.avatarUrl);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        title="Edit your profile"
        description="Your name, headline and photo. Everything else on the page comes from recorded work."
        className="max-w-lg"
      >
        <form
          noValidate
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <AvatarPicker
            value={shownAvatar}
            fullName={fullName}
            onPick={(picked) => {
              setAvatar(picked);
              setAvatarCleared(false);
            }}
            onClear={() => {
              setAvatar(null);
              setAvatarCleared(true);
            }}
            disabled={pending}
          />

          <Field label="Full name" htmlFor="edit-full-name" error={nameError ?? undefined}>
            <Input
              id="edit-full-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              disabled={pending}
              autoComplete="name"
            />
          </Field>

          <Field
            label="Headline"
            htmlFor="edit-headline"
            error={headlineError ?? undefined}
            hint={`${remaining(headline, HEADLINE_MAX_LENGTH)} characters left.`}
          >
            <Input
              id="edit-headline"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              disabled={pending}
              placeholder="Dispatcher · reefer and dry van"
            />
          </Field>

          <Field
            label="About you"
            htmlFor="edit-bio"
            error={bioError ?? undefined}
            hint={`${remaining(bio, BIO_MAX_LENGTH)} characters left.`}
          >
            <Textarea
              id="edit-bio"
              rows={3}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              disabled={pending}
            />
          </Field>

          <Field label="Location" htmlFor="edit-location" error={locationError ?? undefined}>
            <Input
              id="edit-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              disabled={pending}
              placeholder="Chicago, IL"
            />
          </Field>

          {failure ? (
            <FormAlert tone="danger" title="That did not save">{failure}</FormAlert>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={pending}>Cancel</Button>
            </DialogClose>
            <Button type="submit" variant="primary" disabled={pending || blocked} aria-busy={pending || undefined}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
