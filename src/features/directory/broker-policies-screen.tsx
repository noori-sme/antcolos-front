"use client";

import { ArrowLeft, ChevronRight, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { useServiceContext } from "@/lib/api/use-service-context";
import {
  brokerPoliciesFor, rejectBrokerPolicy, revokeBrokerPolicy,
} from "@/lib/api/mock/broker-policy-registry";
import type { BrokerPolicyListing, BrokerPolicyStatus } from "@/types";
import {
  BROKER_POLICY_ACTION_LABEL, BROKER_POLICY_REASON_LABEL,
  BROKER_POLICY_SCOPE_LABEL, BROKER_POLICY_STATUS_LABEL, isStaleEvidence,
} from "@/types";
import { cn } from "@/lib/utils";
import {
  ACTION_TONE, STATUS_TONE, formatPolicyDate, formatPolicyDateTime, untilLabel,
} from "./broker-policy-labels";

/**
 * ★ DIRECTORY → BROKERS → BROKER POLICIES ★
 *
 * The one central place a company's broker working decisions live.
 *
 * It is HERE, in the broker directory, and not in Organization Settings,
 * because these are daily operating decisions rather than configuration. A
 * dispatcher asking "why did that load not come up?" and an owner asking "what
 * are we refusing at the moment?" are both asking an operational question, and
 * burying the answer in a settings page is how a feature stops being used.
 *
 * Settings still exists and still matters — who may propose, who may approve,
 * how long a hold lasts — and it holds ONLY that.
 *
 * ★ THE SAME RECORDS AS EVERYWHERE ELSE ★
 * Every row here is the canonical policy that Load Search evaluated, that the
 * Opportunity carried and that Booking re-checked. There is no per-screen copy,
 * which is why revoking one here clears all three at once.
 */

const STATUS_FILTERS: (BrokerPolicyStatus | "all" | "in_force")[] = [
  "in_force", "proposed", "all", "rejected", "expired", "revoked",
];

const STATUS_FILTER_LABEL: Record<string, string> = {
  in_force: "In force",
  proposed: "Waiting for approval",
  all: "Everything",
  rejected: "Rejected",
  expired: "Expired",
  revoked: "Revoked",
};

export function BrokerPoliciesScreen() {
  const ctx = useServiceContext();
  /*
   * ★ EVERY ENTRY POINT OPENS THE SAME RECORD ★
   * A Needs You item, a Load Search result, an Opportunity and the MT Loop
   * blocker all link here with `?policy=<id>`. The link names the canonical
   * policy rather than carrying a copy of it, which is what makes "these all
   * open the same record" true by construction.
   */
  const focusedPolicyId = useSearchParams().get("policy") ?? undefined;
  const [filter, setFilter] = useState<string>(focusedPolicyId ? "all" : "in_force");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | undefined>();
  /*
   * The registry is synchronous and in-memory, so the list is READ while
   * rendering rather than copied into state by an effect — which would only add
   * a render and a flash of the previous answer.
   *
   * `version` is how a write gets back onto the screen: approving or revoking a
   * policy changes the store, not any React state, so the component would
   * otherwise have no reason to look again. Bumping it is the re-read.
   */
  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((v) => v + 1), []);
  const rows = useMemo<BrokerPolicyListing[] | null>(() => {
    // Read so the memo genuinely depends on it. The registry is not React
    // state, so nothing else here changes when a policy is approved or revoked.
    void version;
    return ctx ? brokerPoliciesFor(ctx, {}) : null;
  }, [ctx, version]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter((row) => {
      // Arriving from a link about ONE policy shows that one, whatever its
      // status: a rejected or expired policy is exactly what somebody
      // following a stale link needs to be shown, rather than an empty list.
      if (focusedPolicyId) return row.policy.policyId === focusedPolicyId;
      if (filter === "in_force" && row.currentStatus !== "active") return false;
      if (filter === "proposed" && !row.awaitingApproval) return false;
      if (["rejected", "expired", "revoked"].includes(filter)
        && row.currentStatus !== filter) return false;
      if (!q) return true;
      return `${row.policy.brokerNameSnapshot} ${row.policy.organizationNameSnapshot}`
        .toLowerCase().includes(q);
    });
  }, [rows, filter, query, focusedPolicyId]);

  const counts = useMemo(() => {
    const all = rows ?? [];
    const inForce = all.filter((r) => r.currentStatus === "active");
    return {
      hardBlocks: inForce.filter((r) => r.policy.action === "hard_block").length,
      deprioritized: inForce.filter((r) => r.policy.action === "deprioritize").length,
      warnings: inForce.filter((r) => r.policy.action === "warning").length,
      holds: inForce.filter((r) => r.policy.action === "temporary_safety_hold").length,
      waiting: all.filter((r) => r.awaitingApproval).length,
    };
  }, [rows]);

  if (!ctx) return <LoadingSkeleton rows={4} />;
  if (rows === null) return <LoadingSkeleton rows={6} />;

  if (!ctx.permissions.has("customers:view")) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="You cannot see broker policies"
        description="Reading who this organization will and will not work with needs the “View customers” permission."
      />
    );
  }

  async function act(
    row: BrokerPolicyListing,
    kind: "reject" | "revoke",
    note: string,
  ) {
    if (!ctx) return;
    setBusy(row.policy.policyId);
    try {
      if (kind === "reject") await rejectBrokerPolicy(ctx, row.policy.policyId, note);
      else await revokeBrokerPolicy(ctx, row.policy.policyId, note);
      load();
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <div className="space-y-section">
      <PageHeader
        title="Broker policies"
        description="Who this organization will and will not work with, and why. Private to you — the broker never sees any of it."
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link href="/directory">
              <ArrowLeft aria-hidden />
              Directory
            </Link>
          </Button>
        }
      />

      <section
        aria-label="Summary"
        className="grid grid-cols-2 gap-3 sm:grid-cols-5"
      >
        <Summary label="Hard blocks" value={counts.hardBlocks} tone="danger" />
        <Summary label="Deprioritized" value={counts.deprioritized} tone="warning" />
        <Summary label="Warnings only" value={counts.warnings} tone="warning" />
        <Summary label="Safety holds" value={counts.holds} tone="danger" />
        <Summary label="Waiting on an owner" value={counts.waiting} tone="info" />
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
          {STATUS_FILTERS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
              className={cn(
                "rounded-md border px-2.5 py-1 text-[0.8125rem] font-medium",
                filter === key
                  ? "border-border-strong bg-surface text-fg"
                  : "border-transparent text-fg-muted hover:text-fg",
              )}
            >
              {STATUS_FILTER_LABEL[key]}
            </button>
          ))}
        </div>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by broker or organization"
          className="sm:max-w-xs"
          aria-label="Search broker policies"
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={ShieldAlert}
          title={
            focusedPolicyId
              ? "That policy is not one you can see"
              : filter === "in_force"
              ? "Nothing is restricted right now"
              : "Nothing matches that"
          }
          description={
            focusedPolicyId
              ? "It belongs to another organization, or it no longer exists."
              : filter === "in_force"
                ? "Every broker is worked normally. You can set a policy from a broker's profile, from a Load Search result or from an Opportunity."
                : "Try a different filter."
          }
        />
      ) : (
        <ul className="space-y-2">
          {visible.map((row) => (
            <PolicyRow
              key={row.policy.policyId}
              row={row}
              // A link about one policy opens it. Anything else waits to be asked.
              startOpen={row.policy.policyId === focusedPolicyId}
              busy={busy === row.policy.policyId}
              mayDecide={Boolean(ctx.permissions.has("customers:private:manage"))}
              onReject={(note) => act(row, "reject", note)}
              onRevoke={(note) => act(row, "revoke", note)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Summary({
  label, value, tone,
}: { label: string; value: number; tone: "danger" | "warning" | "info" }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2.5">
      <p className="text-[0.75rem] text-fg-muted">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-[1.25rem] font-semibold tabular-nums",
          value === 0 ? "text-fg-subtle"
            : tone === "danger" ? "text-st-danger"
              : tone === "warning" ? "text-st-warning" : "text-st-info",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function PolicyRow({
  row, busy, mayDecide, startOpen, onReject, onRevoke,
}: {
  row: BrokerPolicyListing;
  busy: boolean;
  mayDecide: boolean;
  startOpen?: boolean;
  onReject: (note: string) => void;
  onRevoke: (note: string) => void;
}) {
  const { policy } = row;
  const [open, setOpen] = useState(startOpen === true);

  return (
    <li className="rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 p-3.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/directory/${policy.brokerPartyId}`}
              className="text-[0.9375rem] font-semibold text-fg hover:underline"
            >
              {policy.brokerNameSnapshot}
            </Link>
            <Badge tone={ACTION_TONE[policy.action]}>
              {BROKER_POLICY_ACTION_LABEL[policy.action]}
            </Badge>
            <Badge tone={STATUS_TONE[row.currentStatus]}>
              {BROKER_POLICY_STATUS_LABEL[row.currentStatus]}
            </Badge>
            {row.awaitingApproval ? (
              <Badge tone="info">Owner decision required</Badge>
            ) : null}
          </div>

          {/*
            ★ WHOSE POLICY, ALWAYS ★
            A dispatch organization's decision must never be read as the
            carrier's, so the owner and the scope are on the row itself rather
            than a detail somebody has to open.
          */}
          <p className="mt-1 text-[0.8125rem] text-fg-muted">
            {policy.organizationNameSnapshot} · {BROKER_POLICY_SCOPE_LABEL[policy.scope]} ·{" "}
            {BROKER_POLICY_REASON_LABEL[policy.reason]}
          </p>

          <p className="mt-1 text-[0.75rem] text-fg-subtle">
            Effective {formatPolicyDate(policy.effectiveFrom)}
            {policy.expiresAt
              ? ` · expires ${formatPolicyDate(policy.expiresAt)} (${untilLabel(policy.expiresAt)})`
              : " · no expiry"}
            {policy.verifiedMcNumber || policy.reportedMcNumber
              ? ` · MC ${policy.verifiedMcNumber ?? policy.reportedMcNumber}`
              : ""}
          </p>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? "Hide" : "Details"}
          <ChevronRight
            aria-hidden
            className={cn("transition-transform", open && "rotate-90")}
          />
        </Button>
      </div>

      {open ? (
        <div className="border-t border-border px-3.5 py-3 text-[0.8125rem]">
          {row.mayReadExplanation ? (
            <p className="text-fg">{policy.explanation}</p>
          ) : (
            /*
              Another organization's private reasoning does not travel. The
              fact, the scope and the owner do — which is everything somebody
              needs in order to act, and nothing that turns one company's
              opinion into another company's intelligence.
            */
            <p className="text-fg-subtle italic">
              {policy.organizationNameSnapshot} keeps its reasoning private. What
              it does and who owns it is above.
            </p>
          )}

          {policy.evidence.length > 0 && row.mayReadExplanation ? (
            <ul className="mt-2 space-y-1 text-[0.75rem] text-fg-muted">
              {policy.evidence.map((e) => (
                <li key={`${e.kind}-${e.id}`}>
                  {e.label} · {formatPolicyDate(e.observedAt)}
                  {/*
                    ★ A FACTOR'S ANSWER GOES OFF ★
                    It was about this carrier's receivable on the day it was
                    given, and it is not evidence about the broker months later.
                    Saying so on the row is what stops a stale decline quietly
                    propping up a permanent block.
                  */}
                  {isStaleEvidence(e, new Date().toISOString()) ? (
                    <span className="ml-1 text-st-warning">
                      · out of date, worth checking again
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          <dl className="mt-3 grid gap-x-6 gap-y-1 text-[0.75rem] sm:grid-cols-2">
            <Row label="Proposed by">
              {policy.proposedBy.displayNameSnapshot} · {formatPolicyDateTime(policy.proposedAt)}
            </Row>
            <Row label="Approved by">
              {policy.approvedBy
                ? `${policy.approvedBy.displayNameSnapshot} · ${formatPolicyDateTime(policy.approvedAt)}`
                : row.awaitingApproval
                  ? `Waiting on ${policy.approverNameSnapshot ?? "an owner"}`
                  : "Never approved"}
            </Row>
          </dl>

          <ol className="mt-3 space-y-1 border-t border-border pt-2 text-[0.75rem] text-fg-muted">
            {policy.history.map((entry) => (
              <li key={entry.id}>
                <span className="text-fg-subtle">{formatPolicyDateTime(entry.at)}</span>
                {" — "}
                {entry.note}
              </li>
            ))}
          </ol>

          {mayDecide ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {row.awaitingApproval ? (
                <p className="text-[0.75rem] text-fg-subtle">
                  Approving happens in Needs You, where the decision is routed to
                  the owner it belongs to.
                </p>
              ) : null}
              {row.awaitingApproval ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => onReject("Rejected from the Broker policies list.")}
                >
                  Reject
                </Button>
              ) : null}
              {row.currentStatus === "active" ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => onRevoke("Revoked from the Broker policies list.")}
                >
                  Revoke
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-fg-subtle">{label}</dt>
      <dd className="text-fg">{children}</dd>
    </div>
  );
}
