"use client";

import { useCallback, useState } from "react";

const newKey = () => crypto.randomUUID();

/**
 * One `Idempotency-Key` per user intent (data-layer rule). Read `key` when
 * submitting: a retry of the same submit reuses it, so the server replays the
 * first result instead of acting twice. Call `renew()` once the intent is done
 * (after success, or when the user starts a new action).
 */
export function useIdempotencyKey(): { key: string; renew: () => void } {
  const [key, setKey] = useState(newKey);
  const renew = useCallback(() => setKey(newKey()), []);
  return { key, renew };
}
