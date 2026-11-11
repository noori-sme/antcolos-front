"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { orgKey } from "@/lib/query/keys";
import { API_MODE } from "./mode";
import { services } from "./index";
import { useServiceContext } from "./use-service-context";

/**
 * Shared reads for the signed-in person's own profile (plan 11). The profile
 * screen and the top bar both read it, so it lives here; the feature's
 * `hooks.ts` holds the writes.
 *
 * The record belongs to the person, not the organization, but the keys still
 * start with `orgKey`: switching organization clears the cache, so the cost is
 * one fetch per organization.
 */
export const selfProfileKeys = {
  all: (organizationId: string) => [...orgKey(organizationId), "self-profile"] as const,
  profile: (organizationId: string) =>
    [...orgKey(organizationId), "self-profile", "profile"] as const,
  avatar: (organizationId: string, version: string) =>
    [...orgKey(organizationId), "self-profile", "avatar", version] as const,
};

/** http mode only: mock mode has no `/users/me` to read. */
export function useSelfProfile() {
  const ctx = useServiceContext();
  return useQuery({
    queryKey: ctx
      ? selfProfileKeys.profile(ctx.organizationId)
      : [...orgKey("none"), "self-profile", "no-context"],
    queryFn: () => services.selfProfile.get(ctx!),
    enabled: Boolean(ctx) && API_MODE === "http",
  });
}

/**
 * An object URL for the profile picture, or undefined. The picture endpoint
 * needs the bearer token, so it can't be an `<img src>`: the bytes are fetched
 * once per stored version (`avatar.updatedAt`) and the URL is revoked when it
 * changes or the component unmounts.
 */
export function useSelfAvatarUrl(): string | undefined {
  const ctx = useServiceContext();
  const { data: profile } = useSelfProfile();
  const version = profile?.avatar?.updatedAt;
  const { data: blob } = useQuery({
    queryKey: ctx && version
      ? selfProfileKeys.avatar(ctx.organizationId, version)
      : [...orgKey("none"), "self-profile", "avatar", "none"],
    queryFn: () => services.selfProfile.avatarBlob(ctx!),
    enabled: Boolean(ctx) && Boolean(version),
    staleTime: Infinity,
  });
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : undefined), [blob]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  return profile?.avatar ? url : undefined;
}
