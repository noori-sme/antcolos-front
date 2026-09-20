"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AccountFlowProgress, BackLink, SubmitButton } from "@/features/auth/controls";
import { FormAlert } from "@/features/auth/form-alert";
import { AuthShell } from "@/features/auth/shell";
import { useStageFocus } from "@/features/auth/use-stage-focus";
import { validateFullName } from "@/features/auth/rules";
import {
  BIO_MAX_LENGTH, HEADLINE_MAX_LENGTH, remaining, validateBio, validateHeadline,
} from "@/lib/profile/fields";
import { useSession } from "@/lib/session/hooks";
import { cn } from "@/lib/utils";
import { AvatarPicker, type PickedAvatar } from "./avatar-picker";
import { useInitializeProfile, useOwnProfile, useUploadAvatar } from "./hooks";

/**
 * Signup step 2 — the permanent profile, set up BEFORE any role is chosen.
 *
 * ★ WHY IT SITS HERE AND NOT AFTER ROLE SELECTION ★
 * The record this step creates is the one thing in Antcolos that outlives every
 * role, every employer and every organization. Asking for it after role
 * selection would make it look like part of being a dispatcher or a driver,
 * and it is not: the same profile follows somebody who starts as a company
 * driver, buys a truck, and ends up running a dispatch team. Putting it first
 * is the product saying so.
 *
 * ★ WHY SKIPPING IS A REAL OPTION ★
 * "Skip for now" does NOT skip the record. The permanent profile is created
 * either way, tied to the username chosen at signup; skipping leaves it
 * incomplete, which is a prompt to come back rather than a gap in the data
 * model. Somebody who arrived to accept a load at 2am gets to go and do that.
 */
export function ProfileSetupScreen() {
  const router = useRouter();
  const { user } = useSession();
  const headingRef = useStageFocus<HTMLHeadingElement>("profile");

  /**
   * Where this hands off to.
   *
   * An invitation carries its own destination, and it rides through signup in
   * `?next=`. Everybody else goes on to role selection. Only a same-site path
   * is accepted: a `next` that could be an absolute URL would make this screen
   * an open redirect, and signup flows are exactly where those get used.
   */
  const rawNext = useSearchParams().get("next");
  const next = rawNext && /^\/[^/\\]/.test(rawNext) ? rawNext : null;

  const { data: own } = useOwnProfile();
  const initialize = useInitializeProfile();
  const uploadAvatar = useUploadAvatar();

  const [fullName, setFullName] = useState("");
  const [headline, setHeadline] = useState("");
  const [bio, setBio] = useState("");
  const [avatar, setAvatar] = useState<PickedAvatar | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const username = own?.profile.username;
  const pending = initialize.isPending || uploadAvatar.isPending;

  const nameError = submitted ? validateFullName(fullName) : null;
  const headlineError = validateHeadline(headline);
  const bioError = validateBio(bio);
  const blocked = Boolean(headlineError || bioError);

  async function finish(completed: boolean) {
    setSubmitted(true);
    setFailure(null);

    // Skipping still creates the record, so the name is the one thing that has
    // to be there — it is what every other person in Antcolos will see.
    if (validateFullName(fullName) || blocked) return;

    try {
      // The avatar is stored first, so the profile is written once, complete.
      // A failure here leaves no half-made record to reconcile.
      const uploaded = avatar
        ? await uploadAvatar.mutateAsync(avatar)
        : null;
      await initialize.mutateAsync({
        fullName,
        headline: headline || undefined,
        bio: bio || undefined,
        avatarUrl: uploaded?.avatarUrl,
        completed,
      });
      router.push(next ?? "/onboarding");
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "That did not save. Try again.");
    }
  }

  return (
    <AuthShell
      title="Set up your Antcolos profile"
      description={
        <>
          This is your permanent record on Antcolos. It stays with you through every
          company you work with, and it is what people see when they look you up
          {username ? (
            <> at <span className="font-medium text-fg">@{username}</span></>
          ) : null}
          .
        </>
      }
      headingRef={headingRef}
    >
      <AccountFlowProgress stage={2} />

      <form
        noValidate
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void finish(true);
        }}
      >
        <AvatarPicker
          value={avatar?.data}
          fullName={fullName || user.displayName}
          onPick={setAvatar}
          onClear={() => setAvatar(null)}
          disabled={pending}
        />

        <div className="space-y-1.5">
          <label htmlFor="profile-full-name" className="block text-[0.8125rem] font-medium text-fg">
            Full name
          </label>
          <Input
            id="profile-full-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="name"
            placeholder="Sam Murtaza"
            disabled={pending}
            aria-invalid={Boolean(nameError) || undefined}
            aria-describedby="profile-full-name-error"
            className={cn(nameError && "border-st-danger focus-visible:border-st-danger")}
          />
          <p id="profile-full-name-error" aria-live="polite" className="min-h-4 text-[0.75rem]">
            {nameError ? <span className="text-st-danger">{nameError}</span> : null}
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="profile-headline" className="block text-[0.8125rem] font-medium text-fg">
            Headline <span className="font-normal text-fg-subtle">· optional</span>
          </label>
          <Input
            id="profile-headline"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder="Dispatcher · reefer and dry van, Midwest to Southeast"
            disabled={pending}
            aria-invalid={Boolean(headlineError) || undefined}
            aria-describedby="profile-headline-hint"
          />
          <p id="profile-headline-hint" className="text-[0.75rem] text-fg-subtle">
            {headlineError ? (
              <span className="text-st-danger">{headlineError}</span>
            ) : (
              `One line, under your name. ${remaining(headline, HEADLINE_MAX_LENGTH)} characters left.`
            )}
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="profile-bio" className="block text-[0.8125rem] font-medium text-fg">
            About you <span className="font-normal text-fg-subtle">· optional</span>
          </label>
          <Textarea
            id="profile-bio"
            rows={3}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="What you haul, where you run, how long you have been doing it."
            disabled={pending}
            aria-invalid={Boolean(bioError) || undefined}
            aria-describedby="profile-bio-hint"
          />
          <p id="profile-bio-hint" className="text-[0.75rem] text-fg-subtle">
            {bioError ? (
              <span className="text-st-danger">{bioError}</span>
            ) : (
              `${remaining(bio, BIO_MAX_LENGTH)} characters left.`
            )}
          </p>
        </div>

        {failure ? (
          <FormAlert tone="danger" title="That did not save">{failure}</FormAlert>
        ) : null}

        <SubmitButton pending={pending} pendingLabel="Saving…" disabled={blocked}>
          Continue
        </SubmitButton>

        <div className="flex items-center justify-between pt-1">
          <BackLink onClick={() => router.back()} />
          {/*
            Skipping finishes the same call with `completed: false`. The record
            is created; the setup is not marked done, so the profile page can
            ask for the rest later.
          */}
          <button
            type="button"
            disabled={pending}
            onClick={() => void finish(false)}
            className={cn(
              "text-[0.8125rem] font-medium text-fg-muted underline-offset-4 transition-colors",
              "hover:text-fg hover:underline focus-visible:text-fg focus-visible:underline",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            Skip for now
          </button>
        </div>
      </form>
    </AuthShell>
  );
}
