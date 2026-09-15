/**
 * The operational cycle a truck is in.
 *
 * This is the key that stops one empty truck producing two MT Loop entries.
 *
 * An MT Loop is a CYCLE: the span between a truck coming free and its next
 * load having run. Availability is decided repeatedly — on every board read,
 * every new position, every workflow event — and each of those decisions is a
 * fresh reading of the SAME cycle. Without a stable key for "which cycle is
 * this", a second reading looks like a second empty truck, and the board grows
 * a duplicate that two dispatchers then work in parallel.
 *
 * The key is derived from facts that do not change inside a cycle:
 *
 *   truckId          the equipment the cycle is about
 *   loadId           the load the truck is finishing, when there is one
 *
 * A truck finishing load NL-24817 is in cycle `<truck>::load:<id>`, whatever
 * anybody re-reads, and stays in it until that load comes off. When the truck
 * is between loads there is no load to name, so the cycle is keyed by the
 * moment it went free, ROUNDED to a window: two decisions ten minutes apart
 * about the same idle truck are the same cycle, not two.
 */

/** The window idle cycles are bucketed into. */
export const IDLE_CYCLE_WINDOW_HOURS = 12;

const HOUR_MS = 3_600_000;

export interface CycleKeyInput {
  truckId: string;
  /** The load the truck is currently finishing, if any. */
  loadId?: string;
  /**
   * When the truck went — or is expected to go — free. Only consulted when
   * there is no load, and bucketed rather than used verbatim.
   */
  emptyAt?: string;
}

/**
 * The stable identifier for one operational cycle.
 *
 * Pure, and pure on purpose: two callers, two processes and a test all derive
 * the same string from the same facts, which is what makes deduplication
 * something the data enforces rather than something a service remembers.
 */
export function operationalCycleKey(input: CycleKeyInput): string {
  if (input.loadId) return `${input.truckId}::load:${input.loadId}`;

  const at = input.emptyAt ? Date.parse(input.emptyAt) : Number.NaN;
  if (Number.isNaN(at)) return `${input.truckId}::idle:unknown`;

  const bucket = Math.floor(at / (IDLE_CYCLE_WINDOW_HOURS * HOUR_MS));
  return `${input.truckId}::idle:${bucket}`;
}

/** True when two decisions are readings of one and the same cycle. */
export function isSameCycle(a: string, b: string): boolean {
  return a === b;
}

/** The truck a cycle key is about, without parsing meaning into the rest. */
export function truckIdOfCycle(cycleKey: string): string {
  const at = cycleKey.indexOf("::");
  return at === -1 ? cycleKey : cycleKey.slice(0, at);
}
