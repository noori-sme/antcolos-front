"use client";

import { CheckCheck, ClipboardCheck } from "lucide-react";
import { Can } from "@/components/auth/can";
import { EmptyState } from "@/components/data/states";
import { Button } from "@/components/ui/button";
import type {
  DocumentReview, ReviewDecision, ReviewField, RiskTier, TierCounts,
} from "@/types/rate-con-intake";
import { FieldRow } from "./field-row";
import { useCompleteReview, useDecideFields, useIntentKey } from "./hooks";

const TIERS: { tier: RiskTier; title: string; note: string }[] = [
  {
    tier: "high",
    title: "Check these",
    note: "Rate, addresses, dates and times, load and reference numbers. Each needs a decision.",
  },
  { tier: "medium", title: "Worth a look", note: "Taken as read unless you correct them." },
  { tier: "low", title: "Everything else", note: "Taken as read unless you correct them." },
];

function countsLabel(counts: TierCounts): string {
  const done = counts.confirmed + counts.corrected;
  return `${done} of ${counts.total} checked`;
}

/**
 * The fields in the server's review order (plan 13), grouped by risk tier,
 * with the batch confirm and the "complete review" step.
 */
export function FieldList({
  documentId,
  review,
  activeFieldId,
  onActivate,
}: {
  documentId: string;
  review: DocumentReview;
  activeFieldId: string | null;
  onActivate: (fieldId: string, jump: boolean) => void;
}) {
  const decide = useDecideFields(documentId);
  const complete = useCompleteReview(documentId);
  const decisionKey = useIntentKey();
  const completeKey = useIntentKey();
  const readOnly = review.documentStatus === "accepted";
  const pendingHigh = review.fields.filter(
    (f) => f.requiresConfirmation && f.reviewStatus === "unreviewed",
  );

  async function send(decisions: ReviewDecision[]) {
    // The same decisions retried reuse their key; new decisions get a new one.
    const idempotencyKey = decisionKey.keyFor(JSON.stringify(decisions));
    await decide.mutateAsync({ decisions, idempotencyKey });
    decisionKey.clear();
  }

  if (!review.fields.length) {
    return (
      <EmptyState
        icon={ClipboardCheck}
        title="Nothing was read from this Rate Con"
        description="Create the load by hand, or upload a clearer copy of the Rate Con."
      />
    );
  }

  return (
    <div className="space-y-5">
      {decide.error ? (
        <p role="alert" className="rounded-md bg-st-danger-bg px-3 py-2 text-[0.8125rem] text-st-danger">
          {decide.error.message}
        </p>
      ) : null}

      {TIERS.map(({ tier, title, note }) => {
        const fields: ReviewField[] = review.fields.filter((f) => f.tier === tier);
        if (!fields.length) return null;
        return (
          <section key={tier} aria-labelledby={`rc-tier-${tier}`} className="space-y-2.5">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 id={`rc-tier-${tier}`} className="text-[0.9375rem] font-semibold text-fg">
                  {title}
                </h2>
                <p className="text-[0.75rem] text-fg-muted">{note}</p>
              </div>
              <span className="text-[0.75rem] tabular-nums text-fg-subtle">
                {countsLabel(review.summary[tier])}
              </span>
            </div>
            {tier === "high" && pendingHigh.length > 1 && !readOnly ? (
              <Can permission="documents:review">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={decide.isPending}
                  onClick={() =>
                    void send(
                      pendingHigh.map((f) => ({ fieldId: f.id, action: "confirm" as const })),
                    ).catch(() => {})
                  }
                >
                  <CheckCheck aria-hidden />
                  Confirm the {pendingHigh.length} remaining as read
                </Button>
              </Can>
            ) : null}
            <ul className="space-y-2">
              {fields.map((field) => (
                <FieldRow
                  key={field.id}
                  field={field}
                  active={field.id === activeFieldId}
                  readOnly={readOnly}
                  pending={decide.isPending}
                  onActivate={onActivate}
                  onDecide={(decision) => send([decision])}
                />
              ))}
            </ul>
          </section>
        );
      })}

      {review.documentStatus === "extracted" ? (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3 shadow-e2">
          <p className="text-[0.8125rem] text-fg-muted" aria-live="polite">
            {review.summary.canComplete
              ? "Every high-risk value is checked."
              : `${review.summary.highRiskPending} high-risk ${
                  review.summary.highRiskPending === 1 ? "value still needs" : "values still need"
                } a check.`}
          </p>
          <div className="flex flex-col items-end gap-1">
            <Button
              variant="primary"
              disabled={!review.summary.canComplete || complete.isPending}
              onClick={() =>
                complete.mutate(
                  { idempotencyKey: completeKey.keyFor("complete") },
                  { onSettled: () => completeKey.clear() },
                )
              }
            >
              {complete.isPending ? "Completing…" : "Complete review"}
            </Button>
            {complete.error ? (
              <p role="alert" className="text-[0.75rem] text-st-danger">
                {complete.error.message}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
