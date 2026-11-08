/**
 * One `Idempotency-Key` per request signature. The backend hashes method,
 * route, params and body, and refuses (400) a key reused with a different
 * request even after a failed attempt. So: an identical retry keeps its key
 * (the server replays or re-runs it safely); any change to the request (a
 * different person, a fixed unit number, another status) gets a new one.
 */
export interface IdempotencySlot {
  signature: string;
  key: string;
}

export function slotForRequest(
  previous: IdempotencySlot | null,
  request: unknown,
  mint: () => string,
): IdempotencySlot {
  const signature = JSON.stringify(request);
  if (previous && previous.signature === signature) return previous;
  return { signature, key: mint() };
}
