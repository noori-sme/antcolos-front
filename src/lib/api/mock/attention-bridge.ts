import type { NeedsYouItem } from "@/types";
import type { ServiceContext } from "../contracts/context";
import { urgencyScore } from "./needs-you";

/**
 * ███ MOCK-LAYER BRIDGE ███
 *
 * The one place a surface turns "everything I can see" into "what needs me".
 *
 * It exists as its own module for a boring but load-bearing reason: `home.ts`
 * and `responsibility.ts` would otherwise import each other, because the
 * responsibility service reads the Needs You queue and Home needs the
 * responsibility service's answer. The cycle is broken here with a lazy import
 * rather than by letting Home keep a filtering rule of its own — which is
 * exactly what this whole change is removing.
 *
 * If the derivation ever fails, Home shows NOTHING rather than falling back to
 * the unfiltered queue. That is deliberate: an empty personal list is a true
 * statement a person can act on, and a list of 142 items that do not need them
 * is not.
 */
export async function personalNeedsYouItems(
  ctx: ServiceContext,
  visible: readonly NeedsYouItem[],
): Promise<NeedsYouItem[]> {
  try {
    // Lazily imported to break the Home ⇄ responsibility import cycle.
    const { personalNeedsYouIds } = await import("./responsibility");
    const mine = new Set(await personalNeedsYouIds(ctx));
    return visible
      .filter((i) => mine.has(i.id))
      .sort((a, b) => urgencyScore(a) - urgencyScore(b));
  } catch {
    // See the header: an honest empty list beats an unfiltered one.
    return [];
  }
}
