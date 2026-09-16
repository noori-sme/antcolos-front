"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, ScrollText, ShieldCheck, X } from "lucide-react";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { LEARNING_DATA_USE_POLICY } from "@/config/learning";
import { useServiceContext } from "@/lib/api/use-service-context";
import { queryKeys } from "@/lib/query";
import { learningFor } from "@/lib/api/mock/ranking";
import type { LearningSummary } from "@/types";

/**
 * ★ WHAT LEAVES THIS WORKSPACE, STATED RATHER THAN ASKED ★
 *
 * Learning is part of what Antcolos is, not a feature a workspace switches on,
 * so this page has no switch on it. That is precisely why it exists: a product
 * that does not ask permission owes the clearest possible account of what it
 * takes, and an account somebody can check beats a reassurance they cannot.
 *
 * So the page is the policy, rendered from the policy — an exhaustive list of
 * the derived fields that may travel with the reduction applied to each, the
 * categories that never may, the version in force, and what is still owed
 * before any of this runs outside a demonstration. Nothing here is written by
 * hand; it all comes from `src/config/learning.ts`, so a screen cannot describe
 * a boundary the code does not keep.
 *
 * ███ FRONTEND ONLY ███
 * No data is transmitted anywhere by this build. The page says so in place,
 * because a privacy page that overstates itself is worse than none.
 */
export function LearningDataUseScreen() {
  const ctx = useServiceContext();

  const query = useQuery({
    queryKey: ctx
      ? queryKeys.learningDataUse(ctx.organizationId)
      : ["learning", "data-use", "none"],
    queryFn: async () => learningFor(ctx!.organizationId),
    enabled: Boolean(ctx),
  });

  return (
    <div className="space-y-section">
      <PageHeader
        title="Learning and your data"
        description="Antcolos ranks loads better by watching which ones get pursued. This is exactly what that uses, and exactly what it never touches."
      />

      {query.isPending ? (
        <LoadingSkeleton rows={3} />
      ) : query.isError ? (
        <ErrorState description={query.error.message} onRetry={() => void query.refetch()} />
      ) : (
        <DataUse summary={query.data!} />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function DataUse({ summary }: { summary: LearningSummary }) {
  const policy = LEARNING_DATA_USE_POLICY;

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-primary/30 bg-primary/[0.03] p-4">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <h2 className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg">
            <ShieldCheck className="size-4 text-fg-subtle" aria-hidden />
            How the ranking learns
          </h2>
          <Badge tone="info">Policy v{policy.version}</Badge>
        </div>
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-fg-muted">{policy.summary}</p>
        <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-muted">
          Two things stay true whatever else changes. Your own decisions never
          leave this workspace, and the ranking learns from them first. And you
          are never handed your own contributions back as though they were
          somebody else&apos;s opinion — they are taken out before anything is
          counted.
        </p>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
        <h2 className="text-[0.875rem] font-semibold text-fg">
          Your decisions, and what there is to learn from
        </h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          <Stat
            label="Your decisions"
            value={summary.localObservations}
            hint="One per load. Pressing twice is still one."
          />
          <Stat
            label="Contributed"
            value={summary.contributedObservations}
            hint={`Derived signals only, under policy v${summary.policyVersion}.`}
          />
          <Stat
            label="From other workspaces"
            value={summary.networkObservations}
            hint={summary.networkAvailability === "available"
              ? "Enough to offer a suggestion."
              : `Fewer than ${policy.minimumObservations}, so no suggestion is offered.`}
          />
        </dl>
        <p className="mt-3 text-[0.75rem] leading-relaxed text-fg-muted">
          {summary.suggestedFrom === "local"
            ? "The suggestion offered in the Opportunity Inbox right now comes from this workspace's own decisions."
            : summary.suggestedFrom === "network"
              ? "The suggestion offered in the Opportunity Inbox right now comes from other workspaces' decisions."
              : "There is no suggestion on offer right now. Antcolos says so rather than guessing."}
        </p>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
        <h2 className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg">
          <Check className="size-4 text-st-success" aria-hidden />
          Everything that may leave this workspace
        </h2>
        <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
          This list is exhaustive. A field that is not on it is dropped before a
          row is stored — not left out by somebody remembering to, but removed by
          the boundary itself.
        </p>
        <ul className="mt-3 space-y-2.5">
          {policy.allowed.map((field) => (
            <li key={field.key}>
              <p className="text-[0.8125rem] font-medium text-fg">{field.label}</p>
              <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
                {field.derivation}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
        <h2 className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg">
          <X className="size-4 text-st-danger" aria-hidden />
          What never leaves it, whatever happens
        </h2>
        <ul className="mt-3 space-y-2.5">
          {policy.prohibited.map((field) => (
            <li key={field.label}>
              <p className="text-[0.8125rem] font-medium text-fg">{field.label}</p>
              <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
                {field.reason}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
        <h2 className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg">
          <ScrollText className="size-4 text-fg-subtle" aria-hidden />
          What is still owed before this runs for real
        </h2>
        <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
          {summary.dataUseNote}
        </p>
        <ul className="mt-3 space-y-1">
          {policy.launchRequirements.map((requirement) => (
            <li key={requirement} className="text-[0.75rem] leading-relaxed text-fg-muted">
              — {requirement}
            </li>
          ))}
        </ul>
        <p className="mt-3 rounded-md border border-dashed border-border px-3 py-2.5 text-[0.75rem] leading-relaxed text-fg-muted">
          <strong className="font-medium text-fg">What this build actually does.</strong>{" "}
          Everything above runs in memory for as long as this tab is open. No
          data is transmitted anywhere, nothing is stored durably, and no model
          is trained, scored or served. Enforcing this boundary against anything
          that does not run this code, keeping a durable record, and deciding
          retention and deletion are the backend&apos;s — and none of them is a
          promise this page is making.
        </p>
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-sunken px-3.5 py-3">
      <dt className="text-[0.75rem] text-fg-muted">{label}</dt>
      <dd className="mt-0.5 text-[1.125rem] font-semibold tabular-nums text-fg">{value}</dd>
      <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-fg-subtle">{hint}</p>
    </div>
  );
}
