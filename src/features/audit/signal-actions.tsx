"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCan } from "@/lib/session/hooks";
import type { RiskSignal } from "@/types";
import { useDismissSignal, useOpenCase } from "./use-audit";

/**
 * Opening a case, and dismissing a signal.
 *
 * Both refuse without a reason, and both say plainly what they do and do not
 * touch — because "dismiss" is a word people reasonably expect to make
 * something go away, and here it does not.
 */

export function OpenCaseDialog({
  signal, onClose,
}: {
  signal: RiskSignal;
  onClose: () => void;
}) {
  const router = useRouter();
  const canInvestigate = useCan("risk:investigate");
  const openCase = useOpenCase();
  const [title, setTitle] = useState(signal.title);
  const [summary, setSummary] = useState("");

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="Open a case"
        description="A case is the investigation: who is looking at it, what they found, and what they decided. The signal stays as it is."
      >
        {!canInvestigate ? (
          <p className="mt-4 text-[0.8125rem] text-fg-muted">
            You can see signals, but opening an investigation needs the
            &ldquo;Investigate risk cases&rdquo; permission.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            <div>
              <label htmlFor="case-title" className="text-[0.8125rem] font-medium text-fg">
                Title
              </label>
              <Input
                id="case-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <label htmlFor="case-summary" className="text-[0.8125rem] font-medium text-fg">
                What is being looked into?
              </label>
              <Textarea
                id="case-summary"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={3}
                className="mt-1"
              />
            </div>
            {openCase.isError ? (
              <p className="text-[0.8125rem] text-st-danger">
                {(openCase.error as Error).message}
              </p>
            ) : null}
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          {canInvestigate ? (
            <Button
              size="sm"
              disabled={!title.trim() || openCase.isPending}
              onClick={() =>
                openCase.mutate(
                  { title, summary, signalIds: [signal.id] },
                  {
                    onSuccess: (created) => {
                      onClose();
                      router.push(`/audit/cases/${created.id}`);
                    },
                  },
                )
              }
            >
              {openCase.isPending ? "Opening…" : "Open the case"}
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DismissSignalDialog({
  signal, onClose,
}: {
  signal: RiskSignal;
  onClose: () => void;
}) {
  const canInvestigate = useCan("risk:investigate");
  const dismiss = useDismissSignal();
  const [reason, setReason] = useState("");

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="Not a concern"
        description="This records your judgement beside the record. It does not remove, hide or change any of the audit events the rule was reading."
      >
        {!canInvestigate ? (
          <p className="mt-4 text-[0.8125rem] text-fg-muted">
            Deciding a signal is not a concern needs the &ldquo;Investigate risk
            cases&rdquo; permission.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            <div>
              <label htmlFor="dismiss-reason" className="text-[0.8125rem] font-medium text-fg">
                Why is this not a concern?
              </label>
              <Textarea
                id="dismiss-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="Checked with accounting — two different loads, both legitimate."
                className="mt-1"
              />
              <p className="mt-1 text-[0.75rem] text-fg-subtle">
                Somebody will read this later. A dismissal with no reason cannot be reviewed,
                so it is refused.
              </p>
            </div>
            {dismiss.isError ? (
              <p className="text-[0.8125rem] text-st-danger">
                {(dismiss.error as Error).message}
              </p>
            ) : null}
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          {canInvestigate ? (
            <Button
              size="sm"
              disabled={!reason.trim() || dismiss.isPending}
              onClick={() =>
                dismiss.mutate(
                  { signalId: signal.id, reason },
                  { onSuccess: onClose },
                )
              }
            >
              {dismiss.isPending ? "Recording…" : "Record it"}
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
