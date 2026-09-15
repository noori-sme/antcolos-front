import type { ResponsibilityWorkKind } from "@/types";
import type { ServiceContext } from "../contracts/context";
import type { CanonicalHolder } from "./responsibility";

/**
 * ███ MOCK-LAYER BRIDGE ███
 *
 * How a domain module reaches the Responsibility Engine without the two
 * importing each other.
 *
 * `responsibility.ts` reads MT Loop and Needs You — that is its job, it routes
 * their work. Those modules now have to read back the one answer to "who is
 * responsible for this", and a direct import would close the cycle. It is
 * broken here with a lazy import, the same way `attention-bridge.ts` breaks the
 * Home ⇄ responsibility cycle.
 *
 * ★ WHAT THIS IS NOT ★
 * It is not a second routing rule, it holds no state, and it is READ-ONLY. The
 * traffic goes one way: a module asks the engine who holds the work. Nothing
 * here writes an answer back, because a module that could write one would be
 * the second source of truth all over again. A person's acceptance reaches the
 * engine as a fact on the record — `claimedByMembershipId` — and the engine
 * decides what it means.
 */

/**
 * The canonical responsible party for every piece of work of one kind.
 *
 * Returns an EMPTY map if the responsibility layer cannot be read at all, and
 * the caller must say so rather than filling the gap with a guess. A board
 * that quietly invents "nobody" when it simply failed to ask is how the
 * original disagreement read to a dispatcher.
 */
export async function canonicalResponsibleFor(
  ctx: ServiceContext,
  kind: ResponsibilityWorkKind,
): Promise<Map<string, CanonicalHolder>> {
  try {
    const { canonicalHolders } = await import("./responsibility");
    return await canonicalHolders(ctx, kind);
  } catch {
    return new Map();
  }
}
