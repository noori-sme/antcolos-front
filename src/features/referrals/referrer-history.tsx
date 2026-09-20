"use client";

import { Plus, Send, UserPlus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { services } from "@/lib/api";
import {
  REFERRER_STATUS_LABEL, type ReferrerReferralView, type ReferrerVisibleStatus,
} from "@/types";
import { useReferringIdentity } from "./identity";

/**
 * The referrer's own list, and deliberately a thin one.
 *
 * ★ WHAT IS NOT ON THIS SCREEN ★
 * The company's internal note. Who inside the company read it. Whether the
 * address already had an Antcolos account. Whether the person reported the
 * introduction as unwanted — that reads as "Candidate declined", because
 * telling somebody they were reported turns a confidential report into an
 * argument. The email addresses are masked: the referrer typed them and knows
 * them, but a list of readable addresses is an export of other people's
 * contact details.
 *
 * Everything shown is `ReferrerVisibleStatus`, derived by the service. This
 * screen computes no status of its own.
 */

const TONE: Record<ReferrerVisibleStatus, "neutral" | "info" | "success" | "warning" | "outline"> = {
  sent: "info",
  company_reviewing: "info",
  company_interested: "success",
  // Not a failure, and not green. A company passing is an ordinary outcome.
  company_passed: "outline",
  candidate_declined: "warning",
  withdrawn: "neutral",
  closed: "neutral",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
}

export function ReferrerHistory() {
  const identity = useReferringIdentity();
  const [rows, setRows] = useState<ReferrerReferralView[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    services.referrals.myReferrals(identity).then((list) => {
      if (!cancelled) setRows(list);
    });
    return () => {
      cancelled = true;
    };
  }, [identity]);

  useEffect(load, [load]);

  async function withdraw(id: string) {
    setBusyId(id);
    setMessage(null);
    const updated = await services.referrals.withdraw(identity, id);
    setBusyId(null);
    if (!updated) {
      setMessage("That referral could not be withdrawn.");
      return;
    }
    setRows((prev) => prev?.map((r) => (r.id === updated.id ? updated : r)) ?? null);
  }

  async function resend(id: string) {
    setBusyId(id);
    setMessage(null);
    const result = await services.referrals.resend(identity, id);
    setBusyId(null);
    // One sentence whatever the reason. The refusals are deliberately
    // indistinguishable — see the service.
    setMessage(result.status === "queued"
      ? "Queued. We will not send it again after this."
      : result.message);
    load();
  }

  return (
    <div className="space-y-section">
      <PageHeader
        title="Your referrals"
        description="People you have introduced to companies on Antcolos, and roughly where each introduction got to."
        actions={
          <Button variant="primary" asChild>
            <Link href="/account/referrals/new">
              <Plus aria-hidden />
              Refer someone
            </Link>
          </Button>
        }
      />

      {message ? (
        <p
          role="status"
          className="rounded-lg border border-border bg-surface-sunken px-4 py-3 text-[0.8125rem] text-fg"
        >
          {message}
        </p>
      ) : null}

      {rows === null ? <LoadingSkeleton /> : rows.length === 0 ? (
        <EmptyState
          icon={UserPlus}
          title="You have not referred anybody yet"
          description="Anyone on Antcolos can introduce a person to any company here. It creates no account, no membership and no obligation on either side."
          action={(
            <Button variant="primary" asChild>
              <Link href="/account/referrals/new">Refer someone</Link>
            </Button>
          )}
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded-lg border border-border bg-surface p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[0.9375rem] font-semibold text-fg">
                    {row.candidateName}
                  </p>
                  <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
                    {row.proposedTitle} · {row.targetOrganizationName}
                  </p>
                  <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                    {row.candidateEmailMasked} · sent {formatDate(row.submittedAt)}
                    {" · "}
                    {row.reference}
                  </p>
                </div>
                <Badge tone={TONE[row.status]}>{REFERRER_STATUS_LABEL[row.status]}</Badge>
              </div>

              {(row.canWithdraw || row.canResend) ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {row.canResend ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => resend(row.id)}
                      disabled={busyId === row.id}
                    >
                      <Send aria-hidden />
                      Send again
                    </Button>
                  ) : null}
                  {row.canWithdraw ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => withdraw(row.id)}
                      disabled={busyId === row.id}
                    >
                      Withdraw
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <p className="text-[0.75rem] text-fg-subtle">
        You see where an introduction got to and nothing else. What a company
        writes about somebody internally, and what the person you referred told
        them, is theirs.
      </p>
    </div>
  );
}
