"use client";

import { useQuery } from "@tanstack/react-query";
import { Lock, Share2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { useCan } from "@/lib/session/hooks";
import { useServiceContext } from "@/lib/api/use-service-context";
import { queryKeys } from "@/lib/query";
import {
  learningFor, setLearningConsent, type LearningConsentPatch,
} from "@/lib/api/mock/ranking";
import type { LearningSummary } from "@/types";

/**
 * ★ WHAT LEAVES THIS WORKSPACE, AND WHO DECIDED ★
 *
 * The one screen where a workspace says whether its decisions may be used to
 * make Antcolos's ranking better for everybody, and whether it wants the
 * benefit of everybody else's.
 *
 * Two switches, not one, because they are two decisions and only one of them is
 * irreversible. Contribution is off until somebody turns it on. Consumption is
 * on, and the page says exactly why that is defensible rather than asking to be
 * trusted about it: what comes back is derived from bands over a pool that
 * holds no organization id, and it says nothing at all until there is enough in
 * it to be about the market rather than about one workspace.
 *
 * ███ FRONTEND ONLY ███
 * Everything here is an in-memory setting that lives as long as the tab. It is
 * not a durable consent record and it is not authorization. The page says so
 * where a reader can see it, because a privacy control that overstates itself
 * is worse than none.
 */
export function LearningSettingsScreen() {
  const ctx = useServiceContext();
  const mayManage = useCan("organization:manage");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ctx
      ? queryKeys.learningConsent(ctx.organizationId)
      : ["learning", "consent", "none"],
    queryFn: async () => learningFor(ctx!.organizationId),
    enabled: Boolean(ctx),
  });

  async function change(patch: LearningConsentPatch) {
    if (!ctx) return;
    setPending(true);
    setError(null);
    try {
      setLearningConsent(ctx, patch);
      await query.refetch();
    } catch (e) {
      // The service refused. The switch snaps back because the refetch below
      // reads what is actually stored, never what was clicked.
      setError(e instanceof Error ? e.message : "That change was not applied.");
      await query.refetch();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-section">
      <PageHeader
        title="Shared learning"
        description="Whether this workspace's decisions help Antcolos rank loads for everybody, and whether it uses what everybody else has taught it."
      />

      {query.isPending ? (
        <LoadingSkeleton rows={3} />
      ) : query.isError ? (
        <ErrorState
          description={query.error.message}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <LearningConsentCards
          summary={query.data!}
          mayManage={mayManage}
          pending={pending}
          error={error}
          onChange={(patch) => void change(patch)}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function LearningConsentCards({
  summary, mayManage, pending, error, onChange,
}: {
  summary: LearningSummary;
  mayManage: boolean;
  pending: boolean;
  error: string | null;
  onChange: (patch: LearningConsentPatch) => void;
}) {
  const { consent } = summary;

  return (
    <div className="space-y-4">
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-st-danger/40 bg-st-danger-bg/60 px-3.5 py-2.5 text-[0.8125rem] text-fg"
        >
          {error}
        </p>
      ) : null}

      {!mayManage ? (
        <p className="flex items-start gap-2 rounded-md border border-border bg-surface-sunken px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-fg-muted">
          <Lock className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" aria-hidden />
          You can read what this workspace has agreed to. Changing it takes
          permission to manage the organization.
        </p>
      ) : null}

      <ConsentSwitch
        icon={Share2}
        title="Give this workspace's decisions to shared learning"
        state={consent.contribute}
        onLabel="Contributing"
        offLabel="Not contributing"
        disabled={!mayManage || pending}
        onChange={(next) => onChange({ contribute: next })}
      >
        <p>
          When this is on, every load somebody here short-lists or throws away is
          added to a shared pool in the anonymised form listed below. When it is
          off, nothing is added — and nothing is held anywhere waiting to be
          added later, so turning it on never sweeps up what was refused while it
          was off.
        </p>
        <p className="mt-1.5 font-medium text-fg">{summary.contributionHistoryNote}</p>
      </ConsentSwitch>

      <ConsentSwitch
        icon={ShieldCheck}
        title="Use suggestions learned across Antcolos"
        state={consent.consume}
        onLabel="Using suggestions"
        offLabel="Not using suggestions"
        disabled={!mayManage || pending}
        onChange={(next) => onChange({ consume: next })}
      >
        <p>
          This is on by default, and it is separate from the switch above — you
          can take the benefit without giving anything. What comes back is a set
          of weights derived from rounded bands over a pool that carries no
          organization id, and it says nothing at all until there are enough
          decisions in it to be about the market rather than about one workspace.
          Nothing you can see through it names a workspace, a person, a carrier,
          a truck, a driver, a load, a contract or a credential. Your own
          contributions are taken out before any of this is counted, so a
          suggestion is never your own decisions handed back to you.
        </p>
        <p className="mt-1.5">
          Turning it off does not stop the ranking learning from{" "}
          <strong className="font-medium text-fg">your own</strong> decisions.
          That never leaves this workspace and is always available.
        </p>
      </ConsentSwitch>

      <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
        <h2 className="text-[0.875rem] font-semibold text-fg">
          What this workspace has given, and what there is to learn from
        </h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          <Stat
            label="Your decisions"
            value={summary.localObservations}
            hint="Recorded here. Never leave this workspace."
          />
          <Stat
            label="Contributed"
            value={summary.contributedObservations}
            hint={consent.contribute
              ? "Added to the shared pool, anonymised."
              : "Nothing has been contributed."}
          />
          <Stat
            label="From other workspaces"
            value={summary.networkObservations}
            hint={NETWORK_HINT[summary.networkAvailability]}
          />
        </dl>

        <p className="mt-3 text-[0.75rem] leading-relaxed text-fg-muted">
          {summary.suggestedFrom === "local"
            ? "The suggestion offered in the Opportunity Inbox right now comes from this workspace's own decisions."
            : summary.suggestedFrom === "network"
              ? "The suggestion offered in the Opportunity Inbox right now comes from the shared pool."
              : "There is no suggestion on offer right now. Antcolos says so rather than guessing."}
        </p>

        {consent.updatedByName ? (
          <p className="mt-2 text-[0.75rem] text-fg-subtle">
            Last changed by {consent.updatedByName} on{" "}
            {new Date(consent.updatedAt).toLocaleDateString()}. Every change is
            written to the audit ledger.
          </p>
        ) : (
          <p className="mt-2 text-[0.75rem] text-fg-subtle">
            Nobody has changed these yet, so the shipped defaults are in force.
          </p>
        )}
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <FieldList title="Leaves this workspace when contributing" items={summary.sharedFields} />
        <FieldList title="Never leaves it, whatever happens" items={summary.withheldFields} />
      </div>

      <div className="space-y-2 rounded-md border border-dashed border-border px-3.5 py-3 text-[0.75rem] leading-relaxed text-fg-muted">
        <p>
          <strong className="font-medium text-fg">What this build actually enforces.</strong>{" "}
          These settings live in memory for as long as this tab is open, and the
          permission check behind them runs in this app. They are not a durable
          consent record, they are not enforced against anything that does not run
          this code, and no data is transmitted anywhere by this build at all.
        </p>
        <p>
          <strong className="font-medium text-fg">Backend policy, not settled here.</strong>{" "}
          Durable deletion, how long anonymous contributions are kept, and what
          withdrawing consent actually removes are decisions with legal weight
          that belong to the backend and to the privacy terms. Nothing on this
          page decides any of them, and nothing on it should be read as a promise
          about them.
        </p>
      </div>
    </div>
  );
}

const NETWORK_HINT: Record<LearningSummary["networkAvailability"], string> = {
  available: "Enough to offer a suggestion.",
  consumption_disabled: "Not in use — suggestions are turned off here.",
  insufficient_evidence: "Not enough yet to suggest anything.",
};

function ConsentSwitch({
  icon: Icon, title, state, onLabel, offLabel, disabled, onChange, children,
}: {
  icon: typeof Share2;
  title: string;
  state: boolean;
  onLabel: string;
  offLabel: string;
  disabled: boolean;
  onChange: (next: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={state}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-1 size-4 shrink-0 accent-primary disabled:cursor-not-allowed"
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <Icon className="size-4 text-fg-subtle" aria-hidden />
            <span className="text-[0.875rem] font-semibold text-fg">{title}</span>
            <Badge tone={state ? "success" : "neutral"}>{state ? onLabel : offLabel}</Badge>
          </span>
          <span className="mt-1.5 block text-[0.75rem] leading-relaxed text-fg-muted">
            {children}
          </span>
        </span>
      </label>
    </section>
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

function FieldList({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <h3 className="text-[0.8125rem] font-semibold text-fg">{title}</h3>
      <ul className="mt-1.5 space-y-0.5">
        {items.map((f) => (
          <li key={f} className="text-[0.75rem] text-fg-muted">{f}</li>
        ))}
      </ul>
    </section>
  );
}
