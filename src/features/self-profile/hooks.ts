"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { services } from "@/lib/api";
import { useServiceContext } from "@/lib/api/use-service-context";
import {
  selfProfileKeys, useSelfAvatarUrl, useSelfProfile,
} from "@/lib/api/use-self-profile";
import type { SelfProfile, SelfProfilePatch } from "@/types/self-profile";

export { useSelfAvatarUrl, useSelfProfile };

/**
 * Every write returns the full profile (profile.md §8), so the cache is set
 * from the response rather than refetched. The picture query is keyed by its
 * version, so a new `avatar.updatedAt` fetches the new bytes by itself.
 */
function useSelfProfileWrite<TInput>(write: (input: TInput) => Promise<SelfProfile>) {
  const ctx = useServiceContext();
  const client = useQueryClient();
  return useMutation({
    mutationFn: write,
    onSuccess: (profile) => {
      if (ctx) client.setQueryData(selfProfileKeys.profile(ctx.organizationId), profile);
    },
  });
}

export function useUpdateSelfProfile() {
  const ctx = useServiceContext();
  return useSelfProfileWrite((patch: SelfProfilePatch) => services.selfProfile.update(ctx!, patch));
}

export function useUploadSelfAvatar() {
  const ctx = useServiceContext();
  return useSelfProfileWrite((file: File) => services.selfProfile.uploadAvatar(ctx!, file));
}

export function useRemoveSelfAvatar() {
  const ctx = useServiceContext();
  return useSelfProfileWrite(() => services.selfProfile.removeAvatar(ctx!));
}
