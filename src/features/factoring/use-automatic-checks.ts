"use client";

import { useEffect, useRef } from "react";
import type { MatchWithListing } from "@/types";
import { services } from "@/lib/api";
import type { ServiceContext } from "@/lib/api/contracts/context";

/**
 * Run the carrier's factoring checks in the background, for the loads a
 * dispatcher is already looking at.
 *
 * ★ THE DISPATCHER DOES NOT PRESS ANYTHING ★
 * Where the carrier's connection can answer on its own, factoring is not a step
 * — it is a fact that appears on the row. This hook is what makes that true:
 * every discovered load with an identified broker MC that has no current answer
 * is checked, once, and the surfaces re-read when the answers land.
 *
 * ★ AND IT IS DELIBERATELY STINGY ★
 * With most factors a credit check costs the carrier money, and a search screen
 * that re-checked on every render would spend it. Three rules hold that down:
 *
 *  1. Only rows whose connection is AUTOMATIC. A carrier whose answers come by
 *     email is not quietly emailed by a React effect.
 *  2. Only rows with no current answer, or one that has expired.
 *  3. One attempt per broker per carrier per window, remembered across
 *     components — so the Load Search panel and the Opportunity list, which
 *     show overlapping rows, do not each fire the same check.
 *
 * Nothing here contacts a factoring company: `services.factoring.check` runs
 * the carrier's configured adapter, and the only adapter that answers today is
 * the labelled development one.
 */

/** Attempts, keyed by carrier and broker. Shared by every surface on the page. */
const attempted = new Map<string, number>();

/** How long an attempt is remembered. Long enough to survive a refresh storm. */
const WINDOW_MS = 120_000;

/** Test and demo hook. Never called by a screen. */
export function resetAutomaticFactoringChecks() {
  attempted.clear();
}

export function useAutomaticFactoringChecks(
  rows: readonly MatchWithListing[],
  ctx: ServiceContext | null,
  onChecked: () => void,
) {
  /** Guards against a second pass starting while the first is still running. */
  const running = useRef(false);

  useEffect(() => {
    if (!ctx || running.current) return;

    const now = Date.now();
    const due = new Map<string, MatchWithListing>();

    for (const row of rows) {
      const status = row.factoring;
      if (!status?.automatic) continue;
      if (status.everChecked && !status.recheckRequired) continue;
      const mc = row.listing.broker.mcNumber;
      // No MC, no question: a factor answers on an identifier, not on a name.
      if (!mc) continue;

      const key = `${row.match.carrierOrganizationId}:${mc}`;
      const last = attempted.get(key);
      if (last !== undefined && now - last < WINDOW_MS) continue;
      // One row per broker: three loads from the same broker are one check.
      if (!due.has(key)) due.set(key, row);
    }

    if (due.size === 0) return;
    running.current = true;
    for (const key of due.keys()) attempted.set(key, now);

    let live = true;
    void (async () => {
      let changed = false;
      // Sequentially, not in parallel: a provider's rate limit is the reason
      // this exists as a queue rather than a Promise.all.
      for (const row of due.values()) {
        try {
          await services.factoring.check(ctx, {
            carrierOrganizationId: row.match.carrierOrganizationId,
            brokerNameObserved: row.listing.broker.name,
            brokerMcNumber: row.listing.broker.mcNumber,
            proposedAmountCents: row.listing.offeredRateCents,
            dispatchCycleId: row.match.dispatchCycleId,
            listingId: row.listing.listingId,
          });
          changed = true;
        } catch {
          // A carrier this workspace may not reach, or no permission to check.
          // Nothing is asserted either way and the row keeps what it had.
        }
      }
      running.current = false;
      // One refresh for the whole batch. A refresh per answer would re-render
      // the list under the dispatcher's cursor several times a second.
      if (live && changed) onChecked();
    })();

    return () => { live = false; };
    // `onChecked` is a stable refresher from the screen above; including it
    // would re-run this on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, ctx]);
}
