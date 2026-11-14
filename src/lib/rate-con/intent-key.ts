/**
 * One Idempotency-Key per user intent (data-layer rule): the same intent
 * retried reuses its key; a different intent, or any intent after `clear()`,
 * gets a new one. Pure, so it is testable without React.
 */
export function createIntentKeys(newKey: () => string = () => crypto.randomUUID()) {
  let current: { intent: string; key: string } | null = null;
  return {
    keyFor(intent: string): string {
      if (current?.intent !== intent) current = { intent, key: newKey() };
      return current.key;
    },
    clear(): void {
      current = null;
    },
  };
}
