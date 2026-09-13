"use client";

import { useSyncExternalStore } from "react";

const BUCKET_MS = 30_000;

function subscribe(onChange: () => void) {
  const timer = setInterval(onChange, BUCKET_MS);
  return () => clearInterval(timer);
}

/**
 * A ticking "now" that is stable within a 30-second bucket, so reading it during
 * render stays pure and the server and client never disagree. Returns null until
 * hydrated — render a placeholder for that first paint.
 */
export function useNow(): number | null {
  return useSyncExternalStore(
    subscribe,
    () => Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS,
    () => null,
  );
}
