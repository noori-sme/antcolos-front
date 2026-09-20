"use client";

import { Landmark } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  FACTORING_DECISION_SHORT, FACTORING_DECISION_TONE, FACTORING_SOURCE_LABEL,
  FACTORING_SOURCE_SHORT, type FactoringStatusView,
} from "@/types";
import { Tip } from "@/features/mt-loop/tip";
import { relativeAge } from "@/lib/api/mock/factoring-registry";

/**
 * The answer, in one chip.
 *
 * ★ THE ANSWER FIRST, THE WORKING ON DEMAND ★
 * A dispatcher scanning fourteen loads needs one word per row and a colour.
 * Everything else — which factor, when, how, what the conditions are, what the
 * limit is — is one hover or one tab-stop away, and none of it is printed on
 * the card. Putting a paragraph of factoring prose on every row is how a load
 * list stops being scannable, which is the thing it is for.
 *
 * ★ AND THE SOURCE IS NEVER HIDDEN ★
 * "Approved · imported" and "Approved · live" are different facts, and the
 * second one does not exist yet: no factoring company has authorized Antcolos.
 * The chip carries the source word so a dispatcher can never mistake a
 * spreadsheet row from Tuesday for a provider answering just now.
 */
export function FactoringChip({
  status, className,
}: {
  status: FactoringStatusView;
  className?: string;
}) {
  const tone = FACTORING_DECISION_TONE[status.decision];
  const label = FACTORING_DECISION_SHORT[status.decision];
  const sourceWord = status.source ? FACTORING_SOURCE_SHORT[status.source] : undefined;

  return (
    <Tip text={<FactoringDetail status={status} />} className="no-underline">
      <Badge
        tone={tone}
        className={className}
        data-testid="factoring-chip"
        data-factoring-decision={status.decision}
      >
        <Landmark className="size-3" aria-hidden />
        <span className="sr-only">Factoring: </span>
        {label}
        {sourceWord ? (
          <span className="font-normal opacity-80">· {sourceWord}</span>
        ) : null}
      </Badge>
    </Tip>
  );
}

/**
 * The working, for the one row somebody stopped on.
 *
 * Answers the four questions a dispatcher actually has, in the order they have
 * them: which factor, for which carrier, when, and how the answer got here.
 */
export function FactoringDetail({ status }: { status: FactoringStatusView }) {
  return (
    <span className="block space-y-1.5">
      <span className="block font-medium">{status.detail}</span>

      {status.conditions.length > 0 ? (
        <span className="block">
          {/* Conditions are never summarised away: a conditional approval is
              only usable if the conditions are on the screen. */}
          Conditions:
          <span className="mt-0.5 block space-y-0.5">
            {status.conditions.map((c) => (
              <span key={c} className="block">· {c}</span>
            ))}
          </span>
        </span>
      ) : null}

      <span className="block text-fg-subtle">
        {status.providerName ? `${status.providerName}` : "No factoring connection"}
        {status.accountLabel ? ` · ${status.accountLabel}` : ""}
        {status.source ? ` · ${FACTORING_SOURCE_LABEL[status.source]}` : ""}
        {status.checkedAt ? ` · checked ${relativeAge(status.checkedAt)}` : ""}
      </span>

      {status.liveApi ? null : (
        <span className="block text-fg-subtle">
          Not a live factoring API. No factoring company was contacted.
        </span>
      )}

      {status.recheckRequired ? (
        <span className="block text-fg-subtle">Check again before you book.</span>
      ) : null}
    </span>
  );
}
