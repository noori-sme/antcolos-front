/**
 * Correlation and request identity.
 *
 * `correlationId` groups everything ONE INTENT produced, across modules. Ending
 * a carrier relationship closes document links, revokes shares and freezes
 * compliance requirements; those are several events in several modules, and the
 * only way to read them back as one act is a shared correlation id.
 *
 * `requestId` identifies the single call that produced ONE event. Two events
 * never share one. It is what an engineer joins on when a customer says "this
 * happened at 14:02 and I don't know why".
 *
 * Both are opaque. Nothing parses them, and nothing infers ordering from them.
 */

let counter = 0;

function token(): string {
  counter += 1;
  const random = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}${counter.toString(36)}${random}`;
}

export function newCorrelationId(): string {
  return `cor_${token()}`;
}

export function newRequestId(): string {
  return `req_${token()}`;
}

/**
 * Runs a piece of work under one correlation id, so every event it appends is
 * joined without each call site remembering to pass one.
 *
 * Deliberately synchronous-scoped and re-entrant rather than an async context:
 * the mock adapter is single-threaded, and a real backend would carry the same
 * value on the request rather than in a module-level variable.
 */
let currentCorrelationId: string | null = null;

export function withCorrelation<T>(correlationId: string, fn: () => T): T {
  const previous = currentCorrelationId;
  currentCorrelationId = correlationId;
  try {
    return fn();
  } finally {
    currentCorrelationId = previous;
  }
}

/** The correlation in force, or a fresh one when this event stands alone. */
export function ambientCorrelationId(): string {
  return currentCorrelationId ?? newCorrelationId();
}

/** Test helper. Nothing in the app calls this. */
export function resetCorrelationCounter(): void {
  counter = 0;
  currentCorrelationId = null;
}
