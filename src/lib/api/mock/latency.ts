/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * The simulated round trip, and the one way to turn it off.
 *
 * ★ WHY THE DELAY EXISTS ★
 * Every mock service waits a couple of hundred milliseconds before answering,
 * so screens are built against a world where data arrives late. A loading state
 * that is never exercised is a loading state that does not work, and an app
 * built against instant reads acquires flicker, races and empty first frames
 * that only show up once a real network is underneath it.
 *
 * ★ WHY IT HAS A SWITCH ★
 * A fixture that walks a truck through fourteen real service calls would spend
 * four seconds doing it, on a delay that exists to make SCREENS honest and has
 * nothing to teach a seeder. `withoutMockLatency` suppresses it for the
 * duration of one run.
 *
 * ★ WHAT IT IS NOT FOR ★
 * Not for making the app feel faster, and never around anything a person
 * triggered: the delay is the point everywhere else. Seeding and tests only.
 *
 * The flag is a module-level boolean rather than a parameter threaded through
 * every call, because the calls being suppressed are several layers deep in
 * services that have no business knowing they are being seeded. It is restored
 * in a `finally`, so a throw inside the run cannot leave the app permanently
 * fast.
 */

let suppressed = false;

/** The delay every mock service awaits. Honours the switch below. */
export const sleep = (ms: number): Promise<void> =>
  suppressed ? Promise.resolve() : new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run `fn` with the simulated latency turned off.
 *
 * Not re-entrant by design — nesting would need a counter, and the only
 * callers are seeders that run once. It restores the previous value rather
 * than hard-setting `false`, so a nested call cannot switch it back on under
 * the outer one.
 */
export function withoutMockLatency<T>(run: () => Promise<T>): Promise<T> {
  const previous = suppressed;
  suppressed = true;
  return run().finally(() => {
    suppressed = previous;
  });
}

/** True while a seeder is running. For a service that wants to say so. */
export const mockLatencySuppressed = () => suppressed;
