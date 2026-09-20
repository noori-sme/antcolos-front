"use client";

import { MapPin } from "lucide-react";
import { avatarInitials } from "@/lib/profile/avatar";
import { displayHandle } from "@/lib/profile/identity";
import { formatDuration, formatMonth } from "@/lib/profile/tenure";
import { cn } from "@/lib/utils";
import type { ProfileView } from "@/types";
import { VERIFICATION_ICON, VERIFICATION_LABEL } from "./icons";

/** The avatar, at whatever size the surface needs. */
export function ProfileAvatar({
  src, fullName, className,
}: { src?: string; fullName: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full",
        "border border-border bg-surface-sunken font-semibold text-fg-muted",
        className,
      )}
    >
      {src ? (
        // A data URL or a stored avatar URL; nothing next/image could optimize.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        avatarInitials(fullName)
      )}
    </span>
  );
}

/**
 * The identity block: who this is, what they say they do, and what Antcolos
 * has actually checked.
 *
 * Verifications sit next to the name because they are the only claims on the
 * page that are not the person's own. Everything below this block is either
 * derived from work or written by them, and the distinction is worth making
 * visible at the top rather than explaining further down.
 */
export function ProfileHeader({
  view,
  actions,
}: {
  view: ProfileView;
  actions?: React.ReactNode;
}) {
  const { profile, tenure } = view;

  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 gap-4">
        <ProfileAvatar
          src={profile.avatarUrl}
          fullName={profile.fullName}
          className="size-16 text-[1.125rem] sm:size-20 sm:text-[1.375rem]"
        />
        <div className="min-w-0">
          <h1 className="text-[1.375rem] leading-8 font-semibold tracking-[-0.015em] text-fg">
            {profile.fullName}
          </h1>
          <p className="mt-0.5 font-mono text-[0.8125rem] text-fg-subtle">
            {displayHandle(profile.username)}
          </p>
          {profile.headline ? (
            <p className="mt-2 max-w-prose text-[0.875rem] leading-relaxed text-fg-muted">
              {profile.headline}
            </p>
          ) : null}

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[0.75rem] text-fg-subtle">
            {profile.location ? (
              <span className="inline-flex items-center gap-1">
                <MapPin aria-hidden className="size-3.5" />
                {profile.location}
              </span>
            ) : null}
            <span>
              Joined {formatMonth(tenure.joinedAt)} · {formatDuration(tenure.daysOnPlatform)} on Antcolos
            </span>
            {tenure.organizationsWorkedWith > 0 ? (
              <span>
                {tenure.organizationsWorkedWith} organization
                {tenure.organizationsWorkedWith === 1 ? "" : "s"} · {formatDuration(tenure.activeDays)} working
              </span>
            ) : null}
          </div>

          {profile.verifications.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {profile.verifications.map((verification) => {
                const Icon = VERIFICATION_ICON[verification.kind];
                return (
                  <li
                    key={verification.kind}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-sm bg-st-success-bg px-2 py-0.5",
                      "text-[0.75rem] leading-5 font-medium text-st-success",
                    )}
                    title={`Checked ${formatMonth(verification.verifiedAt)}`}
                  >
                    <Icon aria-hidden className="size-3.5" />
                    {VERIFICATION_LABEL[verification.kind]}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </div>

      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
