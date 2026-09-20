"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { services } from "@/lib/api";
import type {
  AvatarUploadInput, InitializeProfileInput, RecordContributionInput,
  UpdateProfileInput, VisibilityInput,
} from "@/lib/api/contracts/profile";
import { useServiceContext } from "@/lib/api/use-service-context";
import type { ProfileViewer } from "@/lib/profile/visibility";
import { useSession } from "@/lib/session/hooks";
import type { Username } from "@/types";

/**
 * ★ PROFILE KEYS ARE NOT NAMESPACED BY ORGANIZATION ★
 *
 * Every other query key in this app starts with `["org", organizationId]`,
 * because every other record belongs to an organization and org A's data must
 * never be served from cache to a screen rendered under org B. A profile
 * belongs to a person and is identical in every workspace, so namespacing it
 * would mean re-fetching the same record on every organization switch and
 * quietly implying it might differ between them.
 *
 * It is keyed by VIEWER instead, which is the thing that actually changes the
 * answer: the same handle shows different sections to its owner, to a signed-in
 * stranger and to somebody signed out.
 */
export const profileKeys = {
  own: (userId: string) => ["profile", "own", userId] as const,
  byUsername: (username: Username, viewerId: string | null) =>
    ["profile", "handle", username, viewerId ?? "anonymous"] as const,
  shareCard: (username: Username, achievementKey: string | null) =>
    ["profile", "share-card", username, achievementKey ?? "profile"] as const,
};

/** Who is looking. An optional user id, and deliberately nothing else. */
export function useProfileViewer(): ProfileViewer {
  const { user } = useSession();
  return useMemo(() => ({ userId: user.id }), [user.id]);
}

export function useOwnProfile() {
  const viewer = useProfileViewer();
  return useQuery({
    queryKey: profileKeys.own(viewer.userId ?? "anonymous"),
    queryFn: () => services.profile.getOwn(viewer),
  });
}

/**
 * A profile as the PUBLIC page shows it — always read with no viewer.
 *
 * ★ EVEN WHEN THE READER IS THE OWNER ★
 * `/profile/[username]` is the page a stranger gets, so it is read as a
 * stranger. That makes "View public page" show what is actually published
 * rather than a friendlier version of it, and it means an owner cannot be
 * misled by their own sections into thinking they published something they
 * did not. The owner's own view lives at /account/profile and is read with
 * their id.
 */
export function usePublicProfile(username: Username) {
  return useQuery({
    queryKey: profileKeys.byUsername(username, null),
    queryFn: () => services.profile.getByUsername({}, username),
    // A career record is not a live dashboard. A minute of staleness is
    // invisible to a reader and saves a round trip on every back-navigation.
    staleTime: 60_000,
  });
}

/**
 * The card a person's network will actually see.
 *
 * Fetched from the service rather than built from the view on screen, and the
 * difference is the point: the service builds it AS A STRANGER, so the preview
 * in the dialog cannot show a figure the profile withholds from whoever opens
 * the link. Enabled only while the dialog is open.
 */
export function useShareCard(
  username: Username,
  achievementKey: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: profileKeys.shareCard(username, achievementKey),
    queryFn: () => services.profile.shareCard({
      username,
      achievementKey: achievementKey ?? undefined,
      // The service has no origin of its own; the browser does.
      origin: window.location.origin,
    }),
    enabled: enabled && Boolean(username),
    staleTime: 0,
  });
}

/** Invalidates every profile query, because they are all about one person. */
function useProfileInvalidation() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ["profile"] });
  };
}

export function useInitializeProfile() {
  const viewer = useProfileViewer();
  const invalidate = useProfileInvalidation();
  return useMutation({
    mutationFn: (input: InitializeProfileInput) => services.profile.initialize(viewer, input),
    onSuccess: invalidate,
  });
}

export function useUpdateProfile() {
  const viewer = useProfileViewer();
  const invalidate = useProfileInvalidation();
  return useMutation({
    mutationFn: (input: UpdateProfileInput) => services.profile.update(viewer, input),
    onSuccess: invalidate,
  });
}

export function useSetProfileVisibility() {
  const viewer = useProfileViewer();
  const invalidate = useProfileInvalidation();
  return useMutation({
    mutationFn: (input: VisibilityInput) => services.profile.setVisibility(viewer, input),
    onSuccess: invalidate,
  });
}

export function useUploadAvatar() {
  const viewer = useProfileViewer();
  const invalidate = useProfileInvalidation();
  return useMutation({
    mutationFn: (input: AvatarUploadInput) => services.profile.uploadAvatar(viewer, input),
    onSuccess: invalidate,
  });
}

export function useRemoveAvatar() {
  const viewer = useProfileViewer();
  const invalidate = useProfileInvalidation();
  return useMutation({
    mutationFn: () => services.profile.removeAvatar(viewer),
    onSuccess: invalidate,
  });
}

/**
 * Posting a unit of work — the one profile write that is organization-scoped.
 *
 * Exposed as a hook so the modules that own the underlying records can call it
 * from where the work actually completes. Nothing calls it today: in the mock
 * the ledger is seeded, and wiring every module's completion path into it is a
 * separate change with its own blast radius. The seam is here and typed so
 * that wiring is a one-line addition rather than a redesign.
 */
export function useRecordContribution() {
  const ctx = useServiceContext();
  const invalidate = useProfileInvalidation();
  return useMutation({
    mutationFn: (input: RecordContributionInput) => {
      if (!ctx) throw new Error("No workspace selected.");
      return services.profile.recordContribution(ctx, input);
    },
    onSuccess: invalidate,
  });
}
