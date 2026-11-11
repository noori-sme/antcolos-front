"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
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
 * One object URL per picture blob, shared by every component showing it (the
 * top bar and the profile screen) and never revoked by an unmount, so a
 * remount (StrictMode included) can't be handed a dead URL. The previous
 * version's URL is revoked when a new picture arrives: at most one live URL.
 */
const urlByBlob = new WeakMap<Blob, string>();
let currentUrl: { blob: Blob; url: string } | null = null;
function objectUrlFor(blob: Blob): string {
  const known = urlByBlob.get(blob);
  if (known) return known;
  const url = URL.createObjectURL(blob);
  urlByBlob.set(blob, url);
  if (currentUrl) URL.revokeObjectURL(currentUrl.url);
  currentUrl = { blob, url };
  return url;
}

/**
 * An object URL for the profile picture, or undefined. The picture endpoint
 * needs the bearer token, so it can't be an `<img src>`: the bytes are fetched
 * once per stored version (`avatar.updatedAt`).
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
  const url = useMemo(() => (blob ? objectUrlFor(blob) : undefined), [blob]);
  return profile?.avatar ? url : undefined;
}
