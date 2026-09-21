"use client";

import Link from "next/link";
import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  BROKER_POLICY_REASON_LABEL, BROKER_POLICY_SCOPE_LABEL,
  type BrokerPolicyEvaluation,
} from "@/types";
import { EFFECT_LABEL, EFFECT_TONE, untilLabel } from "./broker-policy-labels";

/**
 * What a broker working policy looks like on a Load Search result and inside an
 * Opportunity.
 *
 * ★ COMPACT BY DEFAULT, EXPLAINED ON DEMAND ★
 * A blocked or ranked-down load carries one badge. The explanation — whose
 * policy, why, until when — opens only when somebody asks for it, because a
 * search result that argued its case in three lines is a search result nobody
 * scans.
 *
 * ★ IT RENDERS WHAT THE MATCH CARRIED ★
 * `evaluation` comes off the match, which the matching service evaluated from
 * the canonical policy record. This component looks nothing up. A screen that
 * asked the registry a question while it rendered would be asking something
 * React cannot see, and would go stale the moment the policy changed.
 *
 * ★ IT NEVER SAYS "BLOCKED" WITHOUT SAYING BY WHOM ★
 * The owning organization and the scope are in the first line of the
 * explanation, always, so a dispatch organization's decision cannot be read as
 * the carrier's.
 */
export function BrokerPolicyChip({
  evaluation,
  /** Where "open the policy" goes. The one canonical record, every time. */
  policiesHref = "/directory/brokers/policies",
  className,
}: {
  evaluation?: BrokerPolicyEvaluation;
  policiesHref?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  // Nothing applies. The overwhelmingly common case, and it renders nothing at
  // all — a badge saying "no policy" on every load would be noise on every load.
  if (!evaluation || evaluation.effect === "none") return null;

  const notice = evaluation.notices[0];
  if (!notice) return null;

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={EFFECT_TONE[evaluation.effect]}>
          <ShieldAlert className="size-3.5" aria-hidden />
          {EFFECT_LABEL[evaluation.effect]}
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? "Hide why" : "Why?"}
        </Button>
      </div>

      {open ? (
        <div className="mt-2 rounded-md border border-border bg-canvas px-3 py-2.5 text-[0.8125rem]">
          <p className="font-medium text-fg">
            {notice.owningOrganizationName} · {BROKER_POLICY_SCOPE_LABEL[notice.scope]}
          </p>
          <p className="mt-0.5 text-fg-muted">
            {BROKER_POLICY_REASON_LABEL[notice.reason]}
            {notice.expiresAt ? ` · lifts ${untilLabel(notice.expiresAt)}` : ""}
            {notice.awaitingApproval ? " · waiting on an owner decision" : ""}
          </p>
          {notice.explanation ? (
            <p className="mt-1.5 text-fg">{notice.explanation}</p>
          ) : (
            <p className="mt-1.5 text-fg-subtle italic">
              {notice.owningOrganizationName} keeps its reasoning private.
            </p>
          )}
          {evaluation.notices.length > 1 ? (
            <p className="mt-1.5 text-[0.75rem] text-fg-subtle">
              {evaluation.notices.length - 1} other{" "}
              {evaluation.notices.length === 2 ? "policy" : "policies"} also apply.
            </p>
          ) : null}
          <Link
            href={policiesHref}
            className="mt-2 inline-block text-[0.75rem] font-medium text-st-info hover:underline"
          >
            Open the policy
          </Link>
        </div>
      ) : null}
    </div>
  );
}
