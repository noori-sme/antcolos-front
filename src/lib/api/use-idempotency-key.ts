"use client";

import { useCallback, useRef } from "react";
import { type IdempotencySlot, slotForRequest } from "./idempotency-key";

const mint = () => crypto.randomUUID();

/**
 * `keyFor(request)` returns the `Idempotency-Key` for this exact request:
 * the same key when the user retries the identical submit, a new one when
 * anything in it changed (see `slotForRequest`). Pass the route and body.
 */
export function useIdempotencyKey(): { keyFor: (request: unknown) => string } {
  const slot = useRef<IdempotencySlot | null>(null);
  const keyFor = useCallback((request: unknown) => {
    slot.current = slotForRequest(slot.current, request, mint);
    return slot.current.key;
  }, []);
  return { keyFor };
}
