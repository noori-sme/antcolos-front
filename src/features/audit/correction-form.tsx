"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { services } from "@/lib/api";
import { useServiceContext } from "@/lib/api/use-service-context";

/**
 * Appending a correction.
 *
 * The wording is deliberate: this does not "edit" or "fix" the event. It adds a
 * new one that points back at it, and says so on the button — because somebody
 * who believes they are editing the record will write a different reason than
 * somebody who knows both versions will be read.
 */
export function CorrectionForm({
  eventId, onDone,
}: {
  eventId: string;
  onDone: () => void;
}) {
  const ctx = useServiceContext();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [summary, setSummary] = useState("");

  const correct = useMutation({
    mutationFn: () => {
      if (!ctx) throw new Error("No active organization");
      return services.audit.correct(ctx, eventId, {
        reason,
        summary: summary.trim() || undefined,
      });
    },
    onSuccess: () => {
      if (ctx) queryClient.invalidateQueries({ queryKey: ["org", ctx.organizationId] });
      onDone();
    },
  });

  return (
    <section
      aria-labelledby="correction"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <h2 id="correction" className="text-[0.875rem] font-semibold text-fg">
        Append a correction
      </h2>
      <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">
        This adds a new event linked to the original. The original is not changed, hidden or
        removed, and both will be read together from now on.
      </p>

      <div className="mt-3 space-y-3">
        <div>
          <label
            htmlFor="correction-reason"
            className="text-[0.8125rem] font-medium text-fg"
          >
            Why was the original wrong?
          </label>
          <Textarea
            id="correction-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="The receipt reads 18.4 gallons; 118.4 was typed with a leading 1."
            className="mt-1"
          />
        </div>
        <div>
          <label
            htmlFor="correction-summary"
            className="text-[0.8125rem] font-medium text-fg"
          >
            What should it have said? <span className="text-fg-subtle">(optional)</span>
          </label>
          <Textarea
            id="correction-summary"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={2}
            className="mt-1"
          />
        </div>

        {correct.isError ? (
          <p className="text-[0.8125rem] text-st-danger">
            {(correct.error as Error).message}
          </p>
        ) : null}

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => correct.mutate()}
            disabled={!reason.trim() || correct.isPending}
          >
            {correct.isPending ? "Appending…" : "Append correction"}
          </Button>
          <Button variant="ghost" size="sm" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </div>
    </section>
  );
}
