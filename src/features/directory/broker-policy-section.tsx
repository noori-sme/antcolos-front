"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { useServiceContext } from "@/lib/api/use-service-context";
import { brokerPoliciesFor } from "@/lib/api/mock/broker-policy-registry";
import type { BrokerPolicyListing } from "@/types";
import {
  BROKER_POLICY_ACTION_LABEL, BROKER_POLICY_REASON_LABEL,
  BROKER_POLICY_SCOPE_LABEL, BROKER_POLICY_STATUS_LABEL,
} from "@/types";
import {
  ACTION_TONE, STATUS_TONE, formatPolicyDate, untilLabel,
} from "./broker-policy-labels";

/**
 * The working policies concerning ONE broker, on that broker's own profile.
 *
 * ★ THE PROFILE IS SHARED; THIS SECTION IS NOT ★
 * Everything else on a broker profile is a fact about the world — the legal
 * name, the MC number, the operating authority — and is the same for everybody.
 * This is one organization's private operating decision, read through the
 * policy registry with the viewer's own context, so a carrier sees its own and
 * never another's.
 *
 * ★ AND THE BROKER NEVER SEES IT ★
 * A claimed brokerage can edit its own contact details on this profile. It
 * cannot read this section, because the registry has no path that would return
 * another organization's policies to it — the same rule that already keeps
 * private notes, ratings and payment experience out of a claimant's reach.
 */
export function BrokerPolicySection({
  brokerPartyId,
  /**
   * Bumped by whoever writes a policy on this screen.
   *
   * The registry is not React state, so setting a policy changes nothing this
   * component could observe on its own. This is the signal to look again, and
   * it is why the section updates the moment the dialog closes rather than on
   * the next full page load.
   */
  version = 0,
}: {
  brokerPartyId: string;
  version?: number;
}) {
  const ctx = useServiceContext();
  /*
   * Read while rendering rather than into state from an effect.
   *
   * The registry is synchronous and in-memory: there is no request to wait for,
   * so copying its answer into state would only add a second render and a
   * moment where the screen shows the previous broker's policies. It re-reads
   * whenever the viewer's context or the broker changes, which is the whole of
   * what the effect was doing.
   */
  const rows = useMemo<BrokerPolicyListing[] | null>(() => {
    void version;
    return ctx ? brokerPoliciesFor(ctx, { brokerPartyId }) : null;
  }, [ctx, brokerPartyId, version]);

  if (!ctx || rows === null) return null;

  return (
    <section
      aria-labelledby="broker-working-policy"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="broker-working-policy" className="text-[0.875rem] font-semibold text-fg">
          Working policy
        </h2>
        <Link
          href="/directory/brokers/policies"
          className="text-[0.75rem] font-medium text-st-info hover:underline"
        >
          All broker policies
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-fg-muted">
          No policy. Their freight is searched, ranked and booked exactly like
          anybody else&rsquo;s.
        </p>
      ) : (
        <ul className="mt-2.5 space-y-2">
          {rows.map((row) => (
            <li
              key={row.policy.policyId}
              className="rounded-md border border-border bg-canvas px-3 py-2.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={ACTION_TONE[row.policy.action]}>
                  {BROKER_POLICY_ACTION_LABEL[row.policy.action]}
                </Badge>
                <Badge tone={STATUS_TONE[row.currentStatus]}>
                  {BROKER_POLICY_STATUS_LABEL[row.currentStatus]}
                </Badge>
                {row.awaitingApproval ? (
                  <Badge tone="info">Owner decision required</Badge>
                ) : null}
              </div>
              {/* Whose decision, always. Never left to be inferred. */}
              <p className="mt-1 text-[0.8125rem] text-fg-muted">
                {row.policy.organizationNameSnapshot} ·{" "}
                {BROKER_POLICY_SCOPE_LABEL[row.policy.scope]} ·{" "}
                {BROKER_POLICY_REASON_LABEL[row.policy.reason]}
              </p>
              <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                From {formatPolicyDate(row.policy.effectiveFrom)}
                {row.policy.expiresAt
                  ? ` · lifts ${untilLabel(row.policy.expiresAt)}`
                  : " · no expiry"}
                {" · proposed by "}
                {row.policy.proposedBy.displayNameSnapshot}
                {row.policy.approvedBy
                  ? ` · approved by ${row.policy.approvedBy.displayNameSnapshot}`
                  : ""}
              </p>
              {row.mayReadExplanation ? (
                <p className="mt-1.5 text-[0.8125rem] text-fg">{row.policy.explanation}</p>
              ) : (
                <p className="mt-1.5 text-[0.8125rem] text-fg-subtle italic">
                  {row.policy.organizationNameSnapshot} keeps its reasoning private.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
